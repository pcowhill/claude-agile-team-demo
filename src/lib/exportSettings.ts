import type { SourceDimensions } from './frameSize'
import { canvasFrameSize } from './frameSize'
import { EXPORT_FRAME_RATE } from './exportVideo'
import { orientedDimensions } from './orientation'
import { croppedDimensions } from './crop'
import type { TimelineState } from './timeline'
import { isSlateEntry, isStillEntry } from './timeline'

/**
 * Export settings shown in the export modal (#179): the output frame and
 * frame rate, pre-filled with the automatic values and editable directly or
 * via named presets. Settings apply to one export only — nothing here is
 * persisted, per the originating feedback (#169).
 */

export interface ExportSettings {
  width: number
  height: number
  frameRate: number
}

export interface ExportSizePreset {
  id: string
  label: string
  width: number
  height: number
}

/**
 * One-click common output sizes (#179). "Auto (match sources)" is not a
 * preset — it is the absence of an override, so the export keeps deriving
 * the frame from the sources exactly as before.
 */
export const EXPORT_SIZE_PRESETS: readonly ExportSizePreset[] = [
  { id: 'web', label: 'Web 854×480', width: 854, height: 480 },
  { id: 'hd', label: 'HD 1280×720', width: 1280, height: 720 },
  { id: 'fullhd', label: 'Full HD 1920×1080', width: 1920, height: 1080 },
  { id: 'uhd', label: '4K UHD 3840×2160', width: 3840, height: 2160 },
]

/**
 * Dimension bounds: wide enough for anything a browser encoder plausibly
 * records (8K wide), tight enough to reject typos that would allocate absurd
 * canvases. Dimensions are whole pixels — a canvas has no fractional size.
 */
export const MIN_EXPORT_DIMENSION = 16
export const MAX_EXPORT_DIMENSION = 7680

/** Frame-rate bounds; the default stays EXPORT_FRAME_RATE (30). */
export const MAX_EXPORT_FRAME_RATE = 120

export function isValidExportDimension(value: number): boolean {
  return (
    Number.isInteger(value) && value >= MIN_EXPORT_DIMENSION && value <= MAX_EXPORT_DIMENSION
  )
}

export function isValidExportFrameRate(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= MAX_EXPORT_FRAME_RATE
}

export function isValidExportSettings(settings: ExportSettings): boolean {
  return (
    isValidExportDimension(settings.width) &&
    isValidExportDimension(settings.height) &&
    isValidExportFrameRate(settings.frameRate)
  )
}

/** The settings the automatic behavior would use for the given frame. */
export function automaticSettings(frame: SourceDimensions): ExportSettings {
  return { width: frame.width, height: frame.height, frameRate: EXPORT_FRAME_RATE }
}

/**
 * The output frame the automatic rule would pick for the current timeline —
 * what the modal pre-fills (#179). Probes each distinct non-slate source's
 * dimensions from its (in-memory) blob metadata, then applies the same
 * `canvasFrameSize` rule the export and preview stage (#176/#273) use — per
 * *entry*, cropped (#255/#256) then oriented (#232/#233), composed with the
 * project's canvas preset (#274): a cropped entry contributes its kept
 * region, a quarter-turned entry swapped dimensions, and a fixed preset
 * reshapes the result, so the shown values match the frame the export
 * derives. Sources that fail to probe contribute nothing, exactly as in the
 * export's own sizing pass; with nothing probed the fallback frame comes
 * back — reshaped by the preset the same way.
 */
export function automaticExportFrame(timeline: TimelineState): Promise<SourceDimensions> {
  const targets: { url: string; still: boolean }[] = []
  const seen = new Set<string>()
  for (const entry of timeline.entries) {
    if (isSlateEntry(entry) || seen.has(entry.url)) continue
    seen.add(entry.url)
    targets.push({ url: entry.url, still: isStillEntry(entry) })
  }
  const probes = targets.map(
    ({ url, still }) =>
      new Promise<SourceDimensions | null>((resolve) => {
        if (still) {
          const probe = new Image()
          probe.onload = () => resolve({ width: probe.naturalWidth, height: probe.naturalHeight })
          probe.onerror = () => resolve(null)
          probe.src = url
        } else {
          const probe = document.createElement('video')
          probe.preload = 'metadata'
          probe.addEventListener(
            'loadedmetadata',
            () => resolve({ width: probe.videoWidth, height: probe.videoHeight }),
            { once: true },
          )
          probe.addEventListener('error', () => resolve(null), { once: true })
          probe.src = url
        }
      }),
  )
  return Promise.all(probes).then((dims) => {
    const byUrl = new Map(targets.map((target, index) => [target.url, dims[index]]))
    return canvasFrameSize(
      timeline.entries.flatMap((entry) => {
        if (isSlateEntry(entry)) return []
        const dim = byUrl.get(entry.url)
        return dim == null
          ? []
          : [orientedDimensions(croppedDimensions(dim, entry.crop), entry.orientation)]
      }),
      timeline.canvasPreset,
    )
  })
}
