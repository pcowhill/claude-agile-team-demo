import type { TransitionType } from './timeline'

/**
 * How the two clips of a transition overlap are layered onto the black
 * stage at a given progress. One pure rule drives both renderers — the
 * preview (CSS, in PreviewPlayer) and the export (canvas, in exportVideo) —
 * so the two cannot drift apart (#66).
 */

/**
 * An axis-aligned rectangle in the incoming card's own space, all values
 * fractions of the frame (#181). The card's space equals frame space while
 * the card is unoffset — true for every type that clips today (wipes) —
 * and travels with the card otherwise, exactly as a CSS clip-path applied
 * to the translated element would.
 */
export interface TransitionClipRect {
  x: number
  y: number
  width: number
  height: number
}

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
   * Offset of the outgoing layer (#181): pushes move the outgoing clip off
   * the frame as the incoming card moves in. Zero for every other type, so
   * pre-push renders are untouched.
   */
  outgoingOffsetXFraction: number
  outgoingOffsetYFraction: number
  /**
   * When true the incoming layer is a full-frame card: an opaque black
   * backing the size of the whole frame with the clip aspect-fitted inside
   * it, moving as one unit. Regions of the frame the clip's fitted box does
   * not reach are the card's black, not whatever lies beneath (#74).
   */
  incomingBacking: boolean
  /**
   * Clip region of the incoming layer (#181): only this rectangle of the
   * incoming card (backing included) is painted — the wipe's moving edge.
   * Null means the whole card paints, as every pre-wipe type always did.
   */
  incomingClip: TransitionClipRect | null
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
 * Pushes (#181) are slides where the outgoing clip moves too: the incoming
 * card enters from its edge while the outgoing layer exits through the
 * opposite edge in lockstep — the card's leading edge and the outgoing
 * layer's trailing edge sit at the same frame line at every progress, so
 * no gap ever opens and at the handover the card exactly covers the frame.
 *
 * Wipes (#181) move nothing: the incoming card sits at exact cover the
 * whole time and `incomingClip` reveals it behind an edge travelling from
 * the named side — zero area at progress 0, the whole frame at progress 1.
 * The card backing keeps revealed letterbox margins black (#74's rule); the
 * outgoing clip stays at full brightness until the edge passes it.
 *
 * Every direction is the same unit vector: where the moving card (slides,
 * pushes) sits at progress 0 — one full frame beyond that edge — travelling
 * to (0, 0), exact cover, at progress 1; or which edge the wipe's reveal
 * grows from.
 */
const ENTRY_VECTOR: Record<'above' | 'below' | 'left' | 'right', { x: number; y: number }> = {
  above: { x: 0, y: -1 },
  below: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

type Edge = keyof typeof ENTRY_VECTOR

/** The spec every type starts from: both layers full, static, uncut. */
const BASE_SPEC: TransitionLayerSpec = {
  outgoingAlpha: 1,
  incomingAlpha: 1,
  additive: false,
  incomingOffsetXFraction: 0,
  incomingOffsetYFraction: 0,
  outgoingOffsetXFraction: 0,
  outgoingOffsetYFraction: 0,
  incomingBacking: true,
  incomingClip: null,
}

const edgeOf = (type: string): Edge => type.slice(type.lastIndexOf('-') + 1) as Edge

export function transitionLayerSpec(type: TransitionType, progress: number): TransitionLayerSpec {
  if (type === 'crossfade') {
    return {
      ...BASE_SPEC,
      outgoingAlpha: 1 - progress,
      incomingAlpha: progress,
      additive: true,
      incomingBacking: false,
    }
  }
  const entry = ENTRY_VECTOR[edgeOf(type)]
  if (type.startsWith('slide')) {
    // `+ 0` turns the -0 of a negative entry vector times zero travel into
    // plain 0, so progress 1 yields exact-cover offsets of (0, 0).
    return {
      ...BASE_SPEC,
      incomingOffsetXFraction: entry.x * (1 - progress) + 0,
      incomingOffsetYFraction: entry.y * (1 - progress) + 0,
    }
  }
  if (type.startsWith('push')) {
    // Incoming card as a slide; outgoing exits through the opposite edge in
    // lockstep — the two edges meet at the frame line entry·(1 − progress)
    // from cover, so no gap opens and nothing pops at either end.
    return {
      ...BASE_SPEC,
      incomingOffsetXFraction: entry.x * (1 - progress) + 0,
      incomingOffsetYFraction: entry.y * (1 - progress) + 0,
      outgoingOffsetXFraction: -entry.x * progress + 0,
      outgoingOffsetYFraction: -entry.y * progress + 0,
    }
  }
  // Wipe: a static card revealed behind an edge moving from the named side.
  // The revealed band spans `progress` of the frame on the travel axis and
  // hugs the entry edge: from-left reveals [0, progress], from-right
  // [1 − progress, 1], and the vertical wipes the same on y.
  return {
    ...BASE_SPEC,
    incomingClip: {
      x: entry.x === 1 ? 1 - progress : 0,
      y: entry.y === 1 ? 1 - progress : 0,
      width: entry.x === 0 ? 1 : progress,
      height: entry.y === 0 ? 1 : progress,
    },
  }
}
