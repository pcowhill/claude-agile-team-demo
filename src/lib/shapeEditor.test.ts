import { describe, expect, it } from 'vitest'
import {
  ARROW_SNAP_DEGREES,
  arrowAfterEndDrag,
  arrowAngle,
  arrowBounds,
  boxAfterGesture,
  drawnArrow,
  drawnBox,
  movedArrow,
  pointGuides,
  shapeAfterKeyStep,
  snappedAngle,
  snappedPoint,
  squareError,
  withShape,
  DUPLICATE_OFFSET,
  HIGHLIGHTER_STYLE,
  duplicatedShapes,
  movedShapes,
  reorderedShapes,
  restyledShape,
  selectionStyle,
  shapesAfterKeyStep,
  withShapes,
  withoutShapes,
  BADGE_SIZE_STEP,
  movedBadge,
  placedBadgeCenter,
  shapeBounds,
} from './shapeEditor'
import { MAX_BADGE_SIZE, MIN_BADGE_SIZE, defaultShape, isValidShape, newBadge } from './shapes'
import type { ArrowShape, BadgeShape, BoxShape } from './shapes'

const WIDE = 16 / 9

const rect = (overrides: Partial<BoxShape> = {}): BoxShape => ({
  ...defaultShape('r', 'rectangle'),
  x: 0.2,
  y: 0.2,
  width: 0.3,
  height: 0.2,
  ...overrides,
})

const arrow = (overrides: Partial<ArrowShape> = {}): ArrowShape => ({
  ...defaultShape('a', 'arrow'),
  tailX: 0.2,
  tailY: 0.4,
  tipX: 0.6,
  tipY: 0.4,
  ...overrides,
})

describe('drawing a box (#685)', () => {
  it('draws corner to corner in either direction, rounded to hundredths', () => {
    expect(drawnBox({ x: 0.21, y: 0.11 }, { x: 0.452, y: 0.268 }, { altKey: true }, WIDE)).toEqual({
      x: 0.21,
      y: 0.11,
      width: 0.24,
      height: 0.16,
    })
    // Dragged up and to the left: the same box.
    expect(drawnBox({ x: 0.452, y: 0.268 }, { x: 0.21, y: 0.11 }, { altKey: true }, WIDE)).toEqual({
      x: 0.21,
      y: 0.11,
      width: 0.24,
      height: 0.16,
    })
  })

  it('draws nothing for a press that barely moves', () => {
    expect(drawnBox({ x: 0.4, y: 0.4 }, { x: 0.405, y: 0.403 }, {}, WIDE)).toBeNull()
  })

  it('snaps both corners to the guides, unless Alt is held', () => {
    // 0.49 → the centre line, 0.68 → the right third, 0.01 → the top edge.
    expect(drawnBox({ x: 0.49, y: 0.01 }, { x: 0.68, y: 0.3 }, {}, WIDE)).toEqual({
      x: 0.5,
      y: 0,
      width: 0.17,
      height: 0.3,
    })
    expect(drawnBox({ x: 0.49, y: 0.01 }, { x: 0.68, y: 0.3 }, { altKey: true }, WIDE)).toEqual({
      x: 0.49,
      y: 0.01,
      width: 0.19,
      height: 0.29,
    })
  })

  it('with Shift, is square in output pixels on a 16:9 frame, to within the stored precision', () => {
    for (const [end, frame] of [
      [{ x: 0.5, y: 0.3 }, { width: 1920, height: 1080 }],
      [{ x: 0.33, y: 0.71 }, { width: 640, height: 360 }],
      [{ x: 0.12, y: 0.15 }, { width: 1280, height: 720 }],
    ] as const) {
      const box = drawnBox({ x: 0.25, y: 0.25 }, end, { shiftKey: true, altKey: true }, frame.width / frame.height)
      expect(box).not.toBeNull()
      const widthPx = box!.width * frame.width
      const heightPx = box!.height * frame.height
      expect(Math.abs(widthPx - heightPx)).toBeLessThanOrEqual(squareError(frame.width) + 1e-9)
    }
  })

  it('with Shift, a square that would leave the frame shrinks to fit rather than distorting', () => {
    const box = drawnBox({ x: 0.9, y: 0.5 }, { x: 1, y: 0.95 }, { shiftKey: true }, WIDE)!
    expect(box.x + box.width).toBeLessThanOrEqual(1)
    expect(box.y + box.height).toBeLessThanOrEqual(1)
    // Room to the right is 0.1 of the width = 0.1778 of the height.
    expect(box.height).toBeCloseTo(0.18, 2)
    expect(Math.abs(box.width * 1920 - box.height * 1080)).toBeLessThanOrEqual(squareError(1920))
  })

  it('pins the square tolerance: half a hundredth of the frame width', () => {
    expect(squareError(1920)).toBeCloseTo(9.6, 6)
    expect(squareError(640)).toBeCloseTo(3.2, 6)
  })
})

describe('drawing an arrow (#685)', () => {
  it('draws tail to tip, and nothing for a press that barely moves', () => {
    expect(drawnArrow({ x: 0.2, y: 0.2 }, { x: 0.7, y: 0.55 }, { altKey: true }, WIDE)).toEqual({
      tailX: 0.2,
      tailY: 0.2,
      tipX: 0.7,
      tipY: 0.55,
    })
    expect(drawnArrow({ x: 0.2, y: 0.2 }, { x: 0.205, y: 0.2 }, {}, WIDE)).toBeNull()
  })

  it('with Shift, snaps to 15° steps measured in output pixels', () => {
    // A drag 20° off horizontal on screen snaps to 15°.
    const tail = { x: 0.1, y: 0.5 }
    const angle = (20 * Math.PI) / 180
    const end = { x: tail.x + (Math.cos(angle) * 0.4) / WIDE, y: tail.y + Math.sin(angle) * 0.4 }
    const drawn = drawnArrow(tail, end, { shiftKey: true }, WIDE)!
    const got = arrowAngle({ x: drawn.tailX, y: drawn.tailY }, { x: drawn.tipX, y: drawn.tipY }, WIDE)
    // Exact before rounding; the stored hundredths leave it within a degree.
    expect(Math.abs(got - ARROW_SNAP_DEGREES)).toBeLessThan(1)
    const exact = snappedAngle(tail, end, WIDE)
    expect(arrowAngle(tail, exact, WIDE)).toBeCloseTo(15, 9)
  })

  it('every 15° step lands within a degree once stored, for an arrow a tenth of the frame long or more', () => {
    const tail = { x: 0.5, y: 0.5 }
    for (let degrees = -180; degrees < 180; degrees += 15) {
      for (const length of [0.1, 0.12, 0.3, 0.45]) {
        const rad = ((degrees + 4) * Math.PI) / 180
        const end = { x: tail.x + (Math.cos(rad) * length) / WIDE, y: tail.y + Math.sin(rad) * length }
        const drawn = drawnArrow(tail, end, { shiftKey: true }, WIDE)!
        let off = Math.abs(arrowAngle(tail, { x: drawn.tipX, y: drawn.tipY }, WIDE) - degrees)
        if (off > 180) off = 360 - off
        // The hundredths grid itself is the limit: at 0.12 of the height
        // the nearest grid point to 15° is 15.66°. Horizontal and vertical
        // are exact.
        expect(off, `${degrees}° at length ${length}`).toBeLessThan(degrees % 90 === 0 ? 1e-9 : 1)
      }
    }
  })

  it('a 45° snap is diagonal in pixels, not in fractions', () => {
    const tip = snappedAngle({ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.52 }, WIDE)
    expect((tip.x - 0.2) * 1920).toBeCloseTo((tip.y - 0.2) * 1080, 6)
  })

  it('a snapped direction that runs off the frame keeps its angle and shortens', () => {
    const tip = snappedAngle({ x: 0.9, y: 0.5 }, { x: 1.4, y: 0.52 }, WIDE)
    expect(tip.x).toBeCloseTo(1, 9)
    expect(tip.y).toBeCloseTo(0.5, 9)
  })
})

describe('a selection of several shapes (#686)', () => {
  const ids = (...list: string[]) => new Set(list)
  const three = () => [
    rect({ id: 'r1', x: 0.1, y: 0.1, width: 0.2, height: 0.2 }),
    { ...defaultShape('e1', 'ellipse'), x: 0.5, y: 0.1, width: 0.2, height: 0.2 },
    arrow({ id: 'a1', tailX: 0.2, tailY: 0.7, tipX: 0.6, tipY: 0.8 }),
  ]

  it('withShapes commits several edits as one list, and null when none changed', () => {
    const shapes = three()
    expect(withShapes(shapes, [shapes[0], shapes[2]])).toBeNull()
    const next = withShapes(shapes, [
      { ...shapes[0], stroke: '#00ff00' },
      { ...shapes[2], stroke: '#00ff00' },
    ])!
    expect(next.map((shape) => shape.stroke)).toEqual(['#00ff00', shapes[1].stroke, '#00ff00'])
    // Order and the untouched shape's identity are kept.
    expect(next[1]).toBe(shapes[1])
  })

  it('moves rigidly: every shape by the same stored amount, clamped so the whole selection stays on the frame', () => {
    const [box, , line] = three()
    const moved = movedShapes([box, line], 0.05, -0.03, { altKey: true })
    expect(moved[0]).toMatchObject({ x: 0.15, y: 0.07 })
    expect(moved[1]).toMatchObject({ tailX: 0.25, tailY: 0.67, tipX: 0.65, tipY: 0.77 })
    // Far right: the arrow's tip reaches 1 and stops there; the box stops
    // with it, so the spacing is unchanged.
    const pushed = movedShapes([box, line], 0.9, 0, { altKey: true })
    expect(pushed[1]).toMatchObject({ tipX: 1, tailX: 0.6 })
    expect(pushed[0]).toMatchObject({ x: 0.5 })
  })

  it('snaps the box around the selection unless Alt is held', () => {
    const [box, ellipse] = three()
    // The pair spans x 0.1–0.7, centre 0.4; moving 0.095 puts it at 0.495.
    const snapped = movedShapes([box, ellipse], 0.095, 0)
    expect((snapped[0] as BoxShape).x + 0.3).toBeCloseTo(0.5, 5)
    const free = movedShapes([box, ellipse], 0.095, 0, { altKey: true })
    expect((free[0] as BoxShape).x).toBe(0.2)
  })

  it('a key nudges the selection together; + and − resize each shape about its own centre', () => {
    const [box, ellipse] = three()
    const nudged = shapesAfterKeyStep([box, ellipse], { kind: 'move', dx: 0.01, dy: 0 }, WIDE)
    expect(nudged.map((shape) => (shape as BoxShape).x)).toEqual([0.11, 0.51])
    const grown = shapesAfterKeyStep([box, ellipse], { kind: 'scale', delta: 1 }, WIDE) as BoxShape[]
    expect(grown[0].width).toBeCloseTo(0.22, 5)
    expect(grown[0].x + grown[0].width / 2).toBeCloseTo(0.2, 5)
    expect(grown[1].x + grown[1].width / 2).toBeCloseTo(0.6, 5)
  })

  it('Ctrl+D copies the selection on top, offset down and right, under new ids', () => {
    const shapes = three()
    let counter = 0
    const result = duplicatedShapes(shapes, ids('r1', 'a1'), () => `copy${++counter}`)!
    expect(result.shapes.map((shape) => shape.id)).toEqual(['r1', 'e1', 'a1', 'copy1', 'copy2'])
    expect(result.copies[0]).toMatchObject({ kind: 'rectangle', x: 0.12, y: 0.12 })
    expect(DUPLICATE_OFFSET).toBe(0.02)
    expect(result.copies[1]).toMatchObject({ kind: 'arrow', tailX: 0.22, tipY: 0.82 })
    expect(result.shapes.slice(0, 3)).toEqual(shapes)
    expect(duplicatedShapes(shapes, ids(), () => 'x')).toBeNull()
  })

  it('Ctrl+D offsets the other way where the frame leaves no room', () => {
    const corner = rect({ id: 'r1', x: 0.8, y: 0.85, width: 0.2, height: 0.15 })
    const { copies } = duplicatedShapes([corner], ids('r1'), () => 'c')!
    expect(copies[0]).toMatchObject({ x: 0.78, y: 0.83 })
  })

  it('Delete removes the selection, and never the group’s last shape', () => {
    const shapes = three()
    expect(withoutShapes(shapes, ids('e1'))!.map((shape) => shape.id)).toEqual(['r1', 'a1'])
    expect(withoutShapes(shapes, ids('r1', 'e1', 'a1'))).toBeNull()
    expect(withoutShapes(shapes, ids('gone'))).toBeNull()
  })

  it('Bring forward and Send backward step the selection through the drawing order', () => {
    const shapes = three()
    const order = (next: ReturnType<typeof reorderedShapes>) => next?.map((shape) => shape.id)
    expect(order(reorderedShapes(shapes, ids('r1'), 'forward'))).toEqual(['e1', 'r1', 'a1'])
    expect(order(reorderedShapes(shapes, ids('a1'), 'backward'))).toEqual(['r1', 'a1', 'e1'])
    // Already on top (or at the bottom): nothing moves.
    expect(reorderedShapes(shapes, ids('a1'), 'forward')).toBeNull()
    expect(reorderedShapes(shapes, ids('r1'), 'backward')).toBeNull()
    // Two together move as a block.
    expect(order(reorderedShapes(shapes, ids('r1', 'e1'), 'forward'))).toEqual(['a1', 'r1', 'e1'])
    // One stacked against the top stays with it.
    expect(reorderedShapes(shapes, ids('e1', 'a1'), 'forward')).toBeNull()
    expect(reorderedShapes(shapes, ids(), 'forward')).toBeNull()
  })

  it('a restyle gives each kind only what it holds', () => {
    const [box, ellipse, line] = three()
    const change = { stroke: '#123456', cornerRadius: 0.05, heads: 'both' as const }
    expect(restyledShape(box, change)).toMatchObject({ stroke: '#123456', cornerRadius: 0.05 })
    const roundEllipse = restyledShape(ellipse, change)
    expect(roundEllipse).not.toHaveProperty('cornerRadius')
    expect(roundEllipse).not.toHaveProperty('heads')
    expect(restyledShape(line, change)).toMatchObject({ stroke: '#123456', heads: 'both' })
    expect(restyledShape(line, change)).not.toHaveProperty('cornerRadius')
    // A zero radius is stored as none, as the row stores it.
    expect(restyledShape(rect({ cornerRadius: 0.1 }), { cornerRadius: 0 })).not.toHaveProperty('cornerRadius')
    for (const shape of [box, ellipse, line]) expect(isValidShape(restyledShape(shape, change))).toBe(true)
  })

  it('a line style restyles every kind, stores solid as no key, and reads "mixed" across a selection (#688)', () => {
    const [box, ellipse, line] = three()
    const dashed = [box, ellipse, line].map((shape) => restyledShape(shape, { lineStyle: 'dashed' }))
    for (const shape of dashed) {
      expect(shape.lineStyle).toBe('dashed')
      expect(isValidShape(shape)).toBe(true)
    }
    expect(restyledShape(dashed[2], { lineStyle: 'solid' })).not.toHaveProperty('lineStyle')
    // A change that does not name the line style leaves it alone.
    expect(restyledShape(dashed[0], { stroke: '#123456' }).lineStyle).toBe('dashed')
    expect(selectionStyle([box, line])!.lineStyle).toBe('solid')
    expect(selectionStyle(dashed)!.lineStyle).toBe('dashed')
    expect(selectionStyle([dashed[0], ellipse])!.lineStyle).toBe('mixed')
  })

  it('the Highlighter preset is no border and a 35 % yellow fill', () => {
    expect(HIGHLIGHTER_STYLE).toEqual({ thickness: 0, fill: '#ffff00', fillOpacity: 0.35 })
    const lit = restyledShape(rect({ stroke: '#ff0000' }), HIGHLIGHTER_STYLE)
    expect(lit).toMatchObject({ thickness: 0, fill: '#ffff00', fillOpacity: 0.35, stroke: '#ff0000' })
  })

  it('the style bar reads shared values, "mixed" where shapes differ, and only fields every shape holds', () => {
    const [box, ellipse, line] = three()
    expect(selectionStyle([])).toBeNull()
    const pair = selectionStyle([box, { ...ellipse, stroke: '#00ff00' }])!
    expect(pair.stroke).toBe('mixed')
    expect(pair.thickness).toBe(box.thickness)
    expect(pair.fill).toBe(box.fill)
    // An ellipse is in it, so no corner radius; no arrow, so no heads.
    expect(pair.cornerRadius).toBeUndefined()
    expect(pair.heads).toBeUndefined()
    const all = selectionStyle([box, ellipse, line])!
    // An arrow draws no fill, so a selection holding one offers none.
    expect(all.fill).toBeUndefined()
    expect(all.fillOpacity).toBeUndefined()
    expect(selectionStyle([box, rect({ id: 'r2', cornerRadius: 0.02 })])!.cornerRadius).toBe('mixed')
    expect(selectionStyle([line, arrow({ id: 'a2', heads: 'none' })])).toMatchObject({
      heads: 'mixed',
      headSize: 'medium',
    })
  })
})

describe('placing and moving a badge (#689)', () => {
  const badge = (overrides: Partial<BadgeShape> = {}): BadgeShape => ({
    ...newBadge('b', []),
    centerX: 0.27,
    centerY: 0.62,
    ...overrides,
  })

  it('puts a clicked badge where the pointer is, on the stored grid, snapping only near a guide', () => {
    expect(placedBadgeCenter({ x: 0.2712, y: 0.6188 }, {})).toEqual({ x: 0.27, y: 0.62 })
    // Within the snap tolerance of the frame's centre and a third, it lands on them...
    expect(placedBadgeCenter({ x: 0.49, y: 0.345 }, {})).toEqual({ x: 0.5, y: 0.33 })
    // ...unless Alt is held, and it never leaves the frame.
    expect(placedBadgeCenter({ x: 0.49, y: 0.345 }, { altKey: true })).toEqual({ x: 0.49, y: 0.35 })
    expect(placedBadgeCenter({ x: -0.3, y: 1.4 }, { altKey: true })).toEqual({ x: 0, y: 1 })
  })

  it('moves by its centre, kept on the frame, and stays a valid shape', () => {
    const moved = movedBadge(badge(), 0.1, -0.05, { altKey: true })
    expect({ x: moved.centerX, y: moved.centerY }).toEqual({ x: 0.37, y: 0.57 })
    const pushed = movedBadge(badge(), 2, 2, { altKey: true })
    expect({ x: pushed.centerX, y: pushed.centerY }).toEqual({ x: 1, y: 1 })
    expect(isValidShape(pushed)).toBe(true)
    // Its size and number never change by moving.
    expect(moved).toMatchObject({ size: badge().size, number: badge().number })
  })

  it('takes arrow keys as a nudge and + / − as a diameter step within its limits', () => {
    const nudged = shapeAfterKeyStep(badge(), { kind: 'move', dx: 0.01, dy: 0 }, WIDE) as BadgeShape
    expect(nudged.centerX).toBe(0.28)
    const grown = shapeAfterKeyStep(badge(), { kind: 'scale', delta: 1 }, WIDE) as BadgeShape
    expect(grown.size).toBeCloseTo(badge().size + BADGE_SIZE_STEP, 10)
    const smallest = badge({ size: MIN_BADGE_SIZE })
    expect(shapeAfterKeyStep(smallest, { kind: 'scale', delta: -1 }, WIDE)).toBe(smallest)
    const largest = badge({ size: MAX_BADGE_SIZE })
    expect(shapeAfterKeyStep(largest, { kind: 'scale', delta: 1 }, WIDE)).toBe(largest)
  })

  it('moves with a selection by the same offset as a box beside it', () => {
    const [box, moved] = movedShapes([rect(), badge()], 0.1, 0.1, { altKey: true })
    expect((box as BoxShape).x).toBe(0.3)
    expect(moved).toMatchObject({ centerX: 0.37, centerY: 0.72 })
    expect(shapeBounds(badge())).toEqual({ x: 0.27, y: 0.62, width: 0, height: 0 })
  })

  it('shares the fill with boxes in the style bar, but neither corners nor heads', () => {
    const read = selectionStyle([rect({ fill: '#e53935' }), badge()])
    expect(read?.fill).toBe('#e53935')
    expect(read?.fillOpacity).toBe('mixed')
    expect(read?.cornerRadius).toBeUndefined()
    expect(read?.heads).toBeUndefined()
    // A restyle reaches a badge's disc and ring, and leaves its number alone.
    const restyled = restyledShape(badge(), { fill: '#00ff00', thickness: 0.01 }) as BadgeShape
    expect(restyled).toMatchObject({ fill: '#00ff00', thickness: 0.01, number: 1, numberColor: '#ffffff' })
    expect(restyledShape(badge(), { cornerRadius: 0.1 })).not.toHaveProperty('cornerRadius')
  })
})

describe('editing shapes (#685)', () => {
  it('a box moves, snaps its centre to the middle, and Alt bypasses the snap', () => {
    // Centre 0.2 + 0.29 + 0.15 = 0.64 → no; move so the centre reaches 0.51.
    const moved = boxAfterGesture(rect(), { kind: 'move', dx: 0.16, dy: 0 })
    expect(moved.x + moved.width / 2).toBeCloseTo(0.5, 2)
    const free = boxAfterGesture(rect(), { kind: 'move', dx: 0.16, dy: 0, altKey: true })
    expect(free.x).toBe(0.36)
  })

  it('a corner handle moves its two edges and an edge handle only its own', () => {
    const start = rect()
    const corner = boxAfterGesture(start, { kind: 'corner', corner: 'se', x: 0.7, y: 0.6 })
    expect(corner).toMatchObject({ x: 0.2, y: 0.2, width: 0.5, height: 0.4 })
    const edge = boxAfterGesture(start, { kind: 'edge', edge: 'w', x: 0.1, y: 0.9 })
    expect(edge).toMatchObject({ x: 0.1, y: 0.2, width: 0.4, height: 0.2 })
  })

  it('an arrow end handle moves only that end', () => {
    const start = arrow()
    const tip = arrowAfterEndDrag(start, 'tip', { x: 0.71, y: 0.8 }, { altKey: true }, WIDE)
    expect(tip).toMatchObject({ tailX: 0.2, tailY: 0.4, tipX: 0.71, tipY: 0.8 })
    const tail = arrowAfterEndDrag(start, 'tail', { x: 0.05, y: 0.15 }, { altKey: true }, WIDE)
    expect(tail).toMatchObject({ tailX: 0.05, tailY: 0.15, tipX: 0.6, tipY: 0.4 })
  })

  it('an arrow end dragged onto the other end stays where it was', () => {
    const start = arrow()
    expect(arrowAfterEndDrag(start, 'tip', { x: 0.2, y: 0.4 }, { altKey: true }, WIDE)).toBe(start)
  })

  it('an end snaps to the guides unless Alt is held', () => {
    const snapped = arrowAfterEndDrag(arrow(), 'tip', { x: 0.665, y: 0.51 }, {}, WIDE)
    expect(snapped).toMatchObject({ tipX: 0.67, tipY: 0.5 })
    expect(pointGuides({ x: snapped.tipX, y: snapped.tipY })).toEqual({ x: 2 / 3, y: 0.5 })
    expect(snappedPoint({ x: 0.4, y: 0.4 })).toEqual({ x: 0.4, y: 0.4 })
  })

  it('a moved arrow keeps its length and angle, and stays on the frame', () => {
    const start = arrow()
    const moved = movedArrow(start, 0.9, -0.03, { altKey: true })
    expect(moved.tipX).toBe(1)
    expect(moved.tipX - moved.tailX).toBeCloseTo(start.tipX - start.tailX, 9)
    expect(moved.tipY - moved.tailY).toBeCloseTo(start.tipY - start.tailY, 9)
    expect(arrowBounds(moved).y).toBe(0.37)
  })

  it('a moved arrow snaps its span the way a box does', () => {
    // A horizontal arrow at y 0.4 moved 0.09 down lands on the middle.
    const moved = movedArrow(arrow(), 0, 0.09)
    expect(moved.tailY).toBe(0.5)
    expect(moved.tipY).toBe(0.5)
  })

  it('keys nudge either kind, and + / − resize a box and lengthen an arrow along itself', () => {
    expect(shapeAfterKeyStep(rect(), { kind: 'move', dx: 0.01, dy: 0 }, WIDE)).toMatchObject({ x: 0.21 })
    expect(shapeAfterKeyStep(rect(), { kind: 'scale', delta: 0.1 }, WIDE)).toMatchObject({ width: 0.32 })
    expect(shapeAfterKeyStep(arrow(), { kind: 'move', dx: 0, dy: -0.05 }, WIDE)).toMatchObject({
      tailY: 0.35,
      tipY: 0.35,
    })
    const longer = shapeAfterKeyStep(arrow(), { kind: 'scale', delta: 0.1 }, WIDE) as ArrowShape
    expect(longer.tipX - longer.tailX).toBeGreaterThan(0.4)
    expect(longer.tailY).toBe(0.4)
    expect(longer.tipY).toBe(0.4)
    const shorter = shapeAfterKeyStep(arrow(), { kind: 'scale', delta: -0.1 }, WIDE) as ArrowShape
    expect(shorter.tipX - shorter.tailX).toBeLessThan(0.4)
  })

  it('every shape the editor produces is one the model accepts', () => {
    const produced = [
      { ...rect(), ...drawnBox({ x: 0.99, y: 0.99 }, { x: 1.5, y: 1.5 }, { shiftKey: true }, WIDE) },
      boxAfterGesture(rect(), { kind: 'corner', corner: 'nw', x: 0.9, y: 0.9 }),
      movedArrow(arrow(), -5, 5),
      arrowAfterEndDrag(arrow(), 'tip', { x: 3, y: -3 }, { shiftKey: true }, WIDE),
      shapeAfterKeyStep(arrow({ tailX: 0, tipX: 1 }), { kind: 'scale', delta: 0.1 }, WIDE),
    ]
    for (const shape of produced) expect(isValidShape(shape), JSON.stringify(shape)).toBe(true)
  })

  it('withShape returns null for an edit that changes nothing, so it is not an undo step', () => {
    const line = arrow()
    const shapes = [rect(), line]
    expect(withShape(shapes, { ...line })).toBeNull()
    const next = withShape(shapes, { ...line, tipX: 0.7 })
    expect(next).not.toBeNull()
    expect(next![0]).toBe(shapes[0])
    expect((next![1] as ArrowShape).tipX).toBe(0.7)
  })
})
