import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { probeMediaFile } from '../lib/probeMedia'
import { snapshotTimelineFrame } from '../lib/frameSnapshot'
import { SETTINGS_KEY } from '../lib/settings'
import { zoomsOf } from '../lib/timeline'
import type { TimelineState } from '../lib/timeline'
import { chooseFromFileMenu } from '../test/fileMenu'
import { ADD_ZOOM, chooseEffect } from '../test/timelineRowMenu'

vi.mock('../lib/probeMedia', () => ({
  probeMediaFile: vi.fn(),
}))

// The editor's still is the export's own draw (#237); jsdom has no canvas,
// so the snapshot is stubbed here and what it was asked to render is what
// the tests assert.
vi.mock('../lib/frameSnapshot', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/frameSnapshot')>()),
  snapshotTimelineFrame: vi.fn(),
}))

const probeMock = vi.mocked(probeMediaFile)
const snapshotMock = vi.mocked(snapshotTimelineFrame)

/** The frame's laid-out box: 400 × 225 at the origin, so a fraction is 4 px. */
const FRAME = { x: 0, y: 0, width: 400, height: 225 }

const position = 'logo.png at position 1'
const scaleField = () => screen.getByRole('spinbutton', { name: `Zoom 1 scale of ${position}` })
const centreX = () =>
  screen.getByRole('spinbutton', { name: `Zoom 1 centre X of ${position} (0 to 1)` })
const centreY = () =>
  screen.getByRole('spinbutton', { name: `Zoom 1 centre Y of ${position} (0 to 1)` })
const adjustButton = () => screen.getByRole('button', { name: `Adjust Zoom 1 of ${position} visually` })
const editor = () => screen.getByRole('dialog', { name: `Adjust Zoom 1 of ${position}` })
const handles = () => screen.getByTestId('frame-editor-handles')
const region = () => screen.getByTestId('frame-editor-rect')
const undoButton = () => screen.getByRole('button', { name: 'Undo last timeline edit' })

/** Imports a 16:9 image and places it, then adds one zoom (scale 2, centred). */
async function placeImageWithZoom() {
  probeMock.mockResolvedValueOnce({
    duration: 0,
    url: 'blob:logo.png',
    kind: 'image',
    width: 320,
    height: 180,
  })
  await userEvent.upload(
    screen.getByTestId('clip-file-input'),
    new File(['content'], 'logo.png', { type: 'image/png' }),
    { applyAccept: false },
  )
  await screen.findByText('logo.png')
  await userEvent.click(screen.getByRole('button', { name: 'Add logo.png to timeline' }))
  await chooseEffect(position, ADD_ZOOM)
  expect(scaleField()).toHaveValue(2)
  expect(centreX()).toHaveValue(0.5)
}

/** A pointer drag on the handle layer, from one point to another, in px. */
const drag = (
  target: Element,
  from: { x: number; y: number },
  to: { x: number; y: number },
  moves: { x: number; y: number }[] = [],
) => {
  fireEvent.pointerDown(target, { pointerId: 1, button: 0, clientX: from.x, clientY: from.y })
  for (const point of [...moves, to]) {
    fireEvent.pointerMove(handles(), { pointerId: 1, clientX: point.x, clientY: point.y })
  }
  fireEvent.pointerUp(handles(), { pointerId: 1, clientX: to.x, clientY: to.y })
}

describe('visual Zoom editor (#413)', () => {
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

  it('opens from the row for that zoom and renders the still once, with the zoom bypassed, at the hold midpoint', async () => {
    render(<App />)
    await placeImageWithZoom()
    // The default zoom: start 0, ramp-in 0.5, hold 1 → midpoint at 1.0 s.
    expect(adjustButton()).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(adjustButton())
    expect(adjustButton()).toHaveAttribute('aria-expanded', 'true')
    const dialog = editor()
    expect(within(dialog).getByRole('img', { name: `Zoom 1 region of ${position}` })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Close the Zoom 1 editor' })).toHaveFocus()
    expect(snapshotMock).toHaveBeenCalledTimes(1)
    const [timeline, sequenceTime] = snapshotMock.mock.calls[0] as [TimelineState, number]
    expect(zoomsOf(timeline)).toEqual([])
    expect(sequenceTime).toBeCloseTo(1.0, 6)
    // The still arrived and is shown.
    expect(await within(dialog).findByTestId('frame-editor-image')).toHaveAttribute(
      'src',
      'blob:frame-still',
    )
    // The rectangle is the zoom's region: scale 2 centred → the middle half.
    expect(region()).toHaveAttribute('x', '100')
    expect(region()).toHaveAttribute('y', '56.25')
    expect(region()).toHaveAttribute('width', '200')
    expect(region()).toHaveAttribute('height', '112.5')
  })

  it('a drag inside the region moves the centre live and commits once on release, as one undo step', async () => {
    render(<App />)
    await placeImageWithZoom()
    await userEvent.click(adjustButton())
    const liveX = () => within(editor()).getByRole('status', { name: 'Zoom 1 centre X (live)' })

    // Press at the region's middle (200, 112.5), move right by 40 px (0.1
    // of the frame) — the readout follows before release, the field after.
    fireEvent.pointerDown(region(), { pointerId: 1, button: 0, clientX: 200, clientY: 112.5 })
    fireEvent.pointerMove(handles(), { pointerId: 1, clientX: 220, clientY: 112.5 })
    expect(liveX()).toHaveTextContent('0.55')
    expect(centreX()).toHaveValue(0.5)
    fireEvent.pointerMove(handles(), { pointerId: 1, clientX: 240, clientY: 112.5 })
    expect(liveX()).toHaveTextContent('0.6')
    fireEvent.pointerUp(handles(), { pointerId: 1, clientX: 240, clientY: 112.5 })

    expect(centreX()).toHaveValue(0.6)
    expect(centreY()).toHaveValue(0.5)
    expect(scaleField()).toHaveValue(2)
    // The still was not re-rendered by the edit.
    expect(snapshotMock).toHaveBeenCalledTimes(1)
    // One gesture, one undo step: the add-zoom is the step before it.
    await userEvent.click(undoButton())
    expect(centreX()).toHaveValue(0.5)
    await userEvent.click(screen.getByRole('button', { name: 'Redo timeline edit' }))
    expect(centreX()).toHaveValue(0.6)
  })

  it('a drag past the frame clamps the region inside it', async () => {
    render(<App />)
    await placeImageWithZoom()
    await userEvent.click(adjustButton())
    drag(region(), { x: 200, y: 112.5 }, { x: 700, y: 900 })
    // At scale 2 the centre can go no further than 0.75 on either axis.
    expect(centreX()).toHaveValue(0.75)
    expect(centreY()).toHaveValue(0.75)
  })

  it('a corner drag changes the scale about the centre, and the floor is never a rejected scale', async () => {
    render(<App />)
    await placeImageWithZoom()
    await userEvent.click(adjustButton())
    // The SE corner sits at (300, 168.75); dragging it to (280, 157.5) — 0.7
    // of the frame on both axes — makes the half-size 0.2 → scale 2.5.
    drag(screen.getByTestId('frame-editor-corner-se'), { x: 300, y: 168.75 }, { x: 280, y: 157.5 })
    expect(scaleField()).toHaveValue(2.5)
    expect(centreX()).toHaveValue(0.5)
    // Dragged out past the frame: the editor's floor, still above 1.
    drag(screen.getByTestId('frame-editor-corner-nw'), { x: 120, y: 67.5 }, { x: -50, y: -50 })
    expect(scaleField()).toHaveValue(1.05)
  })

  it('a release without movement changes nothing and records no step', async () => {
    render(<App />)
    await placeImageWithZoom()
    await userEvent.click(adjustButton())
    drag(region(), { x: 200, y: 112.5 }, { x: 200, y: 112.5 })
    expect(centreX()).toHaveValue(0.5)
    // The only step to undo is the zoom's addition itself.
    await userEvent.click(undoButton())
    expect(screen.queryByRole('spinbutton', { name: `Zoom 1 scale of ${position}` })).not.toBeInTheDocument()
  })

  it('closes on Escape, on its Close button, and on the row button again', async () => {
    render(<App />)
    await placeImageWithZoom()
    await userEvent.click(adjustButton())
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: /Adjust Zoom 1/ })).not.toBeInTheDocument()
    expect(adjustButton()).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(adjustButton())
    await userEvent.click(within(editor()).getByRole('button', { name: 'Close the Zoom 1 editor' }))
    expect(screen.queryByRole('dialog', { name: /Adjust Zoom 1/ })).not.toBeInTheDocument()

    await userEvent.click(adjustButton())
    expect(editor()).toBeInTheDocument()
    await userEvent.click(adjustButton())
    expect(screen.queryByRole('dialog', { name: /Adjust Zoom 1/ })).not.toBeInTheDocument()
    // Each opening rendered the still afresh; nothing else did.
    expect(snapshotMock).toHaveBeenCalledTimes(3)
  })

  it('the row keeps working while the editor is open: a typed centre moves the region', async () => {
    render(<App />)
    await placeImageWithZoom()
    await userEvent.click(adjustButton())
    await userEvent.clear(centreX())
    await userEvent.type(centreX(), '0.3{Enter}')
    expect(centreX()).toHaveValue(0.3)
    // 0.3 − 0.25 = 0.05 of the frame's 400 px.
    expect(region()).toHaveAttribute('x', '20')
  })

  it('a failed render says so in the editor instead of hanging', async () => {
    snapshotMock.mockRejectedValue(new Error('A source clip failed to load for the frame snapshot.'))
    render(<App />)
    await placeImageWithZoom()
    await userEvent.click(adjustButton())
    expect(await within(editor()).findByRole('alert')).toHaveTextContent('failed to load')
  })
})

describe('the Zoom editor\'s scrub, snapping, keys and result view (#421)', () => {
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

  /** The default zoom's envelope is 0 → 2 s, holding from 0.5 to 1.5. */
  const scrubSlider = () =>
    screen.getByRole('slider', { name: `Preview time of Zoom 1 of ${position} in seconds` })
  const resultToggle = () => screen.getByRole('checkbox', { name: 'Show result' })
  const scrubTo = async (value: string) => {
    fireEvent.change(scrubSlider(), { target: { value } })
    // The still for a new instant is rendered off a promise; let it land.
    await screen.findByTestId('frame-editor-image')
  }
  /** The sequence times the editor has asked to have rendered, in order. */
  const renderedTimes = () => snapshotMock.mock.calls.map((call) => call[1] as number)

  it('spans the zoom\'s whole envelope and opens at the hold midpoint', async () => {
    render(<App />)
    await placeImageWithZoom()
    await userEvent.click(adjustButton())

    const slider = scrubSlider()
    expect(slider).toHaveAttribute('min', '0')
    expect(slider).toHaveAttribute('max', '2')
    expect(slider).toHaveValue('1')
    expect(within(editor()).getByRole('status', { name: 'Zoom 1 preview time (live)' }))
      .toHaveTextContent('1.00 s')
    expect(renderedTimes()).toEqual([1])
  })

  it('scrubs into a ramp: the region shrinks to what plays there, and stops taking drags', async () => {
    render(<App />)
    await placeImageWithZoom()
    await userEvent.click(adjustButton())
    // Held: the middle half of the frame, and the corner handles are there.
    expect(region()).toHaveAttribute('width', '200')
    expect(screen.getByTestId('frame-editor-corner-se')).toBeInTheDocument()

    // Half way through the 0.5 s ramp-in: smoothstep(0.5) = 0.5, so the
    // magnification is 1.5 and the region is two thirds of the frame —
    // between the whole frame and the held region, as it plays.
    await scrubTo('0.25')
    expect(region()).toHaveAttribute('width', '266.67')
    expect(region()).toHaveAttribute('x', '66.67')
    // Nothing to grab where the region is only passing through.
    expect(screen.queryByTestId('frame-editor-corner-se')).not.toBeInTheDocument()
    expect(region()).not.toHaveAttribute('tabindex')
    expect(within(editor()).getByText(/part-way through a ramp/)).toBeInTheDocument()

    // At the very start of the envelope the zoom has not begun: whole frame.
    await scrubTo('0')
    expect(region()).toHaveAttribute('width', '400')
    expect(region()).toHaveAttribute('x', '0')

    // Back into the hold and the handles come back.
    await scrubTo('1.2')
    expect(region()).toHaveAttribute('width', '200')
    expect(screen.getByTestId('frame-editor-corner-se')).toBeInTheDocument()
  })

  it('renders each instant once and keeps the previous still up while the next arrives', async () => {
    let release: ((blob: Blob) => void) | null = null
    snapshotMock.mockImplementation(
      () =>
        new Promise<Blob>((resolve) => {
          release = resolve
        }),
    )
    render(<App />)
    await placeImageWithZoom()
    await userEvent.click(adjustButton())
    // The first still: nothing to show until it lands.
    expect(screen.getByTestId('frame-editor-pending')).toBeInTheDocument()
    release!(new Blob(['png'], { type: 'image/png' }))
    const still = await screen.findByTestId('frame-editor-image')

    fireEvent.change(scrubSlider(), { target: { value: '0.25' } })
    // The next still is in flight and the previous one has not gone away —
    // scrubbing shows motion rather than flashing black.
    expect(screen.getByTestId('frame-editor-image')).toBe(still)
    expect(screen.getByTestId('frame-editor-updating')).toBeInTheDocument()
    release!(new Blob(['png'], { type: 'image/png' }))
    await screen.findByTestId('frame-editor-image')
    expect(screen.queryByTestId('frame-editor-updating')).not.toBeInTheDocument()
    expect(renderedTimes()).toEqual([1, 0.25])

    // Somewhere new renders; somewhere already drawn does not, in either
    // direction — the cache is what makes scrubbing back and forth cheap.
    fireEvent.change(scrubSlider(), { target: { value: '1' } })
    fireEvent.change(scrubSlider(), { target: { value: '0.25' } })
    fireEvent.change(scrubSlider(), { target: { value: '1' } })
    expect(renderedTimes()).toEqual([1, 0.25])
  })

  it('snaps a dragged centre onto the frame centre, showing the guide, and Alt bypasses it', async () => {
    render(<App />)
    await placeImageWithZoom()
    await userEvent.clear(centreX())
    await userEvent.type(centreX(), '0.6{Enter}')
    await userEvent.click(adjustButton())
    // The region's middle is at 0.6 of 400 px; a 36 px drag left lands the
    // centre on 0.51 — inside the 0.02 snap zone of the frame centre.
    const from = { x: 240, y: 112.5 }
    const to = { x: 204, y: 112.5 }

    fireEvent.pointerDown(region(), { pointerId: 1, button: 0, clientX: from.x, clientY: from.y })
    fireEvent.pointerMove(handles(), { pointerId: 1, clientX: to.x, clientY: to.y })
    // Snapped, and the guide says which alignment is being held.
    expect(within(editor()).getByRole('status', { name: 'Zoom 1 centre X (live)' })).toHaveTextContent(
      '0.5',
    )
    expect(screen.getByTestId('frame-editor-guide-x')).toBeInTheDocument()
    fireEvent.pointerUp(handles(), { pointerId: 1, clientX: to.x, clientY: to.y })
    expect(centreX()).toHaveValue(0.5)
    // The guides belong to the gesture: none once the pointer is up, even
    // though the centre is still sitting on one.
    expect(screen.queryByTestId('frame-editor-guide-x')).not.toBeInTheDocument()

    // The same drag with Alt held keeps the 0.51 it was dragged to.
    await userEvent.clear(centreX())
    await userEvent.type(centreX(), '0.6{Enter}')
    fireEvent.pointerDown(region(), { pointerId: 1, button: 0, clientX: from.x, clientY: from.y })
    fireEvent.pointerMove(handles(), { pointerId: 1, clientX: to.x, clientY: to.y, altKey: true })
    expect(screen.queryByTestId('frame-editor-guide-x')).not.toBeInTheDocument()
    fireEvent.pointerUp(handles(), { pointerId: 1, clientX: to.x, clientY: to.y })
    expect(centreX()).toHaveValue(0.51)
  })

  it('nudges with the arrow keys and steps the scale with + and −, one undo each', async () => {
    render(<App />)
    await placeImageWithZoom()
    await userEvent.click(adjustButton())

    region().focus()
    expect(region()).toHaveFocus()
    // The rectangle says how to drive it, for whoever arrives on it by Tab.
    const hintId = region().getAttribute('aria-describedby')
    expect(document.getElementById(hintId ?? '')).toHaveTextContent(/Arrow keys nudge/)

    fireEvent.keyDown(region(), { key: 'ArrowRight' })
    expect(centreX()).toHaveValue(0.51)
    fireEvent.keyDown(region(), { key: 'ArrowRight' })
    expect(centreX()).toHaveValue(0.52)
    fireEvent.keyDown(region(), { key: 'ArrowUp', shiftKey: true })
    expect(centreY()).toHaveValue(0.45)
    fireEvent.keyDown(region(), { key: '+' })
    expect(scaleField()).toHaveValue(2.1)

    // One press, one step: undo walks back through them one at a time.
    await userEvent.click(undoButton())
    expect(scaleField()).toHaveValue(2)
    await userEvent.click(undoButton())
    expect(centreY()).toHaveValue(0.5)
    await userEvent.click(undoButton())
    expect(centreX()).toHaveValue(0.51)

    // A key the editor does not take is left alone: Escape from the focused
    // rectangle still reaches the panel and closes it.
    region().focus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: /Adjust Zoom 1/ })).not.toBeInTheDocument()
  })

  it('a nudge held against the frame edge commits nothing rather than an empty step', async () => {
    render(<App />)
    await placeImageWithZoom()
    await userEvent.clear(centreX())
    await userEvent.type(centreX(), '0.75{Enter}')
    await userEvent.click(adjustButton())

    region().focus()
    fireEvent.keyDown(region(), { key: 'ArrowRight' })
    expect(centreX()).toHaveValue(0.75)
    // The step before this one is the typed 0.75, not a no-op nudge.
    await userEvent.click(undoButton())
    expect(centreX()).toHaveValue(0.5)
  })

  it('Show result draws the zoom instead of bypassing it, and takes the handles away', async () => {
    render(<App />)
    await placeImageWithZoom()
    await userEvent.click(adjustButton())
    // Editing view: the still is the source with this zoom left out.
    expect(zoomsOf(snapshotMock.mock.calls[0][0] as TimelineState)).toEqual([])

    await userEvent.click(resultToggle())
    expect(resultToggle()).toBeChecked()
    // The zoom is in the timeline that was drawn, at the scrubbed instant.
    const [resultTimeline, resultTime] = snapshotMock.mock.calls.at(-1) as [TimelineState, number]
    expect(zoomsOf(resultTimeline)).toHaveLength(1)
    expect(resultTime).toBeCloseTo(1, 6)
    // Nothing to drag, and no region drawn over a frame that is the region.
    expect(screen.queryByTestId('frame-editor-rect')).not.toBeInTheDocument()
    expect(screen.queryByTestId('frame-editor-handles')).not.toBeInTheDocument()

    // A committed edit refreshes the result, where it deliberately does not
    // refresh the editing still: the point of the view is what it looks like.
    const before = snapshotMock.mock.calls.length
    await userEvent.clear(centreX())
    await userEvent.type(centreX(), '0.6{Enter}')
    expect(snapshotMock.mock.calls.length).toBe(before + 1)

    await userEvent.click(resultToggle())
    expect(region()).toBeInTheDocument()
  })
})

describe('the Visual editors setting (#413)', () => {
  beforeEach(() => {
    probeMock.mockReset()
    snapshotMock.mockReset()
    snapshotMock.mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is on by default, and Off removes every Adjust visually… button without rendering a frame', async () => {
    render(<App />)
    await placeImageWithZoom()
    expect(adjustButton()).toBeInTheDocument()

    await chooseFromFileMenu('Settings…')
    const dialog = screen.getByRole('dialog', { name: 'Settings' })
    const select = within(dialog).getByLabelText('Visual editors')
    expect(select).toHaveValue('on')
    await userEvent.selectOptions(select, 'off')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('button', { name: /Adjust Zoom 1 .* visually/ })).not.toBeInTheDocument()
    expect(snapshotMock).not.toHaveBeenCalled()
    // Persisted per device, under the settings key.
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')).toMatchObject({
      visualEditors: false,
    })
  })

  it('an open editor closes when the switch turns Off', async () => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:frame-still'),
      revokeObjectURL: vi.fn(),
    })
    render(<App />)
    await placeImageWithZoom()
    await userEvent.click(adjustButton())
    expect(editor()).toBeInTheDocument()
    await chooseFromFileMenu('Settings…')
    await userEvent.selectOptions(
      within(screen.getByRole('dialog', { name: 'Settings' })).getByLabelText('Visual editors'),
      'off',
    )
    expect(screen.queryByRole('dialog', { name: /Adjust Zoom 1/ })).not.toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('a stored setting from before the switch existed reads as on', async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ stepSeconds: 0.25, exportFormat: 'webm' }))
    render(<App />)
    // The parse rule itself is pinned in settings.test.ts; here the dialog
    // shows what a returning visitor sees.
    await chooseFromFileMenu('Settings…')
    expect(
      within(screen.getByRole('dialog', { name: 'Settings' })).getByLabelText('Visual editors'),
    ).toHaveValue('on')
  })
})
