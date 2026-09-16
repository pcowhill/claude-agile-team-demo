import { describe, expect, it } from 'vitest'
import type { GuideDocument } from '../lib/guide/document'
import type { GuideConstants } from '../lib/guide/constantNames'
import { buildIndex, queryTerms, renderedText, searchGuide } from './search'

const constants: GuideConstants = {
  HISTORY_LIMIT: '100',
  DEFAULT_STILL_DURATION: '5',
  DEFAULT_DUCK_LEVEL_PERCENT: '25',
  DEFAULT_TRANSITION_DURATION: '1',
  DEFAULT_TEXT_DURATION: '3',
  STEP_SECONDS: '0.1',
  LARGE_STEP_SECONDS: '1',
  CROP_MIN_KEPT_PERCENT: '10',
  COLOR_ADJUSTMENT_MIN: '0',
  COLOR_ADJUSTMENT_MAX: '200',
  DEFAULT_SPEED_FACTOR: '0.5',
  DEFAULT_SPEED_LENGTH: '2',
  DEFAULT_PAUSE_HOLD: '1',
  FREEZE_STILL_DURATION: '2',
  DEFAULT_ZOOM_SCALE: '2',
  DEFAULT_ZOOM_RAMP: '0.5',
  DEFAULT_ZOOM_HOLD: '1',
  EDITOR_ZOOM_MIN_SCALE: '1.05',
  EDITOR_ZOOM_MAX_SCALE: '10',
  EDITOR_NUDGE_PERCENT: '1',
  EDITOR_NUDGE_LARGE_PERCENT: '5',
  ZOOM_SCALE_STEP: '0.1',
  RECT_SIZE_STEP_PERCENT: '2',
  TEXT_SIZE_STEP: '0.01',
  LOOP_REST_SECONDS: '1',
  MAX_ROUNDED_RADIUS_PERCENT: '50',
  DEFAULT_ROUNDED_RADIUS_PERCENT: '15',
  AUTOSAVE_DEBOUNCE_SECONDS: '1.5',
  RECORDING_KEYFRAME_INTERVAL_SECONDS: '1',
  RELINK_DURATION_TOLERANCE_PERCENT: '1',
  RELINK_DURATION_TOLERANCE_MIN_SECONDS: '0.1',
  PROJECT_FILE_EXTENSION: '.bvep',
  DEFAULT_OVERLAY_SIZE_PERCENT: '35',
  DEFAULT_TEXT_SIZE_PERCENT: '8',
  MIN_TEXT_SIZE_PERCENT: '1',
  MAX_TEXT_SIZE_PERCENT: '100',
  TEXT_LINE_HEIGHT: '1.2',
  SUBTITLE_DEFAULT_SIZE_PERCENT: '5',
  SUBTITLE_DEFAULT_Y_PERCENT: '90',
  DUCK_RAMP_SECONDS: '0.25',
  SNAP_PIXELS: '8',
}

const text = (value: string) => ({ kind: 'text' as const, text: value })

const fixture: GuideDocument = {
  sections: [
    {
      id: 'audio',
      title: 'Audio',
      headings: [
        { level: 2, anchor: 'duck-others', text: 'Duck others' },
        { level: 2, anchor: 'volume', text: 'Volume' },
      ],
      blocks: [
        { kind: 'paragraph', inlines: [text('Everything about sound: volume, fades and ducking.')] },
        { kind: 'heading', level: 2, anchor: 'duck-others', inlines: [text('Duck others')], text: 'Duck others' },
        {
          kind: 'paragraph',
          inlines: [text('With Duck others on, every other source drops to '), { kind: 'placeholder', name: 'DEFAULT_DUCK_LEVEL_PERCENT' }, text('% while the track plays.')],
        },
        { kind: 'heading', level: 2, anchor: 'volume', inlines: [text('Volume')], text: 'Volume' },
        {
          kind: 'list',
          ordered: false,
          start: 1,
          items: [{ blocks: [{ kind: 'paragraph', inlines: [text('Drag the slider')] }] }],
        },
        { kind: 'rule' },
      ],
    },
    {
      id: 'ducks',
      title: 'Ducks and drakes',
      headings: [],
      blocks: [{ kind: 'paragraph', inlines: [text('A section about waterfowl, for ranking.')] }],
    },
  ],
}

describe('buildIndex (#478 §5)', () => {
  it('makes a passage of each title, heading and body block, under its nearest heading', () => {
    const passages = buildIndex(fixture, constants)
    expect(passages.map((p) => [p.kind, p.anchor, p.text])).toEqual([
      ['title', null, 'Audio'],
      ['body', null, 'Everything about sound: volume, fades and ducking.'],
      ['heading', 'duck-others', 'Duck others'],
      ['body', 'duck-others', 'With Duck others on, every other source drops to 25% while the track plays.'],
      ['heading', 'volume', 'Volume'],
      ['body', 'volume', 'Drag the slider'],
      ['title', null, 'Ducks and drakes'],
      ['body', null, 'A section about waterfowl, for ranking.'],
    ])
  })

  it('renders placeholders through the constants, so a number is searchable as the reader sees it', () => {
    expect(renderedText([text('drops to '), { kind: 'placeholder', name: 'HISTORY_LIMIT' }], constants)).toBe(
      'drops to 100',
    )
  })
})

describe('searchGuide (#478 §5)', () => {
  const passages = buildIndex(fixture, constants)

  it('matches by word prefix', () => {
    const hits = searchGuide(passages, 'duck')
    expect(hits.map((hit) => hit.passage.text)).toEqual([
      'Ducks and drakes',
      'Duck others',
      'Everything about sound: volume, fades and ducking.',
      'With Duck others on, every other source drops to 25% while the track plays.',
    ])
  })

  it('ranks a title above a heading above a body match, then document order', () => {
    const kinds = searchGuide(passages, 'duck').map((hit) => hit.passage.kind)
    expect(kinds).toEqual(['title', 'heading', 'body', 'body'])
  })

  it('requires every word to match within one passage', () => {
    const hits = searchGuide(passages, 'duck others')
    expect(hits.map((hit) => [hit.passage.kind, hit.passage.anchor])).toEqual([
      ['heading', 'duck-others'],
      ['body', 'duck-others'],
    ])
    expect(searchGuide(passages, 'duck slider')).toEqual([])
  })

  it('ignores case and punctuation, and matches nothing on an empty query', () => {
    expect(searchGuide(passages, 'DUCK, others!')).toHaveLength(2)
    expect(searchGuide(passages, '   ')).toEqual([])
    expect(queryTerms('Save / Save As…')).toEqual(['save', 'save', 'as'])
  })

  it('gives each hit a snippet with the matched prefixes as highlight ranges', () => {
    const [heading, body] = searchGuide(passages, 'duck oth')
    expect(heading.snippet).toBe('Duck others')
    expect(heading.ranges).toEqual([
      [0, 4],
      [5, 8],
    ])
    expect(body.snippet).toBe('With Duck others on, every other source drops to 25% while the track plays.')
    expect(body.ranges.map(([from, to]) => body.snippet.slice(from, to))).toEqual(['Duck', 'oth', 'oth'])
  })

  it('windows a long passage around the first match with ellipses, shifting the ranges', () => {
    const long = 'x '.repeat(100) + 'the waterfowl ' + 'y '.repeat(100)
    const hits = searchGuide([{ section: 's', sectionTitle: 'S', anchor: null, heading: null, kind: 'body', text: long }], 'water')
    expect(hits).toHaveLength(1)
    const [hit] = hits
    expect(hit.snippet.startsWith('…')).toBe(true)
    expect(hit.snippet.endsWith('…')).toBe(true)
    expect(hit.snippet.length).toBeLessThanOrEqual(142)
    const [[from, to]] = hit.ranges
    expect(hit.snippet.slice(from, to)).toBe('water')
  })

  it('caps the number of hits', () => {
    expect(searchGuide(passages, 'a', 1)).toHaveLength(1)
  })
})
