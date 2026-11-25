/**
 * The font ids the Font pack plugin registers (#867). This module is
 * top-level `src/plugins/` wiring, part of the entry bundle and exempt from
 * the plugin-chunk check, for the reason `shapedWipesIds.ts` gives: the
 * catalog's `usedByProject` must answer "does this project use a pack
 * font?" on every save without loading the plugin's lazy chunk. The plugin
 * module imports the same list, so the two cannot drift.
 *
 * Ids are recorded in project files (a text overlay's `font`, the subtitle
 * style's `font`); never reuse one for a different face. The order is the
 * Font menus' order, after the four core fonts.
 */
export const FONT_PACK_IDS = [
  'pack-nunito',
  'pack-montserrat',
  'pack-oswald',
  'pack-bebas-neue',
  'pack-zilla-slab',
  'pack-cormorant-garamond',
  'pack-courier-prime',
  'pack-caveat',
  'pack-comic-neue',
  'pack-silkscreen',
] as const

export type FontPackId = (typeof FONT_PACK_IDS)[number]

/** Whether a font id belongs to the Font pack plugin. */
export function isFontPackFont(id: string): boolean {
  return (FONT_PACK_IDS as readonly string[]).includes(id)
}
