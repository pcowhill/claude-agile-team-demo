import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
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
const region1 = 'Spotlight region 1'

const field = (name: string) => screen.getByRole('spinbutton', { name })
const regionField = (position: string, which: string, label: string) =>
  field(`${which} ${label} of ${position} (percent)`)
const addButton = (position: string) =>
  screen.getByRole('button', { name: `Add a spotlight region on ${position}` })
const adjustButton = (position: string, which = region1) =>
  screen.getByRole('button', { name: `Adjust ${which} of ${position} visually` })
const editorFor = (position: string, which = region1) =>
  screen.getByRole('dialog', { name: `Adjust ${which} of ${position}` })
const handles = () => screen.getByTestId('frame-editor-handles')
const region = () => screen.getByTestId('frame-editor-rect')
const shade = () => screen.getByTestId('frame-editor-shade')
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

/**
 * The visual spotlight editor (#533) in jsdom: what it renders the still
 * from, what it commits, and what it draws for each shape. It is the
 * redaction editor (#493) over a spotlight, so the geometry cases that
 * suite already pins — the orientation mapping, the snap zones, the key
 * steps — are not repeated here; what is asserted is what this editor adds
 * and where it must agree with the row's own fields.
 */
// The editors are lazy chunks (#537); loaded once here, they render
// synchronously below, so a test can open one and read it on the next line.
beforeAll(preloadVisualEditors)

describe('visual spotlight editor (#533)', () => {
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

  it('opens on the element’s whole source, uncropped and regionless, with the outside shaded', async () => {
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
      within(dialog).getByRole('button', { name: `Close the spotlight editor for ${entry}` }),
    ).toHaveFocus()

    // The still: the element alone, its regions and crop left off, over the
    // whole source rather than its trim.
    expect(snapshotMock).toHaveBeenCalledTimes(1)
    const [timeline, sequenceTime] = snapshotMock.mock.calls[0] as [TimelineState, number]
    expect(timeline.entries).toHaveLength(1)
    expect(timeline.entries[0].url).toBe('blob:base.png')
    expect(timeline.entries[0].spotlights).toBeUndefined()
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
    // down, 30 × 20 % of a 400 × 225 frame — and, unlike a redaction, the
    // outside IS shaded, cut to the rectangle, because that is the effect.
    expect(region()).toHaveAttribute('x', '140')
    expect(region()).toHaveAttribute('y', '90')
    expect(region()).toHaveAttribute('width', '120')
    expect(region()).toHaveAttribute('height', '45')
    expect(shade()).toHaveAttribute('data-hole', 'rect')
    expect(screen.queryByTestId('frame-editor-silhouette')).toBeNull()
    // A free rectangle: corners and edges both.
    expect(screen.getByTestId('frame-editor-corner-se')).toBeInTheDocument()
    expect(screen.getByTestId('frame-editor-edge-w')).toBeInTheDocument()

    // The same button closes it.
    await userEvent.click(adjustButton(entry))
    expect(screen.queryByRole('dialog', { name: `Adjust ${region1} of ${entry}` })).toBeNull()
  })

  it('draws an oval region as the ellipse inscribed in its box, with the box’s corners shaded', async () => {
    render(<App />)
    await placeClips()
    await openPicture(entry)
    await userEvent.click(addButton(entry))
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: `${region1} shape of ${entry}` }),
      'oval',
    )
    await userEvent.click(adjustButton(entry))

    // The handles stay on the box; the silhouette and the shade's hole are
    // the ellipse it inscribes — centre (200, 112.5), radii 60 × 22.5.
    expect(region()).toHaveAttribute('x', '140')
    expect(region()).toHaveAttribute('width', '120')
    const silhouette = screen.getByTestId('frame-editor-silhouette')
    expect(silhouette).toHaveAttribute('data-shape', 'ellipse')
    expect(silhouette).toHaveAttribute('cx', '200')
    expect(silhouette).toHaveAttribute('cy', '112.5')
    expect(silhouette).toHaveAttribute('rx', '60')
    expect(silhouette).toHaveAttribute('ry', '22.5')
    expect(shade()).toHaveAttribute('data-hole', 'ellipse')
    // The hole is drawn as two arcs from the ellipse's left extreme, so the
    // shade's path carries the ellipse's own numbers, not the rectangle's.
    expect(shade().getAttribute('d')).toContain('M140 112.5a60 22.5 0 1 0 120 0')
    expect(editorFor(entry)).toHaveTextContent(/a square box draws a circle/)

    // Switching the shape back in the row re-cuts the shade to the box.
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: `${region1} shape of ${entry}` }),
      'rectangle',
    )
    expect(shade()).toHaveAttribute('data-hole', 'rect')
    expect(screen.queryByTestId('frame-editor-silhouette')).toBeNull()
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

  it('a drag moves the region with the readout following live, commits one undo step, and leaves the shape, dim and soften alone', async () => {
    render(<App />)
    await placeClips()
    await openPicture(entry)
    await userEvent.click(addButton(entry))
    // A softened oval, so the drag has something to leave alone.
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: `${region1} shape of ${entry}` }),
      'oval',
    )
    fireEvent.change(regionField(entry, region1, 'soften'), { target: { value: '20' } })
    fireEvent.blur(regionField(entry, region1, 'soften'))
    await userEvent.click(adjustButton(entry))

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
    // The window, shape, dim and soften rode along untouched.
    expect(field(`${region1} start of ${entry} in seconds`)).toHaveValue(0)
    expect(screen.getByRole('combobox', { name: `${region1} shape of ${entry}` })).toHaveValue(
      'oval',
    )
    expect(regionField(entry, region1, 'dim')).toHaveValue(55)
    expect(regionField(entry, region1, 'soften')).toHaveValue(20)

    // One gesture, one undo step, though the pointer moved on the way.
    await userEvent.click(undoButton())
    expect(regionField(entry, region1, 'left')).toHaveValue(35)
    expect(regionField(entry, region1, 'top')).toHaveValue(40)
    expect(regionField(entry, region1, 'soften')).toHaveValue(20)
  })

  it('a corner resizes both dimensions and an edge one, at the region’s own floor', async () => {
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

    // The east edge alone.
    drag(screen.getByTestId('frame-editor-edge-e'), { x: 260, y: 112 }, { x: 320, y: 150 })
    expect(regionField(entry, region1, 'width')).toHaveValue(45)
    expect(regionField(entry, region1, 'height')).toHaveValue(20)
  })

  it('draws the element’s other regions as inert outlines, one editor at a time', async () => {
    render(<App />)
    await placeClips()
    await openPicture(entry)
    await userEvent.click(addButton(entry))
    await userEvent.click(addButton(entry))
    const region2 = 'Spotlight region 2'
    fireEvent.change(regionField(entry, region2, 'left'), { target: { value: '10' } })
    fireEvent.blur(regionField(entry, region2, 'left'))
    await userEvent.click(adjustButton(entry))

    const outlines = screen.getAllByTestId('frame-editor-outline')
    expect(outlines).toHaveLength(1)
    expect(outlines[0]).toHaveAttribute('x', '40')
    expect(outlines[0]).toHaveAttribute('width', '120')
    expect(region()).toHaveAttribute('x', '140')

    // A drag on the outline is a drag on nothing: neither region moves.
    drag(outlines[0], { x: 100, y: 112 }, { x: 60, y: 60 })
    expect(regionField(entry, region2, 'left')).toHaveValue(10)
    expect(regionField(entry, region1, 'left')).toHaveValue(35)

    await userEvent.click(adjustButton(entry, region2))
    expect(screen.queryByRole('dialog', { name: `Adjust ${region1} of ${entry}` })).toBeNull()
    expect(editorFor(entry, region2)).toBeInTheDocument()
  })

  it('scrubs the region’s window, and Show result lights the regions through the export’s painter', async () => {
    render(<App />)
    await placeClips()
    await openPicture(entry)
    await userEvent.click(addButton(entry))
    // A window of 1 → 3 s on the 5 s still, softened.
    fireEvent.change(field(`${region1} start of ${entry} in seconds`), { target: { value: '1' } })
    fireEvent.blur(field(`${region1} start of ${entry} in seconds`))
    fireEvent.change(field(`${region1} end of ${entry} in seconds`), { target: { value: '3' } })
    fireEvent.blur(field(`${region1} end of ${entry} in seconds`))
    fireEvent.change(regionField(entry, region1, 'soften'), { target: { value: '10' } })
    fireEvent.blur(regionField(entry, region1, 'soften'))
    await userEvent.click(adjustButton(entry))
    const dialog = editorFor(entry)
    const slider = within(dialog).getByRole('slider', {
      name: `Preview time of ${region1} of ${entry} in seconds`,
    })
    const renderedTimes = () => snapshotMock.mock.calls.map((call) => call[1] as number)

    expect(slider).toHaveAttribute('min', '1')
    expect(slider).toHaveAttribute('max', '3')
    expect(slider).toHaveValue('2')
    expect(renderedTimes()).toEqual([2])
    fireEvent.change(slider, { target: { value: '1.5' } })
    expect(liveReadout(region1, 'preview time')).toHaveTextContent('1.50 s')
    expect(renderedTimes()).toEqual([2, 1.5])

    // Show result: the snapshot's timeline carries the regions — soft edge
    // included — so drawSpotlights paints them, and there is no rectangle
    // or shade to drag over the result.
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Show result' }))
    const last = snapshotMock.mock.calls.at(-1) as [TimelineState, number]
    expect(last[0].entries[0].spotlights).toHaveLength(1)
    expect(last[0].entries[0].spotlights?.[0]).toMatchObject({
      start: 1,
      end: 3,
      shape: 'rectangle',
      dim: 0.55,
      soften: 0.1,
    })
    expect(last[1]).toBe(1.5)
    expect(screen.queryByTestId('frame-editor-rect')).toBeNull()
    expect(screen.queryByTestId('frame-editor-shade')).toBeNull()
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
      screen.queryByRole('button', { name: /Adjust Spotlight region 1 of .* visually/ }),
    ).not.toBeInTheDocument()
    // The region's own fields and Remove are untouched by the setting.
    expect(regionField(entry, region1, 'soften')).toBeInTheDocument()
    expect(snapshotMock).not.toHaveBeenCalled()
  })
})
