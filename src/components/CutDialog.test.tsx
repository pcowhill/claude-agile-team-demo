import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { probeMediaFile } from '../lib/probeMedia'
import { PLAY_CUT_LEAD } from '../lib/cutWindow'
import { ADD_SLATE, chooseFromAddMenu } from '../test/timelineMenu'
import { chooseClipAction } from '../test/clipMenu'

vi.mock('../lib/probeMedia', () => ({
  probeMediaFile: vi.fn(),
}))

// jsdom has no Web Audio or blob fetch: the peaks decode is mocked, as the
// Trim and Split windows' tests do, so the strip's waveform renders.
vi.mock('../lib/audioPeaks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/audioPeaks')>()
  return {
    ...actual,
    peaksForClip: vi.fn(() => Promise.resolve(new Float32Array([0.2, 0.8, 0.5, 0.3]))),
  }
})

const probeMock = vi.mocked(probeMediaFile)

/**
 * Cut… on an audio track and a video overlay (#828), through <App/>:
 * offered between Trim… and Split… on both and not on an image overlay,
 * the track's window without a picture, and Apply leaving two rows with
 * the part gone and the later one closed up behind the earlier, with no
 * confirmation since nothing else moves, as one undo step. The window in a
 * real browser is `e2e/cut-element.spec.ts`'s.
 */
describe('Cut… on an audio track and a video overlay (#828)', () => {
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
  const cutButton = (element: string) =>
    screen.queryByRole('button', { name: `Cut a part out of ${element} in the Cut window` })
  const trimButton = (element: string) =>
    screen.getByRole('button', { name: `Trim ${element} in the Trim window` })
  const splitButton = (element: string) =>
    screen.getByRole('button', { name: `Split ${element} in the Split window` })

  async function importClip(name: string, probed: Awaited<ReturnType<typeof probeMediaFile>>, type: string) {
    probeMock.mockResolvedValueOnce(probed)
    await userEvent.upload(screen.getByTestId('clip-file-input'), new File(['content'], name, { type }))
    await screen.findByText(name)
  }

  it('on an audio track: no picture, and Apply removes the part, the later part closing up, as one undo step', async () => {
    const TRACK = 'audio track music.mp3 at position 1'
    const SECOND = 'audio track music.mp3 at position 2'
    render(<App />)
    await importClip('music.mp3', { duration: 30, url: 'blob:music.mp3', kind: 'audio' }, 'audio/mpeg')
    await userEvent.click(screen.getByRole('button', { name: 'Add music.mp3 to timeline' }))
    await userEvent.clear(fieldsOf(TRACK).start)
    await userEvent.type(fieldsOf(TRACK).start, '4{Enter}')

    // Trim… Cut… Split…, the customer's order, in the row that holds In and Out.
    const button = cutButton(TRACK)
    expect(button).toHaveTextContent('Cut…')
    expect(trimButton(TRACK).nextElementSibling).toBe(button)
    expect(button!.nextElementSibling).toBe(splitButton(TRACK))
    await userEvent.click(button!)
    const window = screen.getByRole('dialog', { name: `Cut ${TRACK}` })
    expect(window).toHaveAttribute('aria-modal', 'true')
    expect(window.querySelector('video')).toBeNull()
    expect(within(window).getByTestId('cut-audio').tagName).toBe('AUDIO')
    expect(await within(window).findByTestId('trim-waveform')).toBeInTheDocument()
    expect(within(window).queryByTestId('trim-frames')).toBeNull()
    expect(within(window).queryByRole('button', { name: 'Back one frame' })).toBeNull()
    expect(within(window).queryByRole('button', { name: 'Forward one frame' })).toBeNull()

    // The clamps open on the middle third: 10 → 20 s of the 30 s source.
    const from = within(window).getByRole('slider', { name: 'Cut from clamp' })
    const to = within(window).getByRole('slider', { name: 'Cut to clamp' })
    expect([from, to].map((clamp) => Number(clamp.getAttribute('aria-valuenow')))).toEqual([10, 20])
    // Home takes Cut from to In: a trim, so Apply is refused and says so.
    fireEvent.keyDown(from, { key: 'Home' })
    const apply = within(window).getByRole('button', { name: 'Apply' })
    expect(apply).toBeDisabled()
    expect(within(window).getByTestId('cut-status')).toHaveTextContent('Cut from is on In')
    await userEvent.click(apply)
    expect(screen.getByRole('dialog', { name: `Cut ${TRACK}` })).toBeInTheDocument()
    const fromField = within(window).getByRole('spinbutton', { name: 'Cut from in seconds' })
    await userEvent.clear(fromField)
    await userEvent.type(fromField, '10{Enter}')
    expect(apply).toBeEnabled()

    // Apply: no confirmation, since nothing besides the track changes.
    await userEvent.click(apply)
    expect(screen.queryByRole('dialog')).toBeNull()
    const head = fieldsOf(TRACK)
    const tail = fieldsOf(SECOND)
    expect([head.start, head.in, head.out].map((f) => Number((f as HTMLInputElement).value))).toEqual([4, 0, 10])
    // The tail starts where the head now ends: 4 + 10 s, not at 24 s.
    expect([tail.start, tail.in, tail.out].map((f) => Number((f as HTMLInputElement).value))).toEqual([14, 20, 30])
    // The sequence is untouched.
    expect(screen.getByTestId('timeline-total')).toHaveTextContent('0:00')

    await userEvent.click(screen.getByRole('button', { name: 'Undo last timeline edit' }))
    expect(cutButton(SECOND)).toBeNull()
    expect(fieldsOf(TRACK).out).toHaveValue(30)
    expect(fieldsOf(TRACK).start).toHaveValue(4)
  })

  it('on a video overlay: the picture, and Apply leaves two overlays closed up; an image overlay has none', async () => {
    const OVERLAY = 'overlay cam.mp4 at position 1'
    const SECOND = 'overlay cam.mp4 at position 2'
    render(<App />)
    await importClip('cam.mp4', { duration: 9, url: 'blob:cam.mp4', kind: 'video' }, 'video/mp4')
    await chooseClipAction('cam.mp4', 'Add as overlay')
    await importClip(
      'logo.png',
      { duration: 0, url: 'blob:logo.png', kind: 'image', width: 640, height: 480 },
      'image/png',
    )
    await chooseClipAction('logo.png', 'Add as overlay')
    expect(cutButton('overlay logo.png at position 2')).toBeNull()
    expect(screen.queryAllByRole('button', { name: /^Cut a part out of overlay .* in the Cut window$/ })).toHaveLength(1)

    await userEvent.clear(fieldsOf(OVERLAY).start)
    await userEvent.type(fieldsOf(OVERLAY).start, '3{Enter}')
    const button = cutButton(OVERLAY)
    expect(trimButton(OVERLAY).nextElementSibling).toBe(button)
    expect(button!.nextElementSibling).toBe(splitButton(OVERLAY))
    await userEvent.click(button!)
    const window = screen.getByRole('dialog', { name: `Cut ${OVERLAY}` })
    expect(within(window).getByTestId('cut-video')).toBeInTheDocument()
    expect(within(window).getByRole('button', { name: 'Back one frame' })).toBeInTheDocument()
    // The middle third of 9 s: 3 → 6.
    await userEvent.click(within(window).getByRole('button', { name: 'Apply' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    const head = fieldsOf(OVERLAY)
    // The image overlay was added after cam.mp4, so the tail sits between
    // them: it is listed right after the head.
    const tail = fieldsOf(SECOND)
    expect([head.start, head.in, head.out].map((f) => Number((f as HTMLInputElement).value))).toEqual([3, 0, 3])
    expect([tail.start, tail.in, tail.out].map((f) => Number((f as HTMLInputElement).value))).toEqual([6, 6, 9])
    expect(screen.getByRole('spinbutton', { name: 'Duration of overlay logo.png at position 3 in seconds' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Undo last timeline edit' }))
    expect(cutButton(SECOND)).toBeNull()
    expect(fieldsOf(OVERLAY).out).toHaveValue(9)
  })
})

/**
 * Cut… on a sequence entry (#827), through <App/>: offered between Trim…
 * and Split… on a video entry only, the window's clamps and their refusals,
 * ▶ Play cut skipping the removed part on a fake media element, and Apply
 * cutting the part out (asking first when a subtitle after it would move)
 * as one undo step. The window in a real browser is `e2e/cut-window.spec.ts`'s.
 */
describe('the Cut window on a sequence entry (#827)', () => {
  // A fake media clock: play, pause, paused and currentTime are the
  // element's own state here, so the window's tick can be driven by hand.
  const paused = new WeakMap<HTMLMediaElement, boolean>()
  const clock = new WeakMap<HTMLMediaElement, number>()
  let frames: FrameRequestCallback[] = []
  beforeEach(() => {
    probeMock.mockReset()
    frames = []
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
      paused.set(this, false)
      return Promise.resolve()
    })
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
      paused.set(this, true)
    })
    vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      return paused.get(this) ?? true
    })
    vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'get').mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      return clock.get(this) ?? 0
    })
    vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'set').mockImplementation(function (
      this: HTMLMediaElement,
      value: number,
    ) {
      clock.set(this, value)
    })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
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
  const cutButton = (entry = ENTRY) =>
    screen.queryByRole('button', { name: `Cut a part out of ${entry} in the Cut window` })
  const dialog = () => screen.getByRole('dialog', { name: `Cut ${ENTRY}` })
  const clamp = (which: 'from' | 'to') =>
    within(dialog()).getByRole('slider', { name: which === 'from' ? 'Cut from clamp' : 'Cut to clamp' })
  const clampAt = (which: 'from' | 'to') => Number(clamp(which).getAttribute('aria-valuenow'))
  const apply = () => within(dialog()).getByRole('button', { name: 'Apply' })
  const status = () => within(dialog()).getByTestId('cut-status')
  const video = () => within(dialog()).getByTestId('cut-video') as HTMLVideoElement

  async function addVideo(duration = 10) {
    probeMock.mockResolvedValueOnce({ duration, url: 'blob:a.mp4', kind: 'video' })
    await userEvent.upload(
      screen.getByTestId('clip-file-input'),
      new File(['content'], 'a.mp4', { type: 'video/mp4' }),
    )
    await screen.findByText('a.mp4')
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
  }

  async function trimTo(inPoint: number, outPoint: number) {
    await userEvent.clear(inField())
    await userEvent.type(inField(), `${inPoint}{Enter}`)
    await userEvent.clear(outField())
    await userEvent.type(outField(), `${outPoint}{Enter}`)
  }

  async function typeClamp(which: 'from' | 'to', at: number) {
    const field = within(dialog()).getByRole('spinbutton', {
      name: which === 'from' ? 'Cut from in seconds' : 'Cut to in seconds',
    })
    await userEvent.clear(field)
    await userEvent.type(field, `${at}{Enter}`)
  }

  /** Runs the frames the window has asked for, as a browser would on its next paint. */
  function runFrames() {
    const due = frames
    frames = []
    act(() => due.forEach((callback) => callback(0)))
  }

  it('is offered on a video entry between Trim… and Split…, and a still or a slate has none of the three', async () => {
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

    const trim = screen.getByRole('button', { name: `Trim ${ENTRY} in the Trim window` })
    const cut = cutButton()
    const split = screen.getByRole('button', { name: `Split ${ENTRY} in the Split window` })
    expect(cut).toHaveTextContent('Cut…')
    expect(cut).toHaveAttribute('aria-haspopup', 'dialog')
    // Trim… Cut… Split…, side by side on the In / Out line.
    expect(trim.nextElementSibling).toBe(cut)
    expect(cut!.nextElementSibling).toBe(split)
    expect(cut!.parentElement).toContainElement(inField())
    // Only the video entry has them: not the still, not the slate.
    expect(screen.queryAllByRole('button', { name: /in the Cut window$/ })).toHaveLength(1)
    expect(screen.queryAllByRole('button', { name: /in the Trim window$/ })).toHaveLength(1)
    expect(screen.queryAllByRole('button', { name: /in the Split window$/ })).toHaveLength(1)
  })

  it('opens as a modal dialog with the middle third shaded as removed', async () => {
    render(<App />)
    await addVideo()
    await trimTo(1, 7)
    await userEvent.click(cutButton()!)
    const window = dialog()
    expect(window).toHaveAttribute('aria-modal', 'true')
    expect(clampAt('from')).toBe(3)
    expect(clampAt('to')).toBe(5)
    expect(clamp('from')).toHaveAttribute('aria-valuemin', '1')
    expect(clamp('to')).toHaveAttribute('aria-valuemax', '7')
    // The removed part spans the clamps on the strip: 30% to 50% of 10 s.
    const removed = within(window).getByTestId('cut-removed')
    expect(removed.style.left).toBe('30%')
    expect(removed.style.width).toBe('calc(20%)')
    expect(within(window).getByTestId('cut-removed-length')).toHaveTextContent('removes 0:02.00')
    expect(await within(window).findByTestId('trim-waveform')).toBeInTheDocument()
    expect(apply()).toBeEnabled()
    expect(status()).toHaveTextContent('')
  })

  it.each([
    ['Cut from on In', 'from', 1, 'Cut from is on In'],
    ['Cut to on Out', 'to', 7, 'Cut to is on Out'],
    ['the clamps inverted', 'from', 6, 'Move Cut to after Cut from'],
    ['the clamps equal', 'from', 5, 'Move Cut to after Cut from'],
  ] as const)('disables Apply with %s, and says why', async (_, which, at, text) => {
    render(<App />)
    await addVideo()
    await trimTo(1, 7)
    await userEvent.click(cutButton()!)
    await typeClamp(which, at)
    expect(clampAt(which)).toBe(at)
    expect(apply()).toBeDisabled()
    expect(status()).toHaveTextContent(text)
    expect(within(dialog()).getByTestId('cut-removed')).toHaveClass('cut-strip-removed-refused')
    // Pressing it anyway does nothing: still one entry.
    await userEvent.click(apply())
    expect(cutButton(SECOND)).toBeNull()
  })

  it('▶ Play cut plays a lead-in up to Cut from, then jumps straight on from Cut to', async () => {
    render(<App />)
    await addVideo()
    await userEvent.click(cutButton()!)
    await typeClamp('from', 4)
    await typeClamp('to', 7)
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Play cut' }))
    expect(video().paused).toBe(false)
    expect(video().currentTime).toBe(4 - PLAY_CUT_LEAD)
    const readout = () => within(dialog()).getByRole('status', { name: 'Cut window playhead' })
    // Before Cut from it plays on.
    video().currentTime = 3.9
    runFrames()
    expect(readout()).toHaveTextContent('0:03.90')
    expect(video().currentTime).toBe(3.9)
    // At Cut from it jumps to Cut to, never showing the removed part.
    video().currentTime = 4.02
    runFrames()
    expect(video().currentTime).toBe(7)
    expect(readout()).toHaveTextContent('0:07.00')
    video().currentTime = 8.5
    runFrames()
    expect(video().currentTime).toBe(8.5)
    // At Out it stops.
    video().currentTime = 10
    runFrames()
    expect(video().paused).toBe(true)
    expect(within(dialog()).getByRole('button', { name: 'Play cut' })).toBeInTheDocument()
  })

  it('Apply cuts the part out: two entries meeting at the cut, the total shorter, one Undo restores it', async () => {
    render(<App />)
    await addVideo()
    expect(screen.getByTestId('timeline-total')).toHaveTextContent('0:10')
    await userEvent.click(cutButton()!)
    await typeClamp('from', 4)
    await typeClamp('to', 7)
    await userEvent.click(apply())

    // Nothing besides the entry moves, so it does not ask.
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(inField(ENTRY)).toHaveValue(0)
    expect(outField(ENTRY)).toHaveValue(4)
    expect(inField(SECOND)).toHaveValue(7)
    expect(outField(SECOND)).toHaveValue(10)
    expect(screen.getByTestId('timeline-total')).toHaveTextContent('0:07')

    await userEvent.click(screen.getByRole('button', { name: 'Undo last timeline edit' }))
    expect(cutButton(SECOND)).toBeNull()
    expect(outField()).toHaveValue(10)
    expect(screen.getByTestId('timeline-total')).toHaveTextContent('0:10')
  })

  it('asks first when a subtitle after the part would move, and moves it earlier on Cut out', async () => {
    render(<App />)
    await addVideo()
    await userEvent.upload(
      screen.getByTestId('subtitle-file-input'),
      new File(['1\n00:00:08,000 --> 00:00:09,000\nAfter the cut\n'], 'captions.srt', {
        type: 'application/x-subrip',
      }),
    )
    const subtitleStart = () =>
      screen.getByRole('spinbutton', { name: 'Start time of text overlay at position 1 in seconds' })
    expect(await screen.findByRole('spinbutton', {
      name: 'Start time of text overlay at position 1 in seconds',
    })).toHaveValue(8)

    await userEvent.click(cutButton()!)
    await typeClamp('from', 4)
    await typeClamp('to', 7)
    await userEvent.click(apply())
    const confirm = screen.getByRole('dialog', { name: 'Cut out this part?' })
    expect(confirm).toHaveTextContent('Removes 3 s. 1 subtitle after it moves earlier.')
    // Nothing has changed while it asks.
    expect(screen.getByTestId('timeline-total')).toHaveTextContent('0:10')
    expect(subtitleStart()).toHaveValue(8)

    await userEvent.click(within(confirm).getByRole('button', { name: 'Cut out' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTestId('timeline-total')).toHaveTextContent('0:07')
    expect(subtitleStart()).toHaveValue(5)
    expect(inField(SECOND)).toHaveValue(7)
  })

  it('Cancel on the confirmation leaves the project as it was', async () => {
    render(<App />)
    await addVideo()
    await userEvent.upload(
      screen.getByTestId('subtitle-file-input'),
      new File(['1\n00:00:08,000 --> 00:00:09,000\nAfter\n'], 'captions.srt', {
        type: 'application/x-subrip',
      }),
    )
    await screen.findByRole('spinbutton', { name: 'Start time of text overlay at position 1 in seconds' })
    await userEvent.click(cutButton()!)
    await userEvent.click(apply())
    const confirm = screen.getByRole('dialog', { name: 'Cut out this part?' })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(cutButton(SECOND)).toBeNull()
    expect(screen.getByTestId('timeline-total')).toHaveTextContent('0:10')
  })

  it('moves a clamp with ← → on it, Shift for the jump size, Home and End to In and Out; the picture follows', async () => {
    render(<App />)
    await addVideo()
    await trimTo(1, 7)
    await userEvent.click(cutButton()!)
    fireEvent.keyDown(clamp('to'), { key: 'ArrowRight' })
    expect(clampAt('to')).toBeGreaterThan(5)
    expect(video().currentTime).toBe(clampAt('to'))
    fireEvent.keyDown(clamp('from'), { key: 'Home' })
    expect(clampAt('from')).toBe(1)
    fireEvent.keyDown(clamp('to'), { key: 'End' })
    expect(clampAt('to')).toBe(7)
    expect(apply()).toBeDisabled()
  })

  it.each([
    ['Escape', () => userEvent.keyboard('{Escape}')],
    ['Cancel', () => userEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }))],
    ['✕', () => userEvent.click(within(dialog()).getByRole('button', { name: 'Close the Cut window without cutting' }))],
  ])('%s closes the window without cutting', async (_, close) => {
    render(<App />)
    await addVideo()
    await userEvent.click(cutButton()!)
    await close()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(cutButton(SECOND)).toBeNull()
    expect(screen.getByTestId('timeline-total')).toHaveTextContent('0:10')
  })
})
