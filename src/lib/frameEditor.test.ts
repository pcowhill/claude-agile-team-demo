import { describe, expect, it } from 'vitest'
import {
  FREE_RECT_HANDLES,
  MAX_EDITOR_ZOOM_SCALE,
  MIN_EDITOR_ZOOM_SCALE,
  RECT_SIZE_STEP,
  RECT_SNAP_CENTRES,
  ZOOM_NUDGE,
  ZOOM_NUDGE_LARGE,
  ZOOM_SCALE_STEP,
  ZOOM_SNAP_TARGETS,
  ZOOM_SNAP_TOLERANCE,
  clampedRect,
  movedRect,
  movedZoom,
  overlayEditorSequenceTime,
  overlayRect,
  rectAfterGesture,
  rectAfterKeyStep,
  rectGuides,
  rectKeyStep,
  resizedRect,
  resizedZoom,
  scaledZoom,
  snappedRect,
  snappedZoom,
  withoutOverlay,
  withoutZoom,
  zoomAfterGesture,
  zoomAfterKeyStep,
  zoomEditorSequenceTime,
  zoomEnvelope,
  zoomFromRect,
  zoomGuides,
  zoomHoldMidpoint,
  zoomIsFullAt,
  zoomRect,
  zoomRectAt,
} from './frameEditor'
import { DEFAULT_ZOOM, timelineReducer, videoOverlaysOf, zoomsOf } from './timeline'
import type { TimelineState, ZoomSpec } from './timeline'
import { MAX_OVERLAY_SIZE, MIN_OVERLAY_SIZE } from './videoOverlay'
import type { VideoOverlay } from './videoOverlay'
import { zoomAt } from './zoom'

const zoom: ZoomSpec = { ...DEFAULT_ZOOM, scale: 2, centerX: 0.5, centerY: 0.5 }

/** The bounds the overlay editor works in — the reducer's own. */
const BOUNDS = { minSize: MIN_OVERLAY_SIZE, maxSize: MAX_OVERLAY_SIZE }

const overlay = (fields: Partial<VideoOverlay> = {}): VideoOverlay => ({
  id: 'o1',
  clipId: 'clip-cam',
  name: 'cam.mp4',
  duration: 8,
  url: 'blob:cam',
  offset: 0,
  inPoint: 0,
  outPoint: 8,
  x: 0.6,
  y: 0.6,
  width: 0.3,
  height: 0.2,
  ...fields,
})

const entry = (id: string, duration: number) => ({
  id,
  clipId: `clip-${id}`,
  name: `${id}.mp4`,
  duration,
  url: `blob:${id}`,
  inPoint: 0,
  outPoint: duration,
})

describe('zoom rectangle geometry (#413)', () => {
  it('a zoom at scale 2 centred on the frame shows the middle half of it', () => {
    expect(zoomRect(zoom)).toEqual({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 })
  })

  it('the rectangle has the frame aspect by construction and inverts back to the zoom', () => {
    const spec = { ...zoom, scale: 2.5, centerX: 0.3, centerY: 0.6 }
    const rect = zoomRect(spec)
    expect(rect.width).toBe(rect.height)
    expect(zoomFromRect(rect)).toEqual({ scale: 2.5, centerX: 0.3, centerY: 0.6 })
  })

  it('moving keeps the region inside the frame: the centre stops at the edge allowance', () => {
    // At scale 2 the region extends 0.25 from its centre: the centre may
    // travel only within [0.25, 0.75].
    expect(movedZoom(zoom, 0.1, -0.05)).toMatchObject({ centerX: 0.6, centerY: 0.45 })
    expect(movedZoom(zoom, 0.5, 0.5)).toMatchObject({ centerX: 0.75, centerY: 0.75 })
    expect(movedZoom(zoom, -1, -1)).toMatchObject({ centerX: 0.25, centerY: 0.25 })
    // Timing is untouched by a move.
    expect(movedZoom(zoom, 0.1, 0)).toMatchObject({
      start: zoom.start,
      rampIn: zoom.rampIn,
      hold: zoom.hold,
      rampOut: zoom.rampOut,
      scale: 2,
    })
  })

  it('a corner dragged inward magnifies, outward relaxes, about the centre', () => {
    // The SE corner sits at (0.75, 0.75); dragged to (0.7, 0.7) the half-size
    // is 0.2, so the scale is 1 / 0.4 = 2.5.
    expect(resizedZoom(zoom, { x: 0.7, y: 0.7 })).toMatchObject({
      scale: 2.5,
      centerX: 0.5,
      centerY: 0.5,
    })
    // Dragged to (0.9, 0.9): half-size 0.4, scale 1.25.
    expect(resizedZoom(zoom, { x: 0.9, y: 0.9 })).toMatchObject({ scale: 1.25 })
    // The larger axis distance decides (aspect stays locked).
    expect(resizedZoom(zoom, { x: 0.7, y: 0.9 })).toMatchObject({ scale: 1.25 })
  })

  it('a corner dragged past the frame lands on the scale floor, never on a rejected scale', () => {
    const relaxed = resizedZoom(zoom, { x: 1.5, y: 1.5 })
    expect(relaxed.scale).toBe(MIN_EDITOR_ZOOM_SCALE)
    expect(relaxed.scale).toBeGreaterThan(1)
    // …and the centre is re-clamped for the larger region.
    const offCentre = resizedZoom({ ...zoom, centerX: 0.7, centerY: 0.3 }, { x: 2, y: 2 })
    const half = 1 / (2 * MIN_EDITOR_ZOOM_SCALE)
    expect(offCentre.centerX).toBeCloseTo(1 - half, 3)
    expect(offCentre.centerY).toBeCloseTo(half, 3)
  })

  it('a corner dragged onto the centre lands on the scale ceiling', () => {
    expect(resizedZoom(zoom, { x: 0.5, y: 0.5 }).scale).toBe(MAX_EDITOR_ZOOM_SCALE)
    expect(resizedZoom(zoom, { x: 0.501, y: 0.5 }).scale).toBe(MAX_EDITOR_ZOOM_SCALE)
  })

  it('a rectangle pinned to a frame corner inverts to a centre the reducer keeps', () => {
    const pinned = zoomFromRect({ x: 0, y: 0, width: 0.4, height: 0.4 })
    expect(pinned).toEqual({ scale: 2.5, centerX: 0.2, centerY: 0.2 })
    // Past the frame: the centre is pulled back inside.
    expect(zoomFromRect({ x: -0.1, y: 0.8, width: 0.4, height: 0.4 })).toEqual({
      scale: 2.5,
      centerX: 0.2,
      centerY: 0.8,
    })
  })

  it('rounds to what the row fields show: scale to 2 decimals, centres to 3', () => {
    const moved = movedZoom(zoom, 0.123456, 0)
    expect(moved.centerX).toBe(0.623)
    expect(resizedZoom(zoom, { x: 0.5 + 0.21234, y: 0.5 }).scale).toBe(2.35)
  })

  it('zoomAfterGesture dispatches on the gesture kind', () => {
    expect(zoomAfterGesture(zoom, { kind: 'move', dx: 0.1, dy: 0 })).toEqual(
      movedZoom(zoom, 0.1, 0),
    )
    expect(zoomAfterGesture(zoom, { kind: 'corner', corner: 'se', x: 0.7, y: 0.7 })).toEqual(
      resizedZoom(zoom, { x: 0.7, y: 0.7 }),
    )
  })
})

describe('snapping the centre while dragging (#421)', () => {
  it('pulls a centre inside the tolerance onto the frame centre or a third', () => {
    expect(snappedZoom({ ...zoom, centerX: 0.51, centerY: 0.5 }).centerX).toBe(0.5)
    expect(snappedZoom({ ...zoom, centerX: 0.345, centerY: 0.5 }).centerX).toBe(0.333)
    expect(snappedZoom({ ...zoom, centerX: 0.5, centerY: 0.655 }).centerY).toBe(0.667)
  })

  it('leaves a centre outside the tolerance exactly where it was', () => {
    // 0.02 is the reach, so 0.525 is 0.025 from the centre and 0.142 from a
    // third: nothing is near enough to pull it.
    expect(snappedZoom({ ...zoom, centerX: 0.525, centerY: 0.5 }).centerX).toBe(0.525)
    // …and the boundary itself snaps, so the tolerance is inclusive rather
    // than a hair short of what it advertises.
    expect(snappedZoom({ ...zoom, centerX: 0.5 + ZOOM_SNAP_TOLERANCE, centerY: 0.5 }).centerX).toBe(
      0.5,
    )
  })

  it('never snaps somewhere the region cannot sit, and says so in the guides', () => {
    // At scale 1.05 the region is nearly the whole frame: the centre can
    // only move ±0.024, so a third is unreachable however near the pointer
    // came. The snap is applied and the clamp takes it straight back.
    const wide = { ...zoom, scale: 1.05, centerX: 0.34, centerY: 0.5 }
    const snapped = snappedZoom(wide)
    expect(snapped.centerX).toBe(0.476)
    expect(zoomGuides(snapped).x).toBeNull()
    // The same drag at scale 2, where a third does fit, does light the guide.
    expect(zoomGuides(snappedZoom({ ...zoom, centerX: 0.34, centerY: 0.5 })).x).toBe(1 / 3)
  })

  it('reads the guides off the centre itself, both axes independently', () => {
    expect(zoomGuides({ centerX: 0.5, centerY: 0.667 })).toEqual({ x: 0.5, y: 2 / 3 })
    expect(zoomGuides({ centerX: 0.6, centerY: 0.4 })).toEqual({ x: null, y: null })
    expect(ZOOM_SNAP_TARGETS).toEqual([1 / 3, 0.5, 2 / 3])
  })

  it('snaps a move gesture unless Alt bypasses it, and never a corner drag', () => {
    // A move landing at 0.51 is pulled to 0.5…
    const near = { kind: 'move', dx: 0.01, dy: 0 } as const
    expect(zoomAfterGesture({ ...zoom, centerX: 0.5 }, near).centerX).toBe(0.5)
    expect(zoomAfterGesture({ ...zoom, centerX: 0.505 }, near).centerX).toBe(0.5)
    // …and left alone with Alt held (#391's convention).
    expect(zoomAfterGesture({ ...zoom, centerX: 0.505 }, { ...near, altKey: true }).centerX).toBe(
      0.515,
    )
    // A corner drag holds the centre by construction, so it is unchanged by
    // snapping either way.
    const corner = { kind: 'corner', corner: 'se', x: 0.7, y: 0.7 } as const
    expect(zoomAfterGesture(zoom, corner)).toEqual(resizedZoom(zoom, { x: 0.7, y: 0.7 }))
  })
})

describe('nudging with the keyboard (#421)', () => {
  it('reads a step off the key, with Shift five times as far', () => {
    expect(rectKeyStep({ key: 'ArrowRight' })).toEqual({ kind: 'move', dx: ZOOM_NUDGE, dy: 0 })
    expect(rectKeyStep({ key: 'ArrowLeft' })).toEqual({ kind: 'move', dx: -ZOOM_NUDGE, dy: 0 })
    expect(rectKeyStep({ key: 'ArrowUp' })).toEqual({ kind: 'move', dx: 0, dy: -ZOOM_NUDGE })
    expect(rectKeyStep({ key: 'ArrowDown', shiftKey: true })).toEqual({
      kind: 'move',
      dx: 0,
      dy: ZOOM_NUDGE_LARGE,
    })
    expect(ZOOM_NUDGE_LARGE).toBe(ZOOM_NUDGE * 5)
  })

  it('takes + and − however the keyboard spells them, and nothing else', () => {
    for (const key of ['+', '=', 'Add']) {
      expect(rectKeyStep({ key })).toEqual({ kind: 'scale', delta: ZOOM_SCALE_STEP })
    }
    for (const key of ['-', '_', 'Subtract']) {
      expect(rectKeyStep({ key })).toEqual({ kind: 'scale', delta: -ZOOM_SCALE_STEP })
    }
    // Anything the editor does not take is left for the panel around it —
    // Escape closes the editor, Tab moves on.
    for (const key of ['Escape', 'Tab', 'a', 'Enter', ' ']) {
      expect(rectKeyStep({ key })).toBeNull()
    }
  })

  it('a nudge clamps at the frame edge like a drag does', () => {
    // At scale 2 the centre stops at 0.75; ten nudges of 0.05 would reach
    // 1.0 without the clamp.
    let nudged = { ...zoom, centerX: 0.7, centerY: 0.5 }
    for (let i = 0; i < 10; i++) {
      nudged = zoomAfterKeyStep(nudged, { kind: 'move', dx: ZOOM_NUDGE_LARGE, dy: 0 })
    }
    expect(nudged.centerX).toBe(0.75)
    expect(nudged).toEqual(movedZoom({ ...zoom, centerX: 0.75, centerY: 0.5 }, 0, 0))
  })

  it('a scale step stays inside the range a drag is held to, and re-fits the centre', () => {
    expect(scaledZoom(zoom, ZOOM_SCALE_STEP).scale).toBe(2.1)
    expect(scaledZoom(zoom, -ZOOM_SCALE_STEP).scale).toBe(1.9)
    // The reducer rejects scale ≤ 1, so a key press must not propose one.
    expect(scaledZoom({ ...zoom, scale: MIN_EDITOR_ZOOM_SCALE }, -ZOOM_SCALE_STEP).scale).toBe(
      MIN_EDITOR_ZOOM_SCALE,
    )
    expect(scaledZoom({ ...zoom, scale: MAX_EDITOR_ZOOM_SCALE }, ZOOM_SCALE_STEP).scale).toBe(
      MAX_EDITOR_ZOOM_SCALE,
    )
    // Zooming out from a corner-parked region pulls the centre back in: at
    // scale 4 the centre may sit at 0.875, at 3.9 only at 0.872.
    const parked = { ...zoom, scale: 4, centerX: 0.875, centerY: 0.875 }
    expect(scaledZoom(parked, -ZOOM_SCALE_STEP)).toMatchObject({
      scale: 3.9,
      centerX: 0.872,
      centerY: 0.872,
    })
  })

  it('a key step and a drag reach the same numbers, through one clamp', () => {
    expect(zoomAfterKeyStep(zoom, { kind: 'move', dx: 0.1, dy: -0.1 })).toEqual(
      movedZoom(zoom, 0.1, -0.1),
    )
    expect(zoomAfterKeyStep(zoom, { kind: 'scale', delta: 0.5 })).toEqual(scaledZoom(zoom, 0.5))
  })
})

describe('the scrub across the envelope (#421)', () => {
  const ramped: ZoomSpec = { ...zoom, start: 1, rampIn: 0.5, hold: 2, rampOut: 0.5, scale: 2 }

  it('spans the whole envelope, from the zoom-in to the end of the zoom-out', () => {
    expect(zoomEnvelope(ramped)).toEqual({ start: 1, end: 4 })
    // The slider opens at the hold midpoint, which is inside its own range.
    const midpoint = zoomHoldMidpoint(ramped)
    expect(midpoint).toBeGreaterThan(zoomEnvelope(ramped).start)
    expect(midpoint).toBeLessThan(zoomEnvelope(ramped).end)
  })

  it('draws the whole frame at either end and the full region across the hold', () => {
    expect(zoomRectAt(ramped, 1)).toEqual({ x: 0, y: 0, width: 1, height: 1 })
    expect(zoomRectAt(ramped, 4)).toEqual({ x: 0, y: 0, width: 1, height: 1 })
    expect(zoomRectAt(ramped, 2.5)).toEqual(zoomRect(ramped))
    expect(zoomIsFullAt(ramped, 2.5)).toBe(true)
    expect(zoomIsFullAt(ramped, 1.25)).toBe(false)
    expect(zoomIsFullAt(ramped, 0.5)).toBe(false)
  })

  it('draws a partial region mid-ramp — half way in, half the magnification', () => {
    // smoothstep(0.5) = 0.5, so scale is 1.5 and the region is 2/3 of the
    // frame: strictly between the whole frame and the held region.
    const partial = zoomRectAt(ramped, 1.25)
    expect(partial.width).toBeCloseTo(2 / 3, 10)
    expect(partial.width).toBeGreaterThan(zoomRect(ramped).width)
    expect(partial.width).toBeLessThan(1)
  })

  it('agrees with what the preview and the export show at the same instant', () => {
    // The helper takes an offset into the entry; `zoomAt` takes a source
    // time on a real timeline. The two must describe one motion — this is
    // the wiring (the entry in-point and `zoom.start` offsets) rather than
    // the easing, which they share.
    const state: TimelineState = {
      entries: [{ ...entry('a', 12), inPoint: 2, outPoint: 12 }],
      transitions: [],
    }
    const withZoom = timelineReducer(state, {
      type: 'zoom-added',
      zoom: { ...ramped, id: 'z1', entryId: 'a', centerX: 0.6, centerY: 0.4 },
    })
    const spec = { ...ramped, centerX: 0.6, centerY: 0.4 }
    for (const offset of [1, 1.1, 1.25, 1.4, 1.5, 2.5, 3.5, 3.75, 4]) {
      expect(zoomRectAt(spec, offset)).toEqual(zoomRect(zoomAt(withZoom, 0, 2 + offset)))
    }
  })

  it('takes a still at any instant of the envelope, not only the midpoint', () => {
    const state: TimelineState = {
      entries: [entry('a', 10), { ...entry('b', 10), inPoint: 2, outPoint: 8 }],
      transitions: [],
    }
    // Entry b starts at 10 s of sequence and is trimmed to start at 2 s of
    // its source, so 1.25 s into it is 11.25 s of sequence.
    expect(zoomEditorSequenceTime(state, 1, ramped, 1.25)).toBe(11.25)
    // Omitted, the offset is still the hold midpoint #413 opens at.
    expect(zoomEditorSequenceTime(state, 1, ramped)).toBe(zoomEditorSequenceTime(state, 1, ramped, 2.5))
  })
})

describe('the free rectangle: moving and resizing a placement (#422)', () => {
  const rect = { x: 0.6, y: 0.6, width: 0.3, height: 0.2 }

  it("reads a placement's rectangle off its own fields", () => {
    expect(overlayRect(overlay())).toEqual(rect)
    // An overlay carries far more than a rectangle; only these four come.
    expect(Object.keys(overlayRect(overlay()))).toEqual(['x', 'y', 'width', 'height'])
  })

  it('clamps size into its bounds first, then position into what the size leaves', () => {
    // The reducer's order (`clampVideoOverlay`): a rectangle grown past the
    // frame is pulled back on, not shrunk.
    expect(clampedRect({ x: 0.9, y: 0.9, width: 0.4, height: 0.4 }, BOUNDS)).toEqual({
      x: 0.6,
      y: 0.6,
      width: 0.4,
      height: 0.4,
    })
    // Below the floor, a typo cannot store an invisible sliver.
    expect(clampedRect({ x: 0.5, y: 0.5, width: 0.001, height: 0.001 }, BOUNDS)).toMatchObject({
      width: MIN_OVERLAY_SIZE,
      height: MIN_OVERLAY_SIZE,
    })
    // Rounding is to a hundredth, and the position is clamped against the
    // *rounded* size, so a flush rectangle stays flush.
    const flush = clampedRect({ x: 0.9999, y: 0, width: 0.1004, height: 0.5 }, BOUNDS)
    expect(flush).toEqual({ x: 0.9, y: 0, width: 0.1, height: 0.5 })
    expect(flush.x + flush.width).toBe(1)
  })

  it('moves by a fraction of the frame, kept fully on it', () => {
    expect(movedRect(rect, 0.05, -0.05, BOUNDS)).toMatchObject({ x: 0.65, y: 0.55 })
    // Dragged off the right edge, it stops flush against it — and its size
    // is untouched, which is what distinguishes a move from a resize.
    const pushed = movedRect(rect, 0.5, 0.5, BOUNDS)
    expect(pushed).toEqual({ x: 0.7, y: 0.8, width: 0.3, height: 0.2 })
  })

  it('resizes from a corner with the opposite corner held fixed', () => {
    // The se corner dragged out: nw stays at (0.6, 0.6) and the size grows.
    expect(resizedRect(rect, 'se', { x: 0.95, y: 0.9 }, BOUNDS)).toEqual({
      x: 0.6,
      y: 0.6,
      width: 0.35,
      height: 0.3,
    })
    // The nw corner dragged: the se corner (0.9, 0.8) is what stays.
    expect(resizedRect(rect, 'nw', { x: 0.5, y: 0.5 }, BOUNDS)).toEqual({
      x: 0.5,
      y: 0.5,
      width: 0.4,
      height: 0.3,
    })
  })

  it('resizes from an edge, changing that dimension and nothing else', () => {
    // The whole point of an edge handle, and the thing a centre-fixed
    // resize (the zoom's) cannot express.
    expect(resizedRect(rect, 'e', { x: 0.8, y: 0.2 }, BOUNDS)).toEqual({
      x: 0.6,
      y: 0.6,
      width: 0.2,
      height: 0.2,
    })
    expect(resizedRect(rect, 'w', { x: 0.5, y: 0.9 }, BOUNDS)).toEqual({
      x: 0.5,
      y: 0.6,
      width: 0.4,
      height: 0.2,
    })
    expect(resizedRect(rect, 's', { x: 0.1, y: 0.9 }, BOUNDS)).toEqual({
      x: 0.6,
      y: 0.6,
      width: 0.3,
      height: 0.3,
    })
    expect(resizedRect(rect, 'n', { x: 0.1, y: 0.5 }, BOUNDS)).toEqual({
      x: 0.6,
      y: 0.5,
      width: 0.3,
      height: 0.3,
    })
  })

  it('never lets a handle cross the edge it is measured from, or leave the frame', () => {
    // Dragged past the fixed edge, the rectangle stops at the floor instead
    // of flipping inside out.
    expect(resizedRect(rect, 'e', { x: 0.1, y: 0.5 }, BOUNDS)).toMatchObject({
      x: 0.6,
      width: MIN_OVERLAY_SIZE,
    })
    // Dragged past the frame, it stops at the border: the nw corner pulled
    // off the top-left keeps the se corner and grows only to the frame.
    expect(resizedRect(rect, 'nw', { x: -0.5, y: -0.5 }, BOUNDS)).toEqual({
      x: 0,
      y: 0,
      width: 0.9,
      height: 0.8,
    })
  })

  it('keeps the aspect on a Shift-held corner, width driving', () => {
    // The 3:2 box (0.3 × 0.2) dragged to a width of 0.4 takes a height of
    // 0.4 / 1.5 — not the 0.3 the pointer's y asked for.
    const locked = resizedRect(rect, 'se', { x: 1, y: 0.9 }, BOUNDS, rect.width / rect.height)
    expect(locked).toMatchObject({ x: 0.6, y: 0.6, width: 0.4 })
    // 0.4 / 1.5 is 0.2667, stored as 0.27 — the ratio survives to the
    // hundredth of a frame a placement is kept at, which is the most the
    // row's own fields can express (`RECT_DECIMALS`).
    expect(locked.height).toBeCloseTo(0.4 / 1.5, 2)
    expect(locked.width / locked.height).toBeCloseTo(rect.width / rect.height, 1)
    // Unlocked, the same drag takes the pointer's own y.
    expect(resizedRect(rect, 'se', { x: 1, y: 0.9 }, BOUNDS)).toMatchObject({
      width: 0.4,
      height: 0.3,
    })
  })

  it('shrinks a locked drag about its fixed corner rather than breaking the ratio', () => {
    // A wide box anchored near the bottom: the width the pointer asks for
    // would need more height than the frame has below the anchor, so the
    // width comes down and the ratio survives.
    const low = { x: 0.1, y: 0.8, width: 0.2, height: 0.1 }
    const locked = resizedRect(low, 'se', { x: 0.9, y: 1 }, BOUNDS, low.width / low.height)
    expect(locked.y + locked.height).toBeLessThanOrEqual(1)
    expect(locked.width / locked.height).toBeCloseTo(low.width / low.height, 1)
    expect(locked.height).toBeCloseTo(0.2, 2)
  })

  it('offers eight handles: four corners and four edges', () => {
    expect([...FREE_RECT_HANDLES].sort()).toEqual(
      ['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w'].sort(),
    )
  })
})

describe('the free rectangle: snapping and guides (#422)', () => {
  it('pulls a near edge flush to the frame', () => {
    // 0.015 from the left border is inside the tolerance the zoom uses.
    expect(snappedRect({ x: 0.015, y: 0.5, width: 0.3, height: 0.2 }, BOUNDS)).toMatchObject({
      x: 0,
    })
    // …and the far edge to the right border, which is the same alignment
    // seen from the other side.
    expect(snappedRect({ x: 0.69, y: 0.5, width: 0.3, height: 0.2 }, BOUNDS)).toMatchObject({
      x: 0.7,
    })
  })

  it('pulls the centre onto a third or the middle, per axis independently', () => {
    const snapped = snappedRect({ x: 0.36, y: 0.24, width: 0.3, height: 0.2 }, BOUNDS)
    // centre x was 0.51 → 0.5; centre y was 0.34 → 1/3.
    expect(snapped.x + snapped.width / 2).toBeCloseTo(0.5, 3)
    expect(snapped.y + snapped.height / 2).toBeCloseTo(1 / 3, 2)
    expect(RECT_SNAP_CENTRES).toEqual(ZOOM_SNAP_TARGETS)
  })

  it('takes the nearest alignment when an edge and a centre both compete', () => {
    // A wide rectangle at x = 0.01: its near edge is 0.01 from the border,
    // its centre 0.14 from the middle. The corner wins, which is what makes
    // a rectangle parked in a corner stay there.
    expect(snappedRect({ x: 0.01, y: 0.5, width: 0.7, height: 0.2 }, BOUNDS)).toMatchObject({
      x: 0,
    })
  })

  it('leaves a rectangle outside the tolerance exactly where it was', () => {
    const free = { x: 0.44, y: 0.44, width: 0.3, height: 0.2 }
    expect(snappedRect(free, BOUNDS)).toEqual(free)
  })

  it('reads guides off the rectangle, an edge winning over a centre', () => {
    expect(rectGuides({ x: 0, y: 0.4, width: 0.3, height: 0.2 })).toEqual({ x: 0, y: 0.5 })
    expect(rectGuides({ x: 0.7, y: 0.1, width: 0.3, height: 0.2 })).toEqual({ x: 1, y: null })
    expect(rectGuides({ x: 0.35, y: 0.55, width: 0.3, height: 0.2 })).toEqual({ x: 0.5, y: null })
    expect(rectGuides({ x: 0.44, y: 0.44, width: 0.3, height: 0.2 })).toEqual({ x: null, y: null })
    // A full-frame rectangle satisfies both borders and the middle; the
    // flush near edge is the one reported.
    expect(rectGuides({ x: 0, y: 0, width: 1, height: 1 })).toEqual({ x: 0, y: 0 })
  })

  it('lights the centre guide for an odd-sized rectangle, which cannot land exactly', () => {
    // A 0.35-wide box centred on the middle needs x = 0.325, which stores as
    // 0.33 and leaves the centre at 0.505. The snap is real and visible, so
    // the guide must be drawn: an equality test at the stored precision
    // decides 0.505 is not 0.5 and shows nothing (this is how the browser
    // spec first failed).
    const odd = snappedRect({ x: 0.315, y: 0.5, width: 0.35, height: 0.2 }, BOUNDS)
    expect(odd.x).toBe(0.33)
    expect(odd.x + odd.width / 2).toBeCloseTo(0.505, 6)
    expect(rectGuides(odd).x).toBe(0.5)
    // Each alignment still has exactly one storable value near enough: one
    // hundredth further out lights nothing.
    expect(rectGuides({ x: 0.34, y: 0.5, width: 0.35, height: 0.2 }).x).toBeNull()
    // …and a third, whose own rounding lands 0.0017 away, lights too.
    const third = snappedRect({ x: 0.15, y: 0.5, width: 0.35, height: 0.2 }, BOUNDS)
    expect(rectGuides(third).x).toBe(1 / 3)
  })

  it('never reports a guide the clamp moved the rectangle away from', () => {
    // A full-width rectangle nudged left: it cannot move, so the centre
    // guide it would have lit is not reported for x.
    const wide = snappedRect({ x: -0.01, y: 0.5, width: 1, height: 0.2 }, BOUNDS)
    expect(wide.x).toBe(0)
    expect(rectGuides(wide).x).toBe(0)
  })

  it('snaps a move unless Alt bypasses it, and never a resize', () => {
    const near = { x: 0.02, y: 0.5, width: 0.3, height: 0.2 }
    expect(rectAfterGesture(near, { kind: 'move', dx: 0, dy: 0 }, BOUNDS)).toMatchObject({ x: 0 })
    expect(
      rectAfterGesture(near, { kind: 'move', dx: 0, dy: 0, altKey: true }, BOUNDS),
    ).toMatchObject({ x: 0.02 })
    // A resize is clamped by the frame, which already lands a handle
    // dragged past the border flush — a snap there would only fight it. The
    // west edge pulled to 0.01 stays at 0.01, well inside the tolerance that
    // would have taken a *move* to 0.
    expect(
      rectAfterGesture(near, { kind: 'edge', edge: 'w', x: 0.01, y: 0.5 }, BOUNDS),
    ).toMatchObject({ x: 0.01 })
  })

  it('locks the aspect on a Shift-held corner and ignores Shift on an edge', () => {
    const start = { x: 0.1, y: 0.1, width: 0.3, height: 0.2 }
    const ratio = start.width / start.height
    const corner = rectAfterGesture(
      start,
      { kind: 'corner', corner: 'se', x: 0.5, y: 0.7, shiftKey: true },
      BOUNDS,
      ratio,
    )
    expect(corner.width / corner.height).toBeCloseTo(ratio, 1)
    // An edge handle means "change this one dimension"; a modifier that made
    // it change both would contradict the handle the user chose.
    const edge = rectAfterGesture(
      start,
      { kind: 'edge', edge: 's', x: 0.5, y: 0.7, shiftKey: true },
      BOUNDS,
      ratio,
    )
    expect(edge.width).toBe(start.width)
    expect(edge.height).toBeCloseTo(0.6, 3)
  })
})

describe('the free rectangle: keyboard steps (#422)', () => {
  const rect = { x: 0.6, y: 0.6, width: 0.3, height: 0.2 }

  it('nudges by the same fraction the zoom does, clamped at the frame', () => {
    expect(rectAfterKeyStep(rect, { kind: 'move', dx: ZOOM_NUDGE, dy: 0 }, BOUNDS)).toMatchObject({
      x: 0.61,
    })
    expect(
      rectAfterKeyStep(rect, { kind: 'move', dx: 0, dy: -ZOOM_NUDGE_LARGE }, BOUNDS),
    ).toMatchObject({ y: 0.55 })
    // Held against the right border it stops there rather than leaving it.
    let nudged = rect
    for (let i = 0; i < 20; i++) {
      nudged = rectAfterKeyStep(nudged, { kind: 'move', dx: ZOOM_NUDGE_LARGE, dy: 0 }, BOUNDS)
    }
    expect(nudged.x).toBe(0.7)
    expect(nudged.width).toBe(0.3)
  })

  it('grows and shrinks about the centre, and + then − returns exactly', () => {
    // A square box, so one step is representable on both axes and the
    // centre is preserved to the last digit rather than to within rounding.
    const square = { x: 0.4, y: 0.4, width: 0.2, height: 0.2 }
    const bigger = rectAfterKeyStep(square, { kind: 'scale', delta: ZOOM_SCALE_STEP }, BOUNDS)
    expect(bigger.width).toBe(square.width + RECT_SIZE_STEP)
    expect(bigger.x + bigger.width / 2).toBe(square.x + square.width / 2)
    expect(bigger.y + bigger.height / 2).toBe(square.y + square.height / 2)
    // An additive step buys exact inverses, which the zoom's multiplicative
    // magnification would not.
    expect(rectAfterKeyStep(bigger, { kind: 'scale', delta: -ZOOM_SCALE_STEP }, BOUNDS)).toEqual(
      square,
    )
  })

  it('keeps the proportions it has, to the precision a placement is stored at', () => {
    // 3:2 grown by one step: 0.32 wide wants 0.2133 high and stores 0.21, so
    // the ratio and the centre each survive to within half of the hundredth
    // `RECT_DECIMALS` keeps — which is the whole error rounding can cause.
    const grown = rectAfterKeyStep(rect, { kind: 'scale', delta: ZOOM_SCALE_STEP }, BOUNDS)
    expect(grown.width).toBeCloseTo(rect.width + RECT_SIZE_STEP, 3)
    expect(grown.width / grown.height).toBeCloseTo(rect.width / rect.height, 1)
    // Half a stored unit, widened by a float's worth — the drift here lands
    // exactly on the bound and reads as 0.0050000000000000044 in binary
    // floating point, the same reason `ZOOM_SNAP_TOLERANCE` above is
    // inclusive by 1e-9 rather than exactly.
    const halfAUnit = 0.005 + 1e-9
    for (const drift of [
      Math.abs(grown.x + grown.width / 2 - (rect.x + rect.width / 2)),
      Math.abs(grown.y + grown.height / 2 - (rect.y + rect.height / 2)),
    ]) {
      expect(drift).toBeLessThanOrEqual(halfAUnit)
    }
  })

  it('a shrink stops at the floor and a growth at the frame', () => {
    let small = { x: 0.4, y: 0.4, width: 0.1, height: 0.1 }
    for (let i = 0; i < 10; i++) {
      small = rectAfterKeyStep(small, { kind: 'scale', delta: -ZOOM_SCALE_STEP }, BOUNDS)
    }
    expect(small.width).toBe(MIN_OVERLAY_SIZE)
    let big = { x: 0.4, y: 0.4, width: 0.2, height: 0.2 }
    for (let i = 0; i < 60; i++) {
      big = rectAfterKeyStep(big, { kind: 'scale', delta: ZOOM_SCALE_STEP }, BOUNDS)
    }
    expect(big.width).toBeLessThanOrEqual(MAX_OVERLAY_SIZE)
    expect(big.x).toBeGreaterThanOrEqual(0)
    expect(big.x + big.width).toBeLessThanOrEqual(1)
  })
})

describe('the overlay editor still (#422)', () => {
  const state = (overlays: VideoOverlay[]): TimelineState => ({
    entries: [entry('a', 10)],
    transitions: [],
    videoOverlays: overlays,
  })

  it("takes the still at the middle of the overlay's own window", () => {
    // Not the sequence's start: the picture under the overlay is the one
    // the placement is being judged against.
    expect(overlayEditorSequenceTime(state([overlay()]), overlay({ offset: 2 }))).toBe(6)
    expect(
      overlayEditorSequenceTime(state([overlay()]), overlay({ offset: 1, inPoint: 2, outPoint: 6 })),
    ).toBe(3)
  })

  it('clamps a window running past the sequence back into it', () => {
    // An overlay's window may outrun the sequence (the allowed-tail rule),
    // and there is no frame out there to draw.
    expect(overlayEditorSequenceTime(state([overlay()]), overlay({ offset: 100 }))).toBe(10)
    expect(overlayEditorSequenceTime({ entries: [], transitions: [] }, overlay())).toBe(0)
  })

  it('withoutOverlay leaves this overlay out for the snapshot and nothing else', () => {
    const both = state([overlay(), overlay({ id: 'o2' })])
    const bypassed = withoutOverlay(both, 'o1')
    expect(videoOverlaysOf(bypassed).map((item) => item.id)).toEqual(['o2'])
    expect(bypassed.entries).toBe(both.entries)
    // An unknown id is a same-reference no-op, as withoutZoom's is.
    expect(withoutOverlay(both, 'nope')).toBe(both)
  })
})

describe('the editor still (#413)', () => {
  it('shows the middle of the hold', () => {
    expect(zoomHoldMidpoint({ ...zoom, start: 1, rampIn: 0.5, hold: 2, rampOut: 0.5 })).toBe(2.5)
    expect(zoomHoldMidpoint({ ...zoom, start: 0, rampIn: 0, hold: 0, rampOut: 0 })).toBe(0)
  })

  it('maps the hold midpoint to a sequence time through the entry start and in-point', () => {
    const state: TimelineState = {
      entries: [entry('a', 10), { ...entry('b', 10), inPoint: 2, outPoint: 8 }],
      transitions: [],
    }
    // Entry b starts at 10 s of sequence; its zoom at 1 s in, holding 2 s
    // after a 0.5 s ramp, has its midpoint 2.5 s into the entry.
    const spec = { ...zoom, start: 1, rampIn: 0.5, hold: 2, rampOut: 0.5 }
    expect(zoomEditorSequenceTime(state, 1, spec)).toBe(12.5)
    expect(zoomEditorSequenceTime(state, 0, spec)).toBe(2.5)
  })

  it('a midpoint past the entry end clamps to the end, like every seek', () => {
    const state: TimelineState = { entries: [entry('a', 4)], transitions: [] }
    expect(zoomEditorSequenceTime(state, 0, { ...zoom, start: 3, rampIn: 1, hold: 4 })).toBe(4)
  })

  it('withoutZoom leaves the zoom out for the snapshot and nothing else', () => {
    const base: TimelineState = { entries: [entry('a', 10)], transitions: [] }
    const withZooms = timelineReducer(
      timelineReducer(base, { type: 'zoom-added', zoom: { ...zoom, id: 'z1', entryId: 'a' } }),
      { type: 'zoom-added', zoom: { ...zoom, id: 'z2', entryId: 'a', start: 3 } },
    )
    const bypassed = withoutZoom(withZooms, 'z1')
    expect(zoomsOf(bypassed).map((item) => item.id)).toEqual(['z2'])
    expect(bypassed.entries).toBe(withZooms.entries)
    // An unknown id is a same-reference no-op.
    expect(withoutZoom(withZooms, 'nope')).toBe(withZooms)
  })
})
