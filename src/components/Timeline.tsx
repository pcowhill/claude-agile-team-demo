import { Fragment, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'
import type {
  ColorAdjustments,
  ColorLook,
  RemapSpec,
  TextOverlaySpec,
  TimelineState,
  TransitionSpec,
  TransitionType,
  VideoOverlay,
  ImageOverlayPlacement,
  OverlayPlacement,
  VideoOverlayPlacement,
  ZoomSpec,
} from '../lib/timeline'
import {
  COLOR_ADJUSTMENT_IDENTITY,
  COLOR_ADJUSTMENT_MAX,
  COLOR_ADJUSTMENT_MIN,
} from '../lib/colorAdjustments'
import { MAX_VOLUME } from '../lib/volume'
import type { Orientation } from '../lib/orientation'
import type { Crop } from '../lib/crop'
import type { CropSubject } from '../lib/frameEditor'
import { DEFAULT_FILL_COLOR } from '../lib/backgroundFill'
import type { BackgroundFill, BackgroundFillInput } from '../lib/backgroundFill'
import { DEFAULT_ROUNDED_RADIUS, MAX_ROUNDED_RADIUS } from '../lib/shapeMask'
import type { RedactionRegion, RedactionStyle } from '../lib/redaction'
import {
  DEFAULT_BLUR_STRENGTH,
  DEFAULT_PIXELATE_BLOCK,
  DEFAULT_REDACTION_COLOR,
  DEFAULT_REDACTION_STYLE,
  DEFAULT_REGION_RECT,
  MAX_REDACTION_STRENGTH,
  MIN_WINDOW_SECONDS,
} from '../lib/redaction'
import type { SpotlightRegion, SpotlightShape } from '../lib/spotlight'
import {
  DEFAULT_SPOTLIGHT_DIM,
  DEFAULT_SPOTLIGHT_RECT,
  DEFAULT_SPOTLIGHT_SHAPE,
  MAX_SPOTLIGHT_SOFTEN,
  softenOf,
} from '../lib/spotlight'
import type { ShapeMask, ShapeMaskInput } from '../lib/shapeMask'
import type { OverlayBorder } from '../lib/overlayBorder'
import {
  DEFAULT_OVERLAY_BORDER_COLOR,
  DEFAULT_OVERLAY_BORDER_PX,
  MAX_OVERLAY_BORDER,
} from '../lib/overlayBorder'
import type { OverlayShadow } from '../lib/overlayShadow'
import {
  DEFAULT_OVERLAY_SHADOW_BLUR_PX,
  DEFAULT_OVERLAY_SHADOW_COLOR,
  DEFAULT_OVERLAY_SHADOW_OFFSET_PX,
  DEFAULT_OVERLAY_SHADOW_OPACITY,
  MAX_OVERLAY_SHADOW_BLUR,
  MAX_OVERLAY_SHADOW_OFFSET,
} from '../lib/overlayShadow'
import {
  DEFAULT_TRANSITION_DURATION,
  audioTracksOf,
  boundaryTransitions,
  defaultZoomFor,
  effectiveDuration,
  entryOutputDuration,
  isSlateEntry,
  isImageOverlay,
  isStillEntry,
  remapsForEntry,
  remapsOf,
  shapeGroupsOf,
  textsOf,
  totalDuration,
  videoOverlaysOf,
  zoomsForEntry,
} from '../lib/timeline'
import { DEFAULT_DUCK_LEVEL } from '../lib/gain'
import { transitionRegistry } from '../lib/transitionRender'
import { defaultPauseFor, defaultSpeedFor } from '../lib/remap'
import {
  DEFAULT_SUBTITLE_STYLE,
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
  subtitleStylesEqual,
  TEXT_FONTS,
} from '../lib/textOverlay'
import type { SubtitleStyle } from '../lib/textOverlay'
import { MIN_OVERLAY_SIZE, overlayOutputDuration } from '../lib/videoOverlay'
import type {
  ArrowHeads,
  ArrowHeadSize,
  ArrowShape,
  BadgeShape,
  BoxShape,
  LineStyle,
  Shape,
  ShapeGroup,
  ShapeGroupSpec,
  ShapeKind,
} from '../lib/shapes'
import {
  ARROW_HEAD_LABELS,
  ARROW_HEAD_SIZE_LABELS,
  ARROW_HEAD_SIZES,
  ARROW_HEADS,
  defaultShape,
  isInvisibleShape,
  LINE_STYLE_LABELS,
  LINE_STYLES,
  MAX_BADGE_NUMBER,
  MAX_BADGE_SIZE,
  MAX_CORNER_RADIUS,
  MAX_SHAPE_THICKNESS,
  MIN_BADGE_SIZE,
  MIN_SHAPE_SIZE,
  newBadge,
  SHAPE_KIND_LABELS,
  SHAPE_KINDS,
  shapeGroupName,
  shorterSideFraction,
  shorterSidePixels,
  styleForNextShape,
  withLineStyle,
} from '../lib/shapes'
import type { TextFontId } from '../lib/textOverlay'
import {
  SETTINGS_GROUPS,
  compatibleSettingsGroups,
  copyElementSettings,
  filterSettings,
  heldSettingsGroups,
} from '../lib/settingsClipboard'
import type {
  CopiedSettings,
  SettingsElementKind,
  SettingsGroup,
} from '../lib/settingsClipboard'
import { CANVAS_PRESETS } from '../lib/frameSize'
import type { CanvasPreset } from '../lib/frameSize'
import { formatDuration } from '../lib/mediaLibrary'
import { AudioWaveform } from './AudioWaveform'
import { ClipThumbnail } from './ClipThumbnail'
import { ConfirmDialog } from './ConfirmDialog'
// The visual editors are lazy chunks (#537): see visualEditors.tsx.
import {
  CropEditor,
  OverlayEditor,
  RedactionEditor,
  ShapeEditor,
  SpotlightEditor,
  TextEditor,
  ZoomEditor,
} from './visualEditors'
import { Menu } from './Menu'
import type { MenuItem } from './Menu'
import { NameField } from './NameField'
import { TrimDialog } from './TrimDialog'
import { DEFAULT_SETTINGS } from '../lib/settings'
import './Timeline.css'
// PasteSettingsDialog below renders the shared modal idiom directly.
import './dialog.css'

/**
 * A removal waiting on its confirmation: a row's ✕ and its ⋯ › Remove (#622)
 * both set the same one, so the two are indistinguishable after the dialog.
 */
interface PendingRemoval {
  name: string
  consequence: string
  action: () => void
}

interface TimelineProps {
  timeline: TimelineState
  /** Whether an earlier state exists to undo to (#189). */
  canUndo: boolean
  /** Whether an undone state exists to redo to (#189). */
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  /**
   * Match levels (#691): measures every element with sound, sets their
   * Volumes toward the Settings target as one undo step, and resolves to
   * the report sentence the timeline shows. Absent hides the control.
   */
  onMatchLevels?: () => Promise<string>
  onMoveEntry: (id: string, direction: 'up' | 'down') => void
  /**
   * Duplicates a timeline element (#314): an exact copy of the row with all
   * its settings, as one undo step — the reducer's `element-duplicated`
   * semantics. Optional so tests that predate it keep compiling; the
   * Duplicate controls render only when the app supplies it.
   */
  onDuplicate?: (kind: SettingsElementKind, id: string) => void
  /**
   * Renames a sequence entry, slate, audio track, overlay (#405) or shape
   * group (#687) — the reducer's `element-renamed`, one undo step. For a
   * shape group an empty name clears its own name. Optional so tests that
   * predate it keep compiling; without it no rename control is offered.
   */
  onRenameElement?: (id: string, name: string) => void
  /**
   * Offers the visual editors (#413): an Adjust visually… toggle beside the
   * fields it stands in for, opening that editor under the row. One flag
   * covers every editor this row family offers, so it is worded for the set
   * rather than for whichever one came first — naming them is what went
   * stale three times as editors were added (#453). Off by default so tests
   * that predate it render as before; App passes the Settings switch
   * (`visualEditors`), whose Off never renders a frame.
   */
  visualEditors?: boolean
  /**
   * Sets the project's canvas preset (#273) — `undefined` is Auto. It sits
   * in this header rather than the page header since #415 (the approved
   * redesign #401 put it beside the timeline it describes). Optional so
   * tests that predate the move keep compiling; without it no control
   * renders, exactly as in ProjectControls before.
   */
  onSetCanvasPreset?: (preset: CanvasPreset | undefined) => void
  /**
   * Pastes copied settings onto a timeline element (#315): the reducer's
   * `settings-pasted` semantics — one action, one undo step, only the
   * checklist's chosen groups. The copied settings themselves are session
   * state owned by this component (like the collapse state, #299) and never
   * reach the model; only this callback does. Optional so tests that
   * predate it keep compiling; the Copy/Paste controls render only when the
   * app supplies it.
   */
  onPasteSettings?: (kind: SettingsElementKind, id: string, settings: CopiedSettings) => void
  onRemoveEntry: (id: string) => void
  onTrimEntry: (id: string, inPoint: number, outPoint: number) => void
  /**
   * The Trim window's clamp steps (#707): the nudge and jump sizes from
   * Settings, as the transport's arrows use. Optional so tests that predate
   * the window keep compiling; the defaults are Settings' own.
   */
  stepSeconds?: number
  largeStepSeconds?: number
  /**
   * Pauses the preview (#722). The Trim window calls it on opening: the
   * window is modal, so a sequence left playing behind it could be neither
   * seen nor paused, and its sound would mix with Play trim's.
   */
  onPausePreview?: () => void
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
   * Shape groups (#683): Add ▾ › Shape group adds the default group at the
   * playhead (the caller mints ids and reads the playhead); a field commit
   * replaces the group whole; removal takes it off. Optional so callers
   * that predate Shapes keep compiling; without `onAddShapeGroup` the Add
   * item is not offered.
   */
  onAddShapeGroup?: () => void
  onUpdateShapeGroup?: (id: string, group: ShapeGroupSpec) => void
  onRemoveShapeGroup?: (id: string) => void
  /**
   * The output frame the preview composes, for the px a shape's thickness
   * and corner radius are shown in (#681 answer 4a). Defaults to 1920×1080.
   */
  frameSize?: { width: number; height: number }
  /**
   * The project's customized default subtitle style (#250); undefined means
   * the built-in default. Shown and edited by the controls beside the
   * subtitle import.
   */
  subtitleStyle: SubtitleStyle | undefined
  /** Sets the default subtitle style whole (#250); committing the built-in
   * default is the reset. */
  onSetSubtitleStyle: (style: SubtitleStyle) => void
  onUpdateVideoOverlay: (id: string, placement: OverlayPlacement) => void
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
  /** Commits an entry's whole redaction list (#492); `[]` clears it. */
  onSetEntryRedactions: (id: string, redactions: RedactionRegion[]) => void
  onSetVideoOverlayCrop: (id: string, crop: Crop) => void
  /** Commits a video overlay's whole redaction list (#492); `[]` clears it. */
  onSetVideoOverlayRedactions: (id: string, redactions: RedactionRegion[]) => void

  /** Commits an entry's whole spotlight list (#532); `[]` clears it. */
  onSetEntrySpotlights: (id: string, spotlights: SpotlightRegion[]) => void

  /** Commits a video overlay's whole spotlight list (#532); `[]` clears it. */
  onSetVideoOverlaySpotlights: (id: string, spotlights: SpotlightRegion[]) => void
  /** Sets a video overlay's shape mask whole (#266);
   * `{ kind: 'rectangle' }` resets. */
  onSetVideoOverlayMask: (id: string, mask: ShapeMaskInput) => void
  /** Sets an overlay's border (#697); a thickness of 0 clears it. */
  onSetVideoOverlayBorder?: (id: string, border: OverlayBorder) => void
  /** Turns an overlay's drop shadow on or edits it (#698); `null` turns it off. */
  onSetVideoOverlayShadow?: (id: string, shadow: OverlayShadow | null) => void
  /** Adds a zoom on an overlay's own picture (#699); the id is the caller's to mint. */
  onAddVideoOverlayZoom?: (overlayId: string, zoom: ZoomSpec) => void
  onUpdateVideoOverlayZoom?: (overlayId: string, id: string, zoom: ZoomSpec) => void
  onRemoveVideoOverlayZoom?: (overlayId: string, id: string) => void
  /** Adds a speed segment or pause to a video overlay (#700); the id is the caller's to mint. */
  onAddVideoOverlayRemap?: (overlayId: string, remap: RemapSpec) => void
  onUpdateVideoOverlayRemap?: (overlayId: string, id: string, remap: RemapSpec) => void
  onRemoveVideoOverlayRemap?: (overlayId: string, id: string) => void
  /** Sets a video/image entry's background fill whole (#259);
   * `{ kind: 'none' }` resets. */
  onSetEntryBackgroundFill: (id: string, fill: BackgroundFillInput) => void
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

/** A stored **video** overlay re-expressed as the placement `onUpdateVideoOverlay` takes. */
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

/**
 * A stored **image** overlay re-expressed as its placement (#294): the
 * rectangle plus the explicit offset + duration window. No trim and no
 * audio — the reducer refuses those on an image overlay.
 */
const imageOverlayPlacementOf = ({
  offset,
  duration,
  x,
  y,
  width,
  height,
}: VideoOverlay): ImageOverlayPlacement => ({ offset, duration, x, y, width, height })

/**
 * One zoom's fields (#129): its window, scale and centre, and its remove
 * button, then whatever the owner adds (`children` — the entry's visual
 * editor toggle). Shared by an entry's zooms and an overlay's (#699), so
 * the two read alike and their accessible names follow one pattern; the
 * centre is a fraction of whatever the zoom magnifies, the frame or the
 * overlay's rectangle.
 */
function ZoomFieldsRow({
  zoom,
  zoomIndex,
  position,
  maxStart,
  onUpdate,
  onRemove,
  children,
}: {
  zoom: ZoomSpec
  zoomIndex: number
  position: string
  /** The owner's trimmed length: the window fields' upper bound. */
  maxStart: number
  onUpdate: (spec: ZoomSpec) => void
  onRemove: () => void
  children?: ReactNode
}) {
  const zoomName = `Zoom ${zoomIndex + 1}`
  const set = (change: Partial<ZoomSpec>) => onUpdate({ ...zoomSpecOf(zoom), ...change })
  return (
    <div className="timeline-entry-zoom">
      <span>{zoomName} at</span>
      <SecondsField
        label={`${zoomName} start of ${position} in seconds`}
        value={zoom.start}
        max={maxStart}
        onCommit={(start) => set({ start })}
        unit="s"
      />
      <span>in</span>
      <SecondsField
        label={`${zoomName} ramp-in of ${position} in seconds`}
        value={zoom.rampIn}
        max={maxStart}
        onCommit={(rampIn) => set({ rampIn })}
        unit="s"
      />
      <span>hold</span>
      <SecondsField
        label={`${zoomName} hold of ${position} in seconds`}
        value={zoom.hold}
        max={maxStart}
        onCommit={(hold) => set({ hold })}
        unit="s"
      />
      <span>out</span>
      <SecondsField
        label={`${zoomName} ramp-out of ${position} in seconds`}
        value={zoom.rampOut}
        max={maxStart}
        onCommit={(rampOut) => set({ rampOut })}
        unit="s"
      />
      <LabelledField text="scale">
        <SecondsField
          label={`${zoomName} scale of ${position}`}
          value={zoom.scale}
          min={1}
          max={10}
          step={0.25}
          onCommit={(scale) => set({ scale })}
          unit="×"
        />
      </LabelledField>
      <span>centre</span>
      <LabelledField text="x">
        <SecondsField
          label={`${zoomName} centre X of ${position} (0 to 1)`}
          value={zoom.centerX}
          max={1}
          step={0.05}
          onCommit={(centerX) => set({ centerX })}
        />
      </LabelledField>
      <LabelledField text="y">
        <SecondsField
          label={`${zoomName} centre Y of ${position} (0 to 1)`}
          value={zoom.centerY}
          max={1}
          step={0.05}
          onCommit={(centerY) => set({ centerY })}
        />
      </LabelledField>
      <button
        type="button"
        aria-label={`Remove zoom ${zoomIndex + 1} from ${position}`}
        onClick={onRemove}
      >
        ✕
      </button>
      {children}
    </div>
  )
}

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

// Transition names come from the registry (#199): core plus whatever enabled
// plugins contribute, in registration order. See the select's options below.

/** Seconds as a plain number string with at most two decimals, e.g. 1.25 → "1.25", 3 → "3". */
const formatSeconds = (seconds: number) => String(Math.round(seconds * 100) / 100)

interface SecondsFieldProps {
  label: string
  value: number
  max: number
  min?: number
  step?: number
  onCommit: (value: number) => void
  /**
   * Show a range slider beside the number, on the same value (#426, from
   * #402's approved slider polish). Opt-in per field rather than automatic:
   * a slider is only meaningful where the range is bounded and small enough
   * to feel — a volume, a fade, a percentage — and a trim point on an
   * hour-long clip is neither.
   */
  slider?: boolean
  /**
   * The unit drawn inside the box, after the number (#665): `s`, `%`, `px`
   * or `×`. It is not part of the value — the input stays `type="number"`,
   * so typing, the spinner, step and min/max work exactly as without it.
   * Absent for a value that truly is just a number (a 0–1 fraction).
   */
  unit?: FieldUnit
  /**
   * A value the slider marks with a tick under its track (#692): Volume's
   * 1, the source as recorded, which sits a quarter of the way along once
   * the range runs to `MAX_VOLUME`. Only drawn with `slider`.
   */
  mark?: number
}

/** The units a field can carry (#665). */
type FieldUnit = 's' | '%' | 'px' | '×'

/**
 * The word an accessible name uses for each unit. When the field's label
 * already says it ("in seconds", "(percent)", "in pixels"), the drawn unit
 * is hidden from assistive technology so it is not read twice; `×` has no
 * word in today's names, so it stays readable, as the loose `×` span it
 * replaces was.
 */
const UNIT_WORDS: Record<FieldUnit, string | undefined> = {
  s: 'seconds',
  '%': 'percent',
  px: 'pixels',
  '×': undefined,
}

/**
 * A visible label and the box it names, kept together (#664).
 *
 * In a row of several boxes for one value — a crop's four edges, an area's
 * left/top/width/height, a centre's x and y — the row's own caption
 * ("Crop", "Area", "centre") names the group, not its first box, so each
 * box gets a word of its own. The two are one non-wrapping item in the
 * row's flex flow, so a narrow row breaks *between* label–box pairs and
 * never leaves a label at the end of one line with its box on the next.
 * Purely visible: each box's accessible name is still its own `aria-label`.
 */
/** A stored shape group re-expressed as the spec an update takes (no id). */
function shapeGroupSpecOf(group: ShapeGroup): ShapeGroupSpec {
  const { id: _id, ...spec } = group
  return spec
}

/**
 * A change to one shape's fields (#683, #684, #689): any field of any kind
 * except its identity. The row only ever offers a kind's own fields, so the
 * merge stays a shape of that kind.
 */
type ShapeChange = Partial<Omit<BoxShape, 'id' | 'kind'>> &
  Partial<Omit<ArrowShape, 'id' | 'kind'>> &
  Partial<Omit<BadgeShape, 'id' | 'kind'>>

/** A frame-fraction field: an edge, a size or a point (0 to 1). */
function FractionField({
  text,
  label,
  value,
  min,
  onCommit,
}: {
  text: string
  label: string
  value: number
  min?: number
  onCommit: (value: number) => void
}) {
  return (
    <LabelledField text={text}>
      <SecondsField label={label} value={value} min={min} max={1} step={0.01} onCommit={onCommit} />
    </LabelledField>
  )
}

/**
 * One shape's fields in its group's row (#683): kind, placement, border and
 * fill — every property the shape editor (#685) will also set, so the
 * keyboard alone can do everything and the two can never disagree (#681
 * §3). A rectangle or ellipse is placed by its box; an arrow (#684) by its
 * tail and tip, with its heads where a box shape has its fill. Thickness
 * and corner radius are stored as fractions of the frame's shorter side and
 * shown in px at the current output frame (#681 answer 4a); opacities are
 * stored 0–1 and shown as percentages.
 */
function ShapeFields({
  shape,
  name,
  frameSize,
  onChange,
  onRemove,
}: {
  shape: Shape
  /** The shape's accessible name, e.g. "Ellipse 1 of shape group at position 1". */
  name: string
  frameSize: { width: number; height: number }
  onChange: (change: ShapeChange) => void
  /** Absent for a group's only shape: a group always holds one. */
  onRemove?: () => void
}) {
  const toPx = (fraction: number) => shorterSidePixels(fraction, frameSize.width, frameSize.height)
  const fromPx = (px: number) => shorterSideFraction(px, frameSize.width, frameSize.height)
  const maxThicknessPx = Math.floor(toPx(MAX_SHAPE_THICKNESS))
  return (
    <li className="shape-row" aria-label={name}>
      <div className="text-overlay-controls">
        <span className="shape-row-kind">{name.split(' of ')[0]}</span>
        {shape.kind === 'badge' ? (
          <>
            {/* A badge (#689) is placed by its centre and sized by its
                diameter, shown in px at the output frame as thickness is. */}
            <span className="shape-row-point">
              <span>Centre</span>
              <FractionField
                text="x"
                label={`Centre X of ${name} (0 to 1)`}
                value={shape.centerX}
                onCommit={(centerX) => onChange({ centerX })}
              />
              <FractionField
                text="y"
                label={`Centre Y of ${name} (0 to 1)`}
                value={shape.centerY}
                onCommit={(centerY) => onChange({ centerY })}
              />
            </span>
            <LabelledField text="Size">
              <SecondsField
                label={`Diameter of ${name} in pixels`}
                value={Math.round(toPx(shape.size) * 100) / 100}
                min={Math.ceil(toPx(MIN_BADGE_SIZE))}
                max={Math.floor(toPx(MAX_BADGE_SIZE))}
                step={1}
                onCommit={(px) =>
                  onChange({ size: Math.min(Math.max(fromPx(px), MIN_BADGE_SIZE), MAX_BADGE_SIZE) })
                }
                unit="px"
              />
            </LabelledField>
            <LabelledField text="Number">
              <SecondsField
                label={`Number of ${name}`}
                value={shape.number}
                max={MAX_BADGE_NUMBER}
                step={1}
                onCommit={(number) => onChange({ number: Math.round(number) })}
              />
            </LabelledField>
          </>
        ) : shape.kind === 'arrow' ? (
          <>
            {/* An arrow's two ends (#684), each a point in frame fractions. */}
            <span className="shape-row-point">
              <span>Tail</span>
              <FractionField
                text="x"
                label={`Tail x of ${name} (0 to 1)`}
                value={shape.tailX}
                onCommit={(tailX) => onChange({ tailX })}
              />
              <FractionField
                text="y"
                label={`Tail y of ${name} (0 to 1)`}
                value={shape.tailY}
                onCommit={(tailY) => onChange({ tailY })}
              />
            </span>
            <span className="shape-row-point">
              <span>Tip</span>
              <FractionField
                text="x"
                label={`Tip x of ${name} (0 to 1)`}
                value={shape.tipX}
                onCommit={(tipX) => onChange({ tipX })}
              />
              <FractionField
                text="y"
                label={`Tip y of ${name} (0 to 1)`}
                value={shape.tipY}
                onCommit={(tipY) => onChange({ tipY })}
              />
            </span>
          </>
        ) : (
          <>
            <span>Box</span>
            <FractionField
              text="x"
              label={`Left edge of ${name} (0 to 1)`}
              value={shape.x}
              onCommit={(x) => onChange({ x })}
            />
            <FractionField
              text="y"
              label={`Top edge of ${name} (0 to 1)`}
              value={shape.y}
              onCommit={(y) => onChange({ y })}
            />
            <FractionField
              text="w"
              label={`Width of ${name} (fraction of frame width)`}
              value={shape.width}
              min={MIN_SHAPE_SIZE}
              onCommit={(width) => onChange({ width })}
            />
            <FractionField
              text="h"
              label={`Height of ${name} (fraction of frame height)`}
              value={shape.height}
              min={MIN_SHAPE_SIZE}
              onCommit={(height) => onChange({ height })}
            />
          </>
        )}
        {onRemove !== undefined && (
          <button
            type="button"
            className="shape-row-remove"
            aria-label={`Remove ${name}`}
            onClick={onRemove}
          >
            ✕
          </button>
        )}
      </div>
      <div className="text-overlay-controls">
        {/* A colour and its opacity are one item (#683), so a narrow row
            never strands an opacity box on a line away from its swatch. */}
        <LabelledField text="Border">
          <input
            type="color"
            aria-label={`Border colour of ${name}`}
            value={shape.stroke}
            onChange={(event) => onChange({ stroke: event.target.value })}
          />
          <SecondsField
            label={`Border opacity of ${name} (percent)`}
            value={Math.round(shape.strokeOpacity * 100)}
            max={100}
            step={5}
            onCommit={(percent) => onChange({ strokeOpacity: percent / 100 })}
            unit="%"
          />
        </LabelledField>
        <LabelledField text="Thickness">
          <SecondsField
            label={`Border thickness of ${name} in pixels`}
            value={toPx(shape.thickness)}
            max={maxThicknessPx}
            step={1}
            onCommit={(px) => onChange({ thickness: Math.min(fromPx(px), MAX_SHAPE_THICKNESS) })}
            unit="px"
          />
        </LabelledField>
        {/* A box's border, an arrow's shaft (#688); heads stay solid. */}
        <LabelledField text="Line">
          <select
            aria-label={`Line style of ${name}`}
            value={shape.lineStyle ?? 'solid'}
            onChange={(event) => onChange({ lineStyle: event.target.value as LineStyle })}
          >
            {LINE_STYLES.map((lineStyle) => (
              <option key={lineStyle} value={lineStyle}>
                {LINE_STYLE_LABELS[lineStyle]}
              </option>
            ))}
          </select>
        </LabelledField>
        {shape.kind === 'arrow' ? (
          <>
            {/* An arrow has no fill: its heads take that place (#684). */}
            <LabelledField text="Heads">
              <select
                aria-label={`Arrow heads of ${name}`}
                value={shape.heads}
                onChange={(event) => onChange({ heads: event.target.value as ArrowHeads })}
              >
                {ARROW_HEADS.map((heads) => (
                  <option key={heads} value={heads}>
                    {ARROW_HEAD_LABELS[heads]}
                  </option>
                ))}
              </select>
            </LabelledField>
            {shape.heads !== 'none' && (
              <LabelledField text="Head size">
                <select
                  aria-label={`Head size of ${name}`}
                  value={shape.headSize}
                  onChange={(event) => onChange({ headSize: event.target.value as ArrowHeadSize })}
                >
                  {ARROW_HEAD_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {ARROW_HEAD_SIZE_LABELS[size]}
                    </option>
                  ))}
                </select>
              </LabelledField>
            )}
          </>
        ) : (
          <LabelledField text="Fill">
            <input
              type="color"
              aria-label={`Fill colour of ${name}`}
              value={shape.fill}
              onChange={(event) => onChange({ fill: event.target.value })}
            />
            <SecondsField
              label={`Fill opacity of ${name} (percent)`}
              value={Math.round(shape.fillOpacity * 100)}
              max={100}
              step={5}
              onCommit={(percent) => onChange({ fillOpacity: percent / 100 })}
              unit="%"
            />
          </LabelledField>
        )}
        {shape.kind === 'badge' && (
          <LabelledField text="Number colour">
            <input
              type="color"
              aria-label={`Number colour of ${name}`}
              value={shape.numberColor}
              onChange={(event) => onChange({ numberColor: event.target.value })}
            />
          </LabelledField>
        )}
        {shape.kind === 'rectangle' && (
          <LabelledField text="Corners">
            <SecondsField
              label={`Corner radius of ${name} in pixels`}
              value={toPx(shape.cornerRadius ?? 0)}
              max={Math.floor(toPx(MAX_CORNER_RADIUS))}
              step={1}
              onCommit={(px) =>
                onChange({ cornerRadius: Math.min(fromPx(px), MAX_CORNER_RADIUS) })
              }
              unit="px"
            />
          </LabelledField>
        )}
      </div>
      {isInvisibleShape(shape) && (
        <p className="shape-row-warning" role="note">
          {shape.kind === 'arrow'
            ? 'This arrow is invisible: give it a border thickness and opacity.'
            : 'This shape is invisible: give it a border or a fill.'}
        </p>
      )}
    </li>
  )
}

function LabelledField({ text, children }: { text: string; children: ReactNode }) {
  return (
    <span className="timeline-labelled">
      <span>{text}</span>
      {children}
    </span>
  )
}

/**
 * Numeric input (trim points, transition durations, zoom parameters) that
 * commits on blur/Enter. The draft is local so the user can type freely; the
 * committed value is validated — and possibly clamped — by the reducer, and
 * the field snaps back to (or shows) the stored state either way, so a
 * clamp is visible rather than silent.
 *
 * With `slider` (#426) a range input sits beside it on the same draft, so
 * the two always read the same number. Dragging updates the draft on every
 * step and commits **once, on release** — one gesture, one undo step — the
 * same bargain the visual editors strike (#413). A key press on the focused
 * slider is its own gesture and commits on its key-up.
 */
function SecondsField({
  label,
  value,
  max,
  min = 0,
  step = 0.1,
  onCommit,
  slider = false,
  unit,
  mark,
}: SecondsFieldProps) {
  const [draft, setDraft] = useState(() => formatSeconds(value))
  // Whether the slider has moved since it last committed (#426). A gesture
  // ends on a pointer-up, a key-up or a blur, and those fire for far more
  // than this control's own gestures: a release over a slider nobody
  // dragged would otherwise commit whatever the number field beside it
  // happens to be holding, and the key-up of a Ctrl+Z pressed on the
  // focused slider arrives after the undo has changed `value`, putting the
  // undone value straight back (the browser spec caught that one).
  const slid = useRef(false)

  useEffect(() => {
    setDraft(formatSeconds(value))
  }, [value])

  const commitText = (text: string) => {
    const parsed = Number(text)
    if (text.trim() !== '' && Number.isFinite(parsed) && parsed !== value) onCommit(parsed)
    // If the reducer rejected (or clamped to) the same value, no prop change
    // arrives — reset the draft to the current state explicitly.
    setDraft(formatSeconds(value))
  }
  const commit = () => commitText(draft)

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur()
  }

  const endGesture = () => {
    if (!slid.current) return
    slid.current = false
    commit()
  }

  const number = (
    <input
      type="number"
      inputMode="decimal"
      step={step}
      min={min}
      max={max}
      aria-label={label}
      className={unit === undefined ? undefined : 'timeline-unit-input'}
      value={draft}
      onChange={(event) => {
        // Firefox's spinner arrows step the value without focusing the field
        // (#593): the click fires input and change but never focus or blur,
        // so a draft waiting for blur would never commit, and the field would
        // show a number the timeline does not have. A change that arrives
        // while the field is not focused is no typing in progress — it is a
        // whole gesture of its own, so it commits at once. Chromium focuses
        // the field on a spinner click, so there this never fires and the
        // arrows commit on blur exactly as before.
        if (document.activeElement !== event.currentTarget) commitText(event.target.value)
        else setDraft(event.target.value)
      }}
      onBlur={commit}
      onKeyDown={handleKeyDown}
    />
  )
  // With a unit, the border belongs to the wrapper and the input sits in it
  // borderless, right-aligned, so the unit reads directly after the number
  // inside one box — `[ 0 s]` — rather than as loose text beside the row.
  const word = unit === undefined ? undefined : UNIT_WORDS[unit]
  const field =
    unit === undefined ? (
      number
    ) : (
      <span className="timeline-unit-box">
        {number}
        <span
          className="timeline-unit"
          aria-hidden={word !== undefined && label.includes(word) ? true : undefined}
        >
          {unit}
        </span>
      </span>
    )
  if (!slider) return field

  // A range takes a number or nothing; a half-typed "1." or an emptied
  // field is neither, so the stored value stands in until the field commits
  // or snaps back. Clamped as well, because the number field lets a value
  // outside the range be typed (the reducer clamps it) and a range would
  // silently pin itself to an end without saying so.
  const drafted = Number(draft)
  const position =
    draft.trim() !== '' && Number.isFinite(drafted)
      ? Math.min(Math.max(drafted, min), max)
      : value
  const range = (
    <input
      type="range"
      aria-label={`${label} slider`}
      step={step}
      min={min}
      max={max}
      value={position}
      onChange={(event) => {
        slid.current = true
        setDraft(event.target.value)
      }}
      // Not on change: that fires on every step of a drag, and each one
      // would be its own undo step. Release ends the gesture — by pointer,
      // by key, or by the focus leaving mid-gesture — and only a release
      // that ends a gesture this slider actually made commits anything.
      onPointerUp={endGesture}
      onKeyUp={endGesture}
      onBlur={endGesture}
    />
  )
  return (
    <span className="timeline-field">
      {field}
      {mark === undefined || max <= min ? (
        range
      ) : (
        // The tick sits under the track at the mark's share of the range,
        // inset by half a thumb at each end, where the thumb's centre
        // stands at the slider's ends (#692).
        <span className="timeline-slider">
          {range}
          <span
            className="timeline-slider-mark"
            aria-hidden
            style={{ '--mark': (mark - min) / (max - min) } as CSSProperties}
          />
        </span>
      )}
    </span>
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
      <LabelledField text="brightness">
        <SecondsField
          label={`Brightness of ${position} (percent)`}
          value={brightness}
          min={COLOR_ADJUSTMENT_MIN}
          max={COLOR_ADJUSTMENT_MAX}
          step={5}
          slider
          onCommit={(value) => commit({ brightness: value })}
          unit="%"
        />
      </LabelledField>
      <LabelledField text="contrast">
        <SecondsField
          label={`Contrast of ${position} (percent)`}
          value={contrast}
          min={COLOR_ADJUSTMENT_MIN}
          max={COLOR_ADJUSTMENT_MAX}
          step={5}
          slider
          onCommit={(value) => commit({ contrast: value })}
          unit="%"
        />
      </LabelledField>
      <LabelledField text="saturation">
        <SecondsField
          label={`Saturation of ${position} (percent)`}
          value={saturation}
          min={COLOR_ADJUSTMENT_MIN}
          max={COLOR_ADJUSTMENT_MAX}
          step={5}
          slider
          onCommit={(value) => commit({ saturation: value })}
          unit="%"
        />
      </LabelledField>
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
  /**
   * The visual editor's toggle (#423), when the Visual editors setting has
   * one to offer. A slot rather than a flag: the row knows where the button
   * belongs — beside the fields it edits — and the caller knows what it
   * does, exactly as the overlay row holds its own `Adjust visually…`.
   */
  adjust?: ReactNode
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
function CropControls({ position, crop, onCommit, adjust }: CropControlsProps) {
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
    <LabelledField text={label}>
      <SecondsField
        label={`Crop ${label} of ${position} (percent)`}
        value={percent(crop?.[edge])}
        min={0}
        max={90}
        step={5}
        onCommit={(value) => commit({ [edge]: value })}
        unit="%"
      />
    </LabelledField>
  )
  return (
    <div className="timeline-entry-color">
      <span>Crop</span>
      {field('left', 'left')}
      {field('right', 'right')}
      {field('top', 'top')}
      {field('bottom', 'bottom')}
      <button
        type="button"
        aria-label={`Reset crop of ${position}`}
        disabled={crop === undefined}
        onClick={() => onCommit({})}
      >
        Reset
      </button>
      {adjust}
    </div>
  )
}

interface RedactionControlsProps {
  /** The accessible name of the row's owner. */
  position: string
  regions: readonly RedactionRegion[] | undefined
  /**
   * The element the regions sit on, for the visual editor's still (#493) —
   * an entry or a video overlay, which carry the same source description
   * under the same names (`CropSubject`).
   */
  subject: CropSubject
  /** Whether the Visual editors setting offers `Adjust visually…` (#413). */
  visualEditors: boolean
  /** The element's trim, which a fresh region's window defaults to (#492). */
  inPoint: number
  outPoint: number
  /** The source's length — the furthest a window can reach. */
  duration: number
  /** Receives the full list on every edit; an empty list resets (#492). */
  onCommit: (regions: RedactionRegion[]) => void
}

/**
 * Per-element redaction controls (#492): the list of regions, a button that
 * adds one, and per region its rectangle (percent of the source frame), its
 * window (seconds into the source), its style and that style's own
 * parameter, plus Remove.
 *
 * Every edit commits the WHOLE list, exactly as the crop and orientation
 * controls commit a whole value — so adding, editing and removing are one
 * reducer action apiece and therefore one undo step apiece, with no partial
 * region ever reaching the model. A fresh region covers the middle of the
 * frame and the element's current trim, which is the common case (a whole
 * clip's header bar) and is trivially narrowed.
 */
function RedactionControls({
  position,
  regions,
  subject,
  visualEditors,
  inPoint,
  outPoint,
  duration,
  onCommit,
}: RedactionControlsProps) {
  const list = regions ?? []
  // Which region's visual editor is open (#493), by the region's stable id
  // so a Remove above it does not shift the panel onto a neighbour. One at
  // a time, as the other editors are: the button is a toggle.
  const [editingId, setEditingId] = useState<string | null>(null)
  const percent = (value: number) => value * 100
  const replace = (index: number, change: Partial<RedactionRegion>) => {
    const next = list.map((region, at) => (at === index ? { ...region, ...change } : region))
    onCommit(next)
  }
  const add = () => {
    onCommit([
      ...list,
      {
        id: `rd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        ...DEFAULT_REGION_RECT,
        start: inPoint,
        // A zero-length element cannot happen, but a window must outlast its
        // start whatever the trim is.
        end: Math.max(outPoint, inPoint + MIN_WINDOW_SECONDS),
        style: DEFAULT_REDACTION_STYLE,
        blockSize: DEFAULT_PIXELATE_BLOCK,
      },
    ])
  }
  /** Switching style swaps in that style's own parameter and drops the rest. */
  const restyle = (index: number, style: RedactionStyle) => {
    const region = list[index]
    if (region === undefined || region.style === style) return
    const base = {
      id: region.id,
      left: region.left,
      top: region.top,
      width: region.width,
      height: region.height,
      start: region.start,
      end: region.end,
    }
    const next: RedactionRegion =
      style === 'blur'
        ? { ...base, style, strength: DEFAULT_BLUR_STRENGTH }
        : style === 'pixelate'
          ? { ...base, style, blockSize: DEFAULT_PIXELATE_BLOCK }
          : { ...base, style, color: DEFAULT_REDACTION_COLOR }
    onCommit(list.map((each, at) => (at === index ? next : each)))
  }
  return (
    <div className="timeline-redactions">
      <div className="timeline-entry-color">
        <span>Redact</span>
        <button
          type="button"
          aria-label={`Add a redaction region on ${position}`}
          onClick={add}
        >
          + Add region
        </button>
        {list.length === 0 && <span className="timeline-hint">Nothing hidden</span>}
      </div>
      {list.map((region, index) => {
        // Regions are addressed by their position in the list, which is what
        // the user sees; ids are stable but meaningless to read aloud.
        // The region's place in the list, which is what the user sees;
        // ids are stable but meaningless to read aloud. The number sits
        // where the Feature Index walk's shape rules can lift it out, so
        // every region's controls normalize to one entry name.
        const which = `Redaction region ${index + 1}`
        return (
          <div className="timeline-redaction" key={region.id}>
            <div className="timeline-entry-color">
              <span>Area</span>
              <LabelledField text="left">
                <SecondsField
                  label={`${which} left of ${position} (percent)`}
                  value={percent(region.left)}
                  min={0}
                  max={99}
                  step={1}
                  onCommit={(value) => replace(index, { left: value / 100 })}
                  unit="%"
                />
              </LabelledField>
              <LabelledField text="top">
                <SecondsField
                  label={`${which} top of ${position} (percent)`}
                  value={percent(region.top)}
                  min={0}
                  max={99}
                  step={1}
                  onCommit={(value) => replace(index, { top: value / 100 })}
                  unit="%"
                />
              </LabelledField>
              <LabelledField text="width">
                <SecondsField
                  label={`${which} width of ${position} (percent)`}
                  value={percent(region.width)}
                  min={1}
                  max={100}
                  step={1}
                  onCommit={(value) => replace(index, { width: value / 100 })}
                  unit="%"
                />
              </LabelledField>
              <LabelledField text="height">
                <SecondsField
                  label={`${which} height of ${position} (percent)`}
                  value={percent(region.height)}
                  min={1}
                  max={100}
                  step={1}
                  onCommit={(value) => replace(index, { height: value / 100 })}
                  unit="%"
                />
              </LabelledField>
            </div>
            <div className="timeline-entry-color">
              <span>Shows from</span>
              <SecondsField
                label={`${which} start of ${position} in seconds`}
                value={region.start}
                min={0}
                max={duration}
                step={0.1}
                onCommit={(value) => replace(index, { start: value })}
                unit="s"
              />
              <span>to</span>
              <SecondsField
                label={`${which} end of ${position} in seconds`}
                value={region.end}
                min={0}
                max={duration}
                step={0.1}
                onCommit={(value) => replace(index, { end: value })}
                unit="s"
              />
            </div>
            <div className="timeline-entry-color">
              <span>Style</span>
              <select
                aria-label={`${which} style of ${position}`}
                value={region.style}
                onChange={(event) => restyle(index, event.target.value as RedactionStyle)}
              >
                <option value="blur">Blur</option>
                <option value="pixelate">Pixelate</option>
                <option value="solid">Solid</option>
              </select>
              {region.style === 'blur' && (
                <>
                  <span>strength</span>
                  <SecondsField
                    label={`${which} blur strength of ${position} in pixels`}
                    value={region.strength ?? DEFAULT_BLUR_STRENGTH}
                    min={0}
                    max={MAX_REDACTION_STRENGTH}
                    step={1}
                    slider
                    onCommit={(value) => replace(index, { strength: value })}
                    unit="px"
                  />
                </>
              )}
              {region.style === 'pixelate' && (
                <>
                  <span>block size</span>
                  <SecondsField
                    label={`${which} block size of ${position} in pixels`}
                    value={region.blockSize ?? DEFAULT_PIXELATE_BLOCK}
                    min={1}
                    max={MAX_REDACTION_STRENGTH}
                    step={1}
                    slider
                    onCommit={(value) => replace(index, { blockSize: value })}
                    unit="px"
                  />
                </>
              )}
              {region.style === 'solid' && (
                <input
                  type="color"
                  aria-label={`${which} colour of ${position}`}
                  value={region.color ?? DEFAULT_REDACTION_COLOR}
                  onChange={(event) => replace(index, { color: event.target.value })}
                />
              )}
              <button
                type="button"
                aria-label={`Remove ${which.toLowerCase()} of ${position}`}
                onClick={() => onCommit(list.filter((_, at) => at !== index))}
              >
                Remove
              </button>
              {visualEditors && (
                // A toggle, so the same button closes what it opened — the
                // zoom's rule (#413); the editor draws under this region's
                // rows (#493).
                <button
                  type="button"
                  className="timeline-adjust-button"
                  aria-label={`Adjust ${which} of ${position} visually`}
                  aria-expanded={editingId === region.id}
                  title="Drag the region on a still of the source"
                  onClick={() => setEditingId(editingId === region.id ? null : region.id)}
                >
                  Adjust visually…
                </button>
              )}
            </div>
            <p className="timeline-hint">
              Blur can be partly reversed on small text; Pixelate and Solid cannot.
            </p>
            {visualEditors && editingId === region.id && (
              <RedactionEditor
                subject={subject}
                regions={list}
                index={index}
                regionName={which}
                position={position}
                onCommit={onCommit}
                onClose={() => setEditingId(null)}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

interface SpotlightControlsProps {
  /** The accessible name of the row's owner. */
  position: string
  regions: readonly SpotlightRegion[] | undefined
  /**
   * The element the regions sit on, for the visual editor's still (#533) —
   * an entry or a video overlay, which carry the same source description
   * under the same names (`CropSubject`).
   */
  subject: CropSubject
  /** Whether the Visual editors setting offers `Adjust visually…` (#413). */
  visualEditors: boolean
  /** The element's trim, which a fresh region's window defaults to (#532). */
  inPoint: number
  outPoint: number
  /** The source's length — the furthest a window can reach. */
  duration: number
  /** Receives the full list on every edit; an empty list resets (#532). */
  onCommit: (regions: SpotlightRegion[]) => void
}

/**
 * Per-element spotlight controls (#532): the list of regions, a button that
 * adds one, and per region its rectangle (percent of the source frame), its
 * window (seconds into the source), its shape and its dim, plus Remove.
 *
 * `RedactionControls` above is the model — same commit-the-whole-list rule,
 * so adding, editing and removing are one reducer action and therefore one
 * undo step apiece, with no partial region ever reaching the model; same
 * fresh-region rectangle and window, which is the common case and trivially
 * narrowed. What differs is the two controls the feature actually has:
 * Shape, which changes only the drawn edge, and Dim, which is the one
 * number saying how far the outside drops.
 *
 * `Adjust visually…` (#533) opens the spotlight editor under the region's
 * rows, exactly as #493 followed #492; **soften** (#533) is the width of
 * the edge's ramp, a percent of the picture's shorter side, off at 0.
 */
function SpotlightControls({
  position,
  regions,
  subject,
  visualEditors,
  inPoint,
  outPoint,
  duration,
  onCommit,
}: SpotlightControlsProps) {
  const list = regions ?? []
  // Which region's visual editor is open (#533), by the region's stable id
  // so a Remove above it does not shift the panel onto a neighbour. One at
  // a time, as the other editors are: the button is a toggle.
  const [editingId, setEditingId] = useState<string | null>(null)
  const percent = (value: number) => value * 100
  const replace = (index: number, change: Partial<SpotlightRegion>) => {
    onCommit(list.map((region, at) => (at === index ? { ...region, ...change } : region)))
  }
  const add = () => {
    onCommit([
      ...list,
      {
        id: `sp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        ...DEFAULT_SPOTLIGHT_RECT,
        start: inPoint,
        // A zero-length element cannot happen, but a window must outlast
        // its start whatever the trim is.
        end: Math.max(outPoint, inPoint + MIN_WINDOW_SECONDS),
        shape: DEFAULT_SPOTLIGHT_SHAPE,
        dim: DEFAULT_SPOTLIGHT_DIM,
      },
    ])
  }
  return (
    <div className="timeline-spotlights">
      <div className="timeline-entry-color">
        <span>Spotlight</span>
        <button type="button" aria-label={`Add a spotlight region on ${position}`} onClick={add}>
          + Add region
        </button>
        {list.length === 0 && <span className="timeline-hint">Nothing spotlit</span>}
      </div>
      {list.map((region, index) => {
        // The region's place in the list, which is what the user sees; ids
        // are stable but meaningless to read aloud. The number sits where
        // the Feature Index walk's shape rules can lift it out, so every
        // region's controls normalize to one entry name.
        const which = `Spotlight region ${index + 1}`
        return (
          <div className="timeline-spotlight" key={region.id}>
            <div className="timeline-entry-color">
              <span>Area</span>
              <LabelledField text="left">
                <SecondsField
                  label={`${which} left of ${position} (percent)`}
                  value={percent(region.left)}
                  min={0}
                  max={99}
                  step={1}
                  onCommit={(value) => replace(index, { left: value / 100 })}
                  unit="%"
                />
              </LabelledField>
              <LabelledField text="top">
                <SecondsField
                  label={`${which} top of ${position} (percent)`}
                  value={percent(region.top)}
                  min={0}
                  max={99}
                  step={1}
                  onCommit={(value) => replace(index, { top: value / 100 })}
                  unit="%"
                />
              </LabelledField>
              <LabelledField text="width">
                <SecondsField
                  label={`${which} width of ${position} (percent)`}
                  value={percent(region.width)}
                  min={1}
                  max={100}
                  step={1}
                  onCommit={(value) => replace(index, { width: value / 100 })}
                  unit="%"
                />
              </LabelledField>
              <LabelledField text="height">
                <SecondsField
                  label={`${which} height of ${position} (percent)`}
                  value={percent(region.height)}
                  min={1}
                  max={100}
                  step={1}
                  onCommit={(value) => replace(index, { height: value / 100 })}
                  unit="%"
                />
              </LabelledField>
            </div>
            <div className="timeline-entry-color">
              <span>Shows from</span>
              <SecondsField
                label={`${which} start of ${position} in seconds`}
                value={region.start}
                min={0}
                max={duration}
                step={0.1}
                onCommit={(value) => replace(index, { start: value })}
                unit="s"
              />
              <span>to</span>
              <SecondsField
                label={`${which} end of ${position} in seconds`}
                value={region.end}
                min={0}
                max={duration}
                step={0.1}
                onCommit={(value) => replace(index, { end: value })}
                unit="s"
              />
            </div>
            <div className="timeline-entry-color">
              <span>Shape</span>
              <select
                aria-label={`${which} shape of ${position}`}
                value={region.shape}
                onChange={(event) =>
                  replace(index, { shape: event.target.value as SpotlightShape })
                }
              >
                <option value="rectangle">Rectangle</option>
                <option value="oval">Oval</option>
              </select>
              <span>dim</span>
              <SecondsField
                label={`${which} dim of ${position} (percent)`}
                value={percent(region.dim)}
                min={0}
                max={100}
                step={1}
                slider
                onCommit={(value) => replace(index, { dim: value / 100 })}
                unit="%"
              />
              <span>soften</span>
              <SecondsField
                label={`${which} soften of ${position} (percent)`}
                value={percent(softenOf(region))}
                min={0}
                max={percent(MAX_SPOTLIGHT_SOFTEN)}
                step={1}
                slider
                onCommit={(value) => replace(index, { soften: value / 100 })}
                unit="%"
              />
              <button
                type="button"
                aria-label={`Remove ${which.toLowerCase()} of ${position}`}
                onClick={() => onCommit(list.filter((_, at) => at !== index))}
              >
                Remove
              </button>
              {visualEditors && (
                // A toggle, so the same button closes what it opened — the
                // zoom's rule (#413); the editor draws under this region's
                // rows (#533).
                <button
                  type="button"
                  className="timeline-adjust-button"
                  aria-label={`Adjust ${which} of ${position} visually`}
                  aria-expanded={editingId === region.id}
                  title="Drag the region on a still of the source"
                  onClick={() => setEditingId(editingId === region.id ? null : region.id)}
                >
                  Adjust visually…
                </button>
              )}
            </div>
            <p className="timeline-hint">
              An oval fills the same box — a square area draws a circle. Overlapping regions stay
              bright together. Soften widens the edge into a gradient; 0 is a hard edge.
            </p>
            {visualEditors && editingId === region.id && (
              <SpotlightEditor
                subject={subject}
                regions={list}
                index={index}
                regionName={which}
                position={position}
                onCommit={onCommit}
                onClose={() => setEditingId(null)}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

interface ShapeMaskControlsProps {
  /** The accessible name of the row's owner (a video overlay). */
  position: string
  mask: ShapeMask | undefined
  /** Receives the full mask on every edit; `{ kind: 'rectangle' }` resets (#266). */
  onCommit: (mask: ShapeMaskInput) => void
}

/**
 * Per-overlay shape-mask controls (#266): a shape selector (rectangle —
 * today's hard outline — rounded, or ellipse) plus the corner-radius amount
 * shown for `rounded` — one row in the per-item-controls idiom, on video
 * overlay rows only (the mask is an overlay treatment). Every edit commits
 * the full mask; the reducer normalizes (`rectangle` — and a radius that
 * clamps to zero — returns the overlay to its stored-key-free identity).
 * The radius is entered as a percent of the placed rectangle's shorter side.
 */
function ShapeMaskControls({ position, mask, onCommit }: ShapeMaskControlsProps) {
  return (
    <div className="timeline-entry-color">
      <span>Shape</span>
      <select
        aria-label={`Shape mask of ${position}`}
        value={mask?.kind ?? 'rectangle'}
        onChange={(event) => {
          const kind = event.target.value as ShapeMaskInput['kind']
          if (kind === 'rounded') {
            onCommit({
              kind: 'rounded',
              radius: mask?.kind === 'rounded' ? mask.radius : DEFAULT_ROUNDED_RADIUS,
            })
          } else {
            onCommit({ kind })
          }
        }}
      >
        <option value="rectangle">Rectangle</option>
        <option value="rounded">Rounded</option>
        <option value="ellipse">Ellipse</option>
      </select>
      {mask?.kind === 'rounded' && (
        <>
          <span>radius</span>
          <SecondsField
            label={`Corner radius of ${position} (percent)`}
            value={mask.radius * 100}
            min={0}
            max={MAX_ROUNDED_RADIUS * 100}
            step={5}
            slider
            onCommit={(value) => onCommit({ kind: 'rounded', radius: value / 100 })}
            unit="%"
          />
        </>
      )}
    </div>
  )
}

interface RemapFieldRowsProps {
  /** The accessible name of the row's owner (a sequence entry or a video overlay). */
  position: string
  /** The owner's speed segments and pauses, normalized: sorted by window start. */
  effects: readonly (RemapSpec & { id: string })[]
  /** The owner's trimmed source length — every position's upper bound. */
  trimmed: number
  onUpdate: (id: string, remap: RemapSpec) => void
  onRemove: (id: string) => void
}

/**
 * The rows of an owner's time-remap effects (#141): one per speed segment
 * or pause, each independently editable like a zoom. Accessible names
 * number each kind separately, in window order — the order the normalized
 * state stores them in. Shared by sequence entries and video overlays
 * (#700), so the two read alike.
 */
function RemapFieldRows({ position, effects, trimmed, onUpdate, onRemove }: RemapFieldRowsProps) {
  const kindIndex = (id: string, kind: RemapSpec['kind']) =>
    effects.filter((effect) => effect.kind === kind).findIndex((effect) => effect.id === id) + 1
  return (
    <>
      {effects.map((effect) =>
        effect.kind === 'speed' ? (
          (() => {
            const name = `Speed segment ${kindIndex(effect.id, 'speed')}`
            const set = (change: Partial<Omit<typeof effect, 'kind'>>) =>
              onUpdate(effect.id, {
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
                  unit="s"
                />
                <span>to</span>
                <SecondsField
                  label={`${name} end of ${position} in seconds`}
                  value={effect.end}
                  max={trimmed}
                  onCommit={(end) => set({ end })}
                  unit="s"
                />
                <span>at</span>
                <SecondsField
                  label={`${name} factor of ${position}`}
                  value={effect.factor}
                  min={0.05}
                  max={10}
                  step={0.25}
                  onCommit={(factor) => set({ factor })}
                  unit="×"
                />
                <button
                  type="button"
                  aria-label={`Remove speed segment ${kindIndex(effect.id, 'speed')} from ${position}`}
                  onClick={() => onRemove(effect.id)}
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
                    onUpdate(effect.id, { kind: 'pause', at, hold: effect.hold })
                  }
                  unit="s"
                />
                <span>hold</span>
                <SecondsField
                  label={`${name} hold of ${position} in seconds`}
                  value={effect.hold}
                  min={0.1}
                  max={86400}
                  onCommit={(hold) =>
                    onUpdate(effect.id, { kind: 'pause', at: effect.at, hold })
                  }
                  unit="s"
                />
                <button
                  type="button"
                  aria-label={`Remove pause ${kindIndex(effect.id, 'pause')} from ${position}`}
                  onClick={() => onRemove(effect.id)}
                >
                  ✕
                </button>
              </div>
            )
          })()
        ),
      )}
    </>
  )
}

interface BorderControlsProps {
  /** The accessible name of the row's owner (a video or image overlay). */
  position: string
  border: OverlayBorder | undefined
  /** The output frame, which the thickness is shown in px against. */
  frameSize: { width: number; height: number }
  /** Receives the full border on every edit; a thickness of 0 clears it (#697). */
  onCommit: (border: OverlayBorder) => void
}

/**
 * Per-overlay border controls (#697): a colour and a thickness, one row in
 * the per-item-controls idiom, beside Shape — the border hugs the silhouette
 * the shape mask cuts. The thickness is stored as a fraction of the output
 * frame's shorter side and shown in px at the current output frame, as a
 * shape's border is (#683); 0 is no border. Choosing a colour with no border
 * yet starts one at a default 4 px, so the choice shows rather than being
 * discarded with the absent border.
 */
function BorderControls({ position, border, frameSize, onCommit }: BorderControlsProps) {
  const toPx = (fraction: number) => shorterSidePixels(fraction, frameSize.width, frameSize.height)
  const fromPx = (px: number) => shorterSideFraction(px, frameSize.width, frameSize.height)
  const color = border?.color ?? DEFAULT_OVERLAY_BORDER_COLOR
  return (
    <div className="timeline-entry-color">
      <span>Border</span>
      <LabelledField text="colour">
        <input
          type="color"
          aria-label={`Border colour of ${position}`}
          value={color}
          onChange={(event) =>
            onCommit({
              color: event.target.value,
              thickness: border?.thickness ?? fromPx(DEFAULT_OVERLAY_BORDER_PX),
            })
          }
        />
      </LabelledField>
      <LabelledField text="thickness">
        <SecondsField
          label={`Border thickness of ${position} in pixels`}
          // Hundredths, so a thickness typed at another frame size reads
          // without float noise.
          value={border === undefined ? 0 : Math.round(toPx(border.thickness) * 100) / 100}
          max={Math.floor(toPx(MAX_OVERLAY_BORDER))}
          step={1}
          slider
          onCommit={(px) => onCommit({ color, thickness: Math.min(fromPx(px), MAX_OVERLAY_BORDER) })}
          unit="px"
        />
      </LabelledField>
    </div>
  )
}

interface ShadowControlsProps {
  /** The accessible name of the row's owner (a video or image overlay). */
  position: string
  shadow: OverlayShadow | undefined
  /** The output frame, which blur and offsets are shown in px against. */
  frameSize: { width: number; height: number }
  /** Receives the full shadow on every edit, or `null` when it is turned off (#698). */
  onCommit: (shadow: OverlayShadow | null) => void
}

/**
 * Per-overlay drop-shadow controls (#698), beside Border: a Shadow checkbox
 * turns it on (black, 50 %, a soft blur, down and to the right) and off;
 * while on, its colour, opacity, blur and x/y offset. Blur and offsets are
 * stored as fractions of the output frame's shorter side and shown in px at
 * the current output frame, as the border's thickness is (#697); an offset
 * may be negative, so the shadow can fall up or left.
 */
function ShadowControls({ position, shadow, frameSize, onCommit }: ShadowControlsProps) {
  const toPx = (fraction: number) => shorterSidePixels(fraction, frameSize.width, frameSize.height)
  const fromPx = (px: number) => shorterSideFraction(px, frameSize.width, frameSize.height)
  // Hundredths, so a value typed at another frame size reads without float noise.
  const shownPx = (fraction: number) => Math.round(toPx(fraction) * 100) / 100
  const maxBlurPx = Math.floor(toPx(MAX_OVERLAY_SHADOW_BLUR))
  const maxOffsetPx = Math.floor(toPx(MAX_OVERLAY_SHADOW_OFFSET))
  const set = (change: Partial<OverlayShadow>) => {
    if (shadow !== undefined) onCommit({ ...shadow, ...change })
  }
  return (
    <div className="timeline-entry-color">
      <label>
        <input
          type="checkbox"
          aria-label={`Shadow of ${position}`}
          checked={shadow !== undefined}
          onChange={(event) =>
            onCommit(
              event.target.checked
                ? {
                    color: DEFAULT_OVERLAY_SHADOW_COLOR,
                    opacity: DEFAULT_OVERLAY_SHADOW_OPACITY,
                    blur: fromPx(DEFAULT_OVERLAY_SHADOW_BLUR_PX),
                    offsetX: fromPx(DEFAULT_OVERLAY_SHADOW_OFFSET_PX),
                    offsetY: fromPx(DEFAULT_OVERLAY_SHADOW_OFFSET_PX),
                  }
                : null,
            )
          }
        />
        Shadow
      </label>
      {shadow !== undefined && (
        <>
          <LabelledField text="colour">
            <input
              type="color"
              aria-label={`Shadow colour of ${position}`}
              value={shadow.color}
              onChange={(event) => set({ color: event.target.value })}
            />
          </LabelledField>
          <LabelledField text="opacity">
            <SecondsField
              label={`Shadow opacity of ${position} in percent`}
              value={Math.round(shadow.opacity * 100)}
              max={100}
              step={5}
              slider
              onCommit={(percent) => set({ opacity: percent / 100 })}
              unit="%"
            />
          </LabelledField>
          <LabelledField text="blur">
            <SecondsField
              label={`Shadow blur of ${position} in pixels`}
              value={shownPx(shadow.blur)}
              max={maxBlurPx}
              step={1}
              slider
              onCommit={(px) => set({ blur: Math.min(fromPx(px), MAX_OVERLAY_SHADOW_BLUR) })}
              unit="px"
            />
          </LabelledField>
          <LabelledField text="x">
            <SecondsField
              label={`Shadow x offset of ${position} in pixels`}
              value={shownPx(shadow.offsetX)}
              min={-maxOffsetPx}
              max={maxOffsetPx}
              step={1}
              onCommit={(px) => set({ offsetX: fromPx(px) })}
              unit="px"
            />
          </LabelledField>
          <LabelledField text="y">
            <SecondsField
              label={`Shadow y offset of ${position} in pixels`}
              value={shownPx(shadow.offsetY)}
              min={-maxOffsetPx}
              max={maxOffsetPx}
              step={1}
              onCommit={(px) => set({ offsetY: fromPx(px) })}
              unit="px"
            />
          </LabelledField>
        </>
      )}
    </div>
  )
}

interface BackgroundFillControlsProps {
  /** The accessible name of the row's owner (a video/image entry). */
  position: string
  fill: BackgroundFill | undefined
  /** Receives the full fill on every edit; `{ kind: 'none' }` resets (#259). */
  onCommit: (fill: BackgroundFillInput) => void
}

/**
 * Per-entry background-fill controls (#259): a kind selector (none — today's
 * black bars — blur, or a flat color) plus the color input when `color` is
 * picked — one row in the per-entry-controls idiom, on video/image sequence
 * entries only (a slate fills its frame by construction; an overlay renders
 * in its own rectangle with no bars behind it). Every edit commits the full
 * fill; the reducer normalizes (`none` returns the entry to its
 * stored-key-free identity).
 */
function BackgroundFillControls({ position, fill, onCommit }: BackgroundFillControlsProps) {
  return (
    <div className="timeline-entry-color">
      <span>Background</span>
      <select
        aria-label={`Background fill of ${position}`}
        value={fill?.kind ?? 'none'}
        onChange={(event) => {
          const kind = event.target.value as BackgroundFillInput['kind']
          if (kind === 'color') {
            onCommit({
              kind: 'color',
              color: fill?.kind === 'color' ? fill.color : DEFAULT_FILL_COLOR,
            })
          } else {
            onCommit({ kind })
          }
        }}
      >
        <option value="none">None</option>
        <option value="blur">Blur</option>
        <option value="color">Color</option>
      </select>
      {fill?.kind === 'color' && (
        <input
          type="color"
          aria-label={`Background fill color of ${position}`}
          value={fill.color}
          onChange={(event) => onCommit({ kind: 'color', color: event.target.value })}
        />
      )}
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
      {/* No "Subtitle style" caption here: since #418 the disclosure button
          that reveals these controls carries that name, and repeating it
          inside would read the heading twice. */}
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
      <LabelledField text="x">
        <SecondsField
          label="Default subtitle centre X (0 to 1)"
          value={effective.x}
          max={1}
          step={0.05}
          onCommit={(x) => commit({ x })}
        />
      </LabelledField>
      <LabelledField text="y">
        <SecondsField
          label="Default subtitle centre Y (0 to 1)"
          value={effective.y}
          max={1}
          step={0.05}
          onCommit={(y) => commit({ y })}
        />
      </LabelledField>
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

/**
 * The timeline's five sections (#300; Shapes since #683), each foldable to
 * its heading. Fixed ids: the sections are structural, not data.
 */
type TimelineSection = 'sequence' | 'audio' | 'overlays' | 'shapes' | 'text'

interface PasteSettingsDialogProps {
  /** The target row's accessible name (its `position` string). */
  name: string
  /** The groups both the copied set and the target hold, canonical order. */
  groups: readonly SettingsGroup[]
  onCancel: () => void
  onApply: (chosen: SettingsGroup[]) => void
}

/**
 * The paste checklist (#315): the ConfirmDialog idiom with a checkbox per
 * compatible settings group, everything checked by default, so a paste is
 * never a surprise overwrite — the user sees exactly what will change
 * before applying. No compatible group means the dialog says so instead of
 * presenting an empty checklist.
 */
function PasteSettingsDialog({ name, groups, onCancel, onApply }: PasteSettingsDialogProps) {
  const [chosen, setChosen] = useState<ReadonlySet<SettingsGroup>>(() => new Set(groups))
  const cancelRef = useRef<HTMLButtonElement>(null)
  const headingId = useId()

  useEffect(() => {
    // Focus starts on the safe action; Escape cancels from anywhere — the
    // ConfirmDialog rules.
    cancelRef.current?.focus()
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onCancel])

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id={headingId}>Paste settings onto {name}?</h3>
        {groups.length === 0 ? (
          <p>None of the copied settings apply to this element.</p>
        ) : (
          <>
            <p>Only the checked settings are applied, as one undoable edit.</p>
            <div className="paste-settings-groups">
              {SETTINGS_GROUPS.filter(({ id }) => groups.includes(id)).map(({ id, label }) => (
                <label key={id}>
                  <input
                    type="checkbox"
                    checked={chosen.has(id)}
                    onChange={(event) => {
                      const next = new Set(chosen)
                      if (event.target.checked) next.add(id)
                      else next.delete(id)
                      setChosen(next)
                    }}
                  />
                  {label}
                </label>
              ))}
            </div>
          </>
        )}
        <div className="dialog-actions">
          <button type="button" ref={cancelRef} onClick={onCancel}>
            Cancel
          </button>
          {groups.length > 0 && (
            <button
              type="button"
              disabled={chosen.size === 0}
              onClick={() => onApply(groups.filter((group) => chosen.has(group)))}
            >
              Apply
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Which sections the timeline currently renders — a lane without elements is
 * not rendered, so it has nothing to fold. Both the fold-state pruning and
 * the timeline-wide Collapse all read this, so folding can only ever apply
 * to a section the user can actually see.
 */
function renderedSectionsOf(timeline: TimelineState): ReadonlySet<TimelineSection> {
  const rendered = new Set<TimelineSection>()
  if (timeline.entries.length > 0) rendered.add('sequence')
  if (audioTracksOf(timeline).length > 0) rendered.add('audio')
  if (videoOverlaysOf(timeline).length > 0) rendered.add('overlays')
  if (shapeGroupsOf(timeline).length > 0) rendered.add('shapes')
  if (textsOf(timeline).length > 0) rendered.add('text')
  return rendered
}

export function Timeline({
  timeline,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onMatchLevels,
  onMoveEntry,
  onDuplicate,
  onRenameElement,
  visualEditors = false,
  onSetCanvasPreset,
  onPasteSettings,
  onRemoveEntry,
  onTrimEntry,
  stepSeconds = DEFAULT_SETTINGS.stepSeconds,
  largeStepSeconds = DEFAULT_SETTINGS.largeStepSeconds,
  onPausePreview,
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
  onAddShapeGroup,
  onUpdateShapeGroup,
  onRemoveShapeGroup,
  frameSize = { width: 1920, height: 1080 },
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
  onSetEntryRedactions,
  onSetEntrySpotlights,
  onSetVideoOverlayCrop,
  onSetVideoOverlayRedactions,
  onSetVideoOverlaySpotlights,
  onSetVideoOverlayMask,
  onSetVideoOverlayBorder,
  onSetVideoOverlayShadow,
  onAddVideoOverlayZoom,
  onUpdateVideoOverlayZoom,
  onRemoveVideoOverlayZoom,
  onAddVideoOverlayRemap,
  onUpdateVideoOverlayRemap,
  onRemoveVideoOverlayRemap,
  onSetEntryBackgroundFill,
  onSetAudioTrackVolume,
  onSetAudioTrackFades,
  onSetAudioTrackDuck,
}: TimelineProps) {
  const { entries } = timeline
  // The transition picker's options live in the registry (#199), which an
  // enabled plugin changes at runtime — subscribe so the select re-renders.
  useSyncExternalStore(transitionRegistry.subscribe, () => transitionRegistry.version)
  const transitionOptions = transitionRegistry.list()
  const transitions = boundaryTransitions(timeline)
  const audioTracks = audioTracksOf(timeline)
  const texts = textsOf(timeline)
  const shapeGroups = shapeGroupsOf(timeline)
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
  // The subtitle import's hidden picker (#249), clicked by Add ▾'s
  // subtitle item (#418) — the same idiom as the media library's clip input.
  const subtitleInputRef = useRef<HTMLInputElement | null>(null)
  // Whether the "Subtitle style ▸" disclosure is open (#418). Session UI
  // state, like `collapsed` below: it is a view of the project's default
  // style, not part of it. Closed to begin with, because the style is
  // something you adjust after seeing imported cues, not before — and an
  // import opens it, which is where the state is set.
  const [subtitleStyleOpen, setSubtitleStyleOpen] = useState(false)
  /**
   * Add ▾'s items (#418). Each says only what it adds: the menu is named
   * for adding, so an item that repeated the word ("Add color slate") would
   * read "Add · Add color slate" — the same reasoning #416 applied to a
   * row's ⋯. None carries a disabled rule, because none of the three
   * buttons had one: all three add something that needs no imported media.
   */
  const addItems: MenuItem[] = [
    { kind: 'action', label: 'Color slate', onSelect: onAddSlate },
    { kind: 'action', label: 'Text overlay', onSelect: onAddText },
    ...(onAddShapeGroup === undefined
      ? []
      : [{ kind: 'action', label: 'Shape group', onSelect: onAddShapeGroup } as MenuItem]),
    {
      kind: 'action',
      label: 'Subtitles from .srt file…',
      onSelect: () => subtitleInputRef.current?.click(),
    },
  ]
  // Collapsed rows (#299): session UI state only — a set of element ids,
  // never part of the project model, the autosave snapshot, or the undo
  // history (collapsing is not an edit). A collapsed row keeps its coverage
  // strip and main line and renders none of its control blocks. Ids of
  // elements no longer on the timeline are pruned after each timeline
  // change, so an element brought back by undo comes back expanded.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set<string>())
  const isCollapsed = (id: string) => collapsed.has(id)
  const toggleCollapsed = (id: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const allElementIds = () => [
    ...entries.map((entry) => entry.id),
    ...audioTracks.map((track) => track.id),
    ...videoOverlays.map((overlay) => overlay.id),
    ...shapeGroups.map((group) => group.id),
    ...texts.map((text) => text.id),
  ]
  // Open "Picture" disclosures (#420, from the approved redesign #401 /
  // feedback #395): the same shape of session UI state as `collapsed`
  // above — a set of element ids, pruned with it, never an edit — but
  // inverted, because a picture group starts closed. An expanded row showed
  // every picture treatment at once: ten to fifteen fields between the
  // timing the user opened the row for and the effects below it. They are
  // one disclosure now, in the `.timeline-disclosure` idiom #418 introduced
  // for "Subtitle style".
  const [pictureOpen, setPictureOpen] = useState<ReadonlySet<string>>(() => new Set<string>())
  const isPictureOpen = (id: string) => pictureOpen.has(id)
  const togglePictureOpen = (id: string) =>
    setPictureOpen((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  useEffect(() => {
    // The timeline reference changes on every committed edit (and never
    // otherwise), which is exactly when an element can have disappeared.
    const live = new Set([
      ...timeline.entries.map((entry) => entry.id),
      ...audioTracksOf(timeline).map((track) => track.id),
      ...videoOverlaysOf(timeline).map((overlay) => overlay.id),
      ...shapeGroupsOf(timeline).map((group) => group.id),
      ...textsOf(timeline).map((text) => text.id),
    ])
    setCollapsed((previous) => {
      const next = new Set([...previous].filter((id) => live.has(id)))
      return next.size === previous.size ? previous : next
    })
    // Picture disclosures are pruned with the collapse set and for the same
    // reason: an element brought back by undo comes back in its default
    // state, which for a picture group is closed.
    setPictureOpen((previous) => {
      const next = new Set([...previous].filter((id) => live.has(id)))
      return next.size === previous.size ? previous : next
    })
  }, [timeline])
  /** The row's collapse/expand toggle (#299): first item of its main line. */
  const collapseToggle = (id: string, position: string) => (
    <button
      type="button"
      className="timeline-collapse-toggle"
      aria-expanded={!isCollapsed(id)}
      aria-label={`${isCollapsed(id) ? 'Expand' : 'Collapse'} ${position}`}
      title={isCollapsed(id) ? 'Expand' : 'Collapse'}
      onClick={() => toggleCollapsed(id)}
    >
      {isCollapsed(id) ? '▸' : '▾'}
    </button>
  )
  /**
   * The picture treatments of one row (#420, from the approved redesign
   * #401 / feedback #395), behind one disclosure: Look/color (#192, #233),
   * orientation (#232), crop (#255), then the one treatment that belongs to
   * the row's kind — a shape mask on an overlay (#266), a background fill
   * on a sequence entry (#259). Timing and Audio stay open above it,
   * because those are what a row is usually expanded for; these are the
   * ten-to-fifteen fields that were in the way.
   *
   * Closed by default and remembered per row for the session, in the
   * `.timeline-disclosure` shape #418 introduced: a `<button
   * aria-expanded>` whose ▸/▾ marker is decorative, since `aria-expanded`
   * is the state assistive tech reads.
   *
   * The summary says which groups are applied, so a closed disclosure still
   * tells you something is on the row. "Applied" is each group's own
   * stored-key-free identity — exactly the condition its Reset button is
   * disabled under, since the reducer normalizes an identity edit back to
   * absent. It sits *outside* the button: the button's visible label is
   * then exactly "Picture", which its accessible name contains (Label in
   * Name, WCAG 2.5.3), and `aria-describedby` still hands the list to a
   * screen reader on focus.
   */
  /**
   * The Crop group's controls (#255) plus, where the Visual editors setting
   * allows (#413), the `Adjust visually…` toggle and the panel it opens
   * (#423). One builder for both wearers: an entry and a video overlay carry
   * the same source description under the same names, so the editor takes
   * either (`CropSubject`) and only the commit differs.
   */
  const cropGroupControls = (
    key: string,
    subject: CropSubject,
    position: string,
    commit: (crop: Crop) => void,
  ) => {
    const editing = editingCropKey === key
    return (
      <>
        <CropControls
          position={position}
          crop={subject.crop}
          onCommit={commit}
          {...(visualEditors
            ? {
                adjust: (
                  // A toggle, so the same button closes what it opened —
                  // the zoom's rule (#413).
                  <button
                    type="button"
                    className="timeline-adjust-button"
                    aria-label={`Adjust the crop of ${position} visually`}
                    aria-expanded={editing}
                    title="Drag the kept region on a still of the source"
                    onClick={() => setEditingCropKey(editing ? null : key)}
                  >
                    Adjust visually…
                  </button>
                ),
              }
            : {})}
        />
        {visualEditors && editing && (
          <CropEditor subject={subject} position={position} onCommit={commit} onClose={() => setEditingCropKey(null)} />
        )}
      </>
    )
  }
  const pictureDisclosure = (
    id: string,
    position: string,
    groups: readonly { name: string; applied: boolean; controls: ReactNode }[],
  ) => {
    const open = isPictureOpen(id)
    const applied = groups.filter((group) => group.applied).map((group) => group.name)
    const appliedId = `picture-applied-${id}`
    return (
      <div className="timeline-picture">
        <div className="timeline-picture-summary">
          <button
            type="button"
            className="timeline-disclosure"
            aria-expanded={open}
            aria-label={`Picture of ${position}`}
            aria-describedby={applied.length > 0 ? appliedId : undefined}
            onClick={() => togglePictureOpen(id)}
          >
            <span aria-hidden="true">{open ? '▾' : '▸'}</span> Picture
          </button>
          {applied.length > 0 && (
            <span className="timeline-picture-applied" id={appliedId}>
              · {applied.join(', ')}
            </span>
          )}
        </div>
        {open && groups.map((group) => <Fragment key={group.name}>{group.controls}</Fragment>)}
      </div>
    )
  }
  // Folded sections (#300): the second level of the same view state. A
  // folded section shows only its heading row; unfolding brings its list
  // back with each element's own collapsed/expanded state untouched. Like
  // the element set, this never reaches the project model, autosave, or the
  // undo history, and a section that stops being rendered (its last element
  // removed) is dropped so it comes back unfolded if it is re-created.
  const [folded, setFolded] = useState<ReadonlySet<TimelineSection>>(
    () => new Set<TimelineSection>(),
  )
  const isFolded = (section: TimelineSection) => folded.has(section)
  const toggleFolded = (section: TimelineSection) =>
    setFolded((previous) => {
      const next = new Set(previous)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  useEffect(() => {
    const rendered = renderedSectionsOf(timeline)
    setFolded((previous) => {
      const next = new Set([...previous].filter((section) => rendered.has(section)))
      return next.size === previous.size ? previous : next
    })
  }, [timeline])
  /** Collapses or expands only the given elements, leaving the rest as they are. */
  const setElementsCollapsed = (ids: readonly string[], collapse: boolean) =>
    setCollapsed((previous) => {
      const next = new Set(previous)
      for (const id of ids) {
        if (collapse) next.add(id)
        else next.delete(id)
      }
      return next
    })
  /**
   * A section's heading row (#300): the lane title, its fold/unfold toggle,
   * and Collapse all / Expand all for just that section's elements.
   */
  const sectionHeading = (
    section: TimelineSection,
    title: string,
    headingClassName: string,
    elementIds: readonly string[],
  ) => (
    <div className="lane-heading-row">
      <button
        type="button"
        className="timeline-collapse-toggle"
        aria-expanded={!isFolded(section)}
        aria-label={`${isFolded(section) ? 'Expand' : 'Collapse'} ${title} section`}
        title={isFolded(section) ? 'Expand section' : 'Collapse section'}
        onClick={() => toggleFolded(section)}
      >
        {isFolded(section) ? '▸' : '▾'}
      </button>
      <h3 className={headingClassName}>{title}</h3>
      <button
        type="button"
        className="lane-heading-action"
        aria-label={`Collapse all ${title} elements`}
        onClick={() => setElementsCollapsed(elementIds, true)}
      >
        Collapse all
      </button>
      <button
        type="button"
        className="lane-heading-action"
        aria-label={`Expand all ${title} elements`}
        onClick={() => {
          // Expand all unfolds the section too (#360, from feedback #354):
          // on a folded section the heading row — this button included —
          // still shows, so expanding only the hidden elements looked like
          // the button did nothing. The timeline-wide Expand all already
          // behaved this way. Collapse all deliberately keeps folding
          // nothing: the customer's stated constraint.
          setFolded((previous) => {
            if (!previous.has(section)) return previous
            const next = new Set(previous)
            next.delete(section)
            return next
          })
          setElementsCollapsed(elementIds, false)
        }}
      >
        Expand all
      </button>
    </div>
  )
  // Inline rename (#405): which element's name is being edited, if any —
  // one at a time, since the field takes the name's place in its row. View
  // state only; the committed name is the reducer's.
  const [renaming, setRenaming] = useState<string | null>(null)
  // Which sequence entry's Trim window (#707) is open, if any: one at a
  // time, since it is a modal dialog. View state only; Apply is the one
  // edit it makes.
  const [trimmingId, setTrimmingId] = useState<string | null>(null)
  // Match levels (#691): whether a run is measuring, and the last run's
  // report — a status line under the header, not a dialog (#395), until
  // dismissed or replaced by the next run's.
  const [matching, setMatching] = useState(false)
  const [matchReport, setMatchReport] = useState<string | null>(null)
  const matchLevels = () => {
    if (onMatchLevels === undefined || matching) return
    setMatching(true)
    onMatchLevels()
      .then((report) => setMatchReport(report))
      .catch(() => setMatchReport('Match levels could not measure the sound; no Volume was changed.'))
      .finally(() => setMatching(false))
  }
  const nameCell = (
    id: string,
    name: string,
    position: string,
    /** A shape group's own name can be cleared, back to the derived one (#687). */
    clearable = false,
  ) =>
    renaming === id ? (
      <NameField
        label={`New name for ${position}`}
        value={name}
        allowEmpty={clearable}
        onCommit={(next) => {
          setRenaming(null)
          if (next !== name) onRenameElement?.(id, next)
        }}
        onCancel={() => setRenaming(null)}
      />
    ) : (
      /* Double-clicking the name edits it. Since #419 that is the only
         gesture on the row itself: the ✎ that sat beside the name moved
         into the row's ⋯ menu, because renaming is infrequent and the
         plan's rule is frequent → visible. The double-click is why it
         could move without costing anyone a click. */
      <span
        className="clip-name timeline-name"
        title={name}
        onDoubleClick={onRenameElement === undefined ? undefined : () => setRenaming(id)}
      >
        {name}
      </span>
    )
  // Which zoom's visual editor (#413) is open, if any — one at a time, since
  // each renders a still of the frame. View state only.
  const [editingZoomId, setEditingZoomId] = useState<string | null>(null)
  // Which overlay's placement editor is open (#422) — session UI, like the
  // zoom's above and the collapse set (#299): never part of the project
  // model, the autosave snapshot, or the undo history.
  const [editingOverlayId, setEditingOverlayId] = useState<string | null>(null)
  // Which element's crop editor is open (#423), as `entry:<id>` or
  // `overlay:<id>` — session UI like the two above. Prefixed because an
  // entry and an overlay are separate id spaces, and one editor is open at a
  // time because each renders a still of its own source.
  const [editingCropKey, setEditingCropKey] = useState<string | null>(null)
  // Which text overlay's placement editor is open (#424) — session UI like
  // the three above, and one at a time for the same reason.
  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  // The shape group whose shapes are open in the shape editor (#685).
  const [editingShapeGroupId, setEditingShapeGroupId] = useState<string | null>(null)
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null)

  // Copy settings / Paste settings (#315). The copied settings are SESSION
  // state, owned here exactly like the collapse state above: never written
  // to the project model, project files, or the autosave snapshot — a
  // reload starts with nothing copied, and copying is not an edit. Only a
  // paste reaches the model, through onPasteSettings.
  const [copiedSettings, setCopiedSettings] = useState<CopiedSettings | null>(null)
  const [pendingPaste, setPendingPaste] = useState<{
    kind: SettingsElementKind
    id: string
    name: string
    groups: SettingsGroup[]
  } | null>(null)
  /**
   * A row's ⋯ menu (#419, from the approved redesign #401 / feedback #395).
   * Each item is present exactly where its button was: Duplicate only where
   * App wires it, Copy settings only on a row holding at least one settings
   * group (a slate holds none), Paste only on those same rows once
   * something is copied (#315), Rename only where the row shows a name to
   * edit — a text overlay's row shows its content, and had no ✎ either.
   *
   * The menu also repeats the main line's single-operation buttons (#622,
   * the customer's #619): Move up and Move down where the row has ↑ ↓ (a
   * sequence entry), disabled exactly where the arrows are, and Remove on
   * every row. Each goes through the same path as its button — Remove opens
   * the same confirmation with the same text — and the buttons stay.
   *
   * Items say only what they do and the panel is named for the row, which
   * is what #416 settled: an item labelled for the row as well ("Duplicate
   * a.mp4 at position 1" over a visible "Duplicate") would be an accessible
   * name that does not contain its own visible label (WCAG 2.5.3).
   */
  const rowActionsMenu = (
    kind: SettingsElementKind,
    element: Parameters<typeof copyElementSettings>[1],
    position: string,
    {
      renamable = true,
      removal,
      move,
    }: {
      renamable?: boolean
      /** What the row's ✕ asks to confirm; the menu's Remove asks the same. */
      removal: PendingRemoval
      /** The row's ↑ ↓, where it has them: which way it can move, and how. */
      move?: { canMoveUp: boolean; canMoveDown: boolean; onMove: (direction: 'up' | 'down') => void }
    },
  ) => {
    const order: MenuItem[] =
      move === undefined
        ? []
        : [
            {
              kind: 'action',
              label: 'Move up',
              disabled: !move.canMoveUp,
              onSelect: () => move.onMove('up'),
            },
            {
              kind: 'action',
              label: 'Move down',
              disabled: !move.canMoveDown,
              onSelect: () => move.onMove('down'),
            },
          ]
    // Duplicating and the settings clipboard both copy what the row holds,
    // so they group together; renaming edits its identity, which is the
    // grouping the library's ⋯ uses (#416).
    const copies: MenuItem[] = []
    if (onDuplicate !== undefined) {
      copies.push({
        kind: 'action',
        label: 'Duplicate',
        onSelect: () => onDuplicate(kind, element.id),
      })
    }
    if (onPasteSettings !== undefined && heldSettingsGroups(kind, element).length > 0) {
      copies.push({
        kind: 'action',
        label: 'Copy settings',
        onSelect: () => setCopiedSettings(copyElementSettings(kind, element) ?? null),
      })
      if (copiedSettings !== null) {
        copies.push({
          kind: 'action',
          label: 'Paste settings',
          onSelect: () =>
            setPendingPaste({
              kind,
              id: element.id,
              name: position,
              groups: compatibleSettingsGroups(copiedSettings, kind, element),
            }),
        })
      }
    }
    const identity: MenuItem[] =
      renamable && onRenameElement !== undefined
        ? [
            {
              kind: 'action',
              label: 'Rename…',
              title: 'Rename (or double-click the name)',
              onSelect: () => setRenaming(element.id),
            },
          ]
        : []
    // Destructive last, as the library's ⋯ puts it (#416).
    const remove: MenuItem[] = [
      { kind: 'action', label: 'Remove', onSelect: () => setPendingRemoval(removal) },
    ]
    // Groups are joined only where both sides exist, so no menu opens on a
    // separator — a text overlay's opens on Duplicate.
    const items = [order, copies, identity, remove]
      .filter((group) => group.length > 0)
      .flatMap((group, index) =>
        index === 0 ? group : [{ kind: 'separator' } as MenuItem, ...group],
      )
    return (
      <Menu
        label="⋯"
        caret={false}
        ariaLabel={`More actions for ${position}`}
        menuLabel={`More actions for ${position}`}
        className="timeline-row-more"
        items={items}
      />
    )
  }

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
        {/* Collapse/expand every element on the timeline at once (#299) and,
            since #300, fold/unfold every section with it; the per-row and
            per-section toggles sit on the rows and the section headings. */}
        {/* The pair stays a pair (#418 asks for "one compact pair"): the
            header is `justify-content: space-between`, so two bare glyph
            buttons were spread to opposite ends of it — measured 119px
            apart at 1280, reading as two unrelated controls rather than one
            collapse/expand control. Grouping them is what #416 did for the
            library row's actions, for the same reason. */}
        <div className="timeline-fold-group">
          <button
            type="button"
            className="timeline-fold-all"
            aria-label="Collapse all timeline elements"
            title="Collapse all timeline elements"
            onClick={() => {
              setCollapsed(new Set(allElementIds()))
              // Only the sections on the timeline now — like the element
              // set above, which names existing ids only. Folding a section
              // that is not rendered yet would outlive this click: the
              // pruning effect keeps a fold whose section is rendered by the
              // time the timeline next changes, so the lane that change
              // creates would arrive folded and hide the element the user
              // just added.
              setFolded(new Set(renderedSectionsOf(timeline)))
            }}
          >
            ▲
          </button>
          <button
            type="button"
            className="timeline-fold-all"
            aria-label="Expand all timeline elements"
            title="Expand all timeline elements"
            onClick={() => {
              setCollapsed(new Set<string>())
              setFolded(new Set<TimelineSection>())
            }}
          >
            ▼
          </button>
        </div>
        {/* Add ▾ (#418, from the approved redesign #401 option T1 / feedback
            #395): the three things that can join the timeline without any
            imported media, behind one labelled menu. Each item calls exactly
            what its button called — a slate needs no media (#143), a text
            overlay is anchored to sequence time rather than to a clip
            (#139), and subtitles are sequence-anchored text overlays (#249),
            which is why all three were here rather than in the library. The
            third still opens the same hidden input below. */}
        <Menu label="Add" menuLabel="Add menu" className="timeline-add-menu" items={addItems} />
        {/* Match levels (#691): in the header rather than the Audio
            heading the issue suggested, because that heading exists only
            while the project has an audio track, and the action covers
            video entries and overlays too. */}
        {onMatchLevels !== undefined && (
          <button
            type="button"
            className="timeline-match-levels"
            title="Match levels: measure the sound of every video clip, video overlay and audio track, in every section, and set each one's Volume toward the target in Settings. One Undo restores them all."
            disabled={matching}
            onClick={matchLevels}
          >
            {matching ? 'Matching…' : 'Match levels'}
          </button>
        )}
        <input
          ref={subtitleInputRef}
          type="file"
          accept=".srt"
          hidden
          data-testid="subtitle-file-input"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file !== undefined) {
              onImportSubtitles(file)
              // The import opens the style disclosure (#418): the cues that
              // just arrived are the reason to look at their style, and the
              // disclosure is not rendered at all until they exist. The
              // rule is the simpler of the two the issue allows — every
              // import opens it, rather than only the first, or only when
              // the user has not closed it before. That needs no memory of
              // what the user did earlier, and re-opening after an import
              // the user asked for is not a surprise; a "they closed it
              // deliberately" flag could be added if it turns out to be.
              // A failed import leaves no cues, so the disclosure stays
              // unrendered and this open state is simply not visible.
              setSubtitleStyleOpen(true)
            }
            // Allow re-importing the same file (e.g. after fixing it).
            event.target.value = ''
          }}
        />
        <span className="timeline-total">
          Total: <span data-testid="timeline-total">{formatDuration(totalDuration(timeline))}</span>
        </span>
        {/* The canvas aspect (#273) describes this sequence, so #415 moved
            it here from the page header, unchanged: same label, same Auto
            semantics, same reducer action. */}
        {onSetCanvasPreset !== undefined && (
          <label className="project-canvas-preset">
            Canvas
            <select
              aria-label="Canvas aspect"
              // Auto is the absent preset (#273), so the empty option value is
              // what maps to it — never an 'auto' identifier.
              value={timeline.canvasPreset ?? ''}
              onChange={(event) =>
                onSetCanvasPreset(
                  event.target.value === '' ? undefined : (event.target.value as CanvasPreset),
                )
              }
            >
              <option value="">Auto (match sources)</option>
              {CANVAS_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {matchReport !== null && (
        <p className="timeline-match-report" role="status" aria-label="Match levels report">
          <span>{matchReport}</span>
          <button
            type="button"
            className="timeline-match-report-dismiss"
            aria-label="Dismiss the Match levels report"
            onClick={() => setMatchReport(null)}
          >
            ✕
          </button>
        </p>
      )}

      {/* The default subtitle style (#250) lives beside the import it
          governs — all imported subtitles restyle at once. Since #418 it is
          a collapsed disclosure rather than an always-visible row: eight
          controls that most sessions never touch cost the header's whole
          second line, which is what feedback #395 was about. It renders
          only where it can do something — with no text overlays there is
          nothing to restyle — so the "editable before the first import"
          part of #250 is what this trades away, deliberately: an import
          opens the disclosure, and every cue it brings in takes the default
          style anyway, so adjusting it immediately after is the same edit
          one keystroke later. */}
      {texts.length > 0 && (
        <div className="timeline-subtitle-style">
          <button
            type="button"
            className="timeline-disclosure"
            aria-expanded={subtitleStyleOpen}
            onClick={() => setSubtitleStyleOpen((open) => !open)}
          >
            {/* The marker is decorative: `aria-expanded` above is the state
                assistive tech reads, so a screen reader is not told "right
                pointing triangle". */}
            <span aria-hidden="true">{subtitleStyleOpen ? '▾' : '▸'}</span> Subtitle style
          </button>
          {subtitleStyleOpen && (
            <SubtitleStyleControls style={subtitleStyle} onCommit={onSetSubtitleStyle} />
          )}
        </div>
      )}

      {entries.length === 0 ? (
        <p className="placeholder">
          The sequence is empty. Add clips from the media library to start building your edit.
        </p>
      ) : (
        <div className="sequence-lane">
          {/* The main section gets a subtitle like every other lane (#299):
              video clips, images, and color slates are the sequence. */}
          {sectionHeading(
            'sequence',
            'Sequence',
            'sequence-lane-heading',
            entries.map((entry) => entry.id),
          )}
        {!isFolded('sequence') && (
        <ol className="timeline-list" aria-label="Sequence">
          {entries.map((entry, index) => {
            const position = `${entry.name} at position ${index + 1}`
            // One confirmation for the ✕ and the ⋯'s Remove (#622).
            const entryRemoval: PendingRemoval = {
              name: position,
              consequence:
                'Transitions at its boundaries and any zooms or time remapping on it are removed with it.',
              action: () => onRemoveEntry(entry.id),
            }
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
                  {collapseToggle(entry.id, position)}
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
                  {nameCell(entry.id, entry.name, position)}
                  <span className="clip-duration">{formatDuration(effectiveDuration(entry))}</span>
                  {/* One cluster, not loose buttons (#416's lesson): the
                      row's remaining actions stay together at its right
                      edge whatever the name's width. */}
                  <span className="timeline-row-actions">
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
                    {rowActionsMenu('entry', entry, position, {
                      removal: entryRemoval,
                      move: {
                        canMoveUp: index > 0,
                        canMoveDown: index < entries.length - 1,
                        onMove: (direction) => onMoveEntry(entry.id, direction),
                      },
                    })}
                    <button
                      type="button"
                      aria-label={`Remove ${position} from timeline`}
                      onClick={() => setPendingRemoval(entryRemoval)}
                    >
                      ✕
                    </button>
                  </span>
                </div>
                {!isCollapsed(entry.id) && (
                  <>
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
                      unit="s"
                    />
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
                        unit="s"
                      />
                      <span>Out</span>
                      <SecondsField
                        label={`Trim out point of ${position} in seconds`}
                        value={entry.outPoint}
                        max={entry.duration}
                        onCommit={(outPoint) => onTrimEntry(entry.id, entry.inPoint, outPoint)}
                        unit="s"
                      />
                      {/* The Trim window (#707): a second way to set the
                          same two numbers, watching the clip. */}
                      <button
                        type="button"
                        className="timeline-trim-open"
                        aria-label={`Trim ${position} in the Trim window`}
                        aria-haspopup="dialog"
                        title="Trim in a window: watch the clip and drag In and Out on it"
                        onClick={() => setTrimmingId(entry.id)}
                      >
                        Trim…
                      </button>
                      {trimmingId === entry.id && (
                        <TrimDialog
                          entry={entry}
                          position={position}
                          stepSeconds={stepSeconds}
                          largeStepSeconds={largeStepSeconds}
                          onOpen={onPausePreview}
                          onApply={(inPoint, outPoint) => {
                            setTrimmingId(null)
                            onTrimEntry(entry.id, inPoint, outPoint)
                          }}
                          onClose={() => setTrimmingId(null)}
                        />
                      )}
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
                        label={`Volume of ${position} (0 to ${MAX_VOLUME})`}
                        value={entry.volume ?? 1}
                        max={MAX_VOLUME}
                        mark={1}
                        step={0.05}
                        slider
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
                      <LabelledField text="Fade in">
                        <SecondsField
                          label={`Audio fade-in of ${position} in seconds`}
                          value={entry.fadeIn ?? 0}
                          max={entryOutputDuration(entry, remapsOf(timeline))}
                          slider
                          onCommit={(fadeIn) => onSetEntryFades(entry.id, fadeIn, entry.fadeOut ?? 0)}
                          unit="s"
                        />
                      </LabelledField>
                      <LabelledField text="out">
                        <SecondsField
                          label={`Audio fade-out of ${position} in seconds`}
                          value={entry.fadeOut ?? 0}
                          max={entryOutputDuration(entry, remapsOf(timeline))}
                          slider
                          onCommit={(fadeOut) => onSetEntryFades(entry.id, entry.fadeIn ?? 0, fadeOut)}
                          unit="s"
                        />
                      </LabelledField>
                    </div>
                  </>
                )}
                {/* The entry's picture treatments (#420), under one
                    disclosure. Each was its own always-visible row until
                    then, and each still renders only for video and image
                    entries — a slate's color is set directly above (#143),
                    and a flat color has no sideways (#232), nothing to trim
                    (#255) and no bars to fill behind it (#259) — so a slate
                    has no picture group at all rather than an empty one. */}
                {!isSlateEntry(entry) &&
                  pictureDisclosure(entry.id, position, [
                    {
                      name: 'Color',
                      applied: entry.colorAdjustments !== undefined,
                      controls: (
                        <ColorAdjustmentControls
                          position={position}
                          adjustments={entry.colorAdjustments}
                          onCommit={(adjustments) => onSetEntryColor(entry.id, adjustments)}
                        />
                      ),
                    },
                    {
                      name: 'Orientation',
                      applied: entry.orientation !== undefined,
                      controls: (
                        <OrientationControls
                          position={position}
                          orientation={entry.orientation}
                          onCommit={(orientation) => onSetEntryOrientation(entry.id, orientation)}
                        />
                      ),
                    },
                    {
                      name: 'Crop',
                      applied: entry.crop !== undefined,
                      controls: cropGroupControls(`entry:${entry.id}`, entry, position, (crop) =>
                        onSetEntryCrop(entry.id, crop),
                      ),
                    },
                    {
                      name: 'Background',
                      applied: entry.backgroundFill !== undefined,
                      controls: (
                        <BackgroundFillControls
                          position={position}
                          fill={entry.backgroundFill}
                          onCommit={(fill) => onSetEntryBackgroundFill(entry.id, fill)}
                        />
                      ),
                    },
                    {
                      name: 'Spotlight',
                      applied: entry.spotlights !== undefined,
                      controls: (
                        <SpotlightControls
                          position={position}
                          regions={entry.spotlights}
                          subject={entry}
                          visualEditors={visualEditors}
                          inPoint={entry.inPoint}
                          outPoint={entry.outPoint}
                          duration={entry.duration}
                          onCommit={(regions) => onSetEntrySpotlights(entry.id, regions)}
                        />
                      ),
                    },
                    {
                      name: 'Redact',
                      applied: entry.redactions !== undefined,
                      controls: (
                        <RedactionControls
                          position={position}
                          regions={entry.redactions}
                          subject={entry}
                          visualEditors={visualEditors}
                          inPoint={entry.inPoint}
                          outPoint={entry.outPoint}
                          duration={entry.duration}
                          onCommit={(regions) => onSetEntryRedactions(entry.id, regions)}
                        />
                      ),
                    },
                  ])}
                {(() => {
                  // An entry carries any number of non-overlapping zooms
                  // (#129), each independently editable; the accessible
                  // names number them per entry, in window (start) order —
                  // the order the normalized state stores them in.
                  const entryZooms = zoomsForEntry(timeline, entry.id)
                  return (
                    <>
                      {entryZooms.map((entryZoom, zoomIndex) => {
                        const zoomName = `Zoom ${zoomIndex + 1}`
                        const editing = editingZoomId === entryZoom.id
                        return (
                          <Fragment key={entryZoom.id}>
                            <ZoomFieldsRow
                              zoom={entryZoom}
                              zoomIndex={zoomIndex}
                              position={position}
                              maxStart={effectiveDuration(entry)}
                              onUpdate={(spec) => onUpdateZoom(entryZoom.id, spec)}
                              onRemove={() => onRemoveZoom(entryZoom.id)}
                            >
                              {visualEditors && (
                                // The visual editor (#413): a toggle, so the
                                // same button closes what it opened.
                                <button
                                  type="button"
                                  className="timeline-adjust-button"
                                  aria-label={`Adjust ${zoomName} of ${position} visually`}
                                  aria-expanded={editing}
                                  title="Drag the zoom's region on a still of the frame"
                                  onClick={() => setEditingZoomId(editing ? null : entryZoom.id)}
                                >
                                  Adjust visually…
                                </button>
                              )}
                            </ZoomFieldsRow>
                            {visualEditors && editing && (
                              <ZoomEditor
                                timeline={timeline}
                                entryIndex={index}
                                zoom={entryZoom}
                                zoomName={zoomName}
                                position={position}
                                onUpdate={(spec) => onUpdateZoom(entryZoom.id, spec)}
                                onClose={() => setEditingZoomId(null)}
                              />
                            )}
                          </Fragment>
                        )
                      })}
                    </>
                  )
                })()}
                {!isStillEntry(entry) && (
                  // Time-remap effects (#141): speed segments and pauses,
                  // each independently editable like a zoom. Stills carry
                  // none — their one duration already sets their timing
                  // (#138).
                  <RemapFieldRows
                    position={position}
                    effects={remapsForEntry(timeline, entry.id)}
                    trimmed={effectiveDuration(entry)}
                    onUpdate={onUpdateRemap}
                    onRemove={onRemoveRemap}
                  />
                )}
                {/* + Effect ▾ (#419, from the approved redesign #401 /
                    feedback #395): the three things an expanded entry can
                    grow — a zoom (#129), a speed segment and a pause (#141)
                    — behind one menu, below the lists of the ones it
                    already has. Each item does exactly what its button did
                    and is enabled under exactly the same condition: the
                    default the library offers for the next one, or nothing
                    if there is no room left for it. A still carries no time
                    remapping at all (#138, its one duration is its timing),
                    so its menu offers Zoom alone rather than two items
                    permanently disabled. */}
                {(() => {
                  const addableZoom = defaultZoomFor(
                    zoomsForEntry(timeline, entry.id),
                    effectiveDuration(entry),
                  )
                  const items: MenuItem[] = [
                    {
                      kind: 'action',
                      label: 'Zoom',
                      disabled: addableZoom === null,
                      onSelect: () => addableZoom !== null && onAddZoom(entry.id, addableZoom),
                    },
                  ]
                  if (!isStillEntry(entry)) {
                    const entryRemaps = remapsForEntry(timeline, entry.id)
                    const trimmed = effectiveDuration(entry)
                    const addableSpeed = defaultSpeedFor(entryRemaps, trimmed)
                    const addablePause = defaultPauseFor(entryRemaps, trimmed)
                    items.push(
                      {
                        kind: 'action',
                        label: 'Speed segment',
                        disabled: addableSpeed === null,
                        onSelect: () => addableSpeed !== null && onAddRemap(entry.id, addableSpeed),
                      },
                      {
                        kind: 'action',
                        label: 'Pause',
                        disabled: addablePause === null,
                        onSelect: () => addablePause !== null && onAddRemap(entry.id, addablePause),
                      },
                    )
                  }
                  return (
                    <div className="timeline-entry-effects">
                      <Menu
                        label="+ Effect"
                        ariaLabel={`+ Effect on ${position}`}
                        menuLabel={`+ Effect on ${position}`}
                        triggerClassName="timeline-effect-add"
                        items={items}
                      />
                    </div>
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
                          {transitionOptions.map((definition) => (
                            <option key={definition.id} value={definition.id}>
                              {definition.name}
                            </option>
                          ))}
                          {!transitionRegistry.has(transition.type) && (
                            // A type whose plugin is disabled (#199): keep the
                            // stored value selectable and name it, instead of
                            // the select silently showing the first option.
                            <option value={transition.type}>
                              {transition.type} (unavailable)
                            </option>
                          )}
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
                          unit="s"
                        />
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
                  </>
                )}
              </li>
            )
          })}
        </ol>
        )}
        </div>
      )}

      {audioTracks.length > 0 && (
        <div className="audio-lane">
          {sectionHeading('audio', 'Audio', 'audio-lane-heading', audioTracks.map((track) => track.id))}
          {!isFolded('audio') && (
          <ol className="audio-track-list" aria-label="Audio tracks">
            {audioTracks.map((track, index) => {
              const position = `audio track ${track.name} at position ${index + 1}`
              const trackRemoval: PendingRemoval = {
                name: position,
                consequence: 'The clip itself stays in the media library.',
                action: () => onRemoveAudioTrack(track.id),
              }
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
                    {collapseToggle(track.id, position)}
                    {nameCell(track.id, track.name, position)}
                    <span className="clip-duration">{formatDuration(trimmedLength)}</span>
                    <span className="timeline-row-actions">
                      {rowActionsMenu('audio-track', track, position, { removal: trackRemoval })}
                      <button
                        type="button"
                        aria-label={`Remove ${position} from timeline`}
                        onClick={() => setPendingRemoval(trackRemoval)}
                      >
                        ✕
                      </button>
                    </span>
                  </div>
                  {!isCollapsed(track.id) && (
                    <>
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
                      unit="s"
                    />
                    <span>In</span>
                    <SecondsField
                      label={`Trim in point of ${position} in seconds`}
                      value={track.inPoint}
                      max={track.duration}
                      onCommit={(inPoint) => onTrimAudioTrack(track.id, inPoint, track.outPoint)}
                      unit="s"
                    />
                    <span>Out</span>
                    <SecondsField
                      label={`Trim out point of ${position} in seconds`}
                      value={track.outPoint}
                      max={track.duration}
                      onCommit={(outPoint) => onTrimAudioTrack(track.id, track.inPoint, outPoint)}
                      unit="s"
                    />
                    <span className="timeline-entry-effective">
                      plays {formatSeconds(trimmedLength)}s of {formatSeconds(track.duration)}s
                    </span>
                  </div>
                  <div className="audio-track-gain">
                    <span>Volume</span>
                    <SecondsField
                      label={`Volume of ${position} (0 to ${MAX_VOLUME})`}
                      value={track.volume ?? 1}
                      max={MAX_VOLUME}
                      mark={1}
                      step={0.05}
                      slider
                      onCommit={(volume) => onSetAudioTrackVolume(track.id, volume)}
                    />
                    <LabelledField text="Fade in">
                      <SecondsField
                        label={`Fade-in of ${position} in seconds`}
                        value={track.fadeIn ?? 0}
                        max={trimmedLength}
                        slider
                        onCommit={(fadeIn) =>
                          onSetAudioTrackFades(track.id, fadeIn, track.fadeOut ?? 0)
                        }
                        unit="s"
                      />
                    </LabelledField>
                    <LabelledField text="out">
                      <SecondsField
                        label={`Fade-out of ${position} in seconds`}
                        value={track.fadeOut ?? 0}
                        max={trimmedLength}
                        slider
                        onCommit={(fadeOut) =>
                          onSetAudioTrackFades(track.id, track.fadeIn ?? 0, fadeOut)
                        }
                        unit="s"
                      />
                    </LabelledField>
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
                    </>
                  )}
                </li>
              )
            })}
          </ol>
          )}
        </div>
      )}

      {videoOverlays.length > 0 && (
        <div className="overlay-lane">
          {sectionHeading(
            'overlays',
            'Overlays',
            'overlay-lane-heading',
            videoOverlays.map((overlay) => overlay.id),
          )}
          {!isFolded('overlays') && (
          <ol className="video-overlay-list" aria-label="Overlay layers">
            {videoOverlays.map((overlay, index) => {
              const position = `overlay ${overlay.name} at position ${index + 1}`
              const overlayRemoval: PendingRemoval = {
                name: position,
                consequence: 'The clip itself stays in the media library.',
                action: () => onRemoveVideoOverlay(overlay.id),
              }
              const trimmedLength = effectiveDuration(overlay)
              // What the overlay occupies on screen: its trim, through its
              // speed segments and pauses (#700) — the bar and the length
              // shown, as an entry's remapped length is.
              const outputLength = overlayOutputDuration(overlay)
              // A still overlay (#294) has no source to trim and no audio:
              // its window is offset + duration, and the audio controls are
              // absent rather than disabled — there is nothing to control.
              const isImage = isImageOverlay(overlay)
              const editingOverlay = editingOverlayId === overlay.id
              const set = (change: Partial<VideoOverlayPlacement>) =>
                onUpdateVideoOverlay(overlay.id, { ...overlayPlacementOf(overlay), ...change })
              const setImage = (change: Partial<ImageOverlayPlacement>) =>
                onUpdateVideoOverlay(overlay.id, { ...imageOverlayPlacementOf(overlay), ...change })
              return (
                <li key={overlay.id} className="video-overlay">
                  {/* Position/size at a glance, like the audio lane's strip;
                      the numeric fields below are the precise controls. */}
                  <div className="audio-track-strip" aria-hidden="true">
                    <div
                      className="audio-track-bar video-overlay-bar"
                      data-testid={`video-overlay-bar-${index}`}
                      style={laneBar(overlay.offset, outputLength)}
                    >
                      {/* A video overlay shows the same audio amplitude
                          visual as the sequence entries (#230); a still
                          overlay (#294) is soundless, so it shows none. */}
                      {!isImage && (
                        <AudioWaveform
                          url={overlay.url}
                          duration={overlay.duration}
                          inPoint={overlay.inPoint}
                          outPoint={overlay.outPoint}
                          data-testid={`video-overlay-waveform-${index}`}
                        />
                      )}
                    </div>
                  </div>
                  <div className="video-overlay-main">
                    {collapseToggle(overlay.id, position)}
                    {/* A video overlay gets the captured first frame of its
                        trim (#193); a still overlay shows the image itself,
                        exactly as a still sequence entry's row does (#140). */}
                    {isImage ? (
                      <img
                        className="clip-thumbnail"
                        src={overlay.url}
                        alt=""
                        aria-hidden="true"
                        data-testid={`video-overlay-thumbnail-${index}`}
                      />
                    ) : (
                      <ClipThumbnail
                        url={overlay.url}
                        inPoint={overlay.inPoint}
                        data-testid={`video-overlay-thumbnail-${index}`}
                      />
                    )}
                    {nameCell(overlay.id, overlay.name, position)}
                    <span className="clip-duration">{formatDuration(outputLength)}</span>
                    <span className="timeline-row-actions">
                      {rowActionsMenu('video-overlay', overlay, position, { removal: overlayRemoval })}
                      <button
                        type="button"
                        aria-label={`Remove ${position} from timeline`}
                        onClick={() => setPendingRemoval(overlayRemoval)}
                      >
                        ✕
                      </button>
                    </span>
                  </div>
                  {!isCollapsed(overlay.id) && (
                    <>
                  <div className="video-overlay-controls">
                    <span>Starts at</span>
                    <SecondsField
                      label={`Start time of ${position} in seconds`}
                      value={overlay.offset}
                      max={86400}
                      onCommit={(offset) => (isImage ? setImage({ offset }) : set({ offset }))}
                      unit="s"
                    />
                    {isImage ? (
                      <>
                        {/* A still's window is its length (#294), edited
                            directly — the still-entry control (#140), not a
                            trim of a source that does not exist. */}
                        <span>Length</span>
                        <SecondsField
                          label={`Duration of ${position} in seconds`}
                          value={overlay.duration}
                          max={86400}
                          onCommit={(duration) => setImage({ duration })}
                          unit="s"
                        />
                        <span className="timeline-entry-effective">
                          shows {formatSeconds(overlay.duration)}s
                        </span>
                      </>
                    ) : (
                      <>
                        <span>In</span>
                        <SecondsField
                          label={`Trim in point of ${position} in seconds`}
                          value={overlay.inPoint}
                          max={overlay.duration}
                          onCommit={(inPoint) => set({ inPoint })}
                          unit="s"
                        />
                        <span>Out</span>
                        <SecondsField
                          label={`Trim out point of ${position} in seconds`}
                          value={overlay.outPoint}
                          max={overlay.duration}
                          onCommit={(outPoint) => set({ outPoint })}
                          unit="s"
                        />
                        <span className="timeline-entry-effective">
                          plays {formatSeconds(trimmedLength)}s of {formatSeconds(overlay.duration)}s
                          {/* Its speed segments and pauses (#700) change
                              how long it shows — said where the trim math
                              is, as on an entry (#141). */}
                          {outputLength !== trimmedLength &&
                            ` — ${formatSeconds(outputLength)}s remapped`}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="video-overlay-controls">
                    <span>Rect</span>
                    <LabelledField text="left">
                      <SecondsField
                        label={`Left edge of ${position} (fraction of frame width)`}
                        value={overlay.x}
                        max={1}
                        step={0.05}
                        onCommit={(x) => (isImage ? setImage({ x }) : set({ x }))}
                      />
                    </LabelledField>
                    <LabelledField text="top">
                      <SecondsField
                        label={`Top edge of ${position} (fraction of frame height)`}
                        value={overlay.y}
                        max={1}
                        step={0.05}
                        onCommit={(y) => (isImage ? setImage({ y }) : set({ y }))}
                      />
                    </LabelledField>
                    <LabelledField text="width">
                      <SecondsField
                        label={`Width of ${position} (fraction of frame width)`}
                        value={overlay.width}
                        min={MIN_OVERLAY_SIZE}
                        max={1}
                        step={0.05}
                        onCommit={(width) => (isImage ? setImage({ width }) : set({ width }))}
                      />
                    </LabelledField>
                    <LabelledField text="height">
                      <SecondsField
                        label={`Height of ${position} (fraction of frame height)`}
                        value={overlay.height}
                        min={MIN_OVERLAY_SIZE}
                        max={1}
                        step={0.05}
                        onCommit={(height) => (isImage ? setImage({ height }) : set({ height }))}
                      />
                    </LabelledField>
                    {visualEditors && (
                      // The visual editor (#422): a toggle, so the same
                      // button closes what it opened — the zoom's rule
                      // (#413). It sits with the placement fields it edits
                      // rather than at the row's end, which the audio group
                      // owns.
                      <button
                        type="button"
                        className="timeline-adjust-button"
                        aria-label={`Adjust the placement of ${position} visually`}
                        aria-expanded={editingOverlay}
                        title="Drag the overlay's rectangle on a still of the frame"
                        onClick={() => setEditingOverlayId(editingOverlay ? null : overlay.id)}
                      >
                        Adjust visually…
                      </button>
                    )}
                    {/* A still overlay is soundless (#294/#220): the audio
                        controls are absent, not disabled. */}
                    {!isImage && (
                      <>
                        <span>Volume</span>
                        <SecondsField
                          label={`Volume of ${position} (0 to ${MAX_VOLUME})`}
                          value={overlay.volume ?? 1}
                          max={MAX_VOLUME}
                          mark={1}
                          step={0.05}
                          slider
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
                            idiom (#104), over the overlay's window — its
                            remapped length (#700), as an entry's fades span
                            its output duration. */}
                        <LabelledField text="Fade in">
                          <SecondsField
                            label={`Audio fade-in of ${position} in seconds`}
                            value={overlay.fadeIn ?? 0}
                            max={outputLength}
                            slider
                            onCommit={(fadeIn) => set({ fadeIn })}
                            unit="s"
                          />
                        </LabelledField>
                        <LabelledField text="out">
                          <SecondsField
                            label={`Audio fade-out of ${position} in seconds`}
                            value={overlay.fadeOut ?? 0}
                            max={outputLength}
                            slider
                            onCommit={(fadeOut) => set({ fadeOut })}
                            unit="s"
                          />
                        </LabelledField>
                      </>
                    )}
                  </div>
                  {visualEditors && editingOverlay && (
                    <OverlayEditor
                      timeline={timeline}
                      overlay={overlay}
                      position={position}
                      onUpdate={(rect) => (isImage ? setImage(rect) : set(rect))}
                      onClose={() => setEditingOverlayId(null)}
                    />
                  )}
                  {/* The overlay's picture treatments (#420), under the same
                      disclosure a sequence entry gets — the same three
                      groups, and Shape in place of Background: the mask is
                      the placed rectangle's outline (#266), an overlay
                      treatment, where an overlay has no bars behind it to
                      fill. */}
                  {pictureDisclosure(overlay.id, position, [
                    {
                      name: 'Color',
                      applied: overlay.colorAdjustments !== undefined,
                      controls: (
                        <ColorAdjustmentControls
                          position={position}
                          adjustments={overlay.colorAdjustments}
                          onCommit={(adjustments) => onSetVideoOverlayColor(overlay.id, adjustments)}
                        />
                      ),
                    },
                    {
                      name: 'Orientation',
                      applied: overlay.orientation !== undefined,
                      controls: (
                        <OrientationControls
                          position={position}
                          orientation={overlay.orientation}
                          onCommit={(orientation) =>
                            onSetVideoOverlayOrientation(overlay.id, orientation)
                          }
                        />
                      ),
                    },
                    {
                      name: 'Crop',
                      applied: overlay.crop !== undefined,
                      controls: cropGroupControls(
                        `overlay:${overlay.id}`,
                        overlay,
                        position,
                        (crop) => onSetVideoOverlayCrop(overlay.id, crop),
                      ),
                    },
                    {
                      name: 'Shape',
                      applied: overlay.shapeMask !== undefined,
                      controls: (
                        <ShapeMaskControls
                          position={position}
                          mask={overlay.shapeMask}
                          onCommit={(mask) => onSetVideoOverlayMask(overlay.id, mask)}
                        />
                      ),
                    },
                    {
                      name: 'Border',
                      applied: overlay.border !== undefined,
                      controls: (
                        <BorderControls
                          position={position}
                          border={overlay.border}
                          frameSize={frameSize}
                          onCommit={(border) => onSetVideoOverlayBorder?.(overlay.id, border)}
                        />
                      ),
                    },
                    {
                      name: 'Shadow',
                      applied: overlay.shadow !== undefined,
                      controls: (
                        <ShadowControls
                          position={position}
                          shadow={overlay.shadow}
                          frameSize={frameSize}
                          onCommit={(shadow) => onSetVideoOverlayShadow?.(overlay.id, shadow)}
                        />
                      ),
                    },
                    {
                      name: 'Spotlight',
                      applied: overlay.spotlights !== undefined,
                      controls: (
                        <SpotlightControls
                          position={position}
                          regions={overlay.spotlights}
                          subject={overlay}
                          visualEditors={visualEditors}
                          inPoint={overlay.inPoint}
                          outPoint={overlay.outPoint}
                          duration={overlay.duration}
                          onCommit={(regions) =>
                            onSetVideoOverlaySpotlights(overlay.id, regions)
                          }
                        />
                      ),
                    },
                    {
                      name: 'Redact',
                      applied: overlay.redactions !== undefined,
                      controls: (
                        <RedactionControls
                          position={position}
                          regions={overlay.redactions}
                          subject={overlay}
                          visualEditors={visualEditors}
                          inPoint={overlay.inPoint}
                          outPoint={overlay.outPoint}
                          duration={overlay.duration}
                          onCommit={(regions) =>
                            onSetVideoOverlayRedactions(overlay.id, regions)
                          }
                        />
                      ),
                    },
                  ])}
                  {/* The overlay's zooms (#699), in the entry's zoom-row
                      idiom: numbered in window order, the order the
                      normalized overlay stores them in. Their centre is a
                      fraction of the overlay's rectangle. The entry's visual
                      editor shows the sequence frame, not an overlay's
                      picture, so an overlay zoom has fields only (#734). */}
                  {(overlay.zooms ?? []).map((overlayZoom, zoomIndex) => (
                    <ZoomFieldsRow
                      key={overlayZoom.id}
                      zoom={overlayZoom}
                      zoomIndex={zoomIndex}
                      position={position}
                      maxStart={trimmedLength}
                      onUpdate={(spec) => onUpdateVideoOverlayZoom?.(overlay.id, overlayZoom.id, spec)}
                      onRemove={() => onRemoveVideoOverlayZoom?.(overlay.id, overlayZoom.id)}
                    />
                  ))}
                  {/* The overlay's speed segments and pauses (#700), in the
                      entry's rows. A still overlay carries none, as a still
                      entry does not. */}
                  {!isImage && (
                    <RemapFieldRows
                      position={position}
                      effects={overlay.remaps ?? []}
                      trimmed={trimmedLength}
                      onUpdate={(id, remap) => onUpdateVideoOverlayRemap?.(overlay.id, id, remap)}
                      onRemove={(id) => onRemoveVideoOverlayRemap?.(overlay.id, id)}
                    />
                  )}
                  {/* + Effect ▾ (#699): the entry's menu, offering what an
                      overlay can carry — Zoom, enabled while the overlay's
                      window has room for one (`defaultZoomFor`, the entry's
                      rule), and on a video overlay Speed segment and Pause
                      (#700), under the entry's rules (`defaultSpeedFor`,
                      `defaultPauseFor`). A still overlay has no time to
                      remap, so its menu offers Zoom alone, as a still
                      entry's does. */}
                  {(() => {
                    const addableZoom = defaultZoomFor(overlay.zooms ?? [], trimmedLength)
                    const items: MenuItem[] = [
                      {
                        kind: 'action',
                        label: 'Zoom',
                        disabled: addableZoom === null,
                        onSelect: () =>
                          addableZoom !== null && onAddVideoOverlayZoom?.(overlay.id, addableZoom),
                      },
                    ]
                    if (!isImage) {
                      const overlayRemaps = overlay.remaps ?? []
                      const addableSpeed = defaultSpeedFor(overlayRemaps, trimmedLength)
                      const addablePause = defaultPauseFor(overlayRemaps, trimmedLength)
                      items.push(
                        {
                          kind: 'action',
                          label: 'Speed segment',
                          disabled: addableSpeed === null,
                          onSelect: () =>
                            addableSpeed !== null && onAddVideoOverlayRemap?.(overlay.id, addableSpeed),
                        },
                        {
                          kind: 'action',
                          label: 'Pause',
                          disabled: addablePause === null,
                          onSelect: () =>
                            addablePause !== null && onAddVideoOverlayRemap?.(overlay.id, addablePause),
                        },
                      )
                    }
                    return (
                      <div className="timeline-entry-effects">
                        <Menu
                          label="+ Effect"
                          ariaLabel={`+ Effect on ${position}`}
                          menuLabel={`+ Effect on ${position}`}
                          triggerClassName="timeline-effect-add"
                          items={items}
                        />
                      </div>
                    )
                  })()}
                    </>
                  )}
                </li>
              )
            })}
          </ol>
          )}
        </div>
      )}

      {shapeGroups.length > 0 && (
        <div className="shape-lane">
          {sectionHeading(
            'shapes',
            'Shapes',
            'shape-lane-heading',
            shapeGroups.map((group) => group.id),
          )}
          {!isFolded('shapes') && (
          <ol className="shape-group-list" aria-label="Shape groups">
            {shapeGroups.map((group, index) => {
              const position = `shape group at position ${index + 1}`
              const removal: PendingRemoval = {
                name: position,
                consequence: `Its ${group.shapes.length === 1 ? 'shape is' : `${group.shapes.length} shapes are`} discarded.`,
                action: () => onRemoveShapeGroup?.(group.id),
              }
              const set = (change: Partial<ShapeGroupSpec>) =>
                onUpdateShapeGroup?.(group.id, { ...shapeGroupSpecOf(group), ...change })
              const setShape = (shapeIndex: number, change: ShapeChange) =>
                set({
                  shapes: group.shapes.map((shape, i) => {
                    if (i !== shapeIndex) return shape
                    // The row offers only the shape's own kind's fields;
                    // solid is stored as no key (#688).
                    const { lineStyle, ...rest } = change
                    const next = { ...shape, ...rest } as Shape
                    return lineStyle === undefined ? next : withLineStyle(next, lineStyle)
                  }),
                })
              // A new shape takes the style of the group's last shape — the
              // fields' form of #681 §2's "the last shape you drew or edited".
              // A badge (#689) takes the next number and the last badge's
              // look instead, and is passed over by the other kinds.
              const addShape = (kind: ShapeKind) =>
                set({
                  shapes: [
                    ...group.shapes,
                    kind === 'badge'
                      ? newBadge(crypto.randomUUID(), group.shapes)
                      : defaultShape(crypto.randomUUID(), kind, styleForNextShape(group.shapes)),
                  ],
                })
              return (
                <li key={group.id} className="shape-group">
                  <div className="audio-track-strip" aria-hidden="true">
                    <div
                      className="audio-track-bar shape-group-bar"
                      data-testid={`shape-group-bar-${index}`}
                      style={laneBar(group.offset, group.duration)}
                    />
                  </div>
                  <div className="shape-group-main">
                    {collapseToggle(group.id, position)}
                    {nameCell(group.id, shapeGroupName(group), position, true)}
                    <span className="timeline-row-actions">
                      {rowActionsMenu('shape-group', group, position, { removal })}
                      <button
                        type="button"
                        aria-label={`Remove ${position} from timeline`}
                        onClick={() => setPendingRemoval(removal)}
                      >
                        ✕
                      </button>
                    </span>
                  </div>
                  {!isCollapsed(group.id) && (
                    <>
                      <div className="text-overlay-controls">
                        <span>Shows at</span>
                        <SecondsField
                          label={`Start time of ${position} in seconds`}
                          value={group.offset}
                          max={86400}
                          onCommit={(offset) => set({ offset })}
                          unit="s"
                        />
                        <span>for</span>
                        <SecondsField
                          label={`Duration of ${position} in seconds`}
                          value={group.duration}
                          min={0.1}
                          max={86400}
                          onCommit={(duration) => set({ duration })}
                          unit="s"
                        />
                        <LabelledField text="Fade in">
                          <SecondsField
                            label={`Fade-in of ${position} in seconds`}
                            value={group.fadeIn ?? 0}
                            max={group.duration}
                            onCommit={(fadeIn) => set({ fadeIn })}
                            unit="s"
                          />
                        </LabelledField>
                        <LabelledField text="out">
                          <SecondsField
                            label={`Fade-out of ${position} in seconds`}
                            value={group.fadeOut ?? 0}
                            max={group.duration}
                            onCommit={(fadeOut) => set({ fadeOut })}
                            unit="s"
                          />
                        </LabelledField>
                      </div>
                      <ol className="shape-list" aria-label={`Shapes in ${position}`}>
                        {group.shapes.map((shape, shapeIndex) => (
                          <ShapeFields
                            key={shape.id}
                            shape={shape}
                            name={`${SHAPE_KIND_LABELS[shape.kind]} ${shapeIndex + 1} of ${position}`}
                            frameSize={frameSize}
                            onChange={(change) => setShape(shapeIndex, change)}
                            onRemove={
                              group.shapes.length > 1
                                ? () =>
                                    set({
                                      shapes: group.shapes.filter((_, i) => i !== shapeIndex),
                                    })
                                : undefined
                            }
                          />
                        ))}
                      </ol>
                      <div className="text-overlay-controls">
                        <Menu
                          label="+ Add shape"
                          ariaLabel={`Add a shape to ${position}`}
                          menuLabel={`Add a shape to ${position}`}
                          items={SHAPE_KINDS.map((kind) => ({
                            kind: 'action',
                            label: SHAPE_KIND_LABELS[kind],
                            onSelect: () => addShape(kind),
                          }))}
                        />
                        {visualEditors && (
                          // The shape editor (#685): a toggle, as every
                          // Adjust visually… button is, so the same button
                          // closes what it opened.
                          <button
                            type="button"
                            className="timeline-adjust-button"
                            aria-label={`Draw the shapes of ${position} visually`}
                            aria-expanded={editingShapeGroupId === group.id}
                            title="Draw, select, move and resize this group's shapes on a still of the frame"
                            onClick={() =>
                              setEditingShapeGroupId(
                                editingShapeGroupId === group.id ? null : group.id,
                              )
                            }
                          >
                            Draw shapes…
                          </button>
                        )}
                      </div>
                      {visualEditors && editingShapeGroupId === group.id && (
                        <ShapeEditor
                          timeline={timeline}
                          group={group}
                          position={position}
                          frameSize={frameSize}
                          onCommit={(shapes) => set({ shapes })}
                          onClose={() => setEditingShapeGroupId(null)}
                        />
                      )}
                    </>
                  )}
                </li>
              )
            })}
          </ol>
          )}
        </div>
      )}

      {texts.length > 0 && (
        <div className="text-lane">
          {sectionHeading('text', 'Text', 'text-lane-heading', texts.map((text) => text.id))}
          {!isFolded('text') && (
          <ol className="text-overlay-list" aria-label="Text overlays">
            {texts.map((text, index) => {
              const position = `text overlay at position ${index + 1}`
              const textRemoval: PendingRemoval = {
                name: position,
                consequence: 'Its text content is discarded.',
                action: () => onRemoveText(text.id),
              }
              const editingText = editingTextId === text.id
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
                    {collapseToggle(text.id, position)}
                    {isCollapsed(text.id) ? (
                      /* Collapsed (#299): the content on one line, read-only
                         until expanded — the editor is a control block. */
                      <span className="text-overlay-summary" title={text.content}>
                        {text.content}
                      </span>
                    ) : (
                      <TextContentField
                        label={`Content of ${position}`}
                        value={text.content}
                        onCommit={(content) => set({ content })}
                      />
                    )}
                    {/* No Rename: this row shows the overlay's content
                        rather than a name, and carried no ✎ before #419
                        either. */}
                    <span className="timeline-row-actions">
                      {rowActionsMenu('text', text, position, { renamable: false, removal: textRemoval })}
                      <button
                        type="button"
                        aria-label={`Remove ${position} from timeline`}
                        onClick={() => setPendingRemoval(textRemoval)}
                      >
                        ✕
                      </button>
                    </span>
                  </div>
                  {!isCollapsed(text.id) && (
                    <>
                  <div className="text-overlay-controls">
                    <span>Shows at</span>
                    <SecondsField
                      label={`Start time of ${position} in seconds`}
                      value={text.offset}
                      max={86400}
                      onCommit={(offset) => set({ offset })}
                      unit="s"
                    />
                    <span>for</span>
                    <SecondsField
                      label={`Duration of ${position} in seconds`}
                      value={text.duration}
                      min={0.1}
                      max={86400}
                      onCommit={(duration) => set({ duration })}
                      unit="s"
                    />
                    <span>centre</span>
                    <LabelledField text="x">
                      <SecondsField
                        label={`Centre X of ${position} (0 to 1)`}
                        value={text.x}
                        max={1}
                        step={0.05}
                        onCommit={(x) => set({ x })}
                      />
                    </LabelledField>
                    <LabelledField text="y">
                      <SecondsField
                        label={`Centre Y of ${position} (0 to 1)`}
                        value={text.y}
                        max={1}
                        step={0.05}
                        onCommit={(y) => set({ y })}
                      />
                    </LabelledField>
                    {visualEditors && (
                      // The visual editor (#424): a toggle, so the same
                      // button closes what it opened — the zoom's rule
                      // (#413). Beside the centre fields it edits.
                      <button
                        type="button"
                        className="timeline-adjust-button"
                        aria-label={`Adjust the placement of ${position} visually`}
                        aria-expanded={editingText}
                        title="Drag the text block on a still of the frame"
                        onClick={() => setEditingTextId(editingText ? null : text.id)}
                      >
                        Adjust visually…
                      </button>
                    )}
                    <LabelledField text="Fade in">
                      <SecondsField
                        label={`Fade-in of ${position} in seconds`}
                        value={text.fadeIn ?? 0}
                        max={text.duration}
                        onCommit={(fadeIn) => set({ fadeIn })}
                        unit="s"
                      />
                    </LabelledField>
                    <LabelledField text="out">
                      <SecondsField
                        label={`Fade-out of ${position} in seconds`}
                        value={text.fadeOut ?? 0}
                        max={text.duration}
                        onCommit={(fadeOut) => set({ fadeOut })}
                        unit="s"
                      />
                    </LabelledField>
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
                  {visualEditors && editingText && (
                    <TextEditor
                      timeline={timeline}
                      text={text}
                      position={position}
                      onUpdate={(placement) => set(placement)}
                      onClose={() => setEditingTextId(null)}
                    />
                  )}
                    </>
                  )}
                </li>
              )
            })}
          </ol>
          )}
        </div>
      )}

      {pendingPaste && copiedSettings && (
        <PasteSettingsDialog
          name={pendingPaste.name}
          groups={pendingPaste.groups}
          onCancel={() => setPendingPaste(null)}
          onApply={(chosen) => {
            onPasteSettings?.(
              pendingPaste.kind,
              pendingPaste.id,
              filterSettings(copiedSettings, chosen),
            )
            setPendingPaste(null)
          }}
        />
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
