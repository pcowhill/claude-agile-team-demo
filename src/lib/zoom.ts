import type { TimelineState, ZoomEffect } from './timeline'
import { zoomsForEntry } from './timeline'

/**
 * The zoom in effect at one moment of one entry (#63). `scale` is the
 * magnification (1 = no zoom); `centerX`/`centerY` are the centre of the
 * visible region as fractions of the frame. The visible region is the frame
 * divided by `scale` on both axes, so its aspect ratio always equals the
 * frame's.
 */
export interface ZoomState {
  scale: number
  centerX: number
  centerY: number
}

export const IDENTITY_ZOOM: ZoomState = { scale: 1, centerX: 0.5, centerY: 0.5 }

/**
 * Ease-in-out (smoothstep): 0 → 1 over u ∈ [0, 1] with zero slope at both
 * ends, so a ramp neither jerks when it starts nor when it settles — the
 * customer explicitly asked for smooth (#58). Clamped outside [0, 1].
 */
export function smoothstep(u: number): number {
  const t = Math.min(Math.max(u, 0), 1)
  return t * t * (3 - 2 * t)
}

/**
 * The zoom state of `entries[entryIndex]` at `sourceTime` (the entry's
 * source-clip clock, as a <video> element reports it — the same convention
 * the playback and export loops use). Identity outside the zoom window;
 * inside it, both the scale and the centre are interpolated by the eased
 * ramp fraction `g`:
 *
 *   scale(g)  = 1 + (zoom.scale − 1)·g
 *   centre(g) = 0.5 + (zoom.centre − 0.5)·g
 *
 * Interpolating the centre through the SAME `g` keeps the visible region
 * inside the frame at every instant: the region extends 1 / (2·scale(g))
 * from centre(g), and since the reducer clamps the full-zoom centre to
 * |centre − 0.5| ≤ (1 − 1/S) / 2, the mid-ramp offset g·(1 − 1/S)/2 never
 * exceeds the mid-ramp allowance (1 − 1/scale(g))/2 for any g ∈ [0, 1].
 */
export function zoomAt(state: TimelineState, entryIndex: number, sourceTime: number): ZoomState {
  const entry = state.entries[entryIndex]
  if (!entry) return IDENTITY_ZOOM
  // The entry may carry several zooms (#129); normalization keeps their
  // windows non-overlapping, so at most one is mid-ramp or holding at any
  // moment. Where two windows touch, the instant belongs to whichever
  // engages first in list (start) order — a measure-zero boundary.
  for (const zoom of zoomsForEntry(state, entry.id)) {
    const t = sourceTime - entry.inPoint - zoom.start
    if (rampFraction(zoom, t) > 0) return zoomStateAt(zoom, t)
  }
  return IDENTITY_ZOOM
}

/**
 * One zoom's state at `t` seconds into its own window, with no timeline
 * around it (#421). The visual editor draws the region the zoom occupies at
 * the instant its scrub slider names, and the spec it draws may be mid-drag
 * and so not in the timeline at all — but the easing must be the one the
 * preview and the export use, not a second copy of it. So `zoomAt` above is
 * this function plus the search for which zoom is engaged, and the editor
 * calls it directly.
 */
export function zoomStateAt(zoom: ZoomSpecLike, t: number): ZoomState {
  const g = rampFraction(zoom, t)
  if (g <= 0) return IDENTITY_ZOOM
  return {
    scale: 1 + (zoom.scale - 1) * g,
    centerX: 0.5 + (zoom.centerX - 0.5) * g,
    centerY: 0.5 + (zoom.centerY - 0.5) * g,
  }
}

/**
 * The eased ramp fraction g of one zoom at `t` seconds into its window: 0
 * outside it, 1 across the hold, smoothstepped through each ramp. Exported
 * because the editor needs to know when it is showing the zoom at full —
 * the only instants at which dragging the region has a stored meaning
 * (#421).
 */
export function zoomRampFraction(zoom: ZoomSpecLike, t: number): number {
  return rampFraction(zoom, t)
}

/** What the two above need of a zoom: its ramps and its full-zoom values. */
type ZoomSpecLike = Pick<
  ZoomEffect,
  'rampIn' | 'hold' | 'rampOut' | 'scale' | 'centerX' | 'centerY'
>

/** The eased ramp fraction g of one zoom at `t` seconds into its window. */
function rampFraction(zoom: Pick<ZoomEffect, 'rampIn' | 'hold' | 'rampOut'>, t: number): number {
  const total = zoom.rampIn + zoom.hold + zoom.rampOut
  if (t < 0 || t > total) return 0
  if (t < zoom.rampIn) return smoothstep(t / zoom.rampIn)
  // A zero rampIn lands here at t = 0: the zoom starts at full, by request.
  if (t <= zoom.rampIn + zoom.hold) return 1
  return smoothstep((total - t) / zoom.rampOut)
}
