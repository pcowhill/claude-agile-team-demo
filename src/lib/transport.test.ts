import { describe, expect, it } from 'vitest'
import {
  LARGE_STEP_SECONDS,
  SNAP_FALLBACK_THRESHOLD_SECONDS,
  SNAP_PIXELS,
  STEP_SECONDS,
  loopPlayStart,
  loopWrapTarget,
  modalDialogOpen,
  nextBoundary,
  previousBoundary,
  snapThresholdSeconds,
  snapToBoundary,
  stepTarget,
  targetClaimsKeys,
  transportActionForKey,
} from './transport'
import { markedExportRange } from './exportVideo'

const key = (
  k: string,
  modifiers: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {},
) => ({
  key: k,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...modifiers,
})

describe('transportActionForKey (#203)', () => {
  it('maps Space to play/pause toggling', () => {
    expect(transportActionForKey(key(' '))).toEqual({ kind: 'toggle-play' })
  })

  it('maps bare arrows to the small step, both directions', () => {
    expect(transportActionForKey(key('ArrowLeft'))).toEqual({ kind: 'step', delta: -STEP_SECONDS })
    expect(transportActionForKey(key('ArrowRight'))).toEqual({ kind: 'step', delta: STEP_SECONDS })
  })

  it('maps Shift+arrows to the larger step', () => {
    expect(transportActionForKey(key('ArrowLeft', { shiftKey: true }))).toEqual({
      kind: 'step',
      delta: -LARGE_STEP_SECONDS,
    })
    expect(transportActionForKey(key('ArrowRight', { shiftKey: true }))).toEqual({
      kind: 'step',
      delta: LARGE_STEP_SECONDS,
    })
  })

  it('maps Home and End to the jumps', () => {
    expect(transportActionForKey(key('Home'))).toEqual({ kind: 'jump', to: 'start' })
    expect(transportActionForKey(key('End'))).toEqual({ kind: 'jump', to: 'end' })
  })

  it('maps Up and Down to the boundary jumps (#391)', () => {
    expect(transportActionForKey(key('ArrowUp'))).toEqual({
      kind: 'jump-boundary',
      direction: 'previous',
    })
    expect(transportActionForKey(key('ArrowDown'))).toEqual({
      kind: 'jump-boundary',
      direction: 'next',
    })
  })

  it('maps I and O to the export-range marks, in either letter case (#417)', () => {
    expect(transportActionForKey(key('i'))).toEqual({ kind: 'mark', which: 'in' })
    expect(transportActionForKey(key('o'))).toEqual({ kind: 'mark', which: 'out' })
    // Caps Lock reports the uppercase letter with no Shift; Shift reports it
    // with Shift. Both are the same intent — a key that only works in one
    // case is a key the user thinks is broken.
    expect(transportActionForKey(key('I'))).toEqual({ kind: 'mark', which: 'in' })
    expect(transportActionForKey(key('O', { shiftKey: true }))).toEqual({
      kind: 'mark',
      which: 'out',
    })
  })

  it('maps ? to the cheat sheet — Shift included, as layouts type it', () => {
    expect(transportActionForKey(key('?', { shiftKey: true }))).toEqual({ kind: 'shortcut-help' })
    expect(transportActionForKey(key('?'))).toEqual({ kind: 'shortcut-help' })
  })

  it('never claims Ctrl/Cmd/Alt chords — those belong to the browser and #189 undo/redo', () => {
    for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      for (const k of [
        ' ',
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        'Home',
        'End',
        'i',
        'o',
        '?',
      ]) {
        expect(transportActionForKey(key(k, modifiers))).toBeNull()
      }
    }
  })

  it('rejects Shift where it has no meaning, and unrelated keys entirely', () => {
    expect(transportActionForKey(key(' ', { shiftKey: true }))).toBeNull()
    expect(transportActionForKey(key('Home', { shiftKey: true }))).toBeNull()
    expect(transportActionForKey(key('End', { shiftKey: true }))).toBeNull()
    expect(transportActionForKey(key('ArrowUp', { shiftKey: true }))).toBeNull()
    expect(transportActionForKey(key('ArrowDown', { shiftKey: true }))).toBeNull()
    for (const k of ['a', 'Enter', 'Escape', 'PageUp', 'PageDown', 'z']) {
      expect(transportActionForKey(key(k))).toBeNull()
    }
  })
})

describe('targetClaimsKeys (#203)', () => {
  const element = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    setup?: (el: HTMLElementTagNameMap[K]) => void,
  ) => {
    const el = document.createElement(tag)
    setup?.(el)
    return el
  }

  it('claims nothing for a missing or non-interactive target', () => {
    expect(targetClaimsKeys(null)).toBe(false)
    expect(targetClaimsKeys(element('div'))).toBe(false)
    expect(targetClaimsKeys(element('span'))).toBe(false)
  })

  it('claims every text-editing context, so typing never toggles playback', () => {
    expect(targetClaimsKeys(element('textarea'))).toBe(true)
    expect(targetClaimsKeys(element('input', (el) => (el.type = 'text')))).toBe(true)
    expect(targetClaimsKeys(element('input', (el) => (el.type = 'number')))).toBe(true)
    const editable = element('div')
    Object.defineProperty(editable, 'isContentEditable', { value: true })
    expect(targetClaimsKeys(editable)).toBe(true)
  })

  it('claims interactive controls with their own key behavior', () => {
    // Space activates a focused button — standard semantics stay intact.
    expect(targetClaimsKeys(element('button'))).toBe(true)
    // Arrows move a focused range slider (the seek slider itself).
    expect(targetClaimsKeys(element('input', (el) => (el.type = 'range')))).toBe(true)
    expect(targetClaimsKeys(element('input', (el) => (el.type = 'checkbox')))).toBe(true)
    expect(targetClaimsKeys(element('select'))).toBe(true)
    expect(targetClaimsKeys(element('a', (el) => el.setAttribute('href', '#')))).toBe(true)
  })

  it('does not claim a bare anchor without href (not focusable, no key behavior)', () => {
    expect(targetClaimsKeys(element('a'))).toBe(false)
  })
})

describe('modalDialogOpen (#203)', () => {
  it('is false with no dialog in the document', () => {
    expect(modalDialogOpen(document)).toBe(false)
  })

  it('sees any aria-modal dialog — the shared idiom of every app modal', () => {
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    document.body.appendChild(dialog)
    try {
      expect(modalDialogOpen(document)).toBe(true)
    } finally {
      dialog.remove()
    }
  })
})

describe('previousBoundary / nextBoundary (#391)', () => {
  // sequenceBoundaries' shape for two 10 s entries under a 2 s crossfade:
  // start, blend start, blend end, sequence end.
  const boundaries = [0, 8, 10, 18]

  it('lands on the nearest boundary strictly before / after the position', () => {
    expect(previousBoundary(boundaries, 9)).toBe(8)
    expect(previousBoundary(boundaries, 17.5)).toBe(10)
    expect(nextBoundary(boundaries, 9)).toBe(10)
    expect(nextBoundary(boundaries, 0.5)).toBe(8)
  })

  it('moves to the adjacent boundary from exactly on one — float noise included', () => {
    expect(previousBoundary(boundaries, 10)).toBe(8)
    expect(nextBoundary(boundaries, 8)).toBe(10)
    // A position a hair off the boundary (well under the slider's own 0.01 s
    // resolution) counts as on it, so repeated jumps never stick.
    expect(previousBoundary(boundaries, 10 + 1e-9)).toBe(8)
    expect(nextBoundary(boundaries, 8 - 1e-9)).toBe(10)
  })

  it('clamps at the sequence ends instead of refusing', () => {
    expect(previousBoundary(boundaries, 0)).toBe(0)
    expect(nextBoundary(boundaries, 18)).toBe(18)
    expect(nextBoundary(boundaries, 25)).toBe(18)
  })

  it('returns the position unchanged with no boundaries (empty timeline)', () => {
    expect(previousBoundary([], 3)).toBe(3)
    expect(nextBoundary([], 3)).toBe(3)
  })
})

describe('snapToBoundary and its threshold (#391)', () => {
  const boundaries = [0, 5, 10]

  it('snaps a commit within the threshold to the nearest boundary', () => {
    expect(snapToBoundary(5.1, boundaries, 0.2)).toBe(5)
    expect(snapToBoundary(4.85, boundaries, 0.2)).toBe(5)
    expect(snapToBoundary(9.9, boundaries, 0.2)).toBe(10)
  })

  it('does not snap outside the threshold, on an exact landing, or with no boundaries', () => {
    expect(snapToBoundary(4, boundaries, 0.2)).toBeNull()
    // Already on the boundary: no re-seek, no tick.
    expect(snapToBoundary(5, boundaries, 0.2)).toBeNull()
    expect(snapToBoundary(2, [], 0.2)).toBeNull()
  })

  it('breaks an exact tie toward the earlier boundary', () => {
    expect(snapToBoundary(2.5, boundaries, 3)).toBe(0)
  })

  it('derives the threshold from slider travel, with the stated fallback', () => {
    // SNAP_PIXELS of a 400 px slider over a 20 s sequence.
    expect(snapThresholdSeconds(20, 400)).toBeCloseTo((20 * SNAP_PIXELS) / 400, 10)
    // No measurable width (jsdom, collapsed layout) or no duration: the
    // fixed fallback rather than no snapping at all.
    expect(snapThresholdSeconds(20, 0)).toBe(SNAP_FALLBACK_THRESHOLD_SECONDS)
    expect(snapThresholdSeconds(0, 400)).toBe(SNAP_FALLBACK_THRESHOLD_SECONDS)
  })
})

describe('loopWrapTarget / loopPlayStart (#459)', () => {
  const span = { start: 2, end: 8 }

  it('wraps to the mark-in the moment the position reaches the mark-out, not before', () => {
    expect(loopWrapTarget(7.99, span, 10)).toBeNull()
    expect(loopWrapTarget(8, span, 10)).toBe(2)
    expect(loopWrapTarget(8.5, span, 10)).toBe(2)
    // Float noise on the boundary counts as reached (half-open at the end).
    expect(loopWrapTarget(8 - 1e-9, span, 10)).toBe(2)
  })

  it('without a valid span, wraps the whole sequence at its end', () => {
    expect(loopWrapTarget(9.99, null, 10)).toBeNull()
    expect(loopWrapTarget(10, null, 10)).toBe(0)
    expect(loopWrapTarget(10.5, null, 10)).toBe(0)
  })

  it('a span ending at the sequence end wraps there to the mark-in, not to 0', () => {
    expect(loopWrapTarget(10, { start: 4, end: 10 }, 10)).toBe(4)
  })

  it('validity is not its concern: the caller passes markedExportRange\'s answer', () => {
    // An inverted pair reaches it as null, and so loops the whole sequence.
    expect(markedExportRange(8, 2, 10)).toBeNull()
    expect(loopWrapTarget(10, markedExportRange(8, 2, 10), 10)).toBe(0)
    expect(loopWrapTarget(8, markedExportRange(2, 8, 10), 10)).toBe(2)
  })

  it('Play starts from the mark-in when the playhead is outside the span', () => {
    expect(loopPlayStart(0, span, 10)).toBe(2)
    expect(loopPlayStart(1.99, span, 10)).toBe(2)
    expect(loopPlayStart(8, span, 10)).toBe(2)
    expect(loopPlayStart(9, span, 10)).toBe(2)
  })

  it('Play inside the span starts where the playhead is', () => {
    expect(loopPlayStart(2, span, 10)).toBe(2)
    expect(loopPlayStart(5.5, span, 10)).toBe(5.5)
    expect(loopPlayStart(7.99, span, 10)).toBe(7.99)
  })

  it('Play without a span keeps its old rule: only the sequence end restarts from 0', () => {
    expect(loopPlayStart(0, null, 10)).toBe(0)
    expect(loopPlayStart(5.5, null, 10)).toBe(5.5)
    expect(loopPlayStart(10, null, 10)).toBe(0)
  })
})

describe('stepTarget (#203)', () => {
  it('moves by the delta inside the sequence', () => {
    expect(stepTarget(2, 0.1, 5)).toBeCloseTo(2.1, 10)
    expect(stepTarget(2, -1, 5)).toBeCloseTo(1, 10)
  })

  it('clamps to the sequence bounds', () => {
    expect(stepTarget(0.05, -0.1, 5)).toBe(0)
    expect(stepTarget(4.95, 0.1, 5)).toBe(5)
    expect(stepTarget(0, -1, 5)).toBe(0)
    expect(stepTarget(5, 1, 5)).toBe(5)
  })
})
