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
  // Part 2 (#863).
  'clock-wipe',
  'radial-wipe',
  'spiral',
  'heart-iris',
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

/**
 * The Spiral's grid (#863): the frame is revealed cell by cell along a
 * clockwise path from the top-left corner inward. 6 × 4 keeps the cells
 * close to square on a 16:9 frame (1.19 : 1), and keeps their number at 24,
 * so a 1 s transition spends about 42 ms on each cell: a little over one
 * 30 fps frame.
 */
export const SPIRAL_COLUMNS = 6
export const SPIRAL_ROWS = 4
