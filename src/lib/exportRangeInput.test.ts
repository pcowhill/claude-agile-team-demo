import { describe, expect, it } from 'vitest'
import { customExportRange, formatTimeInput, parseTimeInput } from './exportRangeInput'
import { formatDuration } from './mediaLibrary'

describe('parseTimeInput (#400)', () => {
  it('reads plain seconds, m:ss, m:ss.f and h:mm:ss', () => {
    expect(parseTimeInput('12')).toBe(12)
    expect(parseTimeInput('12.5')).toBe(12.5)
    expect(parseTimeInput('0:09')).toBe(9)
    expect(parseTimeInput('1:05')).toBe(65)
    expect(parseTimeInput('0:08.5')).toBe(8.5)
    expect(parseTimeInput('1:02:03')).toBe(3723)
    expect(parseTimeInput('1:02:03.25')).toBe(3723.25)
    expect(parseTimeInput('  0:07 ')).toBe(7)
  })

  it('rejects empty text, garbage, negatives, overlong forms and typo segments', () => {
    for (const text of ['', '   ', 'abc', '-3', '1:-5', '1:2:3:4', '1:75', '1:60:00', '1.5:30', '3:', ':30']) {
      expect(parseTimeInput(text), text).toBeNull()
    }
  })
})

describe('formatTimeInput (#400)', () => {
  it('writes m:ss with a trimmed fraction only when needed, and hours only when present', () => {
    expect(formatTimeInput(0)).toBe('0:00')
    expect(formatTimeInput(9)).toBe('0:09')
    expect(formatTimeInput(65)).toBe('1:05')
    expect(formatTimeInput(8.5)).toBe('0:08.5')
    expect(formatTimeInput(1.97)).toBe('0:01.97')
    expect(formatTimeInput(3723.25)).toBe('1:02:03.25')
    // Rounds to the hundredth rather than printing float noise.
    expect(formatTimeInput(1.999)).toBe('0:02')
    expect(formatTimeInput(0.1 + 0.2)).toBe('0:00.3')
  })

  it('returns the empty string for what it cannot honestly write', () => {
    expect(formatTimeInput(-1)).toBe('')
    expect(formatTimeInput(Number.NaN)).toBe('')
    expect(formatTimeInput(Number.POSITIVE_INFINITY)).toBe('')
  })

  it('round-trips through parseTimeInput, and reads formatDuration output', () => {
    for (const seconds of [0, 0.5, 1.97, 8.5, 59.99, 60, 3599.5, 3600, 3723.25]) {
      expect(parseTimeInput(formatTimeInput(seconds))).toBeCloseTo(seconds, 2)
    }
    for (const whole of [0, 9, 65, 3723]) {
      expect(parseTimeInput(formatDuration(whole))).toBe(whole)
    }
  })
})

describe('customExportRange (#400)', () => {
  it('returns the typed range when both fields parse and the span lies in the sequence', () => {
    expect(customExportRange({ start: '6', end: '8' }, 10)).toEqual({
      range: { start: 6, end: 8 },
      error: null,
    })
    expect(customExportRange({ start: '0:02', end: '0:08.5' }, 10)).toEqual({
      range: { start: 2, end: 8.5 },
      error: null,
    })
  })

  it('accepts the pre-filled end, which is total rounded to the hundredth, and clamps it', () => {
    const total = 1.9666
    const result = customExportRange({ start: '0:00', end: formatTimeInput(total) }, total)
    expect(result.error).toBeNull()
    expect(result.range?.end).toBe(total)
  })

  it('names the one thing wrong, start first', () => {
    expect(customExportRange({ start: 'x', end: 'y' }, 10).error).toBe(
      'Enter the start as m:ss or in seconds.',
    )
    expect(customExportRange({ start: '1', end: '' }, 10).error).toBe(
      'Enter the end as m:ss or in seconds.',
    )
    expect(customExportRange({ start: '1', end: '12' }, 10).error).toBe(
      'The end cannot be past the end of the sequence (0:10).',
    )
    expect(customExportRange({ start: '8', end: '8' }, 10).error).toBe(
      'The end must come after the start.',
    )
    expect(customExportRange({ start: '9', end: '3' }, 10).error).toBe(
      'The end must come after the start.',
    )
    // A start at or past the sequence's end has no span before a valid end.
    expect(customExportRange({ start: '10', end: '10' }, 10).range).toBeNull()
  })
})
