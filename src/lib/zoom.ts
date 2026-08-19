import type { TimelineState } from './timeline'
import { zoomForEntry } from './timeline'

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
  const zoom = zoomForEntry(state, entry.id)
  if (!zoom) return IDENTITY_ZOOM

  const t = sourceTime - entry.inPoint - zoom.start
  const total = zoom.rampIn + zoom.hold + zoom.rampOut
  let g: number
  if (t < 0 || t > total) {
    g = 0
  } else if (t < zoom.rampIn) {
    g = smoothstep(t / zoom.rampIn)
  } else if (t <= zoom.rampIn + zoom.hold) {
    // A zero rampIn lands here at t = 0: the zoom starts at full, by request.
    g = 1
  } else {
    g = smoothstep((total - t) / zoom.rampOut)
  }
  if (g === 0) return IDENTITY_ZOOM
  return {
    scale: 1 + (zoom.scale - 1) * g,
    centerX: 0.5 + (zoom.centerX - 0.5) * g,
    centerY: 0.5 + (zoom.centerY - 0.5) * g,
  }
}
