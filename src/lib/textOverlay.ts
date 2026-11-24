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
 * This module owns the overlay types, the font registry (#859), validation and
 * clamping, and the visibility window; ownership, actions, and normalization
 * against the timeline live in `timeline.ts`, exactly as they do for time
 * remaps (#138).
 *
 * Position and size are resolution-independent: `x`/`y` are fractions of the
 * output frame (0..1, the overlay block's centre), and `size` is a fraction
 * of the frame's **height**, so the same overlay renders identically over a
 * 360p preview stage and a 4K export canvas (#142 is the export half).
 */

/** One font choice: an id stored in state/files, a UI label, and a CSS
 * stack. The core fonts are stacks of widely-available system fonts, so the
 * preview's DOM rendering and the canvas export (#142) resolve the same
 * stack to the same face with nothing to load; a plugin's font may carry a
 * `load` the export waits for (see `TextFontDefinition`). */
export interface TextFont {
  id: string
  label: string
  stack: string
}

/**
 * A font as the font registry holds it (#859): what a Font menu lists and
 * both renderers resolve. Built for the Font pack plugin (#856, part 2), and
 * shaped like the transition registry's definitions (#199, ADR 0003).
 */
export interface TextFontDefinition extends TextFont {
  /**
   * Makes the face available to the canvas, for a font that is not a system
   * stack — a webfont the plugin ships, typically through `FontFace` and
   * `document.fonts`. The export awaits it before drawing its first frame
   * (`loadTextFonts`), because a canvas `fillText` with a face that has not
   * loaded silently draws the stack's fallback instead. Absent for the core
   * fonts, which are system stacks and need nothing. May be called more
   * than once (once per export); a loader that has already loaded resolves
   * at once.
   */
  load?: () => Promise<void>
}

/**
 * The core fonts (#139): system stacks present on every mainstream
 * platform, so what the customer sees is what every viewer gets. The ids are
 * what state and project files store; the stacks are what CSS and canvas
 * `font` strings consume. They register into `fontRegistry` at startup, in
 * this order, which is Font-menu order; every reader goes through the
 * registry, so a plugin's font sits beside them (#859).
 */
export const CORE_TEXT_FONTS = [
  { id: 'sans', label: 'Sans-serif', stack: 'Arial, Helvetica, sans-serif' },
  { id: 'serif', label: 'Serif', stack: 'Georgia, "Times New Roman", serif' },
  { id: 'mono', label: 'Monospace', stack: '"Courier New", Courier, monospace' },
  { id: 'display', label: 'Display', stack: 'Impact, "Arial Black", sans-serif' },
] as const satisfies readonly TextFont[]

/**
 * A font id. A plain string since #859: plugins register fonts at runtime,
 * so the set is open, and validity is a registry question (`fontRegistry`),
 * not a type-level one, exactly as transition types became strings in #199.
 */
export type TextFontId = string

/**
 * The stack an id with no registered font renders in (#859): the core
 * sans-serif. Text keeps its stored id when the plugin that provided its
 * font is disabled (the #197 disable semantics tear down contributions, not
 * user edits), and the renderers must still draw it legibly.
 */
export const FALLBACK_TEXT_FONT_STACK: string = CORE_TEXT_FONTS[0].stack

/**
 * Registry of fonts, in registration order (which is Font-menu order). The
 * app uses the `fontRegistry` singleton; tests construct their own. Mirrors
 * the transition registry (#199): `register`/`unregister` are how a
 * plugin's fonts arrive and leave, and `subscribe` + `version` pair with
 * React's `useSyncExternalStore` so the Font menus re-read the registry
 * when plugins change it at runtime.
 */
export class FontRegistry {
  private readonly definitions = new Map<string, TextFontDefinition>()
  private readonly listeners = new Set<() => void>()
  /** Monotonic change counter — the snapshot for `useSyncExternalStore`. */
  version = 0

  /** Adds a font. A duplicate id is a programming error and throws. */
  register(definition: TextFontDefinition): void {
    if (this.definitions.has(definition.id)) {
      throw new Error(`Font '${definition.id}' is already registered.`)
    }
    this.definitions.set(definition.id, definition)
    this.notify()
  }

  /**
   * Removes a font — how a disabled plugin's fonts leave the Font menus.
   * Removing an id that is not registered is a no-op: a plugin's deactivate
   * must stay safe whatever order teardown runs in.
   */
  unregister(id: string): void {
    if (this.definitions.delete(id)) this.notify()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    this.version++
    for (const listener of this.listeners) listener()
  }

  has(id: string): boolean {
    return this.definitions.has(id)
  }

  /** The definition for `id`, or undefined for an unregistered id — the
   * renderers fall back rather than throw (see `textFontStack`). */
  find(id: string): TextFontDefinition | undefined {
    return this.definitions.get(id)
  }

  /** All registered definitions, in registration order. */
  list(): TextFontDefinition[] {
    return [...this.definitions.values()]
  }
}

/**
 * Registers the core fonts in `CORE_TEXT_FONTS` order, so the Font menus
 * list them exactly as they always have. Exported so registry tests can
 * populate fresh instances; the app uses the singleton registration below.
 */
export function registerCoreFonts(registry: FontRegistry): void {
  for (const font of CORE_TEXT_FONTS) registry.register({ ...font })
}

/** The app's registry. The core fonts register into it at startup. */
export const fontRegistry = new FontRegistry()
registerCoreFonts(fontRegistry)

/** The CSS font-family stack for a stored font id: the registered font's,
 * or the core sans-serif for an id no registered font covers. */
export function textFontStack(id: TextFontId, registry: FontRegistry = fontRegistry): string {
  return registry.find(id)?.stack ?? FALLBACK_TEXT_FONT_STACK
}

/** Whether a registered font has this id — the open flow's check, once the
 * file's plugins are settled (`unregisteredTextFonts`). */
export function isTextFontId(value: string, registry: FontRegistry = fontRegistry): boolean {
  return registry.has(value)
}

/**
 * The font ids in `ids` that no registered font covers — what the
 * project-open flow checks *after* plugin dependencies are settled (#859,
 * as #199 does for transition types): an id still unknown then is either a
 * corrupt file or one saved by a newer build, and opening it would silently
 * render the fallback.
 */
export function unregisteredTextFonts(
  ids: Iterable<string>,
  registry: FontRegistry = fontRegistry,
): string[] {
  return [...new Set(ids)].filter((id) => !registry.has(id))
}

/**
 * Makes every font in `ids` that has a loader available, and settles when
 * all have loaded (#859): the export awaits it before its first frame. Ids
 * with no registered font, or whose font needs no loading (the core
 * fonts), contribute nothing, so with only core fonts it settles at once.
 */
export async function loadTextFonts(
  ids: Iterable<string>,
  registry: FontRegistry = fontRegistry,
): Promise<void> {
  const loads: Promise<void>[] = []
  for (const id of new Set(ids)) {
    const load = registry.find(id)?.load
    if (load !== undefined) loads.push(load())
  }
  await Promise.all(loads)
}

/**
 * Whether a font id is acceptable in timeline state: any non-empty string.
 * Whether it is *registered* is deliberately not asked here (#859): text
 * keeps its id after its plugin is disabled, and must stay editable —
 * moving or retyping it re-validates the whole spec, font included. The
 * Font menus offer only registered fonts, and the open flow refuses a file
 * naming an unknown one (`unregisteredTextFonts`).
 */
function isStoredTextFontId(value: unknown): boolean {
  return typeof value === 'string' && value !== ''
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
  /** A font id (`fontRegistry`); one no registered font covers renders in
   * the fallback stack (#859). */
  font: TextFontId
  /** Line height as a fraction of the frame height (MIN..MAX_TEXT_SIZE). */
  size: number
  /** Any 24-bit color as lowercase #rrggbb — the slate rule (#143). */
  color: string
  bold: boolean
  italic: boolean
  /**
   * Fade durations in seconds (#177): opacity ramps 0→1 over the first
   * `fadeIn` seconds of the window and 1→0 over the last `fadeOut` seconds.
   * Absent means no fade — today's instant appearance. Clamping keeps the
   * pair within the overlay's duration (see `clampTextOverlay`), the same
   * rule audio-track fades follow (#104).
   */
  fadeIn?: number
  fadeOut?: number
  /**
   * Subtitle-import provenance (#249): `true` on overlays created by the
   * SRT import, absent on hand-made ones — the persisted marker the default
   * subtitle style (#250) targets. Absent-as-default like every
   * optional field, so subtitle-free projects are unchanged; the marker
   * says where the overlay came from and changes nothing about how it
   * renders or edits.
   */
  subtitle?: boolean
  /**
   * Which style fields this subtitle overlay owns individually (#250):
   * present only on `subtitle: true` overlays the user has restyled by
   * hand, listing the fields (in `SUBTITLE_STYLE_FIELDS` order, no
   * duplicates) that a later default-subtitle-style edit must leave alone —
   * the overlay's other style fields keep following the default. Absent
   * means the overlay follows the default entirely; hand-made overlays
   * never carry the key (the default never touches them at all).
   */
  styleOverrides?: SubtitleStyleField[]
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

/**
 * Line height, as a multiple of the type size, shared by every renderer of
 * an overlay: `.preview-text` in PreviewPlayer.css mirrors this value (CSS
 * cannot import it), and the export's canvas draw (#142) consumes it
 * directly. The two must agree, or a multi-line block would occupy a
 * different height in the exported file than in the preview.
 */
export const TEXT_LINE_HEIGHT = 1.2

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
    isStoredTextFontId(spec.font) &&
    isValidTextColor(spec.color) &&
    typeof spec.bold === 'boolean' &&
    typeof spec.italic === 'boolean' &&
    (spec.fadeIn === undefined || Number.isFinite(spec.fadeIn)) &&
    (spec.fadeOut === undefined || Number.isFinite(spec.fadeOut)) &&
    (spec.subtitle === undefined || typeof spec.subtitle === 'boolean') &&
    // Style overrides (#250) only mean anything on a subtitle overlay, and
    // must name known style fields with no repeats.
    (spec.styleOverrides === undefined ||
      (spec.subtitle === true &&
        Array.isArray(spec.styleOverrides) &&
        spec.styleOverrides.every((field) => (SUBTITLE_STYLE_FIELDS as readonly string[]).includes(field)) &&
        new Set(spec.styleOverrides).size === spec.styleOverrides.length))
  )
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/**
 * Clamps one overlay's continuous fields into their ranges: offset at 0 but
 * unbounded above (the allowed-tail decision — see the module comment),
 * centre within the frame, size within its bounds, and fades (#177)
 * non-negative with the pair never exceeding the duration — `fadeIn` keeps
 * its value first and `fadeOut` absorbs the shortfall, the audio-track fade
 * rule (#104). Returns the same object when nothing changes, so no-op edits
 * are cheap to detect.
 */
export function clampTextOverlay(text: TextOverlay): TextOverlay {
  const offset = Math.max(0, text.offset)
  const x = clamp(text.x, 0, 1)
  const y = clamp(text.y, 0, 1)
  const size = clamp(text.size, MIN_TEXT_SIZE, MAX_TEXT_SIZE)
  const fadeIn = clamp(text.fadeIn ?? 0, 0, text.duration)
  const fadeOut = clamp(text.fadeOut ?? 0, 0, text.duration - fadeIn)
  if (
    offset === text.offset &&
    x === text.x &&
    y === text.y &&
    size === text.size &&
    fadeIn === (text.fadeIn ?? 0) &&
    fadeOut === (text.fadeOut ?? 0)
  ) {
    return text
  }
  return { ...text, offset, x, y, size, fadeIn, fadeOut }
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
    a.italic === b.italic &&
    (a.fadeIn ?? 0) === (b.fadeIn ?? 0) &&
    (a.fadeOut ?? 0) === (b.fadeOut ?? 0) &&
    (a.subtitle ?? false) === (b.subtitle ?? false) &&
    // Overrides are stored normalized (canonical order, no repeats — see
    // normalizeStyleOverrides), so positional comparison is equality.
    (a.styleOverrides ?? []).length === (b.styleOverrides ?? []).length &&
    (a.styleOverrides ?? []).every((field, index) => field === (b.styleOverrides ?? [])[index])
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

/**
 * The overlay's opacity at a sequence time (#177): 0 outside the window,
 * otherwise the fade envelope — linear 0→1 over the first `fadeIn` seconds
 * and 1→0 over the last `fadeOut` seconds, taking the minimum where ramps
 * meet, exactly the audio-track envelope shape (`audioTrackGainAt`, #104).
 * The single source of truth for both renderers: the preview sets it as the
 * element's CSS opacity and the export as the canvas globalAlpha (#66
 * pattern), so a fade cannot render differently in the two.
 */
export function textOpacityAt(text: TextOverlay, sequenceTime: number): number {
  if (!textActiveAt(text, sequenceTime)) return 0
  const into = sequenceTime - text.offset
  const fadeIn = text.fadeIn ?? 0
  const fadeOut = text.fadeOut ?? 0
  const inRamp = fadeIn > 0 ? Math.min(into / fadeIn, 1) : 1
  const outRamp = fadeOut > 0 ? Math.min((text.duration - into) / fadeOut, 1) : 1
  return Math.min(inRamp, outRamp)
}

/**
 * The default subtitle style (#250): the style fields the SRT import (#249)
 * stamps on every cue, editable per project so all imported subtitles
 * restyle at once. Subtitle overlays keep **storing their effective style
 * in their own fields** — editing the default rewrites the non-overridden
 * fields of every `subtitle: true` overlay (see `applySubtitleStyle`), so
 * the preview and export render restyled subtitles through the existing
 * text draw path with zero new rendering code. Timing (`offset`/`duration`)
 * and `content` come from the cue, never from the style; fades are not
 * part of the subtitle look either.
 */

/** The style fields the default subtitle style governs, in canonical
 * (stored) order — position, then type, then color and emphasis. */
export const SUBTITLE_STYLE_FIELDS = [
  'x',
  'y',
  'font',
  'size',
  'color',
  'bold',
  'italic',
] as const

export type SubtitleStyleField = (typeof SUBTITLE_STYLE_FIELDS)[number]

/** The default subtitle style's shape: exactly the text-overlay style
 * surface, every field present (the *stored project default* may be absent
 * as a whole — absent means this built-in default — but a style value is
 * always complete). */
export type SubtitleStyle = Pick<TextOverlaySpec, SubtitleStyleField>

/**
 * The built-in subtitle style (#249): bottom-center, a readable caption
 * size, white sans-serif — what every imported cue starts as, and what a
 * project's stored default is measured against (a stored default equal to
 * this normalizes to no key at all, keeping style-free projects
 * byte-identical).
 */
export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  x: 0.5,
  y: 0.9,
  font: 'sans',
  size: 0.05,
  color: '#ffffff',
  bold: false,
  italic: false,
}

/** Whether a style is acceptable input at all — the text-overlay rule over
 * just the style fields. Out-of-range positions and sizes clamp
 * (`clampSubtitleStyle`), like the overlay's own. */
export function isValidSubtitleStyle(style: SubtitleStyle): boolean {
  return (
    Number.isFinite(style.x) &&
    Number.isFinite(style.y) &&
    Number.isFinite(style.size) &&
    isStoredTextFontId(style.font) &&
    isValidTextColor(style.color) &&
    typeof style.bold === 'boolean' &&
    typeof style.italic === 'boolean'
  )
}

/** Clamps the style's continuous fields exactly as `clampTextOverlay`
 * clamps an overlay's: centre within the frame, size within its bounds.
 * Returns the same object when nothing changes. */
export function clampSubtitleStyle(style: SubtitleStyle): SubtitleStyle {
  const x = clamp(style.x, 0, 1)
  const y = clamp(style.y, 0, 1)
  const size = clamp(style.size, MIN_TEXT_SIZE, MAX_TEXT_SIZE)
  if (x === style.x && y === style.y && size === style.size) return style
  return { ...style, x, y, size }
}

export function subtitleStylesEqual(a: SubtitleStyle, b: SubtitleStyle): boolean {
  return SUBTITLE_STYLE_FIELDS.every((field) => a[field] === b[field])
}

/**
 * The canonical stored form of a project's default subtitle style (#250):
 * clamped, and `undefined` — no key at all — when equal to the built-in
 * default, so never-customized projects stay byte-identical to earlier
 * output (the #192/#232/#255 absent-as-default rule).
 */
export function normalizeSubtitleStyle(style: SubtitleStyle): SubtitleStyle | undefined {
  const clamped = clampSubtitleStyle(style)
  if (subtitleStylesEqual(clamped, DEFAULT_SUBTITLE_STYLE)) return undefined
  return {
    x: clamped.x,
    y: clamped.y,
    font: clamped.font,
    size: clamped.size,
    color: clamped.color,
    bold: clamped.bold,
    italic: clamped.italic,
  }
}

/**
 * The canonical stored form of an overlay's override list: unique fields in
 * `SUBTITLE_STYLE_FIELDS` order, `undefined` — no key — when empty, so the
 * same override set is never stored two ways.
 */
export function normalizeStyleOverrides(
  fields: readonly SubtitleStyleField[],
): SubtitleStyleField[] | undefined {
  const present = new Set(fields)
  if (present.size === 0) return undefined
  return SUBTITLE_STYLE_FIELDS.filter((field) => present.has(field))
}

/** The style fields whose values differ between two specs — what a
 * `text-updated` edit on a subtitle overlay marks as overridden (#250). */
export function changedStyleFields(
  a: Pick<TextOverlaySpec, SubtitleStyleField>,
  b: Pick<TextOverlaySpec, SubtitleStyleField>,
): SubtitleStyleField[] {
  return SUBTITLE_STYLE_FIELDS.filter((field) => a[field] !== b[field])
}

/**
 * One subtitle overlay after a default-style edit (#250): every style field
 * the overlay has not individually overridden takes the new default's
 * value; overridden fields — and everything that is not style (content,
 * timing, fades, provenance) — stay untouched. Returns the same object when
 * nothing changes, so a no-op restyle is free.
 */
export function applySubtitleStyle(text: TextOverlay, style: SubtitleStyle): TextOverlay {
  const overridden = new Set(text.styleOverrides ?? [])
  const changed = SUBTITLE_STYLE_FIELDS.filter(
    (field) => !overridden.has(field) && text[field] !== style[field],
  )
  if (changed.length === 0) return text
  const next = { ...text }
  for (const field of changed) {
    // Field-by-field so overridden values survive verbatim; the loop only
    // ever writes a style field with that same field's value.
    ;(next as Record<SubtitleStyleField, SubtitleStyle[SubtitleStyleField]>)[field] = style[field]
  }
  return next
}
