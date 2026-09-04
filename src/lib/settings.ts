import { DEFAULT_STILL_DURATION } from './timeline'
import { LARGE_STEP_SECONDS, STEP_SECONDS } from './transport'

/**
 * Per-user, per-device preferences (#286, from customer feedback #281): the
 * handful of values that were hardcoded in the product and are a matter of
 * personal working style rather than project content.
 *
 * The dividing line the inventory in #286 drew, and the one to keep applying
 * when a preference is added: anything that describes *the edit* — track
 * volumes, duck levels, the project's subtitle style, per-export choices —
 * is project state and travels with the project file. Anything that
 * describes *how this person likes to work* lives here, in localStorage, per
 * browser, and deliberately never reaches a project file or the autosave
 * snapshot. Same reasoning and same store as the preview's expanded state
 * (#128) and the media library's view (#311); those keep their own keys
 * because they are toggles owned by one component, while these four are read
 * by four unrelated consumers and are edited in one dialog.
 *
 * Defaults are *derived from the constants the product already used*, not
 * retyped. That is what makes "a fresh visitor sees exactly today's
 * behaviour" checkable rather than a claim: if someone changes
 * `STEP_SECONDS`, the default follows, and the test that pins the two
 * together keeps holding.
 */

export const SETTINGS_KEY = 'browser-video-editor.settings'

/** What to do at startup when an autosaved session from before is found. */
export type SessionRestoreMode = 'ask' | 'always' | 'never'

export interface AppSettings {
  /** Seconds the playhead moves for a bare ← / → (#203's transport). */
  stepSeconds: number
  /** Seconds the playhead moves for Shift + ← / →. */
  largeStepSeconds: number
  /** How long a newly added still or slate shows, in seconds (#140/#143). */
  stillDurationSeconds: number
  /** Whether the startup restore offer appears, restores, or stays away (#194). */
  sessionRestore: SessionRestoreMode
  /**
   * Export-format id the export modal opens preselected on (#196's
   * registry). Stored as a bare string and *not* validated against the
   * registry here: which formats exist depends on the running browser's
   * MediaRecorder and on which plugins are enabled (#114/#197), neither of
   * which this module can see. The modal falls back when the stored id is
   * not currently offered, so a preference for a plugin format survives the
   * plugin being off.
   */
  exportFormat: string
}

/**
 * The choices each numeric setting offers, in the order the dialog lists
 * them. Closed sets rather than free numeric entry: every value is then
 * known-sane, the control is a `<select>` (keyboard-accessible for free, no
 * invalid state to guard), and validation of stored values is exact. The
 * cost is that a value dropped from a list in some future version degrades
 * to the default — worth it against the alternative of parsing, clamping and
 * rendering arbitrary numbers.
 *
 * Today's constant is a member of each list by construction, checked by a
 * test: the default must be selectable, or the dialog would open showing
 * nothing for a fresh visitor.
 */
export const STEP_CHOICES: readonly number[] = [0.05, STEP_SECONDS, 0.25, 0.5]
export const LARGE_STEP_CHOICES: readonly number[] = [0.5, LARGE_STEP_SECONDS, 2, 5]
export const STILL_DURATION_CHOICES: readonly number[] = [2, 3, DEFAULT_STILL_DURATION, 10]
export const SESSION_RESTORE_CHOICES: readonly SessionRestoreMode[] = ['ask', 'always', 'never']

/** Exactly today's behaviour, so a first visit changes nothing. */
export const DEFAULT_SETTINGS: AppSettings = {
  stepSeconds: STEP_SECONDS,
  largeStepSeconds: LARGE_STEP_SECONDS,
  stillDurationSeconds: DEFAULT_STILL_DURATION,
  sessionRestore: 'ask',
  exportFormat: 'webm',
}

/** The slice of Storage this needs; injectable so tests stay deterministic. */
export type SettingsStorage = Pick<Storage, 'getItem' | 'setItem'>

function defaultStorage(): SettingsStorage | null {
  // Accessing localStorage itself can throw (storage disabled entirely).
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** A stored number is taken only if it is one of the offered choices. */
function pickNumber(value: unknown, choices: readonly number[], fallback: number): number {
  return typeof value === 'number' && choices.includes(value) ? value : fallback
}

/**
 * Validates one stored object into settings, **field by field**: a value
 * this version does not recognize costs only its own setting, not the four
 * around it. A store written by a newer version that renamed one choice
 * therefore degrades one row of the dialog rather than resetting everything
 * the user configured.
 */
export function parseSettings(stored: unknown): AppSettings {
  if (typeof stored !== 'object' || stored === null) return DEFAULT_SETTINGS
  const raw = stored as Record<string, unknown>
  return {
    stepSeconds: pickNumber(raw.stepSeconds, STEP_CHOICES, DEFAULT_SETTINGS.stepSeconds),
    largeStepSeconds: pickNumber(
      raw.largeStepSeconds,
      LARGE_STEP_CHOICES,
      DEFAULT_SETTINGS.largeStepSeconds,
    ),
    stillDurationSeconds: pickNumber(
      raw.stillDurationSeconds,
      STILL_DURATION_CHOICES,
      DEFAULT_SETTINGS.stillDurationSeconds,
    ),
    sessionRestore: SESSION_RESTORE_CHOICES.includes(raw.sessionRestore as SessionRestoreMode)
      ? (raw.sessionRestore as SessionRestoreMode)
      : DEFAULT_SETTINGS.sessionRestore,
    // Any non-empty string is kept: the registry, not this module, decides
    // whether an id is offered right now.
    exportFormat:
      typeof raw.exportFormat === 'string' && raw.exportFormat !== ''
        ? raw.exportFormat
        : DEFAULT_SETTINGS.exportFormat,
  }
}

/** The stored settings, defaulting to today's behaviour. Never throws. */
export function loadSettings(storage: SettingsStorage | null = defaultStorage()): AppSettings {
  try {
    const stored = storage?.getItem(SETTINGS_KEY)
    if (stored === null || stored === undefined) return DEFAULT_SETTINGS
    return parseSettings(JSON.parse(stored))
  } catch {
    // Unreadable store or unparseable JSON: today's behaviour, not a crash.
    return DEFAULT_SETTINGS
  }
}

/** Remembers the settings. Best-effort: a full or blocked store loses only
 * the preference, never the ability to change it in this session. */
export function saveSettings(
  settings: AppSettings,
  storage: SettingsStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Losing the preference is acceptable; breaking the dialog is not.
  }
}

/** How the dialog labels a duration choice: "0.1 s", "1 s", "10 s". */
export function formatSeconds(seconds: number): string {
  return `${seconds} s`
}

/** How the dialog labels a session-restore choice. */
export function sessionRestoreLabel(mode: SessionRestoreMode): string {
  switch (mode) {
    case 'ask':
      return 'Ask each time'
    case 'always':
      return 'Always restore'
    case 'never':
      return 'Never restore'
  }
}
