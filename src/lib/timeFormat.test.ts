import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from './settings'
import {
  TIME_FORMAT_CHOICES,
  formatMinutesField,
  formatTimeReadout,
  minutesFieldCommit,
  parseMinutesField,
  steppedTime,
  timeFormatLabel,
} from './timeFormat'

describe('time format choices (#848)', () => {
  it('offers the default first, so a fresh browser opens on seconds', () => {
    expect(TIME_FORMAT_CHOICES[0]).toBe(DEFAULT_SETTINGS.timeFormat)
    expect(DEFAULT_SETTINGS.timeFormat).toBe('seconds')
    expect(TIME_FORMAT_CHOICES.map(timeFormatLabel)).toEqual([
      'Seconds (83.5 s)',
      'Minutes and seconds (1:23.500)',
    ])
  })
})

describe('formatMinutesField (#848)', () => {
  it.each([
    [83.5, '1:23.500'],
    [0.5, '0:00.500'],
    [0, '0:00.000'],
    [59.9996, '1:00.000'],
    [600, '10:00.000'],
    [3599.999, '59:59.999'],
    [3600, '1:00:00.000'],
    [3725.25, '1:02:05.250'],
    [12.3456, '0:12.346'],
  ])('shows %s s as %s', (seconds, text) => {
    expect(formatMinutesField(seconds)).toBe(text)
  })

  it('shows a value it cannot place as zero rather than as garbage', () => {
    expect(formatMinutesField(-1)).toBe('0:00.000')
    expect(formatMinutesField(Number.NaN)).toBe('0:00.000')
  })

  it('reads every value it writes back to the same millisecond', () => {
    // A sweep across the first two hours, in steps that are not round in
    // binary, so float error in either direction would show.
    for (let millis = 0; millis < 7_300_000; millis += 997) {
      const seconds = millis / 1000
      const back = parseMinutesField(formatMinutesField(seconds))
      expect(back).not.toBeNull()
      expect(Math.round((back as number) * 1000)).toBe(millis)
    }
  })
})

describe('parseMinutesField (#848)', () => {
  it.each([
    ['1:23.5', 83.5],
    ['1:23.500', 83.5],
    ['1:23', 83],
    ['83.5', 83.5],
    ['0:00.250', 0.25],
    ['1:02:05.250', 3725.25],
    ['  1:23.5 ', 83.5],
  ])('reads %j as %s s', (text, seconds) => {
    expect(parseMinutesField(text)).toBeCloseTo(seconds, 9)
  })

  it.each(['1:75', 'abc', '', '   ', '-1', '1:2:3:4', '1.5:20'])('rejects %j', (text) => {
    expect(parseMinutesField(text)).toBeNull()
  })
})

describe('minutesFieldCommit (#848)', () => {
  it('commits what parses and differs from the stored value', () => {
    expect(minutesFieldCommit('1:23.5', 90)).toBe(83.5)
    expect(minutesFieldCommit('83.5', 90)).toBe(83.5)
  })

  it('commits nothing for text that does not parse', () => {
    expect(minutesFieldCommit('1:75', 90)).toBeNull()
    expect(minutesFieldCommit('', 90)).toBeNull()
  })

  it('commits nothing for the value the box shows, keeping a finer stored value', () => {
    // 12.3456 shows as 0:12.346; leaving that text in place must not
    // rewrite the stored value to 12.346.
    expect(minutesFieldCommit(formatMinutesField(12.3456), 12.3456)).toBeNull()
    expect(minutesFieldCommit('12.346', 12.3456)).toBeNull()
    // A real change of a millisecond does commit.
    expect(minutesFieldCommit('0:12.347', 12.3456)).toBe(12.347)
  })
})

describe('formatTimeReadout (#848)', () => {
  it('reads as today in seconds and as the field does in minutes', () => {
    expect(formatTimeReadout(12.5, 'seconds')).toBe('12.50 s')
    expect(formatTimeReadout(83.5, 'minutes')).toBe('1:23.500')
  })
})

describe('steppedTime (#848)', () => {
  it('steps by the field step in either direction', () => {
    expect(steppedTime(83.5, 0.1, 1, 0, 100)).toBe(83.6)
    expect(steppedTime(83.5, 0.1, -1, 0, 100)).toBe(83.4)
  })

  it('stays inside the field range', () => {
    expect(steppedTime(0.05, 0.1, -1, 0, 100)).toBe(0)
    expect(steppedTime(99.95, 0.1, 1, 0, 100)).toBe(100)
  })

  it('collects no float noise over repeated steps', () => {
    let value = 0
    for (let i = 0; i < 30; i += 1) value = steppedTime(value, 0.1, 1, 0, 100)
    expect(value).toBe(3)
  })
})
