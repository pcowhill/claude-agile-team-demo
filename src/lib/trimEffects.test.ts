import { describe, expect, it } from 'vitest'
import type { RemapEffect, RemapSpec } from './remap'
import type { AudioTrack, TimelineEntry, TimelineState, ZoomEffect } from './timeline'
import {
  audioTracksOf,
  remapsForEntry,
  timelineReducer,
  videoOverlaysOf,
  zoomWindowDuration,
  zoomsForEntry,
} from './timeline'
import { audioTrackTrimEffectsPreview, overlayTrimEffectsPreview, trimEffectsPreview, trimWarningText } from './trimEffects'
import type { VideoOverlay } from './videoOverlay'
import { NO_PICTURE_LOOK, pictureEffectRegistry } from './pictureEffect'
import type { OverlayPictureEffect, PictureEffect, PictureEffectDefinition } from './pictureEffect'
import type { OverlayMove } from './overlayMove'
import { overlayPlacementOf } from './videoOverlay'
import { emptyTimelineHistory, timelineHistoryReducer } from './history'

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
    // Kept at length zero, so its row stays, but nothing of it plays.
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

/**
 * The overlay variant (#711): the same rule, through the overlay's own
 * action (`video-overlay-updated`, as Apply dispatches it) and its own
 * `zooms` and `remaps`. Each case checks the warning against what the
 * reducer then does, as the entry cases above do.
 */
describe('overlayTrimEffectsPreview: a video overlay’s own effects (#711)', () => {
  const overlay = (overrides: Partial<VideoOverlay> = {}): VideoOverlay => ({
    id: 'o1',
    clipId: 'clip-o',
    name: 'pip.webm',
    duration: 10,
    url: 'blob:clip-o',
    offset: 2,
    inPoint: 0,
    outPoint: 10,
    x: 0.6,
    y: 0.6,
    width: 0.3,
    height: 0.3,
    ...overrides,
  })
  const overlayZoom = { id: 'oz1', start: 4, rampIn: 1, hold: 2, rampOut: 1, scale: 2, centerX: 0.5, centerY: 0.5 }
  const withOverlay = (overrides: Partial<VideoOverlay> = {}): TimelineState => ({
    entries: [entry({ id: 'e1' })],
    videoOverlays: [overlay(overrides)],
  })
  /** What Apply does: the overlay's placement with the new In and Out. */
  const appliedOverlay = (state: TimelineState, inPoint: number, outPoint: number) => {
    const stored = videoOverlaysOf(state)[0]
    const next = timelineReducer(state, {
      type: 'video-overlay-updated',
      id: stored.id,
      placement: { ...overlayPlacementOf(stored), inPoint, outPoint },
    })
    return videoOverlaysOf(next)[0]
  }

  it('a zoom: "shortens" with Out inside it, "removes" with Out before it, and the reducer agrees', () => {
    const state = withOverlay({ zooms: [overlayZoom] })
    const shortened = overlayTrimEffectsPreview(state, 'o1', { inPoint: 0, outPoint: 7 })
    expect(shortened.warnings).toEqual([{ id: 'oz1', kind: 'zoom', name: 'Zoom 1', outcome: 'shortens' }])
    expect(shortened.marks).toEqual([{ id: 'oz1', kind: 'zoom', name: 'Zoom 1', start: 4, end: 7 }])
    expect(zoomWindowDuration(appliedOverlay(state, 0, 7).zooms![0])).toBe(3)

    const removed = overlayTrimEffectsPreview(state, 'o1', { inPoint: 0, outPoint: 3.5 })
    expect(removed.warnings).toEqual([{ id: 'oz1', kind: 'zoom', name: 'Zoom 1', outcome: 'removes' }])
    expect(removed.marks).toEqual([])
    expect(zoomWindowDuration(appliedOverlay(state, 0, 3.5).zooms![0])).toBe(0)
  })

  it('moves the marks with In: a zoom 4 s into the trim sits at source 6 with In at 2', () => {
    const preview = overlayTrimEffectsPreview(withOverlay({ zooms: [overlayZoom] }), 'o1', {
      inPoint: 2,
      outPoint: 10,
    })
    // The trim is 8 s long now, so the zoom's 4 → 8 s window still fits.
    expect(preview.warnings).toEqual([])
    expect(preview.marks).toEqual([{ id: 'oz1', kind: 'zoom', name: 'Zoom 1', start: 6, end: 10 }])
  })

  it('a speed segment and a pause, named as the row names them; a pause moves to the new end', () => {
    const state = withOverlay({
      remaps: [
        { id: 'os1', kind: 'speed', start: 2, end: 6, factor: 0.5 },
        { id: 'op1', kind: 'pause', at: 7, hold: 1 },
      ],
    })
    const preview = overlayTrimEffectsPreview(state, 'o1', { inPoint: 0, outPoint: 5 })
    expect(preview.warnings).toEqual([
      { id: 'os1', kind: 'speed', name: 'Speed segment 1', outcome: 'shortens' },
      { id: 'op1', kind: 'pause', name: 'Pause 1', outcome: 'moves' },
    ])
    expect(trimWarningText(preview.warnings)).toBe(
      'Trimming here shortens Speed segment 1 and moves Pause 1 to the new end.',
    )
    // The reducer agrees: the segment ends at 5, and the pause sits there.
    const after = appliedOverlay(state, 0, 5).remaps!
    expect(after.find((remap) => remap.id === 'os1')).toMatchObject({ start: 2, end: 5 })
    expect(after.find((remap) => remap.id === 'op1')).toMatchObject({ at: 5 })
  })

  it('has no transition spans, and shows nothing for an image overlay, an unknown id, or a refused trim', () => {
    const state = withOverlay({ zooms: [overlayZoom] })
    expect(overlayTrimEffectsPreview(state, 'o1', { inPoint: 0, outPoint: 7 }).transitions).toEqual([])
    const image: TimelineState = {
      entries: [entry({ id: 'e1' })],
      videoOverlays: [overlay({ kind: 'image', zooms: [overlayZoom] })],
    }
    expect(overlayTrimEffectsPreview(image, 'o1', { inPoint: 0, outPoint: 7 })).toEqual({
      marks: [],
      warnings: [],
      transitions: [],
    })
    expect(overlayTrimEffectsPreview(state, 'nope', { inPoint: 0, outPoint: 7 }).marks).toEqual([])
    // In past Out: the reducer refuses it, so nothing is shown.
    expect(overlayTrimEffectsPreview(state, 'o1', { inPoint: 8, outPoint: 3 })).toEqual({
      marks: [],
      warnings: [],
      transitions: [],
    })
  })

  describe('its Moves and picture effects, in on-screen time (#1008)', () => {
    const vignette: PictureEffectDefinition = {
      id: 'vignette',
      name: 'Vignette',
      params: [{ key: 'strength', label: 'Strength', min: 0, max: 100, default: 60 }],
      look: () => NO_PICTURE_LOOK,
    }
    const look = (id: string, start: number, end: number): OverlayPictureEffect => ({
      id,
      type: 'vignette',
      start,
      end,
      params: { strength: 60 },
    })
    const move = (id: string, start: number, glide: number): OverlayMove => ({
      id,
      start,
      glide,
      x: 0.1,
      y: 0.1,
      width: 0.3,
      height: 0.3,
    })

    it('a picture effect: "shortens" and "removes" by the row\'s name, with no mark, and the reducer agrees', () => {
      pictureEffectRegistry.register(vignette)
      try {
        const state = withOverlay({ pictureEffects: [look('v1', 2, 6), look('v2', 7, 9)] })
        const preview = overlayTrimEffectsPreview(state, 'o1', { inPoint: 0, outPoint: 5 })
        expect(preview.warnings).toEqual([
          { id: 'v1', kind: 'picture-effect', name: 'Vignette 1', outcome: 'shortens' },
          { id: 'v2', kind: 'picture-effect', name: 'Vignette 2', outcome: 'removes' },
        ])
        expect(trimWarningText(preview.warnings)).toBe('Trimming here shortens Vignette 1 and removes Vignette 2.')
        // On-screen windows are not drawn on the source strip.
        expect(preview.marks).toEqual([])
        expect(appliedOverlay(state, 0, 5).pictureEffects?.map(({ id, start, end }) => [id, start, end])).toEqual([
          ['v1', 2, 5],
          ['v2', 5, 5],
        ])
        // Moving In shortens the time on screen too: 7 s left, so only v2 is cut.
        const fromIn = overlayTrimEffectsPreview(state, 'o1', { inPoint: 3, outPoint: 10 })
        expect(trimWarningText(fromIn.warnings)).toBe('Trimming here removes Vignette 2.')
        expect(overlayTrimEffectsPreview(state, 'o1', { inPoint: 0, outPoint: 9.5 }).warnings).toEqual([])
      } finally {
        pictureEffectRegistry.unregister('vignette')
      }
    })

    it('a picture effect is measured on screen: through a 2× speed segment, Out at 8 leaves 6 s on screen', () => {
      // Source 0 → 4 at 2× plays in 2 s, so the whole overlay is 8 s on
      // screen and Out at 8 leaves 2 + 4 = 6. Read in source seconds, the
      // effect's 5 → 7 window would still fit before 8.
      const state = withOverlay({
        remaps: [{ id: 'os1', kind: 'speed', start: 0, end: 4, factor: 2 }],
        pictureEffects: [look('v1', 5, 7)],
      })
      const preview = overlayTrimEffectsPreview(state, 'o1', { inPoint: 0, outPoint: 8 })
      expect(preview.warnings).toEqual([
        { id: 'v1', kind: 'picture-effect', name: 'vignette 1 (unavailable)', outcome: 'shortens' },
      ])
      expect(appliedOverlay(state, 0, 8).pictureEffects?.map(({ start, end }) => [start, end])).toEqual([[5, 6]])
    })

    it('a Move: "shortens" when Out cuts its glide, "removes" when it starts at or past the new end', () => {
      const state = withOverlay({ moves: [move('m1', 1, 2), move('m2', 6, 1)] })
      const cutsSecond = overlayTrimEffectsPreview(state, 'o1', { inPoint: 0, outPoint: 5 })
      expect(cutsSecond.warnings).toEqual([{ id: 'm2', kind: 'move', name: 'Move 2', outcome: 'removes' }])
      expect(cutsSecond.marks).toEqual([])

      const cutsBoth = overlayTrimEffectsPreview(state, 'o1', { inPoint: 0, outPoint: 2 })
      expect(trimWarningText(cutsBoth.warnings)).toBe('Trimming here shortens Move 1 and removes Move 2.')
      // The reducer agrees: Move 1 glides 1 s and ends with the overlay; Move 2 sits on the end.
      expect(appliedOverlay(state, 0, 2).moves?.map(({ id, start, glide }) => [id, start, glide])).toEqual([
        ['m1', 1, 1],
        ['m2', 2, 0],
      ])
      expect(overlayTrimEffectsPreview(state, 'o1', { inPoint: 0, outPoint: 7 }).warnings).toEqual([])
    })

    it('a jump (no glide) is removed once the new end reaches its start; one already on the end is not warned of', () => {
      const jump = withOverlay({ moves: [move('m1', 3, 0)] })
      expect(overlayTrimEffectsPreview(jump, 'o1', { inPoint: 0, outPoint: 3.5 }).warnings).toEqual([])
      expect(overlayTrimEffectsPreview(jump, 'o1', { inPoint: 0, outPoint: 3 }).warnings).toEqual([
        { id: 'm1', kind: 'move', name: 'Move 1', outcome: 'removes' },
      ])
      const onTheEnd = withOverlay({ moves: [move('m1', 10, 0)] })
      expect(overlayTrimEffectsPreview(onTheEnd, 'o1', { inPoint: 0, outPoint: 8 }).warnings).toEqual([])
    })

    it('lists the zooms, speed segments and pauses first, then the on-screen windows in on-screen order', () => {
      const state = withOverlay({
        zooms: [overlayZoom],
        moves: [move('m1', 4.5, 1)],
        pictureEffects: [look('v1', 3, 4)],
      })
      const preview = overlayTrimEffectsPreview(state, 'o1', { inPoint: 0, outPoint: 3.5 })
      expect(trimWarningText(preview.warnings)).toBe(
        'Trimming here removes Zoom 1, shortens vignette 1 (unavailable) and removes Move 1.',
      )
    })
  })

  it('at the current trim: the marks as they stand, and no warning', () => {
    const preview = overlayTrimEffectsPreview(withOverlay({ zooms: [overlayZoom] }), 'o1', {
      inPoint: 0,
      outPoint: 10,
    })
    expect(preview.warnings).toEqual([])
    expect(preview.marks).toEqual([{ id: 'oz1', kind: 'zoom', name: 'Zoom 1', start: 4, end: 8 }])
  })
})

describe('trimEffectsPreview: picture effects (#862)', () => {
  const vignette: PictureEffectDefinition = {
    id: 'vignette',
    name: 'Vignette',
    params: [{ key: 'strength', label: 'Strength', min: 0, max: 100, default: 60 }],
    look: () => NO_PICTURE_LOOK,
  }
  const withEffects = (...effects: PictureEffect[]): TimelineState => ({
    entries: [entry({ id: 'e1' })],
    pictureEffects: effects,
  })
  const effect = (id: string, start: number, end: number, type = 'vignette'): PictureEffect => ({
    id,
    entryId: 'e1',
    type,
    start,
    end,
    params: { strength: 60 },
  })

  it('warns that a trim shortens or removes an effect, by the row\'s name, and marks where it stays', () => {
    pictureEffectRegistry.register(vignette)
    try {
      const state = withEffects(effect('v1', 2, 6), effect('v2', 7, 9))
      const preview = trimEffectsPreview(state, 'e1', { inPoint: 0, outPoint: 5 })
      expect(trimWarningText(preview.warnings)).toBe('Trimming here shortens Vignette 1 and removes Vignette 2.')
      expect(preview.marks).toEqual([{ id: 'v1', kind: 'picture-effect', name: 'Vignette 1', start: 2, end: 5 }])
      // Apply does what the warning says: the reducer's own clamp.
      expect(applied(state, 0, 5).pictureEffects?.map(({ id, start, end }) => [id, start, end])).toEqual([
        ['v1', 2, 5],
        ['v2', 5, 5],
      ])
      const clear = trimEffectsPreview(state, 'e1', { inPoint: 0, outPoint: 9.5 })
      expect(clear.warnings).toEqual([])
    } finally {
      pictureEffectRegistry.unregister('vignette')
    }
  })

  it('names an effect whose plugin is disabled as the row does, "(unavailable)"', () => {
    const preview = trimEffectsPreview(withEffects(effect('b1', 1, 4, 'blur')), 'e1', { inPoint: 0, outPoint: 3 })
    expect(trimWarningText(preview.warnings)).toBe('Trimming here shortens blur 1 (unavailable).')
  })
})

/**
 * What *removes* leaves behind (#1013): the effect is kept at length zero
 * where the trim ended, and moving the trim back out does not lengthen it
 * again. The guide and the module comment say so; Undo is what restores it.
 */
describe('a removed effect stays at length zero when the trim moves back out; Undo restores it (#1013)', () => {
  const vignette: PictureEffect = { id: 'v1', entryId: 'e1', type: 'vignette', start: 7, end: 9, params: { strength: 60 } }
  const late: TimelineState = {
    entries: [entry({ id: 'e1' })],
    zooms: [{ ...zoom, start: 7, rampIn: 1, hold: 0.5, rampOut: 0.5 }],
    remaps: [{ id: 's1', entryId: 'e1', kind: 'speed', start: 7, end: 9, factor: 2 }],
    pictureEffects: [vignette],
  }

  it('an entry\'s zoom, speed segment and picture effect, trimmed to Out 5 and back to 10', () => {
    expect(trimWarningText(trimEffectsPreview(late, 'e1', { inPoint: 0, outPoint: 5 }).warnings)).toBe(
      'Trimming here removes Zoom 1, removes Speed segment 1 and removes vignette 1 (unavailable).',
    )
    const back = applied(applied(late, 0, 5), 0, 10)
    expect(back.entries[0]).toMatchObject({ inPoint: 0, outPoint: 10 })
    const zoomBack = zoomsForEntry(back, 'e1')[0]
    expect(zoomBack.start).toBe(5)
    expect(zoomWindowDuration(zoomBack)).toBe(0)
    expect(remapsForEntry(back, 'e1')[0]).toMatchObject({ start: 5, end: 5 })
    expect(back.pictureEffects?.[0]).toMatchObject({ start: 5, end: 5 })
    // The trim back out warns of nothing: there is nothing left to cut.
    expect(trimEffectsPreview(applied(late, 0, 5), 'e1', { inPoint: 0, outPoint: 10 }).warnings).toEqual([])
  })

  it('an effect already at length zero is not warned of when a later trim\'s end passes it (#1031)', () => {
    // Out 5 collapsed all three to length zero at 5 s. Out 3 pulls them
    // back to 3 s, which plays nothing more than before: no "moves".
    const collapsed = applied(late, 0, 5)
    const kinds = (state: TimelineState) => trimEffectsPreview(state, 'e1', { inPoint: 0, outPoint: 3 })
    const zoomOnly: TimelineState = { entries: collapsed.entries, zooms: collapsed.zooms }
    const speedOnly: TimelineState = { entries: collapsed.entries, remaps: collapsed.remaps }
    const pictureOnly: TimelineState = { entries: collapsed.entries, pictureEffects: collapsed.pictureEffects }
    expect(zoomWindowDuration(zoomsForEntry(zoomOnly, 'e1')[0])).toBe(0)
    expect(kinds(zoomOnly).warnings).toEqual([])
    expect(remapsForEntry(speedOnly, 'e1')[0]).toMatchObject({ start: 5, end: 5 })
    expect(kinds(speedOnly).warnings).toEqual([])
    expect(pictureOnly.pictureEffects?.[0]).toMatchObject({ start: 5, end: 5 })
    expect(kinds(pictureOnly).warnings).toEqual([])
    // Nor drawn, as before.
    expect(kinds(collapsed).marks).toEqual([])
  })

  it('an overlay\'s Move, trimmed to Out 5 and back to 10', () => {
    const withMove: TimelineState = {
      entries: [entry({ id: 'e1' })],
      videoOverlays: [
        {
          id: 'o1',
          clipId: 'clip-o',
          name: 'pip.webm',
          duration: 10,
          url: 'blob:clip-o',
          offset: 0,
          inPoint: 0,
          outPoint: 10,
          x: 0.6,
          y: 0.6,
          width: 0.3,
          height: 0.3,
          moves: [{ id: 'm1', start: 6, glide: 1, x: 0.1, y: 0.1, width: 0.3, height: 0.3 }],
        },
      ],
    }
    const retrim = (state: TimelineState, outPoint: number) => {
      const stored = videoOverlaysOf(state)[0]
      return timelineReducer(state, {
        type: 'video-overlay-updated',
        id: stored.id,
        placement: { ...overlayPlacementOf(stored), inPoint: 0, outPoint },
      })
    }
    const back = retrim(retrim(withMove, 5), 10)
    expect(videoOverlaysOf(back)[0].moves).toEqual([expect.objectContaining({ id: 'm1', start: 5, glide: 0 })])
  })

  it('Undo of the trim restores every window as it was', () => {
    const before = { ...emptyTimelineHistory, present: late }
    const trimmed = timelineHistoryReducer(before, { type: 'entry-trimmed', id: 'e1', inPoint: 0, outPoint: 5 })
    expect(remapsForEntry(trimmed.present, 'e1')[0]).toMatchObject({ start: 5, end: 5 })
    const undone = timelineHistoryReducer(trimmed, { type: 'edit-undone' })
    expect(undone.present).toBe(late)
  })
})

describe('audioTrackTrimEffectsPreview: an audio track’s volume changes (#1025)', () => {
  // A 10 s track at sequence 1, untrimmed, with Volume change 1 at 2 to 4 s
  // into it and Volume change 2 at 6 to 8 s.
  const track: AudioTrack = {
    id: 't1',
    clipId: 'clip-m',
    name: 'music.wav',
    duration: 10,
    url: 'blob:clip-m',
    offset: 1,
    inPoint: 0,
    outPoint: 10,
    volumeChanges: [
      { id: 'v1', start: 2, length: 2, level: 0.5 },
      { id: 'v2', start: 6, length: 2, level: 0.2 },
    ],
  }
  const state: TimelineState = { entries: [], audioTracks: [track] }
  const preview = (inPoint: number, outPoint: number) =>
    audioTrackTrimEffectsPreview(state, 't1', { inPoint, outPoint })
  const marksOf = (inPoint: number, outPoint: number) =>
    preview(inPoint, outPoint).marks.map(({ kind, name, start, end }) => [kind, name, start, end])
  const trimmedTo = (inPoint: number, outPoint: number) =>
    audioTracksOf(timelineReducer(state, { type: 'audio-track-trimmed', id: 't1', inPoint, outPoint }))[0]

  it('marks each change on the strip in source seconds, and warns of nothing at the current trim', () => {
    expect(marksOf(0, 10)).toEqual([
      ['volume-change', 'Volume change 1', 2, 4],
      ['volume-change', 'Volume change 2', 6, 8],
    ])
    expect(preview(0, 10).warnings).toEqual([])
    expect(preview(0, 10).transitions).toEqual([])
  })

  it('names a change an Out inside it would shorten, and one it would pass would remove', () => {
    expect(trimWarningText(preview(0, 7).warnings)).toBe('Trimming here shortens Volume change 2.')
    expect(marksOf(0, 7)).toEqual([
      ['volume-change', 'Volume change 1', 2, 4],
      ['volume-change', 'Volume change 2', 6, 7],
    ])
    // Out at 5 is before Volume change 2 starts: it collapses to nothing, and
    // a collapsed change has no mark.
    expect(trimWarningText(preview(0, 5).warnings)).toBe('Trimming here removes Volume change 2.')
    expect(marksOf(0, 5)).toEqual([['volume-change', 'Volume change 1', 2, 4]])
    expect(trimWarningText(preview(0, 3).warnings)).toBe(
      'Trimming here shortens Volume change 1 and removes Volume change 2.',
    )
  })

  it('moves the changes with In, so moving In alone can cut into the last one', () => {
    // In at 3: the window is 7 s long. Volume change 1 keeps 2 to 4 s into
    // the trim, which is source 5 to 7, and Volume change 2 is cut to 6 to 7.
    expect(trimWarningText(preview(3, 10).warnings)).toBe('Trimming here shortens Volume change 2.')
    expect(marksOf(3, 10)).toEqual([
      ['volume-change', 'Volume change 1', 5, 7],
      ['volume-change', 'Volume change 2', 9, 10],
    ])
  })

  it('says what Apply then does', () => {
    expect(trimmedTo(3, 10).volumeChanges).toEqual([
      { id: 'v1', start: 2, length: 2, level: 0.5 },
      { id: 'v2', start: 6, length: 1, level: 0.2 },
    ])
    expect(trimmedTo(0, 5).volumeChanges).toEqual([
      { id: 'v1', start: 2, length: 2, level: 0.5 },
      { id: 'v2', start: 5, length: 0, level: 0.2 },
    ])
  })

  it('does not warn of a change already at length zero when the trim\'s end passes it (#1031)', () => {
    // Volume change 2 was removed by an earlier trim: length zero at 5 s.
    const collapsed: TimelineState = {
      entries: [],
      audioTracks: [
        {
          ...track,
          volumeChanges: [
            { id: 'v1', start: 2, length: 2, level: 0.5 },
            { id: 'v2', start: 5, length: 0, level: 0.2 },
          ],
        },
      ],
    }
    const warnings = audioTrackTrimEffectsPreview(collapsed, 't1', { inPoint: 0, outPoint: 3 }).warnings
    expect(trimWarningText(warnings)).toBe('Trimming here shortens Volume change 1.')
  })

  it('shows nothing for a refused trim or an unknown track, and nothing to warn of on a change-free track', () => {
    expect(preview(6, 6)).toEqual({ marks: [], warnings: [], transitions: [] })
    expect(audioTrackTrimEffectsPreview(state, 'nope', { inPoint: 0, outPoint: 5 })).toEqual({
      marks: [],
      warnings: [],
      transitions: [],
    })
    const plain: TimelineState = { entries: [], audioTracks: [{ ...track, volumeChanges: undefined }] }
    expect(audioTrackTrimEffectsPreview(plain, 't1', { inPoint: 0, outPoint: 3 })).toEqual({
      marks: [],
      warnings: [],
      transitions: [],
    })
  })
})

describe('trimEffectsPreview: a video entry’s volume changes (#1026)', () => {
  // The 10 s entry, untrimmed, with Zoom 1 at 4 to 8 s, Volume change 1 at
  // 1 to 3 s into it and Volume change 2 at 6 to 8 s.
  const changes = [
    { id: 'v1', start: 1, length: 2, level: 0.5 },
    { id: 'v2', start: 6, length: 2, level: 0.2 },
  ]
  const state: TimelineState = { entries: [entry({ id: 'e1', volumeChanges: changes })], zooms: [zoom] }
  const preview = (inPoint: number, outPoint: number) => trimEffectsPreview(state, 'e1', { inPoint, outPoint })
  const marksOf = (inPoint: number, outPoint: number) =>
    preview(inPoint, outPoint).marks.map(({ kind, name, start, end }) => [kind, name, start, end])

  it('marks each change on the strip in source seconds beside the zoom, and warns of nothing at the current trim', () => {
    expect(marksOf(0, 10)).toEqual([
      ['volume-change', 'Volume change 1', 1, 3],
      ['zoom', 'Zoom 1', 4, 8],
      ['volume-change', 'Volume change 2', 6, 8],
    ])
    expect(preview(0, 10).warnings).toEqual([])
  })

  it('names the changes and the zoom an Out would cut into, in strip order', () => {
    expect(trimWarningText(preview(0, 7).warnings)).toBe('Trimming here shortens Zoom 1 and shortens Volume change 2.')
    // Out at 5 is before Volume change 2 starts: it collapses, and has no mark.
    expect(trimWarningText(preview(0, 5).warnings)).toBe('Trimming here shortens Zoom 1 and removes Volume change 2.')
    expect(marksOf(0, 5)).toEqual([
      ['volume-change', 'Volume change 1', 1, 3],
      ['zoom', 'Zoom 1', 4, 5],
    ])
    expect(trimWarningText(preview(0, 2).warnings)).toBe(
      'Trimming here shortens Volume change 1, removes Zoom 1 and removes Volume change 2.',
    )
  })

  it('moves the changes with In, so moving In alone can cut into the last one', () => {
    // In at 3: 7 s are left. Volume change 1 keeps 1 to 3 s into the trim,
    // which is source 4 to 6, and Volume change 2 is cut to 6 to 7.
    const moved = preview(3, 10)
    expect(moved.warnings.filter(({ kind }) => kind === 'volume-change')).toEqual([
      { id: 'v2', kind: 'volume-change', name: 'Volume change 2', outcome: 'shortens' },
    ])
    expect(marksOf(3, 10).filter(([kind]) => kind === 'volume-change')).toEqual([
      ['volume-change', 'Volume change 1', 4, 6],
      ['volume-change', 'Volume change 2', 9, 10],
    ])
  })

  it('says what Apply then does', () => {
    expect(applied(state, 0, 5).entries[0].volumeChanges).toEqual([
      { id: 'v1', start: 1, length: 2, level: 0.5 },
      { id: 'v2', start: 5, length: 0, level: 0.2 },
    ])
    expect(applied(state, 3, 10).entries[0].volumeChanges).toEqual([
      { id: 'v1', start: 1, length: 2, level: 0.5 },
      { id: 'v2', start: 6, length: 1, level: 0.2 },
    ])
  })

  it('does not warn of a change already at length zero when the trim\'s end passes it (#1031)', () => {
    const collapsed: TimelineState = {
      entries: [
        entry({
          id: 'e1',
          volumeChanges: [
            { id: 'v1', start: 1, length: 2, level: 0.5 },
            { id: 'v2', start: 5, length: 0, level: 0.2 },
          ],
        }),
      ],
    }
    expect(trimWarningText(trimEffectsPreview(collapsed, 'e1', { inPoint: 0, outPoint: 2 }).warnings)).toBe(
      'Trimming here shortens Volume change 1.',
    )
  })

  it('leaves a change-free entry as it was: no volume-change marks or warnings', () => {
    expect(trimEffectsPreview(withZoom(), 'e1', { inPoint: 0, outPoint: 5 }).marks.map(({ kind }) => kind)).toEqual([
      'zoom',
    ])
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
