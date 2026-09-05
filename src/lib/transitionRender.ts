import type { TransitionType } from './timeline'
import { TRANSITION_TYPES } from './timeline'

/**
 * How the two clips of a transition overlap are layered onto the black
 * stage at a given progress. One pure rule drives both renderers — the
 * preview (CSS, in PreviewPlayer) and the export (canvas, in exportVideo) —
 * so the two cannot drift apart (#66).
 *
 * Transitions live in a registry (#199) — the second plugin extension point,
 * shaped like the export-format registry (#196, ADR 0003). The timeline's
 * type picker and the now-playing label consult the registry for what
 * exists, and both renderers resolve a type through `transitionLayerSpec`
 * below; nothing outside this module hard-codes the list. Core transitions
 * (#42, #181) register at startup; a plugin contributes more by calling
 * `transitionRegistry.register` when it is enabled.
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

/**
 * A full-frame colored layer above both clips (#181): the dip of a fade
 * through black/white. Alpha 0 and 1 are meaningful ends of the ramp, so
 * the veil's presence (non-null) rather than its alpha marks a dipping type.
 */
export interface TransitionVeil {
  /** CSS color of the veil — '#000000' or '#ffffff' today. */
  color: string
  /** Opacity of the veil over everything beneath it. */
  alpha: number
}

/**
 * An ellipse in the incoming card's own space (#181): the iris. Centred on
 * the card's centre with radii `radiusFraction` of the frame width and of
 * the frame height respectively — at `IRIS_COVER_RADIUS` the ellipse passes
 * exactly through the frame corners, covering everything. `invert: false`
 * paints the card only inside the ellipse (iris open); `invert: true` only
 * outside it (iris close).
 */
export interface TransitionEllipse {
  radiusFraction: number
  invert: boolean
}

/**
 * The radius fraction at which the iris ellipse covers the whole frame: an
 * ellipse with radii `r·width` and `r·height` contains the corner
 * (width/2, height/2) exactly when (1/2r)² + (1/2r)² = 1, i.e. r = √½.
 */
export const IRIS_COVER_RADIUS = Math.SQRT1_2

/**
 * How far a cross-zoom magnifies at its midpoint (#181): each clip zooms
 * from (or back to) normal by this factor about the frame centre. 2.5 is a
 * typical editor default — strong enough to read as a zoom, small enough
 * that ordinary footage still shows recognizable detail at the peak.
 */
export const CROSS_ZOOM_PEAK = 2.5

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
  /**
   * Scale of the outgoing layer about the frame centre (#181): cross-zoom
   * magnifies the outgoing clip toward its midpoint. 1 for every other
   * type, so pre-cross-zoom renders are untouched.
   */
  outgoingScale: number
  /** Scale of the incoming card about the frame centre (#181); 1 = none. */
  incomingScale: number
  /** Full-frame color layer above both clips (#181); null = none. */
  veil: TransitionVeil | null
  /**
   * Elliptical region of the incoming card that paints (#181) — the iris.
   * Null means no elliptical cut, as every pre-iris type always had.
   */
  incomingEllipse: TransitionEllipse | null
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
 * Fades through black/white (#181) put a full-frame color veil above both
 * layers: it ramps to opaque over the first half (hiding the swap beneath
 * it at the midpoint) and back out over the second, so the cut itself is
 * never visible. Irises (#181) are wipes with an elliptical edge: open
 * reveals the incoming card inside a growing centre ellipse, close shows it
 * outside a shrinking one. Cross-zoom (#181) scales the outgoing clip into
 * a magnification and the incoming clip back out of one, blending the two
 * around the midpoint.
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

/**
 * The spec every type starts from: both layers full, static, uncut.
 * Exported as part of the registry contract (#199): a plugin definition
 * composes its `layerSpec` from this base exactly as the core types below
 * do, so a new transition only states what it changes.
 */
export const BASE_TRANSITION_SPEC: TransitionLayerSpec = {
  outgoingAlpha: 1,
  incomingAlpha: 1,
  additive: false,
  incomingOffsetXFraction: 0,
  incomingOffsetYFraction: 0,
  outgoingOffsetXFraction: 0,
  outgoingOffsetYFraction: 0,
  incomingBacking: true,
  incomingClip: null,
  outgoingScale: 1,
  incomingScale: 1,
  veil: null,
  incomingEllipse: null,
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

const edgeOf = (type: string): Edge => type.slice(type.lastIndexOf('-') + 1) as Edge

/** The core per-type rule — registered below; see the block comment above. */
function coreLayerSpec(type: string, progress: number): TransitionLayerSpec {
  if (type === 'crossfade') {
    return {
      ...BASE_TRANSITION_SPEC,
      outgoingAlpha: 1 - progress,
      incomingAlpha: progress,
      additive: true,
      incomingBacking: false,
    }
  }
  if (type === 'fade-through-black' || type === 'fade-through-white') {
    // Dip to color (#181): the veil ramps to opaque over the first half —
    // the incoming card stays invisible beneath it — then, with the frame
    // fully the veil's color at the midpoint, the layers swap and the veil
    // ramps back out over the fully-covering incoming card. Nothing pops:
    // at progress 0 and 1 the veil's alpha is exactly 0.
    const color = type === 'fade-through-black' ? '#000000' : '#ffffff'
    if (progress <= 0.5) {
      return { ...BASE_TRANSITION_SPEC, incomingAlpha: 0, veil: { color, alpha: progress * 2 } }
    }
    return { ...BASE_TRANSITION_SPEC, veil: { color, alpha: (1 - progress) * 2 } }
  }
  if (type === 'iris-open' || type === 'iris-close') {
    // Iris (#181): open reveals the incoming card inside a growing ellipse
    // (zero radius at progress 0, corner-touching cover at 1); close shows
    // it outside a shrinking one — the outgoing clip's final moments live
    // in the contracting hole. Both hit exact cover/reveal at the ends.
    return type === 'iris-open'
      ? { ...BASE_TRANSITION_SPEC, incomingEllipse: { radiusFraction: progress * IRIS_COVER_RADIUS, invert: false } }
      : {
          ...BASE_TRANSITION_SPEC,
          incomingEllipse: { radiusFraction: (1 - progress) * IRIS_COVER_RADIUS, invert: true },
        }
  }
  if (type === 'cross-zoom') {
    // Cross-zoom (#181): the outgoing clip accelerates into a zoom over the
    // first half and the incoming clip decelerates out of one over the
    // second, both peaking at CROSS_ZOOM_PEAK; the incoming card blends in
    // around the midpoint (progress 0.4 → 0.6). Both ends are scale 1 with
    // the handover clip fully shown, so nothing pops.
    const outgoingTravel = Math.min(2 * progress, 1)
    const incomingTravel = Math.min(2 * (1 - progress), 1)
    return {
      ...BASE_TRANSITION_SPEC,
      incomingAlpha: clamp01((progress - 0.4) / 0.2),
      outgoingScale: 1 + (CROSS_ZOOM_PEAK - 1) * outgoingTravel * outgoingTravel,
      incomingScale: 1 + (CROSS_ZOOM_PEAK - 1) * incomingTravel * incomingTravel,
    }
  }
  const entry = ENTRY_VECTOR[edgeOf(type)]
  if (type.startsWith('slide')) {
    // `+ 0` turns the -0 of a negative entry vector times zero travel into
    // plain 0, so progress 1 yields exact-cover offsets of (0, 0).
    return {
      ...BASE_TRANSITION_SPEC,
      incomingOffsetXFraction: entry.x * (1 - progress) + 0,
      incomingOffsetYFraction: entry.y * (1 - progress) + 0,
    }
  }
  if (type.startsWith('push')) {
    // Incoming card as a slide; outgoing exits through the opposite edge in
    // lockstep — the two edges meet at the frame line entry·(1 − progress)
    // from cover, so no gap opens and nothing pops at either end.
    return {
      ...BASE_TRANSITION_SPEC,
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
    ...BASE_TRANSITION_SPEC,
    incomingClip: {
      x: entry.x === 1 ? 1 - progress : 0,
      y: entry.y === 1 ? 1 - progress : 0,
      width: entry.x === 0 ? 1 : progress,
      height: entry.y === 0 ? 1 : progress,
    },
  }
}

/**
 * One registered transition (#199). **This interface is a contract plugins
 * depend on** (#183's API-stability concern, ADR 0003): change it
 * deliberately, with every registration and ADR 0003 updated in the same PR.
 * Per the approved scope-creep guard it carries only what a registered
 * transition demonstrably needs today — an id, a picker name, and the pure
 * layer rule both renderers already consume — and grows when a concrete
 * plugin needs more, not in anticipation.
 */
export interface TransitionDefinition {
  /**
   * Stable identifier — what timeline state and project files record
   * (e.g. 'crossfade'). Must never be reused for a different effect: a
   * saved project resolves its transitions by this id.
   */
  id: string
  /**
   * Human-readable name, sentence case, shown in the timeline's type picker
   * (e.g. 'Wipe from left'). The preview's now-playing line shows it
   * lowercased.
   */
  name: string
  /**
   * The pure layer rule at a progress in [0, 1] — the same
   * `TransitionLayerSpec` vocabulary core transitions use, driving the
   * preview's CSS and the export's canvas identically by construction.
   */
  layerSpec: (progress: number) => TransitionLayerSpec
}

/**
 * Registry of transitions, in registration order (which is picker order).
 * The app uses the `transitionRegistry` singleton; tests construct their
 * own. Mirrors the export-format registry (#196): `register`/`unregister`
 * are how a plugin's contributions arrive and leave, and `subscribe` +
 * `version` pair with React's `useSyncExternalStore` so the picker re-reads
 * the registry when plugins change it at runtime.
 */
export class TransitionRegistry {
  private readonly definitions = new Map<string, TransitionDefinition>()
  private readonly listeners = new Set<() => void>()
  /** Monotonic change counter — the snapshot for `useSyncExternalStore`. */
  version = 0

  /** Adds a transition. A duplicate id is a programming error and throws. */
  register(definition: TransitionDefinition): void {
    if (this.definitions.has(definition.id)) {
      throw new Error(`Transition '${definition.id}' is already registered.`)
    }
    this.definitions.set(definition.id, definition)
    this.notify()
  }

  /**
   * Removes a transition — how a disabled plugin's contributions leave the
   * picker. Removing an id that is not registered is a no-op: a plugin's
   * deactivate must stay safe whatever order teardown runs in.
   */
  unregister(id: string): void {
    if (this.definitions.delete(id)) this.notify()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    this.version++
    for (const listener of this.listeners) listener()
  }

  has(id: string): boolean {
    return this.definitions.has(id)
  }

  /** The definition for `id`, or undefined for an unregistered id — the
   * render paths fall back rather than throw (see `transitionLayerSpec`). */
  find(id: string): TransitionDefinition | undefined {
    return this.definitions.get(id)
  }

  /** All registered definitions, in registration order. */
  list(): TransitionDefinition[] {
    return [...this.definitions.values()]
  }
}

/** Picker names of the core transitions, in `TRANSITION_TYPES` order. */
const CORE_TRANSITION_NAMES: Record<(typeof TRANSITION_TYPES)[number], string> = {
  crossfade: 'Crossfade',
  'slide-from-above': 'Slide from above',
  'slide-from-below': 'Slide from below',
  'slide-from-left': 'Slide from left',
  'slide-from-right': 'Slide from right',
  'wipe-from-left': 'Wipe from left',
  'wipe-from-right': 'Wipe from right',
  'wipe-from-above': 'Wipe from above',
  'wipe-from-below': 'Wipe from below',
  'push-from-left': 'Push from left',
  'push-from-right': 'Push from right',
  'push-from-above': 'Push from above',
  'push-from-below': 'Push from below',
  'fade-through-black': 'Fade through black',
  'fade-through-white': 'Fade through white',
  'iris-open': 'Iris open',
  'iris-close': 'Iris close',
  'cross-zoom': 'Cross-zoom',
}

/**
 * Registers the core transitions (#42, #181) in `TRANSITION_TYPES` order, so
 * the picker lists them exactly as it always has. Exported so registry tests
 * can populate fresh instances; the app uses the singleton registration
 * below.
 */
export function registerCoreTransitions(registry: TransitionRegistry): void {
  for (const type of TRANSITION_TYPES) {
    registry.register({
      id: type,
      name: CORE_TRANSITION_NAMES[type],
      layerSpec: (progress) => coreLayerSpec(type, progress),
    })
  }
}

/** The app's registry. Core transitions register into it at startup. */
export const transitionRegistry = new TransitionRegistry()
registerCoreTransitions(transitionRegistry)

/**
 * The layer spec for a transition type at a progress — the one resolution
 * point both renderers go through. An *unregistered* type falls back to the
 * crossfade rule rather than throwing: timeline state can outlive a plugin
 * (a pack transition stays on the timeline after its plugin is disabled —
 * the #197 disable semantics tear down contributions, not user edits), and
 * a render loop must keep drawing something reasonable. A crossfade is the
 * gentlest stand-in — a plain dissolve, never a black frame — and the type
 * picker shows the raw id as unavailable, so the state is visible rather
 * than silently rewritten.
 */
export function transitionLayerSpec(
  type: TransitionType,
  progress: number,
  registry: TransitionRegistry = transitionRegistry,
): TransitionLayerSpec {
  const definition = registry.find(type)
  if (definition !== undefined) return definition.layerSpec(progress)
  return coreLayerSpec('crossfade', progress)
}

/**
 * The now-playing label for a transition type: the registered name,
 * lowercased ('Wipe from left' → 'wipe from left', matching the label the
 * preview always showed). An unregistered type shows its raw id, so a
 * timeline carrying a disabled plugin's transition says which one.
 */
export function transitionLabel(
  type: TransitionType,
  registry: TransitionRegistry = transitionRegistry,
): string {
  return registry.find(type)?.name.toLowerCase() ?? type
}

/**
 * The transition types in `types` that no registered definition covers —
 * what the project-open flow checks *after* plugin dependencies are settled
 * (#199): a type still unknown then is either a corrupt file or one saved by
 * a newer build, and opening it would silently render fallbacks.
 */
export function unregisteredTransitionTypes(
  types: Iterable<string>,
  registry: TransitionRegistry = transitionRegistry,
): string[] {
  return [...new Set(types)].filter((type) => !registry.has(type))
}
