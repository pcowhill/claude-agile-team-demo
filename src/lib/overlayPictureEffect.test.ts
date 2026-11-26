import { describe, expect, it } from 'vitest'
import type { TimelineState } from './timeline'
import { everyPictureEffectOf, normalizedTimelineState, timelineReducer, videoOverlaysOf } from './timeline'
import { emptyTimelineHistory, timelineHistoryReducer } from './history'
import type { OverlayRemap, VideoOverlay } from './videoOverlay'
import { overlayOutputDuration } from './videoOverlay'
import type { OverlayPictureEffect } from './pictureEffect'
import { splitOverlayPictureEffectsAt, withOverlayPictureEffectsClamped } from './overlayPictureEffect'

// Picture effects on overlays (#872, step 1): the model only. A window is
// seconds since the overlay appears (its on-screen time), as a Move's is.

const overlay = (fields: Partial<VideoOverlay> = {}): VideoOverlay => ({
  id: 'pip',
  clipId: 'clip-pip',
  name: 'pip.mp4',
  duration: 40,
  url: 'blob:pip',
  offset: 2,
  inPoint: 1,
  outPoint: 11,
  x: 0.1,
  y: 0.1,
  width: 0.2,
  height: 0.2,
  ...fields,
})

const image = (fields: Partial<VideoOverlay> = {}): VideoOverlay => ({
  id: 'logo',
  kind: 'image',
  clipId: 'clip-logo',
  name: 'logo.png',
  duration: 6,
  url: 'blob:logo',
  offset: 1,
  inPoint: 0,
  outPoint: 6,
  x: 0,
  y: 0,
  width: 0.25,
  height: 0.25,
  ...fields,
})

const effect = (id: string, start: number, end: number, type = 'blur', params: Record<string, number> = { amount: 40 }): OverlayPictureEffect => ({
  id,
  type,
  start,
  end,
  params,
})

const stateWith = (...overlays: VideoOverlay[]): TimelineState => ({
  entries: [{ id: 'a', clipId: 'clip-a', name: 'a.mp4', duration: 30, url: 'blob:a', inPoint: 0, outPoint: 30 }],
  videoOverlays: overlays,
})

/** The overlay with the reducer's invariants applied: normalized. */
const normalized = (o: VideoOverlay): VideoOverlay =>
  videoOverlaysOf(normalizedTimelineState(stateWith(o).entries, [], [], [], [], [], [o]))[0]

const add = (state: TimelineState, overlayId: string, e: OverlayPictureEffect) =>
  timelineReducer(state, { type: 'video-overlay-picture-effect-added', overlayId, effect: e })

/** A speed segment at 2× over source 0..4 of the trim: those 4 s show for 2. */
const doubleSpeed: OverlayRemap = { id: 'r', kind: 'speed', start: 0, end: 4, factor: 2 }

describe('overlay picture-effect normalization (#872)', () => {
  it('clamps each window into the on-screen window and sorts by start, ties in stored order', () => {
    // On screen for 10 s (trim 1..11).
    const o = overlay({ pictureEffects: [effect('late', 8, 15), effect('v', 2, 5, 'vignette'), effect('b', 2, 3), effect('gone', 12, 14)] })
    expect(withOverlayPictureEffectsClamped(o).pictureEffects).toEqual([
      effect('v', 2, 5, 'vignette'),
      effect('b', 2, 3),
      effect('late', 8, 10),
      // A window past the end collapses against it rather than being dropped, as an entry's does.
      effect('gone', 10, 10),
    ])
  })

  it('clamps against the remapped on-screen length, not the trim', () => {
    // The 2× segment makes the 10 s trim show for 8 s.
    const o = overlay({ remaps: [doubleSpeed], pictureEffects: [effect('e', 6, 10)] })
    expect(overlayOutputDuration(o)).toBe(8)
    expect(withOverlayPictureEffectsClamped(o).pictureEffects).toEqual([effect('e', 6, 8)])
  })

  it('keeps the same object when nothing changes, and drops an empty list\'s key', () => {
    const o = overlay({ pictureEffects: [effect('e', 1, 2)] })
    expect(withOverlayPictureEffectsClamped(o)).toBe(o)
    const none = overlay()
    expect(withOverlayPictureEffectsClamped(none)).toBe(none)
    expect('pictureEffects' in withOverlayPictureEffectsClamped(overlay({ pictureEffects: [] }))).toBe(false)
  })

  it('re-clamps on a retrim, through the timeline normalization', () => {
    let state = add(stateWith(overlay()), 'pip', effect('e', 6, 9))
    state = timelineReducer(state, {
      type: 'video-overlay-updated',
      id: 'pip',
      placement: { offset: 2, inPoint: 1, outPoint: 8, x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
    })
    expect(videoOverlaysOf(state)[0].pictureEffects).toEqual([effect('e', 6, 7)])
  })
})

describe('splitOverlayPictureEffectsAt (#872)', () => {
  const effects = [effect('before', 0, 2), effect('edge', 1, 3), effect('across', 2, 5), effect('on', 3, 4), effect('after', 4, 6)]

  it('keeps a window ending on the instant whole before it, moves one starting on it, and divides one across it', () => {
    const { before, after } = splitOverlayPictureEffectsAt(effects, 3)
    expect(before).toEqual([effect('before', 0, 2), effect('edge', 1, 3), effect('across', 2, 3)])
    expect(after).toEqual([effect('across', 0, 2), effect('on', 0, 1), effect('after', 1, 3)])
  })

  it('keeps the type and parameters on both halves', () => {
    const vignette = effect('v', 1, 4, 'vignette', { strength: 60 })
    const { before, after } = splitOverlayPictureEffectsAt([vignette], 2.5)
    expect(before).toEqual([{ ...vignette, end: 2.5 }])
    expect(after).toEqual([{ ...vignette, start: 0, end: 1.5 }])
  })

  it('has nothing to divide on an overlay with no effects', () => {
    expect(splitOverlayPictureEffectsAt(undefined, 2)).toEqual({ before: [], after: [] })
  })
})

describe('overlay picture-effect actions (#872)', () => {
  it('adds an effect to a video overlay and to an image overlay', () => {
    let state = stateWith(overlay(), image())
    state = add(state, 'pip', effect('e', 1, 3))
    state = add(state, 'logo', effect('e', 2, 4, 'vignette'))
    expect(videoOverlaysOf(state)[0].pictureEffects).toEqual([effect('e', 1, 3)])
    expect(videoOverlaysOf(state)[1].pictureEffects).toEqual([effect('e', 2, 4, 'vignette')])
    // The entry's own list is untouched: an overlay's effects live on the overlay.
    expect(state.pictureEffects).toBeUndefined()
    expect(everyPictureEffectOf(state).map(({ type }) => type)).toEqual(['blur', 'vignette'])
  })

  it('lets windows overlap, as an entry\'s do', () => {
    let state = add(stateWith(overlay()), 'pip', effect('b', 1, 5))
    state = add(state, 'pip', effect('v', 2, 4, 'vignette'))
    expect(videoOverlaysOf(state)[0].pictureEffects?.map(({ id }) => id)).toEqual(['b', 'v'])
  })

  it('vetoes an unknown overlay, a taken id, an empty type, an invalid window, and a window with no room', () => {
    const state = add(stateWith(overlay()), 'pip', effect('e', 1, 3))
    expect(add(state, 'nowhere', effect('f', 1, 3))).toBe(state)
    expect(add(state, 'pip', effect('e', 4, 5))).toBe(state)
    expect(add(state, 'pip', effect('', 4, 5))).toBe(state)
    expect(add(state, 'pip', effect('f', 4, 5, ''))).toBe(state)
    expect(add(state, 'pip', effect('f', 5, 4))).toBe(state)
    expect(add(state, 'pip', effect('f', Number.NaN, 4))).toBe(state)
    expect(add(state, 'pip', effect('f', 1, 2, 'blur', { amount: Number.POSITIVE_INFINITY }))).toBe(state)
    // On screen for 10 s: a window from 10 s clamps to nothing.
    expect(add(state, 'pip', effect('f', 10, 12))).toBe(state)
  })

  it('updates the window and parameters, keeping the id and type, and an update that clamps back is a no-op', () => {
    let state = add(stateWith(overlay()), 'pip', effect('e', 1, 3))
    state = timelineReducer(state, {
      type: 'video-overlay-picture-effect-updated',
      overlayId: 'pip',
      id: 'e',
      effect: { start: 4, end: 12, params: { amount: 70 } },
    })
    expect(videoOverlaysOf(state)[0].pictureEffects).toEqual([effect('e', 4, 10, 'blur', { amount: 70 })])
    const same = timelineReducer(state, {
      type: 'video-overlay-picture-effect-updated',
      overlayId: 'pip',
      id: 'e',
      effect: { start: 4, end: 20, params: { amount: 70 } },
    })
    expect(same).toBe(state)
    for (const overlayId of ['pip', 'nowhere']) {
      expect(
        timelineReducer(state, {
          type: 'video-overlay-picture-effect-updated',
          overlayId,
          id: overlayId === 'pip' ? 'missing' : 'e',
          effect: { start: 1, end: 2, params: {} },
        }),
      ).toBe(state)
    }
  })

  it('removes an effect, and the last one leaves no key', () => {
    let state = add(stateWith(overlay()), 'pip', effect('e', 1, 3))
    expect(timelineReducer(state, { type: 'video-overlay-picture-effect-removed', overlayId: 'pip', id: 'x' })).toBe(state)
    state = timelineReducer(state, { type: 'video-overlay-picture-effect-removed', overlayId: 'pip', id: 'e' })
    expect('pictureEffects' in videoOverlaysOf(state)[0]).toBe(false)
  })

  it('adding, editing and removing are one undo step each', () => {
    let history = timelineHistoryReducer(emptyTimelineHistory, { type: 'timeline-replaced', timeline: stateWith(overlay()) })
    const before = history.present
    history = timelineHistoryReducer(history, { type: 'video-overlay-picture-effect-added', overlayId: 'pip', effect: effect('e', 1, 3) })
    const added = history.present
    history = timelineHistoryReducer(history, {
      type: 'video-overlay-picture-effect-updated',
      overlayId: 'pip',
      id: 'e',
      effect: { start: 2, end: 3, params: { amount: 40 } },
    })
    const edited = history.present
    history = timelineHistoryReducer(history, { type: 'video-overlay-picture-effect-removed', overlayId: 'pip', id: 'e' })
    history = timelineHistoryReducer(history, { type: 'edit-undone' })
    expect(history.present).toBe(edited)
    history = timelineHistoryReducer(history, { type: 'edit-undone' })
    expect(history.present).toBe(added)
    history = timelineHistoryReducer(history, { type: 'edit-undone' })
    expect(history.present).toBe(before)
  })

  it('a duplicate carries the effects, and removing the overlay removes them', () => {
    let state = add(stateWith(overlay()), 'pip', effect('e', 1, 3))
    state = timelineReducer(state, { type: 'element-duplicated', kind: 'video-overlay', id: 'pip', newId: 'copy' })
    expect(videoOverlaysOf(state).map((o) => o.pictureEffects)).toEqual([[effect('e', 1, 3)], [effect('e', 1, 3)]])
    state = timelineReducer(state, { type: 'video-overlay-removed', id: 'copy' })
    state = timelineReducer(state, { type: 'video-overlay-removed', id: 'pip' })
    expect(everyPictureEffectOf(state)).toEqual([])
  })
})

describe('overlay picture effects are divided where an overlay is rebuilt as parts (#872)', () => {
  // On screen 2 → 12 s (offset 2, trim 1..11): a blur at on-screen 1..3, a
  // vignette across 4..7, and a blur at 8..9.
  const effects = [effect('b1', 1, 3), effect('v', 4, 7, 'vignette', { strength: 60 }), effect('b2', 8, 9)]

  it('Split… divides them where the first part ends on screen, an effect across it becoming one in each part', () => {
    const o = normalized(overlay({ pictureEffects: effects }))
    const [first, second] = videoOverlaysOf(
      timelineReducer(stateWith(o), { type: 'element-split', kind: 'video-overlay', id: 'pip', atSourceTime: 6, newId: 'second' }),
    )
    // Source 6 is on-screen 5: the vignette is cut there.
    expect(first.pictureEffects).toEqual([effects[0], { ...effects[1], end: 5 }])
    expect(second.pictureEffects).toEqual([{ ...effects[1], start: 0, end: 2 }, { ...effects[2], start: 3, end: 4 }])
    // Each part shows each effect at the same sequence instants as before.
    expect(second.offset).toBe(o.offset + 5)
  })

  it('Split… on a sped-up overlay divides at the on-screen instant, not the source one', () => {
    // The 2× segment shows source 0..4 of the trim in 2 s: the split at
    // source 5 (trim 4) is on-screen 2, and the overlay shows for 8 s.
    const o = normalized(overlay({ remaps: [doubleSpeed], pictureEffects: [effect('e', 1, 6)] }))
    const [first, second] = videoOverlaysOf(
      timelineReducer(stateWith(o), { type: 'element-split', kind: 'video-overlay', id: 'pip', atSourceTime: 5, newId: 'second' }),
    )
    expect(overlayOutputDuration(first)).toBe(2)
    expect(first.pictureEffects).toEqual([effect('e', 1, 2)])
    expect(second.offset).toBe(4)
    expect(second.pictureEffects).toEqual([effect('e', 0, 4)])
  })

  it('Cut… keeps the head\'s before Cut from and the tail\'s after Cut to, and drops one wholly inside the cut', () => {
    const o = normalized(overlay({ pictureEffects: [...effects, effect('inside', 4.5, 5)] }))
    // Cut source 5..8.5: on-screen 4..7.5, so 3.5 s go; the tail starts at sequence 6.
    const [head, tail] = videoOverlaysOf(
      timelineReducer(stateWith(o), { type: 'element-cut', kind: 'video-overlay', id: 'pip', from: 5, to: 8.5, newId: 'tail' }),
    )
    // The vignette starts on Cut from's instant, so the head keeps none of it.
    expect(head.pictureEffects).toEqual([effects[0]])
    expect(tail.offset).toBe(6)
    // The tail starts at on-screen 7.5 of the original: b2 at 8..9 is 0.5..1.5.
    expect(tail.pictureEffects).toEqual([{ ...effects[2], start: 0.5, end: 1.5 }])
  })

  it('Cut… across an effect keeps a part of it on each side', () => {
    const o = normalized(overlay({ pictureEffects: [effect('e', 2, 8)] }))
    // Cut source 4..6: on-screen 3..5.
    const [head, tail] = videoOverlaysOf(
      timelineReducer(stateWith(o), { type: 'element-cut', kind: 'video-overlay', id: 'pip', from: 4, to: 6, newId: 'tail' }),
    )
    expect(head.pictureEffects).toEqual([effect('e', 2, 3)])
    expect(tail.pictureEffects).toEqual([effect('e', 0, 3)])
  })

  it('the ripple keeps a later effect with the picture when Cut out marked range takes the overlay\'s head', () => {
    const o = normalized(overlay({ pictureEffects: effects }))
    // Cut 0..4 of the sequence: the overlay (on screen from 2) loses its first 2 s and starts at 0.
    const [shortened] = videoOverlaysOf(timelineReducer(stateWith(o), { type: 'range-cut', from: 0, to: 4, newEntryIds: ['x', 'y'] }))
    expect(shortened.offset).toBe(0)
    expect(shortened.pictureEffects).toEqual([
      { ...effects[0], start: 0, end: 1 },
      { ...effects[1], start: 2, end: 5 },
      { ...effects[2], start: 6, end: 7 },
    ])
  })

  it('the ripple keeps the effects before the new end when the overlay loses its tail', () => {
    const o = normalized(overlay({ pictureEffects: effects }))
    // Cut 7.5..20: the overlay (2..12) keeps on-screen 0..5.5.
    const [shortened] = videoOverlaysOf(timelineReducer(stateWith(o), { type: 'range-cut', from: 7.5, to: 20, newEntryIds: ['x', 'y'] }))
    expect(shortened.pictureEffects).toEqual([effects[0], { ...effects[1], end: 5.5 }])
  })

  it('the ripple divides an image overlay\'s effects at a head cut, and a removed overlay takes them', () => {
    const logo = normalized(image({ pictureEffects: [effect('e', 1, 4)] }))
    // On screen 1..7; cut 0..3 of the sequence takes its first 2 s.
    const [shortened] = videoOverlaysOf(timelineReducer(stateWith(logo), { type: 'range-cut', from: 0, to: 3, newEntryIds: ['x', 'y'] }))
    expect(shortened).toMatchObject({ offset: 0, duration: 4 })
    expect(shortened.pictureEffects).toEqual([effect('e', 0, 2)])
    const gone = timelineReducer(stateWith(logo), { type: 'range-cut', from: 0, to: 8, newEntryIds: ['x', 'y'] })
    expect(everyPictureEffectOf(gone)).toEqual([])
  })
})
