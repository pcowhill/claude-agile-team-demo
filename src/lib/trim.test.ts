import { describe, expect, it } from 'vitest'
import {
  MIN_TRIM_LENGTH,
  clampIn,
  clampOut,
  formatTrimTime,
  frameStep,
  keptLength,
  playTrimStart,
  playTrimStep,
  sourceTime,
  stripFraction,
  timeAtStripFraction,
} from './trim'

const TOLERANCE = 1e-9

describe('sourceTime', () => {
  it('keeps 0 and the duration exactly, and rounds between to the millisecond', () => {
    expect(sourceTime(-1, 2.968271)).toBe(0)
    expect(sourceTime(5, 2.968271)).toBe(2.968271)
    expect(sourceTime(1.23456, 2.968271)).toBe(1.235)
    expect(sourceTime(Number.NaN, 3)).toBe(0)
  })
})

describe('the clamps', () => {
  const duration = 10
  const range = { inPoint: 2, outPoint: 6 }

  it('move freely inside the clip', () => {
    expect(clampIn(3.5, range, duration)).toBe(3.5)
    expect(clampOut(8.25, range, duration)).toBe(8.25)
  })

  it('stop at the clip’s ends', () => {
    expect(clampIn(-4, range, duration)).toBe(0)
    expect(clampOut(40, range, duration)).toBe(duration)
  })

  it('cannot cross, and always keep at least the minimum', () => {
    // Dragged past each other: each stops the minimum short of the other.
    expect(clampIn(9, range, duration)).toBeCloseTo(6 - MIN_TRIM_LENGTH, 9)
    expect(clampOut(0, range, duration)).toBeCloseTo(2 + MIN_TRIM_LENGTH, 9)
    // So the kept part is never shorter than the minimum, either way.
    for (const asked of [-1, 0, 1.99, 5.95, 5.999, 6, 7, 100]) {
      const inPoint = clampIn(asked, range, duration)
      expect(keptLength({ inPoint, outPoint: range.outPoint })).toBeGreaterThanOrEqual(
        MIN_TRIM_LENGTH - TOLERANCE,
      )
      const outPoint = clampOut(asked, range, duration)
      expect(keptLength({ inPoint: range.inPoint, outPoint })).toBeGreaterThanOrEqual(
        MIN_TRIM_LENGTH - TOLERANCE,
      )
    }
  })

  it('round inward at the minimum, so a duration off the millisecond cannot squeeze it', () => {
    const odd = 2.968271
    const inPoint = clampIn(odd, { inPoint: 0, outPoint: odd }, odd)
    expect(inPoint).toBe(2.868)
    expect(odd - inPoint).toBeGreaterThanOrEqual(MIN_TRIM_LENGTH - TOLERANCE)
    const outPoint = clampOut(0, { inPoint: 0.0004, outPoint: odd }, odd)
    expect(outPoint).toBe(0.101)
    expect(outPoint - 0.0004).toBeGreaterThanOrEqual(MIN_TRIM_LENGTH - TOLERANCE)
  })

  it('keep the whole of a clip shorter than the minimum, which is still longer than zero', () => {
    const tiny = 0.05
    const whole = { inPoint: 0, outPoint: tiny }
    expect(clampIn(0.04, whole, tiny)).toBe(0)
    expect(clampOut(0.01, whole, tiny)).toBe(tiny)
  })
})

describe('the strip', () => {
  it('maps times to a fraction of its width and back', () => {
    expect(stripFraction(2.5, 10)).toBe(0.25)
    expect(stripFraction(-1, 10)).toBe(0)
    expect(stripFraction(11, 10)).toBe(1)
    expect(stripFraction(1, 0)).toBe(0)
    expect(timeAtStripFraction(0.25, 10)).toBe(2.5)
    expect(timeAtStripFraction(1.2, 10)).toBe(10)
    expect(timeAtStripFraction(0.3333333, 3)).toBe(1)
  })
})

describe('Play trim', () => {
  const range = { inPoint: 2, outPoint: 6 }

  it('starts from the playhead inside the trim, and from In anywhere else', () => {
    expect(playTrimStart(3, range)).toBe(3)
    expect(playTrimStart(2, range)).toBe(2)
    expect(playTrimStart(1, range)).toBe(2)
    expect(playTrimStart(6, range)).toBe(2)
    // Right at Out there is nothing left to play: start over.
    expect(playTrimStart(5.99, range)).toBe(2)
    expect(playTrimStart(8, range)).toBe(2)
  })

  it('plays up to Out, then stops there — or, looping, goes back to In', () => {
    expect(playTrimStep(4, range, false)).toEqual({ kind: 'play', at: 4 })
    expect(playTrimStep(6.03, range, false)).toEqual({ kind: 'stop', at: 6 })
    expect(playTrimStep(6, range, false)).toEqual({ kind: 'stop', at: 6 })
    expect(playTrimStep(6.03, range, true)).toEqual({ kind: 'wrap', at: 2, seekTo: 2 })
  })

  it('never shows the playhead before In while the element catches up with a seek', () => {
    expect(playTrimStep(1.98, range, false)).toEqual({ kind: 'play', at: 2 })
  })
})

describe('frameStep', () => {
  it('moves one 30 fps frame along the grid, without drift', () => {
    expect(frameStep(1, 1, 10)).toBe(1.033)
    expect(frameStep(1, -1, 10)).toBe(0.967)
    let time = 10
    for (let step = 0; step < 30; step += 1) time = frameStep(time, -1, 10)
    expect(time).toBe(9)
    for (let step = 0; step < 15; step += 1) time = frameStep(time, 1, 10)
    expect(time).toBe(9.5)
  })

  it('lands on the grid from a time between frames, and stops at the clip’s ends', () => {
    expect(frameStep(1.01, 1, 10)).toBe(1.033)
    expect(frameStep(0.01, -1, 10)).toBe(0)
    expect(frameStep(9.99, 1, 10)).toBe(10)
  })
})

describe('formatTrimTime', () => {
  it('reads m:ss.cc', () => {
    expect(formatTrimTime(0)).toBe('0:00.00')
    expect(formatTrimTime(41.2)).toBe('0:41.20')
    expect(formatTrimTime(133)).toBe('2:13.00')
    expect(formatTrimTime(59.999)).toBe('1:00.00')
    expect(formatTrimTime(-3)).toBe('0:00.00')
  })
})
