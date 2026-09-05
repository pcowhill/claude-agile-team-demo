import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FREEZE_STILL_DURATION,
  freezeClipName,
  freezeFrameClip,
  freezeTargetAt,
} from './freezeFrame'
import type { TimelineState } from './timeline'
import { timelineReducer } from './timeline'

const stateOf = (
  ...entries: Array<[id: string, duration?: number, inPoint?: number, outPoint?: number]>
): TimelineState => ({
  entries: entries.map(([id, duration = 10, inPoint = 0, outPoint = duration]) => ({
    id,
    clipId: `clip-${id}`,
    name: `${id}.mp4`,
    duration,
    url: `blob:${id}`,
    inPoint,
    outPoint,
  })),
})

describe('freezeClipName', () => {
  it('names the clip from the sequence time, the approved example form (#316)', () => {
    expect(freezeClipName(12)).toBe('Freeze 0:12.png')
    expect(freezeClipName(72.4)).toBe('Freeze 1:12.png')
  })

  it('clamps negative times to the sequence start', () => {
    expect(freezeClipName(-3)).toBe('Freeze 0:00.png')
  })
})

describe('freezeFrameClip', () => {
  // jsdom implements no createObjectURL — the extractAudio.test.ts stub.
  const originalURL = globalThis.URL
  const createObjectURL = vi.fn(() => 'blob:frozen')
  beforeEach(() => {
    createObjectURL.mockClear()
    vi.stubGlobal('URL', { ...originalURL, createObjectURL })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('derives an ordinary image clip holding the PNG under a fresh object URL (#154 pattern)', () => {
    const blob = new Blob(['png-bytes'], { type: 'image/png' })
    const clip = freezeFrameClip(blob, 12, 'fz-1', { width: 320, height: 180 })
    expect(createObjectURL).toHaveBeenCalledWith(blob)
    expect(clip).toEqual({
      id: 'fz-1',
      name: 'Freeze 0:12.png',
      duration: 0,
      url: 'blob:frozen',
      kind: 'image',
      width: 320,
      height: 180,
    })
  })
})

describe('freezeTargetAt', () => {
  it('is null on an empty timeline, in both modes', () => {
    expect(freezeTargetAt({ entries: [] }, 0, 'split')).toBeNull()
    expect(freezeTargetAt({ entries: [] }, 0, 'append')).toBeNull()
  })

  it('split mode cuts where the razor would', () => {
    const state = stateOf(['e1', 10, 2, 8])
    expect(freezeTargetAt(state, 3, 'split')).toEqual({
      kind: 'split',
      entryId: 'e1',
      atSourceTime: 5,
    })
  })

  it('append mode holds after the entry under the playhead, without cutting', () => {
    const state = stateOf(['e1'], ['e2'])
    expect(freezeTargetAt(state, 3, 'append')).toEqual({ kind: 'after', entryId: 'e1' })
    expect(freezeTargetAt(state, 13, 'append')).toEqual({ kind: 'after', entryId: 'e2' })
  })

  it("split mode at an entry's first instant holds before the entry — hold, then play", () => {
    const state = stateOf(['e1'], ['e2'])
    // The sequence start, and a hard-cut boundary (which resolves to the
    // next entry's first instant): no strictly-inside cut exists at either.
    expect(freezeTargetAt(state, 0, 'split')).toEqual({ kind: 'before', entryId: 'e1' })
    expect(freezeTargetAt(state, 10, 'split')).toEqual({ kind: 'before', entryId: 'e2' })
  })

  it("split mode at the sequence's end holds after the last entry — the end card", () => {
    const state = stateOf(['e1'], ['e2'])
    expect(freezeTargetAt(state, 20, 'split')).toEqual({ kind: 'after', entryId: 'e2' })
  })

  it('split mode inside a transition overlap holds after the outgoing entry', () => {
    const state = timelineReducer(stateOf(['e1'], ['e2']), {
      type: 'transition-set',
      beforeId: 'e1',
      afterId: 'e2',
      transition: { type: 'crossfade', duration: 1 },
    })
    // The overlap runs 9..10; the razor refuses there (#190), the freeze
    // holds the captured blend where the dissolve was.
    expect(freezeTargetAt(state, 9.5, 'split')).toEqual({ kind: 'after', entryId: 'e1' })
  })

  it('holds for the approved two-second beat by default (#316)', () => {
    expect(FREEZE_STILL_DURATION).toBe(2)
  })
})
