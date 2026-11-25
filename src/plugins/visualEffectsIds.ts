/**
 * The picture-effect ids the Visual effects plugin registers (#862). This
 * module is top-level `src/plugins/` wiring, part of the entry bundle and
 * exempt from the plugin-chunk check, for the reason `shapedWipesIds.ts`
 * gives: the catalog's `projectUses` must answer "does this timeline use
 * a visual effect?" on every save without loading the plugin's lazy chunk.
 * The plugin module imports the same list, so the two cannot drift.
 *
 * Ids are recorded in project files; never reuse one for a different effect.
 */
export const VISUAL_EFFECT_IDS = ['vignette', 'blur', 'film-grain', 'old-film', 'vhs'] as const

export type VisualEffectId = (typeof VISUAL_EFFECT_IDS)[number]

/** Whether a picture-effect type id belongs to the Visual effects plugin. */
export function isVisualEffect(type: string): boolean {
  return (VISUAL_EFFECT_IDS as readonly string[]).includes(type)
}
