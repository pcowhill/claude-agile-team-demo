import { describe, expect, it } from 'vitest'
import {
  activeSpotlights,
  areAcceptableSpotlightInputs,
  areValidSpotlights,
  DEFAULT_SPOTLIGHT_DIM,
  DEFAULT_SPOTLIGHT_SHAPE,
  drawSpotlights,
  hasSpotlight,
  isAcceptableSpotlightInput,
  isValidSpotlightRegion,
  normalizeSpotlightRegion,
  normalizeSpotlights,
  spotlightRects,
  spotlightsEqual,
  type SpotlightRegion,
} from './spotlight'
import { MIN_REGION_FRACTION, MIN_WINDOW_SECONDS, redactionRects } from './redaction'

/** A valid stored region, overridable per test. */
const region = (over: Partial<SpotlightRegion> = {}): SpotlightRegion => ({
  id: 's1',
  left: 0.25,
  top: 0.25,
  width: 0.5,
  height: 0.5,
  start: 1,
  end: 3,
  shape: 'rectangle',
  dim: 0.55,
  ...over,
})

describe('isValidSpotlightRegion (#532)', () => {
  it('accepts a well-formed region of either shape', () => {
    expect(isValidSpotlightRegion(region())).toBe(true)
    expect(isValidSpotlightRegion(region({ shape: 'oval' }))).toBe(true)
  })

  it('refuses a missing or empty id', () => {
    expect(isValidSpotlightRegion(region({ id: '' }))).toBe(false)
    expect(isValidSpotlightRegion(region({ id: undefined as never }))).toBe(false)
  })

  it('refuses a zero-size box, or one outside the source frame', () => {
    // The box rules are redaction's own (`isValidRegionBox`), so this pins
    // that the sharing is real rather than that they were copied.
    expect(isValidSpotlightRegion(region({ width: 0 }))).toBe(false)
    expect(isValidSpotlightRegion(region({ height: 0 }))).toBe(false)
    expect(isValidSpotlightRegion(region({ left: -0.1 }))).toBe(false)
    expect(isValidSpotlightRegion(region({ left: 0.6, width: 0.5 }))).toBe(false)
    expect(isValidSpotlightRegion(region({ top: 0.6, height: 0.5 }))).toBe(false)
    expect(isValidSpotlightRegion(region({ height: Number.NaN }))).toBe(false)
  })

  it('refuses an empty or inverted time window', () => {
    expect(isValidSpotlightRegion(region({ start: 3, end: 3 }))).toBe(false)
    expect(isValidSpotlightRegion(region({ start: 3, end: 1 }))).toBe(false)
    expect(isValidSpotlightRegion(region({ start: -1 }))).toBe(false)
    expect(isValidSpotlightRegion(region({ end: Number.POSITIVE_INFINITY }))).toBe(false)
  })

  it('refuses an unknown shape', () => {
    expect(isValidSpotlightRegion(region({ shape: 'diamond' as never }))).toBe(false)
    expect(isValidSpotlightRegion(region({ shape: undefined as never }))).toBe(false)
  })

  it('refuses a dim outside 0…1', () => {
    expect(isValidSpotlightRegion(region({ dim: 0 }))).toBe(true)
    expect(isValidSpotlightRegion(region({ dim: 1 }))).toBe(true)
    expect(isValidSpotlightRegion(region({ dim: -0.01 }))).toBe(false)
    expect(isValidSpotlightRegion(region({ dim: 1.01 }))).toBe(false)
    expect(isValidSpotlightRegion(region({ dim: Number.NaN }))).toBe(false)
    expect(isValidSpotlightRegion(region({ dim: undefined as never }))).toBe(false)
  })
})

describe('areValidSpotlights (#532)', () => {
  it('refuses two regions sharing an id', () => {
    expect(areValidSpotlights([region({ id: 'a' }), region({ id: 'b' })])).toBe(true)
    expect(areValidSpotlights([region({ id: 'a' }), region({ id: 'a' })])).toBe(false)
  })
})

describe('isAcceptableSpotlightInput (#532)', () => {
  it('lets an out-of-range box and dim through — the editing path clamps', () => {
    expect(isAcceptableSpotlightInput(region({ left: 4, width: 9 }))).toBe(true)
    expect(isAcceptableSpotlightInput(region({ start: 9, end: 1 }))).toBe(true)
    expect(isAcceptableSpotlightInput(region({ dim: 5 }))).toBe(true)
  })

  it('still refuses what cannot be repaired: a non-number, or an unknown shape', () => {
    expect(isAcceptableSpotlightInput(region({ dim: Number.NaN }))).toBe(false)
    expect(isAcceptableSpotlightInput(region({ width: '50%' as never }))).toBe(false)
    expect(isAcceptableSpotlightInput(region({ shape: 'diamond' as never }))).toBe(false)
    expect(areAcceptableSpotlightInputs([region({ id: 'a' }), region({ id: 'a' })])).toBe(false)
  })
})

describe('normalizeSpotlightRegion (#532)', () => {
  it('clamps the box inside the frame and floors its extent', () => {
    const normalized = normalizeSpotlightRegion(region({ left: 2, top: -1, width: 9, height: 0 }))
    expect(normalized.width).toBe(1)
    expect(normalized.height).toBe(MIN_REGION_FRACTION)
    expect(normalized.left).toBe(0)
    expect(normalized.top).toBe(0)
  })

  it('orders an inverted window and keeps it non-empty', () => {
    const normalized = normalizeSpotlightRegion(region({ start: 5, end: 2 }))
    expect(normalized.start).toBe(5)
    expect(normalized.end).toBe(5 + MIN_WINDOW_SECONDS)
    expect(normalizeSpotlightRegion(region({ start: -4, end: 1 })).start).toBe(0)
  })

  it('clamps the dim to 0…1 and leaves the shape alone', () => {
    expect(normalizeSpotlightRegion(region({ dim: 4 })).dim).toBe(1)
    expect(normalizeSpotlightRegion(region({ dim: -2 })).dim).toBe(0)
    expect(normalizeSpotlightRegion(region({ shape: 'oval' })).shape).toBe('oval')
  })

  it('stores exactly the nine fields, never a stale extra', () => {
    const normalized = normalizeSpotlightRegion({
      ...region(),
      style: 'blur',
    } as unknown as SpotlightRegion)
    expect(Object.keys(normalized).sort()).toEqual([
      'dim',
      'end',
      'height',
      'id',
      'left',
      'shape',
      'start',
      'top',
      'width',
    ])
  })
})

describe('normalizeSpotlights (#532)', () => {
  it('turns an empty list into no key at all — the byte-identity rule', () => {
    expect(normalizeSpotlights([])).toBeUndefined()
    expect(normalizeSpotlights(undefined)).toBeUndefined()
  })

  it('normalizes every region and keeps the list order', () => {
    const list = normalizeSpotlights([region({ id: 'a', dim: 9 }), region({ id: 'b' })])
    expect(list?.map((each) => each.id)).toEqual(['a', 'b'])
    expect(list?.[0].dim).toBe(1)
  })
})

describe('spotlightsEqual and hasSpotlight (#532)', () => {
  it('compares every stored field, absent and empty alike', () => {
    expect(spotlightsEqual(undefined, [])).toBe(true)
    expect(spotlightsEqual([region()], [region()])).toBe(true)
    expect(spotlightsEqual([region()], [region({ shape: 'oval' })])).toBe(false)
    expect(spotlightsEqual([region()], [region({ dim: 0.5 })])).toBe(false)
    expect(spotlightsEqual([region()], [region(), region({ id: 's2' })])).toBe(false)
  })

  it('reports whether an element carries any region', () => {
    expect(hasSpotlight(undefined)).toBe(false)
    expect(hasSpotlight([])).toBe(false)
    expect(hasSpotlight([region()])).toBe(true)
  })
})

describe('activeSpotlights (#532)', () => {
  it('uses a half-open window, so abutting regions never both cover a frame', () => {
    const first = region({ id: 'a', start: 0, end: 2 })
    const second = region({ id: 'b', start: 2, end: 4 })
    expect(activeSpotlights([first, second], 1.999).map((each) => each.id)).toEqual(['a'])
    expect(activeSpotlights([first, second], 2).map((each) => each.id)).toEqual(['b'])
    expect(activeSpotlights([first, second], 4)).toEqual([])
    expect(activeSpotlights(undefined, 1)).toEqual([])
  })
})

describe('spotlightRects (#532)', () => {
  const frame = { x: 0, y: 0, width: 800, height: 400 }

  it('places a region against the same crop as a redaction of the same box', () => {
    // The anti-drift assertion: the two features must agree on where a
    // region IS, so this pins that they come out of one function rather
    // than out of two that happen to match today.
    const box = { left: 0.25, top: 0.5, width: 0.25, height: 0.25 }
    const crop = { left: 0.1, right: 0.1 }
    expect(spotlightRects(box, crop, 1000, 500, frame)).toEqual(
      redactionRects(box, crop, 1000, 500, frame),
    )
  })

  it('returns nothing for a region cropped entirely away', () => {
    expect(
      spotlightRects({ left: 0, top: 0, width: 0.05, height: 0.5 }, { left: 0.5 }, 1000, 500, frame),
    ).toBeUndefined()
  })
})

/**
 * A canvas context that records structured operations, so a test can ask
 * what the module *drew* rather than what it called.
 */
function recordingContext() {
  const ops: Op[] = []
  const state = { filter: 'none', fillStyle: '' }
  const context = {
    get filter() {
      return state.filter
    },
    set filter(value: string) {
      state.filter = value
      ops.push({ kind: 'filter', value })
    },
    get fillStyle() {
      return state.fillStyle
    },
    set fillStyle(value: string) {
      state.fillStyle = value
      ops.push({ kind: 'fillStyle', value })
    },
    save: () => ops.push({ kind: 'save' }),
    restore: () => ops.push({ kind: 'restore' }),
    beginPath: () => ops.push({ kind: 'beginPath' }),
    rect: (x: number, y: number, width: number, height: number) =>
      ops.push({ kind: 'rect', x, y, width, height }),
    ellipse: (x: number, y: number, radiusX: number, radiusY: number) =>
      ops.push({ kind: 'ellipse', x, y, radiusX, radiusY }),
    clip: (rule?: string) => ops.push({ kind: 'clip', rule: rule ?? 'nonzero' }),
    fillRect: (x: number, y: number, width: number, height: number) =>
      ops.push({ kind: 'fillRect', x, y, width, height }),
  }
  return { context: context as unknown as CanvasRenderingContext2D, ops }
}

type Op =
  | { kind: 'filter'; value: string }
  | { kind: 'fillStyle'; value: string }
  | { kind: 'save' }
  | { kind: 'restore' }
  | { kind: 'beginPath' }
  | { kind: 'rect'; x: number; y: number; width: number; height: number }
  | { kind: 'ellipse'; x: number; y: number; radiusX: number; radiusY: number }
  | { kind: 'clip'; rule: string }
  | { kind: 'fillRect'; x: number; y: number; width: number; height: number }

type Subpath = Extract<Op, { kind: 'rect' } | { kind: 'ellipse' }>

const inSubpath = (subpath: Subpath, x: number, y: number): boolean => {
  if (subpath.kind === 'rect') {
    const x0 = Math.min(subpath.x, subpath.x + subpath.width)
    const x1 = Math.max(subpath.x, subpath.x + subpath.width)
    const y0 = Math.min(subpath.y, subpath.y + subpath.height)
    const y1 = Math.max(subpath.y, subpath.y + subpath.height)
    return x >= x0 && x < x1 && y >= y0 && y < y1
  }
  const dx = (x - subpath.x) / subpath.radiusX
  const dy = (y - subpath.y) / subpath.radiusY
  return dx * dx + dy * dy <= 1
}

/**
 * Replays the recorded operations and answers what the frame actually looks
 * like at one point: the dim's alpha there, or 0 where nothing was painted.
 *
 * This is an independent reading of the canvas rules — a clip intersects
 * with the clips before it, and an even-odd path contains a point when an
 * odd number of its subpaths do — rather than a restatement of what
 * `drawSpotlights` does. That is the point: an implementation that put both
 * regions into ONE even-odd path would record different operations, this
 * would faithfully compute "the overlap is dimmed", and the union test
 * below would fail. Which is the bug the union rule exists to prevent.
 */
function dimAt(ops: readonly Op[], x: number, y: number): number {
  const clips: { subpaths: Subpath[]; rule: string }[] = []
  let subpaths: Subpath[] = []
  let alpha = 0
  for (const op of ops) {
    if (op.kind === 'beginPath') subpaths = []
    else if (op.kind === 'rect' || op.kind === 'ellipse') subpaths.push(op)
    else if (op.kind === 'clip') clips.push({ subpaths: [...subpaths], rule: op.rule })
    else if (op.kind === 'fillStyle') {
      const match = /rgba\([^)]*,\s*([\d.]+)\)/.exec(op.value)
      alpha = match === null ? 0 : Number(match[1])
    } else if (op.kind === 'fillRect') {
      if (!inSubpath({ ...op, kind: 'rect' }, x, y)) continue
      const clipped = clips.every(({ subpaths: paths, rule }) => {
        const inside = paths.filter((path) => inSubpath(path, x, y)).length
        return rule === 'evenodd' ? inside % 2 === 1 : inside > 0
      })
      if (clipped) return alpha
    }
  }
  return 0
}

describe('drawSpotlights (#532)', () => {
  // A 1000×500 source drawn 1:1, so a fraction of the source is the same
  // number of pixels in the frame and the expected geometry is readable.
  const base = {
    sourceTime: 2,
    crop: undefined,
    sourceWidth: 1000,
    sourceHeight: 500,
    drawRect: { x: 0, y: 0, width: 1000, height: 500 },
  }

  it('draws nothing when the element carries no regions — the pre-#532 path', () => {
    const { context, ops } = recordingContext()
    drawSpotlights({ ...base, context, regions: undefined })
    expect(ops).toEqual([])
  })

  it('draws nothing when no region covers this frame', () => {
    const { context, ops } = recordingContext()
    drawSpotlights({ ...base, context, regions: [region({ start: 5, end: 6 })] })
    expect(ops).toEqual([])
  })

  it('draws nothing for a dim of zero — there is no darkening to paint', () => {
    const { context, ops } = recordingContext()
    drawSpotlights({ ...base, context, regions: [region({ dim: 0 })] })
    expect(ops).toEqual([])
  })

  it('dims outside a rectangle and leaves its inside alone', () => {
    const { context, ops } = recordingContext()
    drawSpotlights({
      ...base,
      context,
      regions: [region({ left: 0.2, top: 0.2, width: 0.4, height: 0.4, dim: 0.6 })],
    })
    // The lit box is x 200…600, y 100…300 of the drawn frame.
    expect(dimAt(ops, 400, 200)).toBe(0)
    expect(dimAt(ops, 199, 200)).toBe(0.6)
    expect(dimAt(ops, 601, 200)).toBe(0.6)
    expect(dimAt(ops, 400, 99)).toBe(0.6)
    expect(dimAt(ops, 400, 301)).toBe(0.6)
    // A corner just inside the box is lit, and just outside it is not.
    expect(dimAt(ops, 201, 101)).toBe(0)
  })

  it('inscribes an oval in the same box: its corners dim, its middle does not', () => {
    const box = { left: 0.2, top: 0.2, width: 0.4, height: 0.4, dim: 0.6 }
    const asOval = recordingContext()
    drawSpotlights({ ...base, context: asOval.context, regions: [region({ ...box, shape: 'oval' })] })
    const asRectangle = recordingContext()
    drawSpotlights({ ...base, context: asRectangle.context, regions: [region(box)] })

    // The centre and the axis extremes are inside both shapes…
    for (const [x, y] of [
      [400, 200],
      [205, 200],
      [595, 200],
      [400, 105],
      [400, 295],
    ]) {
      expect(dimAt(asOval.ops, x, y), `oval at ${x},${y}`).toBe(0)
      expect(dimAt(asRectangle.ops, x, y), `rectangle at ${x},${y}`).toBe(0)
    }
    // …and the box's corners are inside the rectangle only, which is the
    // one check that tells the two shapes apart.
    for (const [x, y] of [
      [210, 110],
      [590, 110],
      [210, 290],
      [590, 290],
    ]) {
      expect(dimAt(asOval.ops, x, y), `oval corner ${x},${y}`).toBe(0.6)
      expect(dimAt(asRectangle.ops, x, y), `rectangle corner ${x},${y}`).toBe(0)
    }
  })

  it('draws a circle for a square-proportioned box — the customer’s own case', () => {
    // #531's comment: an oval "would effectively be a circle" when the box
    // is square. The source is 1000×500 drawn 1:1, so a box of 0.2 wide and
    // 0.4 tall is 200×200 on the frame — square in the picture, which is
    // where the user sees it.
    const { context, ops } = recordingContext()
    drawSpotlights({
      ...base,
      context,
      regions: [region({ left: 0.4, top: 0.3, width: 0.2, height: 0.4, shape: 'oval' })],
    })
    const ellipse = ops.find((op) => op.kind === 'ellipse')
    expect(ellipse).toBeDefined()
    // Fractions of a source frame land on 400.00000000000006, so the radii
    // are compared to the precision the geometry actually has.
    if (ellipse?.kind !== 'ellipse') throw new Error('no ellipse was traced')
    expect(ellipse.x).toBeCloseTo(500, 6)
    expect(ellipse.y).toBeCloseTo(250, 6)
    expect(ellipse.radiusX).toBeCloseTo(100, 6)
    expect(ellipse.radiusY).toBeCloseTo(100, 6)
    // Inscribed in the same box the rectangle would have used.
    expect(ellipse.radiusX).toBeCloseTo(ellipse.radiusY, 6)
    // And it really is round on the frame: equal distances in x and y from
    // the centre fall the same side of the edge.
    expect(dimAt(ops, 500 + 99, 250)).toBe(0)
    expect(dimAt(ops, 500, 250 + 99)).toBe(0)
    expect(dimAt(ops, 500 + 101, 250)).toBe(0.55)
    expect(dimAt(ops, 500, 250 + 101)).toBe(0.55)
  })

  it('punches out the union of two overlapping regions, dimming neither', () => {
    const { context, ops } = recordingContext()
    drawSpotlights({
      ...base,
      context,
      regions: [
        region({ id: 'a', left: 0.1, top: 0.2, width: 0.3, height: 0.4, dim: 0.5 }),
        region({ id: 'b', left: 0.3, top: 0.2, width: 0.3, height: 0.4, dim: 0.5 }),
      ],
    })
    // a covers x 100…400, b covers x 300…600, both y 100…300.
    expect(dimAt(ops, 150, 200), 'inside a only').toBe(0)
    expect(dimAt(ops, 550, 200), 'inside b only').toBe(0)
    // The overlap is the case #531 names: a single even-odd path over both
    // regions would dim it, and this is what catches that.
    expect(dimAt(ops, 350, 200), 'inside both').toBe(0)
    expect(dimAt(ops, 700, 200), 'outside both').toBe(0.5)
  })

  it('dims the outside at the strongest region’s dim', () => {
    const { context, ops } = recordingContext()
    drawSpotlights({
      ...base,
      context,
      regions: [
        region({ id: 'a', left: 0.1, top: 0.2, width: 0.2, height: 0.4, dim: 0.3 }),
        region({ id: 'b', left: 0.6, top: 0.2, width: 0.2, height: 0.4, dim: 0.8 }),
      ],
    })
    expect(dimAt(ops, 500, 200)).toBe(0.8)
  })

  it('ignores a region cropped entirely away, and dims nothing when all are', () => {
    const { context, ops } = recordingContext()
    drawSpotlights({
      ...base,
      context,
      crop: { left: 0.5 },
      regions: [region({ left: 0, top: 0.2, width: 0.05, height: 0.4 })],
    })
    expect(ops).toEqual([])
  })

  it('suppresses the layer’s colour filter and puts it back', () => {
    const { context, ops } = recordingContext()
    context.filter = 'grayscale(100%)'
    drawSpotlights({ ...base, context, regions: [region()] })
    const filterIndex = ops.findIndex((op) => op.kind === 'filter' && op.value === 'none')
    const fillIndex = ops.findIndex((op) => op.kind === 'fillRect')
    expect(filterIndex).toBeGreaterThanOrEqual(0)
    expect(filterIndex).toBeLessThan(fillIndex)
    // The dim is not part of the picture being graded, but whatever draws
    // next still is.
    expect(context.filter).toBe('grayscale(100%)')
  })
})

describe('spotlight defaults (#532)', () => {
  it('a fresh region is a rectangle at the dim #531 asked for', () => {
    expect(DEFAULT_SPOTLIGHT_SHAPE).toBe('rectangle')
    expect(DEFAULT_SPOTLIGHT_DIM).toBe(0.55)
  })
})
