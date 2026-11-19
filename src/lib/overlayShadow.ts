/**
 * A drop shadow under an overlay (#698): a soft, offset copy of the
 * overlay's silhouette in one colour, drawn beneath it, so the overlay reads
 * as lifted off the picture below.
 *
 * The shadow is cast by the overlay's **silhouette**: the placed rectangle,
 * or the ellipse or rounded rectangle its shape mask (#266) cuts it to, grown
 * by its border (#697) when it has one. It is not cast by the picture's own
 * alpha. It is kept only **outside** that silhouette, as a CSS `box-shadow`
 * is. A letterboxed picture, or a still with transparent areas, never shows
 * shadow through its own rectangle. Both renderers draw it with one routine
 * (`drawOverlayShadow` in exportVideo.ts, which the preview calls on a
 * frame-sized canvas), so they cannot disagree.
 *
 * Blur and offsets are fractions of the output frame's shorter side, as a
 * border's thickness is (#697, after #683), so the shadow keeps its look at
 * every export size; the row shows them in px at the current output frame.
 */

/** The stored shadow: absent (no key at all) means none. */
export interface OverlayShadow {
  /** `#rrggbb`. */
  color: string
  /** 0 (invisible) to 1 (solid). */
  opacity: number
  /** A fraction of the output frame's shorter side, in [0, MAX_OVERLAY_SHADOW_BLUR]. */
  blur: number
  /** Rightward offset, a fraction of the shorter side; negative falls left. */
  offsetX: number
  /** Downward offset, a fraction of the shorter side; negative falls up. */
  offsetY: number
}

/** The widest blur: a tenth of the frame's shorter side, the border's limit. */
export const MAX_OVERLAY_SHADOW_BLUR = 0.1

/** The farthest offset on either axis, in either direction: a tenth of the shorter side. */
export const MAX_OVERLAY_SHADOW_OFFSET = 0.1

/** The colour a shadow starts in (#698). */
export const DEFAULT_OVERLAY_SHADOW_COLOR = '#000000'

/** The opacity a shadow starts at (#698). */
export const DEFAULT_OVERLAY_SHADOW_OPACITY = 0.5

/** The blur, in output pixels, a shadow starts at: soft but still close to the overlay. */
export const DEFAULT_OVERLAY_SHADOW_BLUR_PX = 8

/** The offset, in output pixels on each axis, a shadow starts at: down and to the right. */
export const DEFAULT_OVERLAY_SHADOW_OFFSET_PX = 6

const HEX_COLOR = /^#[0-9a-f]{6}$/i

/** Whether an edit is acceptable input at all: a `#rrggbb` colour and finite numbers. */
export function isValidOverlayShadowInput(shadow: OverlayShadow): boolean {
  return (
    HEX_COLOR.test(shadow.color) &&
    Number.isFinite(shadow.opacity) &&
    Number.isFinite(shadow.blur) &&
    Number.isFinite(shadow.offsetX) &&
    Number.isFinite(shadow.offsetY)
  )
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/**
 * The canonical stored form: opacity clamps into [0, 1], blur into [0,
 * MAX_OVERLAY_SHADOW_BLUR], each offset into ±MAX_OVERLAY_SHADOW_OFFSET,
 * and the colour is stored lower-case so one colour is never stored two
 * ways. Unlike a border, a shadow is never cleared by a value: turning it
 * off is its own edit (a `null` shadow), because a shadow at blur 0 and
 * offset 0 is still a choice the row should keep showing.
 */
export function normalizeOverlayShadow(shadow: OverlayShadow): OverlayShadow {
  return {
    color: shadow.color.toLowerCase(),
    opacity: clamp(shadow.opacity, 0, 1),
    blur: clamp(shadow.blur, 0, MAX_OVERLAY_SHADOW_BLUR),
    offsetX: clamp(shadow.offsetX, -MAX_OVERLAY_SHADOW_OFFSET, MAX_OVERLAY_SHADOW_OFFSET),
    offsetY: clamp(shadow.offsetY, -MAX_OVERLAY_SHADOW_OFFSET, MAX_OVERLAY_SHADOW_OFFSET),
  }
}

/** Structural equality over stored (normalized) shadows. */
export function overlayShadowsEqual(
  a: OverlayShadow | undefined,
  b: OverlayShadow | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b
  return (
    a.color === b.color &&
    a.opacity === b.opacity &&
    a.blur === b.blur &&
    a.offsetX === b.offsetX &&
    a.offsetY === b.offsetY
  )
}

/** `#rrggbb` at an opacity, as the `rgba()` a canvas shadow colour takes. */
export function shadowRgba(color: string, opacity: number): string {
  const value = Number.parseInt(color.slice(1), 16)
  const r = (value >> 16) & 0xff
  const g = (value >> 8) & 0xff
  const b = value & 0xff
  return `rgba(${r}, ${g}, ${b}, ${clamp(opacity, 0, 1)})`
}
