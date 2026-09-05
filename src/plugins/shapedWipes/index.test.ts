import { afterEach, describe, expect, it } from 'vitest'
import { transitionRegistry, transitionLayerSpec } from '../../lib/transitionRender'
import { TRANSITION_TYPES } from '../../lib/timeline'
import { SHAPED_WIPE_TRANSITION_IDS, isShapedWipeTransition } from '../shapedWipesIds'
import { activate, shapedWipeDefinitions } from './index'

/**
 * The Shaped wipes plugin's registration (#199). Like the GIF plugin's tests
 * (#198) these exercise the module the plugin runtime lazy-loads, against
 * the app's real registry singleton — the deactivate returned by `activate`
 * is the cleanup.
 */

let deactivate: (() => void) | null = null

afterEach(() => {
  deactivate?.()
  deactivate = null
})

describe('Shaped wipes activate/deactivate (#199)', () => {
  it('registers every declared id and the deactivate unregisters them all', () => {
    for (const id of SHAPED_WIPE_TRANSITION_IDS) expect(transitionRegistry.has(id)).toBe(false)
    deactivate = activate()
    for (const id of SHAPED_WIPE_TRANSITION_IDS) expect(transitionRegistry.has(id)).toBe(true)
    deactivate()
    deactivate = null
    for (const id of SHAPED_WIPE_TRANSITION_IDS) expect(transitionRegistry.has(id)).toBe(false)
  })

  it('the definitions and the entry-bundle id list cannot drift', () => {
    // The catalog's usedByProject predicate reads the ids module without
    // loading this chunk; a definition the list does not name (or vice
    // versa) would break dependency recording silently.
    expect(shapedWipeDefinitions.map((definition) => definition.id)).toEqual([
      ...SHAPED_WIPE_TRANSITION_IDS,
    ])
    for (const id of SHAPED_WIPE_TRANSITION_IDS) expect(isShapedWipeTransition(id)).toBe(true)
    expect(isShapedWipeTransition('crossfade')).toBe(false)
  })

  it('collides with no core transition id', () => {
    const core: readonly string[] = TRANSITION_TYPES
    for (const id of SHAPED_WIPE_TRANSITION_IDS) expect(core).not.toContain(id)
  })
})

describe('Shaped wipes layer rules (#199)', () => {
  it('every reveal is zero-area at progress 0 and the whole frame at progress 1', () => {
    deactivate = activate()
    for (const id of SHAPED_WIPE_TRANSITION_IDS) {
      const closed = transitionLayerSpec(id, 0).incomingClip
      const open = transitionLayerSpec(id, 1).incomingClip
      expect(closed, id).not.toBeNull()
      expect(open, id).not.toBeNull()
      // Zero area: at least one axis has zero extent.
      expect(Math.min(closed!.width, closed!.height), `${id} at 0`).toBe(0)
      // Exact cover, so nothing pops at the handover (#74's rule).
      expect(open, `${id} at 1`).toEqual({ x: 0, y: 0, width: 1, height: 1 })
    }
  })

  it('changes nothing else: alphas, offsets, scales, veil stay at the base', () => {
    deactivate = activate()
    for (const id of SHAPED_WIPE_TRANSITION_IDS) {
      const spec = transitionLayerSpec(id, 0.5)
      expect(spec.outgoingAlpha, id).toBe(1)
      expect(spec.incomingAlpha, id).toBe(1)
      expect(spec.additive, id).toBe(false)
      expect(spec.incomingBacking, id).toBe(true)
      expect(spec.incomingOffsetXFraction, id).toBe(0)
      expect(spec.incomingOffsetYFraction, id).toBe(0)
      expect(spec.outgoingOffsetXFraction, id).toBe(0)
      expect(spec.outgoingOffsetYFraction, id).toBe(0)
      expect(spec.outgoingScale, id).toBe(1)
      expect(spec.incomingScale, id).toBe(1)
      expect(spec.veil, id).toBeNull()
      expect(spec.incomingEllipse, id).toBeNull()
    }
  })

  it('mid-progress shapes sit where their names say', () => {
    deactivate = activate()
    // Box: centred, half-size on both axes.
    expect(transitionLayerSpec('box-open', 0.5).incomingClip).toEqual({
      x: 0.25,
      y: 0.25,
      width: 0.5,
      height: 0.5,
    })
    // Barn doors: centred full-height band, half-width.
    expect(transitionLayerSpec('barn-doors-open', 0.5).incomingClip).toEqual({
      x: 0.25,
      y: 0,
      width: 0.5,
      height: 1,
    })
    // Letterbox: centred full-width slit, half-height.
    expect(transitionLayerSpec('letterbox-open', 0.5).incomingClip).toEqual({
      x: 0,
      y: 0.25,
      width: 1,
      height: 0.5,
    })
    // Corners: anchored in their corner, growing on both axes.
    expect(transitionLayerSpec('wipe-from-top-left', 0.5).incomingClip).toEqual({
      x: 0,
      y: 0,
      width: 0.5,
      height: 0.5,
    })
    expect(transitionLayerSpec('wipe-from-bottom-right', 0.5).incomingClip).toEqual({
      x: 0.5,
      y: 0.5,
      width: 0.5,
      height: 0.5,
    })
  })
})
