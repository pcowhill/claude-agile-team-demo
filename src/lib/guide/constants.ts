import { COLOR_ADJUSTMENT_MAX, COLOR_ADJUSTMENT_MIN } from '../colorAdjustments'
import { MIN_KEPT_FRACTION } from '../crop'
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
import { DEFAULT_DUCK_LEVEL } from '../gain'
import { HISTORY_LIMIT } from '../history'
import { DEFAULT_PAUSE_HOLD, DEFAULT_SPEED_FACTOR, DEFAULT_SPEED_LENGTH } from '../remap'
import type { AppSettings } from '../settings'
import { DEFAULT_ROUNDED_RADIUS, MAX_ROUNDED_RADIUS } from '../shapeMask'
import { DEFAULT_TEXT } from '../textOverlay'
import { DEFAULT_STILL_DURATION, DEFAULT_TRANSITION_DURATION, DEFAULT_ZOOM } from '../timeline'
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
    MAX_ROUNDED_RADIUS_PERCENT: percent(MAX_ROUNDED_RADIUS),
    DEFAULT_ROUNDED_RADIUS_PERCENT: percent(DEFAULT_ROUNDED_RADIUS),
  }
}
