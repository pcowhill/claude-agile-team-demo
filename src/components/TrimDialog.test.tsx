import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { probeMediaFile } from '../lib/probeMedia'
import { LARGE_STEP_SECONDS, STEP_SECONDS } from '../lib/transport'
import { MIN_TRIM_LENGTH } from '../lib/trim'
import { ADD_SLATE, chooseFromAddMenu } from '../test/timelineMenu'

vi.mock('../lib/probeMedia', () => ({
  probeMediaFile: vi.fn(),
}))

// jsdom has no Web Audio or blob fetch: the peaks decode is mocked, as the
// timeline's tests do (#191), so the strip's waveform renders.
vi.mock('../lib/audioPeaks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/audioPeaks')>()
  return {
    ...actual,
    peaksForClip: vi.fn(() => Promise.resolve(new Float32Array([0.2, 0.8, 0.5, 0.3]))),
  }
})

const probeMock = vi.mocked(probeMediaFile)

/**
 * The Trim window (#707), through <App/>: what offers it, what Apply,
 * Cancel, ✕ and Escape do to the entry, and the clamps' keyboard and field
 * rules. Playback, dragging and the window's geometry need a real browser
 * and are `e2e/trim-window.spec.ts`'s.
 */
describe('the Trim window (#707)', () => {
  const pausedState = new WeakMap<HTMLMediaElement, boolean>()
  beforeEach(() => {
    probeMock.mockReset()
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
      pausedState.set(this, false)
      return Promise.resolve()
    })
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
      pausedState.set(this, true)
    })
    vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      return pausedState.get(this) ?? true
    })
    vi.stubGlobal('requestAnimationFrame', () => 1)
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const ENTRY = 'a.mp4 at position 1'
  const inField = () => screen.getByRole('spinbutton', { name: `Trim in point of ${ENTRY} in seconds` })
  const outField = () => screen.getByRole('spinbutton', { name: `Trim out point of ${ENTRY} in seconds` })
  const trimButton = (entry = ENTRY) =>
    screen.queryByRole('button', { name: `Trim ${entry} in the Trim window` })
  const dialog = () => screen.getByRole('dialog', { name: `Trim ${ENTRY}` })
  const inClamp = () => within(dialog()).getByRole('slider', { name: 'In clamp' })
  const outClamp = () => within(dialog()).getByRole('slider', { name: 'Out clamp' })
  const valueOf = (slider: HTMLElement) => Number(slider.getAttribute('aria-valuenow'))

  async function addVideo(duration = 10) {
    probeMock.mockResolvedValueOnce({ duration, url: 'blob:a.mp4', kind: 'video' })
    await userEvent.upload(
      screen.getByTestId('clip-file-input'),
      new File(['content'], 'a.mp4', { type: 'video/mp4' }),
    )
    await screen.findByText('a.mp4')
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
  }

  async function openTrim() {
    await userEvent.click(trimButton()!)
    return dialog()
  }

  it('is offered on a video entry, beside In and Out, and never on a still or a slate', async () => {
    render(<App />)
    await addVideo()
    probeMock.mockResolvedValueOnce({
      duration: 0, url: 'blob:logo.png', kind: 'image', width: 640, height: 480,
    })
    await userEvent.upload(
      screen.getByTestId('clip-file-input'),
      new File(['content'], 'logo.png', { type: 'image/png' }),
    )
    await screen.findByText('logo.png')
    await userEvent.click(screen.getByRole('button', { name: 'Add logo.png to timeline' }))
    await chooseFromAddMenu(ADD_SLATE)

    const button = trimButton()
    expect(button).toHaveTextContent('Trim…')
    // In the same line as the entry's In and Out fields.
    expect(button!.parentElement).toContainElement(inField())
    expect(button!.parentElement).toContainElement(outField())
    expect(trimButton('logo.png at position 2')).toBeNull()
    expect(screen.queryAllByRole('button', { name: /in the Trim window$/ })).toHaveLength(1)
  })

  it('opens on the entry’s own trim, as a modal dialog naming the entry', async () => {
    render(<App />)
    await addVideo()
    await userEvent.clear(inField())
    await userEvent.type(inField(), '2{Enter}')
    await userEvent.clear(outField())
    await userEvent.type(outField(), '7{Enter}')
    const window = await openTrim()
    expect(window).toHaveAttribute('aria-modal', 'true')
    expect(valueOf(inClamp())).toBe(2)
    expect(valueOf(outClamp())).toBe(7)
    expect(within(window).getByTestId('trim-kept-length')).toHaveTextContent('kept 0:05.00')
    // The source's waveform is on the strip.
    expect(await within(window).findByTestId('trim-waveform')).toBeInTheDocument()
    // Nothing to apply yet.
    expect(within(window).getByRole('button', { name: 'Apply' })).toBeDisabled()
  })

  it('Apply after moving the In clamp changes In and nothing else, as one undo step', async () => {
    render(<App />)
    await addVideo()
    await openTrim()
    inClamp().focus()
    fireEvent.keyDown(inClamp(), { key: 'ArrowRight', shiftKey: true })
    fireEvent.keyDown(inClamp(), { key: 'ArrowRight', shiftKey: true })
    expect(valueOf(inClamp())).toBe(2 * LARGE_STEP_SECONDS)
    // Not yet: the clamps are the window's own until Apply.
    expect(inField()).toHaveValue(0)

    await userEvent.click(within(dialog()).getByRole('button', { name: 'Apply' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(inField()).toHaveValue(2)
    expect(outField()).toHaveValue(10)

    // One undo restores both points, and only the trim: the entry the
    // step before it added is still there.
    await userEvent.click(screen.getByRole('button', { name: 'Undo last timeline edit' }))
    expect(inField()).toHaveValue(0)
    expect(outField()).toHaveValue(10)
    expect(trimButton()).not.toBeNull()
  })

  it.each([
    ['Cancel', () => userEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }))],
    ['✕', () => userEvent.click(within(dialog()).getByRole('button', { name: 'Close the Trim window without applying' }))],
    ['Escape', () => userEvent.keyboard('{Escape}')],
  ])('%s closes the window and leaves In and Out as they were', async (_, close) => {
    render(<App />)
    await addVideo()
    await openTrim()
    fireEvent.keyDown(inClamp(), { key: 'ArrowRight', shiftKey: true })
    fireEvent.keyDown(outClamp(), { key: 'ArrowLeft', shiftKey: true })
    expect(valueOf(inClamp())).toBe(1)
    expect(valueOf(outClamp())).toBe(9)
    await close()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(inField()).toHaveValue(0)
    expect(outField()).toHaveValue(10)
    // Nothing was committed: one undo takes away the entry itself.
    await userEvent.click(screen.getByRole('button', { name: 'Undo last timeline edit' }))
    expect(trimButton()).toBeNull()
  })

  it('makes each clamp a named slider in seconds: ← → by the nudge size, Shift by the jump size', async () => {
    render(<App />)
    await addVideo()
    await openTrim()
    const clamp = inClamp()
    expect(clamp).toHaveAttribute('aria-valuenow', '0')
    expect(clamp).toHaveAttribute('aria-valuetext', '0:00.00 into the clip')
    fireEvent.keyDown(clamp, { key: 'ArrowRight' })
    expect(valueOf(clamp)).toBeCloseTo(STEP_SECONDS, 9)
    fireEvent.keyDown(clamp, { key: 'ArrowRight', shiftKey: true })
    expect(valueOf(clamp)).toBeCloseTo(STEP_SECONDS + LARGE_STEP_SECONDS, 9)
    fireEvent.keyDown(clamp, { key: 'ArrowLeft' })
    expect(valueOf(clamp)).toBeCloseTo(LARGE_STEP_SECONDS, 9)

    const out = outClamp()
    expect(out).toHaveAttribute('aria-valuenow', '10')
    fireEvent.keyDown(out, { key: 'ArrowLeft', shiftKey: true })
    expect(valueOf(out)).toBe(9)
    // The playhead follows the clamp that moved, as a drag's does.
    expect(within(dialog()).getByRole('status', { name: 'Trim window playhead' })).toHaveTextContent(
      '0:09.00',
    )
  })

  it('keeps the clamps apart by the minimum, by keyboard and by the fields', async () => {
    render(<App />)
    await addVideo()
    await openTrim()
    fireEvent.keyDown(outClamp(), { key: 'Home' })
    expect(valueOf(outClamp())).toBeCloseTo(MIN_TRIM_LENGTH, 9)
    fireEvent.keyDown(inClamp(), { key: 'End' })
    // In cannot pass Out: it stays where it was, the minimum short of it.
    expect(valueOf(inClamp())).toBe(0)

    fireEvent.keyDown(outClamp(), { key: 'End' })
    const inBox = within(dialog()).getByRole('spinbutton', { name: 'In point to apply in seconds' })
    await userEvent.clear(inBox)
    await userEvent.type(inBox, '12{Enter}')
    expect(valueOf(inClamp())).toBeCloseTo(10 - MIN_TRIM_LENGTH, 9)
    const outBox = within(dialog()).getByRole('spinbutton', { name: 'Out point to apply in seconds' })
    await userEvent.clear(outBox)
    await userEvent.type(outBox, '0{Enter}')
    expect(valueOf(outClamp())).toBe(10)
    expect(valueOf(outClamp()) - valueOf(inClamp())).toBeGreaterThanOrEqual(MIN_TRIM_LENGTH - 1e-9)
  })

  it('sets a clamp at the playhead with I and O and with the Set buttons, and the I key never reaches the export mark', async () => {
    render(<App />)
    await addVideo()
    await openTrim()
    const window = dialog()
    const playhead = within(window).getByRole('status', { name: 'Trim window playhead' })
    // Out ⏭ puts the playhead at Out; thirty frames back from there…
    await userEvent.click(within(window).getByRole('button', { name: 'Out ⏭' }))
    for (let frame = 0; frame < 30; frame += 1) {
      await userEvent.click(within(window).getByRole('button', { name: 'Back one frame' }))
    }
    expect(playhead).toHaveTextContent('0:09.00')
    window.focus()
    await userEvent.keyboard('o')
    expect(valueOf(outClamp())).toBe(9)
    // …and ⏮ In, then forward: Set In here by its button.
    await userEvent.click(within(window).getByRole('button', { name: '⏮ In' }))
    for (let frame = 0; frame < 15; frame += 1) {
      await userEvent.click(within(window).getByRole('button', { name: 'Forward one frame' }))
    }
    expect(playhead).toHaveTextContent('0:00.50')
    await userEvent.click(within(window).getByRole('button', { name: 'Set In here (I)' }))
    expect(valueOf(inClamp())).toBe(0.5)

    // The I key, from further on.
    await userEvent.click(within(window).getByRole('button', { name: 'Forward one frame' }))
    window.focus()
    await userEvent.keyboard('i')
    expect(valueOf(inClamp())).toBeCloseTo(0.533, 9)
    // Typing an i into the window's own field types it, and sets nothing.
    const inBox = within(window).getByRole('spinbutton', { name: 'In point to apply in seconds' })
    inBox.focus()
    await userEvent.keyboard('i')
    expect(valueOf(inClamp())).toBeCloseTo(0.533, 9)

    await userEvent.keyboard('{Escape}')
    // The sequence's marks were never set behind the window.
    expect(screen.queryByRole('button', { name: /Marks/ })).toBeNull()
  })

  it('pauses the playing preview as it opens, the sequence or a source clip, and closing does not resume it (#722)', async () => {
    render(<App />)
    await addVideo()
    await userEvent.click(screen.getByRole('button', { name: 'Play preview' }))
    expect(screen.getByRole('button', { name: 'Pause preview' })).toBeInTheDocument()
    await openTrim()
    expect(screen.getByRole('button', { name: 'Play preview' })).toBeInTheDocument()
    expect((screen.getByTestId('preview-video') as HTMLVideoElement).paused).toBe(true)
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Play preview' })).toBeInTheDocument()

    // A source clip playing in the preview panel (#403) is stopped too.
    await userEvent.click(screen.getByRole('button', { name: 'Preview a.mp4' }))
    await userEvent.click(screen.getByRole('button', { name: 'Play source' }))
    expect(screen.getByRole('button', { name: 'Pause source' })).toBeInTheDocument()
    await openTrim()
    expect(screen.getByRole('button', { name: 'Play source' })).toBeInTheDocument()
    expect((screen.getByTestId('source-video') as HTMLVideoElement).paused).toBe(true)
  })

  it('Space plays and pauses Play trim from the window, but not from a button that has the focus', async () => {
    render(<App />)
    await addVideo()
    const window = await openTrim()
    await userEvent.keyboard(' ')
    expect(within(window).getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    await userEvent.keyboard(' ')
    expect(within(window).getByRole('button', { name: 'Play trim' })).toBeInTheDocument()
    // On a focused button, Space is that button's own key.
    within(window).getByRole('button', { name: '↻ Loop' }).focus()
    fireEvent.keyDown(document.activeElement!, { key: ' ' })
    expect(within(window).getByRole('button', { name: 'Play trim' })).toBeInTheDocument()
  })
})
