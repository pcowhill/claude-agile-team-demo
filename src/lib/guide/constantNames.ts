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
] as const

export type GuideConstantName = (typeof GUIDE_CONSTANT_NAMES)[number]

export type GuideConstants = Readonly<Record<GuideConstantName, string>>

export function isGuideConstantName(name: string): name is GuideConstantName {
  return (GUIDE_CONSTANT_NAMES as readonly string[]).includes(name)
}
