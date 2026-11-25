import { pictureEffectRegistry, textureStep } from '../../lib/pictureEffect'
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
 * Every rule scales its strength by the ease's `weight`, so weight 0 is
 * the untouched picture and nothing pops at either end of a window. Film
 * grain (#870) is a generated texture whose pattern follows the entry's
 * time (`textureStep`), so it too is a pure function of its inputs.
 */

/** Where a vignette's darkening begins, as a fraction of the way from the centre to a corner. */
export const VIGNETTE_INNER = 0.45

/**
 * The frame width Film grain's Size is measured against (#870): Size is a
 * grain's width in pixels of a 1080p frame, and the grain keeps its
 * proportion at any other size, as a blur's radius does.
 */
export const GRAIN_REFERENCE_WIDTH = 1920

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
  // Animated monochrome noise over the picture (#870): Amount is how far
  // the strongest grain lightens or darkens the picture, in percent; Size
  // is a grain's width in pixels of a 1080p frame. The pattern changes 24
  // times a second of the entry's clock, the same pattern for the same
  // instant in the preview and the export. Size starts at 2: at 1 the
  // tile is 1920 cells across, about 44 ms to build, and the preview's
  // playback of a 1080p clip fell to 10 frames a second (#870's PR).
  'film-grain': {
    id: 'film-grain',
    name: 'Film grain',
    params: [
      { key: 'amount', label: 'Amount', min: 0, max: 100, default: 30, unit: '%' },
      { key: 'size', label: 'Size', min: 2, max: 10, default: 3 },
    ],
    look: (params, weight, time = 0) => ({
      filters: [],
      layers: [
        {
          kind: 'grain',
          amount: (params.amount / 100) * weight,
          cell: params.size / GRAIN_REFERENCE_WIDTH,
          seed: textureStep(time),
        },
      ],
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
