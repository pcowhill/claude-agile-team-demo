/**
 * Text overlays (#139): titles, subtitles, and labels drawn above the
 * composed video frame, as pure data and pure math. An overlay is anchored
 * to **sequence time** (offset + duration, exactly like an audio track's
 * window, #102): it covers both "title at the start" and "label during a
 * clip", and — the same decision as #102 — its offset is absolute and never
 * re-anchored or clamped by video edits, so shortening the sequence never
 * destructively retimes a title; an overlay whose window now lies past the
 * sequence's end simply never shows (playback stops at the sequence's end).
 *
 * This module owns the overlay types, the curated font list, validation and
 * clamping, and the visibility window; ownership, actions, and normalization
 * against the timeline live in `timeline.ts`, exactly as they do for time
 * remaps (#138).
 *
 * Position and size are resolution-independent: `x`/`y` are fractions of the
 * output frame (0..1, the overlay block's centre), and `size` is a fraction
 * of the frame's **height**, so the same overlay renders identically over a
 * 360p preview stage and a 4K export canvas (#142 is the export half).
 */

/** One curated font choice: an id stored in state/files, a UI label, and a
 * CSS stack of widely-available system fonts. No webfonts are involved, so
 * the preview's DOM rendering and a later canvas-based export (#142) resolve
 * the same stack to the same face. */
export interface TextFont {
  id: string
  label: string
  stack: string
}

/**
 * The curated font list (#139): system stacks present on every mainstream
 * platform, so what the customer sees is what every viewer gets. The ids are
 * what state and project files store; the stacks are what CSS and canvas
 * `font` strings consume.
 */
export const TEXT_FONTS = [
  { id: 'sans', label: 'Sans-serif', stack: 'Arial, Helvetica, sans-serif' },
  { id: 'serif', label: 'Serif', stack: 'Georgia, "Times New Roman", serif' },
  { id: 'mono', label: 'Monospace', stack: '"Courier New", Courier, monospace' },
  { id: 'display', label: 'Display', stack: 'Impact, "Arial Black", sans-serif' },
] as const satisfies readonly TextFont[]

export type TextFontId = (typeof TEXT_FONTS)[number]['id']

/** The CSS font-family stack for a stored font id. */
export function textFontStack(id: TextFontId): string {
  return (TEXT_FONTS.find((font) => font.id === id) as TextFont).stack
}

export function isTextFontId(value: string): value is TextFontId {
  return TEXT_FONTS.some((font) => font.id === value)
}

/**
 * Size bounds, as fractions of the frame height. The floor keeps a typo from
 * storing invisible text (which would read as "my title vanished"); the
 * ceiling is one full frame height for a single line — larger could never
 * fit the frame at all.
 */
export const MIN_TEXT_SIZE = 0.01
export const MAX_TEXT_SIZE = 1

/**
 * A text overlay's editable fields (#139). `content` may span multiple
 * lines (embedded newlines break lines; there is no automatic wrapping, so
 * rendering is deterministic and a canvas export can reproduce it line by
 * line).
 */
export interface TextOverlaySpec {
  /** The text shown. Multi-line via embedded newlines; never empty. */
  content: string
  /** Seconds into the composed timeline where the overlay appears. ≥ 0. */
  offset: number
  /** Seconds the overlay stays visible. > 0. */
  duration: number
  /** Centre of the overlay block, as a fraction of frame width (0..1). */
  x: number
  /** Centre of the overlay block, as a fraction of frame height (0..1). */
  y: number
  /** One of the curated font ids (TEXT_FONTS). */
  font: TextFontId
  /** Line height as a fraction of the frame height (MIN..MAX_TEXT_SIZE). */
  size: number
  /** Any 24-bit color as lowercase #rrggbb — the slate rule (#143). */
  color: string
  bold: boolean
  italic: boolean
}

/** A text overlay in the timeline state. The id is the edit handle. */
export type TextOverlay = TextOverlaySpec & { id: string }

/** What the "+ Text" control adds (#139): a centred white title. */
export const DEFAULT_TEXT: TextOverlaySpec = {
  content: 'Title',
  offset: 0,
  duration: 3,
  x: 0.5,
  y: 0.5,
  font: 'sans',
  size: 0.08,
  color: '#ffffff',
  bold: false,
  italic: false,
}

/** Lowercase #rrggbb — the one shape `<input type="color">` reads and
 * writes, matching the slate color rule (#143) so saved files never carry
 * the same color in two spellings. */
const TEXT_COLOR_PATTERN = /^#[0-9a-f]{6}$/

export function isValidTextColor(color: string): boolean {
  return TEXT_COLOR_PATTERN.test(color)
}

/**
 * Whether a spec is acceptable input at all: non-empty content, finite
 * numbers, a positive duration (a zero-length window is not an overlay,
 * mirroring the zero-duration transition rule), a known font, a storable
 * color, and boolean toggles. Out-of-range positions and sizes are not
 * rejected here — they clamp (see `clampTextOverlay`), like a zoom centre.
 */
export function isValidTextOverlaySpec(spec: TextOverlaySpec): boolean {
  return (
    typeof spec.content === 'string' &&
    spec.content !== '' &&
    Number.isFinite(spec.offset) &&
    Number.isFinite(spec.duration) &&
    spec.duration > 0 &&
    Number.isFinite(spec.x) &&
    Number.isFinite(spec.y) &&
    Number.isFinite(spec.size) &&
    isTextFontId(spec.font) &&
    isValidTextColor(spec.color) &&
    typeof spec.bold === 'boolean' &&
    typeof spec.italic === 'boolean'
  )
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/**
 * Clamps one overlay's continuous fields into their ranges: offset at 0 but
 * unbounded above (the allowed-tail decision — see the module comment),
 * centre within the frame, size within its bounds. Returns the same object
 * when nothing changes, so no-op edits are cheap to detect.
 */
export function clampTextOverlay(text: TextOverlay): TextOverlay {
  const offset = Math.max(0, text.offset)
  const x = clamp(text.x, 0, 1)
  const y = clamp(text.y, 0, 1)
  const size = clamp(text.size, MIN_TEXT_SIZE, MAX_TEXT_SIZE)
  if (offset === text.offset && x === text.x && y === text.y && size === text.size) return text
  return { ...text, offset, x, y, size }
}

export function textOverlaysEqual(a: TextOverlay, b: TextOverlay): boolean {
  return (
    a.id === b.id &&
    a.content === b.content &&
    a.offset === b.offset &&
    a.duration === b.duration &&
    a.x === b.x &&
    a.y === b.y &&
    a.font === b.font &&
    a.size === b.size &&
    a.color === b.color &&
    a.bold === b.bold &&
    a.italic === b.italic
  )
}

/**
 * Whether the overlay is visible at a sequence time. Half-open on the end —
 * at `offset + duration` the overlay has just disappeared — matching how an
 * audio track's window ends (#102/#103).
 */
export function textActiveAt(text: TextOverlay, sequenceTime: number): boolean {
  return sequenceTime >= text.offset && sequenceTime < text.offset + text.duration
}
