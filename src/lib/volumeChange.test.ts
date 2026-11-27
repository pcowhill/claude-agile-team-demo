import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VOLUME_CHANGE_LENGTH,
  DEFAULT_VOLUME_CHANGE_LEVEL,
  VOLUME_CHANGE_RAMP_SECONDS,
  changedVolumeAt,
  defaultVolumeChangeFor,
  splitVolumeChangesAt,
  sweptVolumeChanges,
  volumeChangeFactorAt,
  withVolumeChangesClamped,
} from './volumeChange'
import type { VolumeChange } from './volumeChange'
import { MAX_VOLUME } from './volume'

const R = VOLUME_CHANGE_RAMP_SECONDS
const change = (id: string, start: number, length: number, level: number): VolumeChange => ({
  id,
  start,
  length,
  level,
})

describe('sweptVolumeChanges: normalization against the trimmed window (#1025)', () => {
  it('sorts by start and keeps each change that needs nothing as the same object', () => {
    const a = change('a', 5, 1, 0.5)
    const b = change('b', 1, 2, 0.2)
    const swept = sweptVolumeChanges([a, b], 10)
    expect(swept.map((each) => each.id)).toEqual(['b', 'a'])
    expect(swept[0]).toBe(b)
    expect(swept[1]).toBe(a)
  })

  it('keeps them disjoint: the earlier change wins an overlap', () => {
    const swept = sweptVolumeChanges([change('a', 1, 3, 0.5), change('b', 2, 3, 0.2)], 10)
    expect(swept[1]).toEqual(change('b', 4, 3, 0.2))
  })

  it('keeps every change inside the window, collapsing what no longer fits to zero length', () => {
    const swept = sweptVolumeChanges([change('a', 1, 3, 0.5), change('b', 6, 2, 0.2)], 3)
    expect(swept).toEqual([change('a', 1, 2, 0.5), change('b', 3, 0, 0.2)])
  })

  it('clamps each level to 0 to MAX_VOLUME', () => {
    const swept = sweptVolumeChanges([change('a', 0, 1, -1), change('b', 2, 1, 99)], 10)
    expect(swept.map((each) => each.level)).toEqual([0, MAX_VOLUME])
  })

  it('withVolumeChangesClamped: a retrim that shortens the window past a change collapses it and keeps it', () => {
    const track = { inPoint: 2, outPoint: 12, volumeChanges: [change('a', 8, 1, 0.5)] }
    const unchanged = withVolumeChangesClamped(track)
    expect(unchanged).toBe(track)
    const retrimmed = withVolumeChangesClamped({ ...track, outPoint: 6 })
    expect(retrimmed.volumeChanges).toEqual([change('a', 4, 0, 0.5)])
  })

  it('withVolumeChangesClamped: an empty list is stored as no key', () => {
    const cleared = withVolumeChangesClamped({ inPoint: 0, outPoint: 1, volumeChanges: [] })
    expect(cleared).not.toHaveProperty('volumeChanges')
  })
})

describe('volumeChangeFactorAt: the level inside, linear ramps just outside (#1025)', () => {
  const one = [change('a', 10, 4, 0.2)]

  it('is 1 with no changes', () => {
    expect(volumeChangeFactorAt(undefined, 3)).toBe(1)
    expect(volumeChangeFactorAt([], 3)).toBe(1)
  })

  it('reads 1 before a change, ramps over the ramp before it, holds the level inside, and ramps back after', () => {
    expect(volumeChangeFactorAt(one, 5)).toBe(1)
    // The start of the ramp in: still full.
    expect(volumeChangeFactorAt(one, 10 - R)).toBe(1)
    // Mid-ramp: halfway between 1 and 0.2.
    expect(volumeChangeFactorAt(one, 10 - R / 2)).toBeCloseTo(0.6, 12)
    // The level is already reached on the change's first instant, and held to its last.
    expect(volumeChangeFactorAt(one, 10)).toBe(0.2)
    expect(volumeChangeFactorAt(one, 12)).toBe(0.2)
    expect(volumeChangeFactorAt(one, 14)).toBe(0.2)
    // The ramp out.
    expect(volumeChangeFactorAt(one, 14 + R / 2)).toBeCloseTo(0.6, 12)
    expect(volumeChangeFactorAt(one, 14 + R)).toBe(1)
    expect(volumeChangeFactorAt(one, 20)).toBe(1)
  })

  it('has no ramp at a window edge: a change starting at 0 is at its level from the first instant', () => {
    const atStart = [change('a', 0, 2, 0.3)]
    expect(volumeChangeFactorAt(atStart, 0)).toBe(0.3)
    expect(volumeChangeFactorAt(atStart, 2 + R / 2)).toBeCloseTo(0.65, 12)
  })

  it('has no ramp at a window edge: a change ending at the end holds its level to the end', () => {
    // A 6 s window whose change runs to its end: every instant inside the window reads the level.
    const atEnd = [change('a', 4, 2, 0.3)]
    for (const into of [4, 5, 5.99, 6]) expect(volumeChangeFactorAt(atEnd, into)).toBe(0.3)
  })

  it('moves in one straight line between two changes closer than two ramps, never leaving their range', () => {
    const close = [change('a', 1, 1, 0.2), change('b', 2 + R, 1, 0.8)]
    expect(volumeChangeFactorAt(close, 2)).toBe(0.2)
    expect(volumeChangeFactorAt(close, 2 + R / 2)).toBeCloseTo(0.5, 12)
    expect(volumeChangeFactorAt(close, 2 + R)).toBe(0.8)
    for (let into = 2; into <= 2 + R; into += R / 10) {
      const factor = volumeChangeFactorAt(close, into)
      expect(factor).toBeGreaterThanOrEqual(0.2 - 1e-12)
      expect(factor).toBeLessThanOrEqual(0.8 + 1e-12)
    }
  })

  it('returns to 1 between two changes two ramps or more apart', () => {
    const apart = [change('a', 1, 1, 0.2), change('b', 2 + 3 * R, 1, 0.8)]
    expect(volumeChangeFactorAt(apart, 2 + 1.5 * R)).toBe(1)
    expect(volumeChangeFactorAt(apart, 2 + R / 2)).toBeCloseTo(0.6, 12)
    expect(volumeChangeFactorAt(apart, 2 + 2.5 * R)).toBeCloseTo(0.9, 12)
  })

  it('is continuous: no step anywhere across a ramp, a change, or a close pair', () => {
    const list = [change('a', 1, 1, 0.2), change('b', 2 + R, 1, 1.6), change('c', 5, 0.5, 0)]
    const step = 0.001
    for (let into = 0; into < 7; into += step) {
      const jump = Math.abs(volumeChangeFactorAt(list, into + step) - volumeChangeFactorAt(list, into))
      // The steepest slope is 1.6 per ramp: a step of 1 ms moves at most 1.6 / 0.25 × 0.001.
      expect(jump).toBeLessThanOrEqual((1.6 / R) * step + 1e-9)
    }
  })

  it('raises the sound for a level above 1, ramping up and back', () => {
    const lift = [change('a', 3, 2, 1.6)]
    expect(volumeChangeFactorAt(lift, 4)).toBe(1.6)
    expect(volumeChangeFactorAt(lift, 3 - R / 2)).toBeCloseTo(1.3, 12)
  })

  it('ignores a collapsed change, which plays nothing', () => {
    expect(volumeChangeFactorAt([change('a', 3, 0, 0.1)], 3)).toBe(1)
  })
})

describe('changedVolumeAt: Volume × the factor, clamped to MAX_VOLUME (#1025)', () => {
  it('multiplies the element Volume by the factor', () => {
    expect(changedVolumeAt(0.8, [change('a', 0, 2, 0.5)], 1)).toBeCloseTo(0.4, 12)
  })

  it('never exceeds MAX_VOLUME, the loudest Volume could make the element', () => {
    expect(changedVolumeAt(3, [change('a', 0, 2, 4)], 1)).toBe(MAX_VOLUME)
  })
})

describe('defaultVolumeChangeFor: what + Effect ▾ › Volume change adds (#1025)', () => {
  it('adds a default-length change at the default level from 0 on a change-free element', () => {
    expect(defaultVolumeChangeFor(undefined, 10)).toEqual({
      start: 0,
      length: DEFAULT_VOLUME_CHANGE_LENGTH,
      level: DEFAULT_VOLUME_CHANGE_LEVEL,
    })
  })

  it('starts where the last change ends, shortened to the room left, and none without room', () => {
    expect(defaultVolumeChangeFor([change('a', 2, 7, 0.2)], 10)).toEqual({ start: 9, length: 1, level: 0.5 })
    expect(defaultVolumeChangeFor([change('a', 2, 8, 0.2)], 10)).toBeNull()
  })
})

describe('splitVolumeChangesAt: dividing for Split…, Cut… and the ripple (#1025)', () => {
  it('keeps those before, shifts those after, and divides one across the point at the same level', () => {
    const list = [change('a', 1, 1, 0.2), change('b', 3, 4, 0.5), change('c', 8, 1, 1.5)]
    const { before, after } = splitVolumeChangesAt(list, 5)
    expect(before).toEqual([change('a', 1, 1, 0.2), change('b', 3, 2, 0.5)])
    expect(after).toEqual([change('b', 0, 2, 0.5), change('c', 3, 1, 1.5)])
  })

  it('plays on across the join: each part reads the original factor at the same instant', () => {
    const list = [change('a', 1, 1, 0.2), change('b', 3, 4, 0.5)]
    const { before, after } = splitVolumeChangesAt(list, 5)
    for (const into of [0.5, 1.9, 3, 4.99]) {
      expect(volumeChangeFactorAt(before, into)).toBeCloseTo(volumeChangeFactorAt(list, into), 12)
    }
    for (const into of [5, 6, 6.9, 7.1, 8]) {
      expect(volumeChangeFactorAt(after, into - 5)).toBeCloseTo(volumeChangeFactorAt(list, into), 12)
    }
  })

  it('handles no changes', () => {
    expect(splitVolumeChangesAt(undefined, 3)).toEqual({ before: [], after: [] })
  })
})
