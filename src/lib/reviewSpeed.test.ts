import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REVIEW_RATE,
  REVIEW_RATES,
  formatReviewRate,
  nextReviewRate,
} from './reviewSpeed'

describe('review speed (#522)', () => {
  it('offers exactly the four rates #515 approved, in stepping order', () => {
    expect(REVIEW_RATES).toEqual([0.5, 1, 1.5, 2])
    expect(DEFAULT_REVIEW_RATE).toBe(1)
  })

  it('steps through them and wraps, which is what the R shortcut does', () => {
    expect(nextReviewRate(0.5)).toBe(1)
    expect(nextReviewRate(1)).toBe(1.5)
    expect(nextReviewRate(1.5)).toBe(2)
    expect(nextReviewRate(2)).toBe(0.5)
  })

  it('four steps from any rate return to it', () => {
    for (const rate of REVIEW_RATES) {
      expect(nextReviewRate(nextReviewRate(nextReviewRate(nextReviewRate(rate))))).toBe(rate)
    }
  })

  it('steps an unrecognised rate back to 1× rather than throwing', () => {
    // The only way to hold one is a bug; a preview stuck at an unknown speed
    // should be one key from normal rather than one key from a crash.
    expect(nextReviewRate(3)).toBe(1)
    expect(nextReviewRate(Number.NaN)).toBe(1)
  })

  it('formats without a trailing zero — a setting, not a measurement', () => {
    expect(REVIEW_RATES.map(formatReviewRate)).toEqual(['0.5×', '1×', '1.5×', '2×'])
  })
})
