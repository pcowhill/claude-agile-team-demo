import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { preloadVisualEditors } from './visualEditors'
import { snapshotTimelineFrame } from '../lib/frameSnapshot'
import { shapeGroupsOf } from '../lib/timeline'
import type { TimelineState } from '../lib/timeline'
import { ADD_SHAPES, chooseFromAddMenu } from '../test/timelineMenu'

/**
 * The shape editor, part 1 (#685), App-level: the row's **Draw shapes…**
 * button, the still it opens on, and what a drag or a key commits, read back
 * from the row's own fields and the Undo button. jsdom has no layout, so the
 * frame's box is stubbed. `e2e/shape-editor.spec.ts` has the real-browser
 * evidence: real drags, Shift and the guides, and the geometry.
 */

// The still is the export's own draw; jsdom has no canvas, so it is stubbed
// and what it was asked to render is what is asserted.
vi.mock('../lib/frameSnapshot', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/frameSnapshot')>()),
  snapshotTimelineFrame: vi.fn(),
}))

const snapshotMock = vi.mocked(snapshotTimelineFrame)

/** The frame's laid-out box: 400 × 225 at the origin, so 0.01 is 4 px across. */
const FRAME = { x: 0, y: 0, width: 400, height: 225 }

const group = (index = 1) => `shape group at position ${index}`
const shape = (kind: string, index: number, groupIndex = 1) =>
  `${kind} ${index} of ${group(groupIndex)}`
const field = (name: string) => screen.getByRole('spinbutton', { name })
const drawButton = () =>
  screen.getByRole('button', { name: `Draw the shapes of ${group()} visually` })
const editor = () => screen.getByRole('dialog', { name: `Draw the shapes of ${group()}` })
const layer = () => screen.getByTestId('shape-editor-layer')
const undo = () => screen.getByRole('button', { name: 'Undo last timeline edit' })
const at = (x: number, y: number) => ({ clientX: FRAME.width * x, clientY: FRAME.height * y })

function drag(target: Element, from: { x: number; y: number }, to: { x: number; y: number }, altKey = true) {
  fireEvent.pointerDown(target, { pointerId: 1, button: 0, ...at(from.x, from.y) })
  // Two moves, as a real drag sends many: the commit is on release only.
  fireEvent.pointerMove(layer(), { pointerId: 1, altKey, ...at((from.x + to.x) / 2, (from.y + to.y) / 2) })
  fireEvent.pointerMove(layer(), { pointerId: 1, altKey, ...at(to.x, to.y) })
  fireEvent.pointerUp(layer(), { pointerId: 1, altKey, ...at(to.x, to.y) })
}

beforeAll(preloadVisualEditors)

describe('the shape editor (#685)', () => {
  beforeEach(() => {
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
    // jsdom has no 2D context; the canvas simply draws nothing.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('opens from the row on a still of the frame without this group, at the middle of its window', async () => {
    render(<App />)
    await chooseFromAddMenu(ADD_SHAPES)
    expect(drawButton()).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(drawButton())
    expect(drawButton()).toHaveAttribute('aria-expanded', 'true')
    expect(
      within(editor()).getByRole('button', { name: `Close the shape editor for ${group()}` }),
    ).toHaveFocus()
    expect(within(editor()).getByRole('img', { name: shape('Ellipse', 1) })).toBeInTheDocument()

    expect(snapshotMock).toHaveBeenCalledTimes(1)
    const [timeline, sequenceTime] = snapshotMock.mock.calls[0] as [TimelineState, number]
    // The editor draws this group itself, live, so the still leaves it out.
    expect(shapeGroupsOf(timeline)).toEqual([])
    // A new group runs 3 s from 0: its middle is 1.5 s, clamped into the
    // sequence, which is empty here.
    expect(sequenceTime).toBe(0)

    // The same button closes it, as every Adjust visually… button does.
    await userEvent.click(drawButton())
    expect(screen.queryByRole('dialog', { name: `Draw the shapes of ${group()}` })).toBeNull()
  })

  it('a drag with the Rectangle tool adds one rectangle as one undo step, and the tool returns to Select', async () => {
    render(<App />)
    await chooseFromAddMenu(ADD_SHAPES)
    await userEvent.click(drawButton())
    const tools = within(editor()).getByRole('toolbar')
    await userEvent.click(within(tools).getByRole('button', { name: 'Rectangle tool' }))
    expect(within(tools).getByRole('button', { name: 'Rectangle tool' })).toHaveAttribute('aria-pressed', 'true')

    drag(layer(), { x: 0.1, y: 0.1 }, { x: 0.3, y: 0.4 })
    const rectangle = shape('Rectangle', 2)
    expect(field(`Left edge of ${rectangle} (0 to 1)`)).toHaveValue(0.1)
    expect(field(`Top edge of ${rectangle} (0 to 1)`)).toHaveValue(0.1)
    expect(field(`Width of ${rectangle} (fraction of frame width)`)).toHaveValue(0.2)
    expect(field(`Height of ${rectangle} (fraction of frame height)`)).toHaveValue(0.3)
    expect(within(tools).getByRole('button', { name: 'Select tool' })).toHaveAttribute('aria-pressed', 'true')
    // It took the group's last shape's style.
    expect(screen.getByLabelText(`Border colour of ${rectangle}`)).toHaveValue('#e53935')

    // One undo removes it: the draw, though it moved twice, was one edit.
    await userEvent.click(undo())
    expect(screen.queryByRole('spinbutton', { name: `Left edge of ${rectangle} (0 to 1)` })).toBeNull()
    expect(screen.getByRole('listitem', { name: shape('Ellipse', 1) })).toBeInTheDocument()
  })

  it('a double-clicked tool stays chosen for the next shape', async () => {
    render(<App />)
    await chooseFromAddMenu(ADD_SHAPES)
    await userEvent.click(drawButton())
    const tools = within(editor()).getByRole('toolbar')
    await userEvent.dblClick(within(tools).getByRole('button', { name: 'Arrow tool' }))
    drag(layer(), { x: 0.1, y: 0.8 }, { x: 0.4, y: 0.8 })
    drag(layer(), { x: 0.1, y: 0.9 }, { x: 0.4, y: 0.9 })
    expect(field(`Tip x of ${shape('Arrow', 2)} (0 to 1)`)).toHaveValue(0.4)
    expect(field(`Tip y of ${shape('Arrow', 3)} (0 to 1)`)).toHaveValue(0.9)
    expect(within(tools).getByRole('button', { name: 'Arrow tool' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('a click selects without changing anything; a key then nudges the selection as one undo step', async () => {
    render(<App />)
    await chooseFromAddMenu(ADD_SHAPES)
    await userEvent.click(drawButton())
    const ellipse = shape('Ellipse', 1)
    const left = () => field(`Left edge of ${ellipse} (0 to 1)`)
    expect(left()).toHaveValue(0.4)

    // A press and release without travel: selected, and nothing committed.
    const body = within(editor()).getByRole('img', { name: ellipse })
    fireEvent.pointerDown(body, { pointerId: 1, button: 0, ...at(0.5, 0.5) })
    fireEvent.pointerUp(layer(), { pointerId: 1, ...at(0.5, 0.5) })
    expect(screen.getByTestId('shape-editor-selection')).toBeInTheDocument()
    expect(left()).toHaveValue(0.4)
    expect(layer()).toHaveFocus()

    fireEvent.keyDown(layer(), { key: 'ArrowRight' })
    expect(left()).toHaveValue(0.41)
    fireEvent.keyDown(layer(), { key: 'ArrowRight', shiftKey: true })
    expect(left()).toHaveValue(0.46)
    // Each press was one step, and the click none: two undos reach the
    // group as added, and the third removes the group itself.
    await userEvent.click(undo())
    expect(left()).toHaveValue(0.41)
    await userEvent.click(undo())
    expect(left()).toHaveValue(0.4)
    await userEvent.click(undo())
    expect(screen.queryByRole('list', { name: 'Shape groups' })).toBeNull()
  })

  it('a field typed in the row moves the shape the editor shows: one value, two views', async () => {
    render(<App />)
    await chooseFromAddMenu(ADD_SHAPES)
    await userEvent.click(drawButton())
    const ellipse = shape('Ellipse', 1)
    const left = field(`Left edge of ${ellipse} (0 to 1)`)
    await userEvent.clear(left)
    await userEvent.type(left, '0.1')
    await userEvent.tab()
    // 0.1 of 400 px.
    expect(screen.getByTestId('shape-editor-hit-0')).toHaveAttribute('cx', String(400 * (0.1 + 0.1)))
  })
})
