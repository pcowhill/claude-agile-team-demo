import { BASE_TRANSITION_SPEC, transitionRegistry } from '../../lib/transitionRender'
import type { TransitionDefinition, TransitionPoint } from '../../lib/transitionRender'
import {
  BLIND_SLATS,
  CHECKER_COLUMNS,
  CHECKER_ROWS,
  PATTERN_TRANSITION_IDS,
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
}

const NAME: Record<PatternTransitionId, string> = {
  'blinds-horizontal': 'Blinds (horizontal)',
  'blinds-vertical': 'Blinds (vertical)',
  checkerboard: 'Checkerboard',
  'diamond-iris': 'Diamond iris',
  'star-iris': 'Star iris',
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
