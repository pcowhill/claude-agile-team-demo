/**
 * The output frame's size rule, shared by the export canvas and the preview
 * stage (#176). Overlay rectangles (#145), text overlay positions and sizes
 * (#139), and zoom centres (#64) are all stored as fractions of this frame,
 * so the two renderers must agree on its shape — the preview showed overlays
 * far from where the export composited them exactly because it resolved
 * those fractions against a stage whose shape was a layout accident (#171).
 * One pure rule both sides consume keeps them from drifting, the same
 * pattern that pins the transition renderers together (#66).
 */

export interface SourceDimensions {
  width: number
  height: number
}

/**
 * Frame size when no source reports usable dimensions (an all-slate
 * timeline, or nothing probed yet): the historical export fallback.
 */
export const FALLBACK_FRAME: SourceDimensions = { width: 640, height: 360 }

/**
 * The output frame: the largest source width and largest source height in
 * the sequence, taken independently, so no clip is ever downscaled —
 * differently-shaped clips letterbox into the frame. Sources that report a
 * zero dimension (nothing decoded) contribute nothing; slates have no
 * dimensions at all and are simply not passed in. Overlay video layers are
 * deliberately excluded by the callers: placement is fractional (#145), the
 * base sequence alone shapes the frame.
 */
export function outputFrameSize(sources: Iterable<SourceDimensions>): SourceDimensions {
  let width = 0
  let height = 0
  for (const source of sources) {
    if (source.width > 0 && source.height > 0) {
      width = Math.max(width, source.width)
      height = Math.max(height, source.height)
    }
  }
  if (width === 0 || height === 0) return { ...FALLBACK_FRAME }
  return { width, height }
}

/** The frame's aspect ratio (width ÷ height), for sizing the preview stage. */
export function frameAspect(frame: SourceDimensions): number {
  return frame.width / frame.height
}
