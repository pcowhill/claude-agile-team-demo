import { AUTOSAVE_DEBOUNCE_MS } from '../autosave'
import { COLOR_ADJUSTMENT_MAX, COLOR_ADJUSTMENT_MIN } from '../colorAdjustments'
import { MIN_KEPT_FRACTION } from '../crop'
import { DEFAULT_BLUR_STRENGTH, DEFAULT_PIXELATE_BLOCK, MIN_REGION_FRACTION } from '../redaction'
import { DEFAULT_SPOTLIGHT_DIM, MAX_SPOTLIGHT_SOFTEN } from '../spotlight'
import {
  LOOP_PAUSE_MS,
  MAX_EDITOR_ZOOM_SCALE,
  MIN_EDITOR_ZOOM_SCALE,
  RECT_SIZE_STEP,
  TEXT_SIZE_STEP,
  ZOOM_NUDGE,
  ZOOM_NUDGE_LARGE,
  ZOOM_SCALE_STEP,
} from '../frameEditor'
import { FREEZE_STILL_DURATION } from '../freezeFrame'
import { EXPORT_SIZE_PRESETS, MAX_EXPORT_DIMENSION, MAX_EXPORT_FRAME_RATE, MIN_EXPORT_DIMENSION } from '../exportSettings'
import { exportFormats } from '../exportFormats'
import { MP3_KBPS } from '../mp3Bitrate'
import { EXPORT_FRAME_RATE } from '../exportVideo'
import { DEFAULT_DUCK_LEVEL, DUCK_RAMP_SECONDS } from '../gain'
import { HISTORY_LIMIT } from '../history'
import {
  RELINK_DURATION_TOLERANCE_FRACTION,
  RELINK_DURATION_TOLERANCE_MIN_SECONDS,
} from '../openProject'
import { RECORDING_KEYFRAME_INTERVAL_MS } from '../recording'
import { DEFAULT_PAUSE_HOLD, DEFAULT_SPEED_FACTOR, DEFAULT_SPEED_LENGTH } from '../remap'
import { PROJECT_FILE_EXTENSION } from '../saveProject'
import type { AppSettings } from '../settings'
import {
  DEFAULT_COUNTDOWN_SECONDS,
  DEFAULT_SETTINGS,
  LARGE_STEP_CHOICES,
  STEP_CHOICES,
  STILL_DURATION_CHOICES,
  formatSeconds,
} from '../settings'
import { GIF_FRAME_RATE, GIF_MAX_DIMENSION } from '../../plugins/gifLimits'
import { DEFAULT_ROUNDED_RADIUS, MAX_ROUNDED_RADIUS } from '../shapeMask'
import {
  DEFAULT_SUBTITLE_STYLE,
  DEFAULT_TEXT,
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
} from '../textOverlay'
import { DEFAULT_STILL_DURATION, DEFAULT_TRANSITION_DURATION, DEFAULT_ZOOM } from '../timeline'
import { LARGE_STEP_SECONDS, SNAP_PIXELS, STEP_SECONDS } from '../transport'
import { DEFAULT_OVERLAY_RECT } from '../videoOverlay'
import type { GuideConstants } from './constantNames'

/**
 * The values behind the guide's placeholders (#478) — see `constantNames.ts`
 * for why the names live apart from the values. Every entry reads the
 * constant the code owns; none is retyped here. The two step sizes come
 * from the settings, so the guide states the sizes in force, as the cheat
 * sheet does (#286).
 */
/** A fraction as the whole percentage the prose states (0.1 → "10"). */
const percent = (fraction: number): string => String(Math.round(fraction * 100))

export function guideConstants(settings: Pick<AppSettings, 'stepSeconds' | 'largeStepSeconds'>): GuideConstants {
  return {
    HISTORY_LIMIT: String(HISTORY_LIMIT),
    DEFAULT_STILL_DURATION: String(DEFAULT_STILL_DURATION),
    DEFAULT_DUCK_LEVEL_PERCENT: String(Math.round(DEFAULT_DUCK_LEVEL * 100)),
    DEFAULT_TRANSITION_DURATION: String(DEFAULT_TRANSITION_DURATION),
    DEFAULT_TEXT_DURATION: String(DEFAULT_TEXT.duration),
    STEP_SECONDS: String(settings.stepSeconds),
    LARGE_STEP_SECONDS: String(settings.largeStepSeconds),
    CROP_MIN_KEPT_PERCENT: percent(MIN_KEPT_FRACTION),
    DEFAULT_PIXELATE_BLOCK: String(DEFAULT_PIXELATE_BLOCK),
    DEFAULT_SPOTLIGHT_DIM_PERCENT: percent(DEFAULT_SPOTLIGHT_DIM),
    MAX_SPOTLIGHT_SOFTEN_PERCENT: percent(MAX_SPOTLIGHT_SOFTEN),
    DEFAULT_BLUR_STRENGTH: String(DEFAULT_BLUR_STRENGTH),
    COLOR_ADJUSTMENT_MIN: String(COLOR_ADJUSTMENT_MIN),
    COLOR_ADJUSTMENT_MAX: String(COLOR_ADJUSTMENT_MAX),
    DEFAULT_SPEED_FACTOR: String(DEFAULT_SPEED_FACTOR),
    DEFAULT_SPEED_LENGTH: String(DEFAULT_SPEED_LENGTH),
    DEFAULT_PAUSE_HOLD: String(DEFAULT_PAUSE_HOLD),
    FREEZE_STILL_DURATION: String(FREEZE_STILL_DURATION),
    DEFAULT_ZOOM_SCALE: String(DEFAULT_ZOOM.scale),
    DEFAULT_ZOOM_RAMP: String(DEFAULT_ZOOM.rampIn),
    DEFAULT_ZOOM_HOLD: String(DEFAULT_ZOOM.hold),
    EDITOR_ZOOM_MIN_SCALE: String(MIN_EDITOR_ZOOM_SCALE),
    EDITOR_ZOOM_MAX_SCALE: String(MAX_EDITOR_ZOOM_SCALE),
    EDITOR_NUDGE_PERCENT: percent(ZOOM_NUDGE),
    EDITOR_NUDGE_LARGE_PERCENT: percent(ZOOM_NUDGE_LARGE),
    ZOOM_SCALE_STEP: String(ZOOM_SCALE_STEP),
    RECT_SIZE_STEP_PERCENT: percent(RECT_SIZE_STEP),
    TEXT_SIZE_STEP: String(TEXT_SIZE_STEP),
    LOOP_REST_SECONDS: String(LOOP_PAUSE_MS / 1000),
    REDACTION_MIN_REGION_PERCENT: percent(MIN_REGION_FRACTION),
    MAX_ROUNDED_RADIUS_PERCENT: percent(MAX_ROUNDED_RADIUS),
    DEFAULT_ROUNDED_RADIUS_PERCENT: percent(DEFAULT_ROUNDED_RADIUS),
    AUTOSAVE_DEBOUNCE_SECONDS: String(AUTOSAVE_DEBOUNCE_MS / 1000),
    RECORDING_KEYFRAME_INTERVAL_SECONDS: String(RECORDING_KEYFRAME_INTERVAL_MS / 1000),
    RECORDING_COUNTDOWN_SECONDS: String(DEFAULT_COUNTDOWN_SECONDS),
    RELINK_DURATION_TOLERANCE_PERCENT: String(Math.round(RELINK_DURATION_TOLERANCE_FRACTION * 100)),
    RELINK_DURATION_TOLERANCE_MIN_SECONDS: String(RELINK_DURATION_TOLERANCE_MIN_SECONDS),
    PROJECT_FILE_EXTENSION,
    DEFAULT_OVERLAY_SIZE_PERCENT: String(Math.round(DEFAULT_OVERLAY_RECT.width * 100)),
    DEFAULT_TEXT_SIZE_PERCENT: percent(DEFAULT_TEXT.size),
    MIN_TEXT_SIZE_PERCENT: percent(MIN_TEXT_SIZE),
    MAX_TEXT_SIZE_PERCENT: percent(MAX_TEXT_SIZE),
    TEXT_LINE_HEIGHT: String(TEXT_LINE_HEIGHT),
    SUBTITLE_DEFAULT_SIZE_PERCENT: percent(DEFAULT_SUBTITLE_STYLE.size),
    SUBTITLE_DEFAULT_Y_PERCENT: percent(DEFAULT_SUBTITLE_STYLE.y),
    DUCK_RAMP_SECONDS: String(DUCK_RAMP_SECONDS),
    SNAP_PIXELS: String(SNAP_PIXELS),
    EXPORT_FRAME_RATE: String(EXPORT_FRAME_RATE),
    MIN_EXPORT_DIMENSION: String(MIN_EXPORT_DIMENSION),
    MAX_EXPORT_DIMENSION: String(MAX_EXPORT_DIMENSION),
    MAX_EXPORT_FRAME_RATE: String(MAX_EXPORT_FRAME_RATE),
    EXPORT_SIZE_PRESETS: EXPORT_SIZE_PRESETS.map((preset) => preset.label).join(', '),
    GIF_FPS: String(GIF_FRAME_RATE),
    GIF_MAX_PX: String(GIF_MAX_DIMENSION),
    MP3_KBPS: String(MP3_KBPS),
    DEFAULT_STEP_SECONDS: String(STEP_SECONDS),
    DEFAULT_LARGE_STEP_SECONDS: String(LARGE_STEP_SECONDS),
    STEP_CHOICES: STEP_CHOICES.map(formatSeconds).join(', '),
    LARGE_STEP_CHOICES: LARGE_STEP_CHOICES.map(formatSeconds).join(', '),
    STILL_DURATION_CHOICES: STILL_DURATION_CHOICES.map(formatSeconds).join(', '),
    DEFAULT_EXPORT_FORMAT: exportFormats.get(DEFAULT_SETTINGS.exportFormat).label,
  }
}
