import type { TransitionType } from './timeline'

/**
 * How the two clips of a transition overlap are layered onto the black
 * stage at a given progress. One pure rule drives both renderers — the
 * preview (CSS, in PreviewPlayer) and the export (canvas, in exportVideo) —
 * so the two cannot drift apart (#66).
 */
export interface TransitionLayerSpec {
  /** Alpha of the outgoing clip's layer, drawn first over the black stage. */
  outgoingAlpha: number
  /** Alpha of the incoming clip's layer, drawn on top. */
  incomingAlpha: number
  /**
   * When true the incoming layer ADDS to what is under it instead of
   * covering it (canvas `lighter`, CSS `plus-lighter`).
   */
  additive: boolean
  /** Horizontal offset of the incoming layer, as a fraction of frame width. */
  incomingOffsetXFraction: number
  /** Vertical offset of the incoming layer, as a fraction of frame height. */
  incomingOffsetYFraction: number
  /**
   * When true the incoming layer is a full-frame card: an opaque black
   * backing the size of the whole frame with the clip aspect-fitted inside
   * it, moving as one unit. Regions of the frame the clip's fitted box does
   * not reach are the card's black, not whatever lies beneath (#74).
   */
  incomingBacking: boolean
}

/**
 * Crossfade is a true A/B dissolve over black: outgoing at `1 − progress`,
 * incoming ADDED at `progress`. The additive blend is what makes the rule
 * hold everywhere at once (#66): where the incoming clip covers the outgoing
 * one the sum is `progress·incoming + (1 − progress)·outgoing` — exactly the
 * equal-aspect crossfade the app has always shown — while any region only
 * one clip reaches fades to or from black at that same rate, so differing
 * aspect ratios leave no margin at full brightness and nothing pops at the
 * handover. (Painter's-algorithm alphas without the additive blend would
 * double-attenuate the covered region to `(1 − progress)²·outgoing`.)
 *
 * Slides keep both layers at full opacity, and the incoming layer slides in
 * as a full-frame card with an opaque black backing (`incomingBacking`) —
 * the customer's decision on #67 (#74): the outgoing clip stays at full
 * brightness until the card's edge reaches it, margins the incoming clip's
 * fitted box never covers are covered by the card's sliding black, and at
 * the handover the card exactly covers the frame, so nothing pops.
 * Crossfade needs no backing: its incoming layer is ADDED, so the fitted
 * box's empty surroundings contribute nothing by construction.
 *
 * Every slide direction is the same card on a different entry edge: the unit
 * vector below is where the card sits at progress 0 (one full frame off,
 * beyond that edge), and it travels to (0, 0) — exact cover — at progress 1.
 */
const SLIDE_ENTRY_VECTOR: Record<Exclude<TransitionType, 'crossfade'>, { x: number; y: number }> = {
  'slide-from-above': { x: 0, y: -1 },
  'slide-from-below': { x: 0, y: 1 },
  'slide-from-left': { x: -1, y: 0 },
  'slide-from-right': { x: 1, y: 0 },
}

export function transitionLayerSpec(type: TransitionType, progress: number): TransitionLayerSpec {
  if (type === 'crossfade') {
    return {
      outgoingAlpha: 1 - progress,
      incomingAlpha: progress,
      additive: true,
      incomingOffsetXFraction: 0,
      incomingOffsetYFraction: 0,
      incomingBacking: false,
    }
  }
  const entry = SLIDE_ENTRY_VECTOR[type]
  // `+ 0` turns the -0 of a negative entry vector times zero travel into
  // plain 0, so progress 1 yields exact-cover offsets of (0, 0).
  return {
    outgoingAlpha: 1,
    incomingAlpha: 1,
    additive: false,
    incomingOffsetXFraction: entry.x * (1 - progress) + 0,
    incomingOffsetYFraction: entry.y * (1 - progress) + 0,
    incomingBacking: true,
  }
}
