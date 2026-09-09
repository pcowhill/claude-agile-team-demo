import { describe, expect, it } from 'vitest'
import {
  CROP_BOUNDS,
  CROP_DECIMALS,
  CROP_EDGES,
  CROP_FINE_DECIMALS,
  CROP_HANDLES,
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
  cropAfterGesture,
  cropEditorSequenceTime,
  cropFrameKey,
  cropFromRect,
  cropRect,
  cropSourceTimeline,
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
  sourceCropEdge,
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
import { MIN_KEPT_FRACTION, cropsEqual, normalizeCrop } from './crop'
import { DEFAULT_ZOOM, timelineReducer, videoOverlaysOf, zoomsOf } from './timeline'
import type { TimelineState, ZoomSpec } from './timeline'
import type { CropSubject } from './frameEditor'
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

describe('the crop rectangle: which stored edge each displayed one is (#423)', () => {
  // Crop applies in the source's own space BEFORE orientation (`crop.ts`),
  // while the editor draws the oriented picture — so this permutation is the
  // whole of the difference between the two, and getting it wrong trims a
  // different edge than the one under the pointer.
  it('is the identity when nothing is turned or mirrored', () => {
    for (const edge of CROP_EDGES) {
      expect(sourceCropEdge(edge, undefined)).toBe(edge)
      expect(sourceCropEdge(edge, {})).toBe(edge)
    }
  })

  it('a quarter turn clockwise brings the source left edge up to the top', () => {
    // A stripe down the source's left edge is along the top after a 90° CW
    // turn, so the top handle is what trims it.
    expect(sourceCropEdge('top', { rotation: 90 })).toBe('left')
    expect(sourceCropEdge('right', { rotation: 90 })).toBe('top')
    expect(sourceCropEdge('bottom', { rotation: 90 })).toBe('right')
    expect(sourceCropEdge('left', { rotation: 90 })).toBe('bottom')
    // 270° is the same turn the other way: left goes down to the bottom.
    expect(sourceCropEdge('bottom', { rotation: 270 })).toBe('left')
    expect(sourceCropEdge('left', { rotation: 270 })).toBe('top')
    // Half a turn swaps both axes.
    expect(sourceCropEdge('left', { rotation: 180 })).toBe('right')
    expect(sourceCropEdge('top', { rotation: 180 })).toBe('bottom')
  })

  it('a flip swaps its own axis, and composes with the turn in the stored order', () => {
    expect(sourceCropEdge('right', { flipH: true })).toBe('left')
    expect(sourceCropEdge('top', { flipH: true })).toBe('top')
    expect(sourceCropEdge('bottom', { flipV: true })).toBe('top')
    // Flips apply in source space first, then the rotation
    // (`orientation.ts`), so mirroring puts the source's left edge on the
    // source's right, and the turn then carries that to the bottom.
    expect(sourceCropEdge('bottom', { rotation: 90, flipH: true })).toBe('left')
    expect(sourceCropEdge('left', { rotation: 90, flipV: true })).toBe('top')
  })

  it('is a bijection for every orientation, which is what makes the round trip exact', () => {
    for (const rotation of [undefined, 90, 180, 270] as const) {
      for (const flipH of [false, true]) {
        for (const flipV of [false, true]) {
          const orientation = { ...(rotation === undefined ? {} : { rotation }), flipH, flipV }
          const mapped = CROP_EDGES.map((edge) => sourceCropEdge(edge, orientation))
          expect([...mapped].sort()).toEqual([...CROP_EDGES].sort())
        }
      }
    }
  })
})

describe('the crop rectangle: reading and writing a crop (#423)', () => {
  it('reads the kept region off the four trims, and an absent crop is the whole source', () => {
    expect(cropRect(undefined)).toEqual({ x: 0, y: 0, width: 1, height: 1 })
    expect(cropRect({ left: 0.1, right: 0.2, top: 0.05, bottom: 0.15 })).toEqual({
      x: 0.1,
      y: 0.05,
      width: 0.7,
      height: 0.8,
    })
    // A crop stores only its non-zero edges (`normalizeCrop`), so the absent
    // ones have to read as no trim rather than as undefined.
    expect(cropRect({ left: 0.25 })).toMatchObject({ x: 0.25, width: 0.75, height: 1 })
  })

  it('reads it through the orientation, so the rectangle sits where the picture shows it', () => {
    // The source's left quarter is trimmed; turned 90° CW that quarter is
    // along the top, so the rectangle starts a quarter down rather than a
    // quarter across.
    expect(cropRect({ left: 0.25 }, { rotation: 90 })).toEqual({
      x: 0,
      y: 0.25,
      width: 1,
      height: 0.75,
    })
    expect(cropRect({ left: 0.25 }, { flipH: true })).toMatchObject({ x: 0, width: 0.75 })
  })

  it('writes every edge back, so the reducer normalizes rather than the editor', () => {
    // All four always, exactly as the row's own fields commit them: the
    // reducer drops the zeroes, which is what keeps one crop from being
    // stored two ways.
    expect(cropFromRect({ x: 0.1, y: 0.05, width: 0.7, height: 0.8 })).toEqual({
      left: 0.1,
      right: 0.2,
      top: 0.05,
      bottom: 0.15,
    })
  })

  it('round-trips through any orientation', () => {
    const crop = { left: 0.1, right: 0.2, top: 0.05, bottom: 0.15 }
    for (const orientation of [
      undefined,
      { rotation: 90 } as const,
      { rotation: 270, flipH: true } as const,
      { flipV: true } as const,
    ]) {
      expect(cropFromRect(cropRect(crop, orientation), orientation)).toEqual(crop)
    }
  })

  it('rounds the complements it derives, which binary floating point does not', () => {
    // `right` is 1 − x − width, and neither 0.33 nor 0.35 is exact in
    // binary: unrounded this reads 0.32000000000000006, a value the percent
    // field cannot show and `cropsEqual` would call different from 0.32, so
    // re-committing an unchanged crop would look like an edit.
    expect(1 - 0.33 - 0.35).not.toBe(0.32)
    expect(cropFromRect({ x: 0.33, y: 0, width: 0.35, height: 1 }).right).toBe(0.32)
    // Rounding is at the finer of the two precisions, so an Alt-held value
    // the field can show survives it.
    expect(cropFromRect({ x: 0.1234, y: 0, width: 0.5, height: 1 }).left).toBe(0.1234)
  })
})

describe('the crop rectangle: gestures (#423)', () => {
  const whole = { x: 0, y: 0, width: 1, height: 1 }
  const kept = { x: 0.2, y: 0.2, width: 0.6, height: 0.6 }

  it('an edge drag trims that edge and leaves the other three where they were', () => {
    // The opposite edge is held fixed (`resizedRect`), which is exactly what
    // trimming one edge of a source means.
    const west = cropAfterGesture(whole, { kind: 'edge', edge: 'w', x: 0.3, y: 0.5 })
    expect(west).toEqual({ x: 0.3, y: 0, width: 0.7, height: 1 })
    expect(cropFromRect(west)).toEqual({ left: 0.3, right: 0, top: 0, bottom: 0 })
    const south = cropAfterGesture(whole, { kind: 'edge', edge: 's', x: 0.5, y: 0.8 })
    expect(cropFromRect(south)).toEqual({ left: 0, right: 0, top: 0, bottom: 0.2 })
  })

  it('snaps to whole percents, and Alt gives every digit the field can show', () => {
    // The issue's snap. Two decimals of the fraction *is* a whole percent,
    // and the field behind it holds a percent with two decimals of its own —
    // which is what leaves Alt something finer to offer.
    expect(cropAfterGesture(whole, { kind: 'edge', edge: 'w', x: 0.3372, y: 0.5 }).x).toBe(0.34)
    expect(
      cropAfterGesture(whole, { kind: 'edge', edge: 'w', x: 0.3372, y: 0.5, altKey: true }).x,
    ).toBe(0.3372)
    // Both are values the row's own percent field can express exactly, so
    // the drag and its mirror cannot disagree (#422's rule).
    expect(CROP_DECIMALS).toBe(2)
    expect(CROP_FINE_DECIMALS).toBe(4)
  })

  it('Shift trims the opposite edge as far, about the centre', () => {
    const symmetric = cropAfterGesture(kept, { kind: 'edge', edge: 'w', x: 0.3, y: 0.5 })
    expect(symmetric).toMatchObject({ x: 0.3, width: 0.5 })
    const held = cropAfterGesture(kept, { kind: 'edge', edge: 'w', x: 0.3, y: 0.5, shiftKey: true })
    // The centre is 0.5 and stays there; both edges came in by 0.1.
    expect(held).toMatchObject({ x: 0.3, width: 0.4 })
    expect(held.x + held.width / 2).toBeCloseTo(0.5, 6)
    expect(cropFromRect(held)).toMatchObject({ left: 0.3, right: 0.3 })
    // The other axis is untouched either way.
    expect(held.y).toBe(kept.y)
    expect(held.height).toBe(kept.height)
  })

  it('a symmetric drag off the frame shrinks rather than sliding, keeping the two edges equal', () => {
    // An off-centre region: its centre is 0.3, so a symmetric growth can
    // only reach 0.6 wide before the left edge would leave the frame.
    // Sliding it back instead would silently trim the two edges by
    // different amounts, which is the one thing this gesture promises not
    // to do.
    const off = { x: 0.1, y: 0.2, width: 0.4, height: 0.6 }
    const grown = cropAfterGesture(off, { kind: 'edge', edge: 'e', x: 1, y: 0.5, shiftKey: true })
    expect(grown.x).toBe(0)
    expect(grown.width).toBe(0.6)
    expect(grown.x + grown.width / 2).toBeCloseTo(0.3, 6)
    const back = cropFromRect(grown)
    expect(back.left).toBe(0)
    expect(back.right).toBeCloseTo(0.4, 6)
  })

  it('edges cannot cross: a handle dragged past its opposite stops at the reducer’s own floor', () => {
    // `MIN_KEPT_FRACTION` is what `normalizeCrop` would scale an over-deep
    // pair back to, so clamping here means the reducer never moves the
    // rectangle underneath the drag.
    const crossed = cropAfterGesture(whole, { kind: 'edge', edge: 'w', x: 1.5, y: 0.5 })
    expect(crossed.width).toBe(MIN_KEPT_FRACTION)
    expect(crossed.x + crossed.width).toBeLessThanOrEqual(1)
    const shiftCrossed = cropAfterGesture(kept, {
      kind: 'edge',
      edge: 'n',
      x: 0.5,
      y: 0.48,
      shiftKey: true,
    })
    expect(shiftCrossed.height).toBe(MIN_KEPT_FRACTION)
    // And what it commits is a crop the reducer keeps unchanged.
    const stored = normalizeCrop(cropFromRect(shiftCrossed))
    expect(cropsEqual(normalizeCrop(cropFromRect(shiftCrossed)), stored)).toBe(true)
    expect(1 - (stored?.top ?? 0) - (stored?.bottom ?? 0)).toBeCloseTo(MIN_KEPT_FRACTION, 6)
  })

  it('a symmetric edge dragged past the centre collapses to the floor rather than bouncing', () => {
    // The first version took the distance from the centre, so a north edge
    // pulled below the middle started *growing* the region again with the
    // two edges swapped over — an unmistakable defect the moment it is
    // written down, and invisible until a drag goes that far. The half-size
    // is signed now, so crossing the centre reads as "nothing left".
    const kept = { x: 0.2, y: 0.2, width: 0.6, height: 0.6 }
    const past = cropAfterGesture(kept, { kind: 'edge', edge: 'n', x: 0.5, y: 0.9, shiftKey: true })
    expect(past.height).toBe(MIN_KEPT_FRACTION)
    expect(past.y + past.height / 2).toBeCloseTo(0.5, 6)
    // Exactly at the centre is the same answer, from the other side of zero.
    expect(
      cropAfterGesture(kept, { kind: 'edge', edge: 's', x: 0.5, y: 0.5, shiftKey: true }).height,
    ).toBe(MIN_KEPT_FRACTION)
  })

  it('a move pans the kept region without resizing it, and does not snap to alignments', () => {
    const panned = cropAfterGesture(kept, { kind: 'move', dx: -0.19, dy: 0 })
    expect(panned).toMatchObject({ x: 0.01, width: 0.6 })
    // A placement's move would have pulled that 0.01 flush to 0 (#422);
    // a crop is a window on a source, not something parked in a corner.
    expect(panned.x).not.toBe(0)
    // Dragged off the source it stops at the border, still the same size.
    expect(cropAfterGesture(kept, { kind: 'move', dx: -1, dy: 1 })).toEqual({
      x: 0,
      y: 0.4,
      width: 0.6,
      height: 0.6,
    })
  })

  it('handles a corner even though it offers none, rather than leaving a case for a later editor', () => {
    expect([...CROP_HANDLES].sort()).toEqual(['e', 'n', 's', 'w'])
    expect(cropAfterGesture(whole, { kind: 'corner', corner: 'nw', x: 0.2, y: 0.3 })).toEqual({
      x: 0.2,
      y: 0.3,
      width: 0.8,
      height: 0.7,
    })
  })

  it('nudges and resizes with the keyboard by the percentages the issue asks for', () => {
    // 1% and 5% are what the shared steps already are, so the crop editor
    // takes them rather than a second pair of constants.
    expect(rectAfterKeyStep(kept, { kind: 'move', dx: ZOOM_NUDGE, dy: 0 }, CROP_BOUNDS).x).toBe(0.21)
    expect(
      rectAfterKeyStep(kept, { kind: 'move', dx: 0, dy: -ZOOM_NUDGE_LARGE }, CROP_BOUNDS).y,
    ).toBe(0.15)
    const grown = rectAfterKeyStep(kept, { kind: 'scale', delta: ZOOM_SCALE_STEP }, CROP_BOUNDS)
    expect(grown.width).toBe(kept.width + RECT_SIZE_STEP)
    expect(grown.x + grown.width / 2).toBeCloseTo(0.5, 6)
    // The floor is the reducer's, not a placement's.
    let small = kept
    for (let i = 0; i < 40; i++) {
      small = rectAfterKeyStep(small, { kind: 'scale', delta: -ZOOM_SCALE_STEP }, CROP_BOUNDS)
    }
    expect(small.width).toBe(MIN_KEPT_FRACTION)
  })
})

describe('the crop editor still (#423)', () => {
  const cropped = {
    ...entry('a', 10),
    crop: { left: 0.2 },
    orientation: { rotation: 90 } as const,
    colorAdjustments: { brightness: 1.2 },
  }

  it('draws the element alone and uncropped, so a crop fraction is a frame fraction', () => {
    const source = cropSourceTimeline(cropped)
    expect(source.entries).toHaveLength(1)
    // The bypass: the still shows what is there to trim, not what survives.
    expect(source.entries[0].crop).toBeUndefined()
    // No canvas preset and nothing else in the sequence, so
    // `canvasFrameSize` derives the frame from this one source and the
    // picture fills it edge to edge — the whole reason the still is not the
    // composed frame.
    expect(source.canvasPreset).toBeUndefined()
    expect(source.videoOverlays).toBeUndefined()
    expect(source.texts).toBeUndefined()
    expect(source.zooms).toBeUndefined()
    expect(source.transitions).toEqual([])
  })

  it("keeps the element's own treatment of the picture being trimmed", () => {
    const source = cropSourceTimeline(cropped)
    expect(source.entries[0]).toMatchObject({
      id: 'a',
      url: cropped.url,
      inPoint: cropped.inPoint,
      outPoint: cropped.outPoint,
      orientation: { rotation: 90 },
      colorAdjustments: { brightness: 1.2 },
    })
    // Absent fields stay absent rather than becoming `undefined` keys.
    expect(Object.keys(cropSourceTimeline(entry('a', 10)).entries[0])).not.toContain('orientation')
  })

  it('describes an overlay as an entry, because an overlay lands in its placement rectangle', () => {
    const still: VideoOverlay = {
      id: 'o1',
      kind: 'image',
      clipId: 'clip-cam',
      name: 'cam.png',
      duration: 5,
      url: 'blob:cam',
      offset: 3,
      inPoint: 0,
      outPoint: 5,
      x: 0.6,
      y: 0.6,
      width: 0.3,
      height: 0.3,
      crop: { top: 0.1 },
    }
    const source = cropSourceTimeline(still)
    // Drawn as an overlay it would occupy 0.3 × 0.3 of the frame, and its
    // own picture letterboxes inside even that — the geometry this view
    // exists to avoid.
    expect(source.videoOverlays).toBeUndefined()
    expect(source.entries[0]).toMatchObject({ id: 'o1', kind: 'image', url: 'blob:cam' })
    expect(source.entries[0].crop).toBeUndefined()
  })

  it("takes the still at the middle of the element's own window", () => {
    // Sequence time 0 in the one-element timeline is the element's inPoint,
    // so the middle of the window is half its length.
    expect(cropEditorSequenceTime({ inPoint: 0, outPoint: 10 })).toBe(5)
    expect(cropEditorSequenceTime({ inPoint: 2, outPoint: 8 })).toBe(3)
    expect(cropEditorSequenceTime({ inPoint: 4, outPoint: 4 })).toBe(0)
  })

  it('keys the still on the orientation as well as the element', () => {
    // A crop cannot change this picture — it is bypassed — but a rotation
    // both turns it and moves which stored edge each handle trims, so the
    // still has to be re-rendered for one.
    const base: CropSubject = entry('a', 10)
    expect(cropFrameKey(base)).toBe(cropFrameKey({ ...base, crop: { left: 0.3 } }))
    expect(cropFrameKey({ ...base, orientation: { rotation: 90 } })).not.toBe(cropFrameKey(base))
    expect(cropFrameKey({ ...base, orientation: { flipH: true } })).not.toBe(
      cropFrameKey({ ...base, orientation: { flipV: true } }),
    )
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
