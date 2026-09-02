import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type {
  ColorAdjustments,
  ColorLook,
  RemapSpec,
  TextOverlaySpec,
  TimelineState,
  TransitionSpec,
  TransitionType,
  VideoOverlay,
  VideoOverlayPlacement,
  ZoomSpec,
} from '../lib/timeline'
import {
  COLOR_ADJUSTMENT_IDENTITY,
  COLOR_ADJUSTMENT_MAX,
  COLOR_ADJUSTMENT_MIN,
} from '../lib/colorAdjustments'
import type { Orientation } from '../lib/orientation'
import type { Crop } from '../lib/crop'
import {
  DEFAULT_TRANSITION_DURATION,
  audioTracksOf,
  boundaryTransitions,
  defaultZoomFor,
  effectiveDuration,
  entryOutputDuration,
  isSlateEntry,
  isStillEntry,
  remapsForEntry,
  remapsOf,
  textsOf,
  totalDuration,
  videoOverlaysOf,
  zoomsForEntry,
} from '../lib/timeline'
import { DEFAULT_DUCK_LEVEL } from '../lib/gain'
import { defaultPauseFor, defaultSpeedFor } from '../lib/remap'
import {
  DEFAULT_SUBTITLE_STYLE,
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
  subtitleStylesEqual,
  TEXT_FONTS,
} from '../lib/textOverlay'
import type { SubtitleStyle } from '../lib/textOverlay'
import { MIN_OVERLAY_SIZE } from '../lib/videoOverlay'
import type { TextFontId } from '../lib/textOverlay'
import { formatDuration } from '../lib/mediaLibrary'
import { AudioWaveform } from './AudioWaveform'
import { ClipThumbnail } from './ClipThumbnail'
import { ConfirmDialog } from './ConfirmDialog'
import './Timeline.css'

interface TimelineProps {
  timeline: TimelineState
  /** Whether an earlier state exists to undo to (#189). */
  canUndo: boolean
  /** Whether an undone state exists to redo to (#189). */
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onMoveEntry: (id: string, direction: 'up' | 'down') => void
  onRemoveEntry: (id: string) => void
  onTrimEntry: (id: string, inPoint: number, outPoint: number) => void
  /** Sets a still entry's on-screen duration (#140); stills have no trim. */
  onSetStillDuration: (id: string, duration: number) => void
  /** Appends a solid-color slate to the sequence (#143) — no import involved. */
  onAddSlate: () => void
  /** Sets a slate's fill color (#143), as lowercase #rrggbb from the picker. */
  onSetSlateColor: (id: string, color: string) => void
  onSetTransition: (beforeId: string, afterId: string, transition: TransitionSpec) => void
  onRemoveTransition: (beforeId: string, afterId: string) => void
  /** Adds a new zoom to the entry (#129); the id is the caller's to mint. */
  onAddZoom: (entryId: string, zoom: ZoomSpec) => void
  onUpdateZoom: (id: string, zoom: ZoomSpec) => void
  onRemoveZoom: (id: string) => void
  /** Adds a time-remap effect to the entry (#141); the id is the caller's to mint. */
  onAddRemap: (entryId: string, remap: RemapSpec) => void
  onUpdateRemap: (id: string, remap: RemapSpec) => void
  onRemoveRemap: (id: string) => void
  /** Adds a text overlay with the default spec (#139); the id is the caller's to mint. */
  onAddText: () => void
  /**
   * Imports an `.srt` subtitle file as text overlays (#249): parsing,
   * validation, dispatch, and failure reporting all live with the caller —
   * this component only surfaces the picker.
   */
  onImportSubtitles: (file: File) => void
  onUpdateText: (id: string, text: TextOverlaySpec) => void
  onRemoveText: (id: string) => void
  /**
   * The project's customized default subtitle style (#250); undefined means
   * the built-in default. Shown and edited by the controls beside the
   * subtitle import.
   */
  subtitleStyle: SubtitleStyle | undefined
  /** Sets the default subtitle style whole (#250); committing the built-in
   * default is the reset. */
  onSetSubtitleStyle: (style: SubtitleStyle) => void
  onUpdateVideoOverlay: (id: string, placement: VideoOverlayPlacement) => void
  onRemoveVideoOverlay: (id: string) => void
  onRemoveAudioTrack: (id: string) => void
  onRetimeAudioTrack: (id: string, offset: number) => void
  onTrimAudioTrack: (id: string, inPoint: number, outPoint: number) => void
  onSetEntryVolume: (id: string, volume: number) => void
  onSetEntryMuted: (id: string, muted: boolean) => void
  onSetEntryFades: (id: string, fadeIn: number, fadeOut: number) => void
  /** Sets a video/image entry's color adjustments whole (#192); `{}` resets. */
  onSetEntryColor: (id: string, adjustments: ColorAdjustments) => void
  onSetVideoOverlayColor: (id: string, adjustments: ColorAdjustments) => void
  /** Sets a video/image entry's orientation whole (#232); `{}` resets. */
  onSetEntryOrientation: (id: string, orientation: Orientation) => void
  onSetVideoOverlayOrientation: (id: string, orientation: Orientation) => void
  /** Sets a video/image entry's crop whole (#255); `{}` resets. */
  onSetEntryCrop: (id: string, crop: Crop) => void
  onSetVideoOverlayCrop: (id: string, crop: Crop) => void
  onSetAudioTrackVolume: (id: string, volume: number) => void
  onSetAudioTrackFades: (id: string, fadeIn: number, fadeOut: number) => void
  /**
   * Toggles ducking on an audio track (#241); `duckLevel` undefined keeps
   * the track's stored level (or the shared default when none is stored).
   */
  onSetAudioTrackDuck: (id: string, duck: boolean, duckLevel?: number) => void
}

/** A stored overlay re-expressed as the spec `onUpdateText` takes (no id). */
const textSpecOf = ({
  content,
  offset,
  duration,
  x,
  y,
  font,
  size,
  color,
  bold,
  italic,
  fadeIn,
  fadeOut,
  subtitle,
  styleOverrides,
}: TextOverlaySpec): TextOverlaySpec => ({
  content,
  offset,
  duration,
  x,
  y,
  font,
  size,
  color,
  bold,
  italic,
  ...(fadeIn === undefined ? {} : { fadeIn }),
  ...(fadeOut === undefined ? {} : { fadeOut }),
  // The subtitle-import marker (#249) rides along so edits never strip it;
  // so does the override record (#250) — the reducer recomputes it anyway.
  ...(subtitle === undefined ? {} : { subtitle }),
  ...(styleOverrides === undefined ? {} : { styleOverrides }),
})

interface TextContentFieldProps {
  label: string
  value: string
  onCommit: (value: string) => void
}

/**
 * Multi-line content editor for a text overlay (#139), committing on blur
 * like SecondsField: the draft is local so typing is free (Enter inserts a
 * newline rather than committing), and an empty commit is rejected by the
 * reducer, snapping the field back to the stored content.
 */
function TextContentField({ label, value, onCommit }: TextContentFieldProps) {
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    setDraft(value)
  }, [value])

  const commit = () => {
    if (draft !== value && draft !== '') onCommit(draft)
    // If the reducer rejected the commit, no prop change arrives — reset the
    // draft to the stored state explicitly.
    setDraft(value)
  }

  return (
    <textarea
      aria-label={label}
      rows={2}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
    />
  )
}

/** A stored overlay re-expressed as the placement `onUpdateVideoOverlay` takes. */
const overlayPlacementOf = ({
  offset,
  inPoint,
  outPoint,
  x,
  y,
  width,
  height,
  volume,
  muted,
  fadeIn,
  fadeOut,
}: VideoOverlay): VideoOverlayPlacement => ({
  offset,
  inPoint,
  outPoint,
  x,
  y,
  width,
  height,
  volume,
  muted,
  ...(fadeIn === undefined ? {} : { fadeIn }),
  ...(fadeOut === undefined ? {} : { fadeOut }),
})

/** A stored zoom re-expressed as the spec `onSetZoom` takes (no entryId). */
const zoomSpecOf = ({ start, rampIn, hold, rampOut, scale, centerX, centerY }: ZoomSpec): ZoomSpec => ({
  start,
  rampIn,
  hold,
  rampOut,
  scale,
  centerX,
  centerY,
})

const TRANSITION_TYPE_NAMES: Record<TransitionType, string> = {
  crossfade: 'Crossfade',
  'slide-from-above': 'Slide from above',
  'slide-from-below': 'Slide from below',
  'slide-from-left': 'Slide from left',
  'slide-from-right': 'Slide from right',
  'wipe-from-left': 'Wipe from left',
  'wipe-from-right': 'Wipe from right',
  'wipe-from-above': 'Wipe from above',
  'wipe-from-below': 'Wipe from below',
  'push-from-left': 'Push from left',
  'push-from-right': 'Push from right',
  'push-from-above': 'Push from above',
  'push-from-below': 'Push from below',
  'fade-through-black': 'Fade through black',
  'fade-through-white': 'Fade through white',
  'iris-open': 'Iris open',
  'iris-close': 'Iris close',
  'cross-zoom': 'Cross-zoom',
}

/** Seconds as a plain number string with at most two decimals, e.g. 1.25 → "1.25", 3 → "3". */
const formatSeconds = (seconds: number) => String(Math.round(seconds * 100) / 100)

interface SecondsFieldProps {
  label: string
  value: number
  max: number
  min?: number
  step?: number
  onCommit: (value: number) => void
}

/**
 * Numeric input (trim points, transition durations, zoom parameters) that
 * commits on blur/Enter. The draft is local so the user can type freely; the
 * committed value is validated — and possibly clamped — by the reducer, and
 * the field snaps back to (or shows) the stored state either way, so a
 * clamp is visible rather than silent.
 */
function SecondsField({ label, value, max, min = 0, step = 0.1, onCommit }: SecondsFieldProps) {
  const [draft, setDraft] = useState(() => formatSeconds(value))

  useEffect(() => {
    setDraft(formatSeconds(value))
  }, [value])

  const commit = () => {
    const parsed = Number(draft)
    if (draft.trim() !== '' && Number.isFinite(parsed) && parsed !== value) onCommit(parsed)
    // If the reducer rejected (or clamped to) the same value, no prop change
    // arrives — reset the draft to the current state explicitly.
    setDraft(formatSeconds(value))
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur()
  }

  return (
    <input
      type="number"
      inputMode="decimal"
      step={step}
      min={min}
      max={max}
      aria-label={label}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={handleKeyDown}
    />
  )
}

interface ColorAdjustmentControlsProps {
  /** The accessible name of the row's owner (entry or overlay). */
  position: string
  adjustments: ColorAdjustments | undefined
  /** Receives the full set on every edit; `{}` is the reset (#192). */
  onCommit: (adjustments: ColorAdjustments) => void
}

/**
 * Per-entry color controls (#192): the three percent dials, the one-click
 * looks, and a reset — one row in the per-entry-controls idiom, shared by
 * video/image sequence entries and video overlays (slates carry no
 * adjustments; their color is set directly, #143). Every edit commits the
 * full set; the reducer normalizes (identity fields drop away, so Reset —
 * committing `{}` — returns the entry to its stored-key-free identity).
 */
function ColorAdjustmentControls({ position, adjustments, onCommit }: ColorAdjustmentControlsProps) {
  const brightness = adjustments?.brightness ?? COLOR_ADJUSTMENT_IDENTITY
  const contrast = adjustments?.contrast ?? COLOR_ADJUSTMENT_IDENTITY
  const saturation = adjustments?.saturation ?? COLOR_ADJUSTMENT_IDENTITY
  const look = adjustments?.look
  const commit = (change: Partial<ColorAdjustments>) => {
    const next = { brightness, contrast, saturation, look, ...change }
    onCommit({
      brightness: next.brightness,
      contrast: next.contrast,
      saturation: next.saturation,
      ...(next.look === undefined ? {} : { look: next.look }),
    })
  }
  return (
    <div className="timeline-entry-color">
      <span>Color</span>
      <SecondsField
        label={`Brightness of ${position} (percent)`}
        value={brightness}
        min={COLOR_ADJUSTMENT_MIN}
        max={COLOR_ADJUSTMENT_MAX}
        step={5}
        onCommit={(value) => commit({ brightness: value })}
      />
      <span>contrast</span>
      <SecondsField
        label={`Contrast of ${position} (percent)`}
        value={contrast}
        min={COLOR_ADJUSTMENT_MIN}
        max={COLOR_ADJUSTMENT_MAX}
        step={5}
        onCommit={(value) => commit({ contrast: value })}
      />
      <span>saturation</span>
      <SecondsField
        label={`Saturation of ${position} (percent)`}
        value={saturation}
        min={COLOR_ADJUSTMENT_MIN}
        max={COLOR_ADJUSTMENT_MAX}
        step={5}
        onCommit={(value) => commit({ saturation: value })}
      />
      <span>%</span>
      <select
        aria-label={`Look of ${position}`}
        value={look ?? 'none'}
        onChange={(event) =>
          commit({ look: event.target.value === 'none' ? undefined : (event.target.value as ColorLook) })
        }
      >
        <option value="none">No look</option>
        <option value="grayscale">Grayscale</option>
        <option value="sepia">Sepia</option>
      </select>
      <button
        type="button"
        aria-label={`Reset color of ${position}`}
        disabled={adjustments === undefined}
        onClick={() => onCommit({})}
      >
        Reset
      </button>
    </div>
  )
}

interface OrientationControlsProps {
  /** The accessible name of the row's owner (entry or overlay). */
  position: string
  orientation: Orientation | undefined
  /** Receives the full orientation on every edit; `{}` is the reset (#232). */
  onCommit: (orientation: Orientation) => void
}

/**
 * Per-entry orientation controls (#232): a rotate button cycling the
 * quarter turns (0° → 90° → 180° → 270° → 0°), flip toggles, and a reset —
 * one row in the per-entry-controls idiom, shared by video/image sequence
 * entries and video overlays (slates carry no orientation; a flat color has
 * no sideways). Every edit commits the full orientation; the reducer
 * normalizes (identity fields drop away, so Reset — committing `{}` —
 * returns the item to its stored-key-free identity).
 */
function OrientationControls({ position, orientation, onCommit }: OrientationControlsProps) {
  const rotation = orientation?.rotation ?? 0
  const flipH = orientation?.flipH ?? false
  const flipV = orientation?.flipV ?? false
  const commit = (change: Orientation) => {
    const next = { rotation: orientation?.rotation, flipH, flipV, ...change }
    onCommit({
      ...(next.rotation === undefined ? {} : { rotation: next.rotation }),
      flipH: next.flipH,
      flipV: next.flipV,
    })
  }
  return (
    <div className="timeline-entry-color">
      <span>Orientation</span>
      <button
        type="button"
        aria-label={`Rotate ${position} 90 degrees clockwise (currently ${rotation} degrees)`}
        onClick={() => {
          const turned = (rotation + 90) % 360
          commit({ rotation: turned === 0 ? undefined : (turned as 90 | 180 | 270) })
        }}
      >
        Rotate {rotation}°
      </button>
      <label>
        <input
          type="checkbox"
          aria-label={`Flip ${position} horizontally`}
          checked={flipH}
          onChange={(event) => commit({ flipH: event.target.checked })}
        />
        Flip H
      </label>
      <label>
        <input
          type="checkbox"
          aria-label={`Flip ${position} vertically`}
          checked={flipV}
          onChange={(event) => commit({ flipV: event.target.checked })}
        />
        Flip V
      </label>
      <button
        type="button"
        aria-label={`Reset orientation of ${position}`}
        disabled={orientation === undefined}
        onClick={() => onCommit({})}
      >
        Reset
      </button>
    </div>
  )
}

interface CropControlsProps {
  /** The accessible name of the row's owner (entry or overlay). */
  position: string
  crop: Crop | undefined
  /** Receives the full crop on every edit; `{}` is the reset (#255). */
  onCommit: (crop: Crop) => void
}

/**
 * Per-entry crop controls (#255): a percent field per edge (the fraction
 * trimmed from that edge) and a reset — one row in the per-entry-controls
 * idiom, shared by video/image sequence entries and video overlays (slates
 * carry no crop; a flat color has nothing to trim). Every edit commits the
 * full crop; the reducer normalizes (zero fields drop away, deep pairs
 * clamp to the minimum kept fraction, and Reset — committing `{}` — returns
 * the item to its stored-key-free identity), and the fields snap back to
 * the stored state, so a clamp is visible rather than silent.
 */
function CropControls({ position, crop, onCommit }: CropControlsProps) {
  const percent = (value: number | undefined) => (value ?? 0) * 100
  const commit = (change: Partial<Record<keyof Crop, number>>) => {
    const next = {
      left: percent(crop?.left),
      right: percent(crop?.right),
      top: percent(crop?.top),
      bottom: percent(crop?.bottom),
      ...change,
    }
    onCommit({
      left: next.left / 100,
      right: next.right / 100,
      top: next.top / 100,
      bottom: next.bottom / 100,
    })
  }
  const field = (edge: keyof Crop, label: string) => (
    <SecondsField
      label={`Crop ${label} of ${position} (percent)`}
      value={percent(crop?.[edge])}
      min={0}
      max={90}
      step={5}
      onCommit={(value) => commit({ [edge]: value })}
    />
  )
  return (
    <div className="timeline-entry-color">
      <span>Crop</span>
      {field('left', 'left')}
      <span>right</span>
      {field('right', 'right')}
      <span>top</span>
      {field('top', 'top')}
      <span>bottom</span>
      {field('bottom', 'bottom')}
      <span>%</span>
      <button
        type="button"
        aria-label={`Reset crop of ${position}`}
        disabled={crop === undefined}
        onClick={() => onCommit({})}
      >
        Reset
      </button>
    </div>
  )
}

interface SubtitleStyleControlsProps {
  /** The stored default; undefined means the built-in subtitle default. */
  style: SubtitleStyle | undefined
  /** Receives the full style on every edit; the built-in default resets. */
  onCommit: (style: SubtitleStyle) => void
}

/**
 * The default-subtitle-style editor (#250), beside the subtitle import: the
 * text-overlay style surface (font, size, color, bold/italic, centre) for
 * the whole project's imported subtitles at once. Every edit commits the
 * full style; the reducer restyles every subtitle overlay's
 * non-individually-overridden fields and normalizes the stored default
 * (equal to the built-in default means no stored key — Reset commits
 * exactly that). Undoable like any timeline edit (#189).
 */
function SubtitleStyleControls({ style, onCommit }: SubtitleStyleControlsProps) {
  const effective = style ?? DEFAULT_SUBTITLE_STYLE
  const commit = (change: Partial<SubtitleStyle>) => onCommit({ ...effective, ...change })
  return (
    <div className="timeline-entry-color">
      <span>Subtitle style</span>
      <select
        aria-label="Default subtitle font"
        value={effective.font}
        onChange={(event) => commit({ font: event.target.value as TextFontId })}
      >
        {TEXT_FONTS.map((font) => (
          <option key={font.id} value={font.id}>
            {font.label}
          </option>
        ))}
      </select>
      <span>Size</span>
      <SecondsField
        label="Default subtitle size (fraction of frame height)"
        value={effective.size}
        min={MIN_TEXT_SIZE}
        max={MAX_TEXT_SIZE}
        step={0.01}
        onCommit={(size) => commit({ size })}
      />
      <input
        type="color"
        aria-label="Default subtitle color"
        value={effective.color}
        onChange={(event) => commit({ color: event.target.value })}
      />
      <label className="timeline-mute">
        <input
          type="checkbox"
          aria-label="Default subtitle bold"
          checked={effective.bold}
          onChange={(event) => commit({ bold: event.target.checked })}
        />
        Bold
      </label>
      <label className="timeline-mute">
        <input
          type="checkbox"
          aria-label="Default subtitle italic"
          checked={effective.italic}
          onChange={(event) => commit({ italic: event.target.checked })}
        />
        Italic
      </label>
      <span>centre</span>
      <SecondsField
        label="Default subtitle centre X (0 to 1)"
        value={effective.x}
        max={1}
        step={0.05}
        onCommit={(x) => commit({ x })}
      />
      <SecondsField
        label="Default subtitle centre Y (0 to 1)"
        value={effective.y}
        max={1}
        step={0.05}
        onCommit={(y) => commit({ y })}
      />
      <button
        type="button"
        aria-label="Reset default subtitle style"
        disabled={style === undefined || subtitleStylesEqual(style, DEFAULT_SUBTITLE_STYLE)}
        onClick={() => onCommit(DEFAULT_SUBTITLE_STYLE)}
      >
        Reset
      </button>
    </div>
  )
}

export function Timeline({
  timeline,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onMoveEntry,
  onRemoveEntry,
  onTrimEntry,
  onSetStillDuration,
  onAddSlate,
  onSetSlateColor,
  onSetTransition,
  onRemoveTransition,
  onAddZoom,
  onUpdateZoom,
  onRemoveZoom,
  onAddRemap,
  onUpdateRemap,
  onRemoveRemap,
  onAddText,
  subtitleStyle,
  onSetSubtitleStyle,
  onImportSubtitles,
  onUpdateText,
  onRemoveText,
  onUpdateVideoOverlay,
  onRemoveVideoOverlay,
  onRemoveAudioTrack,
  onRetimeAudioTrack,
  onTrimAudioTrack,
  onSetEntryVolume,
  onSetEntryMuted,
  onSetEntryFades,
  onSetEntryColor,
  onSetVideoOverlayColor,
  onSetEntryOrientation,
  onSetVideoOverlayOrientation,
  onSetEntryCrop,
  onSetVideoOverlayCrop,
  onSetAudioTrackVolume,
  onSetAudioTrackFades,
  onSetAudioTrackDuck,
}: TimelineProps) {
  const { entries } = timeline
  const transitions = boundaryTransitions(timeline)
  const audioTracks = audioTracksOf(timeline)
  const texts = textsOf(timeline)
  const videoOverlays = videoOverlaysOf(timeline)
  // The lane's visual scale is the video sequence duration — what preview
  // and export actually cover (#180, the customer's ask in #170). An item
  // running past the sequence end (an audio track's silent tail, a late
  // overlay or text) renders clamped to the end; one entirely past it (it
  // never plays) renders as a zero-width bar. With no sequence entries
  // nothing plays at all, so every bar is empty — the rows themselves stay.
  const laneSpan = totalDuration(timeline)
  const laneBar = (offset: number, length: number) => {
    const start = Math.min(Math.max(offset, 0), laneSpan)
    const end = Math.min(Math.max(offset + length, start), laneSpan)
    if (laneSpan <= 0 || end <= start) {
      // Zero-width means invisible: the bar's 2px minimum exists to keep
      // tiny playing items visible, and must not resurrect items that
      // never play.
      return { left: '0%', width: '0%', minWidth: 0 }
    }
    return {
      left: `${(start / laneSpan) * 100}%`,
      width: `${((end - start) / laneSpan) * 100}%`,
    }
  }
  // Where each entry's output interval begins (#180): the bar counterpart
  // of playback.ts's entryStartTime, off the already-normalized boundary
  // transitions — each overlap pulls the next entry's start earlier.
  const remaps = remapsOf(timeline)
  const entryStarts: number[] = []
  {
    let start = 0
    for (let index = 0; index < entries.length; index++) {
      entryStarts.push(start)
      start += entryOutputDuration(entries[index], remaps) - (transitions[index]?.duration ?? 0)
    }
  }

  // Removing an item asks first (#178): a mis-click must not silently cost
  // an edit. Only item removals confirm — sequence entries, audio tracks,
  // text overlays, overlay video layers; removing an *effect* (a zoom, a
  // remap, a transition) stays immediate, since re-adding one is cheap.
  // `name` heads the dialog; `consequence` says what goes with the item;
  // `action` fires the removal callback on confirm.
  // The subtitle import's hidden picker (#249), clicked by its toolbar
  // button — the same idiom as the media library's clip input.
  const subtitleInputRef = useRef<HTMLInputElement | null>(null)
  const [pendingRemoval, setPendingRemoval] = useState<{
    name: string
    consequence: string
    action: () => void
  } | null>(null)

  return (
    <section className="panel panel-wide" aria-label="Timeline">
      <div className="timeline-header">
        <h2>Timeline</h2>
        {/* Undo/redo (#189) act on the whole edit history, so they live on
            the timeline itself rather than any one item. The keyboard
            shortcuts (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y) are wired
            app-wide; the title advertises them. */}
        <button
          type="button"
          aria-label="Undo last timeline edit"
          title="Undo (Ctrl+Z)"
          disabled={!canUndo}
          onClick={onUndo}
        >
          ↺ Undo
        </button>
        <button
          type="button"
          aria-label="Redo timeline edit"
          title="Redo (Ctrl+Shift+Z)"
          disabled={!canRedo}
          onClick={onRedo}
        >
          ↻ Redo
        </button>
        {/* A slate needs no imported media (#143), so it is added right
            here rather than from the library. */}
        <button type="button" aria-label="Add color slate to timeline" onClick={onAddSlate}>
          + Color slate
        </button>
        {/* A text overlay is anchored to sequence time, not to any clip
            (#139), so it too is added here rather than per entry. */}
        <button type="button" aria-label="Add text overlay to timeline" onClick={onAddText}>
          + Text
        </button>
        {/* Subtitles are sequence-anchored text overlays (#249), so their
            import lives beside "+ Text" rather than in the media library. */}
        <button
          type="button"
          aria-label="Import subtitles from an SRT file"
          onClick={() => subtitleInputRef.current?.click()}
        >
          Import subtitles…
        </button>
        <input
          ref={subtitleInputRef}
          type="file"
          accept=".srt"
          hidden
          data-testid="subtitle-file-input"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file !== undefined) onImportSubtitles(file)
            // Allow re-importing the same file (e.g. after fixing it).
            event.target.value = ''
          }}
        />
        <span className="timeline-total">
          Total: <span data-testid="timeline-total">{formatDuration(totalDuration(timeline))}</span>
        </span>
      </div>

      {/* The default subtitle style (#250) lives beside the import it
          governs — editable before the first import (new cues take it) and
          any time after (all imported subtitles restyle at once). */}
      <SubtitleStyleControls style={subtitleStyle} onCommit={onSetSubtitleStyle} />

      {entries.length === 0 ? (
        <p className="placeholder">
          The sequence is empty. Add clips from the media library to start building your edit.
        </p>
      ) : (
        <ol className="timeline-list" aria-label="Sequence">
          {entries.map((entry, index) => {
            const position = `${entry.name} at position ${index + 1}`
            return (
              <li key={entry.id} className="timeline-entry">
                {/* Coverage at a glance (#180), like the audio lane's strip:
                    the entry's output interval against the sequence span.
                    Adjacent bars overlap exactly where transitions do. Kind
                    colors follow the media library's badges; a slate's bar
                    is its own color — the strip doubles as a swatch. */}
                <div className="audio-track-strip" aria-hidden="true">
                  <div
                    className={`audio-track-bar ${
                      isSlateEntry(entry)
                        ? 'timeline-entry-bar-slate'
                        : isStillEntry(entry)
                          ? 'timeline-entry-bar-image'
                          : 'timeline-entry-bar-video'
                    }`}
                    data-testid={`timeline-entry-bar-${index}`}
                    style={{
                      ...laneBar(entryStarts[index], entryOutputDuration(entry, remaps)),
                      ...(isSlateEntry(entry) ? { background: entry.color } : {}),
                    }}
                  >
                    {/* The clip's audio amplitude (#230), exactly the audio
                        lane's waveform (#191) — the decoder reads the audio
                        track out of the video container, and a soundless or
                        undecodable clip renders the plain bar. Stills and
                        slates have no audio to draw. */}
                    {!isStillEntry(entry) && (
                      <AudioWaveform
                        url={entry.url}
                        duration={entry.duration}
                        inPoint={entry.inPoint}
                        outPoint={entry.outPoint}
                        data-testid={`timeline-entry-waveform-${index}`}
                      />
                    )}
                  </div>
                </div>
                <div className="timeline-entry-main">
                  {/* A recognizable still per row (#193): videos get a
                      captured frame of their trimmed range, images show
                      themselves scaled, and a slate's color is its identity —
                      a swatch, no capture. All decorative; the name stays
                      the accessible identification. */}
                  {isSlateEntry(entry) ? (
                    <span
                      className="clip-thumbnail clip-thumbnail-swatch"
                      style={{ background: entry.color }}
                      aria-hidden="true"
                      data-testid={`timeline-entry-thumbnail-${index}`}
                    />
                  ) : isStillEntry(entry) ? (
                    <img
                      className="clip-thumbnail"
                      src={entry.url}
                      alt=""
                      aria-hidden="true"
                      data-testid={`timeline-entry-thumbnail-${index}`}
                    />
                  ) : (
                    <ClipThumbnail
                      url={entry.url}
                      inPoint={entry.inPoint}
                      data-testid={`timeline-entry-thumbnail-${index}`}
                    />
                  )}
                  <span className="clip-name" title={entry.name}>
                    {entry.name}
                  </span>
                  <span className="clip-duration">{formatDuration(effectiveDuration(entry))}</span>
                  <span className="timeline-entry-actions">
                    <button
                      type="button"
                      aria-label={`Move ${position} up`}
                      disabled={index === 0}
                      onClick={() => onMoveEntry(entry.id, 'up')}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${position} down`}
                      disabled={index === entries.length - 1}
                      onClick={() => onMoveEntry(entry.id, 'down')}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${position} from timeline`}
                      onClick={() =>
                        setPendingRemoval({
                          name: position,
                          consequence:
                            'Transitions at its boundaries and any zooms or time remapping on it are removed with it.',
                          action: () => onRemoveEntry(entry.id),
                        })
                      }
                    >
                      ✕
                    </button>
                  </span>
                </div>
                {isStillEntry(entry) ? (
                  /* A still has no source material (#140): no trim window to
                     edit, just the one duration, and no audio to control. A
                     slate (#143) adds its color, pickable in full 24-bit. */
                  <div className="timeline-entry-trim">
                    {isSlateEntry(entry) && (
                      <>
                        <span>Color</span>
                        <input
                          type="color"
                          aria-label={`Color of ${position}`}
                          value={entry.color}
                          onChange={(event) => onSetSlateColor(entry.id, event.target.value)}
                        />
                      </>
                    )}
                    <span>Shows for</span>
                    <SecondsField
                      label={`Duration of ${position} in seconds`}
                      value={effectiveDuration(entry)}
                      min={0.1}
                      max={86400}
                      onCommit={(duration) => onSetStillDuration(entry.id, duration)}
                    />
                    <span>s</span>
                  </div>
                ) : (
                  <>
                    <div className="timeline-entry-trim">
                      <span>In</span>
                      <SecondsField
                        label={`Trim in point of ${position} in seconds`}
                        value={entry.inPoint}
                        max={entry.duration}
                        onCommit={(inPoint) => onTrimEntry(entry.id, inPoint, entry.outPoint)}
                      />
                      <span>Out</span>
                      <SecondsField
                        label={`Trim out point of ${position} in seconds`}
                        value={entry.outPoint}
                        max={entry.duration}
                        onCommit={(outPoint) => onTrimEntry(entry.id, entry.inPoint, outPoint)}
                      />
                      <span className="timeline-entry-effective">
                        plays {formatSeconds(effectiveDuration(entry))}s of{' '}
                        {formatSeconds(entry.duration)}s
                        {/* Time-remap effects (#141) change what the entry
                            occupies in the sequence — say so where the trim
                            math is shown. */}
                        {entryOutputDuration(entry, remapsOf(timeline)) !==
                          effectiveDuration(entry) &&
                          ` — ${formatSeconds(entryOutputDuration(entry, remapsOf(timeline)))}s remapped`}
                      </span>
                    </div>
                    <div className="timeline-entry-audio">
                      <span>Volume</span>
                      <SecondsField
                        label={`Volume of ${position} (0 to 1)`}
                        value={entry.volume ?? 1}
                        max={1}
                        step={0.05}
                        onCommit={(volume) => onSetEntryVolume(entry.id, volume)}
                      />
                      <label className="timeline-mute">
                        <input
                          type="checkbox"
                          aria-label={`Mute ${position}`}
                          checked={entry.muted ?? false}
                          onChange={(event) => onSetEntryMuted(entry.id, event.target.checked)}
                        />
                        Mute
                      </label>
                      {/* Audio fades (#220), in the audio-track fade-fields
                          idiom (#104) — over the entry's output window, so
                          the max is the remapped duration when remaps exist. */}
                      <span>Fade in</span>
                      <SecondsField
                        label={`Audio fade-in of ${position} in seconds`}
                        value={entry.fadeIn ?? 0}
                        max={entryOutputDuration(entry, remapsOf(timeline))}
                        onCommit={(fadeIn) => onSetEntryFades(entry.id, fadeIn, entry.fadeOut ?? 0)}
                      />
                      <span>out</span>
                      <SecondsField
                        label={`Audio fade-out of ${position} in seconds`}
                        value={entry.fadeOut ?? 0}
                        max={entryOutputDuration(entry, remapsOf(timeline))}
                        onCommit={(fadeOut) => onSetEntryFades(entry.id, entry.fadeIn ?? 0, fadeOut)}
                      />
                    </div>
                  </>
                )}
                {/* Color adjustments (#192) apply to video and image entries;
                    a slate's color is set directly above (#143). */}
                {!isSlateEntry(entry) && (
                  <ColorAdjustmentControls
                    position={position}
                    adjustments={entry.colorAdjustments}
                    onCommit={(adjustments) => onSetEntryColor(entry.id, adjustments)}
                  />
                )}
                {/* Orientation (#232): video and image entries; a slate has
                    no sideways, exactly as it has no color adjustments. */}
                {!isSlateEntry(entry) && (
                  <OrientationControls
                    position={position}
                    orientation={entry.orientation}
                    onCommit={(orientation) => onSetEntryOrientation(entry.id, orientation)}
                  />
                )}
                {/* Crop (#255): video and image entries; a slate has nothing
                    to trim, exactly as it has no orientation. */}
                {!isSlateEntry(entry) && (
                  <CropControls
                    position={position}
                    crop={entry.crop}
                    onCommit={(crop) => onSetEntryCrop(entry.id, crop)}
                  />
                )}
                {(() => {
                  // An entry carries any number of non-overlapping zooms
                  // (#129), each independently editable; the accessible
                  // names number them per entry, in window (start) order —
                  // the order the normalized state stores them in.
                  const entryZooms = zoomsForEntry(timeline, entry.id)
                  const addable = defaultZoomFor(entryZooms, effectiveDuration(entry))
                  return (
                    <>
                      {entryZooms.map((entryZoom, zoomIndex) => {
                        const zoomName = `Zoom ${zoomIndex + 1}`
                        const set = (change: Partial<ZoomSpec>) =>
                          onUpdateZoom(entryZoom.id, { ...zoomSpecOf(entryZoom), ...change })
                        return (
                          <div key={entryZoom.id} className="timeline-entry-zoom">
                            <span>{zoomName} at</span>
                            <SecondsField
                              label={`${zoomName} start of ${position} in seconds`}
                              value={entryZoom.start}
                              max={effectiveDuration(entry)}
                              onCommit={(start) => set({ start })}
                            />
                            <span>in</span>
                            <SecondsField
                              label={`${zoomName} ramp-in of ${position} in seconds`}
                              value={entryZoom.rampIn}
                              max={effectiveDuration(entry)}
                              onCommit={(rampIn) => set({ rampIn })}
                            />
                            <span>hold</span>
                            <SecondsField
                              label={`${zoomName} hold of ${position} in seconds`}
                              value={entryZoom.hold}
                              max={effectiveDuration(entry)}
                              onCommit={(hold) => set({ hold })}
                            />
                            <span>out</span>
                            <SecondsField
                              label={`${zoomName} ramp-out of ${position} in seconds`}
                              value={entryZoom.rampOut}
                              max={effectiveDuration(entry)}
                              onCommit={(rampOut) => set({ rampOut })}
                            />
                            <span>×</span>
                            <SecondsField
                              label={`${zoomName} scale of ${position}`}
                              value={entryZoom.scale}
                              min={1}
                              max={10}
                              step={0.25}
                              onCommit={(scale) => set({ scale })}
                            />
                            <span>centre</span>
                            <SecondsField
                              label={`${zoomName} centre X of ${position} (0 to 1)`}
                              value={entryZoom.centerX}
                              max={1}
                              step={0.05}
                              onCommit={(centerX) => set({ centerX })}
                            />
                            <SecondsField
                              label={`${zoomName} centre Y of ${position} (0 to 1)`}
                              value={entryZoom.centerY}
                              max={1}
                              step={0.05}
                              onCommit={(centerY) => set({ centerY })}
                            />
                            <button
                              type="button"
                              aria-label={`Remove zoom ${zoomIndex + 1} from ${position}`}
                              onClick={() => onRemoveZoom(entryZoom.id)}
                            >
                              ✕
                            </button>
                          </div>
                        )
                      })}
                      <div className="timeline-entry-zoom">
                        <button
                          type="button"
                          className="timeline-zoom-add"
                          aria-label={`Add zoom to ${position}`}
                          disabled={addable === null}
                          onClick={() => addable !== null && onAddZoom(entry.id, addable)}
                        >
                          + Zoom
                        </button>
                      </div>
                    </>
                  )
                })()}
                {!isStillEntry(entry) &&
                  (() => {
                    // Time-remap effects (#141): speed segments and pauses,
                    // each independently editable like a zoom. Stills carry
                    // none — their one duration already sets their timing
                    // (#138). Accessible names number each kind separately,
                    // in window order — the order the normalized state
                    // stores them in.
                    const entryRemaps = remapsForEntry(timeline, entry.id)
                    const trimmed = effectiveDuration(entry)
                    const addableSpeed = defaultSpeedFor(entryRemaps, trimmed)
                    const addablePause = defaultPauseFor(entryRemaps, trimmed)
                    const kindIndex = (id: string, kind: RemapSpec['kind']) =>
                      entryRemaps.filter((effect) => effect.kind === kind).findIndex((effect) => effect.id === id) + 1
                    return (
                      <>
                        {entryRemaps.map((effect) =>
                          effect.kind === 'speed' ? (
                            (() => {
                              const name = `Speed segment ${kindIndex(effect.id, 'speed')}`
                              const set = (change: Partial<Omit<typeof effect, 'kind'>>) =>
                                onUpdateRemap(effect.id, {
                                  kind: 'speed',
                                  start: effect.start,
                                  end: effect.end,
                                  factor: effect.factor,
                                  ...change,
                                })
                              return (
                                <div key={effect.id} className="timeline-entry-remap">
                                  <span>{name} from</span>
                                  <SecondsField
                                    label={`${name} start of ${position} in seconds`}
                                    value={effect.start}
                                    max={trimmed}
                                    onCommit={(start) => set({ start })}
                                  />
                                  <span>to</span>
                                  <SecondsField
                                    label={`${name} end of ${position} in seconds`}
                                    value={effect.end}
                                    max={trimmed}
                                    onCommit={(end) => set({ end })}
                                  />
                                  <span>at</span>
                                  <SecondsField
                                    label={`${name} factor of ${position}`}
                                    value={effect.factor}
                                    min={0.05}
                                    max={10}
                                    step={0.25}
                                    onCommit={(factor) => set({ factor })}
                                  />
                                  <span>×</span>
                                  <button
                                    type="button"
                                    aria-label={`Remove speed segment ${kindIndex(effect.id, 'speed')} from ${position}`}
                                    onClick={() => onRemoveRemap(effect.id)}
                                  >
                                    ✕
                                  </button>
                                </div>
                              )
                            })()
                          ) : (
                            (() => {
                              const name = `Pause ${kindIndex(effect.id, 'pause')}`
                              return (
                                <div key={effect.id} className="timeline-entry-remap">
                                  <span>{name} at</span>
                                  <SecondsField
                                    label={`${name} position of ${position} in seconds`}
                                    value={effect.at}
                                    max={trimmed}
                                    onCommit={(at) =>
                                      onUpdateRemap(effect.id, { kind: 'pause', at, hold: effect.hold })
                                    }
                                  />
                                  <span>hold</span>
                                  <SecondsField
                                    label={`${name} hold of ${position} in seconds`}
                                    value={effect.hold}
                                    min={0.1}
                                    max={86400}
                                    onCommit={(hold) =>
                                      onUpdateRemap(effect.id, { kind: 'pause', at: effect.at, hold })
                                    }
                                  />
                                  <span>s</span>
                                  <button
                                    type="button"
                                    aria-label={`Remove pause ${kindIndex(effect.id, 'pause')} from ${position}`}
                                    onClick={() => onRemoveRemap(effect.id)}
                                  >
                                    ✕
                                  </button>
                                </div>
                              )
                            })()
                          ),
                        )}
                        <div className="timeline-entry-remap">
                          <button
                            type="button"
                            className="timeline-remap-add"
                            aria-label={`Add speed segment to ${position}`}
                            disabled={addableSpeed === null}
                            onClick={() => addableSpeed !== null && onAddRemap(entry.id, addableSpeed)}
                          >
                            + Speed
                          </button>
                          <button
                            type="button"
                            className="timeline-remap-add"
                            aria-label={`Add pause to ${position}`}
                            disabled={addablePause === null}
                            onClick={() => addablePause !== null && onAddRemap(entry.id, addablePause)}
                          >
                            + Pause
                          </button>
                        </div>
                      </>
                    )
                  })()}
                {index < entries.length - 1 &&
                  (() => {
                    const next = entries[index + 1]
                    const boundary = `between position ${index + 1} and ${index + 2}`
                    const transition = transitions[index]
                    return transition === undefined ? (
                      <div className="timeline-transition">
                        <button
                          type="button"
                          className="timeline-transition-add"
                          aria-label={`Add transition ${boundary}`}
                          onClick={() =>
                            onSetTransition(entry.id, next.id, {
                              type: 'crossfade',
                              duration: DEFAULT_TRANSITION_DURATION,
                            })
                          }
                        >
                          + Transition
                        </button>
                      </div>
                    ) : (
                      <div className="timeline-transition">
                        <select
                          aria-label={`Transition type ${boundary}`}
                          value={transition.type}
                          onChange={(event) =>
                            onSetTransition(entry.id, next.id, {
                              type: event.target.value as TransitionType,
                              duration: transition.duration,
                            })
                          }
                        >
                          {Object.entries(TRANSITION_TYPE_NAMES).map(([value, name]) => (
                            <option key={value} value={value}>
                              {name}
                            </option>
                          ))}
                        </select>
                        <SecondsField
                          label={`Transition duration ${boundary} in seconds`}
                          value={transition.duration}
                          max={Math.min(effectiveDuration(entry), effectiveDuration(next))}
                          onCommit={(duration) =>
                            onSetTransition(entry.id, next.id, {
                              type: transition.type,
                              duration,
                            })
                          }
                        />
                        <span>s</span>
                        <button
                          type="button"
                          aria-label={`Remove transition ${boundary}`}
                          onClick={() => onRemoveTransition(entry.id, next.id)}
                        >
                          ✕
                        </button>
                      </div>
                    )
                  })()}
              </li>
            )
          })}
        </ol>
      )}

      {audioTracks.length > 0 && (
        <div className="audio-lane">
          <h3 className="audio-lane-heading">Audio</h3>
          <ol className="audio-track-list" aria-label="Audio tracks">
            {audioTracks.map((track, index) => {
              const position = `audio track ${track.name} at position ${index + 1}`
              const trimmedLength = effectiveDuration(track)
              return (
                <li key={track.id} className="audio-track">
                  {/* Position/size at a glance; the numeric fields below are
                      the precise, accessible controls. */}
                  <div className="audio-track-strip" aria-hidden="true">
                    <div
                      className="audio-track-bar"
                      data-testid={`audio-track-bar-${index}`}
                      style={laneBar(track.offset, trimmedLength)}
                    >
                      <AudioWaveform
                        url={track.url}
                        duration={track.duration}
                        inPoint={track.inPoint}
                        outPoint={track.outPoint}
                        data-testid={`audio-track-waveform-${index}`}
                      />
                    </div>
                  </div>
                  <div className="audio-track-main">
                    <span className="clip-name" title={track.name}>
                      {track.name}
                    </span>
                    <span className="clip-duration">{formatDuration(trimmedLength)}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${position} from timeline`}
                      onClick={() =>
                        setPendingRemoval({
                          name: position,
                          consequence: 'The clip itself stays in the media library.',
                          action: () => onRemoveAudioTrack(track.id),
                        })
                      }
                    >
                      ✕
                    </button>
                  </div>
                  <div className="audio-track-controls">
                    <span>Starts at</span>
                    <SecondsField
                      label={`Start time of ${position} in seconds`}
                      value={track.offset}
                      // Not laneSpan: a track may start past the video
                      // sequence's end (silent tail, #102) even though its
                      // bar renders empty there (#180). Same free bound as
                      // overlay and text start times.
                      max={86400}
                      onCommit={(offset) => onRetimeAudioTrack(track.id, offset)}
                    />
                    <span>In</span>
                    <SecondsField
                      label={`Trim in point of ${position} in seconds`}
                      value={track.inPoint}
                      max={track.duration}
                      onCommit={(inPoint) => onTrimAudioTrack(track.id, inPoint, track.outPoint)}
                    />
                    <span>Out</span>
                    <SecondsField
                      label={`Trim out point of ${position} in seconds`}
                      value={track.outPoint}
                      max={track.duration}
                      onCommit={(outPoint) => onTrimAudioTrack(track.id, track.inPoint, outPoint)}
                    />
                    <span className="timeline-entry-effective">
                      plays {formatSeconds(trimmedLength)}s of {formatSeconds(track.duration)}s
                    </span>
                  </div>
                  <div className="audio-track-gain">
                    <span>Volume</span>
                    <SecondsField
                      label={`Volume of ${position} (0 to 1)`}
                      value={track.volume ?? 1}
                      max={1}
                      step={0.05}
                      onCommit={(volume) => onSetAudioTrackVolume(track.id, volume)}
                    />
                    <span>Fade in</span>
                    <SecondsField
                      label={`Fade-in of ${position} in seconds`}
                      value={track.fadeIn ?? 0}
                      max={trimmedLength}
                      onCommit={(fadeIn) =>
                        onSetAudioTrackFades(track.id, fadeIn, track.fadeOut ?? 0)
                      }
                    />
                    <span>out</span>
                    <SecondsField
                      label={`Fade-out of ${position} in seconds`}
                      value={track.fadeOut ?? 0}
                      max={trimmedLength}
                      onCommit={(fadeOut) =>
                        onSetAudioTrackFades(track.id, track.fadeIn ?? 0, fadeOut)
                      }
                    />
                    {/* Auto-ducking (#241): while this track plays, every
                        other sound source drops to the duck level. The level
                        field appears only while the toggle is on — absent
                        fields mean the shared default, like every gain
                        field. */}
                    <label className="timeline-mute">
                      <input
                        type="checkbox"
                        aria-label={`Duck other audio while ${position} plays`}
                        checked={track.duck ?? false}
                        onChange={(event) =>
                          onSetAudioTrackDuck(track.id, event.target.checked, track.duckLevel)
                        }
                      />
                      Duck others
                    </label>
                    {track.duck === true && (
                      <>
                        <span>to</span>
                        <SecondsField
                          label={`Duck level of ${position} (0 to 1)`}
                          value={track.duckLevel ?? DEFAULT_DUCK_LEVEL}
                          max={1}
                          step={0.05}
                          onCommit={(level) => onSetAudioTrackDuck(track.id, true, level)}
                        />
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        </div>
      )}

      {videoOverlays.length > 0 && (
        <div className="overlay-lane">
          <h3 className="overlay-lane-heading">Overlays</h3>
          <ol className="video-overlay-list" aria-label="Overlay video layers">
            {videoOverlays.map((overlay, index) => {
              const position = `overlay ${overlay.name} at position ${index + 1}`
              const trimmedLength = effectiveDuration(overlay)
              const set = (change: Partial<VideoOverlayPlacement>) =>
                onUpdateVideoOverlay(overlay.id, { ...overlayPlacementOf(overlay), ...change })
              return (
                <li key={overlay.id} className="video-overlay">
                  {/* Position/size at a glance, like the audio lane's strip;
                      the numeric fields below are the precise controls. */}
                  <div className="audio-track-strip" aria-hidden="true">
                    <div
                      className="audio-track-bar video-overlay-bar"
                      data-testid={`video-overlay-bar-${index}`}
                      style={laneBar(overlay.offset, trimmedLength)}
                    >
                      {/* Overlay clips are always video (#145): same audio
                          amplitude visual as the sequence entries (#230). */}
                      <AudioWaveform
                        url={overlay.url}
                        duration={overlay.duration}
                        inPoint={overlay.inPoint}
                        outPoint={overlay.outPoint}
                        data-testid={`video-overlay-waveform-${index}`}
                      />
                    </div>
                  </div>
                  <div className="video-overlay-main">
                    {/* Overlay rows are always video (#145) — captured
                        thumbnail like a sequence video entry (#193). */}
                    <ClipThumbnail
                      url={overlay.url}
                      inPoint={overlay.inPoint}
                      data-testid={`video-overlay-thumbnail-${index}`}
                    />
                    <span className="clip-name" title={overlay.name}>
                      {overlay.name}
                    </span>
                    <span className="clip-duration">{formatDuration(trimmedLength)}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${position} from timeline`}
                      onClick={() =>
                        setPendingRemoval({
                          name: position,
                          consequence: 'The clip itself stays in the media library.',
                          action: () => onRemoveVideoOverlay(overlay.id),
                        })
                      }
                    >
                      ✕
                    </button>
                  </div>
                  <div className="video-overlay-controls">
                    <span>Starts at</span>
                    <SecondsField
                      label={`Start time of ${position} in seconds`}
                      value={overlay.offset}
                      max={86400}
                      onCommit={(offset) => set({ offset })}
                    />
                    <span>In</span>
                    <SecondsField
                      label={`Trim in point of ${position} in seconds`}
                      value={overlay.inPoint}
                      max={overlay.duration}
                      onCommit={(inPoint) => set({ inPoint })}
                    />
                    <span>Out</span>
                    <SecondsField
                      label={`Trim out point of ${position} in seconds`}
                      value={overlay.outPoint}
                      max={overlay.duration}
                      onCommit={(outPoint) => set({ outPoint })}
                    />
                    <span className="timeline-entry-effective">
                      plays {formatSeconds(trimmedLength)}s of {formatSeconds(overlay.duration)}s
                    </span>
                  </div>
                  <div className="video-overlay-controls">
                    <span>Rect</span>
                    <SecondsField
                      label={`Left edge of ${position} (fraction of frame width)`}
                      value={overlay.x}
                      max={1}
                      step={0.05}
                      onCommit={(x) => set({ x })}
                    />
                    <SecondsField
                      label={`Top edge of ${position} (fraction of frame height)`}
                      value={overlay.y}
                      max={1}
                      step={0.05}
                      onCommit={(y) => set({ y })}
                    />
                    <span>size</span>
                    <SecondsField
                      label={`Width of ${position} (fraction of frame width)`}
                      value={overlay.width}
                      min={MIN_OVERLAY_SIZE}
                      max={1}
                      step={0.05}
                      onCommit={(width) => set({ width })}
                    />
                    <SecondsField
                      label={`Height of ${position} (fraction of frame height)`}
                      value={overlay.height}
                      min={MIN_OVERLAY_SIZE}
                      max={1}
                      step={0.05}
                      onCommit={(height) => set({ height })}
                    />
                    <span>Volume</span>
                    <SecondsField
                      label={`Volume of ${position} (0 to 1)`}
                      value={overlay.volume ?? 1}
                      max={1}
                      step={0.05}
                      onCommit={(volume) => set({ volume })}
                    />
                    <label className="timeline-mute">
                      <input
                        type="checkbox"
                        aria-label={`Mute ${position}`}
                        checked={overlay.muted ?? false}
                        onChange={(event) => set({ muted: event.target.checked })}
                      />
                      Mute
                    </label>
                    {/* Audio fades (#220), in the audio-track fade-fields
                        idiom (#104), over the overlay's trimmed window. */}
                    <span>Fade in</span>
                    <SecondsField
                      label={`Audio fade-in of ${position} in seconds`}
                      value={overlay.fadeIn ?? 0}
                      max={trimmedLength}
                      onCommit={(fadeIn) => set({ fadeIn })}
                    />
                    <span>out</span>
                    <SecondsField
                      label={`Audio fade-out of ${position} in seconds`}
                      value={overlay.fadeOut ?? 0}
                      max={trimmedLength}
                      onCommit={(fadeOut) => set({ fadeOut })}
                    />
                  </div>
                  {/* Color adjustments (#192), exactly as on a sequence entry. */}
                  <ColorAdjustmentControls
                    position={position}
                    adjustments={overlay.colorAdjustments}
                    onCommit={(adjustments) => onSetVideoOverlayColor(overlay.id, adjustments)}
                  />
                  {/* Orientation (#232), exactly as on a sequence entry. */}
                  <OrientationControls
                    position={position}
                    orientation={overlay.orientation}
                    onCommit={(orientation) => onSetVideoOverlayOrientation(overlay.id, orientation)}
                  />
                  {/* Crop (#255), exactly as on a sequence entry. */}
                  <CropControls
                    position={position}
                    crop={overlay.crop}
                    onCommit={(crop) => onSetVideoOverlayCrop(overlay.id, crop)}
                  />
                </li>
              )
            })}
          </ol>
        </div>
      )}

      {texts.length > 0 && (
        <div className="text-lane">
          <h3 className="text-lane-heading">Text</h3>
          <ol className="text-overlay-list" aria-label="Text overlays">
            {texts.map((text, index) => {
              const position = `text overlay at position ${index + 1}`
              const set = (change: Partial<TextOverlaySpec>) =>
                onUpdateText(text.id, { ...textSpecOf(text), ...change })
              return (
                <li key={text.id} className="text-overlay">
                  {/* Coverage at a glance (#180): the overlay's window
                      against the sequence span, like every other lane. */}
                  <div className="audio-track-strip" aria-hidden="true">
                    <div
                      className="audio-track-bar text-overlay-bar"
                      data-testid={`text-overlay-bar-${index}`}
                      style={laneBar(text.offset, text.duration)}
                    />
                  </div>
                  <div className="text-overlay-main">
                    <TextContentField
                      label={`Content of ${position}`}
                      value={text.content}
                      onCommit={(content) => set({ content })}
                    />
                    <button
                      type="button"
                      aria-label={`Remove ${position} from timeline`}
                      onClick={() =>
                        setPendingRemoval({
                          name: position,
                          consequence: 'Its text content is discarded.',
                          action: () => onRemoveText(text.id),
                        })
                      }
                    >
                      ✕
                    </button>
                  </div>
                  <div className="text-overlay-controls">
                    <span>Shows at</span>
                    <SecondsField
                      label={`Start time of ${position} in seconds`}
                      value={text.offset}
                      max={86400}
                      onCommit={(offset) => set({ offset })}
                    />
                    <span>for</span>
                    <SecondsField
                      label={`Duration of ${position} in seconds`}
                      value={text.duration}
                      min={0.1}
                      max={86400}
                      onCommit={(duration) => set({ duration })}
                    />
                    <span>s, centre</span>
                    <SecondsField
                      label={`Centre X of ${position} (0 to 1)`}
                      value={text.x}
                      max={1}
                      step={0.05}
                      onCommit={(x) => set({ x })}
                    />
                    <SecondsField
                      label={`Centre Y of ${position} (0 to 1)`}
                      value={text.y}
                      max={1}
                      step={0.05}
                      onCommit={(y) => set({ y })}
                    />
                    <span>Fade in</span>
                    <SecondsField
                      label={`Fade-in of ${position} in seconds`}
                      value={text.fadeIn ?? 0}
                      max={text.duration}
                      onCommit={(fadeIn) => set({ fadeIn })}
                    />
                    <span>out</span>
                    <SecondsField
                      label={`Fade-out of ${position} in seconds`}
                      value={text.fadeOut ?? 0}
                      max={text.duration}
                      onCommit={(fadeOut) => set({ fadeOut })}
                    />
                  </div>
                  <div className="text-overlay-controls">
                    <select
                      aria-label={`Font of ${position}`}
                      value={text.font}
                      onChange={(event) => set({ font: event.target.value as TextFontId })}
                    >
                      {TEXT_FONTS.map((font) => (
                        <option key={font.id} value={font.id}>
                          {font.label}
                        </option>
                      ))}
                    </select>
                    <span>Size</span>
                    <SecondsField
                      label={`Size of ${position} (fraction of frame height)`}
                      value={text.size}
                      min={MIN_TEXT_SIZE}
                      max={MAX_TEXT_SIZE}
                      step={0.01}
                      onCommit={(size) => set({ size })}
                    />
                    <input
                      type="color"
                      aria-label={`Color of ${position}`}
                      value={text.color}
                      onChange={(event) => set({ color: event.target.value })}
                    />
                    <label className="timeline-mute">
                      <input
                        type="checkbox"
                        aria-label={`Bold ${position}`}
                        checked={text.bold}
                        onChange={(event) => set({ bold: event.target.checked })}
                      />
                      Bold
                    </label>
                    <label className="timeline-mute">
                      <input
                        type="checkbox"
                        aria-label={`Italic ${position}`}
                        checked={text.italic}
                        onChange={(event) => set({ italic: event.target.checked })}
                      />
                      Italic
                    </label>
                  </div>
                </li>
              )
            })}
          </ol>
        </div>
      )}

      {pendingRemoval && (
        <ConfirmDialog
          title={`Remove ${pendingRemoval.name}?`}
          body={pendingRemoval.consequence}
          confirmLabel="Remove"
          onCancel={() => setPendingRemoval(null)}
          onConfirm={() => {
            pendingRemoval.action()
            setPendingRemoval(null)
          }}
        />
      )}
    </section>
  )
}
