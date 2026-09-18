import { describe, expect, it } from 'vitest'
import { chapterFileName, chapterSpans } from './chapterExport'
import { INTRO_CHAPTER_NAME, formatChapterList } from './chapterList'
import type { ChapterMarker } from './timeline'

const marker = (time: number, name: string, id = `m${time}-${name}`): ChapterMarker => ({
  id,
  time,
  name,
})

const whole = (end: number) => ({ start: 0, end })

/** What the spans cover, as `[start, end)` pairs, for readable assertions. */
const bounds = (markers: ChapterMarker[], range: { start: number; end: number }) =>
  chapterSpans(markers, range).map((span) => [span.range.start, span.range.end])

const names = (markers: ChapterMarker[], range: { start: number; end: number }) =>
  chapterSpans(markers, range).map((span) => span.name)

describe('chapterSpans', () => {
  it('opens with an Intro span when no marker sits in the first second', () => {
    const markers = [marker(10, 'Setup'), marker(25, 'Build')]
    expect(names(markers, whole(40))).toEqual([INTRO_CHAPTER_NAME, 'Setup', 'Build'])
    expect(bounds(markers, whole(40))).toEqual([
      [0, 10],
      [10, 25],
      [25, 40],
    ])
  })

  it('has no Intro span when a marker sits at the start', () => {
    const markers = [marker(0, 'Setup'), marker(25, 'Build')]
    expect(names(markers, whole(40))).toEqual(['Setup', 'Build'])
    expect(bounds(markers, whole(40))).toEqual([
      [0, 25],
      [25, 40],
    ])
  })

  it('treats a marker inside the first second as the opening chapter, losing none of it', () => {
    // The list floors, so 0.4s reads as 00:00 and gets no Intro line. The
    // span has to begin at the range's start all the same, or those 0.4s
    // would be in no file at all.
    const markers = [marker(0.4, 'Setup'), marker(25, 'Build')]
    expect(names(markers, whole(40))).toEqual(['Setup', 'Build'])
    expect(bounds(markers, whole(40))).toEqual([
      [0, 25],
      [25, 40],
    ])
  })

  it('makes boundaries half-open and gives the tail to the last chapter', () => {
    const markers = [marker(0, 'One'), marker(10, 'Two')]
    const spans = chapterSpans(markers, whole(30))
    expect(spans[0].range.end).toBe(10)
    expect(spans[1].range.start).toBe(10)
    expect(spans[spans.length - 1].range.end).toBe(30)
  })

  it('produces exactly one span for a single marker at the start', () => {
    expect(bounds([marker(0, 'Only')], whole(12))).toEqual([[0, 12]])
  })

  it('keeps timeline order for two markers in the same second', () => {
    const markers = [marker(4.2, 'Second', 'b'), marker(4.9, 'Third', 'c')]
    expect(names(markers, whole(20))).toEqual([INTRO_CHAPTER_NAME, 'Second', 'Third'])
    expect(bounds(markers, whole(20))).toEqual([
      [0, 4.2],
      [4.2, 4.9],
      [4.9, 20],
    ])
  })

  it('drops markers outside the range, including ones past the sequence end', () => {
    const markers = [marker(2, 'Before'), marker(12, 'Inside'), marker(99, 'Past the end')]
    expect(names(markers, { start: 5, end: 20 })).toEqual([INTRO_CHAPTER_NAME, 'Inside'])
    expect(bounds(markers, { start: 5, end: 20 })).toEqual([
      [5, 12],
      [12, 20],
    ])
  })

  it('treats a marker on the end boundary as outside, like the chapter list', () => {
    expect(names([marker(0, 'One'), marker(20, 'On the edge')], whole(20))).toEqual(['One'])
  })

  it('returns nothing when the range holds no markers', () => {
    expect(chapterSpans([], whole(30))).toEqual([])
    expect(chapterSpans([marker(50, 'Later')], whole(30))).toEqual([])
  })

  it('numbers the spans from one, in order', () => {
    const spans = chapterSpans([marker(5, 'A'), marker(9, 'B')], whole(20))
    expect(spans.map((span) => span.index)).toEqual([1, 2, 3])
  })

  it('collapses whitespace in a name, as the chapter list does', () => {
    expect(names([marker(0, 'Two\n  lines')], whole(10))).toEqual(['Two lines'])
  })

  it('drops an empty span and closes up the numbering', () => {
    // Unreachable from the app — the reducer refuses a marker within
    // MARKER_TIME_EPSILON of another — but a hand-edited project file can
    // carry it, and resolveExportRange throws on a range of no length.
    const markers = [marker(0, 'One', 'a'), marker(8, 'Twin', 'b'), marker(8, 'Twin again', 'c')]
    const spans = chapterSpans(markers, whole(20))
    expect(spans.map((span) => span.name)).toEqual(['One', 'Twin again'])
    expect(spans.map((span) => span.index)).toEqual([1, 2])
    expect(spans.map((span) => [span.range.start, span.range.end])).toEqual([
      [0, 8],
      [8, 20],
    ])
  })
})

describe('chapterSpans agrees with formatChapterList', () => {
  // #529's first decision, asserted rather than trusted: the files a run
  // produces and the list Copy chapter list writes describe the same
  // chapters. A change to either module that broke the correspondence would
  // fail here rather than in a customer's folder.
  const cases: { what: string; markers: ChapterMarker[]; range: { start: number; end: number } }[] =
    [
      { what: 'no marker at the start', markers: [marker(10, 'A'), marker(20, 'B')], range: whole(30) },
      { what: 'a marker at the start', markers: [marker(0, 'A'), marker(20, 'B')], range: whole(30) },
      {
        what: 'a marker inside the first second',
        markers: [marker(0.4, 'A'), marker(20, 'B')],
        range: whole(30),
      },
      { what: 'one marker only', markers: [marker(7, 'Only')], range: whole(30) },
      {
        what: 'an offset range',
        markers: [marker(2, 'Before'), marker(12, 'Inside'), marker(18, 'Also')],
        range: { start: 5, end: 25 },
      },
      {
        what: 'two markers in one second',
        markers: [marker(4.2, 'A', 'a'), marker(4.9, 'B', 'b')],
        range: whole(20),
      },
    ]

  for (const { what, markers, range } of cases) {
    it(`produces one span per list line — ${what}`, () => {
      const spans = chapterSpans(markers, range)
      const lines = formatChapterList(markers, range).split('\n').filter((line) => line !== '')
      expect(spans).toHaveLength(lines.length)
      // And in the same order, under the same names.
      expect(spans.map((span) => span.name)).toEqual(
        lines.map((line) => line.replace(/^\S+\s/, '')),
      )
    })
  }
})

describe('chapterFileName', () => {
  const span = (index: number, name: string) => ({
    index,
    name,
    range: { start: 0, end: 1 },
  })

  it('leads with the zero-padded index and keeps the name', () => {
    expect(chapterFileName(span(1, 'Setup'), 4, 'webm')).toBe('01 Setup.webm')
    expect(chapterFileName(span(4, 'Wrap up'), 4, 'webm')).toBe('04 Wrap up.webm')
  })

  it('widens the index past nine so a folder still sorts in chapter order', () => {
    expect(chapterFileName(span(9, 'Nine'), 11, 'mp4')).toBe('09 Nine.mp4')
    expect(chapterFileName(span(11, 'Eleven'), 11, 'mp4')).toBe('11 Eleven.mp4')
    expect(chapterFileName(span(3, 'Three'), 100, 'mp4')).toBe('003 Three.mp4')
  })

  it('keeps two digits even for a short run', () => {
    expect(chapterFileName(span(2, 'Two'), 2, 'webm')).toBe('02 Two.webm')
  })

  it('replaces characters no common filesystem accepts', () => {
    expect(chapterFileName(span(1, 'Part 1/2: "the?fun" <one>'), 3, 'webm')).toBe(
      '01 Part 1 2 the fun one.webm',
    )
    expect(chapterFileName(span(2, 'a\\b*c|d'), 3, 'webm')).toBe('02 a b c d.webm')
  })

  it('does not join words across a dropped separator', () => {
    // The reason UNSAFE_IN_FILENAME substitutes a space rather than deleting.
    expect(chapterFileName(span(1, 'Part 1/2'), 2, 'webm')).toBe('01 Part 1 2.webm')
  })

  it('collapses runs of whitespace and newlines', () => {
    expect(chapterFileName(span(1, '  Setup \n\n  the   CLI  '), 2, 'webm')).toBe(
      '01 Setup the CLI.webm',
    )
  })

  it('replaces control characters, which only a hand-edited project can carry', () => {
    expect(chapterFileName(span(1, 'Bell\u0007and\u0000nul'), 2, 'webm')).toBe(
      '01 Bell and nul.webm',
    )
    expect(chapterFileName(span(2, '\u007f'), 2, 'webm')).toBe('02.webm')
  })

  it('strips leading dots so a chapter never becomes a hidden file', () => {
    expect(chapterFileName(span(1, '...hidden'), 2, 'webm')).toBe('01 hidden.webm')
    expect(chapterFileName(span(2, '. leading dot'), 2, 'webm')).toBe('02 leading dot.webm')
  })

  it('falls back to the index alone when nothing usable survives', () => {
    expect(chapterFileName(span(3, '///'), 4, 'webm')).toBe('03.webm')
    expect(chapterFileName(span(3, '...'), 4, 'webm')).toBe('03.webm')
    expect(chapterFileName(span(3, '   '), 4, 'webm')).toBe('03.webm')
    expect(chapterFileName(span(3, ''), 4, 'webm')).toBe('03.webm')
  })

  it('gives two markers with the same name two distinct files', () => {
    expect(chapterFileName(span(2, 'Demo'), 3, 'webm')).toBe('02 Demo.webm')
    expect(chapterFileName(span(3, 'Demo'), 3, 'webm')).toBe('03 Demo.webm')
  })

  it('uses the format’s own extension', () => {
    expect(chapterFileName(span(1, 'Intro'), 1, 'mp4')).toBe('01 Intro.mp4')
    expect(chapterFileName(span(1, 'Intro'), 1, 'gif')).toBe('01 Intro.gif')
  })
})
