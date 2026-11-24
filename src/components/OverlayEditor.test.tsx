import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { preloadVisualEditors } from './visualEditors'
import { probeMediaFile } from '../lib/probeMedia'
import { snapshotTimelineFrame } from '../lib/frameSnapshot'
import { videoOverlaysOf } from '../lib/timeline'
import type { TimelineState } from '../lib/timeline'
import { chooseFromFileMenu } from '../test/fileMenu'
import { chooseClipAction } from '../test/clipMenu'
import { openPicture } from '../test/pictureDisclosure'
import { effectItem } from '../test/timelineRowMenu'

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

const position = 'overlay cam.png at position 1'
const field = (name: string) => screen.getByRole('spinbutton', { name })
const left = () => field(`Left edge of ${position} (percent of frame width)`)
const top = () => field(`Top edge of ${position} (percent of frame height)`)
const width = () => field(`Width of ${position} (percent of frame width)`)
const height = () => field(`Height of ${position} (percent of frame height)`)
const adjustButton = () =>
  screen.getByRole('button', { name: `Adjust the placement of ${position} visually` })
const editor = () => screen.getByRole('dialog', { name: `Adjust the placement of ${position}` })
const handles = () => screen.getByTestId('frame-editor-handles')
const region = () => screen.getByTestId('frame-editor-rect')
const undoButton = () => screen.getByRole('button', { name: 'Undo last timeline edit' })

/**
 * A base entry plus an image overlay on it. An image overlay rather than a
 * video one because its placement travels through the `ImageOverlayPlacement`
 * branch (#294) — the narrower of the two, and the one a mistake in the
 * editor's `onUpdate` wiring would break by carrying audio fields.
 */
async function placeOverlay() {
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
    width: 320,
    height: 320,
  })
  await userEvent.upload(
    screen.getByTestId('clip-file-input'),
    new File(['cam'], 'cam.png', { type: 'image/png' }),
    { applyAccept: false },
  )
  await screen.findByText('cam.png')
  await chooseClipAction('cam.png', 'Add as overlay')
  // The picture-in-picture default (#145): a bit over a quarter of the
  // frame, inset from the bottom-right corner.
  expect(left()).toHaveValue(62)
  expect(width()).toHaveValue(35)
}

/** A pointer drag on the handle layer, from one point to another, in px. */
const drag = (
  target: Element,
  from: { x: number; y: number },
  to: { x: number; y: number },
  modifiers: { shiftKey?: boolean; altKey?: boolean } = {},
) => {
  fireEvent.pointerDown(target, { pointerId: 1, button: 0, clientX: from.x, clientY: from.y })
  fireEvent.pointerMove(handles(), {
    pointerId: 1,
    clientX: to.x,
    clientY: to.y,
    ...modifiers,
  })
  fireEvent.pointerUp(handles(), { pointerId: 1, clientX: to.x, clientY: to.y, ...modifiers })
}

// The editors are lazy chunks (#537); loaded once here, they render
// synchronously below, so a test can open one and read it on the next line.
beforeAll(preloadVisualEditors)

describe('visual overlay placement editor (#422)', () => {
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

  it('opens for that overlay, on a still of the frame without it, at its own midpoint', async () => {
    render(<App />)
    await placeOverlay()
    expect(adjustButton()).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(adjustButton())
    expect(adjustButton()).toHaveAttribute('aria-expanded', 'true')

    const dialog = editor()
    expect(
      within(dialog).getByRole('img', { name: `${position} placement rectangle` }),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByRole('button', { name: `Close the placement editor for ${position}` }),
    ).toHaveFocus()

    expect(snapshotMock).toHaveBeenCalledTimes(1)
    const [timeline, sequenceTime] = snapshotMock.mock.calls[0] as [TimelineState, number]
    // This overlay is left out, so the rectangle marks where it will go
    // rather than sitting on top of the overlay already drawn there.
    expect(videoOverlaysOf(timeline)).toEqual([])
    // A 5 s still overlay placed at 0 has its window's middle at 2.5 s —
    // not the sequence's start, which is what #413's zoom editor would use.
    expect(sequenceTime).toBeCloseTo(2.5, 6)

    // The rectangle is drawn where the fields say: 0.62 of 400 px across.
    expect(region()).toHaveAttribute('x', '248')
    expect(region()).toHaveAttribute('width', '140')
  })

  it('a drag inside moves it live and commits one undo step for the whole gesture', async () => {
    render(<App />)
    await placeOverlay()
    await userEvent.click(adjustButton())

    // The rectangle's middle is at (0.795, 0.795) of the frame; 40 px left
    // and 22.5 px up is −0.1 of each axis.
    const from = { x: 318, y: 179 }
    fireEvent.pointerDown(region(), { pointerId: 1, button: 0, clientX: from.x, clientY: from.y })
    fireEvent.pointerMove(handles(), { pointerId: 1, clientX: from.x - 40, clientY: from.y - 22.5 })
    // Mid-gesture the readout follows and nothing is committed yet.
    expect(within(editor()).getByRole('status', { name: `${position} left edge (live)` }))
      .toHaveTextContent('52')
    expect(left()).toHaveValue(62)

    fireEvent.pointerUp(handles(), { pointerId: 1, clientX: from.x - 40, clientY: from.y - 22.5 })
    expect(left()).toHaveValue(52)
    expect(top()).toHaveValue(52)
    // Size untouched: a move is not a resize.
    expect(width()).toHaveValue(35)
    expect(height()).toHaveValue(35)

    // One gesture, one undo step — several pointermoves crossed the frame.
    await userEvent.click(undoButton())
    expect(left()).toHaveValue(62)
    expect(top()).toHaveValue(62)
  })

  it('an edge drag changes only that dimension, a corner drag both', async () => {
    render(<App />)
    await placeOverlay()
    await userEvent.click(adjustButton())

    // The east edge of a rectangle at x 0.62 w 0.35 sits at 0.97 → 388 px.
    // Pulled in to 0.82 (328 px), the width becomes 0.2 and x stays.
    drag(screen.getByTestId('frame-editor-edge-e'), { x: 388, y: 179 }, { x: 328, y: 179 })
    expect(width()).toHaveValue(20)
    expect(left()).toHaveValue(62)
    expect(height()).toHaveValue(35)
    expect(top()).toHaveValue(62)

    // The south-east corner moves both: pulled to (0.92, 0.92) the size
    // becomes 0.3 × 0.3, still anchored at the north-west corner.
    drag(screen.getByTestId('frame-editor-corner-se'), { x: 328, y: 207 }, { x: 368, y: 207 })
    expect(width()).toHaveValue(30)
    expect(left()).toHaveValue(62)
    expect(top()).toHaveValue(62)
  })

  it("Shift on a corner keeps the rectangle's proportions", async () => {
    render(<App />)
    await placeOverlay()
    // A 1.75:1 box, so a broken lock is unmistakable in the numbers.
    await userEvent.clear(height())
    await userEvent.type(height(), '20{Enter}')
    await userEvent.clear(top())
    await userEvent.type(top(), '20{Enter}')
    await userEvent.clear(left())
    await userEvent.type(left(), '20{Enter}')
    await userEvent.click(adjustButton())
    const ratio = 0.35 / 0.2

    // The se corner is at (0.55, 0.4) → (220, 90). Dragged to x 0.7 the
    // width is 0.5, and the height must follow the ratio rather than the
    // pointer's own y.
    drag(
      screen.getByTestId('frame-editor-corner-se'),
      { x: 220, y: 90 },
      { x: 280, y: 200 },
      { shiftKey: true },
    )
    expect(width()).toHaveValue(50)
    // 0.5 / 1.75 is 0.2857, stored as 0.29 — a placement is kept to the
    // hundredth (`RECT_DECIMALS`), a whole percent in its field (#892). The
    // pointer's y asked for 0.69, so this is the lock, not the pointer.
    expect(height()).toHaveValue(Math.round((0.5 / ratio) * 100))
    expect(height()).toHaveValue(29)
    expect(left()).toHaveValue(20)
    expect(top()).toHaveValue(20)
  })

  it('snaps a dragged rectangle flush to the frame, and Alt bypasses it', async () => {
    render(<App />)
    await placeOverlay()
    await userEvent.click(adjustButton())

    // Dragged towards the top-left so its edges land 0.015 short of the
    // borders — inside the snap zone, so they go flush and both guides show.
    const from = { x: 318, y: 179 }
    const to = { x: from.x - (0.605 * 400), y: from.y - (0.605 * 225) }
    fireEvent.pointerDown(region(), { pointerId: 1, button: 0, clientX: from.x, clientY: from.y })
    fireEvent.pointerMove(handles(), { pointerId: 1, clientX: to.x, clientY: to.y })
    expect(screen.getByTestId('frame-editor-guide-x')).toBeInTheDocument()
    expect(screen.getByTestId('frame-editor-guide-y')).toBeInTheDocument()
    fireEvent.pointerUp(handles(), { pointerId: 1, clientX: to.x, clientY: to.y })
    expect(left()).toHaveValue(0)
    expect(top()).toHaveValue(0)
    // Guides belong to the gesture: gone on release, though the rectangle
    // is still sitting on the alignment.
    expect(screen.queryByTestId('frame-editor-guide-x')).not.toBeInTheDocument()

    // The same drag with Alt held keeps the 0.015 it was dragged to.
    await userEvent.click(undoButton())
    expect(left()).toHaveValue(62)
    fireEvent.pointerDown(region(), { pointerId: 1, button: 0, clientX: from.x, clientY: from.y })
    fireEvent.pointerMove(handles(), { pointerId: 1, clientX: to.x, clientY: to.y, altKey: true })
    expect(screen.queryByTestId('frame-editor-guide-x')).not.toBeInTheDocument()
    fireEvent.pointerUp(handles(), { pointerId: 1, clientX: to.x, clientY: to.y, altKey: true })
    // Where the pointer left it, rounded to the stored hundredth — not the
    // 0 the snap would have given.
    expect(left()).toHaveValue(2)
  })

  it('nudges with the arrow keys and resizes with + and −, one undo each', async () => {
    render(<App />)
    await placeOverlay()
    await userEvent.click(adjustButton())

    region().focus()
    expect(region()).toHaveFocus()
    const hintId = region().getAttribute('aria-describedby')
    expect(document.getElementById(hintId ?? '')).toHaveTextContent(/Arrow keys nudge/)

    fireEvent.keyDown(region(), { key: 'ArrowLeft' })
    expect(left()).toHaveValue(61)
    fireEvent.keyDown(region(), { key: 'ArrowUp', shiftKey: true })
    expect(top()).toHaveValue(57)
    // `+` grows the overlay — the opposite of what it does to a zoom's
    // region, and the right way round in both: the thing being edited grows.
    fireEvent.keyDown(region(), { key: '+' })
    expect(width()).toHaveValue(37)

    await userEvent.click(undoButton())
    expect(width()).toHaveValue(35)
    await userEvent.click(undoButton())
    expect(top()).toHaveValue(62)
    await userEvent.click(undoButton())
    expect(left()).toHaveValue(62)

    // A key the editor does not take reaches the panel: Escape closes it.
    region().focus()
    await userEvent.keyboard('{Escape}')
    expect(
      screen.queryByRole('dialog', { name: `Adjust the placement of ${position}` }),
    ).not.toBeInTheDocument()
  })

  it('a nudge held against the frame edge commits nothing rather than an empty step', async () => {
    render(<App />)
    await placeOverlay()
    // 0.65 + 0.35 is exactly the frame's width, so there is no room right.
    await userEvent.clear(left())
    await userEvent.type(left(), '65{Enter}')
    await userEvent.click(adjustButton())

    region().focus()
    fireEvent.keyDown(region(), { key: 'ArrowRight' })
    expect(left()).toHaveValue(65)
    // The step before this one is the typed 0.65, not a no-op nudge.
    await userEvent.click(undoButton())
    expect(left()).toHaveValue(62)
  })

  it('draws the mask silhouette the overlay will really be painted in', async () => {
    render(<App />)
    await placeOverlay()
    await userEvent.click(adjustButton())
    // No mask: nothing but the rectangle, which is the true silhouette.
    expect(screen.queryByTestId('frame-editor-silhouette')).not.toBeInTheDocument()

    await openPicture(position)
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: `Shape mask of ${position}` }),
      'ellipse',
    )
    const ellipse = screen.getByTestId('frame-editor-silhouette')
    expect(ellipse).toHaveAttribute('data-shape', 'ellipse')
    // Inscribed in the rectangle: 0.62..0.97 of 400 px across.
    expect(ellipse).toHaveAttribute('cx', '318')
    expect(ellipse).toHaveAttribute('rx', '70')

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: `Shape mask of ${position}` }),
      'rounded',
    )
    const rounded = screen.getByTestId('frame-editor-silhouette')
    expect(rounded).toHaveAttribute('data-shape', 'rounded')
    // The default radius (#266) is 0.15 of the shorter side — 78.75 px of
    // the 0.35 × 0.35 box, whose shorter side is 78.75 px.
    expect(Number(rounded.getAttribute('rx'))).toBeCloseTo(0.15 * 78.75, 2)
  })

  it('draws the silhouette on the picture once the source size is known, not on the whole rectangle (#795)', async () => {
    // jsdom decodes no images: this stand-in reports cam.png's 320 × 320
    // the way a loaded `new Image()` does, so the editor's probe resolves.
    class LoadedImage {
      onload: (() => void) | null = null
      naturalWidth = 0
      naturalHeight = 0
      set src(url: string) {
        if (url !== 'blob:cam.png') return
        queueMicrotask(() => {
          this.naturalWidth = 320
          this.naturalHeight = 320
          this.onload?.()
        })
      }
      removeAttribute() {}
    }
    vi.stubGlobal('Image', LoadedImage)
    render(<App />)
    await placeOverlay()
    await openPicture(position)
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: `Shape mask of ${position}` }),
      'ellipse',
    )
    await userEvent.click(adjustButton())

    // The square picture letterboxed in the 140 × 78.75 px rectangle is
    // 78.75 px square, centred: the ellipse is a circle of radius 39.375,
    // not the 70 × 39.375 ellipse inscribed in the rectangle.
    const ellipse = screen.getByTestId('frame-editor-silhouette')
    const attr = (element: Element, name: string) => Number(element.getAttribute(name))
    await vi.waitFor(() => expect(attr(ellipse, 'rx')).toBeCloseTo(39.375, 1))
    expect(attr(ellipse, 'ry')).toBeCloseTo(39.375, 1)
    expect(attr(ellipse, 'cx')).toBeCloseTo(318, 1)

    // Live while dragging: widen from the west edge by 40 px, and the circle
    // stays the picture's — as tall as the rectangle, recentred on it.
    fireEvent.pointerDown(screen.getByTestId('frame-editor-edge-w'), {
      pointerId: 1,
      button: 0,
      clientX: 248,
      clientY: 179,
    })
    fireEvent.pointerMove(handles(), { pointerId: 1, clientX: 208, clientY: 179, altKey: true })
    const live = screen.getByTestId('frame-editor-silhouette')
    expect(attr(live, 'rx')).toBeCloseTo(39.375, 1)
    expect(attr(live, 'cx')).toBeCloseTo(298, 1)
    fireEvent.pointerUp(handles(), { pointerId: 1, clientX: 208, clientY: 179, altKey: true })
  })

  describe('on an overlay with Moves: the placement at the Preview time (#835)', () => {
    const moveField = (n: number, what: string) => field(`Move ${n} ${what} of ${position}${
      what === 'left edge' || what === 'width'
        ? ' (percent of frame width)'
        : what === 'top edge' || what === 'height'
          ? ' (percent of frame height)'
          : ' in seconds'
    }`)
    const setField = async (element: HTMLElement, value: string) => {
      await userEvent.clear(element)
      await userEvent.type(element, `${value}{Enter}`)
      expect(element).toHaveValue(Number(value))
    }
    const slider = () => screen.getByRole('slider', { name: `Preview time of ${position} in seconds` })
    const editing = () => screen.getByTestId('overlay-editor-editing')
    const scrubTo = (seconds: number) => fireEvent.change(slider(), { target: { value: String(seconds) } })
    const lastStillTime = () => (snapshotMock.mock.calls.at(-1) as [TimelineState, number])[1]

    /**
     * The 5 s overlay at (0.62, 0.62), with Move 1 gliding 1 → 2 s to
     * (0.05, 0.05) and Move 2 gliding 3 → 4 s to (0.5, 0.05), both keeping
     * the 0.35 size. Both are added from + Effect ▾ and typed in.
     */
    async function placeOverlayWithMoves() {
      await placeOverlay()
      await userEvent.click(await effectItem(position, 'Move'))
      await setField(moveField(1, 'start'), '1')
      await setField(moveField(1, 'left edge'), '5')
      await setField(moveField(1, 'top edge'), '5')
      // The default second Move starts where the first ends, at its place.
      await userEvent.click(await effectItem(position, 'Move'))
      expect(moveField(2, 'start')).toHaveValue(2)
      await setField(moveField(2, 'start'), '3')
      await setField(moveField(2, 'left edge'), '50')
    }

    it('names and draws the placement that holds where the slider is, on the still from there', async () => {
      render(<App />)
      await placeOverlayWithMoves()
      await userEvent.click(adjustButton())
      // It opens where it always has, the window's middle: after Move 1.
      expect(slider()).toHaveValue('2.5')
      expect(lastStillTime()).toBeCloseTo(2.5, 6)
      expect(editing()).toHaveTextContent('Editing: after Move 1')
      expect(region()).toHaveAttribute('x', '20')

      for (const [time, label, x] of [
        [0.5, 'Editing: starting placement', '248'],
        // Exactly at a Move's start, that Move's destination holds.
        [1, 'Editing: after Move 1', '20'],
        // Inside Move 2's glide the box is its destination, not in flight.
        [3.5, 'Editing: after Move 2', '200'],
        [5, 'Editing: after Move 2', '200'],
      ] as const) {
        scrubTo(time)
        expect(editing()).toHaveTextContent(label)
        expect(region()).toHaveAttribute('x', x)
        // The still follows the slider: the frame under the overlay then.
        // A still renders once the previous one has, so it is awaited.
        await waitFor(() => expect(lastStillTime()).toBeCloseTo(time, 6))
      }
    })

    it('a drag after Move 1 changes Move 1\'s destination and nothing else, one undo step', async () => {
      render(<App />)
      await placeOverlayWithMoves()
      await userEvent.click(adjustButton())
      // Move 1's box spans x 20–160, y 11.25–90 px; 40 px right and 22.5 px
      // down is +0.1 of each axis; Alt keeps the guides out of it.
      drag(region(), { x: 90, y: 50 }, { x: 130, y: 72.5 }, { altKey: true })
      expect(moveField(1, 'left edge')).toHaveValue(15)
      expect(moveField(1, 'top edge')).toHaveValue(15)
      expect(moveField(1, 'width')).toHaveValue(35)
      // Its timing, the overlay's own placement and Move 2 are untouched.
      expect(moveField(1, 'start')).toHaveValue(1)
      expect(moveField(1, 'glide')).toHaveValue(1)
      expect(left()).toHaveValue(62)
      expect(top()).toHaveValue(62)
      expect(moveField(2, 'left edge')).toHaveValue(50)
      expect(moveField(2, 'top edge')).toHaveValue(5)

      await userEvent.click(undoButton())
      expect(moveField(1, 'left edge')).toHaveValue(5)
      expect(moveField(1, 'top edge')).toHaveValue(5)
    })

    it('a drag before the first Move changes the overlay\'s own placement and no Move', async () => {
      render(<App />)
      await placeOverlayWithMoves()
      await userEvent.click(adjustButton())
      scrubTo(0.5)
      drag(region(), { x: 318, y: 179 }, { x: 278, y: 156.5 }, { altKey: true })
      expect(left()).toHaveValue(52)
      expect(top()).toHaveValue(52)
      expect(moveField(1, 'left edge')).toHaveValue(5)
      expect(moveField(2, 'left edge')).toHaveValue(50)

      await userEvent.click(undoButton())
      expect(left()).toHaveValue(62)
    })

    it('an arrow key nudges the placement that holds there', async () => {
      render(<App />)
      await placeOverlayWithMoves()
      await userEvent.click(adjustButton())
      scrubTo(3.5)
      fireEvent.keyDown(region(), { key: 'ArrowDown' })
      expect(moveField(2, 'top edge')).toHaveValue(6)
      expect(moveField(1, 'top edge')).toHaveValue(5)
      expect(top()).toHaveValue(62)
    })

    it('an overlay without Moves has no slider and no Editing line', async () => {
      render(<App />)
      await placeOverlay()
      await userEvent.click(adjustButton())
      expect(within(editor()).queryByRole('slider')).not.toBeInTheDocument()
      expect(screen.queryByTestId('overlay-editor-editing')).not.toBeInTheDocument()
    })
  })

  it('is hidden when the Visual editors setting is off, rendering no frame', async () => {
    render(<App />)
    await placeOverlay()
    expect(adjustButton()).toBeInTheDocument()

    await chooseFromFileMenu('Settings…')
    const dialog = screen.getByRole('dialog', { name: 'Settings' })
    await userEvent.selectOptions(within(dialog).getByLabelText('Visual editors'), 'off')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }))

    expect(
      screen.queryByRole('button', { name: /Adjust the placement of .* visually/ }),
    ).not.toBeInTheDocument()
    expect(snapshotMock).not.toHaveBeenCalled()
  })
})
