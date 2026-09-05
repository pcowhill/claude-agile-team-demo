import { BASE_TRANSITION_SPEC, transitionRegistry } from '../../lib/transitionRender'
import type { TransitionClipRect, TransitionDefinition } from '../../lib/transitionRender'
import { SHAPED_WIPE_TRANSITION_IDS } from '../shapedWipesIds'
import type { ShapedWipeTransitionId } from '../shapedWipesIds'

/**
 * The Shaped wipes plugin (#199) — the transitions pack, phase 4 of the
 * customer-approved plugin architecture (#183, ADR 0003), and the first
 * plugin to use the transition registry extension point. One coherent theme:
 * wipes whose reveal has a richer shape than the core set's single moving
 * edge — a box growing from the centre, barn doors parting sideways, a
 * letterbox slit opening vertically, and four corner reveals.
 *
 * Every definition is `BASE_TRANSITION_SPEC` plus a single `incomingClip`
 * rectangle — exactly the vocabulary the core wipes use — so the pack adds
 * no rendering code at all: preview (CSS clip-path) and export (canvas clip)
 * consume the spec through the same `transitionLayerSpec` resolution as
 * every core type, and render identically by construction (#66's shared-rule
 * pattern). The card backing keeps revealed letterbox margins black (#74's
 * rule), and every reveal is zero area at progress 0 and the whole frame at
 * progress 1, so nothing pops at either handover.
 */

/** The reveal rectangle per pack transition at a progress in [0, 1]. */
const REVEAL: Record<ShapedWipeTransitionId, (progress: number) => TransitionClipRect> = {
  // A centred rectangle growing on both axes to exact cover.
  'box-open': (p) => ({ x: (1 - p) / 2, y: (1 - p) / 2, width: p, height: p }),
  // Doors part sideways: a centred full-height band growing horizontally.
  'barn-doors-open': (p) => ({ x: (1 - p) / 2, y: 0, width: p, height: 1 }),
  // A centred full-width slit growing vertically — a letterbox opening up.
  'letterbox-open': (p) => ({ x: 0, y: (1 - p) / 2, width: 1, height: p }),
  // Corner reveals: a rectangle anchored in the named corner, growing on
  // both axes — the diagonal counterpart of the core edge wipes, reaching
  // exact cover at progress 1 like them.
  'wipe-from-top-left': (p) => ({ x: 0, y: 0, width: p, height: p }),
  'wipe-from-top-right': (p) => ({ x: 1 - p, y: 0, width: p, height: p }),
  'wipe-from-bottom-left': (p) => ({ x: 0, y: 1 - p, width: p, height: p }),
  'wipe-from-bottom-right': (p) => ({ x: 1 - p, y: 1 - p, width: p, height: p }),
}

const NAME: Record<ShapedWipeTransitionId, string> = {
  'box-open': 'Box open',
  'barn-doors-open': 'Barn doors open',
  'letterbox-open': 'Letterbox open',
  'wipe-from-top-left': 'Wipe from top left',
  'wipe-from-top-right': 'Wipe from top right',
  'wipe-from-bottom-left': 'Wipe from bottom left',
  'wipe-from-bottom-right': 'Wipe from bottom right',
}

/** The pack's definitions, in the ids module's (= picker) order. */
export const shapedWipeDefinitions: readonly TransitionDefinition[] =
  SHAPED_WIPE_TRANSITION_IDS.map((id) => ({
    id,
    name: NAME[id],
    layerSpec: (progress) => ({ ...BASE_TRANSITION_SPEC, incomingClip: REVEAL[id](progress) }),
  }))

/** Registers the pack's transitions; returns the undo (#197's contract). */
export function activate(): () => void {
  for (const definition of shapedWipeDefinitions) transitionRegistry.register(definition)
  return () => {
    for (const definition of shapedWipeDefinitions) transitionRegistry.unregister(definition.id)
  }
}
