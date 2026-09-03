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

/**
 * The project's canvas preset (#273): a fixed output-frame aspect, chosen by
 * the customer rather than inherited from the sources. `undefined` — never a
 * `'auto'` identifier, so the absent-as-default rule (#192/#232/#255/#259)
 * keeps preset-free states and files byte-identical — means Auto, the
 * source-derived rule above.
 */
export type CanvasPreset = '16:9' | '9:16' | '1:1' | '4:5'

export interface CanvasPresetOption {
  id: CanvasPreset
  /** The control's option text. */
  label: string
  /** The aspect as a reduced integer ratio, which `presetFrame` multiplies. */
  ratioWidth: number
  ratioHeight: number
}

/** The offered presets, in the order the control lists them. */
export const CANVAS_PRESETS: readonly CanvasPresetOption[] = [
  { id: '16:9', label: 'Landscape 16:9', ratioWidth: 16, ratioHeight: 9 },
  { id: '9:16', label: 'Portrait 9:16', ratioWidth: 9, ratioHeight: 16 },
  { id: '1:1', label: 'Square 1:1', ratioWidth: 1, ratioHeight: 1 },
  { id: '4:5', label: 'Portrait 4:5', ratioWidth: 4, ratioHeight: 5 },
]

/** Whether a value names one of the presets — the serializer's guard (#273). */
export function isCanvasPreset(value: unknown): value is CanvasPreset {
  return CANVAS_PRESETS.some((preset) => preset.id === value)
}

/**
 * The source-derived frame reshaped to a preset's aspect: the **smallest
 * frame of exactly that aspect that contains** it.
 *
 * Containing rather than fitting is what preserves the #176 property this
 * rule exists for — no clip is ever forced to downscale. A landscape source
 * in a 9:16 project therefore yields a tall frame with the clip letterboxed
 * across it, which is exactly the shape the bars that background fill (#259)
 * exists to treat.
 *
 * "Exactly that aspect" and whole pixels cannot both hold for an arbitrary
 * scale, so the frame is an integer multiple of the preset's reduced ratio:
 * the smallest multiple that covers both dimensions. A source already at the
 * preset's aspect comes back unchanged (its size *is* such a multiple), so
 * choosing the preset a project already has is not a resize.
 */
export function presetFrame(frame: SourceDimensions, preset: CanvasPreset): SourceDimensions {
  const option = CANVAS_PRESETS.find(({ id }) => id === preset)
  // Unreachable through the type, but the serializer's refusals and this
  // guard are what keep an unknown identifier from silently reshaping a
  // project's frame.
  if (option === undefined) return { ...frame }
  const multiple = Math.max(
    Math.ceil(frame.width / option.ratioWidth),
    Math.ceil(frame.height / option.ratioHeight),
  )
  return { width: option.ratioWidth * multiple, height: option.ratioHeight * multiple }
}

/**
 * The output frame the renderers use: the source-derived size (#176)
 * composed with the project's canvas preset (#273). The single seam the two
 * renderers share — Auto is `outputFrameSize` unchanged, byte for byte.
 */
export function canvasFrameSize(
  sources: Iterable<SourceDimensions>,
  preset?: CanvasPreset,
): SourceDimensions {
  const derived = outputFrameSize(sources)
  return preset === undefined ? derived : presetFrame(derived, preset)
}
