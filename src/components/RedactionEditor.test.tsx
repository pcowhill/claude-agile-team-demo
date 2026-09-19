import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { preloadVisualEditors } from './visualEditors'
import { probeMediaFile } from '../lib/probeMedia'
import { snapshotTimelineFrame } from '../lib/frameSnapshot'
import type { TimelineState } from '../lib/timeline'
import { chooseFromFileMenu } from '../test/fileMenu'
import { chooseClipAction } from '../test/clipMenu'
import { openPicture } from '../test/pictureDisclosure'

vi.mock('../lib/probeMedia', () => ({
  probeMediaFile: vi.fn(),
}))

// The still is the export's own draw (#237); jsdom has no canvas, so the
// snapshot is stubbed and what it was asked to render is what is asserted.
vi.mock('../lib/frameSnapshot', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/frameSnapshot')>()),
  snapshotTimelineFrame: vi.fn(),
}))

const probeMock = vi.mocked(probeMediaFile)
const snapshotMock = vi.mocked(snapshotTimelineFrame)

/** The frame's laid-out box: 400 × 225 at the origin, so 0.01 is 4 px across. */
const FRAME = { x: 0, y: 0, width: 400, height: 225 }

const entry = 'base.png at position 1'
const overlay = 'overlay cam.png at position 1'
const region1 = 'Redaction region 1'

const field = (name: string) => screen.getByRole('spinbutton', { name })
const regionField = (position: string, which: string, label: string) =>
  field(`${which} ${label} of ${position} (percent)`)
const addButton = (position: string) =>
  screen.getByRole('button', { name: `Add a redaction region on ${position}` })
const adjustButton = (position: string, which = region1) =>
  screen.getByRole('button', { name: `Adjust ${which} of ${position} visually` })
const editorFor = (position: string, which = region1) =>
  screen.getByRole('dialog', { name: `Adjust ${which} of ${position}` })
const handles = () => screen.getByTestId('frame-editor-handles')
const region = () => screen.getByTestId('frame-editor-rect')
const undoButton = () => screen.getByRole('button', { name: 'Undo last timeline edit' })
const liveReadout = (which: string, label: string) =>
  screen.getByRole('status', { name: `${which} ${label} (live)` })

/** A base image entry, plus a square still overlaid on it. */
async function placeClips() {
  probeMock.mockResolvedValueOnce({
    duration: 0,
    url: 'blob:base.png',
    kind: 'image',
    width: 320,
    height: 180,
  })
  await userEvent.upload(
    screen.getByTestId('clip-file-input'),
    new File(['base'], 'base.png', { type: 'image/png' }),
    { applyAccept: false },
  )
  await screen.findByText('base.png')
  await userEvent.click(screen.getByRole('button', { name: 'Add base.png to timeline' }))

  probeMock.mockResolvedValueOnce({
    duration: 0,
    url: 'blob:cam.png',
    kind: 'image',
    width: 240,
    height: 240,
  })
  await userEvent.upload(
    screen.getByTestId('clip-file-input'),
    new File(['cam'], 'cam.png', { type: 'image/png' }),
    { applyAccept: false },
  )
  await screen.findByText('cam.png')
  await chooseClipAction('cam.png', 'Add as overlay')
}

/** Opens a row's Picture disclosure, adds one region and opens its editor. */
async function openRegionEditor(position: string) {
  await openPicture(position)
  await userEvent.click(addButton(position))
  await userEvent.click(adjustButton(position))
  return editorFor(position)
}

/** A pointer drag on the handle layer, from one point to another, in px. */
const drag = (
  target: Element,
  from: { x: number; y: number },
  to: { x: number; y: number },
  modifiers: { shiftKey?: boolean; altKey?: boolean } = {},
) => {
  fireEvent.pointerDown(target, { pointerId: 1, button: 0, clientX: from.x, clientY: from.y })
  fireEvent.pointerMove(handles(), { pointerId: 1, clientX: to.x, clientY: to.y, ...modifiers })
  fireEvent.pointerUp(handles(), { pointerId: 1, clientX: to.x, clientY: to.y, ...modifiers })
}

// The editors are lazy chunks (#537); loaded once here, they render
// synchronously below, so a test can open one and read it on the next line.
beforeAll(preloadVisualEditors)

describe('visual redaction editor (#493)', () => {
  beforeEach(() => {
    probeMock.mockReset()
    snapshotMock.mockReset()
    snapshotMock.mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:frame-still'),
      revokeObjectURL: vi.fn(),
    })
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      ...FRAME,
      top: FRAME.y,
      left: FRAME.x,
      right: FRAME.x + FRAME.width,
      bottom: FRAME.y + FRAME.height,
      toJSON: () => ({}),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('opens on the element’s whole source, uncropped and regionless, in the middle of the region’s window', async () => {
    render(<App />)
    await placeClips()
    await openPicture(entry)
    await userEvent.click(addButton(entry))
    expect(adjustButton(entry)).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(adjustButton(entry))
    expect(adjustButton(entry)).toHaveAttribute('aria-expanded', 'true')

    const dialog = editorFor(entry)
    expect(within(dialog).getByRole('img', { name: `${region1} area of ${entry}` })).toBeInTheDocument()
    expect(
      within(dialog).getByRole('button', { name: `Close the redaction editor for ${entry}` }),
    ).toHaveFocus()

    // The still: the element alone, its regions and crop left off, over the
    // whole source rather than its trim, so a source second is a sequence
    // second and the slider's value goes straight to the snapshot.
    expect(snapshotMock).toHaveBeenCalledTimes(1)
    const [timeline, sequenceTime] = snapshotMock.mock.calls[0] as [TimelineState, number]
    expect(timeline.entries).toHaveLength(1)
    expect(timeline.entries[0].url).toBe('blob:base.png')
    expect(timeline.entries[0].redactions).toBeUndefined()
    expect(timeline.entries[0].crop).toBeUndefined()
    expect(timeline.entries[0].inPoint).toBe(0)
    expect(timeline.videoOverlays).toBeUndefined()
    // A new region's window is the 5 s still's whole trim, so its middle is 2.5 s.
    expect(sequenceTime).toBeCloseTo(2.5, 6)
    const slider = within(dialog).getByRole('slider', {
      name: `Preview time of ${region1} of ${entry} in seconds`,
    })
    expect(slider).toHaveAttribute('min', '0')
    expect(slider).toHaveAttribute('max', '5')
    expect(slider).toHaveValue('2.5')

    // The default region, drawn where its fields say: 35 % across, 40 %
    // down, 30 × 20 % of a 400 × 225 frame — and nothing shaded around it.
    expect(region()).toHaveAttribute('x', '140')
    expect(region()).toHaveAttribute('y', '90')
    expect(region()).toHaveAttribute('width', '120')
    expect(region()).toHaveAttribute('height', '45')
    expect(handles().querySelector('.frame-editor-shade')).toBeNull()
    // A free rectangle: corners and edges both.
    expect(screen.getByTestId('frame-editor-corner-se')).toBeInTheDocument()
    expect(screen.getByTestId('frame-editor-edge-w')).toBeInTheDocument()

    // The same button closes it.
    await userEvent.click(adjustButton(entry))
    expect(screen.queryByRole('dialog', { name: `Adjust ${region1} of ${entry}` })).toBeNull()
  })

  it('opens for an overlay on the overlay’s own source, not inside its placement rectangle', async () => {
    render(<App />)
    await placeClips()
    await openRegionEditor(overlay)
    const [timeline] = snapshotMock.mock.calls[0] as [TimelineState, number]
    expect(timeline.videoOverlays).toBeUndefined()
    expect(timeline.entries).toHaveLength(1)
    expect(timeline.entries[0].url).toBe('blob:cam.png')
    expect(region()).toHaveAttribute('width', '120')
  })

  it('a drag moves the region with the readout following live, and commits one undo step', async () => {
    render(<App />)
    await placeClips()
    await openRegionEditor(entry)

    // From the region's centre, a fifth of the frame up and left.
    fireEvent.pointerDown(region(), { pointerId: 1, button: 0, clientX: 200, clientY: 112 })
    fireEvent.pointerMove(handles(), { pointerId: 1, clientX: 120, clientY: 67 })
    // Mid-gesture the readout follows and nothing is committed yet.
    expect(liveReadout(region1, 'left')).toHaveTextContent('15')
    expect(liveReadout(region1, 'top')).toHaveTextContent('20')
    expect(regionField(entry, region1, 'left')).toHaveValue(35)

    fireEvent.pointerUp(handles(), { pointerId: 1, clientX: 120, clientY: 67 })
    expect(regionField(entry, region1, 'left')).toHaveValue(15)
    expect(regionField(entry, region1, 'top')).toHaveValue(20)
    // A move is not a resize.
    expect(regionField(entry, region1, 'width')).toHaveValue(30)
    expect(regionField(entry, region1, 'height')).toHaveValue(20)
    // The window and style rode along untouched.
    expect(field(`${region1} start of ${entry} in seconds`)).toHaveValue(0)
    expect(screen.getByRole('combobox', { name: `${region1} style of ${entry}` })).toHaveValue(
      'pixelate',
    )

    // One gesture, one undo step, though the pointer moved on the way.
    await userEvent.click(undoButton())
    expect(regionField(entry, region1, 'left')).toHaveValue(35)
    expect(regionField(entry, region1, 'top')).toHaveValue(40)
  })

  it('a corner resizes both dimensions, Shift keeps the proportions, and an edge one dimension', async () => {
    render(<App />)
    await placeClips()
    await openRegionEditor(entry)

    // The south-east corner sits at (260, 135); dragged to 75 % across and
    // 70 % down the region becomes 40 × 30 %.
    drag(screen.getByTestId('frame-editor-corner-se'), { x: 260, y: 135 }, { x: 300, y: 157.5 })
    expect(regionField(entry, region1, 'width')).toHaveValue(40)
    expect(regionField(entry, region1, 'height')).toHaveValue(30)
    expect(regionField(entry, region1, 'left')).toHaveValue(35)
    await userEvent.click(undoButton())
    expect(regionField(entry, region1, 'width')).toHaveValue(30)

    // Shift: the pointer asks for 45 × 50 %; the 3:2 lock gives 45 × 30 %.
    drag(
      screen.getByTestId('frame-editor-corner-se'),
      { x: 260, y: 135 },
      { x: 320, y: 202.5 },
      { shiftKey: true },
    )
    expect(regionField(entry, region1, 'width')).toHaveValue(45)
    expect(regionField(entry, region1, 'height')).toHaveValue(30)
    await userEvent.click(undoButton())

    // The east edge alone.
    drag(screen.getByTestId('frame-editor-edge-e'), { x: 260, y: 112 }, { x: 320, y: 150 })
    expect(regionField(entry, region1, 'width')).toHaveValue(45)
    expect(regionField(entry, region1, 'height')).toHaveValue(20)
  })

  it('snaps onto the frame’s centre with a guide, and Alt leaves the region where it was dragged', async () => {
    render(<App />)
    await placeClips()
    await openRegionEditor(entry)

    // Parked in the top-left first, so there is somewhere to snap from.
    fireEvent.change(regionField(entry, region1, 'left'), { target: { value: '10' } })
    fireEvent.blur(regionField(entry, region1, 'left'))
    fireEvent.change(regionField(entry, region1, 'top'), { target: { value: '10' } })
    fireEvent.blur(regionField(entry, region1, 'top'))
    expect(region()).toHaveAttribute('x', '40')

    // A move landing a hundredth short of centred: within the snap zone.
    fireEvent.pointerDown(region(), { pointerId: 1, button: 0, clientX: 100, clientY: 45 })
    fireEvent.pointerMove(handles(), { pointerId: 1, clientX: 196, clientY: 110 })
    expect(screen.getByTestId('frame-editor-guide-x')).toHaveAttribute('x1', '200')
    expect(screen.getByTestId('frame-editor-guide-y')).toHaveAttribute('y1', '112.5')
    fireEvent.pointerUp(handles(), { pointerId: 1, clientX: 196, clientY: 110 })
    expect(regionField(entry, region1, 'left')).toHaveValue(35)
    expect(regionField(entry, region1, 'top')).toHaveValue(40)
    expect(screen.queryByTestId('frame-editor-guide-x')).toBeNull()
    await userEvent.click(undoButton())

    // The same drag with Alt held commits the raw position.
    drag(region(), { x: 100, y: 45 }, { x: 196, y: 110 }, { altKey: true })
    expect(regionField(entry, region1, 'left')).toHaveValue(34)
    expect(regionField(entry, region1, 'top')).toHaveValue(38.89)
  })

  it('edits the stored edge the turned picture shows, on a rotated and cropped clip', async () => {
    render(<App />)
    await placeClips()
    await openPicture(entry)
    // A quarter turn clockwise brings the source's left edge up to the top,
    // and a crop on the right, which the still ignores — a region names
    // source pixels before both (#492).
    await userEvent.click(
      screen.getByRole('button', {
        name: `Rotate ${entry} 90 degrees clockwise (currently 0 degrees)`,
      }),
    )
    fireEvent.change(field(`Crop right of ${entry} (percent)`), { target: { value: '20' } })
    fireEvent.blur(field(`Crop right of ${entry} (percent)`))
    await userEvent.click(addButton(entry))
    await userEvent.click(adjustButton(entry))

    const [timeline] = snapshotMock.mock.calls[0] as [TimelineState, number]
    expect(timeline.entries[0].orientation).toEqual({ rotation: 90 })
    expect(timeline.entries[0].crop).toBeUndefined()

    // Turned, the stored left of 35 % is the displayed top, and the stored
    // top of 40 % is the displayed right margin: the rectangle sits at
    // x = 1 − 0.4 − 0.2, y = 0.35, 20 % wide and 30 % tall.
    expect(region()).toHaveAttribute('x', '160')
    expect(region()).toHaveAttribute('y', '78.75')
    expect(region()).toHaveAttribute('width', '80')
    expect(region()).toHaveAttribute('height', '67.5')

    // Dragging the north edge down by a tenth of the frame edits `left`.
    drag(screen.getByTestId('frame-editor-edge-n'), { x: 200, y: 78.75 }, { x: 200, y: 101.25 })
    expect(regionField(entry, region1, 'left')).toHaveValue(45)
    expect(regionField(entry, region1, 'width')).toHaveValue(20)
    expect(regionField(entry, region1, 'top')).toHaveValue(40)
    expect(regionField(entry, region1, 'height')).toHaveValue(20)
    // And the readout says so too, rather than quietly renaming the edge.
    expect(liveReadout(region1, 'left')).toHaveTextContent('45')
    expect(editorFor(entry)).toHaveTextContent(/The picture is shown turned/)
  })

  it('nudges with the keyboard, one undo step each, and Escape closes', async () => {
    render(<App />)
    await placeClips()
    await openRegionEditor(entry)

    region().focus()
    expect(region()).toHaveFocus()
    fireEvent.keyDown(region(), { key: 'ArrowLeft' })
    expect(regionField(entry, region1, 'left')).toHaveValue(34)
    fireEvent.keyDown(region(), { key: 'ArrowLeft', shiftKey: true })
    expect(regionField(entry, region1, 'left')).toHaveValue(29)
    fireEvent.keyDown(region(), { key: '+' })
    expect(regionField(entry, region1, 'width')).toHaveValue(32)

    await userEvent.click(undoButton())
    expect(regionField(entry, region1, 'width')).toHaveValue(30)
    await userEvent.click(undoButton())
    expect(regionField(entry, region1, 'left')).toHaveValue(34)
    await userEvent.click(undoButton())
    expect(regionField(entry, region1, 'left')).toHaveValue(35)

    region().focus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: `Adjust ${region1} of ${entry}` })).toBeNull()
  })

  it('draws the element’s other regions as inert outlines', async () => {
    render(<App />)
    await placeClips()
    await openPicture(entry)
    await userEvent.click(addButton(entry))
    await userEvent.click(addButton(entry))
    const region2 = 'Redaction region 2'
    fireEvent.change(regionField(entry, region2, 'left'), { target: { value: '10' } })
    fireEvent.blur(regionField(entry, region2, 'left'))
    await userEvent.click(adjustButton(entry))

    const outlines = screen.getAllByTestId('frame-editor-outline')
    expect(outlines).toHaveLength(1)
    expect(outlines[0]).toHaveAttribute('x', '40')
    expect(outlines[0]).toHaveAttribute('width', '120')
    // The edited region is the first one, drawn where its own fields say.
    expect(region()).toHaveAttribute('x', '140')

    // A drag on the outline is a drag on nothing: neither region moves.
    drag(outlines[0], { x: 100, y: 112 }, { x: 60, y: 60 })
    expect(regionField(entry, region2, 'left')).toHaveValue(10)
    expect(regionField(entry, region1, 'left')).toHaveValue(35)

    // Opening the second region's editor closes the first: one at a time.
    await userEvent.click(adjustButton(entry, region2))
    expect(screen.queryByRole('dialog', { name: `Adjust ${region1} of ${entry}` })).toBeNull()
    expect(editorFor(entry, region2)).toBeInTheDocument()
    expect(screen.getAllByTestId('frame-editor-outline')[0]).toHaveAttribute('x', '140')
  })

  it('scrubs the region’s window, loops it with the slider following, and Show result draws the regions', async () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const now = vi.spyOn(performance, 'now')
    now.mockReturnValue(0)

    render(<App />)
    await placeClips()
    await openPicture(entry)
    await userEvent.click(addButton(entry))
    // A window of 1 → 3 s on the 5 s still.
    fireEvent.change(field(`${region1} start of ${entry} in seconds`), { target: { value: '1' } })
    fireEvent.blur(field(`${region1} start of ${entry} in seconds`))
    fireEvent.change(field(`${region1} end of ${entry} in seconds`), { target: { value: '3' } })
    fireEvent.blur(field(`${region1} end of ${entry} in seconds`))
    await userEvent.click(adjustButton(entry))
    const dialog = editorFor(entry)
    const slider = within(dialog).getByRole('slider', {
      name: `Preview time of ${region1} of ${entry} in seconds`,
    })
    const renderedTimes = () => snapshotMock.mock.calls.map((call) => call[1] as number)

    // The slider spans the window and opened in its middle.
    expect(slider).toHaveAttribute('min', '1')
    expect(slider).toHaveAttribute('max', '3')
    expect(slider).toHaveValue('2')
    expect(renderedTimes()).toEqual([2])
    fireEvent.change(slider, { target: { value: '1.5' } })
    expect(liveReadout(region1, 'preview time')).toHaveTextContent('1.50 s')
    expect(renderedTimes()).toEqual([2, 1.5])

    // Loop: the window's first frame at once, the slider read-only, and the
    // clock carrying it forward after the opening rest.
    const loop = within(dialog).getByRole('button', {
      name: `Loop the window of ${region1} of ${entry}`,
    })
    fireEvent.click(loop)
    expect(loop).toHaveAttribute('aria-pressed', 'true')
    expect(slider).toBeDisabled()
    expect(slider).toHaveValue('1')
    // 1.5 s on the clock: past the opening rest, half a second into the
    // window, on the slider's grid. Wrapped in act so the tick's state lands.
    now.mockReturnValue(1500)
    const due = frames.splice(0)
    expect(due.length).toBeGreaterThan(0)
    act(() => {
      for (const tick of due) tick(1500)
    })
    expect(slider).toHaveValue('1.5')
    fireEvent.click(loop)
    expect(slider).toBeEnabled()
    expect(slider).toHaveValue('1.5')

    // Show result: the snapshot draws the regions through the export's own
    // painter, and there is no rectangle to drag over the result.
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Show result' }))
    const last = snapshotMock.mock.calls.at(-1) as [TimelineState, number]
    expect(last[0].entries[0].redactions).toHaveLength(1)
    expect(last[0].entries[0].redactions?.[0]).toMatchObject({ start: 1, end: 3, style: 'pixelate' })
    expect(last[1]).toBe(1.5)
    expect(screen.queryByTestId('frame-editor-rect')).toBeNull()
    expect(dialog).toHaveTextContent(/Turn Show result off/)
  })

  it('is hidden when the Visual editors setting is off, rendering no frame', async () => {
    render(<App />)
    await placeClips()
    await openPicture(entry)
    await userEvent.click(addButton(entry))
    expect(adjustButton(entry)).toBeInTheDocument()

    await chooseFromFileMenu('Settings…')
    const dialog = screen.getByRole('dialog', { name: 'Settings' })
    await userEvent.selectOptions(within(dialog).getByLabelText('Visual editors'), 'off')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }))

    expect(
      screen.queryByRole('button', { name: /Adjust Redaction region 1 of .* visually/ }),
    ).not.toBeInTheDocument()
    // The region's own fields and Remove are untouched by the setting.
    expect(regionField(entry, region1, 'left')).toBeInTheDocument()
    expect(snapshotMock).not.toHaveBeenCalled()
  })
})
