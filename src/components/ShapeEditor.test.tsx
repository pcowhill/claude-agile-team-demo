import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { preloadVisualEditors } from './visualEditors'
import { snapshotTimelineFrame } from '../lib/frameSnapshot'
import { shapeGroupsOf } from '../lib/timeline'
import type { TimelineState } from '../lib/timeline'
import { ADD_SHAPES, ADD_SLATE, chooseFromAddMenu } from '../test/timelineMenu'

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

  // Part 2 (#686): the selection, the style bar, order, keys and the result.
  const SELECTION = `the selected shapes of ${group()}`
  const styleBar = () => screen.getByRole('group', { name: `Style of the selected shapes of ${group()}` })
  const press = (name: string) => fireEvent.pointerDown(within(editor()).getByRole('img', { name }), { pointerId: 1, button: 0, ...at(0.5, 0.5) })
  const release = () => fireEvent.pointerUp(layer(), { pointerId: 1, ...at(0.5, 0.5) })
  const shiftClick = (name: string) =>
    fireEvent.pointerDown(within(editor()).getByRole('img', { name }), {
      pointerId: 1,
      button: 0,
      shiftKey: true,
      ...at(0.5, 0.5),
    })
  /** The group's default ellipse plus a rectangle drawn at 0.1–0.3 × 0.1–0.4, left selected. */
  async function ellipseAndRectangle() {
    render(<App />)
    await chooseFromAddMenu(ADD_SHAPES)
    await userEvent.click(drawButton())
    await userEvent.click(within(editor()).getByRole('button', { name: 'Rectangle tool' }))
    drag(layer(), { x: 0.1, y: 0.1 }, { x: 0.3, y: 0.4 })
  }
  const selectedCount = () => editor().querySelectorAll('[data-selected="true"]').length

  it('Shift-click builds a selection that one style-bar change restyles, as one undo step (#686)', async () => {
    await ellipseAndRectangle()
    expect(selectedCount()).toBe(1)
    // Nothing selected leaves the bar disabled.
    fireEvent.pointerDown(layer(), { pointerId: 1, button: 0, ...at(0.9, 0.9) })
    release()
    expect(selectedCount()).toBe(0)
    expect(within(styleBar()).getByLabelText(`Border colour of ${SELECTION}`)).toBeDisabled()

    press(shape('Ellipse', 1))
    release()
    shiftClick(shape('Rectangle', 2))
    expect(selectedCount()).toBe(2)
    fireEvent.change(within(styleBar()).getByLabelText(`Border colour of ${SELECTION}`), {
      target: { value: '#00ff00' },
    })
    expect(screen.getByLabelText(`Border colour of ${shape('Ellipse', 1)}`)).toHaveValue('#00ff00')
    expect(screen.getByLabelText(`Border colour of ${shape('Rectangle', 2)}`)).toHaveValue('#00ff00')
    await userEvent.click(undo())
    expect(screen.getByLabelText(`Border colour of ${shape('Ellipse', 1)}`)).toHaveValue('#e53935')
    expect(screen.getByLabelText(`Border colour of ${shape('Rectangle', 2)}`)).toHaveValue('#e53935')

    // Shift-click again takes a shape back out.
    shiftClick(shape('Ellipse', 1))
    expect(selectedCount()).toBe(1)
  })

  it('the style bar shows "mixed" where the selection disagrees, and disables what does not apply to all (#686)', async () => {
    await ellipseAndRectangle()
    const rectangle = shape('Rectangle', 2)
    fireEvent.change(screen.getByLabelText(`Border colour of ${rectangle}`), { target: { value: '#0000ff' } })
    // The rectangle alone: every box field applies, the heads do not.
    const one = SELECTION
    expect(within(styleBar()).getByLabelText(`Corner radius of ${one} in pixels`)).toBeEnabled()
    expect(within(styleBar()).getByLabelText(`Arrow heads of ${one}`)).toBeDisabled()
    shiftClick(shape('Ellipse', 1))
    const colour = within(styleBar()).getByLabelText(`Border colour of ${SELECTION}`)
    expect(colour).toHaveAttribute('data-mixed', 'true')
    expect(within(styleBar()).getByText('mixed')).toBeInTheDocument()
    // Both have the same opacity, so it reads as a number.
    expect(within(styleBar()).getByLabelText(`Border opacity of ${SELECTION} (percent)`)).toHaveValue(100)
    // An ellipse has no corners.
    expect(within(styleBar()).getByLabelText(`Corner radius of ${SELECTION} in pixels`)).toBeDisabled()
    expect(within(styleBar()).getByLabelText(`Fill colour of ${SELECTION}`)).toBeEnabled()
    // A typed value applies to both, mixed or not.
    const opacity = within(styleBar()).getByLabelText(`Border opacity of ${SELECTION} (percent)`)
    await userEvent.clear(opacity)
    await userEvent.type(opacity, '50{Enter}')
    expect(field(`Border opacity of ${shape('Ellipse', 1)} (percent)`)).toHaveValue(50)
    expect(field(`Border opacity of ${rectangle} (percent)`)).toHaveValue(50)
  })

  it('the style bar sets the line style of the whole selection, arrows included, as one undo step (#688)', async () => {
    await ellipseAndRectangle()
    shiftClick(shape('Ellipse', 1))
    const line = () => within(styleBar()).getByLabelText(`Line style of ${SELECTION}`)
    expect(line()).toHaveValue('solid')
    fireEvent.change(line(), { target: { value: 'dotted' } })
    const rowLine = (name: string) => screen.getByRole('combobox', { name: `Line style of ${name}` })
    expect(rowLine(shape('Ellipse', 1))).toHaveValue('dotted')
    expect(rowLine(shape('Rectangle', 2))).toHaveValue('dotted')
    await userEvent.click(undo())
    expect(rowLine(shape('Ellipse', 1))).toHaveValue('solid')
    expect(rowLine(shape('Rectangle', 2))).toHaveValue('solid')
    // Shapes that disagree read "Mixed".
    fireEvent.change(rowLine(shape('Rectangle', 2)), { target: { value: 'dashed' } })
    expect(line()).toHaveValue('mixed')
  })

  it('Delete removes the selection and Ctrl+D duplicates it, only from the picture, and the last shape stays (#686)', async () => {
    await ellipseAndRectangle()
    // Ctrl+D: the browser's bookmark shortcut is prevented.
    expect(fireEvent.keyDown(layer(), { key: 'd', ctrlKey: true })).toBe(false)
    const copy = shape('Rectangle', 3)
    expect(field(`Left edge of ${copy} (0 to 1)`)).toHaveValue(0.12)
    expect(field(`Top edge of ${copy} (0 to 1)`)).toHaveValue(0.12)
    // The copy is selected; Cmd+D copies it again.
    expect(fireEvent.keyDown(layer(), { key: 'd', metaKey: true })).toBe(false)
    expect(field(`Left edge of ${shape('Rectangle', 4)} (0 to 1)`)).toHaveValue(0.14)
    expect(fireEvent.keyDown(layer(), { key: 'Delete' })).toBe(false)
    expect(screen.queryByRole('listitem', { name: shape('Rectangle', 4) })).toBeNull()

    // The keys belong to the picture: in a text field they do nothing of ours.
    press(shape('Rectangle', 2))
    release()
    const opacity = within(styleBar()).getByLabelText(`Border opacity of ${SELECTION} (percent)`)
    expect(fireEvent.keyDown(opacity, { key: 'Delete' })).toBe(true)
    expect(fireEvent.keyDown(opacity, { key: 'd', ctrlKey: true })).toBe(true)
    expect(screen.getByRole('listitem', { name: shape('Rectangle', 2) })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem', { name: /^Rectangle \d of / })).toHaveLength(2)

    // Everything selected: Delete refuses, since a group keeps one shape.
    shiftClick(shape('Ellipse', 1))
    shiftClick(shape('Rectangle', 3))
    expect(selectedCount()).toBe(3)
    fireEvent.keyDown(layer(), { key: 'Backspace' })
    expect(screen.getByTestId('shape-editor-status')).toHaveTextContent('A group always keeps one shape')
    expect(screen.getAllByRole('listitem', { name: /of shape group at position 1$/ })).toHaveLength(3)
  })

  it('the Highlighter preset styles the selected rectangles, or the next one drawn (#686)', async () => {
    await ellipseAndRectangle()
    const rectangle = shape('Rectangle', 2)
    await userEvent.click(within(styleBar()).getByRole('button', { name: 'Highlighter' }))
    expect(field(`Border thickness of ${rectangle} in pixels`)).toHaveValue(0)
    expect(screen.getByLabelText(`Fill colour of ${rectangle}`)).toHaveValue('#ffff00')
    expect(field(`Fill opacity of ${rectangle} (percent)`)).toHaveValue(35)
    // An ellipse alone is not a rectangle: the preset is off.
    press(shape('Ellipse', 1))
    release()
    expect(within(styleBar()).getByRole('button', { name: 'Highlighter' })).toBeDisabled()

    // Nothing selected: the Rectangle tool is chosen and its next rectangle lit.
    fireEvent.pointerDown(layer(), { pointerId: 1, button: 0, ...at(0.9, 0.9) })
    release()
    await userEvent.click(within(styleBar()).getByRole('button', { name: 'Highlighter' }))
    expect(within(editor()).getByRole('button', { name: 'Rectangle tool' })).toHaveAttribute('aria-pressed', 'true')
    drag(layer(), { x: 0.5, y: 0.1 }, { x: 0.7, y: 0.2 })
    const next = shape('Rectangle', 3)
    expect(field(`Border thickness of ${next} in pixels`)).toHaveValue(0)
    expect(field(`Fill opacity of ${next} (percent)`)).toHaveValue(35)
  })

  it('Bring forward and Send backward change the group’s order (#686)', async () => {
    await ellipseAndRectangle()
    const forward = () => within(styleBar()).getByRole('button', { name: 'Bring forward' })
    const backward = () => within(styleBar()).getByRole('button', { name: 'Send backward' })
    // The rectangle, drawn last, is on top already.
    expect(forward()).toBeDisabled()
    await userEvent.click(backward())
    expect(screen.getByRole('listitem', { name: shape('Rectangle', 1) })).toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: shape('Ellipse', 2) })).toBeInTheDocument()
    expect(backward()).toBeDisabled()
    await userEvent.click(forward())
    expect(screen.getByRole('listitem', { name: shape('Ellipse', 1) })).toBeInTheDocument()
  })

  it('the Preview slider and Show result render the group’s window, with the group in the still (#686)', async () => {
    render(<App />)
    await chooseFromAddMenu(ADD_SLATE)
    await chooseFromAddMenu(ADD_SHAPES)
    await userEvent.click(drawButton())
    const slider = within(editor()).getByRole('slider', { name: `Preview time of ${group()} in seconds` })
    expect(slider).toHaveAttribute('min', '0')
    expect(slider).toHaveAttribute('max', '3')
    expect(slider).toHaveValue('1.5')
    let [timeline, time] = snapshotMock.mock.lastCall as [TimelineState, number]
    expect(time).toBe(1.5)
    expect(shapeGroupsOf(timeline)).toEqual([])

    fireEvent.change(slider, { target: { value: '0.5' } })
    ;[timeline, time] = snapshotMock.mock.lastCall as [TimelineState, number]
    expect(time).toBe(0.5)

    await userEvent.click(within(editor()).getByRole('checkbox', { name: 'Show result' }))
    ;[timeline, time] = snapshotMock.mock.lastCall as [TimelineState, number]
    // The result is the composite: this group is in the still.
    expect(time).toBe(0.5)
    expect(shapeGroupsOf(timeline)).toHaveLength(1)
    expect(screen.queryByTestId('shape-editor-canvas')).toBeNull()
    expect(within(editor()).getByRole('button', { name: 'Rectangle tool' })).toBeDisabled()
    expect(screen.getByTestId('shape-editor-status')).toHaveTextContent('Turn Show result off to edit')
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
