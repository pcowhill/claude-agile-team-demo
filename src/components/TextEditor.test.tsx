import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { snapshotTimelineFrame } from '../lib/frameSnapshot'
import { textsOf } from '../lib/timeline'
import type { TimelineState } from '../lib/timeline'
import { ADD_SLATE, ADD_TEXT, chooseFromAddMenu } from '../test/timelineMenu'
import { chooseFromFileMenu } from '../test/fileMenu'

// The still is the export's own draw (#237); jsdom has no canvas, so the
// snapshot is stubbed and what it was asked to render is what is asserted.
vi.mock('../lib/frameSnapshot', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/frameSnapshot')>()),
  snapshotTimelineFrame: vi.fn(),
}))

// Nor can jsdom measure text. The measurer is replaced by a deterministic
// one — six tenths of the type size per character, read off the font string
// the export builds — so the block's box is arithmetic the tests can do.
vi.mock('../lib/textMeasure', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/textMeasure')>()),
  measureTextWidth: (font: string, line: string) => {
    const px = /(\d+(?:\.\d+)?)px/.exec(font)
    if (px === null) throw new Error(`no px size in font "${font}"`)
    return Number(px[1]) * 0.6 * line.length
  },
}))

const snapshotMock = vi.mocked(snapshotTimelineFrame)

/** The frame's laid-out box: 400 × 225 at the origin, so 0.01 is 4 px across. */
const FRAME = { x: 0, y: 0, width: 400, height: 225 }

/**
 * The default 'Title' at size 0.08, measured at the editor's fallback frame
 * (1920 × 1080, until a still says otherwise — jsdom never loads one): 86.4px
 * type, five characters at 0.6 em is 259.2px, 0.135 of the frame's width;
 * one line at 1.2 line heights is 0.096 of its height. On the 400 × 225 box:
 */
const BLOCK = { x: (0.5 - 0.135 / 2) * 400, y: (0.5 - 0.096 / 2) * 225, width: 0.135 * 400, height: 0.096 * 225 }

const position = 'text overlay at position 1'
const field = (name: string) => screen.getByRole('spinbutton', { name })
const centreX = (who = position) => field(`Centre X of ${who} (0 to 1)`)
const centreY = (who = position) => field(`Centre Y of ${who} (0 to 1)`)
const sizeField = (who = position) => field(`Size of ${who} (fraction of frame height)`)
const adjustButton = (who = position) =>
  screen.getByRole('button', { name: `Adjust the placement of ${who} visually` })
const editor = (who = position) => screen.getByRole('dialog', { name: `Adjust the placement of ${who}` })
const handles = () => screen.getByTestId('frame-editor-handles')
const region = () => screen.getByTestId('frame-editor-rect')
const corner = () => screen.getByTestId('frame-editor-corner-se')
const undoButton = () => screen.getByRole('button', { name: 'Undo last timeline edit' })
const liveReadout = (what: string, who = position) =>
  within(editor(who)).getByRole('status', { name: `${who} ${what} (live)` })

/** A 5 s slate and the default 3 s title over it, media-free. */
async function placeTitle() {
  await chooseFromAddMenu(ADD_SLATE)
  await chooseFromAddMenu(ADD_TEXT)
  await screen.findByRole('textbox', { name: `Content of ${position}` })
}

async function openEditor(who = position) {
  await userEvent.click(adjustButton(who))
  return editor(who)
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

const centre = { x: 200, y: 112.5 }

describe('visual text overlay editor (#424)', () => {
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
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('opens on the composed frame with the text drawn, at the middle of its window, the box on the text', async () => {
    render(<App />)
    await placeTitle()
    expect(adjustButton()).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(adjustButton())
    expect(adjustButton()).toHaveAttribute('aria-expanded', 'true')

    const dialog = editor()
    expect(within(dialog).getByRole('img', { name: `${position} text block` })).toBeInTheDocument()
    expect(
      within(dialog).getByRole('button', { name: `Close the placement editor for ${position}` }),
    ).toHaveFocus()

    // Nothing bypassed: the text is what is being placed, so the timeline
    // handed to the snapshot still carries it, over the slate, at the
    // middle of the default window [0, 3].
    expect(snapshotMock).toHaveBeenCalledTimes(1)
    const [timeline, sequenceTime] = snapshotMock.mock.calls[0] as [TimelineState, number]
    expect(timeline.entries).toHaveLength(1)
    expect(textsOf(timeline)).toHaveLength(1)
    expect(textsOf(timeline)[0].content).toBe('Title')
    expect(sequenceTime).toBeCloseTo(1.5, 6)

    // The box is the measured block, centred on the default (0.5, 0.5).
    expect(region()).toHaveAttribute('x', String(BLOCK.x))
    expect(region()).toHaveAttribute('y', String(Math.round(BLOCK.y * 100) / 100))
    expect(region()).toHaveAttribute('width', String(BLOCK.width))
    expect(region()).toHaveAttribute('height', String(BLOCK.height))
    // One corner handle, no edges.
    expect(corner()).toBeInTheDocument()
    expect(screen.queryByTestId('frame-editor-corner-nw')).not.toBeInTheDocument()
    expect(screen.queryByTestId('frame-editor-edge-e')).not.toBeInTheDocument()

    // The same button closes it.
    await userEvent.click(adjustButton())
    expect(screen.queryByRole('dialog', { name: `Adjust the placement of ${position}` })).not.toBeInTheDocument()
  })

  it('a drag moves the centre, mirrored live, committing one undo step and leaving the size alone', async () => {
    render(<App />)
    await placeTitle()
    await openEditor()

    // 80px left is 0.2 of the frame; 22px up is 0.0978 of it, stored as 0.4.
    fireEvent.pointerDown(region(), { pointerId: 1, button: 0, clientX: centre.x, clientY: centre.y })
    fireEvent.pointerMove(handles(), { pointerId: 1, clientX: centre.x - 80, clientY: centre.y - 22 })
    // Mid-gesture the readout follows and nothing is committed yet.
    expect(liveReadout('centre X')).toHaveTextContent('0.3')
    expect(liveReadout('centre Y')).toHaveTextContent('0.4')
    expect(centreX()).toHaveValue(0.5)

    fireEvent.pointerUp(handles(), { pointerId: 1, clientX: centre.x - 80, clientY: centre.y - 22 })
    expect(centreX()).toHaveValue(0.3)
    expect(centreY()).toHaveValue(0.4)
    expect(sizeField()).toHaveValue(0.08)
    // The box moved with it; the still re-renders because the text is drawn.
    expect(region()).toHaveAttribute('x', String(Math.round((0.3 - 0.135 / 2) * 400 * 100) / 100))
    expect(snapshotMock).toHaveBeenCalledTimes(2)
    const [, sequenceTime] = snapshotMock.mock.calls[1] as [TimelineState, number]
    expect(sequenceTime).toBeCloseTo(1.5, 6)

    // One gesture, one undo step.
    await userEvent.click(undoButton())
    expect(centreX()).toHaveValue(0.5)
    expect(centreY()).toHaveValue(0.5)
  })

  it('the corner handle scales the block about its centre and commits the size', async () => {
    render(<App />)
    await placeTitle()
    await openEditor()

    // The corner sits at the block's bottom-right; twice as far from the
    // centre on both axes is twice the size.
    drag(
      corner(),
      { x: BLOCK.x + BLOCK.width, y: BLOCK.y + BLOCK.height },
      { x: centre.x + BLOCK.width, y: centre.y + BLOCK.height },
    )
    expect(sizeField()).toHaveValue(0.16)
    expect(centreX()).toHaveValue(0.5)
    expect(centreY()).toHaveValue(0.5)
    expect(region()).toHaveAttribute('width', String(BLOCK.width * 2))
    expect(region()).toHaveAttribute('height', String(Math.round(BLOCK.height * 2 * 100) / 100))

    await userEvent.click(undoButton())
    expect(sizeField()).toHaveValue(0.08)
  })

  it('snaps the centre onto a third with a guide, Alt bypasses it, and the frame clamps the block', async () => {
    render(<App />)
    await placeTitle()
    await openEditor()

    // 64px left is 0.16: a centre of 0.34, inside the tolerance of a third.
    fireEvent.pointerDown(region(), { pointerId: 1, button: 0, clientX: centre.x, clientY: centre.y })
    fireEvent.pointerMove(handles(), { pointerId: 1, clientX: centre.x - 64, clientY: centre.y })
    expect(screen.getByTestId('frame-editor-guide-x')).toHaveAttribute('x1', String(Math.round((400 / 3) * 100) / 100))
    fireEvent.pointerUp(handles(), { pointerId: 1, clientX: centre.x - 64, clientY: centre.y })
    expect(centreX()).toHaveValue(0.33)
    expect(screen.queryByTestId('frame-editor-guide-x')).not.toBeInTheDocument()
    await userEvent.click(undoButton())

    drag(region(), centre, { x: centre.x - 64, y: centre.y }, { altKey: true })
    expect(centreX()).toHaveValue(0.34)
    await userEvent.click(undoButton())

    // Dragged well off the right: the block stops with its edge on the frame
    // — a centre of 0.93 puts the right edge at 0.9975.
    drag(region(), centre, { x: centre.x + 600, y: centre.y })
    expect(centreX()).toHaveValue(0.93)
  })

  it('nudges and resizes with the keyboard, one undo step each, and Escape closes', async () => {
    render(<App />)
    await placeTitle()
    await openEditor()

    region().focus()
    expect(region()).toHaveFocus()
    fireEvent.keyDown(region(), { key: 'ArrowRight' })
    expect(centreX()).toHaveValue(0.51)
    fireEvent.keyDown(region(), { key: 'ArrowUp', shiftKey: true })
    expect(centreY()).toHaveValue(0.45)
    fireEvent.keyDown(region(), { key: '+' })
    expect(sizeField()).toHaveValue(0.09)

    await userEvent.click(undoButton())
    expect(sizeField()).toHaveValue(0.08)
    await userEvent.click(undoButton())
    expect(centreY()).toHaveValue(0.5)
    await userEvent.click(undoButton())
    expect(centreX()).toHaveValue(0.5)

    region().focus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: `Adjust the placement of ${position}` })).not.toBeInTheDocument()
  })

  it('opens for an imported subtitle too, at the middle of its cue', async () => {
    render(<App />)
    await chooseFromAddMenu(ADD_SLATE)
    await userEvent.upload(
      screen.getByTestId('subtitle-file-input'),
      new File(['1\n00:00:01,000 --> 00:00:03,000\nHello there\n'], 'captions.srt', {
        type: 'application/x-subrip',
      }),
    )
    await screen.findByRole('textbox', { name: `Content of ${position}` })

    await openEditor()
    const [timeline, sequenceTime] = snapshotMock.mock.calls[0] as [TimelineState, number]
    expect(textsOf(timeline)[0]).toMatchObject({ content: 'Hello there', subtitle: true })
    expect(sequenceTime).toBeCloseTo(2, 6)

    // The caption default sits at the bottom (y 0.9); a nudge up moves it,
    // through the same `text-updated` a typed value takes.
    expect(centreY()).toHaveValue(0.9)
    region().focus()
    fireEvent.keyDown(region(), { key: 'ArrowUp' })
    expect(centreY()).toHaveValue(0.89)
  })

  it('is hidden when the Visual editors setting is off, rendering no frame', async () => {
    render(<App />)
    await placeTitle()
    expect(adjustButton()).toBeInTheDocument()

    await chooseFromFileMenu('Settings…')
    const dialog = screen.getByRole('dialog', { name: 'Settings' })
    await userEvent.selectOptions(within(dialog).getByLabelText('Visual editors'), 'off')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }))

    expect(
      screen.queryByRole('button', { name: /Adjust the placement of text overlay .* visually/ }),
    ).not.toBeInTheDocument()
    // The row's own fields are untouched by the setting.
    expect(centreX()).toBeInTheDocument()
    expect(snapshotMock).not.toHaveBeenCalled()
  })
})
