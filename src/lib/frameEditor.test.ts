import { describe, expect, it } from 'vitest'
import {
  MAX_EDITOR_ZOOM_SCALE,
  MIN_EDITOR_ZOOM_SCALE,
  ZOOM_NUDGE,
  ZOOM_NUDGE_LARGE,
  ZOOM_SCALE_STEP,
  ZOOM_SNAP_TARGETS,
  ZOOM_SNAP_TOLERANCE,
  movedZoom,
  rectKeyStep,
  resizedZoom,
  scaledZoom,
  snappedZoom,
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
import { DEFAULT_ZOOM, timelineReducer, zoomsOf } from './timeline'
import type { TimelineState, ZoomSpec } from './timeline'
import { zoomAt } from './zoom'

const zoom: ZoomSpec = { ...DEFAULT_ZOOM, scale: 2, centerX: 0.5, centerY: 0.5 }

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
