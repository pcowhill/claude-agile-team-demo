import { NO_PICTURE_LOOK, pictureEffectParamsFor, pictureEffectRegistry } from './pictureEffect'
import type {
  PictureEffect,
  PictureEffectRegistry,
  PictureFilter,
  PictureLayer,
  PictureLook,
  SliceBand,
} from './pictureEffect'
import { effectiveDuration, everyPictureEffectOf, pictureEffectsForEntry } from './timeline'
import type { TimelineState } from './timeline'
import type { VideoOverlay } from './videoOverlay'
import { overlayOutputDuration } from './videoOverlay'

/**
 * Resolving an entry's picture effects (#862) at an instant: the one place
 * both renderers ask "what does this entry's picture look like now?", as
 * `zoomAt` is for zooms (#63). The preview and the export each map the
 * returned `PictureLook` to their own medium; neither decides the ease, the
 * window or which definitions count.
 */

/**
 * How long an effect eases in and out, in the entry's source seconds. Long
 * enough that a blur or a vignette arriving never pops, short enough that a
 * three-second effect is at full strength for most of its window. A window
 * shorter than twice this eases over half its length each way.
 */
export const PICTURE_EFFECT_EASE_SECONDS = 0.3

/** Below this, a window edge counts as lying on its entry's bound (float noise from a split). */
const BOUND_EPSILON = 1e-6

const smoothstep = (t: number) => t * t * (3 - 2 * t)

/**
 * An effect's weight in [0, 1] at `offset`, seconds into its entry's
 * trimmed range of `trimmedLength`: 0 outside the window, easing up over
 * the first `PICTURE_EFFECT_EASE_SECONDS` and down over the last.
 *
 * **An edge lying on the entry's own bounds does not ease** (#919): the
 * effect is at full weight from the entry's first frame, or to its last.
 * A split cuts an effect in two at the cut, and the halves must render as
 * the one effect did, not ease out and back in across the cut. An effect
 * the user starts at the entry's in-point arrives with the entry's cut or
 * transition, which is where the picture changes anyway.
 */
export function pictureEffectWeight(
  effect: Pick<PictureEffect, 'start' | 'end'>,
  offset: number,
  trimmedLength: number,
): number {
  if (!(offset >= effect.start && offset <= effect.end) || effect.end <= effect.start) return 0
  const ease = Math.min(PICTURE_EFFECT_EASE_SECONDS, (effect.end - effect.start) / 2)
  const easesIn = effect.start > BOUND_EPSILON
  const easesOut = effect.end < trimmedLength - BOUND_EPSILON
  const rampIn = easesIn ? Math.min(1, (offset - effect.start) / ease) : 1
  const rampOut = easesOut ? Math.min(1, (effect.end - offset) / ease) : 1
  return smoothstep(Math.max(0, Math.min(rampIn, rampOut)))
}

/**
 * The look of the entry at `entryIndex` at `sourceTime`, its source clock
 * (the time `zoomAt` takes): every effect whose window holds the instant,
 * in start order, each through its definition's rule at its eased weight
 * and at `sourceTime` itself, the clock a generated texture steps on (#870).
 * An effect whose type no registered definition covers, such as one from a
 * disabled plugin, contributes nothing: it stays in the project and renders
 * as nothing, as a disabled plugin's transition does. An entry with no
 * effect gets `NO_PICTURE_LOOK` itself, so callers can skip by reference.
 */
export function pictureLookAt(
  state: TimelineState,
  entryIndex: number,
  sourceTime: number,
  registry: PictureEffectRegistry = pictureEffectRegistry,
): PictureLook {
  const entry = state.entries[entryIndex]
  if (entry === undefined) return NO_PICTURE_LOOK
  const effects = pictureEffectsForEntry(state, entry.id)
  return lookOf(effects, sourceTime - entry.inPoint, effectiveDuration(entry), sourceTime, registry)
}

/**
 * The look of a video or image overlay's own picture (#872) at sequence
 * time `sequenceTime`: `pictureLookAt`'s rule over the overlay's effects
 * (`VideoOverlay.pictureEffects`), whose windows are in its **on-screen**
 * seconds. So the weight is read at `sequenceTime − offset` against
 * `overlayOutputDuration`, and an edge lying on the overlay's own first or
 * last on-screen instant does not ease, which is what lets the two halves
 * Split…, Cut… and a ripple cut leave render as the one effect did.
 * `sourceTime` is the overlay's own source clock at that instant
 * (`videoOverlayPlaybackAt`), the clock a generated texture steps on, as
 * an entry's steps on its source clock. An overlay with no effect gets
 * `NO_PICTURE_LOOK` itself.
 */
export function overlayPictureLookAt(
  overlay: Pick<VideoOverlay, 'offset' | 'inPoint' | 'outPoint' | 'remaps' | 'pictureEffects'>,
  sequenceTime: number,
  sourceTime: number,
  registry: PictureEffectRegistry = pictureEffectRegistry,
): PictureLook {
  const effects = overlay.pictureEffects
  if (effects === undefined || effects.length === 0) return NO_PICTURE_LOOK
  return lookOf(effects, sequenceTime - overlay.offset, overlayOutputDuration(overlay), sourceTime, registry)
}

/**
 * Effects composed at `offset` seconds into their owner's window of
 * `length`: every effect whose window holds the instant, in stored (start)
 * order, each through its definition at its eased weight and at `clock`.
 */
function lookOf(
  effects: readonly Pick<PictureEffect, 'type' | 'start' | 'end' | 'params'>[],
  offset: number,
  length: number,
  clock: number,
  registry: PictureEffectRegistry,
): PictureLook {
  if (effects.length === 0) return NO_PICTURE_LOOK
  const filters: PictureFilter[] = []
  const layers: PictureLayer[] = []
  for (const effect of effects) {
    const weight = pictureEffectWeight(effect, offset, length)
    if (weight <= 0) continue
    const definition = registry.find(effect.type)
    if (definition === undefined) continue
    const look = definition.look(pictureEffectParamsFor(definition, effect.params), weight, clock)
    filters.push(...look.filters)
    layers.push(...look.layers)
  }
  return filters.length === 0 && layers.length === 0 ? NO_PICTURE_LOOK : { filters, layers }
}

/**
 * Whether any picture effect on the timeline needs canvas `filter` support
 * to export: a registered effect whose look at full weight has a filter.
 * The export refuses up front without that support, as it does for colour
 * adjustments (#195), rather than writing a file missing the blur. A
 * pixelate filter (#871) does not count: it is drawn by downscaling, which
 * needs no canvas `filter`. An overlay's effects (#872) count as an
 * entry's do.
 */
export function timelineHasPictureFilters(
  state: TimelineState,
  registry: PictureEffectRegistry = pictureEffectRegistry,
): boolean {
  return everyPictureEffectOf(state).some((effect) => {
    const definition = registry.find(effect.type)
    return (
      definition !== undefined &&
      definition
        .look(pictureEffectParamsFor(definition, effect.params), 1, effect.start)
        .filters.some((filter) => filter.kind !== 'pixelate')
    )
  })
}

/**
 * The CSS / canvas `filter` functions for a look's filters, where a blur's
 * radius (a fraction of the frame width) becomes `frameWidth * radius`
 * units of `unit`. The preview passes the frame's `cqw` (100 per width),
 * the export the canvas's px. `scale` divides the radius for a renderer
 * that applies the filter inside a transform which magnifies it again,
 * such as the preview's zoom. Sepia and brightness (#870) have no size, so
 * neither the width nor the scale touches them. Empty for a look with no
 * filters.
 *
 * A channel offset (#870) has no filter function of its own: it is an SVG
 * filter referenced by `url(#id)`, whose shift is in the filtered
 * element's own pixels, which a `cqw` cannot give. So `channelOffset`
 * turns the offset (a fraction of the frame width) into that reference,
 * making the filter it names (`channelOffsetFilterUrl`), or null to draw
 * none; each renderer knows its own pixels and transform. Without it, a
 * channel offset adds nothing.
 *
 * Slices (#871) are the same: an SVG filter whose bands are in the
 * filtered element's own pixels, so `slices` turns the bands into that
 * reference (`slicesFilterUrl`), or null to draw none. Without it, or with
 * no bands, slices add nothing.
 *
 * Pixelate (#871) adds nothing here either: no filter function draws it,
 * so a renderer draws it by downscaling (`pixelateGrid`).
 */
export function pictureFilterFunctions(
  filters: readonly PictureFilter[],
  frameWidth: number,
  unit: 'px' | 'cqw',
  scale = 1,
  channelOffset?: (offset: number) => string | null,
  slices?: (bands: readonly SliceBand[]) => string | null,
): string[] {
  const number = (value: number) => Number(value.toFixed(4))
  return filters.flatMap((filter) => {
    switch (filter.kind) {
      case 'blur':
        return [`blur(${number((filter.radius * frameWidth) / scale)}${unit})`]
      case 'sepia':
        return [`sepia(${number(Math.min(Math.max(filter.amount, 0), 1))})`]
      case 'brightness':
        return [`brightness(${number(Math.max(filter.amount, 0))})`]
      case 'channel-offset': {
        const reference = filter.offset > 0 ? (channelOffset?.(filter.offset) ?? null) : null
        return reference === null ? [] : [reference]
      }
      case 'slices': {
        const reference = filter.bands.length > 0 ? (slices?.(filter.bands) ?? null) : null
        return reference === null ? [] : [reference]
      }
      case 'pixelate':
        // Drawn by downscaling, not a filter function (#871): the export's
        // `withPictureFilters` does it around the source draw.
        return []
    }
  })
}
