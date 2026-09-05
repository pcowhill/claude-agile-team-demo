import { targetEditsText } from './history'

/**
 * Transport keyboard shortcuts (#203): the pure mapping from keydown facts
 * to transport intents, plus the focus/dialog guards, kept out of the
 * component so both are unit-testable. The preview player owns the handler
 * (it owns the playhead and play state); the #189 undo/redo handler in App
 * is untouched — it requires Ctrl/Cmd, which every mapping here rejects.
 */

/** Small step for a bare arrow key, in seconds — the default of the
 * corresponding user setting (#286). */
export const STEP_SECONDS = 0.1
/** Larger step for Shift+arrow, in seconds — likewise a settable default. */
export const LARGE_STEP_SECONDS = 1

export type TransportAction =
  | { kind: 'toggle-play' }
  /** Move the playhead by `delta` seconds (clamped by `stepTarget`). */
  | { kind: 'step'; delta: number }
  | { kind: 'jump'; to: 'start' | 'end' }
  /** Jump to the adjacent sequence boundary (#391) — see `previousBoundary`
   * / `nextBoundary` for where that lands. */
  | { kind: 'jump-boundary'; direction: 'previous' | 'next' }
  | { kind: 'shortcut-help' }

/**
 * The transport intent a keydown expresses, or null when it expresses none.
 * Ctrl/Cmd/Alt chords are never claimed — they belong to the browser and to
 * the #189 undo/redo handler. Shift is meaningful only where a mapping says
 * so (the larger arrow step; `?` itself is typed as Shift+/ on most layouts,
 * so `key === '?'` already implies Shift).
 */
export function transportActionForKey(
  event: {
    key: string
    shiftKey: boolean
    ctrlKey: boolean
    metaKey: boolean
    altKey: boolean
  },
  /**
   * How far the arrows move the playhead. Defaults to the constants above,
   * which is what every caller wanted until the two became user settings
   * (#286) — so an omitted argument still means today's behaviour, and the
   * unit tests of the mapping itself need no new fixture.
   */
  steps: { step?: number; largeStep?: number } = {},
): TransportAction | null {
  const { step = STEP_SECONDS, largeStep = LARGE_STEP_SECONDS } = steps
  if (event.ctrlKey || event.metaKey || event.altKey) return null
  switch (event.key) {
    case ' ':
      return event.shiftKey ? null : { kind: 'toggle-play' }
    case 'ArrowLeft':
      return { kind: 'step', delta: -(event.shiftKey ? largeStep : step) }
    case 'ArrowRight':
      return { kind: 'step', delta: event.shiftKey ? largeStep : step }
    case 'Home':
      return event.shiftKey ? null : { kind: 'jump', to: 'start' }
    case 'End':
      return event.shiftKey ? null : { kind: 'jump', to: 'end' }
    // Up/Down jump to edit points (#391) — the desktop editors' convention,
    // and the two arrows the transport never claimed. Bare keys only, like
    // Home/End: Shift keeps whatever meaning the browser gives it.
    case 'ArrowUp':
      return event.shiftKey ? null : { kind: 'jump-boundary', direction: 'previous' }
    case 'ArrowDown':
      return event.shiftKey ? null : { kind: 'jump-boundary', direction: 'next' }
    case '?':
      return { kind: 'shortcut-help' }
    default:
      return null
  }
}

/**
 * Whether the keydown target claims these keys for itself, so the transport
 * must leave the event alone (#203): every text-editing context (typing a
 * space or an arrow into a field must edit the field — same rule as #189's
 * `targetEditsText`), and every other interactive control with its own
 * keyboard behavior — Space activates a focused button (standard button
 * semantics stay intact per the acceptance criteria), arrows move a focused
 * range slider (the seek slider itself) or select, Enter/Space follow a
 * focused link.
 */
export function targetClaimsKeys(target: EventTarget | null): boolean {
  if (targetEditsText(target)) return true
  return (
    target instanceof HTMLButtonElement ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLAnchorElement && target.hasAttribute('href'))
  )
}

/**
 * Whether a modal dialog is open (#203): the export modal, removal
 * confirmations, the open-project and save-mode dialogs, and the shortcut
 * cheat-sheet itself all render `role="dialog"` with `aria-modal`, and
 * while any of them is up the transport keys must do nothing.
 */
export function modalDialogOpen(doc: Document): boolean {
  return doc.querySelector('[role="dialog"][aria-modal="true"]') !== null
}

/** Where a step lands: the current position moved by `delta`, clamped to the sequence. */
export function stepTarget(current: number, delta: number, total: number): number {
  return Math.min(Math.max(current + delta, 0), total)
}

/**
 * Positions closer together than this count as the same instant (#391), so a
 * jump from exactly-on-a-boundary moves to the *adjacent* boundary instead of
 * re-landing where it already is, float noise included. Far below the 0.01 s
 * the seek slider can even express.
 */
const BOUNDARY_EPSILON = 1e-6

/**
 * The nearest boundary strictly before `current` (#391), or the first
 * boundary (the sequence start) when none is — the jump clamps at the ends
 * rather than refusing. `boundaries` is `sequenceBoundaries`' sorted output;
 * an empty list (empty timeline) returns `current` unchanged.
 */
export function previousBoundary(boundaries: readonly number[], current: number): number {
  for (let i = boundaries.length - 1; i >= 0; i--) {
    if (boundaries[i] < current - BOUNDARY_EPSILON) return boundaries[i]
  }
  return boundaries[0] ?? current
}

/** The nearest boundary strictly after `current` (#391); clamps to the last
 * boundary (the sequence end) when none is. */
export function nextBoundary(boundaries: readonly number[], current: number): number {
  for (const boundary of boundaries) {
    if (boundary > current + BOUNDARY_EPSILON) return boundary
  }
  return boundaries[boundaries.length - 1] ?? current
}

/**
 * The snap zone (#391), as slider travel rather than time: a committed seek
 * within this many pixels of a boundary lands on it. Pixels are what snapping
 * means to a hand on a slider — the same reach whatever the sequence length —
 * where any fixed time threshold is either numb on a short sequence or grabby
 * on a long one.
 */
export const SNAP_PIXELS = 8

/** Threshold where the slider's rendered width is unknowable (jsdom, a
 * zero-width layout): a small fixed window instead of no snapping at all. */
export const SNAP_FALLBACK_THRESHOLD_SECONDS = 0.2

/** `SNAP_PIXELS` of slider travel converted to seconds of sequence time. */
export function snapThresholdSeconds(total: number, sliderWidthPx: number): number {
  if (!(sliderWidthPx > 0) || !(total > 0)) return SNAP_FALLBACK_THRESHOLD_SECONDS
  return (total * SNAP_PIXELS) / sliderWidthPx
}

/**
 * Where a committed seek snaps (#391): the nearest boundary within
 * `threshold`, or null when none is — or when `current` already sits on one,
 * so an exact landing never re-seeks or flashes the tick. Ties between two
 * boundaries equally near go to the earlier one.
 */
export function snapToBoundary(
  current: number,
  boundaries: readonly number[],
  threshold: number,
): number | null {
  let best: number | null = null
  let bestDistance = Infinity
  for (const boundary of boundaries) {
    const distance = Math.abs(boundary - current)
    if (distance <= threshold && distance < bestDistance) {
      best = boundary
      bestDistance = distance
    }
  }
  return best === null || bestDistance <= BOUNDARY_EPSILON ? null : best
}
