import { describe, expect, it } from 'vitest'
import type { TimelineEntry, TimelineState } from './timeline'
import { IDENTITY_ZOOM, smoothstep, zoomAt } from './zoom'

const entry: TimelineEntry = {
  id: 'e1',
  clipId: 'c1',
  name: 'clip.webm',
  duration: 12,
  url: 'blob:clip',
  inPoint: 2,
  outPoint: 10,
}

// Zoom window within the 8s trimmed range: starts 1s in, ramps 1s up,
// holds 2s, ramps 1s down — so in source-clock terms (inPoint 2) the window
// spans source time [3, 7]: ramp-in [3, 4), hold [4, 6], ramp-out (6, 7].
const state: TimelineState = {
  entries: [entry],
  zooms: [
    {
      entryId: 'e1',
      start: 1,
      rampIn: 1,
      hold: 2,
      rampOut: 1,
      scale: 3,
      centerX: 0.7,
      centerY: 0.4,
    },
  ],
}

describe('smoothstep', () => {
  it('maps 0 → 0, 1 → 1, midpoint → 0.5, clamped outside', () => {
    expect(smoothstep(0)).toBe(0)
    expect(smoothstep(1)).toBe(1)
    expect(smoothstep(0.5)).toBeCloseTo(0.5, 10)
    expect(smoothstep(-2)).toBe(0)
    expect(smoothstep(3)).toBe(1)
  })

  it('is monotonic on [0, 1]', () => {
    let previous = -Infinity
    for (let u = 0; u <= 1.0001; u += 0.05) {
      const value = smoothstep(u)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
  })
})

describe('zoomAt', () => {
  it('is identity before and after the window, and without a zoom at all', () => {
    expect(zoomAt(state, 0, 2)).toEqual(IDENTITY_ZOOM) // entry start, pre-window
    expect(zoomAt(state, 0, 2.999)).toEqual(IDENTITY_ZOOM)
    expect(zoomAt(state, 0, 7.001)).toEqual(IDENTITY_ZOOM)
    expect(zoomAt(state, 0, 10)).toEqual(IDENTITY_ZOOM)
    expect(zoomAt({ entries: [entry] }, 0, 5)).toEqual(IDENTITY_ZOOM)
    expect(zoomAt(state, 5, 5)).toEqual(IDENTITY_ZOOM) // no such entry
  })

  it('measures the window against the source clock, honoring inPoint', () => {
    // start=1 into the trimmed range means source time 3, not 1.
    expect(zoomAt(state, 0, 1 + 0.5)).toEqual(IDENTITY_ZOOM)
    expect(zoomAt(state, 0, 3 + 0.5).scale).toBeGreaterThan(1)
  })

  it('ramps 1 → scale across rampIn, monotonically', () => {
    expect(zoomAt(state, 0, 3).scale).toBe(1)
    let previous = 1
    for (let t = 3.1; t < 4; t += 0.1) {
      const { scale } = zoomAt(state, 0, t)
      expect(scale).toBeGreaterThan(previous)
      previous = scale
    }
    expect(zoomAt(state, 0, 4).scale).toBe(3)
  })

  it('holds full zoom (scale and centre) through the hold phase', () => {
    for (const t of [4, 4.5, 5, 5.7, 6]) {
      expect(zoomAt(state, 0, t)).toEqual({ scale: 3, centerX: 0.7, centerY: 0.4 })
    }
  })

  it('ramps scale → 1 across rampOut, monotonically', () => {
    let previous = 3
    for (let t = 6.1; t < 7; t += 0.1) {
      const { scale } = zoomAt(state, 0, t)
      expect(scale).toBeLessThan(previous)
      previous = scale
    }
    expect(zoomAt(state, 0, 7)).toEqual(IDENTITY_ZOOM)
  })

  it('is continuous at all four junctions', () => {
    const epsilon = 1e-4
    for (const junction of [3, 4, 6, 7]) {
      const before = zoomAt(state, 0, junction - epsilon)
      const at = zoomAt(state, 0, junction)
      const after = zoomAt(state, 0, junction + epsilon)
      for (const key of ['scale', 'centerX', 'centerY'] as const) {
        expect(Math.abs(at[key] - before[key])).toBeLessThan(0.01)
        expect(Math.abs(after[key] - at[key])).toBeLessThan(0.01)
      }
    }
  })

  it('eases the centre from the frame centre to the zoom centre and back', () => {
    expect(zoomAt(state, 0, 3).centerX).toBe(0.5)
    const mid = zoomAt(state, 0, 3.5)
    expect(mid.centerX).toBeGreaterThan(0.5)
    expect(mid.centerX).toBeLessThan(0.7)
    expect(mid.centerY).toBeLessThan(0.5)
    expect(mid.centerY).toBeGreaterThan(0.4)
    expect(zoomAt(state, 0, 5).centerX).toBe(0.7)
  })

  it('keeps the visible region inside the frame at every sampled point', () => {
    for (let t = 2.5; t <= 7.5; t += 0.05) {
      const { scale, centerX, centerY } = zoomAt(state, 0, t)
      const halfExtent = 1 / (2 * scale)
      expect(centerX - halfExtent).toBeGreaterThanOrEqual(-1e-12)
      expect(centerX + halfExtent).toBeLessThanOrEqual(1 + 1e-12)
      expect(centerY - halfExtent).toBeGreaterThanOrEqual(-1e-12)
      expect(centerY + halfExtent).toBeLessThanOrEqual(1 + 1e-12)
    }
  })

  it("preserves the frame's aspect ratio at every sampled point", () => {
    // Centre + scale divides both axes by the same factor, so for any frame
    // size the visible region keeps the frame's ratio. Checked concretely
    // for a 320×180 frame across the whole window.
    for (let t = 2.5; t <= 7.5; t += 0.25) {
      const { scale } = zoomAt(state, 0, t)
      const visibleWidth = 320 / scale
      const visibleHeight = 180 / scale
      expect(visibleWidth / visibleHeight).toBeCloseTo(320 / 180, 10)
    }
  })

  it('starts at full zoom immediately when rampIn is 0', () => {
    const instant: TimelineState = {
      entries: [entry],
      zooms: [
        { entryId: 'e1', start: 1, rampIn: 0, hold: 2, rampOut: 1, scale: 2, centerX: 0.5, centerY: 0.5 },
      ],
    }
    expect(zoomAt(instant, 0, 3).scale).toBe(2)
    expect(zoomAt(instant, 0, 2.999).scale).toBe(1)
  })

  it('ends at identity immediately when rampOut is 0', () => {
    const instant: TimelineState = {
      entries: [entry],
      zooms: [
        { entryId: 'e1', start: 1, rampIn: 1, hold: 1, rampOut: 0, scale: 2, centerX: 0.5, centerY: 0.5 },
      ],
    }
    expect(zoomAt(instant, 0, 5).scale).toBe(2)
    expect(zoomAt(instant, 0, 5.001).scale).toBe(1)
  })
})
