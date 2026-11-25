import { addMenuContributions } from '../../lib/addMenu'
import { TitleTemplatesDialog } from './TitleTemplatesDialog'

/**
 * The Title templates plugin (#860, from the customer's pick of idea 6 on
 * #856): Add ▾ › Title template… opens a gallery of ready-made titles —
 * lower thirds, chapter cards and end cards in several styles, a call-out
 * and a step badge (#868) — and places the chosen one
 * as ordinary text overlays and a shape group. It contributes only the menu
 * item and its dialog, through the Add ▾ registry (`src/lib/addMenu.ts`).
 * What it places belongs to the project, not to the plugin, so no project
 * ever depends on it (`projectUses` is omitted in the catalog).
 */

/** The Add ▾ item's id. */
export const TITLE_TEMPLATE_ITEM_ID = 'title-templates:place'

/** Registers the Add ▾ item; returns the undo (#197's contract). */
export function activate(): () => void {
  addMenuContributions.register({
    id: TITLE_TEMPLATE_ITEM_ID,
    label: 'Title template…',
    Dialog: TitleTemplatesDialog,
  })
  return () => addMenuContributions.unregister(TITLE_TEMPLATE_ITEM_ID)
}
