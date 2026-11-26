/**
 * Picture effects on overlays (#872, step 1): the model rules for an
 * effect a video or image overlay owns (`VideoOverlay.pictureEffects`).
 *
 * **Time base.** A window is seconds since the overlay appears, its
 * on-screen time from `offset`, as a Move's is (#834), and it lies within
 * `overlayOutputDuration`. So the overlay's own speed segments and pauses
 * never change when an effect shows, and Split…, Cut… and a ripple cut
 * divide the effects at the same on-screen instant as they divide its
 * Moves (`splitMovesAt`).
 *
 * The windows otherwise follow an entry's effects (#862): they may overlap
 * (a blur and a vignette at once is a stack), so there is no sweep, only a
 * clamp into the window and a sort by start; a window that no longer fits
 * collapses against the end rather than being dropped, as an entry's does.
 */
import type { OverlayPictureEffect } from './pictureEffect'
import { clampPictureEffect } from './pictureEffect'
import type { VideoOverlay } from './videoOverlay'
import { overlayOutputDuration } from './videoOverlay'

/**
 * The overlay with its picture effects normalized against its (already
 * clamped) on-screen window: each window clamped into
 * `[0, overlayOutputDuration]` (`clampPictureEffect`) and the list sorted
 * by start, ties keeping their stored order. An empty list becomes no key
 * at all. The same object when nothing changed, including an overlay with
 * no effects, so effect-free states keep every reference and every saved
 * byte.
 */
export function withOverlayPictureEffectsClamped(overlay: VideoOverlay): VideoOverlay {
  const effects = overlay.pictureEffects
  if (effects === undefined) return overlay
  if (effects.length === 0) {
    const next = { ...overlay }
    delete next.pictureEffects
    return next
  }
  const length = overlayOutputDuration(overlay)
  // Array.prototype.sort is stable: equal starts keep their stored order.
  const normalized = effects.map((effect) => clampPictureEffect(effect, length)).sort((a, b) => a.start - b.start)
  const unchanged = normalized.every((effect, index) => effect === effects[index])
  return unchanged ? overlay : { ...overlay, pictureEffects: normalized }
}

/**
 * An overlay's effects divided at on-screen instant `u` (#872), as an
 * entry's are divided by a split (#862) and an overlay's Moves by
 * `splitMovesAt`:
 *
 * - a window ending at or before `u` stays, whole, in `before` (one ending
 *   exactly on `u` included);
 * - one starting at or after `u` goes to `after`, re-anchored to the
 *   second part's appearance (`start − u`);
 * - one containing `u` becomes two of the same type and parameters,
 *   `[start, u]` before and `[0, end − u]` after.
 *
 * Ids are unique within an overlay, so both halves keep the original's,
 * as a cut Move's do. The halves meet at the parts' shared edge, so they
 * render as the one effect did only if the renderer does not ease in or
 * out at an edge lying on the overlay's own bounds. That is the entry
 * rule's behaviour (#862), and the overlay renderers (#872, steps 2 and 3)
 * must keep it.
 */
export function splitOverlayPictureEffectsAt<T extends OverlayPictureEffect>(
  effects: readonly T[] | undefined,
  u: number,
): { before: T[]; after: T[] } {
  const before: T[] = []
  const after: T[] = []
  for (const effect of effects ?? []) {
    if (effect.end <= u) before.push(effect)
    else if (effect.start >= u) after.push({ ...effect, start: effect.start - u, end: effect.end - u })
    else {
      before.push({ ...effect, end: u })
      after.push({ ...effect, start: 0, end: effect.end - u })
    }
  }
  return { before, after }
}
