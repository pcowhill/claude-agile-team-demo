import { BASE_TRANSITION_SPEC, transitionRegistry } from '../../lib/transitionRender'
import type { TransitionDefinition, TransitionPoint } from '../../lib/transitionRender'
import {
  BLIND_SLATS,
  CHECKER_COLUMNS,
  CHECKER_ROWS,
  PATTERN_TRANSITION_IDS,
  SPIRAL_COLUMNS,
  SPIRAL_ROWS,
} from '../patternTransitionsIds'
import type { PatternTransitionId } from '../patternTransitionsIds'

/**
 * The Pattern transitions plugin (#857, from the customer's pick of idea 7
 * on #856): transitions whose reveal is a pattern — slats, a grid of cells,
 * a pointed outline — rather than the single rectangle or ellipse the core
 * set and the Shaped wipes pack (#199) are made of.
 *
 * Every definition is `BASE_TRANSITION_SPEC` plus one `incomingPolygons`
 * reveal, the polygon vocabulary #857 added to the transition layer rule.
 * Both renderers draw that reveal from the same wound polygons
 * (`windRevealPolygons`) — the export as a canvas clip, the preview as an
 * SVG mask — so preview and export match by construction (#66), and this
 * pack itself ships no rendering code.
 *
 * The slats and cells tile the frame, so they are plain frame fractions and
 * stretch with it. The irises are shapes, so they are drawn from the frame
 * aspect the rule receives: a diamond keeps its 45° sides and a star its
 * proportions on 16:9, 9:16 and square frames alike, and each grows to
 * cover exactly that frame at progress 1 — not sooner, which would leave
 * the end of the transition showing nothing move. The card backing keeps revealed
 * letterbox margins black (#74's rule). Every reveal has zero area at
 * progress 0 and covers the whole frame at progress 1, so nothing pops at
 * either handover.
 */

/**
 * The star's inner vertices sit at this fraction of its outer radius. At ½
 * the star's nearest boundary point to its centre is an inner vertex — the
 * edge from an outer vertex runs on past the inner one before it would come
 * closer — so the star contains the disc of its inner radius, and it covers
 * the frame once that disc reaches the frame's corners.
 */
export const STAR_INNER_RATIO = 0.5

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/** An axis-aligned rectangle as a polygon, in the frame space it is given in. */
function rect(x: number, y: number, width: number, height: number): TransitionPoint[] {
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ]
}

/**
 * A point given in frame **heights** from the frame's centre, as a frame
 * fraction: on a frame `aspect` heights wide, one height across is 1/aspect
 * of the width. Shapes drawn in these units keep their proportions.
 */
function fromCentre(aspect: number, dx: number, dy: number): TransitionPoint {
  return { x: 0.5 + dx / aspect, y: 0.5 + dy }
}

/** The whole frame, which a sweep becomes once it has gone all the way round. */
const FULL_FRAME: readonly (readonly TransitionPoint[])[] = [rect(0, 0, 1, 1)]

/**
 * A sweep's arc is drawn in steps of at most this angle (#863). The arc is
 * never seen: it runs at twice the corner distance, so every chord between
 * two of its vertices stays at least 2·cos(2.5°) ≈ 1.998 corner distances
 * from the centre, far outside the frame. What shows is the hands, which
 * are exact straight lines. A full turn is 72 steps.
 */
export const SWEEP_STEP_RADIANS = (5 * Math.PI) / 180

/**
 * A fan from the frame's centre between two angles, in radians clockwise
 * from 12 o'clock, measured on the frame as the viewer sees it (in frame
 * heights, so 3 o'clock is straight right on any aspect).
 */
function fan(aspect: number, from: number, to: number): TransitionPoint[] {
  const radius = Math.hypot(aspect, 1) // twice the corner distance, in heights
  const steps = Math.max(1, Math.ceil((to - from) / SWEEP_STEP_RADIANS))
  const points = [fromCentre(aspect, 0, 0)]
  for (let index = 0; index <= steps; index += 1) {
    const angle = from + ((to - from) * index) / steps
    points.push(fromCentre(aspect, radius * Math.sin(angle), -radius * Math.cos(angle)))
  }
  return points
}

/**
 * The Spiral's cells in reveal order (#863): clockwise from the top-left
 * corner, along the top row, down the right column, back along the bottom
 * and up the left, then the same one ring in, to the middle. Each cell
 * carries the way the path travels into it, which is the way it fills.
 */
type Travel = 'right' | 'down' | 'left' | 'up'
export function spiralOrder(
  columns: number,
  rows: number,
): readonly { column: number; row: number; travel: Travel }[] {
  const cells: { column: number; row: number; travel: Travel }[] = []
  let top = 0
  let bottom = rows - 1
  let left = 0
  let right = columns - 1
  while (top <= bottom && left <= right) {
    for (let column = left; column <= right; column += 1) cells.push({ column, row: top, travel: 'right' })
    for (let row = top + 1; row <= bottom; row += 1) cells.push({ column: right, row, travel: 'down' })
    if (top < bottom) {
      for (let column = right - 1; column >= left; column -= 1) {
        cells.push({ column, row: bottom, travel: 'left' })
      }
    }
    if (left < right) {
      for (let row = bottom - 1; row > top; row -= 1) cells.push({ column: left, row, travel: 'up' })
    }
    top += 1
    bottom -= 1
    left += 1
    right -= 1
  }
  return cells
}

const SPIRAL_CELLS = spiralOrder(SPIRAL_COLUMNS, SPIRAL_ROWS)

/**
 * The heart's outline (#863): the classic parametric heart, x = 16 sin³ t,
 * y = 13 cos t − 5 cos 2t − 2 cos 3t − cos 4t, turned so its point is down,
 * moved so the middle of its height (y = −2.5) is the origin, and divided
 * by 29 so it stands about one frame height tall. Units are frame heights,
 * so it keeps its shape on any aspect.
 *
 * 256 vertices, t evenly spaced, with t = 0 (the dip between the lobes) and
 * t = π (the point) among them, so both cusps are exact. At the largest the
 * heart ever gets, the cover size below, no chord strays half a pixel
 * from the true curve on a 1920 × 1080 or 1080 × 1920 frame: 0.46 px at
 * worst, on the portrait frame (unit-tested).
 * The heart is star-shaped about its origin (every ray from it crosses the
 * outline once, also tested), so scaling it about the frame's centre grows
 * it without ever uncovering a point.
 */
export const HEART_VERTICES = 256
export const heartPoint = (t: number): TransitionPoint => ({
  x: (16 * Math.sin(t) ** 3) / 29,
  y: -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t) + 2.5) / 29,
})
const HEART: readonly TransitionPoint[] = Array.from({ length: HEART_VERTICES }, (_, index) =>
  heartPoint((2 * Math.PI * index) / HEART_VERTICES),
)

/** How far a ray from the origin along (dx, dy) runs before it leaves the heart polygon. */
function heartReach(dx: number, dy: number): number {
  let reach = 0
  for (let index = 0; index < HEART.length; index += 1) {
    const a = HEART[index]
    const b = HEART[(index + 1) % HEART.length]
    // Solve origin + s·(dx, dy) = a + u·(b − a) for s ≥ 0, u in [0, 1].
    const ex = b.x - a.x
    const ey = b.y - a.y
    const denominator = dx * ey - dy * ex
    if (denominator === 0) continue
    const s = (a.x * ey - a.y * ex) / denominator
    const u = (a.x * dy - a.y * dx) / denominator
    if (s > 0 && u >= 0 && u <= 1) reach = Math.max(reach, s)
  }
  return reach
}

/**
 * The scale at which the heart just covers a frame `aspect` heights wide
 * (#863), so it finishes covering exactly at progress 1. Both outlines are
 * straight segments around the origin, and along one segment of each the
 * ratio of the frame's reach to the heart's is monotonic in the angle, so
 * the largest ratio is at a vertex of one or the other: the heart's 256 and
 * the frame's four corners. That largest ratio is the scale.
 */
export function heartCoverScale(aspect: number): number {
  const halfWidth = aspect / 2
  /** How far a ray from the centre along (dx, dy) runs before it leaves the frame. */
  const frameReach = (dx: number, dy: number) =>
    Math.min(dx === 0 ? Infinity : halfWidth / Math.abs(dx), dy === 0 ? Infinity : 0.5 / Math.abs(dy))
  let scale = 0
  // Along a heart vertex, the frame's reach measured in multiples of that
  // vertex is the ratio itself. Along a corner, the heart's reach in
  // multiples of the corner is its inverse.
  for (const vertex of HEART) scale = Math.max(scale, frameReach(vertex.x, vertex.y))
  for (const [dx, dy] of [
    [halfWidth, 0.5],
    [halfWidth, -0.5],
    [-halfWidth, 0.5],
    [-halfWidth, -0.5],
  ]) {
    scale = Math.max(scale, 1 / heartReach(dx, dy))
  }
  return scale
}

/** The reveal per pack transition at a progress in [0, 1] and a frame aspect. */
const REVEAL: Record<
  PatternTransitionId,
  (progress: number, aspect: number) => readonly (readonly TransitionPoint[])[]
> = {
  // Horizontal slats, each opening downward from its own top edge at the
  // same time — the frame is fully open when every slat is.
  'blinds-horizontal': (p) =>
    Array.from({ length: BLIND_SLATS }, (_, index) =>
      rect(0, index / BLIND_SLATS, 1, p / BLIND_SLATS),
    ),
  // Vertical slats, each opening rightward from its own left edge.
  'blinds-vertical': (p) =>
    Array.from({ length: BLIND_SLATS }, (_, index) =>
      rect(index / BLIND_SLATS, 0, p / BLIND_SLATS, 1),
    ),
  // A grid of cells. The "dark squares" (column + row even) fill over the
  // first half of the transition and the rest over the second, each cell
  // filling from its own left edge — so the frame reads as a checkerboard
  // at the midpoint and is fully revealed at the end. Cells with nothing
  // revealed yet are left out of the path rather than drawn at zero width.
  checkerboard: (p) => {
    const first = clamp01(2 * p)
    const second = clamp01(2 * p - 1)
    const polygons: TransitionPoint[][] = []
    for (let row = 0; row < CHECKER_ROWS; row += 1) {
      for (let column = 0; column < CHECKER_COLUMNS; column += 1) {
        const filled = (column + row) % 2 === 0 ? first : second
        if (filled > 0) {
          polygons.push(
            rect(
              column / CHECKER_COLUMNS,
              row / CHECKER_ROWS,
              filled / CHECKER_COLUMNS,
              1 / CHECKER_ROWS,
            ),
          )
        }
      }
    }
    return polygons
  },
  // A diamond (a square standing on its point) growing from the centre. In
  // frame heights the frame's corners sit at (±aspect/2, ±½), so the
  // diamond |dx| + |dy| ≤ r covers the frame exactly when r reaches
  // (aspect + 1) / 2 — its size at progress 1.
  'diamond-iris': (p, aspect) => {
    const r = (p * (aspect + 1)) / 2
    return [
      [
        fromCentre(aspect, 0, -r),
        fromCentre(aspect, r, 0),
        fromCentre(aspect, 0, r),
        fromCentre(aspect, -r, 0),
      ],
    ]
  },
  // A five-pointed star, one point up, growing from the centre until its
  // inner disc (see STAR_INNER_RATIO) reaches the frame's corners — at
  // progress 1 the inner radius is the corner distance, √(aspect² + 1) / 2
  // frame heights.
  'star-iris': (p, aspect) => {
    const inner = (p * Math.hypot(aspect, 1)) / 2
    const outer = inner / STAR_INNER_RATIO
    const points: TransitionPoint[] = []
    for (let index = 0; index < 10; index += 1) {
      const angle = -Math.PI / 2 + (index * Math.PI) / 5
      const radius = index % 2 === 0 ? outer : inner
      points.push(fromCentre(aspect, radius * Math.cos(angle), radius * Math.sin(angle)))
    }
    return [points]
  },
  // A hand sweeping clockwise from 12 o'clock, at a steady angular speed.
  // A quarter of the way through it points at 3 o'clock and has swept
  // exactly the top-right quarter of the frame, on any aspect.
  'clock-wipe': (p, aspect) => {
    if (p <= 0) return []
    if (p >= 1) return FULL_FRAME
    return [fan(aspect, 0, 2 * Math.PI * p)]
  },
  // Two hands from 12 o'clock, one each way, meeting at 6.
  'radial-wipe': (p, aspect) => {
    if (p <= 0) return []
    if (p >= 1) return FULL_FRAME
    return [fan(aspect, -Math.PI * p, Math.PI * p)]
  },
  // Cells revealed one after another along the spiral path, each filling
  // in the direction the path travels into it, over its own equal share of
  // the transition, so the reveal runs on without a jump.
  spiral: (p) => {
    const polygons: TransitionPoint[][] = []
    const width = 1 / SPIRAL_COLUMNS
    const height = 1 / SPIRAL_ROWS
    SPIRAL_CELLS.forEach(({ column, row, travel }, index) => {
      const filled = clamp01(p * SPIRAL_CELLS.length - index)
      if (filled <= 0) return
      const x = column * width
      const y = row * height
      if (travel === 'right') polygons.push(rect(x, y, filled * width, height))
      else if (travel === 'left') polygons.push(rect(x + (1 - filled) * width, y, filled * width, height))
      else if (travel === 'down') polygons.push(rect(x, y, width, filled * height))
      else polygons.push(rect(x, y + (1 - filled) * height, width, filled * height))
    })
    return polygons
  },
  // A heart, point down, growing from the centre until it just covers the
  // frame at progress 1 (heartCoverScale).
  'heart-iris': (p, aspect) => {
    if (p <= 0) return []
    const scale = p * heartCoverScale(aspect)
    return [HEART.map((point) => fromCentre(aspect, point.x * scale, point.y * scale))]
  },
}

const NAME: Record<PatternTransitionId, string> = {
  'blinds-horizontal': 'Blinds (horizontal)',
  'blinds-vertical': 'Blinds (vertical)',
  checkerboard: 'Checkerboard',
  'diamond-iris': 'Diamond iris',
  'star-iris': 'Star iris',
  'clock-wipe': 'Clock wipe',
  'radial-wipe': 'Radial wipe',
  spiral: 'Spiral',
  'heart-iris': 'Heart iris',
}

/** The pack's definitions, in the ids module's (= picker) order. */
export const patternTransitionDefinitions: readonly TransitionDefinition[] =
  PATTERN_TRANSITION_IDS.map((id) => ({
    id,
    name: NAME[id],
    layerSpec: (progress, aspect) => ({
      ...BASE_TRANSITION_SPEC,
      incomingPolygons: REVEAL[id](progress, aspect),
    }),
  }))

/** Registers the pack's transitions; returns the undo (#197's contract). */
export function activate(): () => void {
  for (const definition of patternTransitionDefinitions) transitionRegistry.register(definition)
  return () => {
    for (const definition of patternTransitionDefinitions) {
      transitionRegistry.unregister(definition.id)
    }
  }
}
