import { describe, expect, it } from 'vitest'
import type { RemapEffect, RemapSpec } from './remap'
import {
  clampRemap,
  isValidRemapSpec,
  outputTimeAtSource,
  remapEnd,
  remappedDuration,
  remapsEqual,
  remapStart,
  sourceTimeAtOutput,
} from './remap'

const speed = (start: number, end: number, factor: number): RemapSpec => ({
  kind: 'speed',
  start,
  end,
  factor,
})
const pause = (at: number, hold: number): RemapSpec => ({ kind: 'pause', at, hold })
const effect = (spec: RemapSpec, id = 'r1', entryId = 'e1'): RemapEffect => ({
  ...spec,
  id,
  entryId,
})

describe('isValidRemapSpec', () => {
  it('accepts a finite positive-factor segment with a non-empty range', () => {
    expect(isValidRemapSpec(speed(1, 3, 0.5))).toBe(true)
    expect(isValidRemapSpec(speed(0, 10, 1.5))).toBe(true)
    // A factor of 1 is a valid (no-change) playback rate — the contract is
    // finite and > 0, not "different from 1".
    expect(isValidRemapSpec(speed(0, 1, 1))).toBe(true)
  })

  it('rejects empty ranges, non-positive factors, and non-finite fields', () => {
    expect(isValidRemapSpec(speed(3, 3, 0.5))).toBe(false)
    expect(isValidRemapSpec(speed(4, 3, 0.5))).toBe(false)
    expect(isValidRemapSpec(speed(1, 3, 0))).toBe(false)
    expect(isValidRemapSpec(speed(1, 3, -2))).toBe(false)
    expect(isValidRemapSpec(speed(1, 3, Number.POSITIVE_INFINITY))).toBe(false)
    expect(isValidRemapSpec(speed(Number.NaN, 3, 0.5))).toBe(false)
  })

  it('accepts a pause with a positive hold and rejects anything else', () => {
    expect(isValidRemapSpec(pause(2, 1.5))).toBe(true)
    expect(isValidRemapSpec(pause(0, 0.01))).toBe(true)
    expect(isValidRemapSpec(pause(2, 0))).toBe(false)
    expect(isValidRemapSpec(pause(2, -1))).toBe(false)
    expect(isValidRemapSpec(pause(Number.NaN, 1))).toBe(false)
    expect(isValidRemapSpec(pause(2, Number.POSITIVE_INFINITY))).toBe(false)
  })
})

describe('remapStart / remapEnd', () => {
  it('a segment spans its range; a pause occupies a single instant', () => {
    expect(remapStart(speed(1, 3, 2))).toBe(1)
    expect(remapEnd(speed(1, 3, 2))).toBe(3)
    expect(remapStart(pause(2, 5))).toBe(2)
    expect(remapEnd(pause(2, 5))).toBe(2)
  })
})

describe('clampRemap', () => {
  it('clamps a segment into [floor, trimmedLength], start first', () => {
    expect(clampRemap(effect(speed(2, 6, 0.5)), 10, 0)).toEqual(effect(speed(2, 6, 0.5)))
    expect(clampRemap(effect(speed(2, 6, 0.5)), 5, 0)).toEqual(effect(speed(2, 5, 0.5)))
    expect(clampRemap(effect(speed(2, 6, 0.5)), 10, 4)).toEqual(effect(speed(4, 6, 0.5)))
    // Squeezed past the end it collapses to zero width rather than vanishing.
    expect(clampRemap(effect(speed(7, 9, 0.5)), 5, 0)).toEqual(effect(speed(5, 5, 0.5)))
    expect(clampRemap(effect(speed(-2, 3, 2)), 10, 0)).toEqual(effect(speed(0, 3, 2)))
  })

  it('clamps a pause instant but always keeps its hold', () => {
    expect(clampRemap(effect(pause(8, 2)), 5, 0)).toEqual(effect(pause(5, 2)))
    expect(clampRemap(effect(pause(1, 2)), 5, 3)).toEqual(effect(pause(3, 2)))
    expect(clampRemap(effect(pause(-1, 2)), 5, 0)).toEqual(effect(pause(0, 2)))
  })

  it('returns the same object when nothing changes', () => {
    const unchanged = effect(speed(1, 3, 2))
    expect(clampRemap(unchanged, 10, 0)).toBe(unchanged)
    const pauseUnchanged = effect(pause(2, 1))
    expect(clampRemap(pauseUnchanged, 10, 0)).toBe(pauseUnchanged)
  })
})

describe('remapsEqual', () => {
  it('compares every field, including the kind', () => {
    expect(remapsEqual(effect(speed(1, 3, 2)), effect(speed(1, 3, 2)))).toBe(true)
    expect(remapsEqual(effect(pause(2, 1)), effect(pause(2, 1)))).toBe(true)
    expect(remapsEqual(effect(speed(1, 3, 2)), effect(speed(1, 3, 0.5)))).toBe(false)
    expect(remapsEqual(effect(pause(2, 1)), effect(pause(2, 2)))).toBe(false)
    expect(remapsEqual(effect(speed(1, 3, 2)), effect(pause(1, 3)))).toBe(false)
    expect(remapsEqual(effect(speed(1, 3, 2)), effect(speed(1, 3, 2), 'other'))).toBe(false)
  })
})

describe('remappedDuration', () => {
  it('is the trimmed length with no effects', () => {
    expect(remappedDuration(10, [])).toBe(10)
  })

  it('a slowed segment lengthens, a sped-up one shortens, a pause adds its hold', () => {
    // 2 s at half speed plays for 4 s: 10 + 2.
    expect(remappedDuration(10, [speed(1, 3, 0.5)])).toBe(12)
    // 4 s at double speed plays for 2 s: 10 − 2.
    expect(remappedDuration(10, [speed(2, 6, 2)])).toBe(8)
    expect(remappedDuration(10, [pause(5, 3)])).toBe(13)
  })

  it('effects combine additively', () => {
    // 10 + (2/0.5 − 2) + 3 + (4/2 − 4) = 10 + 2 + 3 − 2 = 13.
    expect(remappedDuration(10, [speed(0, 2, 0.5), pause(3, 3), speed(4, 8, 2)])).toBe(13)
  })

  it('a collapsed (zero-width) segment contributes nothing', () => {
    expect(remappedDuration(10, [speed(5, 5, 0.5) as RemapSpec])).toBe(10)
  })
})

describe('sourceTimeAtOutput / outputTimeAtSource', () => {
  // Trimmed length 10 with: half-speed over [2, 4] (plays 4 s), a 3 s pause
  // at 6, giving output pieces 1:1 [0,2] → slow [2,6] → 1:1 [6,8] →
  // pause [8,11] → 1:1 [11,15]. Total output 15.
  const effects = [speed(2, 4, 0.5), pause(6, 3)]

  it('maps 1:1 outside every effect', () => {
    expect(sourceTimeAtOutput(10, effects, 1)).toBe(1)
    expect(outputTimeAtSource(10, effects, 1)).toBe(1)
    expect(sourceTimeAtOutput(10, effects, 7)).toBe(5)
    expect(outputTimeAtSource(10, effects, 5)).toBe(7)
    expect(sourceTimeAtOutput(10, effects, 13)).toBe(8)
    expect(outputTimeAtSource(10, effects, 8)).toBe(13)
  })

  it('stretches source time through a slowed segment', () => {
    expect(sourceTimeAtOutput(10, effects, 2)).toBe(2)
    expect(sourceTimeAtOutput(10, effects, 4)).toBe(3)
    expect(sourceTimeAtOutput(10, effects, 6)).toBe(4)
    expect(outputTimeAtSource(10, effects, 3)).toBe(4)
  })

  it('compresses source time through a sped-up segment', () => {
    const fast = [speed(2, 6, 2)]
    expect(sourceTimeAtOutput(10, fast, 3)).toBe(4)
    expect(sourceTimeAtOutput(10, fast, 4)).toBe(6)
    expect(outputTimeAtSource(10, fast, 5)).toBe(3.5)
    expect(remappedDuration(10, fast)).toBe(8)
  })

  it('plateaus at the paused instant for the whole hold', () => {
    expect(sourceTimeAtOutput(10, effects, 8)).toBe(6)
    expect(sourceTimeAtOutput(10, effects, 9.5)).toBe(6)
    expect(sourceTimeAtOutput(10, effects, 11)).toBe(6)
    // The inverse returns the plateau's start — where the frame first shows.
    expect(outputTimeAtSource(10, effects, 6)).toBe(8)
  })

  it('handles a pause at the very start and at the very end', () => {
    const atStart = [pause(0, 2)]
    expect(sourceTimeAtOutput(10, atStart, 0)).toBe(0)
    expect(sourceTimeAtOutput(10, atStart, 1)).toBe(0)
    expect(sourceTimeAtOutput(10, atStart, 3)).toBe(1)
    expect(outputTimeAtSource(10, atStart, 0)).toBe(0)
    const atEnd = [pause(10, 2)]
    expect(remappedDuration(10, atEnd)).toBe(12)
    expect(sourceTimeAtOutput(10, atEnd, 11)).toBe(10)
    expect(outputTimeAtSource(10, atEnd, 10)).toBe(10)
  })

  it('is inverse of itself on strictly increasing spans', () => {
    for (const output of [0, 0.5, 2, 3.7, 6, 7.2, 12, 14, 15]) {
      const source = sourceTimeAtOutput(10, effects, output)
      // Skip the plateau: every output in [8, 11] maps to source 6, whose
      // first-shown inverse is 8 — checked separately above.
      if (output > 8 && output <= 11) continue
      expect(outputTimeAtSource(10, effects, source)).toBeCloseTo(output, 10)
    }
  })

  it('is monotonically non-decreasing in both directions', () => {
    let previousSource = Number.NEGATIVE_INFINITY
    for (let output = 0; output <= 15; output += 0.25) {
      const source = sourceTimeAtOutput(10, effects, output)
      expect(source).toBeGreaterThanOrEqual(previousSource)
      previousSource = source
    }
    let previousOutput = Number.NEGATIVE_INFINITY
    for (let source = 0; source <= 10; source += 0.25) {
      const output = outputTimeAtSource(10, effects, source)
      expect(output).toBeGreaterThanOrEqual(previousOutput)
      previousOutput = output
    }
  })

  it('clamps inputs outside the mapped ranges', () => {
    expect(sourceTimeAtOutput(10, effects, -5)).toBe(0)
    expect(sourceTimeAtOutput(10, effects, 99)).toBe(10)
    expect(outputTimeAtSource(10, effects, -5)).toBe(0)
    expect(outputTimeAtSource(10, effects, 99)).toBe(15)
  })

  it('treats a collapsed segment as identity', () => {
    const collapsed = [speed(5, 5, 0.5) as RemapSpec]
    expect(sourceTimeAtOutput(10, collapsed, 5)).toBe(5)
    expect(sourceTimeAtOutput(10, collapsed, 7)).toBe(7)
    expect(outputTimeAtSource(10, collapsed, 5)).toBe(5)
  })

  it('adjacent effects stay continuous at their shared boundary', () => {
    const adjacent = [pause(2, 1), speed(2, 4, 0.5)]
    // Output: 1:1 [0,2] → hold [2,3] → slow [3,7] → 1:1 [7,13].
    expect(remappedDuration(10, adjacent)).toBe(13)
    expect(sourceTimeAtOutput(10, adjacent, 2)).toBe(2)
    expect(sourceTimeAtOutput(10, adjacent, 3)).toBe(2)
    expect(sourceTimeAtOutput(10, adjacent, 5)).toBe(3)
    expect(sourceTimeAtOutput(10, adjacent, 7)).toBe(4)
    // Source 2 is first shown when the pause begins.
    expect(outputTimeAtSource(10, adjacent, 2)).toBe(2)
  })
})
