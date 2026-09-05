import { describe, expect, it } from 'vitest'
import type { TimelineHistory } from './history'
import {
  HISTORY_LIMIT,
  emptyTimelineHistory,
  targetEditsText,
  timelineHistoryReducer,
} from './history'
import type { TimelineEntry, TimelineState } from './timeline'

const entry = (id: string, clipId = `clip-${id}`): TimelineEntry => ({
  id,
  clipId,
  name: `${id}.mp4`,
  duration: 10,
  url: `blob:${id}`,
  inPoint: 0,
  outPoint: 10,
})

const addEntry = (history: TimelineHistory, id: string, clipId?: string): TimelineHistory =>
  timelineHistoryReducer(history, { type: 'entry-added', entry: entry(id, clipId) })

describe('timelineHistoryReducer (#189)', () => {
  it('passes timeline actions through and records the outgoing state', () => {
    const one = addEntry(emptyTimelineHistory, 'a')
    expect(one.present.entries.map((e) => e.id)).toEqual(['a'])
    expect(one.past).toEqual([emptyTimelineHistory.present])
    expect(one.future).toEqual([])
  })

  it('undoes to the previous state and redoes back, preserving references', () => {
    const two = addEntry(addEntry(emptyTimelineHistory, 'a'), 'b')
    const undone = timelineHistoryReducer(two, { type: 'edit-undone' })
    // The exact earlier state object comes back — reference equality is what
    // the app's unsaved-changes tracking compares with (#76).
    expect(undone.present).toBe(two.past[1])
    expect(undone.present.entries.map((e) => e.id)).toEqual(['a'])
    const redone = timelineHistoryReducer(undone, { type: 'edit-redone' })
    expect(redone.present).toBe(two.present)
    expect(redone.future).toEqual([])
  })

  it('is a same-reference no-op to undo with no past or redo with no future', () => {
    expect(timelineHistoryReducer(emptyTimelineHistory, { type: 'edit-undone' })).toBe(
      emptyTimelineHistory,
    )
    expect(timelineHistoryReducer(emptyTimelineHistory, { type: 'edit-redone' })).toBe(
      emptyTimelineHistory,
    )
  })

  it('does not record actions the timeline reducer treats as no-ops', () => {
    const one = addEntry(emptyTimelineHistory, 'a')
    // Moving a nonexistent entry returns the same timeline reference, so
    // the history must return the same history reference too — the change
    // never becomes a hollow undo step.
    expect(
      timelineHistoryReducer(one, { type: 'entry-moved', id: 'ghost', direction: 'up' }),
    ).toBe(one)
  })

  it('clears the redo line when a new edit follows an undo', () => {
    const two = addEntry(addEntry(emptyTimelineHistory, 'a'), 'b')
    const undone = timelineHistoryReducer(two, { type: 'edit-undone' })
    expect(undone.future).toHaveLength(1)
    const diverged = addEntry(undone, 'c')
    expect(diverged.future).toEqual([])
    expect(diverged.present.entries.map((e) => e.id)).toEqual(['a', 'c'])
    // The undone-then-abandoned 'b' state is unreachable now.
    expect(timelineHistoryReducer(diverged, { type: 'edit-redone' })).toBe(diverged)
  })

  it('keeps at most HISTORY_LIMIT undo steps, dropping the oldest', () => {
    let history = emptyTimelineHistory
    for (let index = 0; index < HISTORY_LIMIT + 5; index++) {
      history = addEntry(history, `e${index}`)
    }
    expect(history.past).toHaveLength(HISTORY_LIMIT)
    // The oldest surviving state is the one 100 edits back, not the start.
    expect(history.past[0].entries).toHaveLength(5)
    let undos = 0
    while (history.past.length > 0) {
      history = timelineHistoryReducer(history, { type: 'edit-undone' })
      undos++
    }
    expect(undos).toBe(HISTORY_LIMIT)
    expect(history.present.entries).toHaveLength(5)
  })

  it('clears the whole history when the timeline is replaced (open/new project)', () => {
    const two = addEntry(addEntry(emptyTimelineHistory, 'a'), 'b')
    const undone = timelineHistoryReducer(two, { type: 'edit-undone' })
    const replacement: TimelineState = { entries: [entry('opened')] }
    const replaced = timelineHistoryReducer(undone, {
      type: 'timeline-replaced',
      timeline: replacement,
    })
    expect(replaced.present).toBe(replacement)
    expect(replaced.past).toEqual([])
    expect(replaced.future).toEqual([])
  })

  it('clears the whole history when a library clip removal touches the timeline', () => {
    // Undo must never restore a state referencing a removed clip: its object
    // URL is revoked at removal, so such a state could never play again.
    const two = addEntry(addEntry(emptyTimelineHistory, 'a'), 'b')
    const cleared = timelineHistoryReducer(two, {
      type: 'entries-removed-for-clip',
      clipId: 'clip-b',
    })
    expect(cleared.present.entries.map((e) => e.id)).toEqual(['a'])
    expect(cleared.past).toEqual([])
    expect(cleared.future).toEqual([])
  })

  it('clears the history for a still overlay whose library clip is removed (#294)', () => {
    // An image overlay lives in the same lane as a video one, so it is
    // covered by the same clip-removal rule — pinned rather than assumed,
    // because "the collection already handles it" is exactly the kind of
    // claim that stops being true when someone splits the collection.
    const withStill = timelineHistoryReducer(addEntry(emptyTimelineHistory, 'a'), {
      type: 'video-overlay-added',
      overlay: {
        id: 'i1', kind: 'image', clipId: 'clip-logo', name: 'logo.png', duration: 5,
        url: 'blob:logo', offset: 0, inPoint: 0, outPoint: 5,
        x: 0.6, y: 0.6, width: 0.35, height: 0.35,
      },
    })
    expect(withStill.present.videoOverlays).toHaveLength(1)
    const cleared = timelineHistoryReducer(withStill, {
      type: 'entries-removed-for-clip',
      clipId: 'clip-logo',
    })
    expect(cleared.present.videoOverlays ?? []).toEqual([])
    expect(cleared.past).toEqual([])
    expect(cleared.future).toEqual([])
  })

  it('keeps the history when a library clip removal touches nothing on the timeline', () => {
    const one = addEntry(emptyTimelineHistory, 'a')
    // No timeline state — past, present, or future — references this clip.
    expect(
      timelineHistoryReducer(one, { type: 'entries-removed-for-clip', clipId: 'unused-clip' }),
    ).toBe(one)
  })

  it('judges a batch removal once, over the whole set (#293)', () => {
    // One referenced clip and one unreferenced clip in the same batch: the
    // batch clears the history, exactly as the equivalent run of single
    // removals would — the referenced one decides.
    const two = addEntry(addEntry(emptyTimelineHistory, 'a'), 'b')
    const cleared = timelineHistoryReducer(two, {
      type: 'entries-removed-for-clips',
      clipIds: ['clip-b', 'never-used'],
    })
    expect(cleared.present.entries.map((e) => e.id)).toEqual(['a'])
    expect(cleared.past).toEqual([])
    expect(cleared.future).toEqual([])
  })

  it('keeps the history when a batch removal references nothing held (#293)', () => {
    const one = addEntry(emptyTimelineHistory, 'a')
    expect(
      timelineHistoryReducer(one, {
        type: 'entries-removed-for-clips',
        clipIds: ['unused-one', 'unused-two'],
      }),
    ).toBe(one)
    expect(timelineHistoryReducer(one, { type: 'entries-removed-for-clips', clipIds: [] })).toBe(one)
  })

  it('clears the history for a batch whose clip only a held state references (#293)', () => {
    // The entry was edited off the timeline before the batch removal, so the
    // present is untouched — but `past` still holds it and its URL is
    // revoked. The batch rule must look past the present, like the single one.
    let history = addEntry(emptyTimelineHistory, 'a', 'clip-x')
    history = timelineHistoryReducer(history, { type: 'entry-removed', id: 'a' })
    const cleared = timelineHistoryReducer(history, {
      type: 'entries-removed-for-clips',
      clipIds: ['clip-x', 'clip-y'],
    })
    expect(cleared.present).toBe(history.present)
    expect(cleared.past).toEqual([])
    expect(timelineHistoryReducer(cleared, { type: 'edit-undone' })).toBe(cleared)
  })

  it('a batch removal is one history event, not one per clip (#293)', () => {
    // Three adds, then a batch removing two clips neither the present nor
    // any held state keeps: the history survives intact and undo still steps
    // back through the individual adds.
    let history = addEntry(emptyTimelineHistory, 'a', 'clip-a')
    history = addEntry(history, 'b', 'clip-b')
    const pastDepth = history.past.length
    const removed = timelineHistoryReducer(history, {
      type: 'entries-removed-for-clips',
      clipIds: ['gone-one', 'gone-two'],
    })
    expect(removed).toBe(history)
    expect(removed.past).toHaveLength(pastDepth)
  })

  it('clears the history when only a past state references the removed clip', () => {
    // The entry was edited off the timeline before its clip was removed, so
    // the present is untouched by the removal — but the pre-removal state in
    // `past` still holds the entry, and its object URL is revoked. Undo must
    // not resurrect it.
    let history = addEntry(emptyTimelineHistory, 'a', 'clip-x')
    history = timelineHistoryReducer(history, { type: 'entry-removed', id: 'a' })
    const cleared = timelineHistoryReducer(history, {
      type: 'entries-removed-for-clip',
      clipId: 'clip-x',
    })
    expect(cleared.present).toBe(history.present)
    expect(cleared.past).toEqual([])
    expect(cleared.future).toEqual([])
    expect(timelineHistoryReducer(cleared, { type: 'edit-undone' })).toBe(cleared)
  })

  it('clears the history when only a future state references the removed clip', () => {
    // Add, undo (the state holding the entry moves to `future`), then remove
    // the clip: redo must not resurrect the entry.
    const added = addEntry(emptyTimelineHistory, 'a', 'clip-x')
    const undone = timelineHistoryReducer(added, { type: 'edit-undone' })
    const cleared = timelineHistoryReducer(undone, {
      type: 'entries-removed-for-clip',
      clipId: 'clip-x',
    })
    expect(cleared.present).toBe(undone.present)
    expect(cleared.past).toEqual([])
    expect(cleared.future).toEqual([])
    expect(timelineHistoryReducer(cleared, { type: 'edit-redone' })).toBe(cleared)
  })
})

describe('targetEditsText (#189)', () => {
  const input = (type: string) => {
    const element = document.createElement('input')
    element.type = type
    return element
  }

  it('claims text-editing contexts for the browser and leaves the rest to the timeline', () => {
    expect(targetEditsText(document.createElement('textarea'))).toBe(true)
    expect(targetEditsText(input('text'))).toBe(true)
    expect(targetEditsText(input('number'))).toBe(true)
    expect(targetEditsText(input('range'))).toBe(false)
    expect(targetEditsText(input('checkbox'))).toBe(false)
    expect(targetEditsText(input('color'))).toBe(false)
    expect(targetEditsText(document.createElement('button'))).toBe(false)
    expect(targetEditsText(document.body)).toBe(false)
    expect(targetEditsText(null)).toBe(false)
  })
})

describe('freeze frame is one undo step (#379)', () => {
  const frozenStill: TimelineEntry = {
    id: 'fz',
    clipId: 'clip-fz',
    name: 'Freeze 0:04.png',
    duration: 2,
    url: 'blob:fz',
    inPoint: 0,
    outPoint: 2,
    kind: 'image',
  }

  it('undoing once removes the cut and the still together', () => {
    const one = addEntry(emptyTimelineHistory, 'a')
    const frozen = timelineHistoryReducer(one, {
      type: 'frame-frozen',
      still: frozenStill,
      placement: { kind: 'split', entryId: 'a', atSourceTime: 4, newEntryId: 'a2' },
    })
    expect(frozen.present.entries.map((e) => e.id)).toEqual(['a', 'fz', 'a2'])
    expect(frozen.past).toHaveLength(2)

    const undone = timelineHistoryReducer(frozen, { type: 'edit-undone' })
    expect(undone.present).toBe(one.present)

    const redone = timelineHistoryReducer(undone, { type: 'edit-redone' })
    expect(redone.present).toBe(frozen.present)
  })

  it('a refused freeze records no history step', () => {
    const one = addEntry(emptyTimelineHistory, 'a')
    expect(
      timelineHistoryReducer(one, {
        type: 'frame-frozen',
        still: frozenStill,
        // The trim window's edge: the razor refuses, so the freeze does.
        placement: { kind: 'split', entryId: 'a', atSourceTime: 0, newEntryId: 'a2' },
      }),
    ).toBe(one)
  })
})

describe('batch add from a library selection (#292)', () => {
  const track = {
    id: 't1',
    clipId: 'clip-t1',
    name: 't1.mp3',
    duration: 4,
    url: 'blob:t1',
    offset: 0,
    inPoint: 0,
    outPoint: 4,
  }

  it('is one undo step for the whole batch, entries and tracks together', () => {
    const batch = timelineHistoryReducer(emptyTimelineHistory, {
      type: 'clips-added',
      entries: [entry('a'), entry('b')],
      audioTracks: [track],
    })
    expect(batch.present.entries.map((e) => e.id)).toEqual(['a', 'b'])
    expect(batch.present.audioTracks?.map((t) => t.id)).toEqual(['t1'])
    expect(batch.past).toHaveLength(1)

    const undone = timelineHistoryReducer(batch, { type: 'edit-undone' })
    expect(undone.present).toBe(emptyTimelineHistory.present)
    expect(undone.past).toEqual([])

    const redone = timelineHistoryReducer(undone, { type: 'edit-redone' })
    expect(redone.present).toBe(batch.present)
  })

  it('records nothing for an empty batch', () => {
    const one = addEntry(emptyTimelineHistory, 'a')
    expect(
      timelineHistoryReducer(one, { type: 'clips-added', entries: [], audioTracks: [] }),
    ).toBe(one)
  })
})
