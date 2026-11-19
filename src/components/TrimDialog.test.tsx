import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { probeMediaFile } from '../lib/probeMedia'
import { LARGE_STEP_SECONDS, STEP_SECONDS } from '../lib/transport'
import { MIN_TRIM_LENGTH } from '../lib/trim'
import { ADD_SLATE, chooseFromAddMenu } from '../test/timelineMenu'
import { chooseClipAction } from '../test/clipMenu'
import { ADD_ZOOM, chooseEffect } from '../test/timelineRowMenu'

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
 * The Trim window on an audio track (#711), through <App/>: offered on the
 * lane's rows, with no picture, and Apply dispatching the track's own trim.
 * Play trim on the sound, and the strip's geometry, are
 * `e2e/trim-window-audio.spec.ts`'s.
 */
describe('the Trim window on an audio track (#711)', () => {
  beforeEach(() => {
    probeMock.mockReset()
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.stubGlobal('requestAnimationFrame', () => 1)
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const TRACK = 'audio track music.mp3 at position 1'
  const field = (which: 'in' | 'out') =>
    screen.getByRole('spinbutton', { name: `Trim ${which} point of ${TRACK} in seconds` })
  const startField = () => screen.getByRole('spinbutton', { name: `Start time of ${TRACK} in seconds` })
  const trimButton = (name = TRACK) => screen.queryByRole('button', { name: `Trim ${name} in the Trim window` })
  const dialog = () => screen.getByRole('dialog', { name: `Trim ${TRACK}` })

  async function addClip(name: string, kind: 'audio' | 'video', duration: number) {
    probeMock.mockResolvedValueOnce({ duration, url: `blob:${name}`, kind })
    const type = kind === 'audio' ? 'audio/mpeg' : 'video/mp4'
    await userEvent.upload(screen.getByTestId('clip-file-input'), new File(['content'], name, { type }))
    await screen.findByText(name)
    await userEvent.click(screen.getByRole('button', { name: `Add ${name} to timeline` }))
  }

  it('is offered on an audio track beside its In and Out, and opens with no picture: the strip is the waveform', async () => {
    render(<App />)
    await addClip('music.mp3', 'audio', 30)
    const button = trimButton()
    expect(button).toHaveTextContent('Trim…')
    expect(button!.parentElement).toContainElement(field('in'))
    expect(button!.parentElement).toContainElement(field('out'))

    await userEvent.click(button!)
    const window = dialog()
    expect(window).toHaveAttribute('aria-modal', 'true')
    // No picture: an <audio> element plays it, and there is no <video>.
    expect(window.querySelector('video')).toBeNull()
    expect(within(window).getByTestId('trim-audio').tagName).toBe('AUDIO')
    // The strip is the waveform alone: no frame row, and no frames to step.
    expect(await within(window).findByTestId('trim-waveform')).toBeInTheDocument()
    expect(within(window).queryByTestId('trim-frames')).toBeNull()
    expect(within(window).queryByRole('button', { name: 'Back one frame' })).toBeNull()
    expect(within(window).queryByRole('button', { name: 'Forward one frame' })).toBeNull()
    // A track has no effects to mark, so no warning line.
    expect(within(window).queryByTestId('trim-warning')).toBeNull()
    expect(within(window).getByRole('button', { name: 'Play trim' })).toBeInTheDocument()
  })

  it('Apply after moving the Out clamp changes the track’s Out and nothing else, as one undo step', async () => {
    render(<App />)
    await addClip('music.mp3', 'audio', 30)
    await userEvent.clear(startField())
    await userEvent.type(startField(), '4{Enter}')
    await userEvent.click(trimButton()!)
    const outClamp = within(dialog()).getByRole('slider', { name: 'Out clamp' })
    expect(Number(outClamp.getAttribute('aria-valuenow'))).toBe(30)
    fireEvent.keyDown(outClamp, { key: 'ArrowLeft', shiftKey: true })
    fireEvent.keyDown(outClamp, { key: 'ArrowLeft', shiftKey: true })
    expect(Number(outClamp.getAttribute('aria-valuenow'))).toBe(30 - 2 * LARGE_STEP_SECONDS)
    // Not yet: the clamps are the window's own until Apply.
    expect(field('out')).toHaveValue(30)

    await userEvent.click(within(dialog()).getByRole('button', { name: 'Apply' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(field('out')).toHaveValue(30 - 2 * LARGE_STEP_SECONDS)
    expect(field('in')).toHaveValue(0)
    expect(startField()).toHaveValue(4)

    // One undo restores the trim, and only the trim: the start time set the
    // step before is kept.
    await userEvent.click(screen.getByRole('button', { name: 'Undo last timeline edit' }))
    expect(field('out')).toHaveValue(30)
    expect(field('in')).toHaveValue(0)
    expect(startField()).toHaveValue(4)
  })

  it('is one window at a time across the sequence and the lane: each row opens its own', async () => {
    render(<App />)
    await addClip('a.mp4', 'video', 10)
    await addClip('music.mp3', 'audio', 30)
    expect(screen.queryAllByRole('button', { name: /in the Trim window$/ })).toHaveLength(2)
    await userEvent.click(trimButton()!)
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(dialog()).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(trimButton('a.mp4 at position 1')!)
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    // The entry's window has its picture.
    expect(within(screen.getByRole('dialog', { name: 'Trim a.mp4 at position 1' })).getByTestId('trim-video')).toBeInTheDocument()
  })
})

/**
 * The Trim window on a video overlay (#711), through <App/>: offered on a
 * video overlay's row and not an image overlay's, Apply dispatching the
 * overlay's own update, and the overlay's own zooms marked and warned of.
 * The window in a real browser is `e2e/trim-window-overlay.spec.ts`'s.
 */
describe('the Trim window on a video overlay (#711)', () => {
  beforeEach(() => {
    probeMock.mockReset()
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.stubGlobal('requestAnimationFrame', () => 1)
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const OVERLAY = 'overlay cam.mp4 at position 1'
  const field = (label: string) => screen.getByRole('spinbutton', { name: label })
  const inField = () => field(`Trim in point of ${OVERLAY} in seconds`)
  const outField = () => field(`Trim out point of ${OVERLAY} in seconds`)
  const startField = () => field(`Start time of ${OVERLAY} in seconds`)
  const leftField = () => field(`Left edge of ${OVERLAY} (fraction of frame width)`)
  const trimButton = (name = OVERLAY) => screen.queryByRole('button', { name: `Trim ${name} in the Trim window` })
  const dialog = () => screen.getByRole('dialog', { name: `Trim ${OVERLAY}` })

  async function importClip(name: string, probed: Awaited<ReturnType<typeof probeMediaFile>>, type: string) {
    probeMock.mockResolvedValueOnce(probed)
    await userEvent.upload(screen.getByTestId('clip-file-input'), new File(['content'], name, { type }))
    await screen.findByText(name)
  }

  async function addOverlay() {
    render(<App />)
    await importClip('cam.mp4', { duration: 8, url: 'blob:cam.mp4', kind: 'video' }, 'video/mp4')
    await chooseClipAction('cam.mp4', 'Add as overlay')
  }

  it('is offered on a video overlay beside its In and Out, and not on an image overlay', async () => {
    await addOverlay()
    const button = trimButton()
    expect(button).toHaveTextContent('Trim…')
    expect(button!.parentElement).toContainElement(inField())
    expect(button!.parentElement).toContainElement(outField())

    await importClip(
      'logo.png',
      { duration: 0, url: 'blob:logo.png', kind: 'image', width: 640, height: 480 },
      'image/png',
    )
    await chooseClipAction('logo.png', 'Add as overlay')
    expect(screen.getByRole('spinbutton', { name: 'Duration of overlay logo.png at position 2 in seconds' })).toBeInTheDocument()
    expect(trimButton('overlay logo.png at position 2')).toBeNull()
    // Two overlays, one Trim…: the image overlay's window is its Length.
    expect(screen.queryAllByRole('button', { name: /^Trim overlay .* in the Trim window$/ })).toHaveLength(1)

    await userEvent.click(button!)
    // The full window: the overlay's own source, with its picture.
    expect(within(dialog()).getByTestId('trim-video')).toBeInTheDocument()
    expect(within(dialog()).getByRole('button', { name: 'Back one frame' })).toBeInTheDocument()
  })

  it('Apply after moving the Out clamp changes the overlay’s Out and nothing else, as one undo step', async () => {
    await addOverlay()
    await userEvent.clear(startField())
    await userEvent.type(startField(), '3{Enter}')
    const left = Number(leftField().getAttribute('value'))
    await userEvent.click(trimButton()!)
    const outClamp = within(dialog()).getByRole('slider', { name: 'Out clamp' })
    expect(Number(outClamp.getAttribute('aria-valuenow'))).toBe(8)
    fireEvent.keyDown(outClamp, { key: 'ArrowLeft', shiftKey: true })
    expect(Number(outClamp.getAttribute('aria-valuenow'))).toBe(8 - LARGE_STEP_SECONDS)
    // Not yet: the clamps are the window's own until Apply.
    expect(outField()).toHaveValue(8)

    await userEvent.click(within(dialog()).getByRole('button', { name: 'Apply' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(outField()).toHaveValue(8 - LARGE_STEP_SECONDS)
    expect(inField()).toHaveValue(0)
    expect(startField()).toHaveValue(3)
    expect(leftField()).toHaveValue(left)

    // One undo restores the trim, and only the trim.
    await userEvent.click(screen.getByRole('button', { name: 'Undo last timeline edit' }))
    expect(outField()).toHaveValue(8)
    expect(inField()).toHaveValue(0)
    expect(startField()).toHaveValue(3)
  })

  it('marks the overlay’s own zoom on the strip, and warns before a trim cuts into it', async () => {
    await addOverlay()
    await chooseEffect(OVERLAY, ADD_ZOOM)
    await userEvent.click(trimButton()!)
    // At the current trim: the zoom is marked, and nothing is cut.
    const marks = within(dialog()).getAllByTestId('trim-effect-mark')
    expect(marks).toHaveLength(1)
    expect(marks[0]).toHaveAttribute('data-kind', 'zoom')
    expect(marks[0]).toHaveAttribute('title', 'Zoom 1')
    // The status line is there, kept for its announcements, and says nothing.
    expect(within(dialog()).getByTestId('trim-warning')).toBeEmptyDOMElement()
    expect(within(dialog()).queryByTestId(/^trim-transition-/)).toBeNull()

    // Out as far left as it goes: the default zoom starts at the overlay's
    // start, so it no longer fits whole, and the window says so.
    fireEvent.keyDown(within(dialog()).getByRole('slider', { name: 'Out clamp' }), { key: 'Home' })
    expect(within(dialog()).getByTestId('trim-warning')).toHaveTextContent('Trimming here shortens Zoom 1.')
    expect(within(dialog()).getAllByTestId('trim-effect-mark')).toHaveLength(1)

    // Cancel: nothing changed, and the zoom's fields are as they were.
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }))
    expect(outField()).toHaveValue(8)
  })
})

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
