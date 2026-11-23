import { afterEach, describe, expect, it } from 'vitest'
import {
  transitionLayerSpec,
  transitionRegistry,
  windRevealPolygons,
} from '../../lib/transitionRender'
import type { TransitionPoint } from '../../lib/transitionRender'
import { TRANSITION_TYPES } from '../../lib/timeline'
import { builtInPlugins } from '../catalog'
import {
  CHECKER_COLUMNS,
  CHECKER_ROWS,
  PATTERN_TRANSITION_IDS,
  isPatternTransition,
} from '../patternTransitionsIds'
import { SHAPED_WIPE_TRANSITION_IDS } from '../shapedWipesIds'
import { activate, patternTransitionDefinitions } from './index'

/**
 * The Pattern transitions plugin (#857). Like the Shaped wipes tests (#199)
 * these exercise the module the plugin runtime lazy-loads, against the
 * app's real registry singleton — the deactivate returned by `activate` is
 * the cleanup.
 *
 * Coverage is judged the way a renderer fills: a point is revealed when the
 * non-zero winding number of the resolved polygons around it is not zero,
 * which for polygons `windRevealPolygons` has wound alike is exactly
 * "inside at least one of them".
 */

let deactivate: (() => void) | null = null

afterEach(() => {
  deactivate?.()
  deactivate = null
})

/** The frame aspects a project can have, landscape, portrait and square. */
const ASPECTS = [16 / 9, 9 / 16, 1, 4 / 3]

/** Non-zero winding number of a closed polygon around a point. */
function winding(polygon: readonly TransitionPoint[], point: TransitionPoint): number {
  let count = 0
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index]
    const b = polygon[(index + 1) % polygon.length]
    const cross = (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y)
    if (a.y <= point.y) {
      if (b.y > point.y && cross > 0) count += 1
    } else if (b.y <= point.y && cross < 0) count -= 1
  }
  return count
}

/** Whether the reveal of `id` at `progress` paints the frame-fraction point. */
function revealed(id: string, progress: number, aspect: number, point: TransitionPoint): boolean {
  const reveal = transitionLayerSpec(id, progress, transitionRegistry, aspect).incomingPolygons
  if (reveal === null) throw new Error(`${id} has no polygon reveal`)
  const total = windRevealPolygons(reveal).reduce(
    (sum, polygon) => sum + winding(polygon, point),
    0,
  )
  return total !== 0
}

/** A grid of sample points across the frame, edges included (inset a hair). */
function frameGrid(steps: number): TransitionPoint[] {
  const points: TransitionPoint[] = []
  for (let i = 0; i <= steps; i += 1) {
    for (let j = 0; j <= steps; j += 1) {
      points.push({
        x: Math.min(1 - 1e-6, Math.max(1e-6, i / steps)),
        y: Math.min(1 - 1e-6, Math.max(1e-6, j / steps)),
      })
    }
  }
  return points
}

/** Fraction of the grid's points the reveal paints. */
function coverage(id: string, progress: number, aspect: number): number {
  const grid = frameGrid(40)
  return grid.filter((point) => revealed(id, progress, aspect, point)).length / grid.length
}

/** Total absolute area of the resolved polygons (zero-area means nothing paints). */
function area(id: string, progress: number, aspect: number): number {
  const reveal = transitionLayerSpec(id, progress, transitionRegistry, aspect).incomingPolygons!
  return windRevealPolygons(reveal).reduce((sum, polygon) => {
    let doubled = 0
    for (let index = 0; index < polygon.length; index += 1) {
      const a = polygon[index]
      const b = polygon[(index + 1) % polygon.length]
      doubled += a.x * b.y - b.x * a.y
    }
    return sum + Math.abs(doubled) / 2
  }, 0)
}

describe('Pattern transitions activate/deactivate (#857)', () => {
  it('registers every declared id and the deactivate unregisters them all', () => {
    for (const id of PATTERN_TRANSITION_IDS) expect(transitionRegistry.has(id)).toBe(false)
    deactivate = activate()
    for (const id of PATTERN_TRANSITION_IDS) expect(transitionRegistry.has(id)).toBe(true)
    deactivate()
    deactivate = null
    for (const id of PATTERN_TRANSITION_IDS) expect(transitionRegistry.has(id)).toBe(false)
  })

  it('the definitions and the entry-bundle id list cannot drift', () => {
    expect(patternTransitionDefinitions.map((definition) => definition.id)).toEqual([
      ...PATTERN_TRANSITION_IDS,
    ])
    for (const id of PATTERN_TRANSITION_IDS) expect(isPatternTransition(id)).toBe(true)
    expect(isPatternTransition('crossfade')).toBe(false)
    expect(isPatternTransition('box-open')).toBe(false)
  })

  it('collides with no core or Shaped wipes id', () => {
    const taken: readonly string[] = [...TRANSITION_TYPES, ...SHAPED_WIPE_TRANSITION_IDS]
    for (const id of PATTERN_TRANSITION_IDS) expect(taken).not.toContain(id)
  })

  it('a project holding a pattern transition depends on the plugin, one without does not', () => {
    const plugin = builtInPlugins.find((spec) => spec.id === 'pattern-transitions')
    const usedByProject = plugin?.usedByProject
    if (usedByProject === undefined) throw new Error('pattern-transitions declares no usedByProject')
    const timelineWith = (type: string) => ({
      entries: [
        { id: 'a', clipId: 'c1' },
        { id: 'b', clipId: 'c2' },
      ],
      transitions: [{ fromEntryId: 'a', toEntryId: 'b', type, duration: 0.5 }],
    })
    const library = { clips: [], failures: [] }
    // The predicate reads only transitions; the fixture carries what
    // `transitionsOf` needs and nothing else.
    const asTimeline = (value: unknown) => value as Parameters<typeof usedByProject>[1]
    expect(usedByProject(library, asTimeline(timelineWith('checkerboard')))).toBe(true)
    expect(usedByProject(library, asTimeline(timelineWith('crossfade')))).toBe(false)
  })
})

describe('Pattern transition layer rules (#857)', () => {
  it('every reveal has zero area at progress 0, on every frame aspect', () => {
    deactivate = activate()
    for (const id of PATTERN_TRANSITION_IDS) {
      for (const aspect of ASPECTS) {
        expect(area(id, 0, aspect), `${id} at 0, aspect ${aspect}`).toBe(0)
        expect(coverage(id, 0, aspect), `${id} at 0, aspect ${aspect}`).toBe(0)
      }
    }
  })

  it('every reveal covers the whole frame at progress 1, on every frame aspect', () => {
    deactivate = activate()
    for (const id of PATTERN_TRANSITION_IDS) {
      for (const aspect of ASPECTS) {
        expect(coverage(id, 1, aspect), `${id} at 1, aspect ${aspect}`).toBe(1)
      }
    }
  })

  it('the reveal grows as the transition runs: partial in between, never shrinking', () => {
    deactivate = activate()
    for (const id of PATTERN_TRANSITION_IDS) {
      let previous = 0
      for (const progress of [0.1, 0.25, 0.5, 0.75, 0.9]) {
        const covered = coverage(id, progress, 16 / 9)
        expect(covered, `${id} at ${progress}`).toBeGreaterThan(0)
        expect(covered, `${id} at ${progress}`).toBeLessThan(1)
        expect(covered, `${id} at ${progress}`).toBeGreaterThanOrEqual(previous)
        previous = covered
      }
    }
  })

  it('changes nothing else: alphas, offsets, scales, veil and the other reveals stay at the base', () => {
    deactivate = activate()
    for (const id of PATTERN_TRANSITION_IDS) {
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
      expect(spec.incomingClip, id).toBeNull()
      expect(spec.incomingEllipse, id).toBeNull()
    }
  })

  it('blinds open every slat at once, each from its own leading edge', () => {
    deactivate = activate()
    // Half-way, the top half of every horizontal slat is open and the bottom
    // half closed: the first slat spans y 0–0.1.
    expect(revealed('blinds-horizontal', 0.5, 16 / 9, { x: 0.5, y: 0.02 })).toBe(true)
    expect(revealed('blinds-horizontal', 0.5, 16 / 9, { x: 0.5, y: 0.08 })).toBe(false)
    expect(revealed('blinds-horizontal', 0.5, 16 / 9, { x: 0.1, y: 0.92 })).toBe(true)
    expect(revealed('blinds-horizontal', 0.5, 16 / 9, { x: 0.1, y: 0.98 })).toBe(false)
    // Vertical slats: the same along x.
    expect(revealed('blinds-vertical', 0.5, 16 / 9, { x: 0.52, y: 0.5 })).toBe(true)
    expect(revealed('blinds-vertical', 0.5, 16 / 9, { x: 0.58, y: 0.5 })).toBe(false)
  })

  it('checkerboard: alternate cells fill over the first half, the rest over the second', () => {
    deactivate = activate()
    const cellCentre = (column: number, row: number) => ({
      x: (column + 0.5) / CHECKER_COLUMNS,
      y: (row + 0.5) / CHECKER_ROWS,
    })
    // At the midpoint the frame is a checkerboard: every "dark" cell full,
    // every other one empty.
    for (let row = 0; row < CHECKER_ROWS; row += 1) {
      for (let column = 0; column < CHECKER_COLUMNS; column += 1) {
        const dark = (column + row) % 2 === 0
        expect(revealed('checkerboard', 0.5, 16 / 9, cellCentre(column, row))).toBe(dark)
      }
    }
    // A quarter in, dark cells are half full from their left edge.
    const cellWidth = 1 / CHECKER_COLUMNS
    expect(revealed('checkerboard', 0.25, 16 / 9, { x: 0.2 * cellWidth, y: 0.5 / CHECKER_ROWS })).toBe(
      true,
    )
    expect(revealed('checkerboard', 0.25, 16 / 9, { x: 0.8 * cellWidth, y: 0.5 / CHECKER_ROWS })).toBe(
      false,
    )
  })

  it('the irises keep their proportions on every frame aspect', () => {
    deactivate = activate()
    for (const [width, height] of [
      [1920, 1080],
      [1080, 1920],
      [1080, 1080],
    ]) {
      const aspect = width / height
      // The diamond's width and height in pixels are equal: a square on
      // its point, not a rhombus stretched by the frame.
      const [diamond] = transitionLayerSpec('diamond-iris', 0.25, transitionRegistry, aspect)
        .incomingPolygons!
      const xs = diamond.map((point) => point.x)
      const ys = diamond.map((point) => point.y)
      expect((Math.max(...xs) - Math.min(...xs)) * width).toBeCloseTo(
        (Math.max(...ys) - Math.min(...ys)) * height,
        6,
      )
      // Every outer point of the star is the same pixel distance from the
      // centre, and the top one points straight up.
      const [star] = transitionLayerSpec('star-iris', 0.3, transitionRegistry, aspect)
        .incomingPolygons!
      const outerDistances = star
        .filter((_, index) => index % 2 === 0)
        .map((point) => Math.hypot((point.x - 0.5) * width, (point.y - 0.5) * height))
      for (const distance of outerDistances) expect(distance).toBeCloseTo(outerDistances[0], 6)
      expect(star[0].x).toBeCloseTo(0.5, 9)
      expect(star[0].y).toBeLessThan(0.5)
    }
  })
})
