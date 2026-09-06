import { describe, expect, it } from 'vitest'
import {
  MAX_EDITOR_ZOOM_SCALE,
  MIN_EDITOR_ZOOM_SCALE,
  movedZoom,
  resizedZoom,
  withoutZoom,
  zoomAfterGesture,
  zoomEditorSequenceTime,
  zoomFromRect,
  zoomHoldMidpoint,
  zoomRect,
} from './frameEditor'
import { DEFAULT_ZOOM, timelineReducer, zoomsOf } from './timeline'
import type { TimelineState, ZoomSpec } from './timeline'

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
