/**
 * The placeholders the guide's Markdown may use (#478, design #477 §6.2):
 * `{{HISTORY_LIMIT}}` in `docs/guide/*.md` is filled at render time from
 * the constant the code owns, so the guide cannot say "100" after the code
 * says 200 — the cheat sheet's "documentation that lies" guard (#286)
 * applied to the whole guide.
 *
 * Two modules on purpose. This one is the *names*, imports nothing, and is
 * what the compiler (which runs inside the build, type-checked against
 * Node's lib) validates placeholders against, so an unknown name fails the
 * build. `constants.ts` is the *values*, imports the app modules that own
 * them, and is what the panel renders with. `GuideConstants` ties the two:
 * a name added here without a value there is a type error.
 *
 * Some values are live rather than constant — the configured step sizes —
 * which is why the table is filled at render time and not at compile time:
 * the same mechanism serves both, and the guide can show the sizes the user
 * chose exactly as the cheat sheet does.
 */
export const GUIDE_CONSTANT_NAMES = [
  /** How many undo steps the history keeps (`HISTORY_LIMIT`, history.ts). */
  'HISTORY_LIMIT',
  /** How long a newly added still, slate or image layer shows, in seconds. */
  'DEFAULT_STILL_DURATION',
  /** The duck level an audio track starts with, as a percentage. */
  'DEFAULT_DUCK_LEVEL_PERCENT',
  /** How long a transition lasts when first added, in seconds. */
  'DEFAULT_TRANSITION_DURATION',
  /** How long a newly added text overlay shows, in seconds. */
  'DEFAULT_TEXT_DURATION',
  /** The configured bare-arrow step, in seconds (a live setting, #286). */
  'STEP_SECONDS',
  /** The configured Shift+arrow step, in seconds (a live setting, #286). */
  'LARGE_STEP_SECONDS',
  /** The least a crop may keep on each axis, as a percentage (#255). */
  'CROP_MIN_KEPT_PERCENT',
  'DEFAULT_PIXELATE_BLOCK',
  'DEFAULT_BLUR_STRENGTH',
  /** The colour dials' range, in percent; 100 is unchanged (#192). */
  'COLOR_ADJUSTMENT_MIN',
  'COLOR_ADJUSTMENT_MAX',
  /** A new speed segment's factor and length in seconds; a new pause's hold (#138). */
  'DEFAULT_SPEED_FACTOR',
  'DEFAULT_SPEED_LENGTH',
  'DEFAULT_PAUSE_HOLD',
  /** How long a frozen frame's still shows when placed (#379). */
  'FREEZE_STILL_DURATION',
  /** A new zoom's magnification, ramp and hold, in the room it has (#63). */
  'DEFAULT_ZOOM_SCALE',
  'DEFAULT_ZOOM_RAMP',
  'DEFAULT_ZOOM_HOLD',
  /** The magnification the zoom editor's corner drag stays within (#413). */
  'EDITOR_ZOOM_MIN_SCALE',
  'EDITOR_ZOOM_MAX_SCALE',
  /** An arrow key's nudge in the visual editors, as a percentage of the frame; Shift's too (#421). */
  'EDITOR_NUDGE_PERCENT',
  'EDITOR_NUDGE_LARGE_PERCENT',
  /** What one + / − press does: the zoom's scale, a rectangle's size in percent, a text size (#421, #422, #424). */
  'ZOOM_SCALE_STEP',
  'RECT_SIZE_STEP_PERCENT',
  'TEXT_SIZE_STEP',
  /** How long Loop rests on the hold's first and last frame, in seconds (#425). */
  'LOOP_REST_SECONDS',
  /** The smallest side a redaction region can be dragged to, in percent of the source (#493). */
  'REDACTION_MIN_REGION_PERCENT',
  /** A rounded shape mask's corner radius: its ceiling and its starting value, in percent (#266). */
  'MAX_ROUNDED_RADIUS_PERCENT',
  'DEFAULT_ROUNDED_RADIUS_PERCENT',
  /** Seconds of quiet after the last change before autosave writes (#194). */
  'AUTOSAVE_DEBOUNCE_SECONDS',
  /** How often a video recording asks for a keyframe, in seconds (#468). */
  'RECORDING_KEYFRAME_INTERVAL_SECONDS',
  /** The recording dialog's countdown when it is on, in seconds (#514). */
  'RECORDING_COUNTDOWN_SECONDS',
  /** Re-linking tolerates this much duration difference, as a percentage (#77). */
  'RELINK_DURATION_TOLERANCE_PERCENT',
  /** …and never less than this many seconds of difference. */
  'RELINK_DURATION_TOLERANCE_MIN_SECONDS',
  /** The project file's extension (#75). */
  'PROJECT_FILE_EXTENSION',
  /** The width and height a new overlay takes, as a percentage of the frame (#145). */
  'DEFAULT_OVERLAY_SIZE_PERCENT',
  /** A new text overlay's size, and the size a text overlay may take, as percentages of the frame's height (#139). */
  'DEFAULT_TEXT_SIZE_PERCENT',
  'MIN_TEXT_SIZE_PERCENT',
  'MAX_TEXT_SIZE_PERCENT',
  /** Line spacing of a multi-line text block, as a multiple of its size (#142). */
  'TEXT_LINE_HEIGHT',
  /** The built-in subtitle style's size, as a percentage of the frame's height, and how far down the frame its centre sits (#249). */
  'SUBTITLE_DEFAULT_SIZE_PERCENT',
  'SUBTITLE_DEFAULT_Y_PERCENT',
  /** How long ducking ramps down before, and back up after, a ducking track's window, in seconds (#241). */
  'DUCK_RAMP_SECONDS',
  /** How close, in pixels of slider travel, a released seek must land to a cut to snap onto it (#391). */
  'SNAP_PIXELS',
  /** The export's automatic frame rate, in frames per second (#179). */
  'EXPORT_FRAME_RATE',
  /** The export dialog's bounds on a typed width or height, in pixels, and on the frame rate (#179). */
  'MIN_EXPORT_DIMENSION',
  'MAX_EXPORT_DIMENSION',
  'MAX_EXPORT_FRAME_RATE',
  /** The named output-size presets, as the dialog labels them, comma-separated (#179). */
  'EXPORT_SIZE_PRESETS',
  /** The GIF plugin's sampling rate and longer-side cap (#198). */
  'GIF_FPS',
  'GIF_MAX_PX',
  /** The MP3 export's bitrate, in kbps (#269). */
  'MP3_KBPS',
  /** The default arrow-key steps before Settings changes them, in seconds (#286). */
  'DEFAULT_STEP_SECONDS',
  'DEFAULT_LARGE_STEP_SECONDS',
  /** The choices each duration setting offers, comma-separated with their unit (#286). */
  'STEP_CHOICES',
  'LARGE_STEP_CHOICES',
  'STILL_DURATION_CHOICES',
  /** The export format the dialog opens on before Settings changes it (#286). */
  'DEFAULT_EXPORT_FORMAT',
] as const

export type GuideConstantName = (typeof GUIDE_CONSTANT_NAMES)[number]

export type GuideConstants = Readonly<Record<GuideConstantName, string>>

export function isGuideConstantName(name: string): name is GuideConstantName {
  return (GUIDE_CONSTANT_NAMES as readonly string[]).includes(name)
}
