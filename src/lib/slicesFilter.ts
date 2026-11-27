import { deviceRounded, usableRatio, wholeDevicePx } from './devicePixels'
import { orientationTransform } from './orientation'
import type { Orientation } from './orientation'
import type { SliceBand } from './pictureEffect'
import type { ZoomState } from './zoom'

/**
 * The SVG `<filter>` behind a `slices` picture filter (#871, step 2b(i)):
 * bands of the picture moved sideways, the tear of a glitch. Neither CSS
 * nor the canvas has a filter function that moves one band of rows, so
 * both renderers reference one SVG filter by `url(#id)`, as the channel
 * offset does (`channelOffsetFilter.ts`): the preview from the media
 * element's CSS `filter`, the export from `ctx.filter`.
 *
 * The filter is the one #871's measurement took (dispatched run
 * 45753972764): an `feOffset` of `SourceGraphic` per band, cut to the band
 * by a primitive subregion, merged over the source. It drew every band's
 * edge to the pixel alike in CSS and in a canvas, in Chromium and in
 * Firefox, in the filtered box's own pixels. An opaque picture's band
 * covers the source it is merged over, so the band reads as moved; only
 * at the box's edge, where nothing moved in, does the source show
 * through, rather than a hole.
 *
 * A filter's bands are fixed in its markup, so each distinct set is its
 * own `<filter>`, made on first use and kept in one hidden `<svg>`. Every
 * band's edges and shift are rounded to whole pixels of the surface it is
 * drawn on (#1021, as #980 did for the channel offset; `devicePixels.ts`):
 * canvas px for the export, device px for the preview. Chromium rounds a
 * fractional shift and Firefox truncates it, so a band shifted −57.6 px
 * landed at −58 px in one and −57 px in the other (CI run 45759165071). A
 * zoom animating the preview's mapping can still make a new set each
 * frame, so the `<svg>` keeps the `SLICES_FILTER_LIMIT` most recently used
 * and drops the oldest.
 */

/** How many filters the hidden `<svg>` keeps, the most recently used. */
export const SLICES_FILTER_LIMIT = 256

/** The id of the hidden `<svg>` that holds the filters. */
export const SLICES_FILTERS_ID = 'picture-slices-filters'

/**
 * One band as its filter draws it, in the filtered box's own px. A `y`
 * band spans rows `start` to `start + size` across the whole box; an `x`
 * band spans columns, which is what a horizontal band on the screen
 * becomes in a quarter-turned element. The band's content moves by
 * (`dx`, `dy`).
 */
export interface DrawnSlice {
  axis: 'x' | 'y'
  start: number
  size: number
  dx: number
  dy: number
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * The slices as their filter draws them, at `ratio` device px per px of
 * the filtered box: 1 for the export's canvas, `devicePixelRatio` for the
 * preview's element. Each band's two edges are rounded to whole device px,
 * so its size is the whole device px between them rather than a size
 * rounded on its own, and its shift is rounded the same way. A slice that
 * rounds to no size or no shift is dropped, since it draws the picture
 * unchanged.
 */
export function roundedSlices(slices: readonly DrawnSlice[], ratio = 1): DrawnSlice[] {
  const scale = usableRatio(ratio)
  return slices.flatMap((slice) => {
    const start = wholeDevicePx(slice.start, scale)
    const size = wholeDevicePx(slice.start + slice.size, scale) - start
    const drawn = {
      axis: slice.axis,
      start: deviceRounded(start / scale, scale),
      size: deviceRounded(size / scale, scale),
      dx: deviceRounded(slice.dx, scale),
      dy: deviceRounded(slice.dy, scale),
    }
    return drawn.size > 0 && (drawn.dx !== 0 || drawn.dy !== 0) ? [drawn] : []
  })
}

/** The slices, already rounded, as one string: the filter's identity. */
function slicesKey(slices: readonly DrawnSlice[]): string {
  return slices.map((slice) => `${slice.axis}${slice.start},${slice.size},${slice.dx},${slice.dy}`).join(';')
}

/** FNV-1a over the key, as eight hex digits: a short id that `url(#…)` takes as it is. */
function hashed(key: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < key.length; index++) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * The filter's primitives: each slice's `feOffset` of the source, its
 * subregion the band in user-space px, then the source and every slice
 * merged in order, so a later band lies over an earlier one where they
 * cross. A `y` band sets only `y` and `height` and an `x` band only `x`
 * and `width`, the shape the measurement took, so the band reaches the
 * filter region's full extent along its length. `sRGB` keeps the merge in
 * the picture's own colour space, as the channel offset's filter does.
 */
function buildFilter(doc: Document, id: string, key: string, slices: readonly DrawnSlice[]): SVGFilterElement {
  const filter = doc.createElementNS(SVG_NS, 'filter')
  const set = (element: Element, attributes: Record<string, string>) => {
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value)
    return element
  }
  set(filter, {
    id,
    'data-slices': key,
    x: '0',
    y: '0',
    width: '100%',
    height: '100%',
    'color-interpolation-filters': 'sRGB',
  })
  slices.forEach((slice, index) => {
    const region: Record<string, string> =
      slice.axis === 'y'
        ? { y: String(slice.start), height: String(slice.size) }
        : { x: String(slice.start), width: String(slice.size) }
    filter.appendChild(
      set(doc.createElementNS(SVG_NS, 'feOffset'), {
        in: 'SourceGraphic',
        dx: String(slice.dx),
        dy: String(slice.dy),
        ...region,
        result: `slice-${index}`,
      }),
    )
  })
  const merge = filter.appendChild(doc.createElementNS(SVG_NS, 'feMerge'))
  for (const input of ['SourceGraphic', ...slices.map((_, index) => `slice-${index}`)]) {
    merge.appendChild(set(doc.createElementNS(SVG_NS, 'feMergeNode'), { in: input }))
  }
  return filter as SVGFilterElement
}

/** The hidden `<svg>` that holds the filters, made on first use. */
function filtersSvg(doc: Document): Element {
  const existing = doc.getElementById(SLICES_FILTERS_ID)
  if (existing !== null) return existing
  const made = doc.createElementNS(SVG_NS, 'svg')
  made.setAttribute('id', SLICES_FILTERS_ID)
  made.setAttribute('width', '0')
  made.setAttribute('height', '0')
  made.setAttribute('aria-hidden', 'true')
  made.setAttribute('style', 'position: absolute; width: 0; height: 0; overflow: hidden')
  doc.body.appendChild(made)
  return made
}

/**
 * The `url(#id)` filter function for `slices`, in the filtered box's own
 * px, making its `<filter>` in `doc` first when it is not there yet.
 * `ratio` is the device px per px of the filtered box (`roundedSlices`).
 * Null when every slice rounds to nothing, which draws the picture
 * unchanged, so a caller adds no function at all.
 *
 * A filter used again moves to the end of the `<svg>`, and a new one past
 * `SLICES_FILTER_LIMIT` drops the first, the least recently used. Every
 * render that draws a filter asks for it here, so a filter in use is never
 * the oldest.
 */
export function slicesFilterUrl(doc: Document, slices: readonly DrawnSlice[], ratio = 1): string | null {
  const drawn = roundedSlices(slices, ratio)
  if (drawn.length === 0) return null
  const key = slicesKey(drawn)
  const svg = filtersSvg(doc)
  // Ids come from a hash, so a collision takes the next free suffix.
  let id = `picture-slices-${hashed(key)}`
  for (let suffix = 1; ; suffix++) {
    const existing = doc.getElementById(id)
    if (existing === null) break
    if (existing.getAttribute('data-slices') === key) {
      if (existing !== svg.lastElementChild) svg.appendChild(existing)
      return `url(#${id})`
    }
    id = `picture-slices-${hashed(key)}-${suffix}`
  }
  svg.appendChild(buildFilter(doc, id, key, drawn))
  while (svg.childElementCount > SLICES_FILTER_LIMIT) svg.firstElementChild?.remove()
  return `url(#${id})`
}

/**
 * The bands in canvas px, for the export: the canvas filters what was
 * drawn, after the draw's own transform, so a band is horizontal on the
 * frame whatever the source's orientation. `card` is the frame-shaped
 * card after the transition's scale and offset, where the preview's card
 * lies once its transform applies: a band's rows are a share of its
 * height from its top, and its shift a share of its width.
 */
export function exportSlices(
  bands: readonly SliceBand[],
  card: { y: number; width: number; height: number },
): DrawnSlice[] {
  return bands.map((band) => ({
    axis: 'y',
    start: card.y + band.top * card.height,
    size: band.height * card.height,
    dx: band.shift * card.width,
    dy: 0,
  }))
}

/**
 * Bands given as shares of `rect` re-expressed as shares of `box`, which
 * contains it (#872): an overlay's bands are a share of its outline, the
 * export's card, while the preview's media element fills the placed
 * rectangle around it, which `previewSlices` takes as its frame. A band's
 * rows move down by the outline's offset in the rectangle and shrink by
 * the two heights' ratio, and its shift by the two widths'. The same
 * rows and the same shift on the screen, so the preview's bands land where
 * the export's do. A `box` with no area leaves the bands as they are.
 */
export function bandsWithin(
  bands: readonly SliceBand[],
  rect: { x: number; y: number; width: number; height: number },
  box: { x: number; y: number; width: number; height: number },
): SliceBand[] {
  if (!(box.width > 0 && box.height > 0)) return [...bands]
  const rows = rect.height / box.height
  const offset = (rect.y - box.y) / box.height
  const columns = rect.width / box.width
  return bands.map((band) => ({
    top: offset + band.top * rows,
    height: band.height * rows,
    shift: band.shift * columns,
  }))
}

/**
 * What the preview's mapping needs about the filtered element. The frame
 * is the card's own box in CSS px. The element sits centred in it, the
 * card's size or, under a quarter turn, its transposed size, and its own
 * transform is the orientation's rotation and flips, then the crop's
 * translate (in % of the element's box) and scale innermost
 * (`croppedOrientedMediaStyle`), all about its centre. The card's
 * transform is the zoom, which maps a frame fraction p to
 * 0.5 + scale·(p − centre), then the transition's, which the export's
 * card already includes.
 */
export interface PreviewSliceGeometry {
  frameWidth: number
  frameHeight: number
  zoom: ZoomState
  orientation?: Orientation
  crop?: { scale: number; translateX: number; translateY: number }
}

/**
 * The bands in the preview's media element's own px. The preview filters
 * the element before its own transform and the card's zoom, so each band
 * is taken back from the frame through the zoom, then through the
 * orientation and the crop: a quarter turn makes it an `x` band whose
 * shift is a `dy`, a flip mirrors it, and the zoom's and the crop's scales
 * shrink it, as they magnify it again on the screen. Empty until the frame
 * is measured.
 */
export function previewSlices(bands: readonly SliceBand[], geometry: PreviewSliceGeometry): DrawnSlice[] {
  const { frameWidth: width, frameHeight: height, zoom } = geometry
  if (!(width > 0 && height > 0) || !(zoom.scale > 0)) return []
  const { rotation, scaleX, scaleY } = orientationTransform(geometry.orientation)
  const radians = (rotation * Math.PI) / 180
  const cos = Math.round(Math.cos(radians))
  const sin = Math.round(Math.sin(radians))
  const turned = sin !== 0
  const elementWidth = turned ? height : width
  const elementHeight = turned ? width : height
  const cropScale = geometry.crop !== undefined && geometry.crop.scale > 0 ? geometry.crop.scale : 1
  const cropX = ((geometry.crop?.translateX ?? 0) / 100) * elementWidth
  const cropY = ((geometry.crop?.translateY ?? 0) / 100) * elementHeight
  // A vector on the card, turned back through rotate(θ), then the flip
  // (its own inverse): the element's axes before the crop's scale.
  const turnedBack = (vx: number, vy: number) => ({
    x: scaleX * (cos * vx + sin * vy),
    y: scaleY * (-sin * vx + cos * vy),
  })
  // A point on the card, as an offset from the card's centre, into the
  // element's own px: less the crop's translate, unscaled, from its centre.
  const toElementPoint = (vx: number, vy: number) => {
    const back = turnedBack(vx, vy)
    return {
      x: elementWidth / 2 + (back.x - cropX) / cropScale,
      y: elementHeight / 2 + (back.y - cropY) / cropScale,
    }
  }
  // A frame row y, in px, on the card before the zoom: the inverse of
  // p ↦ 0.5 + scale·(q − centre), as an offset from the card's centre.
  const cardRow = (y: number) => (zoom.centerY + (y / height - 0.5) / zoom.scale - 0.5) * height
  return bands.map((band) => {
    const from = toElementPoint(0, cardRow(band.top * height))
    const to = toElementPoint(0, cardRow((band.top + band.height) * height))
    const turnedShift = turnedBack((band.shift * width) / zoom.scale, 0)
    const shift = { x: turnedShift.x / cropScale, y: turnedShift.y / cropScale }
    const [a, b] = turned ? [from.x, to.x] : [from.y, to.y]
    return {
      axis: turned ? 'x' : 'y',
      start: Math.min(a, b),
      size: Math.abs(b - a),
      dx: shift.x === 0 ? 0 : shift.x,
      dy: shift.y === 0 ? 0 : shift.y,
    }
  })
}
