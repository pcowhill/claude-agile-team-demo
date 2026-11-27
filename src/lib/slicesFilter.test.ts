import { afterEach, describe, expect, it } from 'vitest'
import {
  SLICES_FILTERS_ID,
  SLICES_FILTER_LIMIT,
  bandsWithin,
  exportSlices,
  previewSlices,
  roundedSlices,
  slicesFilterUrl,
} from './slicesFilter'
import type { DrawnSlice } from './slicesFilter'
import { IDENTITY_ZOOM } from './zoom'

/**
 * The SVG filter behind slices (#871, step 2b(i)): one `<filter>` per
 * drawn band set, holding the primitives #871's measurement took; the
 * export's bands on the card in canvas px; and the preview's bands taken
 * back from the frame through the zoom, the orientation and the crop into
 * the media element's own px, so they land on the screen where the
 * export's do.
 */

afterEach(() => {
  document.getElementById(SLICES_FILTERS_ID)?.remove()
})

const band = (start: number, size: number, dx: number, axis: 'x' | 'y' = 'y', dy = 0): DrawnSlice => ({
  axis,
  start,
  size,
  dx,
  dy,
})

/** The filter `url(#id)` names. */
function filterOf(url: string | null): Element {
  const id = /^url\(#(.+)\)$/.exec(url ?? '')?.[1]
  const filter = id === undefined ? null : document.getElementById(id)
  if (filter === null) throw new Error(`no filter for ${url}`)
  return filter
}

describe('roundedSlices: whole device px, which Chromium and Firefox draw alike (#1021)', () => {
  /**
   * The device px a browser lands a written number on: Chromium rounds,
   * Firefox truncates toward zero (#980's CI run 45739047158). The written
   * value is read as a 32-bit float, as an SVG attribute is, and multiplied
   * by the ratio in 32 bits.
   */
  const landed = (px: number, ratio: number) => {
    const device = Math.fround(Math.fround(px) * Math.fround(ratio))
    return { chromium: Math.round(device), firefox: Math.trunc(device) }
  }

  it('rounds edges and shifts to whole canvas px at a ratio of 1, and drops a band with no size or no shift', () => {
    expect(
      roundedSlices([band(10.4, 20.2, 5.56), band(30, 0.4, 9), band(40, 10, 0.4), band(50, 10, -0.6, 'x')]),
    ).toEqual([band(10, 21, 6), band(50, 10, -1, 'x')])
  })

  it("rounds slices.spec.ts's saved-frame shift of −57.6 px to −58, which both browsers draw", () => {
    // Band B: −0.03 of the 1920 px frame. Chromium drew it at −58 px and
    // Firefox at −57 px (CI run 45759165071).
    const [drawn] = roundedSlices([band(561.6, 54, -0.03 * 1920)])
    expect(drawn).toEqual(band(562, 54, -58))
    expect(landed(drawn.dx, 1)).toEqual({ chromium: -58, firefox: -58 })
  })

  it("rounds each edge rather than the size, so a band's end lands on a whole device px too", () => {
    // 10.4 to 30.6 is 10 to 31: 21 px, where rounding 20.2 on its own gives 20.
    expect(roundedSlices([band(10.4, 20.2, 5)])).toEqual([band(10, 21, 5)])
  })

  it('rounds to whole device px at a ratio of 2: a preview on a high-density screen', () => {
    expect(roundedSlices([band(10.2, 20.1, 1.91)], 2)).toEqual([band(10, 20.5, 2)])
    expect(roundedSlices([band(0, 10, 0.2)], 2)).toEqual([])
  })

  it('rounds to whole device px at a ratio of 1.25, where a whole CSS px would not be', () => {
    // Start 10 CSS px is 12.5 device px, rounded to 13: 10.4 px. End 30 CSS px
    // is 37.5, rounded to 38: 25 device px of size, 20 px. Shift 3 CSS px is
    // 3.75, rounded to 4: 3.2 px.
    expect(roundedSlices([band(10, 20, 3)], 1.25)).toEqual([band(10.4, 20, 3.2)])
  })

  it('lands every edge and shift on the same whole device px in both browsers, at ratios 1, 1.25 and 2', () => {
    for (const ratio of [1, 1.25, 2]) {
      for (let tenths = -300; tenths <= 300; tenths += 3) {
        const exact = tenths / 10
        const [drawn] = roundedSlices([band(Math.abs(exact), 40.3, exact)], ratio)
        const at = `${exact} px at ${ratio}`
        const shift = Math.sign(exact) * Math.round(Math.abs(exact) * ratio)
        const start = Math.round(Math.abs(exact) * ratio)
        if (shift === 0) {
          expect(drawn, at).toBeUndefined()
          continue
        }
        expect(landed(drawn.dx, ratio), at).toEqual({ chromium: shift, firefox: shift })
        expect(landed(drawn.start, ratio), at).toEqual({ chromium: start, firefox: start })
        const end = Math.round((Math.abs(exact) + 40.3) * ratio)
        expect(landed(drawn.size, ratio), at).toEqual({ chromium: end - start, firefox: end - start })
      }
    }
  })

  it('nudges a written number up where its 4-decimal form would fall short as a 32-bit float', () => {
    // 2 device px at 1.5 is 1.3333… px. Written as 1.3333, it reads as
    // 1.99995 device px, which Firefox would truncate to 1.
    expect(Math.trunc(Math.fround(Math.fround(1.3333) * Math.fround(1.5)))).toBe(1)
    const [drawn] = roundedSlices([band(2 / 1.5, 2 / 1.5, 2 / 1.5)], 1.5)
    expect(drawn).toEqual(band(1.3334, 1.3334, 1.3334))
    expect(landed(drawn.dx, 1.5)).toEqual({ chromium: 2, firefox: 2 })
    expect(landed(drawn.start, 1.5)).toEqual({ chromium: 2, firefox: 2 })
    expect(landed(drawn.size, 1.5)).toEqual({ chromium: 2, firefox: 2 })
  })
})

describe('slicesFilterUrl', () => {
  it('makes one filter per drawn band set, once, and references it by id', () => {
    const url = slicesFilterUrl(document, [band(10, 20, 5.76)])
    expect(url).toMatch(/^url\(#picture-slices-[0-9a-f]{8}\)$/)
    // A set that rounds to the same one reuses its filter.
    expect(slicesFilterUrl(document, [band(10.01, 19.99, 5.79)])).toBe(url)
    const svg = document.getElementById(SLICES_FILTERS_ID)!
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg')
    expect(svg.querySelectorAll('filter')).toHaveLength(1)
    expect(slicesFilterUrl(document, [band(10, 20, -5.8)])).not.toBe(url)
    expect(svg.querySelectorAll('filter')).toHaveLength(2)
    expect(document.querySelectorAll(`#${SLICES_FILTERS_ID}`)).toHaveLength(1)
  })

  it('is null when every band rounds to nothing, and makes no filter', () => {
    expect(slicesFilterUrl(document, [])).toBeNull()
    expect(slicesFilterUrl(document, [band(10, 20, 0.01), band(10, 0, 30)])).toBeNull()
    expect(document.getElementById(SLICES_FILTERS_ID)).toBeNull()
  })

  it('writes the bands in the px of the ratio they were rounded at', () => {
    // At 2 device px per px, 0.4 px of shift is a whole device px: 0.5 px.
    const filter = filterOf(slicesFilterUrl(document, [band(10.2, 20.1, 0.4)], 2))
    const offset = filter.querySelector('feOffset')!
    expect([offset.getAttribute('y'), offset.getAttribute('height'), offset.getAttribute('dx')]).toEqual([
      '10',
      '20.5',
      '0.5',
    ])
  })

  it('offsets the source in each band, cut to the band, and merges the bands over the source in order', () => {
    const filter = filterOf(slicesFilterUrl(document, [band(20, 40, 12), band(120, 30, 0, 'x', -20)]))
    expect(filter.getAttribute('color-interpolation-filters')).toBe('sRGB')
    expect(['x', 'y', 'width', 'height'].map((name) => filter.getAttribute(name))).toEqual(['0', '0', '100%', '100%'])
    const offsets = [...filter.querySelectorAll('feOffset')].map((offset) =>
      Object.fromEntries(
        ['in', 'dx', 'dy', 'x', 'y', 'width', 'height', 'result'].flatMap((name) =>
          offset.hasAttribute(name) ? [[name, offset.getAttribute(name)]] : [],
        ),
      ),
    )
    expect(offsets).toEqual([
      // A row band: only its rows are set, so it spans the region's width.
      { in: 'SourceGraphic', dx: '12', dy: '0', y: '20', height: '40', result: 'slice-0' },
      // A column band: only its columns.
      { in: 'SourceGraphic', dx: '0', dy: '-20', x: '120', width: '30', result: 'slice-1' },
    ])
    expect([...filter.querySelectorAll('feMerge > feMergeNode')].map((node) => node.getAttribute('in'))).toEqual([
      'SourceGraphic',
      'slice-0',
      'slice-1',
    ])
  })

  it('keeps the most recently used filters, up to the limit, and drops the oldest', () => {
    const first = slicesFilterUrl(document, [band(0, 10, 1)])
    const second = slicesFilterUrl(document, [band(0, 10, 2)])
    for (let index = 3; index <= SLICES_FILTER_LIMIT; index++) slicesFilterUrl(document, [band(0, 10, index)])
    const svg = document.getElementById(SLICES_FILTERS_ID)!
    expect(svg.childElementCount).toBe(SLICES_FILTER_LIMIT)
    // Using the first again makes the second the oldest.
    expect(slicesFilterUrl(document, [band(0, 10, 1)])).toBe(first)
    slicesFilterUrl(document, [band(0, 10, SLICES_FILTER_LIMIT + 1)])
    expect(svg.childElementCount).toBe(SLICES_FILTER_LIMIT)
    expect(filterOf(first)).toBeTruthy()
    expect(() => filterOf(second)).toThrow()
  })
})

describe('exportSlices', () => {
  it('puts each band on the card in canvas px, horizontal, its shift a share of the card width', () => {
    expect(exportSlices([{ top: 0.2, height: 0.1, shift: -0.05 }], { y: 10, width: 200, height: 100 })).toEqual([
      band(30, 10, -10),
    ])
  })
})

describe('bandsWithin', () => {
  // An overlay's outline (its letterboxed picture) inside its placed
  // rectangle: 100 px of picture with 50 px gutters above and below.
  const outline = { x: 10, y: 60, width: 200, height: 100 }
  const placed = { x: 10, y: 10, width: 200, height: 200 }
  const bands = [
    { top: 0.2, height: 0.1, shift: -0.05 },
    { top: 0.9, height: 0.3, shift: 0.1 },
  ]

  it('re-expresses an outline band as a share of the rectangle: the same rows and shift on the canvas', () => {
    expect(bandsWithin(bands, outline, placed)).toEqual([
      { top: 0.35, height: 0.05, shift: -0.05 },
      { top: 0.7, height: 0.15, shift: 0.1 },
    ])
    expect(exportSlices(bandsWithin(bands, outline, placed), placed)).toEqual(exportSlices(bands, outline))
  })

  it('scales the shift by the widths when the outline is narrower than the rectangle', () => {
    const narrow = { x: 60, y: 10, width: 100, height: 200 }
    expect(bandsWithin([{ top: 0.5, height: 0.25, shift: 0.2 }], narrow, placed)).toEqual([
      { top: 0.5, height: 0.25, shift: 0.1 },
    ])
  })

  it('leaves the bands as they are in a rectangle with no area', () => {
    expect(bandsWithin(bands, outline, { ...placed, height: 0 })).toEqual(bands)
  })
})

describe('previewSlices', () => {
  const frame = { frameWidth: 1000, frameHeight: 500 }
  const bands = [{ top: 0.2, height: 0.1, shift: 0.03 }]
  // As the filter draws them: the mapping's float noise rounded away.
  const drawn = (...args: Parameters<typeof previewSlices>) => roundedSlices(previewSlices(...args))

  it('is the frame band itself on an element that fills the frame', () => {
    expect(drawn(bands, { ...frame, zoom: IDENTITY_ZOOM })).toEqual([band(100, 50, 30)])
  })

  it('takes the band back through the zoom: rows nearer its centre, and band and shift divided by its scale', () => {
    expect(drawn(bands, { ...frame, zoom: { scale: 2, centerX: 0.5, centerY: 0.5 } })).toEqual([
      band(175, 25, 15),
    ])
    // Frame rows 0.2–0.3 show card rows 0.25 + (p − 0.5) / 2: 0.1–0.15.
    expect(drawn(bands, { ...frame, zoom: { scale: 2, centerX: 0.25, centerY: 0.25 } })).toEqual([
      band(50, 25, 15),
    ])
  })

  it('makes a column band with a vertical shift in a quarter-turned element', () => {
    // The element is the card transposed, 500 × 1000, turned 90° clockwise:
    // its column x lands on the frame's row x, and its −y on the screen's +x.
    expect(drawn(bands, { ...frame, zoom: IDENTITY_ZOOM, orientation: { rotation: 90 } })).toEqual([
      band(100, 50, 0, 'x', -30),
    ])
    // Turned the other way, the columns count from the other side.
    expect(drawn(bands, { ...frame, zoom: IDENTITY_ZOOM, orientation: { rotation: 270 } })).toEqual([
      band(350, 50, 0, 'x', 30),
    ])
  })

  it('mirrors the shift for a horizontal flip and the rows for a vertical one', () => {
    expect(drawn(bands, { ...frame, zoom: IDENTITY_ZOOM, orientation: { flipH: true } })).toEqual([
      band(100, 50, -30),
    ])
    expect(drawn(bands, { ...frame, zoom: IDENTITY_ZOOM, orientation: { flipV: true } })).toEqual([
      band(350, 50, 30),
    ])
    // A half turn does both.
    expect(drawn(bands, { ...frame, zoom: IDENTITY_ZOOM, orientation: { rotation: 180 } })).toEqual([
      band(350, 50, -30),
    ])
  })

  it("takes the band back through the crop's translate and scale", () => {
    // Element row e lands at 250 + 2·(e − 250) + 50 on the frame.
    expect(
      drawn(bands, { ...frame, zoom: IDENTITY_ZOOM, crop: { scale: 2, translateX: 0, translateY: 10 } }),
    ).toEqual([band(150, 25, 15)])
  })

  it('is empty until the frame is measured', () => {
    expect(previewSlices(bands, { frameWidth: 0, frameHeight: 0, zoom: IDENTITY_ZOOM })).toEqual([])
  })
})
