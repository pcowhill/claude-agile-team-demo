import { describe, expect, it } from 'vitest'
import type { TimelineState } from './timeline'
import { normalizedTimelineState, timelineReducer, videoOverlaysOf } from './timeline'
import { emptyTimelineHistory, timelineHistoryReducer } from './history'
import type { VideoOverlay } from './videoOverlay'
import type { OverlayMove } from './overlayMove'
import {
  DEFAULT_MOVE_GLIDE,
  defaultMoveFor,
  moveEase,
  overlayPlacedAt,
  overlayRectAt,
  splitMovesAt,
  sweptMoves,
} from './overlayMove'

// Overlay Moves (#834): an overlay glides to a new placement during the
// video and stays there. Times are seconds since the overlay appears.

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

/** A Move to the bottom-right quarter, gliding from `start` for `glide`. */
const move = (id: string, start: number, glide: number, rect = { x: 0.5, y: 0.5, width: 0.4, height: 0.4 }): OverlayMove => ({
  id,
  start,
  glide,
  ...rect,
})

const stateWith = (...overlays: VideoOverlay[]): TimelineState => ({
  entries: [{ id: 'a', clipId: 'clip-a', name: 'a.mp4', duration: 30, url: 'blob:a', inPoint: 0, outPoint: 30 }],
  videoOverlays: overlays,
})

/** The overlay with the reducer's invariants applied: normalized. */
const normalized = (o: VideoOverlay): VideoOverlay =>
  videoOverlaysOf(normalizedTimelineState(stateWith(o).entries, [], [], [], [], [], [o]))[0]

const add = (state: TimelineState, overlayId: string, m: OverlayMove) =>
  timelineReducer(state, { type: 'video-overlay-move-added', overlayId, move: m })

describe('overlayRectAt (#834)', () => {
  const o = overlay({
    moves: [move('m1', 2, 2), move('m2', 6, 1, { x: 0.0, y: 0.6, width: 0.3, height: 0.3 })],
  })

  it('is the overlay\'s own placement before the first Move', () => {
    expect(overlayRectAt(o, 0)).toEqual({ x: 0.1, y: 0.1, width: 0.2, height: 0.2 })
    expect(overlayRectAt(o, 1.999)).toEqual({ x: 0.1, y: 0.1, width: 0.2, height: 0.2 })
  })

  it('starts the glide from the placement at the Move\'s start', () => {
    expect(overlayRectAt(o, 2)).toEqual({ x: 0.1, y: 0.1, width: 0.2, height: 0.2 })
  })

  it('is exactly halfway between the two rectangles at the glide\'s midpoint', () => {
    // From (0.1, 0.1, 0.2, 0.2) to (0.5, 0.5, 0.4, 0.4): halfway is (0.3, 0.3, 0.3, 0.3).
    const mid = overlayRectAt(o, 3)
    expect(mid.x).toBeCloseTo(0.3, 12)
    expect(mid.y).toBeCloseTo(0.3, 12)
    expect(mid.width).toBeCloseTo(0.3, 12)
    expect(mid.height).toBeCloseTo(0.3, 12)
  })

  it('eases in and out: a quarter of the way in time is 5/32 of the way in position', () => {
    // smoothstep(1/4) = 1/16 · (3 − 1/2) = 5/32.
    expect(moveEase(0.25)).toBeCloseTo(5 / 32, 12)
    expect(overlayRectAt(o, 2.5).x).toBeCloseTo(0.1 + 0.4 * (5 / 32), 12)
  })

  it('is the destination at the glide\'s end and until the next Move', () => {
    expect(overlayRectAt(o, 4)).toEqual({ x: 0.5, y: 0.5, width: 0.4, height: 0.4 })
    expect(overlayRectAt(o, 5.5)).toEqual({ x: 0.5, y: 0.5, width: 0.4, height: 0.4 })
  })

  it('glides the second Move from the first one\'s destination, and holds the last after it', () => {
    const mid = overlayRectAt(o, 6.5)
    expect(mid.x).toBeCloseTo(0.25, 12)
    expect(mid.y).toBeCloseTo(0.55, 12)
    expect(mid.width).toBeCloseTo(0.35, 12)
    expect(overlayRectAt(o, 7)).toEqual({ x: 0.0, y: 0.6, width: 0.3, height: 0.3 })
    expect(overlayRectAt(o, 100)).toEqual({ x: 0.0, y: 0.6, width: 0.3, height: 0.3 })
  })

  it('jumps at a zero-length glide', () => {
    const jump = overlay({ moves: [move('j', 3, 0)] })
    expect(overlayRectAt(jump, 2.999).x).toBe(0.1)
    expect(overlayRectAt(jump, 3).x).toBe(0.5)
  })

  it('overlayPlacedAt reads it at sequence time less the offset, and is the same object with no Moves', () => {
    // Offset 2: sequence 5 is on-screen 3, the first glide's midpoint.
    expect(overlayPlacedAt(o, 5).x).toBeCloseTo(0.3, 12)
    const still = overlay()
    expect(overlayPlacedAt(still, 5)).toBe(still)
  })
})

describe('Move normalization (#834)', () => {
  it('sorts Moves by start', () => {
    const swept = sweptMoves([move('b', 5, 1), move('a', 1, 1)], 10)
    expect(swept.map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('keeps them disjoint: a Move starting inside the previous glide starts at its end', () => {
    const swept = sweptMoves([move('a', 1, 3), move('b', 2, 1)], 10)
    expect(swept[1]).toMatchObject({ id: 'b', start: 4, glide: 1 })
  })

  it('keeps every glide inside the on-screen window', () => {
    const swept = sweptMoves([move('a', 8, 5), move('b', 12, 1)], 10)
    expect(swept[0]).toMatchObject({ start: 8, glide: 2 })
    expect(swept[1]).toMatchObject({ start: 10, glide: 0 })
  })

  it('clamps each destination as a placement is: size first, then position', () => {
    const [m] = sweptMoves([move('a', 0, 1, { x: 0.9, y: -0.2, width: 2, height: 0.01 })], 10)
    expect(m).toMatchObject({ width: 1, height: 0.05, x: 0, y: 0 })
  })

  it('measures the window on screen: a speed segment that doubles the overlay\'s pace halves the room', () => {
    // 10 s of source with a 2× segment over all of it is 5 s on screen.
    const o = normalized(
      overlay({
        remaps: [{ id: 's', kind: 'speed', start: 0, end: 10, factor: 2 }],
        moves: [move('a', 4, 3)],
      }),
    )
    expect(o.moves).toEqual([move('a', 4, 1)])
  })

  it('a trim that shortens the window past a Move collapses it against the new end', () => {
    let state = stateWith(overlay({ moves: [move('a', 6, 2)] }))
    state = timelineReducer(state, {
      type: 'video-overlay-updated',
      id: 'pip',
      placement: { offset: 2, inPoint: 1, outPoint: 5, x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
    })
    expect(videoOverlaysOf(state)[0].moves).toEqual([move('a', 4, 0)])
  })

  it('leaves a Move-free overlay without the key, and the same object', () => {
    const o = overlay()
    const state = stateWith(o)
    const next = timelineReducer(state, { type: 'video-overlay-move-removed', overlayId: 'pip', id: 'x' })
    expect(next).toBe(state)
    expect('moves' in videoOverlaysOf(next)[0]).toBe(false)
  })
})

describe('Move actions (#834)', () => {
  it('adds a Move to a video overlay and to an image overlay', () => {
    let state = stateWith(overlay(), image())
    state = add(state, 'pip', move('m', 1, 1))
    state = add(state, 'logo', move('n', 2, 1))
    expect(videoOverlaysOf(state)[0].moves).toEqual([move('m', 1, 1)])
    expect(videoOverlaysOf(state)[1].moves).toEqual([move('n', 2, 1)])
  })

  it('vetoes an add with no room, a taken id, or a non-finite field', () => {
    const state = add(stateWith(overlay()), 'pip', move('m', 0, 10))
    expect(add(state, 'pip', move('late', 3, 1))).toBe(state)
    const roomy = stateWith(overlay())
    const once = add(roomy, 'pip', move('m', 1, 1))
    expect(add(once, 'pip', move('m', 4, 1))).toBe(once)
    expect(add(roomy, 'pip', move('nan', Number.NaN, 1))).toBe(roomy)
  })

  it('updates a Move, and an update that clamps back to the stored one is a no-op', () => {
    let state = add(stateWith(overlay()), 'pip', move('m', 1, 1))
    state = timelineReducer(state, {
      type: 'video-overlay-move-updated',
      overlayId: 'pip',
      id: 'm',
      move: { start: 2, glide: 3, x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    })
    expect(videoOverlaysOf(state)[0].moves).toEqual([{ id: 'm', start: 2, glide: 3, x: 0.1, y: 0.2, width: 0.3, height: 0.4 }])
    // A glide past the window's end clamps back to the 8 s it has room for:
    // store that, then ask for more — nothing changes.
    state = timelineReducer(state, {
      type: 'video-overlay-move-updated',
      overlayId: 'pip',
      id: 'm',
      move: { start: 2, glide: 50, x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    })
    expect(videoOverlaysOf(state)[0].moves?.[0].glide).toBe(8)
    const same = timelineReducer(state, {
      type: 'video-overlay-move-updated',
      overlayId: 'pip',
      id: 'm',
      move: { start: 2, glide: 20, x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    })
    expect(same).toBe(state)
  })

  it('removes a Move, and the last one leaves no key', () => {
    let state = add(stateWith(overlay()), 'pip', move('m', 1, 1))
    state = timelineReducer(state, { type: 'video-overlay-move-removed', overlayId: 'pip', id: 'm' })
    expect('moves' in videoOverlaysOf(state)[0]).toBe(false)
  })

  it('adding, editing and removing are one undo step each', () => {
    let history = timelineHistoryReducer(emptyTimelineHistory, { type: 'timeline-replaced', timeline: stateWith(overlay()) })
    const before = history.present
    history = timelineHistoryReducer(history, { type: 'video-overlay-move-added', overlayId: 'pip', move: move('m', 1, 1) })
    const added = history.present
    history = timelineHistoryReducer(history, {
      type: 'video-overlay-move-updated',
      overlayId: 'pip',
      id: 'm',
      move: { start: 2, glide: 1, x: 0.5, y: 0.5, width: 0.4, height: 0.4 },
    })
    const edited = history.present
    history = timelineHistoryReducer(history, { type: 'video-overlay-move-removed', overlayId: 'pip', id: 'm' })
    history = timelineHistoryReducer(history, { type: 'edit-undone' })
    expect(history.present).toBe(edited)
    history = timelineHistoryReducer(history, { type: 'edit-undone' })
    expect(history.present).toBe(added)
    history = timelineHistoryReducer(history, { type: 'edit-undone' })
    expect(history.present).toBe(before)
  })

  it('a duplicate carries the Moves, and removing the overlay removes them', () => {
    let state = add(stateWith(overlay()), 'pip', move('m', 1, 1))
    state = timelineReducer(state, { type: 'element-duplicated', kind: 'video-overlay', id: 'pip', newId: 'copy' })
    expect(videoOverlaysOf(state).map((o) => o.moves)).toEqual([[move('m', 1, 1)], [move('m', 1, 1)]])
    state = timelineReducer(state, { type: 'video-overlay-removed', id: 'copy' })
    expect(videoOverlaysOf(state)).toHaveLength(1)
  })
})

describe('defaultMoveFor (#834)', () => {
  it('starts at 0 with the default glide, to where the overlay already is', () => {
    expect(defaultMoveFor(overlay())).toEqual({ start: 0, glide: DEFAULT_MOVE_GLIDE, x: 0.1, y: 0.1, width: 0.2, height: 0.2 })
  })

  it('starts where the last Move ends, to its destination, so adding changes nothing', () => {
    const o = overlay({ moves: [move('m', 2, 2)] })
    expect(defaultMoveFor(o)).toEqual({ start: 4, glide: 1, x: 0.5, y: 0.5, width: 0.4, height: 0.4 })
  })

  it('shortens the glide to the room left, and is null with none', () => {
    expect(defaultMoveFor(overlay({ moves: [move('m', 0, 9.5)] }))?.glide).toBeCloseTo(0.5, 12)
    expect(defaultMoveFor(overlay({ moves: [move('m', 0, 10)] }))).toBeNull()
  })
})

/**
 * Every 10 ms of the original's window: the parts, laid out as `partAt`
 * says, are placed exactly where the original was at `originalAt`.
 */
function expectSamePlacement(
  original: VideoOverlay,
  parts: (sequenceTime: number) => { part: VideoOverlay; originalAt: number } | null,
  from: number,
  to: number,
): number {
  let samples = 0
  for (let t = from; t < to; t += 0.01) {
    const which = parts(t)
    if (which === null) continue
    const now = overlayPlacedAt(which.part, t)
    const then = overlayRectAt(original, which.originalAt - original.offset)
    expect(now.x).toBeCloseTo(then.x, 9)
    expect(now.y).toBeCloseTo(then.y, 9)
    expect(now.width).toBeCloseTo(then.width, 9)
    expect(now.height).toBeCloseTo(then.height, 9)
    samples++
  }
  return samples
}

describe('Moves are divided where an overlay is rebuilt as parts (#834)', () => {
  // On screen 2 → 12 s (offset 2, trim 1..11). Moves at on-screen 1..3 and 6..7.
  const moves = [move('m1', 1, 2), move('m2', 6, 1, { x: 0, y: 0.6, width: 0.3, height: 0.3 })]

  it('splitMovesAt cuts a glide that contains the cut at the placement it had there', () => {
    const o = overlay({ moves })
    const { before, after, afterRect } = splitMovesAt(o, 2)
    expect(afterRect).toEqual(overlayRectAt(o, 2))
    expect(before).toEqual([{ ...moves[0], glide: 1, ...afterRect }])
    expect(after).toEqual([{ ...moves[0], start: 0, glide: 1 }, { ...moves[1], start: 4 }])
  })

  it('Split… keeps every placement where it was, with the cut between two Moves', () => {
    const o = normalized(overlay({ moves }))
    const after = timelineReducer(stateWith(o), {
      type: 'element-split',
      kind: 'video-overlay',
      id: 'pip',
      atSourceTime: 6, // on-screen 5, sequence 7
      newId: 'second',
    })
    const [first, second] = videoOverlaysOf(after)
    expect(first.moves).toEqual([moves[0]])
    expect(second).toMatchObject({ x: 0.5, y: 0.5, width: 0.4, height: 0.4 })
    expect(second.moves).toEqual([{ ...moves[1], start: 1 }])
    const samples = expectSamePlacement(o, (t) => ({ part: t < 7 ? first : second, originalAt: t }), 2, 12)
    expect(samples).toBeGreaterThan(990)
  })

  it('Split… inside a glide meets at the cut and reaches the same destination', () => {
    const o = normalized(overlay({ moves }))
    const [first, second] = videoOverlaysOf(
      timelineReducer(stateWith(o), { type: 'element-split', kind: 'video-overlay', id: 'pip', atSourceTime: 3, newId: 'second' }),
    )
    // The cut is on-screen 2, sequence 4: halfway through m1's glide.
    expect(overlayPlacedAt(first, 4 - 1e-9).x).toBeCloseTo(overlayRectAt(o, 2).x, 6)
    expect(overlayPlacedAt(second, 4)).toMatchObject(overlayRectAt(o, 2))
    expect(overlayPlacedAt(second, 5)).toMatchObject(overlayRectAt(o, 3))
    // Outside the cut glide, every placement is the original's.
    expectSamePlacement(o, (t) => (t >= 2 && t < 3) || t >= 5 ? { part: t < 4 ? first : second, originalAt: t } : null, 2, 12)
  })

  it('Cut… keeps the head\'s Moves before Cut from, and the tail\'s after Cut to from the placement there', () => {
    const o = normalized(overlay({ moves }))
    // Cut source 4..6.5: on-screen 3..5.5, so 2.5 s go; the tail starts at sequence 5.
    const [head, tail] = videoOverlaysOf(
      timelineReducer(stateWith(o), { type: 'element-cut', kind: 'video-overlay', id: 'pip', from: 4, to: 6.5, newId: 'tail' }),
    )
    expect(head.moves).toEqual([moves[0]])
    expect(tail.offset).toBe(5)
    expect(tail).toMatchObject(overlayRectAt(o, 5.5))
    expect(tail.moves).toEqual([{ ...moves[1], start: 0.5 }])
    const samples = expectSamePlacement(o, (t) => (t < 5 ? { part: head, originalAt: t } : { part: tail, originalAt: t + 2.5 }), 2, 9.5)
    expect(samples).toBeGreaterThan(740)
  })

  it('the ripple keeps a later Move with the picture when Cut out marked range takes the overlay\'s head', () => {
    const o = normalized(overlay({ moves }))
    // The overlay is on screen from 2 s; cut 0..4 of the sequence: it loses
    // its first 2 s on screen and starts at 0.
    const after = timelineReducer(stateWith(o), { type: 'range-cut', from: 0, to: 4, newEntryIds: ['x', 'y'] })
    const [shortened] = videoOverlaysOf(after)
    expect(shortened.offset).toBe(0)
    expect(shortened).toMatchObject(overlayRectAt(o, 2))
    expect(shortened.moves).toEqual([{ ...moves[0], start: 0, glide: 1 }, { ...moves[1], start: 4 }])
    // From the end of the cut glide on, every placement is the original's, 4 s later.
    expectSamePlacement(o, (t) => (t >= 1 ? { part: shortened, originalAt: t + 4 } : null), 0, 8)
  })

  it('the ripple keeps the Moves before the new end when the overlay loses its tail', () => {
    const o = normalized(overlay({ moves }))
    // Cut 7.5..20: the overlay (2..12) loses everything after on-screen 5.5.
    const [shortened] = videoOverlaysOf(timelineReducer(stateWith(o), { type: 'range-cut', from: 7.5, to: 20, newEntryIds: ['x', 'y'] }))
    expect(shortened.moves).toEqual([moves[0]])
    expectSamePlacement(o, (t) => ({ part: shortened, originalAt: t }), 2, 7.5)
  })

  it('the ripple moves an image overlay\'s Moves with it, and divides them at a head cut', () => {
    const logo = normalized(image({ moves: [move('m', 1, 2)] }))
    // On screen 1..7; cut 0..3 of the sequence takes its first 2 s.
    const [shortened] = videoOverlaysOf(timelineReducer(stateWith(logo), { type: 'range-cut', from: 0, to: 3, newEntryIds: ['x', 'y'] }))
    expect(shortened).toMatchObject({ offset: 0, duration: 4, ...overlayRectAt(logo, 2) })
    expect(shortened.moves).toEqual([{ ...move('m', 0, 1) }])
  })
})
