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
  await userEvent.click(screen.getByRole('button', { name: `Add zoom to ${position}` }))
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
