import { pictureEffectRegistry, textureHash, textureStep } from '../../lib/pictureEffect'
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
 * time (`textureStep`), so it too is a pure function of its inputs, and so
 * is Old film's flicker.
 */

/** Where a vignette's darkening begins, as a fraction of the way from the centre to a corner. */
export const VIGNETTE_INNER = 0.45

/**
 * The frame width Film grain's Size is measured against (#870): Size is a
 * grain's width in pixels of a 1080p frame, and the grain keeps its
 * proportion at any other size, as a blur's radius does.
 */
export const GRAIN_REFERENCE_WIDTH = 1920

/**
 * Old film (#870) at Amount 100 and full weight: the sepia's amount, how
 * far the flicker moves the brightness either way, its grain's strength
 * and size (Film grain's Amount and Size, as fractions and 1080p pixels),
 * and the brightest scratch's and the strongest dust speck's alpha. Amount
 * scales them all together, so it is one dial from a faint tint to a
 * strongly aged picture.
 */
export const OLD_FILM = { sepia: 0.85, flicker: 0.08, grain: 0.2, grainSize: 3, scratches: 0.5, dust: 0.7 }

/**
 * VHS (#870, step 2b(i)) at Amount 100 and full weight: its soft blur's
 * radius as a fraction of the frame width (about 3 px of a 1080p frame,
 * a tape's lost sharpness rather than Blur's deliberate haze), the
 * darkest scanline's alpha, the tracking band's brightest cell's alpha,
 * and how far its colour offset (step 2b(ii)3) moves red left and blue
 * right, as a fraction of the frame width (about 4 px of a 1080p frame,
 * a fringe that reads as a tape's colour bleed without doubling the
 * picture). Amount scales them all together.
 */
export const VHS = { blur: 0.0015, scanlines: 0.4, tracking: 0.5, offset: 0.002 }

/**
 * How far Chromatic aberration (#871) moves the picture's red left and its
 * blue right at Amount 100 and full weight, as a fraction of the frame
 * width: about 19 px of a 1080p frame, a strong colour split, so that the
 * default 30 % (about 6 px) reads as a cheap lens's fringes and the top of
 * the range as a stylised RGB split. The split is the same everywhere in
 * the frame: #977's `channel-offset` kind, which neither CSS nor the
 * canvas could turn into a radial one that grows toward the edges.
 */
export const CHROMATIC_ABERRATION = { offset: 0.01 }

/**
 * Glitch (#871, step 2a). The entry's clock is cut into bursts of
 * `steps` texture steps, an eighth of a second each, and a burst either
 * glitches or holds still: Frequency is the chance that one glitches,
 * decided per burst by a hash, so the moments look irregular but are the
 * same on every render. Through a glitching burst, red moves left and
 * blue right by `offset` of the frame width at Intensity 100, about 38 px
 * of a 1080p frame, times a size of its own between `least` and 1, so one
 * burst is a twitch and the next a lurch.
 */
export const GLITCH = { steps: 3, offset: 0.02, least: 0.4 }

/**
 * How large Glitch's burst at `time` is, for a Frequency of `chance`
 * (0 to 1): 0 for a burst that holds still, else between `GLITCH.least`
 * and 1. A pure function of the entry's time, from the hash the textures
 * use, at cells no texture reaches (x = −500), so the bursts are
 * independent of every grain, scratch and band.
 */
export function glitchBurst(time: number, chance: number): number {
  const burst = Math.floor(textureStep(time) / GLITCH.steps)
  if (textureHash(burst, -500, -1) >= chance) return 0
  return GLITCH.least + (1 - GLITCH.least) * textureHash(burst, -500, -2)
}

/**
 * Old film's brightness at `time` for a flicker of `depth` (#870): a
 * multiplier in [1 − depth, 1 + depth], one value per texture step, from
 * the same hash the grain uses at a cell no grain tile reaches (x = −1),
 * so the flicker and the grain are independent patterns and both a pure
 * function of the entry's time.
 */
export function oldFilmBrightness(time: number, depth: number): number {
  return 1 + depth * (2 * textureHash(textureStep(time), -1, 0) - 1)
}

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
  // An aged film look (#870, step 2a): sepia toning, a brightness that
  // flickers 24 times a second of the entry's clock, a fine grain, and the
  // occasional vertical scratch and dust speck, which change at the same
  // rate. Amount is the strength of them all, in percent.
  'old-film': {
    id: 'old-film',
    name: 'Old film',
    params: [{ key: 'amount', label: 'Amount', min: 0, max: 100, default: 70, unit: '%' }],
    look: (params, weight, time = 0) => {
      const strength = (params.amount / 100) * weight
      return {
        filters: [
          { kind: 'sepia', amount: OLD_FILM.sepia * strength },
          { kind: 'brightness', amount: oldFilmBrightness(time, OLD_FILM.flicker * strength) },
        ],
        layers: [
          {
            kind: 'grain',
            amount: OLD_FILM.grain * strength,
            cell: OLD_FILM.grainSize / GRAIN_REFERENCE_WIDTH,
            seed: textureStep(time),
          },
          { kind: 'scratches', amount: OLD_FILM.scratches * strength, seed: textureStep(time) },
          { kind: 'dust', amount: OLD_FILM.dust * strength, seed: textureStep(time) },
        ],
      }
    },
  },
  // A worn videotape look (#870, step 2b(i)): a soft blur and thin dark
  // scanlines across the picture, whose darkness shimmers 24 times a
  // second of the entry's clock, and now and then a light, noisy tracking
  // band that rolls down the frame for half a second, and a colour offset
  // (step 2b(ii)3): red moved left and blue right, so edges carry the
  // fringes of a tape's colour bleed. The offset comes before the blur,
  // which softens the fringes as it softens the picture. Amount is the
  // strength of them all, in percent.
  vhs: {
    id: 'vhs',
    name: 'VHS',
    params: [{ key: 'amount', label: 'Amount', min: 0, max: 100, default: 70, unit: '%' }],
    look: (params, weight, time = 0) => {
      const strength = (params.amount / 100) * weight
      return {
        filters: [
          { kind: 'channel-offset', offset: VHS.offset * strength },
          { kind: 'blur', radius: VHS.blur * strength },
        ],
        layers: [
          { kind: 'scanlines', amount: VHS.scanlines * strength, seed: textureStep(time) },
          { kind: 'tracking', amount: VHS.tracking * strength, seed: textureStep(time) },
        ],
      }
    },
  },
  // Colour fringes at every edge (#871): red moved left and blue right,
  // green kept, as a lens that focuses the colours apart. Amount is the
  // split in percent of CHROMATIC_ABERRATION.offset. Drawn through #977's
  // one SVG filter, so the preview and the export shift alike.
  'chromatic-aberration': {
    id: 'chromatic-aberration',
    name: 'Chromatic aberration',
    params: [{ key: 'amount', label: 'Amount', min: 0, max: 100, default: 30, unit: '%' }],
    look: (params, weight) => ({
      filters: [{ kind: 'channel-offset', offset: CHROMATIC_ABERRATION.offset * (params.amount / 100) * weight }],
      layers: [],
    }),
  },
  // Short bursts of a broken signal (#871, step 2a): at irregular moments,
  // an eighth of a second at a time, the picture's red and blue jump
  // apart, by a different amount each burst. Intensity is how far, in
  // percent; Frequency is the chance, in percent, that a burst glitches.
  // The moments come from the entry's time (`glitchBurst`), so the preview
  // and the export glitch at the same instants. The channel split is
  // #977's filter, as Chromatic aberration's is; the slice displacement
  // #871 also names is a later step.
  glitch: {
    id: 'glitch',
    name: 'Glitch',
    params: [
      { key: 'intensity', label: 'Intensity', min: 0, max: 100, default: 50, unit: '%' },
      { key: 'frequency', label: 'Frequency', min: 0, max: 100, default: 30, unit: '%' },
    ],
    look: (params, weight, time = 0) => ({
      filters: [
        {
          kind: 'channel-offset',
          offset: GLITCH.offset * (params.intensity / 100) * weight * glitchBurst(time, params.frequency / 100),
        },
      ],
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
