import { describe, expect, it } from 'vitest'
import { INTRO_CHAPTER_NAME, formatChapterList } from './chapterList'
import type { ChapterMarker } from './timeline'

const marker = (time: number, name: string, id = `m${time}-${name}`): ChapterMarker => ({
  id,
  time,
  name,
})

/** The whole of a 10 minute project, the common case. */
const whole = { start: 0, end: 600 }

describe('formatChapterList (#488)', () => {
  it('writes one mm:ss line per marker, in order', () => {
    expect(
      formatChapterList([marker(0, 'Opening'), marker(65, 'The demo'), marker(605.5, 'Wrap up')], {
        start: 0,
        end: 700,
      }),
    ).toBe('00:00 Opening\n01:05 The demo\n10:05 Wrap up')
  })

  it('inserts a first line at 00:00 when no marker sits at the start', () => {
    // Players ignore a list that does not begin at zero, so the line is
    // added rather than the list being left unusable.
    expect(formatChapterList([marker(30, 'The demo')], whole)).toBe(
      `00:00 ${INTRO_CHAPTER_NAME}\n00:30 The demo`,
    )
  })

  it('inserts nothing when a marker already lands on the first second', () => {
    // 0.4 s floors to zero, so it IS the list's first line — inserting
    // another would give two chapters at 00:00.
    expect(formatChapterList([marker(0.4, 'Opening'), marker(30, 'The demo')], whole)).toBe(
      '00:00 Opening\n00:30 The demo',
    )
  })

  it('offsets every line to the range start, and drops what lies before it', () => {
    // The criterion's own case: a range starting at 1:00, a marker at 1:30.
    const markers = [marker(10, 'Before'), marker(90, 'The demo'), marker(120, 'Later')]
    expect(formatChapterList(markers, { start: 60, end: 300 })).toBe(
      `00:00 ${INTRO_CHAPTER_NAME}\n00:30 The demo\n01:00 Later`,
    )
  })

  it('drops markers at or past the range end — the end is where the export stops', () => {
    const markers = [marker(5, 'In'), marker(60, 'At the end'), marker(75, 'Past it')]
    expect(formatChapterList(markers, { start: 0, end: 60 })).toBe(
      `00:00 ${INTRO_CHAPTER_NAME}\n00:05 In`,
    )
  })

  it('drops the markers the model keeps past the sequence end (#487)', () => {
    // markersOf holds them; a whole-project export does not cover them.
    expect(formatChapterList([marker(30, 'Real'), marker(9000, 'Stranded')], whole)).toBe(
      `00:00 ${INTRO_CHAPTER_NAME}\n00:30 Real`,
    )
  })

  it('switches every line to h:mm:ss once any one reaches an hour', () => {
    // Including the inserted line: the column must not change width.
    expect(
      formatChapterList([marker(90, 'Early'), marker(3600, 'The hour'), marker(3725, 'After')], {
        start: 0,
        end: 7200,
      }),
    ).toBe(`0:00:00 ${INTRO_CHAPTER_NAME}\n0:01:30 Early\n1:00:00 The hour\n1:02:05 After`)
  })

  it('counts the hour from the offset, not from the sequence time', () => {
    // A marker an hour in, exported from 0:30 on, is 59:30 into the file —
    // so no line grows an hours field.
    expect(formatChapterList([marker(3600, 'The hour')], { start: 30, end: 7200 })).toBe(
      `00:00 ${INTRO_CHAPTER_NAME}\n59:30 The hour`,
    )
  })

  it('floors rather than rounds, so a chapter never begins after what it marks', () => {
    // The app's readouts round (a tick at 2.5 s reads 0:03); this floors, on
    // purpose. 2.9 → 00:02, not 00:03.
    expect(formatChapterList([marker(2.9, 'Sharp')], whole)).toBe(
      `00:00 ${INTRO_CHAPTER_NAME}\n00:02 Sharp`,
    )
  })

  it('gives two markers in the same second a line each, in order', () => {
    // The platform's problem to merge, not ours to guess (#488).
    expect(
      formatChapterList([marker(12.2, 'First'), marker(12.8, 'Second')], whole),
    ).toBe(`00:00 ${INTRO_CHAPTER_NAME}\n00:12 First\n00:12 Second`)
  })

  it('sorts by time, so an unsorted list still reads chronologically', () => {
    expect(formatChapterList([marker(90, 'Later'), marker(30, 'Earlier')], whole)).toBe(
      `00:00 ${INTRO_CHAPTER_NAME}\n00:30 Earlier\n01:30 Later`,
    )
  })

  it('keeps a name on one line — the format is line-based', () => {
    expect(formatChapterList([marker(30, 'A name\nwith a break  in it')], whole)).toBe(
      `00:00 ${INTRO_CHAPTER_NAME}\n00:30 A name with a break in it`,
    )
  })

  it('is empty when the range holds no markers, so the button has something to disable on', () => {
    expect(formatChapterList([], whole)).toBe('')
    expect(formatChapterList([marker(30, 'Outside')], { start: 100, end: 200 })).toBe('')
  })

  it('pads minutes and seconds, so the times line up as a column', () => {
    expect(formatChapterList([marker(0, 'A'), marker(9, 'B'), marker(540, 'C')], whole)).toBe(
      '00:00 A\n00:09 B\n09:00 C',
    )
  })
})
