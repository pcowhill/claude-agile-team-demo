import { AUTOSAVE_DEBOUNCE_MS } from '../autosave'
import { DEFAULT_DUCK_LEVEL } from '../gain'
import { HISTORY_LIMIT } from '../history'
import {
  RELINK_DURATION_TOLERANCE_FRACTION,
  RELINK_DURATION_TOLERANCE_MIN_SECONDS,
} from '../openProject'
import { RECORDING_KEYFRAME_INTERVAL_MS } from '../recording'
import { PROJECT_FILE_EXTENSION } from '../saveProject'
import type { AppSettings } from '../settings'
import { DEFAULT_TEXT } from '../textOverlay'
import { DEFAULT_STILL_DURATION, DEFAULT_TRANSITION_DURATION } from '../timeline'
import { DEFAULT_OVERLAY_RECT } from '../videoOverlay'
import type { GuideConstants } from './constantNames'

/**
 * The values behind the guide's placeholders (#478) — see `constantNames.ts`
 * for why the names live apart from the values. Every entry reads the
 * constant the code owns; none is retyped here. The two step sizes come
 * from the settings, so the guide states the sizes in force, as the cheat
 * sheet does (#286).
 */
export function guideConstants(settings: Pick<AppSettings, 'stepSeconds' | 'largeStepSeconds'>): GuideConstants {
  return {
    HISTORY_LIMIT: String(HISTORY_LIMIT),
    DEFAULT_STILL_DURATION: String(DEFAULT_STILL_DURATION),
    DEFAULT_DUCK_LEVEL_PERCENT: String(Math.round(DEFAULT_DUCK_LEVEL * 100)),
    DEFAULT_TRANSITION_DURATION: String(DEFAULT_TRANSITION_DURATION),
    DEFAULT_TEXT_DURATION: String(DEFAULT_TEXT.duration),
    STEP_SECONDS: String(settings.stepSeconds),
    LARGE_STEP_SECONDS: String(settings.largeStepSeconds),
    AUTOSAVE_DEBOUNCE_SECONDS: String(AUTOSAVE_DEBOUNCE_MS / 1000),
    RECORDING_KEYFRAME_INTERVAL_SECONDS: String(RECORDING_KEYFRAME_INTERVAL_MS / 1000),
    RELINK_DURATION_TOLERANCE_PERCENT: String(Math.round(RELINK_DURATION_TOLERANCE_FRACTION * 100)),
    RELINK_DURATION_TOLERANCE_MIN_SECONDS: String(RELINK_DURATION_TOLERANCE_MIN_SECONDS),
    PROJECT_FILE_EXTENSION,
    DEFAULT_OVERLAY_SIZE_PERCENT: String(Math.round(DEFAULT_OVERLAY_RECT.width * 100)),
  }
}
