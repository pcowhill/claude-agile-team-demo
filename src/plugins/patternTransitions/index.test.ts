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
  SPIRAL_COLUMNS,
  SPIRAL_ROWS,
  isPatternTransition,
} from '../patternTransitionsIds'
import { SHAPED_WIPE_TRANSITION_IDS } from '../shapedWipesIds'
import {
  HEART_VERTICES,
  activate,
  heartCoverScale,
  heartPoint,
  patternTransitionDefinitions,
  spiralOrder,
} from './index'

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

  it('counts each pattern transition in a project as one use, and nothing else (#953)', () => {
    const plugin = builtInPlugins.find((spec) => spec.id === 'pattern-transitions')
    const count = plugin?.projectUses?.count
    if (count === undefined) throw new Error('pattern-transitions declares no projectUses')
    const timelineWith = (...types: string[]) => ({
      entries: types.concat('last').map((_, index) => ({ id: `e${index}`, clipId: `c${index}` })),
      transitions: types.map((type, index) => ({
        fromEntryId: `e${index}`,
        toEntryId: `e${index + 1}`,
        type,
        duration: 0.5,
      })),
    })
    const library = { clips: [], failures: [] }
    // The count reads only transitions; the fixture carries what
    // `transitionsOf` needs and nothing else.
    const asTimeline = (value: unknown) => value as Parameters<typeof count>[1]
    expect(count(library, asTimeline(timelineWith()))).toEqual({ count: 0, what: '' })
    expect(count(library, asTimeline(timelineWith('crossfade')))).toEqual({ count: 0, what: '' })
    expect(count(library, asTimeline(timelineWith('checkerboard')))).toEqual({ count: 1, what: '1 transition' })
    expect(count(library, asTimeline(timelineWith('checkerboard', 'crossfade', 'spiral')))).toEqual({
      count: 2,
      what: '2 transitions',
    })
    // A Shaped wipes transition is that plugin's use, not this one's.
    expect(count(library, asTimeline(timelineWith('box-open')))).toEqual({ count: 0, what: '' })
  })
})

/**
 * The area of the reveal that falls inside the frame, exactly: each polygon
 * clipped to the unit square (Sutherland–Hodgman, which is exact for any
 * polygon against a convex window), then summed. The sweeps reach far past
 * the frame, so their raw area says nothing about what is seen. Sums are
 * the union only where polygons do not overlap, as for the one-fan sweeps.
 */
function frameArea(id: string, progress: number, aspect: number): number {
  const reveal = transitionLayerSpec(id, progress, transitionRegistry, aspect).incomingPolygons!
  const clipEdge = (
    polygon: TransitionPoint[],
    inside: (point: TransitionPoint) => boolean,
    cross: (a: TransitionPoint, b: TransitionPoint) => TransitionPoint,
  ) => {
    const out: TransitionPoint[] = []
    polygon.forEach((current, index) => {
      const previous = polygon[(index + polygon.length - 1) % polygon.length]
      if (inside(current)) {
        if (!inside(previous)) out.push(cross(previous, current))
        out.push(current)
      } else if (inside(previous)) out.push(cross(previous, current))
    })
    return out
  }
  const atX = (x: number) => (a: TransitionPoint, b: TransitionPoint) => ({
    x,
    y: a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x),
  })
  const atY = (y: number) => (a: TransitionPoint, b: TransitionPoint) => ({
    x: a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y),
    y,
  })
  return windRevealPolygons(reveal).reduce((sum, polygon) => {
    let clipped = clipEdge([...polygon], (point) => point.x >= 0, atX(0))
    clipped = clipEdge(clipped, (point) => point.x <= 1, atX(1))
    clipped = clipEdge(clipped, (point) => point.y >= 0, atY(0))
    clipped = clipEdge(clipped, (point) => point.y <= 1, atY(1))
    let doubled = 0
    clipped.forEach((a, index) => {
      const b = clipped[(index + 1) % clipped.length]
      doubled += a.x * b.y - b.x * a.y
    })
    return sum + Math.abs(doubled) / 2
  }, 0)
}

describe('Pattern transitions, part 2 (#863)', () => {
  it('clock wipe: the swept part of the frame grows steadily, a quarter at each quarter', () => {
    deactivate = activate()
    for (const aspect of ASPECTS) {
      // At a quarter the hand points at 3 o'clock and has swept the
      // top-right quarter exactly; at a half, the right half; and so on.
      for (const quarter of [0.25, 0.5, 0.75]) {
        expect(frameArea('clock-wipe', quarter, aspect), `${quarter}, aspect ${aspect}`).toBeCloseTo(
          quarter,
          9,
        )
      }
      // In between it never stalls or jumps: each twentieth of the
      // transition adds some of the frame, and no more than a tenth.
      let previous = 0
      for (let step = 1; step < 20; step += 1) {
        const swept = frameArea('clock-wipe', step / 20, aspect)
        expect(swept - previous, `step ${step}, aspect ${aspect}`).toBeGreaterThan(0.01)
        expect(swept - previous, `step ${step}, aspect ${aspect}`).toBeLessThan(0.1)
        previous = swept
      }
    }
  })

  it('clock wipe: the hand starts at 12 o’clock and turns clockwise, at the same angle on every aspect', () => {
    deactivate = activate()
    for (const [width, height] of [
      [1920, 1080],
      [1080, 1920],
      [1080, 1080],
    ]) {
      const aspect = width / height
      // A point 30° clockwise from 12, and its mirror 30° anticlockwise, both
      // 0.3 frame heights out: at a twelfth (30°) of the turn the first is
      // on the hand, so test either side of it.
      const at = (degrees: number) => ({
        x: 0.5 + (0.3 * Math.sin((degrees * Math.PI) / 180) * height) / width,
        y: 0.5 - 0.3 * Math.cos((degrees * Math.PI) / 180),
      })
      expect(revealed('clock-wipe', 1 / 12, aspect, at(25))).toBe(true)
      expect(revealed('clock-wipe', 1 / 12, aspect, at(35))).toBe(false)
      expect(revealed('clock-wipe', 1 / 12, aspect, at(-25))).toBe(false)
    }
  })

  it('clock and radial wipes: the arc never enters the frame, so the only edges seen are the hands', () => {
    deactivate = activate()
    for (const id of ['clock-wipe', 'radial-wipe']) {
      for (const aspect of ASPECTS) {
        const [fan] = transitionLayerSpec(id, 0.6, transitionRegistry, aspect).incomingPolygons!
        // In frame heights from the centre, the corners are this far out.
        const corner = Math.hypot(aspect, 1) / 2
        const arc = fan.slice(1).map((point) => ({ x: (point.x - 0.5) * aspect, y: point.y - 0.5 }))
        for (let index = 0; index + 1 < arc.length; index += 1) {
          const a = arc[index]
          const b = arc[index + 1]
          // The chord's nearest approach to the centre.
          const length = Math.hypot(b.x - a.x, b.y - a.y)
          const distance = Math.abs(a.x * b.y - b.x * a.y) / length
          expect(distance, `${id} chord ${index}, aspect ${aspect}`).toBeGreaterThan(corner)
        }
      }
    }
  })

  it('radial wipe: two hands from 12 o’clock, mirror images, meeting at 6', () => {
    deactivate = activate()
    for (const aspect of ASPECTS) {
      // Half-way, the hands point at 3 and 9: the top half is revealed.
      expect(frameArea('radial-wipe', 0.5, aspect)).toBeCloseTo(0.5, 9)
      expect(revealed('radial-wipe', 0.5, aspect, { x: 0.1, y: 0.4 })).toBe(true)
      expect(revealed('radial-wipe', 0.5, aspect, { x: 0.9, y: 0.6 })).toBe(false)
      for (const point of frameGrid(10)) {
        const mirror = { x: 1 - point.x, y: point.y }
        expect(revealed('radial-wipe', 0.3, aspect, point)).toBe(revealed('radial-wipe', 0.3, aspect, mirror))
      }
      // Just before the end, only a sliver either side of 6 o'clock is left.
      expect(revealed('radial-wipe', 0.97, aspect, { x: 0.5, y: 0.95 })).toBe(false)
      expect(revealed('radial-wipe', 0.97, aspect, { x: 0.5, y: 0.05 })).toBe(true)
    }
  })

  it('spiral: visits every cell once, clockwise from the top-left corner inward, each a neighbour of the last', () => {
    const cells = spiralOrder(SPIRAL_COLUMNS, SPIRAL_ROWS)
    expect(cells).toHaveLength(SPIRAL_COLUMNS * SPIRAL_ROWS)
    expect(new Set(cells.map(({ column, row }) => `${column},${row}`)).size).toBe(cells.length)
    expect(cells[0]).toEqual({ column: 0, row: 0, travel: 'right' })
    // The top row first, then down the right column.
    expect(cells[SPIRAL_COLUMNS - 1]).toEqual({ column: SPIRAL_COLUMNS - 1, row: 0, travel: 'right' })
    expect(cells[SPIRAL_COLUMNS]).toEqual({ column: SPIRAL_COLUMNS - 1, row: 1, travel: 'down' })
    const step = { right: [1, 0], down: [0, 1], left: [-1, 0], up: [0, -1] } as const
    for (let index = 1; index < cells.length; index += 1) {
      const [dx, dy] = step[cells[index].travel]
      expect(cells[index].column - cells[index - 1].column, `cell ${index}`).toBe(dx)
      expect(cells[index].row - cells[index - 1].row, `cell ${index}`).toBe(dy)
    }
    // Other grids keep the same properties, a single row or column included.
    for (const [columns, rows] of [
      [1, 1],
      [5, 1],
      [1, 4],
      [5, 5],
      [8, 6],
    ]) {
      const order = spiralOrder(columns, rows)
      expect(new Set(order.map(({ column, row }) => `${column},${row}`)).size).toBe(columns * rows)
    }
  })

  it('spiral: the cells fill one after another, each from the side the path enters it', () => {
    deactivate = activate()
    const cells = spiralOrder(SPIRAL_COLUMNS, SPIRAL_ROWS)
    const centre = ({ column, row }: { column: number; row: number }) => ({
      x: (column + 0.5) / SPIRAL_COLUMNS,
      y: (row + 0.5) / SPIRAL_ROWS,
    })
    // At k / N, exactly the first k cells are revealed.
    for (const k of [1, 5, 9, 16, 23]) {
      cells.forEach((cell, index) => {
        expect(revealed('spiral', k / cells.length, 16 / 9, centre(cell)), `cell ${index} at ${k}`).toBe(
          index < k,
        )
      })
    }
    // Half-way through its share, a cell is half full from its entry side:
    // a point a quarter in from that side shows, a quarter from the far
    // side does not.
    const width = 1 / SPIRAL_COLUMNS
    const height = 1 / SPIRAL_ROWS
    for (const travel of ['right', 'down', 'left', 'up'] as const) {
      const index = cells.findIndex((cell) => cell.travel === travel && cell.row > 0 && cell.row < 3)
      const target = index === -1 ? cells.findIndex((cell) => cell.travel === travel) : index
      const { column, row } = cells[target]
      const progress = (target + 0.5) / cells.length
      const x0 = column * width
      const y0 = row * height
      const near = {
        right: { x: x0 + 0.25 * width, y: y0 + 0.5 * height },
        left: { x: x0 + 0.75 * width, y: y0 + 0.5 * height },
        down: { x: x0 + 0.5 * width, y: y0 + 0.25 * height },
        up: { x: x0 + 0.5 * width, y: y0 + 0.75 * height },
      }[travel]
      const far = { x: 2 * (x0 + 0.5 * width) - near.x, y: 2 * (y0 + 0.5 * height) - near.y }
      expect(revealed('spiral', progress, 16 / 9, near), `${travel}: near side`).toBe(true)
      expect(revealed('spiral', progress, 16 / 9, far), `${travel}: far side`).toBe(false)
    }
  })

  it('heart iris: the outline is star-shaped about its centre, so it only ever grows', () => {
    // The angle around the origin turns the same way at every vertex and
    // goes round exactly once: each ray from the centre crosses the outline
    // once, so a larger heart contains every smaller one.
    let total = 0
    let previous = Math.atan2(heartPoint(0).y, heartPoint(0).x)
    for (let index = 1; index <= HEART_VERTICES; index += 1) {
      const point = heartPoint((2 * Math.PI * index) / HEART_VERTICES)
      const angle = Math.atan2(point.y, point.x)
      let turn = angle - previous
      if (turn > Math.PI) turn -= 2 * Math.PI
      if (turn < -Math.PI) turn += 2 * Math.PI
      expect(turn, `vertex ${index}`).toBeGreaterThan(0)
      total += turn
      previous = angle
    }
    expect(Math.abs(total)).toBeCloseTo(2 * Math.PI, 9)
  })

  it('heart iris: point down, the same shape on every aspect, and smooth at 1080p at its largest', () => {
    deactivate = activate()
    for (const [width, height] of [
      [1920, 1080],
      [1080, 1920],
      [1080, 1080],
    ]) {
      const aspect = width / height
      const [heart] = transitionLayerSpec('heart-iris', 0.3, transitionRegistry, aspect).incomingPolygons!
      const xs = heart.map((point) => point.x * width)
      const ys = heart.map((point) => point.y * height)
      const pixelWidth = Math.max(...xs) - Math.min(...xs)
      const pixelHeight = Math.max(...ys) - Math.min(...ys)
      // 32 wide by 28.92 tall, in the curve's own units.
      expect(pixelWidth / pixelHeight).toBeCloseTo(32 / (17 + 11.923251973), 3)
      // The point (t = π, vertex 128) is the lowest vertex, below the centre.
      const point = heart[HEART_VERTICES / 2]
      expect(point.y * height).toBeCloseTo(Math.max(...ys), 9)
      expect(point.x).toBeCloseTo(0.5, 9)

      // At the cover scale, the largest the heart gets, no chord strays half
      // a pixel from the true curve: its mid-parameter point is within
      // 0.5 px of the chord.
      const scale = heartCoverScale(aspect) * height
      let worst = 0
      for (let index = 0; index < HEART_VERTICES; index += 1) {
        const t0 = (2 * Math.PI * index) / HEART_VERTICES
        const t1 = (2 * Math.PI * (index + 1)) / HEART_VERTICES
        const a = heartPoint(t0)
        const b = heartPoint(t1)
        const middle = heartPoint((t0 + t1) / 2)
        const length = Math.hypot(b.x - a.x, b.y - a.y)
        const away = Math.abs((middle.x - a.x) * (b.y - a.y) - (middle.y - a.y) * (b.x - a.x)) / length
        worst = Math.max(worst, away * scale)
      }
      expect(worst, `${width}×${height}`).toBeLessThan(0.5)
    }
  })

  it('heart iris: finishes covering the frame exactly at the end, not sooner', () => {
    deactivate = activate()
    for (const aspect of ASPECTS) {
      // The frame's outline, finely sampled, a hair inside the frame.
      const edge: TransitionPoint[] = []
      for (let index = 0; index <= 400; index += 1) {
        const f = Math.min(1 - 1e-6, Math.max(1e-6, index / 400))
        edge.push({ x: f, y: 1e-6 }, { x: f, y: 1 - 1e-6 }, { x: 1e-6, y: f }, { x: 1 - 1e-6, y: f })
      }
      expect(edge.every((point) => revealed('heart-iris', 1, aspect, point)), `aspect ${aspect}`).toBe(true)
      expect(edge.every((point) => revealed('heart-iris', 0.98, aspect, point)), `aspect ${aspect}`).toBe(false)
    }
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
