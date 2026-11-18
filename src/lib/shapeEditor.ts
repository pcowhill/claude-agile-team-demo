/**
 * The shape editor's geometry (#685, part 1 of the editor in the approved
 * design #681 §3): what a drag, a handle or a key does to a shape group's
 * rectangles, ellipses and arrows. Pure functions over frame fractions, so
 * the component only measures pointers and draws what these return, and
 * every rule can be pinned by a unit test without a browser.
 *
 * It reuses the visual editors' vocabulary (`frameEditor.ts`) rather than
 * inventing a second one:
 * - a box shape's move, corner and edge drags are `rectAfterGesture`'s;
 * - its keys are `rectAfterKeyStep`'s;
 * - its snapping is `rectSnapOffset`'s: the frame's edges, its thirds and
 *   its centre, with Alt bypassing it (#391).
 *
 * What is new is what those cannot express:
 * - drawing a shape from nothing, corner to corner or tail to tip;
 * - Shift's two constraints: a box square **in output pixels**, so a
 *   circle on a 16:9 frame is round, and an arrow snapped to 15° steps;
 * - an arrow's two ends, which are points rather than a box.
 *
 * **Stored to two decimals**, the precision the row's fields show
 * (`formatSeconds` in `Timeline.tsx`), for #422's reason: the editor and
 * the fields are two views of one value, so a drag must never store a
 * digit its own field cannot show. The cost is that Shift's square and 15°
 * are exact only to a hundredth of the frame. `squareError` says how far
 * off that can leave a square. A snapped arrow is kept within a degree of its
 * step for any arrow a tenth of the frame long or more (`onGridAtAngle`).
 * The tests hold both.
 */
import {
  RECT_SNAP_CENTRES,
  ZOOM_SNAP_TOLERANCE,
  rectAfterGesture,
  rectAfterKeyStep,
  rectSnapOffset,
} from './frameEditor'
import type { FrameRect, RectBounds, RectGesture, RectKeyStep } from './frameEditor'
import { MIN_SHAPE_SIZE } from './shapes'
import type { ArrowShape, BoxShape, Shape, ShapeKind } from './shapes'

/** What the tool strip offers: pick and edit, or draw one kind. */
export type ShapeTool = 'select' | ShapeKind

/** A point on the frame, as fractions of its width and height. */
export interface FramePoint {
  x: number
  y: number
}

/** Which end of an arrow a handle moves. */
export type ArrowEnd = 'tail' | 'tip'

/** The decimals every stored coordinate is rounded to (see the note above). */
export const SHAPE_EDITOR_DECIMALS = 2

/**
 * The range a box shape is held in. The floor is a hundredth of the frame,
 * not `MIN_SHAPE_SIZE` (0.005), because 0.005 stored to two decimals is
 * 0.01 anyway. Saying so here means the clamp and the rounding agree.
 */
export const SHAPE_BOUNDS: RectBounds = {
  minSize: Math.max(MIN_SHAPE_SIZE, 0.01),
  maxSize: 1,
  decimals: SHAPE_EDITOR_DECIMALS,
}

/**
 * How far a drawing drag must travel, as a fraction of the frame, before it
 * draws anything. A press with a drawing tool that barely moves is a
 * click, not a shape; drawing a 1 % sliver there would leave the user
 * hunting for something they never meant to make.
 */
export const MIN_DRAW_DRAG = 0.01

/** The angle an arrow drawn or pulled with Shift held is snapped to. */
export const ARROW_SNAP_DEGREES = 15

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)
const round = (value: number) => {
  const factor = 10 ** SHAPE_EDITOR_DECIMALS
  return Math.round(value * factor) / factor
}

/** A box shape's rectangle on the frame. */
export function boxRect(shape: Pick<BoxShape, 'x' | 'y' | 'width' | 'height'>): FrameRect {
  return { x: shape.x, y: shape.y, width: shape.width, height: shape.height }
}

/**
 * The rectangle an arrow spans, from its two ends. It may have zero width
 * or height. Snapping and the selection outline use it; it is never
 * stored.
 */
export function arrowBounds(shape: Pick<ArrowShape, 'tailX' | 'tailY' | 'tipX' | 'tipY'>): FrameRect {
  const x = Math.min(shape.tailX, shape.tipX)
  const y = Math.min(shape.tailY, shape.tipY)
  return { x, y, width: Math.abs(shape.tipX - shape.tailX), height: Math.abs(shape.tipY - shape.tailY) }
}

/** The rectangle a shape occupies, whatever its kind. */
export function shapeBounds(shape: Shape): FrameRect {
  return shape.kind === 'arrow' ? arrowBounds(shape) : boxRect(shape)
}

/**
 * A point pulled onto the nearest guide line within tolerance, on each axis
 * independently: the frame's two edges, its thirds and its centre. These are
 * the same places a moved rectangle's edges and centre snap to.
 */
export function snappedPoint(point: FramePoint): FramePoint {
  const axis = (value: number) => {
    let best = value
    let bestDistance = ZOOM_SNAP_TOLERANCE + 1e-9
    for (const target of [0, ...RECT_SNAP_CENTRES, 1]) {
      const distance = Math.abs(value - target)
      if (distance < bestDistance) {
        best = target
        bestDistance = distance
      }
    }
    return best
  }
  return { x: axis(point.x), y: axis(point.y) }
}

/** The guide a coordinate sits on, if it sits on one (to stored precision). */
function guideAt(value: number): number | null {
  const on = (target: number) => Math.abs(value - target) <= 0.005 + 1e-9
  for (const target of [0, 1, ...RECT_SNAP_CENTRES]) if (on(target)) return target
  return null
}

/** Guides lit by a point: what an arrow end or a drawn corner is on. */
export function pointGuides(point: FramePoint): { x: number | null; y: number | null } {
  return { x: guideAt(point.x), y: guideAt(point.y) }
}

/**
 * The rectangle a corner-to-corner drag from `start` to `end` draws.
 * - Both corners snap to the guides unless Alt is held; with Shift only the
 *   starting one does, since the square decides where the far one goes.
 * - Shift makes it **square in output pixels**: the side is the longer of
 *   the drag's two sides, measured in pixels, kept in the direction the drag
 *   went, and shrunk if the square would leave the frame.
 * - `aspect` is the output frame's width ÷ height.
 *
 * Null while the drag is shorter than `MIN_DRAW_DRAG` on both axes, which
 * means nothing is drawn yet.
 */
export function drawnBox(
  start: FramePoint,
  end: FramePoint,
  modifiers: { shiftKey?: boolean; altKey?: boolean },
  aspect: number,
): FrameRect | null {
  const pointer = {
    x: clamp(end.x, 0, 1),
    y: clamp(end.y, 0, 1),
  }
  const free = modifiers.altKey === true
  // The corner the drag began on snaps as the far one does, so a box can be
  // started flush to an edge or on a guide as easily as it is ended there.
  const from = free ? start : snappedPoint(start)
  const to = free || modifiers.shiftKey === true ? pointer : snappedPoint(pointer)
  let dx = to.x - from.x
  let dy = to.y - from.y
  if (Math.abs(dx) < MIN_DRAW_DRAG && Math.abs(dy) < MIN_DRAW_DRAG) return null
  if (modifiers.shiftKey === true) {
    // In units of the frame's height: x fractions scale by the aspect.
    const roomX = (dx < 0 ? from.x : 1 - from.x) * aspect
    const roomY = dy < 0 ? from.y : 1 - from.y
    const side = Math.min(Math.max(Math.abs(dx) * aspect, Math.abs(dy)), roomX, roomY)
    // Height first, on the stored grid, and the width that matches it in
    // pixels after: the error lands in one axis rather than both.
    const height = Math.max(round(side), SHAPE_BOUNDS.minSize)
    const width = Math.max(round(height / aspect), SHAPE_BOUNDS.minSize)
    dx = (dx < 0 ? -1 : 1) * width
    dy = (dy < 0 ? -1 : 1) * height
  }
  const x = round(Math.min(from.x, from.x + dx))
  const y = round(Math.min(from.y, from.y + dy))
  const width = Math.max(round(Math.abs(dx)), SHAPE_BOUNDS.minSize)
  const height = Math.max(round(Math.abs(dy)), SHAPE_BOUNDS.minSize)
  return {
    x: clamp(x, 0, round(1 - width)),
    y: clamp(y, 0, round(1 - height)),
    width,
    height,
  }
}

/**
 * The most a Shift-drawn square's two sides can differ, in output pixels.
 * Both sides are on the hundredth grid; the width is rounded to match the
 * height, so the error is at most half a hundredth of the frame's width.
 */
export function squareError(frameWidth: number): number {
  return (0.5 * 10 ** -SHAPE_EDITOR_DECIMALS) * frameWidth
}

/**
 * `to` with the line from `from` turned onto the nearest multiple of
 * `ARROW_SNAP_DEGREES`, keeping its length. The angle is measured in
 * **output pixels**, so a 45° arrow really is diagonal on a 16:9 frame. The
 * result is clamped into the frame: along a snapped direction the length
 * shrinks until the point fits, so the angle is kept.
 */
export function snappedAngle(from: FramePoint, to: FramePoint, aspect: number): FramePoint {
  const dx = (to.x - from.x) * aspect
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  if (length === 0) return to
  const step = (ARROW_SNAP_DEGREES * Math.PI) / 180
  const angle = Math.round(Math.atan2(dy, dx) / step) * step
  const ux = Math.cos(angle) / aspect
  const uy = Math.sin(angle)
  // The longest run along the snapped direction that stays on the frame.
  const fit = (origin: number, unit: number) =>
    unit > 1e-12 ? (1 - origin) / unit : unit < -1e-12 ? -origin / unit : Infinity
  const reach = Math.min(length, fit(from.x, ux), fit(from.y, uy))
  return { x: from.x + ux * reach, y: from.y + uy * reach }
}

/** The angle of the arrow from `from` to `to`, in degrees, in output pixels. */
export function arrowAngle(from: FramePoint, to: FramePoint, aspect: number): number {
  return (Math.atan2(to.y - from.y, (to.x - from.x) * aspect) * 180) / Math.PI
}

/**
 * Where a dragged arrow end lands.
 * - Shift snaps the line from the fixed end to 15° steps.
 * - Otherwise the point snaps to the guides unless Alt is held.
 * - It is clamped into the frame and rounded to the stored grid.
 */
function placedEnd(
  fixed: FramePoint,
  pointer: FramePoint,
  modifiers: { shiftKey?: boolean; altKey?: boolean },
  aspect: number,
): FramePoint {
  const inside = { x: clamp(pointer.x, 0, 1), y: clamp(pointer.y, 0, 1) }
  if (modifiers.shiftKey === true) return onGridAtAngle(fixed, snappedAngle(fixed, inside, aspect), aspect)
  const placed = modifiers.altKey === true ? inside : snappedPoint(inside)
  return { x: clamp(round(placed.x), 0, 1), y: clamp(round(placed.y), 0, 1) }
}

/**
 * The stored-grid point nearest `exact` that best keeps the angle from
 * `fixed` to `exact`. Rounding each coordinate on its own can turn a snapped
 * 15° into 15.7°. Searching the few grid points around it instead finds one
 * within a fraction of a degree, at the cost of a slightly different length,
 * which nobody aimed at. Horizontal and vertical stay exact either way.
 */
/** How many grid steps either side of the rounded point the search tries. */
const GRID_REACH = 4

function onGridAtAngle(fixed: FramePoint, exact: FramePoint, aspect: number): FramePoint {
  const target = arrowAngle(fixed, exact, aspect)
  const step = 10 ** -SHAPE_EDITOR_DECIMALS
  const baseX = round(exact.x)
  const baseY = round(exact.y)
  let best = { x: clamp(baseX, 0, 1), y: clamp(baseY, 0, 1) }
  let bestScore = Infinity
  for (let i = -GRID_REACH; i <= GRID_REACH; i += 1) {
    for (let j = -GRID_REACH; j <= GRID_REACH; j += 1) {
      const candidate = { x: round(baseX + i * step), y: round(baseY + j * step) }
      if (candidate.x < 0 || candidate.x > 1 || candidate.y < 0 || candidate.y > 1) continue
      if (!longEnough(fixed, candidate)) continue
      let off = Math.abs(arrowAngle(fixed, candidate, aspect) - target)
      if (off > 180) off = 360 - off
      // The angle first; among equals, the point nearest the pointer.
      const score = off * 1000 + Math.hypot(candidate.x - exact.x, candidate.y - exact.y)
      if (score < bestScore) {
        best = candidate
        bestScore = score
      }
    }
  }
  return best
}

/** Whether two ends are far enough apart to make an arrow the model accepts. */
function longEnough(a: FramePoint, b: FramePoint): boolean {
  return Math.hypot(b.x - a.x, b.y - a.y) >= MIN_SHAPE_SIZE
}

/**
 * The tail and tip a tail-to-tip drag draws, or null while the drag is
 * still too short to draw anything (`MIN_DRAW_DRAG`).
 */
export function drawnArrow(
  start: FramePoint,
  end: FramePoint,
  modifiers: { shiftKey?: boolean; altKey?: boolean },
  aspect: number,
): Pick<ArrowShape, 'tailX' | 'tailY' | 'tipX' | 'tipY'> | null {
  if (Math.hypot(end.x - start.x, end.y - start.y) < MIN_DRAW_DRAG) return null
  const begun = modifiers.altKey === true ? start : snappedPoint(start)
  const tail = { x: clamp(round(begun.x), 0, 1), y: clamp(round(begun.y), 0, 1) }
  const tip = placedEnd(tail, end, modifiers, aspect)
  if (!longEnough(tail, tip)) return null
  return { tailX: tail.x, tailY: tail.y, tipX: tip.x, tipY: tip.y }
}

/**
 * An arrow moved by an offset, kept wholly on the frame. Both ends shift
 * together, so its length and angle never change. Unless Alt is held, the
 * box the two ends span snaps the way a moved rectangle's does.
 */
export function movedArrow(
  start: ArrowShape,
  dx: number,
  dy: number,
  modifiers: { altKey?: boolean } = {},
): ArrowShape {
  const bounds = arrowBounds(start)
  let ox = clamp(dx, -bounds.x, 1 - bounds.x - bounds.width)
  let oy = clamp(dy, -bounds.y, 1 - bounds.y - bounds.height)
  if (modifiers.altKey !== true) {
    ox += rectSnapOffset(bounds.x + ox, bounds.width)
    oy += rectSnapOffset(bounds.y + oy, bounds.height)
    ox = clamp(ox, -bounds.x, 1 - bounds.x - bounds.width)
    oy = clamp(oy, -bounds.y, 1 - bounds.y - bounds.height)
  }
  // Rounded as a pair, so the two ends move by the same stored amount and
  // the arrow's length and angle are exactly what they were.
  const sx = round(ox)
  const sy = round(oy)
  const fit = (value: number) => clamp(round(value), 0, 1)
  return {
    ...start,
    tailX: fit(start.tailX + sx),
    tailY: fit(start.tailY + sy),
    tipX: fit(start.tipX + sx),
    tipY: fit(start.tipY + sy),
  }
}

/**
 * The arrow after one of its end handles was dragged to `pointer`. Only
 * that end moves. An end that would meet the other one keeps its previous
 * place, because a zero-length arrow is not a shape the model accepts.
 */
export function arrowAfterEndDrag(
  start: ArrowShape,
  end: ArrowEnd,
  pointer: FramePoint,
  modifiers: { shiftKey?: boolean; altKey?: boolean },
  aspect: number,
): ArrowShape {
  const fixed = end === 'tail' ? { x: start.tipX, y: start.tipY } : { x: start.tailX, y: start.tailY }
  const placed = placedEnd(fixed, pointer, modifiers, aspect)
  if (!longEnough(fixed, placed)) return start
  return end === 'tail'
    ? { ...start, tailX: placed.x, tailY: placed.y }
    : { ...start, tipX: placed.x, tipY: placed.y }
}

/**
 * What a gesture on a box shape's body or handles does: the free
 * rectangle's model, with Shift locking the shape's own proportions on a
 * corner, as the overlay editor's does.
 */
export function boxAfterGesture(start: BoxShape, gesture: RectGesture): BoxShape {
  const rect = boxRect(start)
  const next = rectAfterGesture(
    rect,
    gesture,
    SHAPE_BOUNDS,
    rect.height === 0 ? undefined : rect.width / rect.height,
  )
  return { ...start, ...next }
}

/**
 * One key press on the selected shape.
 * - An arrow key nudges it, Shift for five times as far.
 * - `+` / `−` resize a box about its centre (the overlay editor's step), and
 *   lengthen or shorten an arrow about its midpoint by the same step.
 *
 * Returns the shape unchanged when the step has nowhere to go.
 */
export function shapeAfterKeyStep(start: Shape, step: RectKeyStep, aspect: number): Shape {
  if (start.kind !== 'arrow') {
    return { ...start, ...rectAfterKeyStep(boxRect(start), step, SHAPE_BOUNDS) }
  }
  if (step.kind === 'move') return movedArrow(start, step.dx, step.dy, { altKey: true })
  // Along the arrow's own direction, in output pixels, so it keeps its angle.
  const dx = (start.tipX - start.tailX) * aspect
  const dy = start.tipY - start.tailY
  const length = Math.hypot(dx, dy)
  if (length === 0) return start
  // The overlay editor's step is a fraction of the frame's width; here it
  // is the same distance along the arrow, half at each end.
  const half = ((step.delta > 0 ? 1 : -1) * 0.02 * aspect) / 2
  const ux = dx / length / aspect
  const uy = dy / length
  const tail = { x: round(start.tailX - ux * half), y: round(start.tailY - uy * half) }
  const tip = { x: round(start.tipX + ux * half), y: round(start.tipY + uy * half) }
  const onFrame = (point: FramePoint) => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1
  if (!onFrame(tail) || !onFrame(tip) || !longEnough(tail, tip)) return start
  return { ...start, tailX: tail.x, tailY: tail.y, tipX: tip.x, tipY: tip.y }
}

/**
 * The shapes as they will be stored after an edit to one of them, or null
 * when nothing changed, so that a gesture landing where it started is not
 * an undo step.
 */
export function withShape(shapes: readonly Shape[], next: Shape): Shape[] | null {
  const index = shapes.findIndex((shape) => shape.id === next.id)
  if (index === -1) return null
  const current = shapes[index]
  const same = (Object.keys(next) as (keyof Shape)[]).every(
    (key) => (current as unknown as Record<string, unknown>)[key] === (next as unknown as Record<string, unknown>)[key],
  )
  if (same) return null
  return shapes.map((shape, at) => (at === index ? next : shape))
}
