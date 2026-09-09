import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { probeMediaFile } from '../lib/probeMedia'
import { snapshotTimelineFrame } from '../lib/frameSnapshot'
import { MIN_KEPT_FRACTION } from '../lib/crop'
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

const field = (name: string) => screen.getByRole('spinbutton', { name })
const cropField = (position: string, edge: string) =>
  field(`Crop ${edge} of ${position} (percent)`)
const adjustButton = (position: string) =>
  screen.getByRole('button', { name: `Adjust the crop of ${position} visually` })
const editorFor = (position: string) =>
  screen.getByRole('dialog', { name: `Adjust the crop of ${position}` })
const handles = () => screen.getByTestId('frame-editor-handles')
const region = () => screen.getByTestId('frame-editor-rect')
const undoButton = () => screen.getByRole('button', { name: 'Undo last timeline edit' })

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

/** Opens a row's Picture disclosure and then its crop editor. */
async function openCropEditor(position: string) {
  await openPicture(position)
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

describe('visual crop editor (#423)', () => {
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

  it('opens for an entry on its own source, uncropped and alone, at its window midpoint', async () => {
    render(<App />)
    await placeClips()
    await openPicture(entry)
    expect(adjustButton(entry)).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(adjustButton(entry))
    expect(adjustButton(entry)).toHaveAttribute('aria-expanded', 'true')

    const dialog = editorFor(entry)
    expect(within(dialog).getByRole('img', { name: `${entry} kept region` })).toBeInTheDocument()
    expect(
      within(dialog).getByRole('button', { name: `Close the crop editor for ${entry}` }),
    ).toHaveFocus()

    // The bypass the issue asks for, asserted where it actually happens: the
    // timeline handed to the snapshot carries no crop on the element, and
    // nothing else at all — no overlay, no canvas preset — so the source
    // fills the frame and a crop fraction is a frame fraction.
    expect(snapshotMock).toHaveBeenCalledTimes(1)
    const [timeline, sequenceTime] = snapshotMock.mock.calls[0] as [TimelineState, number]
    expect(timeline.entries).toHaveLength(1)
    expect(timeline.entries[0].crop).toBeUndefined()
    expect(timeline.entries[0].url).toBe('blob:base.png')
    expect(timeline.videoOverlays).toBeUndefined()
    expect(timeline.canvasPreset).toBeUndefined()
    // A 5 s still's window is [0, 5], so its middle is 2.5 s.
    expect(sequenceTime).toBeCloseTo(2.5, 6)

    // Nothing trimmed yet, so the kept region is the whole frame.
    expect(region()).toHaveAttribute('x', '0')
    expect(region()).toHaveAttribute('width', '400')
  })

  it('opens for an overlay on the overlay’s own source, not on its placement rectangle', async () => {
    render(<App />)
    await placeClips()
    await openCropEditor(overlay)
    const [timeline] = snapshotMock.mock.calls[0] as [TimelineState, number]
    // Drawn as an overlay it would occupy about a third of the frame, and
    // its own picture would letterbox inside even that.
    expect(timeline.videoOverlays).toBeUndefined()
    expect(timeline.entries).toHaveLength(1)
    expect(timeline.entries[0].url).toBe('blob:cam.png')
    expect(region()).toHaveAttribute('width', '400')
  })

  it('a left-edge drag updates the field live and commits one undo step', async () => {
    render(<App />)
    await placeClips()
    await openCropEditor(entry)

    // The west edge sits at x = 0; dragged to 25 % of 400 px it trims a
    // quarter off the left.
    fireEvent.pointerDown(screen.getByTestId('frame-editor-edge-w'), {
      pointerId: 1,
      button: 0,
      clientX: 0,
      clientY: 112,
    })
    fireEvent.pointerMove(handles(), { pointerId: 1, clientX: 100, clientY: 112 })
    // Mid-gesture the readout follows and nothing is committed yet.
    expect(
      within(editorFor(entry)).getByRole('status', { name: `${entry} crop left (live)` }),
    ).toHaveTextContent('25')
    expect(cropField(entry, 'left')).toHaveValue(0)

    fireEvent.pointerUp(handles(), { pointerId: 1, clientX: 100, clientY: 112 })
    expect(cropField(entry, 'left')).toHaveValue(25)
    // Only that edge: the other three are untouched.
    expect(cropField(entry, 'right')).toHaveValue(0)
    expect(cropField(entry, 'top')).toHaveValue(0)
    expect(cropField(entry, 'bottom')).toHaveValue(0)

    // One gesture, one undo step, though several moves crossed the frame.
    await userEvent.click(undoButton())
    expect(cropField(entry, 'left')).toHaveValue(0)
  })

  it('Shift trims the opposite edge as far, and Alt gives finer than whole percents', async () => {
    render(<App />)
    await placeClips()
    await openCropEditor(entry)

    drag(screen.getByTestId('frame-editor-edge-w'), { x: 0, y: 112 }, { x: 40, y: 112 }, {
      shiftKey: true,
    })
    expect(cropField(entry, 'left')).toHaveValue(10)
    expect(cropField(entry, 'right')).toHaveValue(10)
    expect(cropField(entry, 'top')).toHaveValue(0)

    await userEvent.click(undoButton())
    expect(cropField(entry, 'left')).toHaveValue(0)

    // 37 px of 400 is 9.25 %, which the snap would tidy to 9.
    drag(screen.getByTestId('frame-editor-edge-w'), { x: 0, y: 112 }, { x: 37, y: 112 })
    expect(cropField(entry, 'left')).toHaveValue(9)
    await userEvent.click(undoButton())
    drag(screen.getByTestId('frame-editor-edge-w'), { x: 0, y: 112 }, { x: 37, y: 112 }, {
      altKey: true,
    })
    expect(cropField(entry, 'left')).toHaveValue(9.25)
  })

  it('edges cannot cross: a handle dragged past its opposite stops at the kept floor', async () => {
    render(<App />)
    await placeClips()
    await openCropEditor(entry)

    // Dragged well past the right-hand edge of the frame.
    drag(screen.getByTestId('frame-editor-edge-w'), { x: 0, y: 112 }, { x: 900, y: 112 })
    const left = (cropField(entry, 'left') as HTMLInputElement).valueAsNumber
    expect(left).toBeCloseTo((1 - MIN_KEPT_FRACTION) * 100, 6)
    expect(cropField(entry, 'right')).toHaveValue(0)
    // The region is still on the frame and still the floor's width.
    expect(Number(region().getAttribute('width'))).toBeCloseTo(MIN_KEPT_FRACTION * 400, 6)
  })

  it('drags the edge the picture shows, which on a turned clip is a different stored one', async () => {
    render(<App />)
    await placeClips()
    await openPicture(entry)
    // A quarter turn clockwise brings the source's left edge up to the top,
    // so the handle on top of the picture trims `left` (#255's order of
    // operations: crop applies in source space, before orientation).
    await userEvent.click(screen.getByRole('button', {
      name: `Rotate ${entry} 90 degrees clockwise (currently 0 degrees)`,
    }))
    await userEvent.click(adjustButton(entry))

    drag(screen.getByTestId('frame-editor-edge-n'), { x: 200, y: 0 }, { x: 200, y: 45 })
    expect(cropField(entry, 'left')).toHaveValue(20)
    expect(cropField(entry, 'top')).toHaveValue(0)
    // And the readout says so too, rather than quietly renaming the edge.
    expect(
      within(editorFor(entry)).getByRole('status', { name: `${entry} crop left (live)` }),
    ).toHaveTextContent('20')
  })

  it('nudges and resizes with the keyboard, one undo step each, and Escape closes', async () => {
    render(<App />)
    await placeClips()
    await openCropEditor(entry)
    // Something to nudge: the whole frame has nowhere to pan to.
    drag(screen.getByTestId('frame-editor-edge-w'), { x: 0, y: 112 }, { x: 80, y: 112 })
    expect(cropField(entry, 'left')).toHaveValue(20)

    region().focus()
    expect(region()).toHaveFocus()
    fireEvent.keyDown(region(), { key: 'ArrowLeft' })
    expect(cropField(entry, 'left')).toHaveValue(19)
    fireEvent.keyDown(region(), { key: 'ArrowLeft', shiftKey: true })
    expect(cropField(entry, 'left')).toHaveValue(14)

    await userEvent.click(undoButton())
    expect(cropField(entry, 'left')).toHaveValue(19)
    await userEvent.click(undoButton())
    expect(cropField(entry, 'left')).toHaveValue(20)

    region().focus()
    await userEvent.keyboard('{Escape}')
    expect(
      screen.queryByRole('dialog', { name: `Adjust the crop of ${entry}` }),
    ).not.toBeInTheDocument()
  })

  it('resets from the panel exactly as the row’s own Reset does', async () => {
    render(<App />)
    await placeClips()
    await openCropEditor(entry)
    const reset = within(editorFor(entry)).getByRole('button', {
      name: `Reset crop of ${entry} in the editor`,
    })
    expect(reset).toBeDisabled()

    drag(screen.getByTestId('frame-editor-edge-s'), { x: 200, y: 225 }, { x: 200, y: 180 })
    expect(cropField(entry, 'bottom')).toHaveValue(20)
    expect(reset).toBeEnabled()

    await userEvent.click(reset)
    expect(cropField(entry, 'bottom')).toHaveValue(0)
    expect(Number(region().getAttribute('height'))).toBe(225)
  })

  it('is hidden when the Visual editors setting is off, rendering no frame', async () => {
    render(<App />)
    await placeClips()
    await openPicture(entry)
    expect(adjustButton(entry)).toBeInTheDocument()

    await chooseFromFileMenu('Settings…')
    const dialog = screen.getByRole('dialog', { name: 'Settings' })
    await userEvent.selectOptions(within(dialog).getByLabelText('Visual editors'), 'off')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }))

    expect(
      screen.queryByRole('button', { name: /Adjust the crop of .* visually/ }),
    ).not.toBeInTheDocument()
    // The row's own four fields and Reset are untouched by the setting.
    expect(cropField(entry, 'left')).toBeInTheDocument()
    expect(snapshotMock).not.toHaveBeenCalled()
  })
})
