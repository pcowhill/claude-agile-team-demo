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
  /** Vertical offset of the incoming layer, as a fraction of frame height. */
  incomingOffsetYFraction: number
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
 * Slides deliberately keep both layers at full opacity: whether a slide's
 * uncovered margins should dim too is an open product question (#67), and
 * until the customer answers it the effect stays exactly as it was.
 */
export function transitionLayerSpec(type: TransitionType, progress: number): TransitionLayerSpec {
  return type === 'crossfade'
    ? { outgoingAlpha: 1 - progress, incomingAlpha: progress, additive: true, incomingOffsetYFraction: 0 }
    : { outgoingAlpha: 1, incomingAlpha: 1, additive: false, incomingOffsetYFraction: progress - 1 }
}
