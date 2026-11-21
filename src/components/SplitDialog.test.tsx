import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { probeMediaFile } from '../lib/probeMedia'
import { LARGE_STEP_SECONDS, STEP_SECONDS } from '../lib/transport'
import { TRIM_FRAME_STEP } from '../lib/trim'
import { ADD_SLATE, chooseFromAddMenu } from '../test/timelineMenu'
import { chooseClipAction } from '../test/clipMenu'

vi.mock('../lib/probeMedia', () => ({
  probeMediaFile: vi.fn(),
}))

// jsdom has no Web Audio or blob fetch: the peaks decode is mocked, as the
// Trim window's tests do, so the strip's waveform renders.
vi.mock('../lib/audioPeaks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/audioPeaks')>()
  return {
    ...actual,
    peaksForClip: vi.fn(() => Promise.resolve(new Float32Array([0.2, 0.8, 0.5, 0.3]))),
  }
})

const probeMock = vi.mocked(probeMediaFile)

/**
 * Split… on an audio track and a video overlay (#826), through <App/>:
 * offered after Trim… on both and not on an image overlay, the track's
 * window without a picture, and Apply making two rows whose In and Out meet
 * and whose start times are contiguous, as one undo step. The window in a
 * real browser is `e2e/split-element.spec.ts`'s.
 */
describe('Split… on an audio track and a video overlay (#826)', () => {
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

  const field = (label: string) => screen.getByRole('spinbutton', { name: label })
  const fieldsOf = (element: string) => ({
    start: field(`Start time of ${element} in seconds`),
    in: field(`Trim in point of ${element} in seconds`),
    out: field(`Trim out point of ${element} in seconds`),
  })
  const splitButton = (element: string) =>
    screen.queryByRole('button', { name: `Split ${element} in the Split window` })
  const trimButton = (element: string) =>
    screen.getByRole('button', { name: `Trim ${element} in the Trim window` })

  async function importClip(name: string, probed: Awaited<ReturnType<typeof probeMediaFile>>, type: string) {
    probeMock.mockResolvedValueOnce(probed)
    await userEvent.upload(screen.getByTestId('clip-file-input'), new File(['content'], name, { type }))
    await screen.findByText(name)
  }

  it('on an audio track: no picture, and Apply makes two tracks that meet, as one undo step', async () => {
    const TRACK = 'audio track music.mp3 at position 1'
    const SECOND = 'audio track music.mp3 at position 2'
    render(<App />)
    await importClip('music.mp3', { duration: 30, url: 'blob:music.mp3', kind: 'audio' }, 'audio/mpeg')
    await userEvent.click(screen.getByRole('button', { name: 'Add music.mp3 to timeline' }))
    await userEvent.clear(fieldsOf(TRACK).start)
    await userEvent.type(fieldsOf(TRACK).start, '4{Enter}')

    // After Trim… and Cut… (#828), in the row that holds In and Out.
    const button = splitButton(TRACK)
    expect(button).toHaveTextContent('Split…')
    expect(trimButton(TRACK).nextElementSibling?.nextElementSibling).toBe(button)
    await userEvent.click(button!)
    const window = screen.getByRole('dialog', { name: `Split ${TRACK}` })
    expect(window).toHaveAttribute('aria-modal', 'true')
    expect(window.querySelector('video')).toBeNull()
    expect(within(window).getByTestId('split-audio').tagName).toBe('AUDIO')
    expect(await within(window).findByTestId('trim-waveform')).toBeInTheDocument()
    expect(within(window).queryByTestId('trim-frames')).toBeNull()
    expect(within(window).queryByRole('button', { name: 'Back one frame' })).toBeNull()
    // Opens at the middle; ← moves it by the nudge size.
    const point = within(window).getByRole('slider', { name: 'Split point' })
    expect(Number(point.getAttribute('aria-valuenow'))).toBe(15)
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    const at = 15 - STEP_SECONDS
    expect(Number(point.getAttribute('aria-valuenow'))).toBeCloseTo(at, 9)

    await userEvent.click(within(window).getByRole('button', { name: 'Apply' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    const first = fieldsOf(TRACK)
    const second = fieldsOf(SECOND)
    expect(first.start).toHaveValue(4)
    expect(first.in).toHaveValue(0)
    expect(Number((first.out as HTMLInputElement).value)).toBeCloseTo(at, 3)
    expect(Number((second.in as HTMLInputElement).value)).toBeCloseTo(at, 3)
    expect(second.out).toHaveValue(30)
    expect(Number((second.start as HTMLInputElement).value)).toBeCloseTo(4 + at, 3)

    await userEvent.click(screen.getByRole('button', { name: 'Undo last timeline edit' }))
    expect(splitButton(SECOND)).toBeNull()
    expect(fieldsOf(TRACK).out).toHaveValue(30)
  })

  it('on a video overlay: the picture, and Apply makes two overlays that meet; an image overlay has none', async () => {
    const OVERLAY = 'overlay cam.mp4 at position 1'
    const SECOND = 'overlay cam.mp4 at position 2'
    render(<App />)
    await importClip('cam.mp4', { duration: 8, url: 'blob:cam.mp4', kind: 'video' }, 'video/mp4')
    await chooseClipAction('cam.mp4', 'Add as overlay')
    await importClip(
      'logo.png',
      { duration: 0, url: 'blob:logo.png', kind: 'image', width: 640, height: 480 },
      'image/png',
    )
    await chooseClipAction('logo.png', 'Add as overlay')
    expect(splitButton('overlay logo.png at position 2')).toBeNull()
    expect(screen.queryAllByRole('button', { name: /^Split overlay .* in the Split window$/ })).toHaveLength(1)

    await userEvent.clear(fieldsOf(OVERLAY).start)
    await userEvent.type(fieldsOf(OVERLAY).start, '3{Enter}')
    const button = splitButton(OVERLAY)
    expect(trimButton(OVERLAY).nextElementSibling?.nextElementSibling).toBe(button)
    await userEvent.click(button!)
    const window = screen.getByRole('dialog', { name: `Split ${OVERLAY}` })
    expect(within(window).getByTestId('split-video')).toBeInTheDocument()
    expect(within(window).getByRole('button', { name: 'Back one frame' })).toBeInTheDocument()
    await userEvent.click(within(window).getByRole('button', { name: 'Apply' }))

    const first = fieldsOf(OVERLAY)
    // The image overlay was added after cam.mp4, so the second part sits
    // between them: it is listed right after the first.
    const second = fieldsOf(SECOND)
    expect(first.start).toHaveValue(3)
    expect(first.in).toHaveValue(0)
    expect(first.out).toHaveValue(4)
    expect(second.in).toHaveValue(4)
    expect(second.out).toHaveValue(8)
    expect(second.start).toHaveValue(7)
    expect(screen.getByRole('spinbutton', { name: 'Duration of overlay logo.png at position 3 in seconds' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Undo last timeline edit' }))
    expect(splitButton(SECOND)).toBeNull()
    expect(fieldsOf(OVERLAY).out).toHaveValue(8)
  })
})

/**
 * Split… on a sequence entry (#825), through <App/>: offered after Trim…
 * on a video entry only, opening at the middle of the trimmed range, and
 * Apply splitting the entry there with Split at playhead's own action — one
 * undo step. Dragging on the strip and the window's geometry are
 * `e2e/split-window.spec.ts`'s.
 */
describe('the Split window (#825)', () => {
  const playSpy = vi.fn()
  beforeEach(() => {
    probeMock.mockReset()
    playSpy.mockReset()
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => {
      playSpy()
      return Promise.resolve()
    })
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.stubGlobal('requestAnimationFrame', () => 1)
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const ENTRY = 'a.mp4 at position 1'
  const SECOND = 'a.mp4 at position 2'
  const inField = (entry = ENTRY) =>
    screen.getByRole('spinbutton', { name: `Trim in point of ${entry} in seconds` })
  const outField = (entry = ENTRY) =>
    screen.getByRole('spinbutton', { name: `Trim out point of ${entry} in seconds` })
  const splitButton = (entry = ENTRY) =>
    screen.queryByRole('button', { name: `Split ${entry} in the Split window` })
  const dialog = () => screen.getByRole('dialog', { name: `Split ${ENTRY}` })
  const point = () => within(dialog()).getByRole('slider', { name: 'Split point' })
  const pointAt = () => Number(point().getAttribute('aria-valuenow'))
  const apply = () => within(dialog()).getByRole('button', { name: 'Apply' })
  const pointField = () => within(dialog()).getByRole('spinbutton', { name: 'Split point in seconds' })

  async function addVideo(duration = 10) {
    probeMock.mockResolvedValueOnce({ duration, url: 'blob:a.mp4', kind: 'video' })
    await userEvent.upload(
      screen.getByTestId('clip-file-input'),
      new File(['content'], 'a.mp4', { type: 'video/mp4' }),
    )
    await screen.findByText('a.mp4')
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
  }

  /** Sets the entry's own trim from its row, before the window opens. */
  async function trimTo(inPoint: number, outPoint: number) {
    await userEvent.clear(inField())
    await userEvent.type(inField(), `${inPoint}{Enter}`)
    await userEvent.clear(outField())
    await userEvent.type(outField(), `${outPoint}{Enter}`)
  }

  async function typePoint(at: number) {
    await userEvent.clear(pointField())
    await userEvent.type(pointField(), `${at}{Enter}`)
  }

  it('is offered on a video entry right after Trim…, and never on a still or a slate', async () => {
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

    const button = splitButton()
    expect(button).toHaveTextContent('Split…')
    expect(button).toHaveAttribute('aria-haspopup', 'dialog')
    // On the In / Out line, after Trim… and Cut… (#827): Trim… Cut… Split…,
    // the customer's order.
    const trim = screen.getByRole('button', { name: `Trim ${ENTRY} in the Trim window` })
    expect(button!.parentElement).toContainElement(inField())
    expect(trim.nextElementSibling?.nextElementSibling).toBe(button)
    // Only the video entry has one: not the still, not the slate.
    expect(splitButton('logo.png at position 2')).toBeNull()
    expect(screen.queryAllByRole('button', { name: /in the Split window$/ })).toHaveLength(1)
  })

  it('opens as a modal dialog at the middle of the trimmed range, the strip showing In and Out', async () => {
    render(<App />)
    await addVideo()
    await trimTo(2, 7)
    await userEvent.click(splitButton()!)
    const window = dialog()
    expect(window).toHaveAttribute('aria-modal', 'true')
    expect(pointAt()).toBe(4.5)
    expect(point()).toHaveAttribute('aria-valuemin', '2')
    expect(point()).toHaveAttribute('aria-valuemax', '7')
    expect(within(window).getByTestId('split-parts')).toHaveTextContent('First part 0:02.50 · second part 0:02.50')
    expect(await within(window).findByTestId('trim-waveform')).toBeInTheDocument()
    expect(apply()).toBeEnabled()
  })

  it('Apply splits the entry at the point: the two halves meet there, the total is unchanged, and one Undo restores it', async () => {
    render(<App />)
    await addVideo()
    await trimTo(2, 7)
    const total = screen.getByTestId('timeline-total').textContent
    await userEvent.click(splitButton()!)
    await typePoint(3.25)
    expect(pointAt()).toBe(3.25)
    await userEvent.click(apply())

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(inField(ENTRY)).toHaveValue(2)
    expect(outField(ENTRY)).toHaveValue(3.25)
    expect(inField(SECOND)).toHaveValue(3.25)
    expect(outField(SECOND)).toHaveValue(7)
    expect(screen.getByTestId('timeline-total').textContent).toBe(total)

    await userEvent.click(screen.getByRole('button', { name: 'Undo last timeline edit' }))
    expect(screen.queryByRole('spinbutton', { name: `Trim in point of ${SECOND} in seconds` })).toBeNull()
    expect(inField()).toHaveValue(2)
    expect(outField()).toHaveValue(7)
  })

  it.each([
    ['on In', 2, 2],
    ['on Out', 7, 7],
    ['before In (held to In)', 0.5, 2],
    ['past Out (held to Out)', 9, 7],
  ])('disables Apply with the point %s', async (_, typed, held) => {
    render(<App />)
    await addVideo()
    await trimTo(2, 7)
    await userEvent.click(splitButton()!)
    await typePoint(typed)
    expect(pointAt()).toBe(held)
    expect(apply()).toBeDisabled()
    expect(within(dialog()).getByTestId('split-parts')).toHaveTextContent('cannot split on In or Out')
    // Pressing it anyway does nothing: still one entry.
    await userEvent.click(apply())
    expect(splitButton(SECOND)).toBeNull()
  })

  it('disables Apply inside a transition at either end of the entry, where Split at playhead is disabled too', async () => {
    render(<App />)
    await addVideo()
    // The same clip again, and a 1 s crossfade between the two: the
    // overlap is the first entry's source [9, 10) and the second's [0, 1).
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add transition between position 1 and 2' }))
    expect(screen.getByTestId('timeline-total')).toHaveTextContent('0:19')

    const windowOf = (entry: string) => screen.getByRole('dialog', { name: `Split ${entry}` })
    const tryPoint = async (entry: string, at: number) => {
      const field = within(windowOf(entry)).getByRole('spinbutton', { name: 'Split point in seconds' })
      await userEvent.clear(field)
      await userEvent.type(field, `${at}{Enter}`)
      return within(windowOf(entry)).getByRole('button', { name: 'Apply' })
    }

    await userEvent.click(splitButton()!)
    // Inside the crossfade out of the first entry, from its start on.
    for (const at of [9.5, 9]) {
      expect(await tryPoint(ENTRY, at), `at ${at}`).toBeDisabled()
      expect(within(windowOf(ENTRY)).getByTestId('split-parts')).toHaveTextContent(
        'cannot split inside a transition',
      )
    }
    expect(await tryPoint(ENTRY, 8.9)).toBeEnabled()
    await userEvent.click(within(windowOf(ENTRY)).getByRole('button', { name: 'Cancel' }))

    await userEvent.click(splitButton(SECOND)!)
    // Inside the crossfade into the second entry; its end is the second
    // entry's alone, and splits.
    expect(await tryPoint(SECOND, 0.5)).toBeDisabled()
    expect(within(windowOf(SECOND)).getByTestId('split-parts')).toHaveTextContent(
      'cannot split inside a transition',
    )
    await userEvent.click(await tryPoint(SECOND, 1))
    // The split there leaves the crossfade and the length as they were.
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(inField('a.mp4 at position 3')).toHaveValue(1)
    expect(screen.getByTestId('timeline-total')).toHaveTextContent('0:19')
  })

  it('moves the point by the nudge size with ← →, by the jump size with Shift, held to the trimmed range', async () => {
    render(<App />)
    await addVideo()
    await trimTo(2, 7)
    await userEvent.click(splitButton()!)
    // From the window itself, where the focus opens.
    fireEvent.keyDown(dialog(), { key: 'ArrowRight' })
    expect(pointAt()).toBeCloseTo(4.5 + STEP_SECONDS, 9)
    fireEvent.keyDown(dialog(), { key: 'ArrowLeft', shiftKey: true })
    expect(pointAt()).toBeCloseTo(4.5 + STEP_SECONDS - LARGE_STEP_SECONDS, 9)
    // And from the slider.
    fireEvent.keyDown(point(), { key: 'ArrowLeft', shiftKey: true })
    fireEvent.keyDown(point(), { key: 'ArrowLeft', shiftKey: true })
    fireEvent.keyDown(point(), { key: 'ArrowLeft', shiftKey: true })
    expect(pointAt()).toBe(2)
    // A field being typed in keeps its own arrows.
    const before = pointAt()
    fireEvent.keyDown(pointField(), { key: 'ArrowRight' })
    expect(pointAt()).toBe(before)
  })

  it('steps the point a frame with ◀ frame and frame ▶', async () => {
    render(<App />)
    await addVideo()
    await userEvent.click(splitButton()!)
    // Opens at 5, a frame-grid time.
    expect(pointAt()).toBe(5)
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Forward one frame' }))
    expect(pointAt()).toBeCloseTo(5 + TRIM_FRAME_STEP, 3)
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Back one frame' }))
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Back one frame' }))
    expect(pointAt()).toBeCloseTo(5 - TRIM_FRAME_STEP, 3)
  })

  it('Space plays from the window; Escape closes it and changes nothing', async () => {
    render(<App />)
    await addVideo()
    await userEvent.click(splitButton()!)
    fireEvent.keyDown(dialog(), { key: ' ' })
    expect(playSpy).toHaveBeenCalledTimes(1)
    expect(within(dialog()).getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    fireEvent.keyDown(dialog(), { key: ' ' })
    expect(within(dialog()).getByRole('button', { name: 'Play from the split point' })).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(splitButton(SECOND)).toBeNull()
    // Nothing was committed: one undo takes away the entry itself.
    await userEvent.click(screen.getByRole('button', { name: 'Undo last timeline edit' }))
    expect(splitButton()).toBeNull()
  })

  it.each([
    ['Cancel', () => userEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }))],
    ['✕', () => userEvent.click(within(dialog()).getByRole('button', { name: 'Close the Split window without splitting' }))],
  ])('%s closes the window without splitting', async (_, close) => {
    render(<App />)
    await addVideo()
    await userEvent.click(splitButton()!)
    await close()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(splitButton(SECOND)).toBeNull()
  })
})
