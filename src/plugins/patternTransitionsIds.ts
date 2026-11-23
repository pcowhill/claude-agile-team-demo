/**
 * The transition ids the Pattern transitions plugin registers (#857). Like
 * `shapedWipesIds.ts` (#199), this module is top-level `src/plugins/` wiring
 * — part of the entry bundle, exempt from the plugin-chunk check — because
 * the catalog's `usedByProject` predicate must answer "does this timeline
 * use a pattern transition?" on every save without loading the plugin's
 * lazy chunk. The plugin module imports the same list, so the two cannot
 * drift.
 *
 * Ids are recorded in project files; never reuse one for a different effect.
 */
export const PATTERN_TRANSITION_IDS = [
  'blinds-horizontal',
  'blinds-vertical',
  'checkerboard',
  'diamond-iris',
  'star-iris',
] as const

export type PatternTransitionId = (typeof PATTERN_TRANSITION_IDS)[number]

/** Whether a transition type id belongs to the Pattern transitions plugin. */
export function isPatternTransition(type: string): boolean {
  return (PATTERN_TRANSITION_IDS as readonly string[]).includes(type)
}

/**
 * The pattern sizes (#857): how many slats the blinds have and the
 * checkerboard's grid. They live here, beside the ids, rather than in the
 * plugin's lazy chunk for the same reason `gifLimits.ts` does (#503): the
 * user guide states them (`src/lib/guide/constants.ts`), and importing the
 * plugin module for three numbers would pull its chunk into the guide's.
 */
export const BLIND_SLATS = 10
export const CHECKER_COLUMNS = 8
export const CHECKER_ROWS = 6
