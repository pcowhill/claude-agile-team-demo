import { describe, expect, it } from 'vitest'
import type { TimelineState } from './timeline'
import { textsOf, timelineReducer, totalDuration } from './timeline'
import type { TextOverlay } from './textOverlay'
import { DEFAULT_TEXT } from './textOverlay'
import {
  PLAY_CUT_LEAD,
  clampCut,
  cutClampsRefusal,
  entryCutRefusal,
  entryCutSpan,
  initialCutClamps,
  playCutStart,
  playCutStep,
} from './cutWindow'

// The Cut window (#827): Trim…'s inverse on a sequence entry, applied as
// Cut out marked range (#823) over the entry's span, ripple included (#824).

const subtitle = (id: string, offset: number, duration: number): TextOverlay => ({
  ...DEFAULT_TEXT,
  id,
  content: id,
  offset,
  duration,
  subtitle: true,
})

/**
 * Two entries: `x` plays 4 s, then `y` plays its source 1..9 with a 2×
 * speed segment over trimmed seconds [2, 4). So `y` runs 2 s, then 1 s
 * at 2×, then 4 s, and starts at 4 s in the sequence: 11 s in all. A
 * subtitle sits after it at 10 s.
 */
const state = (): TimelineState => ({
  entries: [
    { id: 'x', clipId: 'c', name: 'x.mp4', duration: 10, url: 'blob:x', inPoint: 0, outPoint: 4 },
    { id: 'y', clipId: 'c', name: 'y.mp4', duration: 10, url: 'blob:y', inPoint: 1, outPoint: 9 },
  ],
  remaps: [{ id: 's', entryId: 'y', kind: 'speed', start: 2, end: 4, factor: 2 }],
  texts: [subtitle('after', 10, 0.8), subtitle('before', 1, 1)],
})

describe("the Cut window's clamps (#827)", () => {
  const range = { inPoint: 2, outPoint: 8 }

  it('opens on the middle third of the trimmed range', () => {
    expect(initialCutClamps(range)).toEqual({ from: 4, to: 6 })
    expect(initialCutClamps({ inPoint: 0, outPoint: 10 })).toEqual({ from: 3.333, to: 6.667 })
  })

  it('holds a clamp to the trimmed range, to the millisecond', () => {
    expect(clampCut(1, range)).toBe(2)
    expect(clampCut(9, range)).toBe(8)
    expect(clampCut(Number.NaN, range)).toBe(2)
    expect(clampCut(3.45678, range)).toBe(3.457)
  })

  it.each([
    ['Cut from on In', { from: 2, to: 5 }, 'in'],
    ['Cut to on Out', { from: 3, to: 8 }, 'out'],
    ['the clamps inverted', { from: 6, to: 4 }, 'order'],
    ['the clamps equal', { from: 5, to: 5 }, 'order'],
  ] as const)('refuses with %s', (_, clamps, refusal) => {
    expect(cutClampsRefusal(range, clamps)).toBe(refusal)
  })

  it('cuts with both clamps strictly inside, in order', () => {
    expect(cutClampsRefusal(range, { from: 2.001, to: 7.999 })).toBeNull()
  })
})

describe("Cut…'s Apply is Cut out marked range over the entry's span (#827)", () => {
  it("maps the clamps through the entry's speed segment to sequence time", () => {
    // Source 4 is trimmed second 3: 2 s plus half of [2, 3) at 2×, so 2.5 s
    // into y. Source 7 is trimmed second 6: 3 s plus 2 s, so 5 s into y.
    // y starts at 4 s.
    expect(entryCutSpan(state(), 'y', { from: 4, to: 7 })).toEqual({ from: 6.5, to: 9 })
    expect(entryCutSpan(state(), 'missing', { from: 4, to: 7 })).toBeNull()
  })

  it('makes the state range-cut makes over the same span, ripple included', () => {
    const before = state()
    const ids = ['mid', 'tail'] as const
    // What Frame ▾ › Cut out marked range does with marks at 6.5 and 9.
    const byMarks = timelineReducer(before, { type: 'range-cut', from: 6.5, to: 9, newEntryIds: ids })
    // What the Cut window's Apply does: its refusal, its span, the same action.
    expect(entryCutRefusal(before, 'y', { from: 4, to: 7 })).toBeNull()
    const span = entryCutSpan(before, 'y', { from: 4, to: 7 })!
    const byWindow = timelineReducer(before, { type: 'range-cut', ...span, newEntryIds: ids })
    expect(byWindow).toEqual(byMarks)

    // And what that state is: y in two parts meeting at a hard cut, the
    // source between 4 and 7 gone, 2.5 s removed, the subtitle after moved
    // earlier and the one before left.
    expect(byWindow.entries.map((entry) => [entry.id, entry.inPoint, entry.outPoint])).toEqual([
      ['x', 0, 4],
      ['y', 1, 4],
      ['tail', 7, 9],
    ])
    expect(totalDuration(byWindow)).toBeCloseTo(8.5, 9)
    const starts = Object.fromEntries(textsOf(byWindow).map((text) => [text.id, text.offset]))
    expect(starts.after).toBeCloseTo(7.5, 9)
    expect(starts.before).toBe(1)
  })

  it('refuses where the clamps do, and inside a transition, where range-cut refuses', () => {
    const before = state()
    expect(entryCutRefusal(before, 'y', { from: 1, to: 5 })).toBe('in')
    expect(entryCutRefusal(before, 'y', { from: 3, to: 9 })).toBe('out')
    expect(entryCutRefusal(before, 'y', { from: 5, to: 5 })).toBe('order')
    expect(entryCutRefusal(before, 'missing', { from: 3, to: 5 })).toBe('refused')
    // A 1 s crossfade from x into y: y's first output second, its source
    // [1, 2), is shared with x.
    const faded: TimelineState = {
      ...before,
      transitions: [{ beforeId: 'x', afterId: 'y', type: 'crossfade', duration: 1 }],
    }
    expect(entryCutRefusal(faded, 'y', { from: 1.5, to: 5 })).toBe('transition')
    expect(entryCutRefusal(faded, 'y', { from: 2, to: 5 })).toBeNull()
  })
})

describe('▶ Play cut (#827)', () => {
  const range = { inPoint: 1, outPoint: 9 }
  const clamps = { from: 4, to: 7 }

  it('starts a lead-in before Cut from, never before In', () => {
    expect(playCutStart(range, clamps)).toBe(4 - PLAY_CUT_LEAD)
    expect(playCutStart(range, { from: 1.5, to: 3 })).toBe(1)
  })

  it('plays up to Cut from, jumps straight on from Cut to, and stops at Out', () => {
    expect(playCutStep(3.9, range, clamps)).toEqual({ kind: 'play', at: 3.9 })
    expect(playCutStep(4, range, clamps)).toEqual({ kind: 'jump', at: 7 })
    expect(playCutStep(6.99, range, clamps)).toEqual({ kind: 'jump', at: 7 })
    expect(playCutStep(7, range, clamps)).toEqual({ kind: 'play', at: 7 })
    expect(playCutStep(9, range, clamps)).toEqual({ kind: 'stop', at: 9 })
  })

  it('does not jump over an inverted pair, and stops when the cut would reach Out', () => {
    expect(playCutStep(5, range, { from: 7, to: 4 })).toEqual({ kind: 'play', at: 5 })
    expect(playCutStep(5, range, { from: 4, to: 9 })).toEqual({ kind: 'stop', at: 9 })
  })
})
