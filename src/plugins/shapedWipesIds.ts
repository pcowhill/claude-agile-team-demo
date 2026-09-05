/**
 * The transition ids the Shaped wipes plugin registers (#199). This module
 * is top-level `src/plugins/` wiring — part of the entry bundle, exempt from
 * the plugin-chunk check — because the catalog's `usedByProject` predicate
 * must answer "does this timeline use a shaped wipe?" without loading the
 * plugin's lazy chunk: dependency recording runs on every save, plugin
 * enabled or not (`PluginRuntime.projectPlugins`). The plugin module imports
 * the same list, so the two cannot drift.
 *
 * Ids are recorded in project files; never reuse one for a different effect.
 */
export const SHAPED_WIPE_TRANSITION_IDS = [
  'box-open',
  'barn-doors-open',
  'letterbox-open',
  'wipe-from-top-left',
  'wipe-from-top-right',
  'wipe-from-bottom-left',
  'wipe-from-bottom-right',
] as const

export type ShapedWipeTransitionId = (typeof SHAPED_WIPE_TRANSITION_IDS)[number]

/** Whether a transition type id belongs to the Shaped wipes pack. */
export function isShapedWipeTransition(type: string): boolean {
  return (SHAPED_WIPE_TRANSITION_IDS as readonly string[]).includes(type)
}
