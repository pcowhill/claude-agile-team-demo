import { pictureEffectRegistry } from '../../lib/pictureEffect'
import type { PictureEffectDefinition } from '../../lib/pictureEffect'
import type { VisualEffectId } from '../visualEffectsIds'
import { VISUAL_EFFECT_IDS } from '../visualEffectsIds'

/**
 * The Visual effects plugin (#862): the picture-effect registry's first
 * plugin. Each definition is parameters plus a `look` rule, and adds no
 * rendering code: the preview and the export both draw the look the core
 * resolver (`pictureLookAt`) hands them, so they match by construction
 * (#66), as the transition packs do through `transitionLayerSpec`.
 *
 * Both rules scale their strength by the ease's `weight`, so weight 0 is
 * the untouched picture and nothing pops at either end of a window.
 */

/** Where a vignette's darkening begins, as a fraction of the way from the centre to a corner. */
export const VIGNETTE_INNER = 0.45

const DEFINITIONS: Record<VisualEffectId, PictureEffectDefinition> = {
  // Darkens the frame's edges: Strength is the black's opacity at the
  // corners, in percent.
  vignette: {
    id: 'vignette',
    name: 'Vignette',
    params: [{ key: 'strength', label: 'Strength', min: 0, max: 100, default: 60, unit: '%' }],
    look: (params, weight) => ({
      filters: [],
      layers: [{ kind: 'vignette', strength: (params.strength / 100) * weight, inner: VIGNETTE_INNER }],
    }),
  },
  // Blurs the whole picture: Amount is the blur's radius in percent of the
  // frame width, so 1% is about 19 px in a 1080p export.
  blur: {
    id: 'blur',
    name: 'Blur',
    params: [{ key: 'amount', label: 'Amount', min: 0, max: 5, default: 1, unit: '%' }],
    look: (params, weight) => ({
      filters: [{ kind: 'blur', radius: (params.amount / 100) * weight }],
      layers: [],
    }),
  },
}

/** The plugin's definitions, in the ids module's (= menu) order. */
export const visualEffectDefinitions: readonly PictureEffectDefinition[] = VISUAL_EFFECT_IDS.map(
  (id) => DEFINITIONS[id],
)

/** Registers the plugin's effects; returns the undo (#197's contract). */
export function activate(): () => void {
  for (const definition of visualEffectDefinitions) pictureEffectRegistry.register(definition)
  return () => {
    for (const definition of visualEffectDefinitions) pictureEffectRegistry.unregister(definition.id)
  }
}
