import { describe, expect, it } from 'vitest'
import {
  LARGE_STEP_SECONDS,
  STEP_SECONDS,
  modalDialogOpen,
  stepTarget,
  targetClaimsKeys,
  transportActionForKey,
} from './transport'

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

  it('maps ? to the cheat sheet — Shift included, as layouts type it', () => {
    expect(transportActionForKey(key('?', { shiftKey: true }))).toEqual({ kind: 'shortcut-help' })
    expect(transportActionForKey(key('?'))).toEqual({ kind: 'shortcut-help' })
  })

  it('never claims Ctrl/Cmd/Alt chords — those belong to the browser and #189 undo/redo', () => {
    for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      for (const k of [' ', 'ArrowLeft', 'ArrowRight', 'Home', 'End', '?']) {
        expect(transportActionForKey(key(k, modifiers))).toBeNull()
      }
    }
  })

  it('rejects Shift where it has no meaning, and unrelated keys entirely', () => {
    expect(transportActionForKey(key(' ', { shiftKey: true }))).toBeNull()
    expect(transportActionForKey(key('Home', { shiftKey: true }))).toBeNull()
    expect(transportActionForKey(key('End', { shiftKey: true }))).toBeNull()
    for (const k of ['a', 'Enter', 'Escape', 'ArrowUp', 'ArrowDown', 'z']) {
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
