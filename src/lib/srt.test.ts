import { describe, expect, it } from 'vitest'
import { parseSrt, SUBTITLE_TEXT_DEFAULTS, subtitleOverlaySpec } from './srt'
import { isValidTextOverlaySpec } from './textOverlay'

describe('parseSrt (#249)', () => {
  it('parses a well-formed file into cues in order', () => {
    const { cues, skipped } = parseSrt(
      '1\n00:00:01,000 --> 00:00:02,500\nHello there\n\n2\n00:00:03,000 --> 00:00:04,250\nSecond line\n',
    )
    expect(skipped).toEqual([])
    expect(cues).toEqual([
      { start: 1, end: 2.5, content: 'Hello there' },
      { start: 3, end: 4.25, content: 'Second line' },
    ])
  })

  it('parses hours and keeps multi-line cue text with internal newlines', () => {
    const { cues } = parseSrt('1\n01:02:03,004 --> 01:02:04,000\nline one\nline two')
    expect(cues).toEqual([
      { start: 3723.004, end: 3724, content: 'line one\nline two' },
    ])
  })

  it('tolerates a UTF-8 BOM, CRLF newlines, and extra blank lines', () => {
    const { cues, skipped } = parseSrt(
      '﻿1\r\n00:00:01,000 --> 00:00:02,000\r\nBOM and CRLF\r\n\r\n\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nStill fine\r\n',
    )
    expect(skipped).toEqual([])
    expect(cues.map((cue) => cue.content)).toEqual(['BOM and CRLF', 'Still fine'])
  })

  it('tolerates malformed, missing, and non-sequential cue indices', () => {
    const { cues, skipped } = parseSrt(
      '7\n00:00:01,000 --> 00:00:02,000\nSeven first\n\n00:00:03,000 --> 00:00:04,000\nNo index\n\nnot-a-number\n00:00:05,000 --> 00:00:06,000\nJunk index',
    )
    expect(skipped).toEqual([])
    expect(cues.map((cue) => cue.content)).toEqual(['Seven first', 'No index', 'Junk index'])
  })

  it('accepts the dot-milliseconds dialect and hourless timings', () => {
    const { cues } = parseSrt('1\n00:01.500 --> 00:02.000\nDots, no hours')
    expect(cues).toEqual([{ start: 1.5, end: 2, content: 'Dots, no hours' }])
  })

  it('right-pads short millisecond fields (",5" is 500 ms)', () => {
    const { cues } = parseSrt('1\n00:00:01,5 --> 00:00:02,25\npadded')
    expect(cues).toEqual([{ start: 1.5, end: 2.25, content: 'padded' }])
  })

  it('ignores positioning hints after the end time', () => {
    const { cues } = parseSrt('1\n00:00:01,000 --> 00:00:02,000 X1:100 X2:200\npositioned')
    expect(cues).toEqual([{ start: 1, end: 2, content: 'positioned' }])
  })

  it('strips HTML-ish markup and ASS override tags from cue text', () => {
    const { cues } = parseSrt(
      '1\n00:00:01,000 --> 00:00:02,000\n<i>italic</i> and <font color="#ff0000">red</font>\n{\\an8}top text',
    )
    expect(cues).toEqual([{ start: 1, end: 2, content: 'italic and red\ntop text' }])
  })

  it('keeps overlapping cues — each becomes its own overlay', () => {
    const { cues, skipped } = parseSrt(
      '1\n00:00:01,000 --> 00:00:05,000\nlong\n\n2\n00:00:02,000 --> 00:00:03,000\ninside',
    )
    expect(skipped).toEqual([])
    expect(cues).toHaveLength(2)
  })

  it('skips blocks with no timing line, naming the block', () => {
    const { cues, skipped } = parseSrt(
      '1\njust text, no timing\n\n2\n00:00:03,000 --> 00:00:04,000\ngood',
    )
    expect(cues.map((cue) => cue.content)).toEqual(['good'])
    expect(skipped).toEqual([{ block: 1, reason: 'has no timing line' }])
  })

  it('skips cues that end at or before their start', () => {
    const { cues, skipped } = parseSrt(
      '1\n00:00:02,000 --> 00:00:02,000\nzero\n\n2\n00:00:05,000 --> 00:00:04,000\ninverted',
    )
    expect(cues).toEqual([])
    expect(skipped).toEqual([
      { block: 1, reason: 'ends at or before its start' },
      { block: 2, reason: 'ends at or before its start' },
    ])
  })

  it('skips cues whose text is empty once markup is stripped', () => {
    const { cues, skipped } = parseSrt('1\n00:00:01,000 --> 00:00:02,000\n<i></i>')
    expect(cues).toEqual([])
    expect(skipped).toEqual([{ block: 1, reason: 'has no text' }])
  })

  it('yields nothing for empty or non-SRT input without throwing', () => {
    expect(parseSrt('')).toEqual({ cues: [], skipped: [] })
    expect(parseSrt('   \n\n  ')).toEqual({ cues: [], skipped: [] })
    const prose = parseSrt('This is just a paragraph of prose,\nnot subtitles at all.')
    expect(prose.cues).toEqual([])
    expect(prose.skipped).toEqual([{ block: 1, reason: 'has no timing line' }])
  })
})

describe('subtitleOverlaySpec (#249)', () => {
  it('maps a cue to a valid overlay spec with the subtitle defaults and marker', () => {
    const spec = subtitleOverlaySpec({ start: 1.5, end: 4, content: 'Hello' })
    expect(spec).toEqual({
      content: 'Hello',
      offset: 1.5,
      duration: 2.5,
      ...SUBTITLE_TEXT_DEFAULTS,
      subtitle: true,
    })
    expect(isValidTextOverlaySpec(spec)).toBe(true)
  })

  it('the defaults sit at bottom-center within every clamped range', () => {
    expect(SUBTITLE_TEXT_DEFAULTS.x).toBe(0.5)
    expect(SUBTITLE_TEXT_DEFAULTS.y).toBeGreaterThan(0.75)
    expect(SUBTITLE_TEXT_DEFAULTS.y).toBeLessThanOrEqual(1)
  })
})
