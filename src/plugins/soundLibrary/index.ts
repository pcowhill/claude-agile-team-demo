import { libraryHeaderContributions } from '../../lib/libraryHeader'
import { SoundLibraryDialog } from './SoundLibraryDialog'

/**
 * The Sound library plugin (#861, from the customer's pick of idea 10 on
 * #856): the Media Library header's **Sound library…** opens a set of short
 * sound effects, synthesised by the team and released as CC0. **Add** imports
 * one as an ordinary audio clip, through the Media Library header registry
 * (`src/lib/libraryHeader.ts`). An added sound belongs to the project, not
 * to the plugin, so no project ever depends on it (`usedByProject` is
 * omitted in the catalog).
 */

/** The header button's id. */
export const SOUND_LIBRARY_ITEM_ID = 'sound-library:open'

/** Registers the header button; returns the undo (#197's contract). */
export function activate(): () => void {
  libraryHeaderContributions.register({
    id: SOUND_LIBRARY_ITEM_ID,
    label: 'Sound library…',
    Dialog: SoundLibraryDialog,
  })
  return () => libraryHeaderContributions.unregister(SOUND_LIBRARY_ITEM_ID)
}
