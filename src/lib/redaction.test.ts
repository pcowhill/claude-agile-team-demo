import { describe, expect, it } from 'vitest'
import {
  activeRedactions,
  areAcceptableRedactionInputs,
  areValidRedactions,
  isAcceptableRedactionInput,
  DEFAULT_BLUR_STRENGTH,
  DEFAULT_PIXELATE_BLOCK,
  DEFAULT_REDACTION_COLOR,
  drawRedactions,
  hasBlurRedaction,
  isValidRedactionRegion,
  MAX_REDACTION_STRENGTH,
  MIN_REGION_FRACTION,
  MIN_WINDOW_SECONDS,
  normalizeRedactionRegion,
  normalizeRedactions,
  redactionRects,
  redactionsEqual,
  type RedactionRegion,
} from './redaction'

/** A valid stored region, overridable per test. */
const region = (over: Partial<RedactionRegion> = {}): RedactionRegion => ({
  id: 'r1',
  left: 0.25,
  top: 0.25,
  width: 0.5,
  height: 0.5,
  start: 1,
  end: 3,
  style: 'solid',
  color: '#000000',
  ...over,
})

describe('isValidRedactionRegion (#492)', () => {
  it('accepts one well-formed region per style', () => {
    expect(isValidRedactionRegion(region())).toBe(true)
    expect(isValidRedactionRegion(region({ style: 'blur', color: undefined, strength: 8 }))).toBe(
      true,
    )
    expect(
      isValidRedactionRegion(region({ style: 'pixelate', color: undefined, blockSize: 16 })),
    ).toBe(true)
  })

  it('refuses a missing or empty id', () => {
    expect(isValidRedactionRegion(region({ id: '' }))).toBe(false)
    expect(isValidRedactionRegion(region({ id: undefined as never }))).toBe(false)
  })

  it('refuses a fraction outside the source frame', () => {
    expect(isValidRedactionRegion(region({ left: -0.1 }))).toBe(false)
    expect(isValidRedactionRegion(region({ top: -0.001 }))).toBe(false)
    expect(isValidRedactionRegion(region({ left: 0.6, width: 0.5 }))).toBe(false)
    expect(isValidRedactionRegion(region({ top: 0.6, height: 0.5 }))).toBe(false)
    expect(isValidRedactionRegion(region({ width: 0 }))).toBe(false)
    expect(isValidRedactionRegion(region({ height: Number.NaN }))).toBe(false)
  })

  it('refuses an empty or inverted window', () => {
    expect(isValidRedactionRegion(region({ start: 3, end: 3 }))).toBe(false)
    expect(isValidRedactionRegion(region({ start: 3, end: 1 }))).toBe(false)
    expect(isValidRedactionRegion(region({ start: -1 }))).toBe(false)
    expect(isValidRedactionRegion(region({ end: Number.POSITIVE_INFINITY }))).toBe(false)
  })

  it('refuses an unknown style', () => {
    expect(isValidRedactionRegion(region({ style: 'smudge' as never }))).toBe(false)
  })

  it('refuses a negative or oversized strength, and a block size under one', () => {
    expect(
      isValidRedactionRegion(region({ style: 'blur', color: undefined, strength: -1 })),
    ).toBe(false)
    expect(
      isValidRedactionRegion(
        region({ style: 'blur', color: undefined, strength: MAX_REDACTION_STRENGTH + 1 }),
      ),
    ).toBe(false)
    expect(
      isValidRedactionRegion(region({ style: 'pixelate', color: undefined, blockSize: 0 })),
    ).toBe(false)
  })

  it('refuses a non-hex colour, and uppercase (the stored form is lowercase)', () => {
    expect(isValidRedactionRegion(region({ color: 'black' }))).toBe(false)
    expect(isValidRedactionRegion(region({ color: '#FFF' }))).toBe(false)
    expect(isValidRedactionRegion(region({ color: '#FFFFFF' }))).toBe(false)
    expect(isValidRedactionRegion(region({ color: '#ffffff' }))).toBe(true)
  })

  it("refuses a style parameter belonging to another style — the stored form carries exactly one", () => {
    expect(isValidRedactionRegion(region({ strength: 4 }))).toBe(false)
    expect(
      isValidRedactionRegion(region({ style: 'blur', color: '#000000', strength: 4 })),
    ).toBe(false)
  })
})

describe('isAcceptableRedactionInput — the editing path clamps where the file path refuses', () => {
  it('accepts an out-of-range rectangle and window that the strict check rejects', () => {
    const overshot = region({ left: 0.9, width: 0.5, start: 5, end: 2 })
    // A dragged handle or a typed percent routinely overshoots; snapping
    // back is what every other adjustment does (`isValidCrop` is loose too).
    expect(isValidRedactionRegion(overshot)).toBe(false)
    expect(isAcceptableRedactionInput(overshot)).toBe(true)
    expect(isValidRedactionRegion(normalizeRedactionRegion(overshot))).toBe(true)
  })

  it('accepts a stale parameter from another style, which normalizing drops', () => {
    const stale = region({ style: 'blur', color: '#ffffff', strength: 8 })
    expect(isValidRedactionRegion(stale)).toBe(false)
    expect(isAcceptableRedactionInput(stale)).toBe(true)
    expect(normalizeRedactionRegion(stale).color).toBeUndefined()
  })

  it('still refuses what no amount of clamping could fix', () => {
    expect(isAcceptableRedactionInput(region({ id: '' }))).toBe(false)
    expect(isAcceptableRedactionInput(region({ left: Number.NaN }))).toBe(false)
    expect(isAcceptableRedactionInput(region({ end: Number.POSITIVE_INFINITY }))).toBe(false)
    expect(isAcceptableRedactionInput(region({ style: 'smudge' as never }))).toBe(false)
  })

  it('refuses duplicate ids either way — ids address a region within its element', () => {
    expect(areAcceptableRedactionInputs([region({ id: 'a' }), region({ id: 'a' })])).toBe(false)
    expect(areAcceptableRedactionInputs([region({ id: 'a' }), region({ id: 'b' })])).toBe(true)
  })
})

describe('areValidRedactions', () => {
  it('refuses duplicate ids', () => {
    expect(areValidRedactions([region({ id: 'a' }), region({ id: 'b' })])).toBe(true)
    expect(areValidRedactions([region({ id: 'a' }), region({ id: 'a' })])).toBe(false)
  })
})

describe('normalizeRedactionRegion', () => {
  it('clamps a rectangle back inside the source frame, keeping its size', () => {
    const out = normalizeRedactionRegion(region({ left: 0.8, top: 0.9, width: 0.5, height: 0.3 }))
    expect(out.width).toBeCloseTo(0.5, 10)
    expect(out.height).toBeCloseTo(0.3, 10)
    expect(out.left).toBeCloseTo(0.5, 10)
    expect(out.top).toBeCloseTo(0.7, 10)
  })

  it('floors a collapsed rectangle at MIN_REGION_FRACTION', () => {
    const out = normalizeRedactionRegion(region({ width: 0, height: -3 }))
    expect(out.width).toBe(MIN_REGION_FRACTION)
    expect(out.height).toBe(MIN_REGION_FRACTION)
  })

  it('orders an inverted window to the minimum rather than to nothing', () => {
    const out = normalizeRedactionRegion(region({ start: 5, end: 2 }))
    expect(out.start).toBe(5)
    expect(out.end).toBeCloseTo(5 + MIN_WINDOW_SECONDS, 10)
    expect(out.end).toBeGreaterThan(out.start)
  })

  it('keeps exactly the parameter its style uses, dropping the others', () => {
    const blurred = normalizeRedactionRegion(
      region({ style: 'blur', color: '#ff0000', blockSize: 9, strength: 7 }),
    )
    expect(blurred).toMatchObject({ style: 'blur', strength: 7 })
    expect(blurred.color).toBeUndefined()
    expect(blurred.blockSize).toBeUndefined()

    const pixelated = normalizeRedactionRegion(region({ style: 'pixelate', strength: 7 }))
    expect(pixelated.blockSize).toBe(DEFAULT_PIXELATE_BLOCK)
    expect(pixelated.strength).toBeUndefined()

    const solid = normalizeRedactionRegion(region({ style: 'solid', color: undefined }))
    expect(solid.color).toBe(DEFAULT_REDACTION_COLOR)
  })

  it('defaults a missing blur strength and clamps an oversized one', () => {
    expect(
      normalizeRedactionRegion(region({ style: 'blur', color: undefined })).strength,
    ).toBe(DEFAULT_BLUR_STRENGTH)
    expect(
      normalizeRedactionRegion(region({ style: 'blur', color: undefined, strength: 10_000 }))
        .strength,
    ).toBe(MAX_REDACTION_STRENGTH)
  })

  it('normalizes to a form that passes the strict file check', () => {
    const out = normalizeRedactionRegion(region({ left: 2, top: -1, width: 9, start: 4, end: 1 }))
    expect(isValidRedactionRegion(out)).toBe(true)
  })
})

describe('normalizeRedactions', () => {
  it('stores an empty list as no key at all', () => {
    expect(normalizeRedactions([])).toBeUndefined()
    expect(normalizeRedactions(undefined)).toBeUndefined()
  })

  it('preserves order — it is paint order, and regions may overlap', () => {
    const out = normalizeRedactions([region({ id: 'a' }), region({ id: 'b' })])
    expect(out?.map((each) => each.id)).toEqual(['a', 'b'])
  })
})

describe('redactionsEqual', () => {
  it('treats absent and empty as the same', () => {
    expect(redactionsEqual(undefined, [])).toBe(true)
  })

  it('separates a changed field, a changed order and a changed length', () => {
    expect(redactionsEqual([region()], [region()])).toBe(true)
    expect(redactionsEqual([region()], [region({ left: 0.26 })])).toBe(false)
    expect(redactionsEqual([region({ id: 'a' }), region({ id: 'b' })], [region({ id: 'b' }), region({ id: 'a' })])).toBe(false)
    expect(redactionsEqual([region()], [region(), region({ id: 'b' })])).toBe(false)
  })
})

describe('activeRedactions', () => {
  it('covers its window, half-open at the end', () => {
    const only = [region({ start: 1, end: 3 })]
    expect(activeRedactions(only, 0.999)).toHaveLength(0)
    expect(activeRedactions(only, 1)).toHaveLength(1)
    expect(activeRedactions(only, 2.999)).toHaveLength(1)
    expect(activeRedactions(only, 3)).toHaveLength(0)
  })

  it('returns overlapping regions in paint order', () => {
    const regions = [region({ id: 'a', start: 0, end: 10 }), region({ id: 'b', start: 1, end: 2 })]
    expect(activeRedactions(regions, 1.5).map((each) => each.id)).toEqual(['a', 'b'])
  })
})

describe('hasBlurRedaction', () => {
  it('is true only when some region blurs', () => {
    expect(hasBlurRedaction(undefined)).toBe(false)
    expect(hasBlurRedaction([region({ style: 'solid' })])).toBe(false)
    expect(hasBlurRedaction([region({ style: 'pixelate', color: undefined, blockSize: 4 })])).toBe(
      false,
    )
    expect(
      hasBlurRedaction([
        region({ style: 'solid' }),
        region({ id: 'b', style: 'blur', color: undefined, strength: 3 }),
      ]),
    ).toBe(true)
  })
})

describe('redactionRects', () => {
  const draw = { x: 100, y: 50, width: 800, height: 400 }

  it('maps fractions of an uncropped source onto the drawn rectangle', () => {
    const rects = redactionRects(region({ left: 0.25, top: 0.5, width: 0.25, height: 0.25 }), undefined, 1000, 500, draw)
    expect(rects?.source).toEqual({ x: 250, y: 250, width: 250, height: 125 })
    expect(rects?.dest).toEqual({ x: 300, y: 250, width: 200, height: 100 })
  })

  it('places the region relative to the KEPT rectangle when the layer is cropped', () => {
    // Crop keeps the right half of the source; a region at 0.5..0.75 of the
    // whole source is therefore the left half of what is drawn.
    const rects = redactionRects(
      region({ left: 0.5, top: 0, width: 0.25, height: 1 }),
      { left: 0.5 },
      1000,
      500,
      draw,
    )
    expect(rects?.source).toEqual({ x: 500, y: 0, width: 250, height: 500 })
    expect(rects?.dest).toEqual({ x: 100, y: 50, width: 400, height: 400 })
  })

  it('trims a region straddling the crop edge to the part still shown', () => {
    const rects = redactionRects(
      region({ left: 0.25, top: 0, width: 0.5, height: 1 }),
      { left: 0.5 },
      1000,
      500,
      draw,
    )
    expect(rects?.source.x).toBe(500)
    expect(rects?.source.width).toBe(250)
    expect(rects?.dest.x).toBe(100)
  })

  it('is undefined for a region entirely in cropped-away source', () => {
    expect(
      redactionRects(region({ left: 0, top: 0, width: 0.25, height: 1 }), { left: 0.5 }, 1000, 500, draw),
    ).toBeUndefined()
  })

  it('is undefined for a degenerate source', () => {
    expect(redactionRects(region(), undefined, 0, 500, draw)).toBeUndefined()
    expect(redactionRects(region(), undefined, 1000, 0, draw)).toBeUndefined()
  })

  it('needs no orientation handling — the caller draws inside the transform', () => {
    // The same region against the same source yields the same rectangle
    // whatever the layer's orientation is, because orientation is the
    // context transform the caller has already established.
    const a = redactionRects(region(), undefined, 1000, 500, draw)
    const b = redactionRects(region(), undefined, 1000, 500, { ...draw, width: -draw.width })
    expect(a?.source).toEqual(b?.source)
  })
})

/** A recording 2D context: every call the draw path makes, in order. */
function recordingContext() {
  const calls: string[] = []
  const state = { filter: 'none', fillStyle: '', imageSmoothingEnabled: true }
  const context = {
    get filter() {
      return state.filter
    },
    set filter(value: string) {
      state.filter = value
      calls.push(`filter=${value}`)
    },
    get fillStyle() {
      return state.fillStyle
    },
    set fillStyle(value: string) {
      state.fillStyle = value
      calls.push(`fillStyle=${value}`)
    },
    get imageSmoothingEnabled() {
      return state.imageSmoothingEnabled
    },
    set imageSmoothingEnabled(value: boolean) {
      state.imageSmoothingEnabled = value
      calls.push(`smoothing=${value}`)
    },
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    beginPath: () => calls.push('beginPath'),
    rect: (x: number, y: number, w: number, h: number) => calls.push(`rect(${x},${y},${w},${h})`),
    clip: () => calls.push('clip'),
    clearRect: () => calls.push('clearRect'),
    fillRect: (x: number, y: number, w: number, h: number) =>
      calls.push(`fillRect(${x},${y},${w},${h})`),
    drawImage: (...args: unknown[]) => calls.push(`drawImage(${args.length - 1} args)`),
  }
  return { context: context as unknown as CanvasRenderingContext2D, calls }
}

function bufferCanvas() {
  const made: { width: number; height: number }[] = []
  const createCanvas = () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        filter: 'none',
        imageSmoothingEnabled: true,
        clearRect: () => {},
        drawImage: () => {},
      }),
    }
    made.push(canvas as unknown as { width: number; height: number })
    return canvas as unknown as HTMLCanvasElement
  }
  return { createCanvas, made }
}

describe('drawRedactions', () => {
  const base = {
    source: {} as CanvasImageSource,
    sourceTime: 2,
    crop: undefined,
    sourceWidth: 1000,
    sourceHeight: 500,
    drawRect: { x: 0, y: 0, width: 1000, height: 500 },
  }

  it('draws nothing at all when no region covers the frame', () => {
    const { context, calls } = recordingContext()
    drawRedactions({ ...base, context, regions: [region({ start: 5, end: 6 })] })
    expect(calls).toEqual([])
  })

  it('draws nothing when the element carries no regions — the pre-#492 path', () => {
    const { context, calls } = recordingContext()
    drawRedactions({ ...base, context, regions: undefined })
    expect(calls).toEqual([])
  })

  it('fills a solid region in its colour, with the layer filter suppressed', () => {
    const { context, calls } = recordingContext()
    context.filter = 'grayscale(100%)'
    calls.length = 0
    drawRedactions({
      ...base,
      context,
      regions: [region({ left: 0.25, top: 0.5, width: 0.25, height: 0.25, color: '#ff0000' })],
    })
    expect(calls).toContain('fillStyle=#ff0000')
    expect(calls).toContain('fillRect(250,250,250,125)')
    // The mask is not part of the picture being graded.
    expect(calls.indexOf('filter=none')).toBeLessThan(calls.indexOf('fillRect(250,250,250,125)'))
    // …and the layer's own filter is put back for whatever draws next.
    expect(context.filter).toBe('grayscale(100%)')
  })

  it('pixelates through a buffer of whole blocks, with smoothing off', () => {
    const { context, calls } = recordingContext()
    const { createCanvas, made } = bufferCanvas()
    drawRedactions({
      ...base,
      context,
      createCanvas,
      regions: [
        region({
          left: 0,
          top: 0,
          width: 0.5,
          height: 0.5,
          style: 'pixelate',
          color: undefined,
          blockSize: 50,
        }),
      ],
    })
    // 500 source px across at 50 px per block = 10 blocks; 250 down = 5.
    expect(made[0]).toMatchObject({ width: 10, height: 5 })
    expect(calls).toContain('smoothing=false')
    expect(context.imageSmoothingEnabled).toBe(true)
  })

  it('blurs clipped to the region, scaling the source-pixel radius to the drawn size', () => {
    const { context, calls } = recordingContext()
    drawRedactions({
      ...base,
      context,
      // The layer is drawn at half its source size, so a 20 px source blur
      // must land as 10 px on the canvas.
      drawRect: { x: 0, y: 0, width: 500, height: 250 },
      regions: [
        region({ left: 0, top: 0, width: 0.5, height: 0.5, style: 'blur', color: undefined, strength: 20 }),
      ],
    })
    expect(calls).toContain('clip')
    expect(calls).toContain('filter=blur(10px)')
    expect(calls.indexOf('clip')).toBeLessThan(calls.indexOf('filter=blur(10px)'))
  })

  it('fills a blur region solid rather than leaving it readable when the context cannot blur', () => {
    const { context, calls } = recordingContext()
    drawRedactions({
      ...base,
      context,
      blurSupported: false,
      regions: [region({ style: 'blur', color: undefined, strength: 20 })],
    })
    expect(calls.some((call) => call.startsWith('fillRect'))).toBe(true)
    expect(calls.some((call) => call.startsWith('filter=blur'))).toBe(false)
    expect(calls).toContain(`fillStyle=${DEFAULT_REDACTION_COLOR}`)
  })

  it('paints several active regions in order', () => {
    const { context, calls } = recordingContext()
    drawRedactions({
      ...base,
      context,
      regions: [
        region({ id: 'a', left: 0, top: 0, width: 0.1, height: 0.1, color: '#111111' }),
        region({ id: 'b', left: 0.5, top: 0, width: 0.1, height: 0.1, color: '#222222' }),
      ],
    })
    expect(calls.indexOf('fillStyle=#111111')).toBeLessThan(calls.indexOf('fillStyle=#222222'))
  })

  it('skips a region cropped entirely out of the picture', () => {
    const { context, calls } = recordingContext()
    drawRedactions({
      ...base,
      context,
      crop: { left: 0.5 },
      regions: [region({ left: 0, top: 0, width: 0.25, height: 1 })],
    })
    expect(calls).toEqual([])
  })
})
