import { describe, expect, it } from 'vitest'
import type { RemapEffect, RemapSpec } from './remap'
import type { TimelineEntry, TimelineState, ZoomEffect } from './timeline'
import { remapsForEntry, timelineReducer, zoomWindowDuration, zoomsForEntry } from './timeline'
import { trimEffectsPreview, trimWarningText } from './trimEffects'

const entry = (overrides: Partial<TimelineEntry> & { id: string }): TimelineEntry => ({
  clipId: 'clip-a',
  name: 'clip.webm',
  duration: 10,
  url: 'blob:clip-a',
  inPoint: 0,
  outPoint: 10,
  ...overrides,
})

/** A zoom on e1 whose window runs 4 → 8 s into the trim: ramp 1, hold 2, ramp 1. */
const zoom: ZoomEffect = {
  id: 'z1',
  entryId: 'e1',
  start: 4,
  rampIn: 1,
  hold: 2,
  rampOut: 1,
  scale: 2,
  centerX: 0.5,
  centerY: 0.5,
}
const speed: RemapEffect = { id: 's1', entryId: 'e1', kind: 'speed', start: 2, end: 6, factor: 0.5 }
const pause: RemapEffect = { id: 'p1', entryId: 'e1', kind: 'pause', at: 7, hold: 1 }

const withZoom = (): TimelineState => ({ entries: [entry({ id: 'e1' })], zooms: [zoom] })
const withRemaps = (...remaps: RemapEffect[]): TimelineState => ({
  entries: [entry({ id: 'e1' })],
  remaps,
})

/** What Apply does: the reducer's own `entry-trimmed`. */
const applied = (state: TimelineState, inPoint: number, outPoint: number) =>
  timelineReducer(state, { type: 'entry-trimmed', id: 'e1', inPoint, outPoint })

describe('trimEffectsPreview: a zoom (#709)', () => {
  it('warns "shortens" with Out inside the zoom, and Apply then shortens it', () => {
    const preview = trimEffectsPreview(withZoom(), 'e1', { inPoint: 0, outPoint: 7 })
    expect(preview.warnings).toEqual([{ id: 'z1', kind: 'zoom', name: 'Zoom 1', outcome: 'shortens' }])
    expect(trimWarningText(preview.warnings)).toBe('Trimming here shortens Zoom 1.')
    // Apply: the window loses its ramp out and ends at the new end, 7 s.
    const after = zoomsForEntry(applied(withZoom(), 0, 7), 'e1')[0]
    expect(after.start).toBe(4)
    expect(zoomWindowDuration(after)).toBe(3)
    expect(after.rampOut).toBe(0)
    // The mark is where it now sits: 4 → 7 s on the source.
    expect(preview.marks).toEqual([{ id: 'z1', kind: 'zoom', name: 'Zoom 1', start: 4, end: 7 }])
  })

  it('warns "removes" with Out before the zoom starts, and Apply then leaves it zero-length', () => {
    const preview = trimEffectsPreview(withZoom(), 'e1', { inPoint: 0, outPoint: 3.5 })
    expect(preview.warnings).toEqual([{ id: 'z1', kind: 'zoom', name: 'Zoom 1', outcome: 'removes' }])
    expect(trimWarningText(preview.warnings)).toBe('Trimming here removes Zoom 1.')
    const after = zoomsForEntry(applied(withZoom(), 0, 3.5), 'e1')[0]
    // Kept, so an un-trim restores it, but nothing of it plays.
    expect(after.start).toBe(3.5)
    expect(zoomWindowDuration(after)).toBe(0)
    expect(preview.marks).toEqual([])
  })

  it('shows nothing once Out is back past the zoom, and Apply then leaves it as it was', () => {
    const preview = trimEffectsPreview(withZoom(), 'e1', { inPoint: 0, outPoint: 9 })
    expect(preview.warnings).toEqual([])
    expect(trimWarningText(preview.warnings)).toBeNull()
    expect(zoomsForEntry(applied(withZoom(), 0, 9), 'e1')[0]).toEqual(zoom)
    expect(preview.marks).toEqual([{ id: 'z1', kind: 'zoom', name: 'Zoom 1', start: 4, end: 8 }])
  })

  it('moves the mark with In, and warns when that pushes the zoom past the end', () => {
    // Effects sit in seconds into the trim, so In at 1 carries the zoom to
    // 5 → 9 on the source, still whole inside Out at 10.
    const riding = trimEffectsPreview(withZoom(), 'e1', { inPoint: 1, outPoint: 10 })
    expect(riding.warnings).toEqual([])
    expect(riding.marks).toEqual([{ id: 'z1', kind: 'zoom', name: 'Zoom 1', start: 5, end: 9 }])
    // In at 3 leaves 7 s, and the zoom's 4 → 8 no longer fits.
    const cut = trimEffectsPreview(withZoom(), 'e1', { inPoint: 3, outPoint: 10 })
    expect(cut.warnings.map(({ outcome }) => outcome)).toEqual(['shortens'])
    expect(zoomWindowDuration(zoomsForEntry(applied(withZoom(), 3, 10), 'e1')[0])).toBe(3)
  })
})

describe('trimEffectsPreview: speed segments and pauses (#709)', () => {
  it('a speed segment: "shortens" inside it, "removes" before it, nothing past it', () => {
    const shortens = trimEffectsPreview(withRemaps(speed), 'e1', { inPoint: 0, outPoint: 5 })
    expect(shortens.warnings).toEqual([
      { id: 's1', kind: 'speed', name: 'Speed segment 1', outcome: 'shortens' },
    ])
    expect(remapsForEntry(applied(withRemaps(speed), 0, 5), 'e1')[0]).toMatchObject({ start: 2, end: 5 })

    const removes = trimEffectsPreview(withRemaps(speed), 'e1', { inPoint: 0, outPoint: 1.5 })
    expect(removes.warnings.map(({ outcome }) => outcome)).toEqual(['removes'])
    expect(remapsForEntry(applied(withRemaps(speed), 0, 1.5), 'e1')[0]).toMatchObject({ start: 1.5, end: 1.5 })
    expect(removes.marks).toEqual([])

    const clear = trimEffectsPreview(withRemaps(speed), 'e1', { inPoint: 0, outPoint: 8 })
    expect(clear.warnings).toEqual([])
    expect(clear.marks).toEqual([{ id: 's1', kind: 'speed', name: 'Speed segment 1', start: 2, end: 6 }])
  })

  it('a pause: "moves … to the new end" once Out passes it, nothing before', () => {
    const moves = trimEffectsPreview(withRemaps(pause), 'e1', { inPoint: 0, outPoint: 5 })
    expect(moves.warnings).toEqual([{ id: 'p1', kind: 'pause', name: 'Pause 1', outcome: 'moves' }])
    expect(trimWarningText(moves.warnings)).toBe('Trimming here moves Pause 1 to the new end.')
    // Apply: the pause keeps its hold and freezes the new last frame.
    expect(remapsForEntry(applied(withRemaps(pause), 0, 5), 'e1')[0]).toMatchObject({ at: 5, hold: 1 })
    expect(moves.marks).toEqual([{ id: 'p1', kind: 'pause', name: 'Pause 1', start: 5, end: 5 }])

    const clear = trimEffectsPreview(withRemaps(pause), 'e1', { inPoint: 0, outPoint: 8 })
    expect(clear.warnings).toEqual([])
    expect(clear.marks).toEqual([{ id: 'p1', kind: 'pause', name: 'Pause 1', start: 7, end: 7 }])
  })

  it('handles every remap kind in the union', () => {
    // One of each kind, typed so that a kind added to RemapSpec without a
    // case here fails to compile, as REMAP_NAMES does in the module.
    const oneOfEach: Record<RemapSpec['kind'], RemapEffect> = { speed, pause }
    const state = withRemaps(...Object.values(oneOfEach))
    const preview = trimEffectsPreview(state, 'e1', { inPoint: 0, outPoint: 1 })
    expect(preview.warnings.map(({ kind }) => kind).sort()).toEqual(Object.keys(oneOfEach).sort())
  })

  it('names effects as the row does, and lists several in strip order', () => {
    const second: RemapEffect = { id: 's2', entryId: 'e1', kind: 'speed', start: 8, end: 9, factor: 2 }
    const state: TimelineState = { ...withRemaps(speed, pause, second), zooms: [{ ...zoom, start: 0, hold: 0.5 }] }
    const preview = trimEffectsPreview(state, 'e1', { inPoint: 0, outPoint: 4 })
    expect(trimWarningText(preview.warnings)).toBe(
      'Trimming here shortens Speed segment 1, moves Pause 1 to the new end and removes Speed segment 2.',
    )
  })
})

describe('trimEffectsPreview: transition spans (#709)', () => {
  const crossfade = (duration: number) => ({ beforeId: 'e1', afterId: 'e2', type: 'crossfade' as const, duration })
  const pair = (overrides: Partial<TimelineState> = {}): TimelineState => ({
    entries: [entry({ id: 'e1' }), entry({ id: 'e2', inPoint: 2, outPoint: 9 })],
    transitions: [crossfade(1)],
    ...overrides,
  })

  it('shades the last transition-length of the outgoing entry, at the clamps', () => {
    expect(trimEffectsPreview(pair(), 'e1', { inPoint: 0, outPoint: 8 }).transitions).toEqual([
      { edge: 'end', start: 7, end: 8 },
    ])
  })

  it('shades the first transition-length of the incoming entry, at the clamps', () => {
    expect(trimEffectsPreview(pair(), 'e2', { inPoint: 3, outPoint: 9 }).transitions).toEqual([
      { edge: 'start', start: 3, end: 4 },
    ])
  })

  it('maps the span through a speed segment: 1 s of output at 2× is 2 s of source', () => {
    const fast: RemapEffect = { id: 's1', entryId: 'e1', kind: 'speed', start: 6, end: 8, factor: 2 }
    expect(
      trimEffectsPreview(pair({ remaps: [fast] }), 'e1', { inPoint: 0, outPoint: 8 }).transitions,
    ).toEqual([{ edge: 'end', start: 6, end: 8 }])
  })

  it('follows the reducer when a short trim shortens the transition itself', () => {
    // 0.4 s kept leaves the crossfade 0.4 s, all of it shaded.
    expect(trimEffectsPreview(pair(), 'e1', { inPoint: 0, outPoint: 0.4 }).transitions).toEqual([
      { edge: 'end', start: 0, end: 0.4 },
    ])
  })

  it('shades nothing without a transition', () => {
    expect(trimEffectsPreview(pair({ transitions: [] }), 'e1', { inPoint: 0, outPoint: 8 }).transitions).toEqual([])
  })
})
