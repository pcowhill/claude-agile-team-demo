import { deviceRounded, usableRatio } from './devicePixels'
import { orientationTransform } from './orientation'
import type { Orientation } from './orientation'

/**
 * The SVG `<filter>` behind a `channel-offset` picture filter (#870, step
 * 2b(ii)2). Neither CSS nor the canvas has a filter function that moves one
 * colour channel, so both renderers reference one SVG filter by
 * `url(#id)`: the preview from the media element's CSS `filter`, the
 * export from `ctx.filter`. #870's measurement (dispatched run 45720323678)
 * found that filter drawing to the pixel alike in CSS and in a canvas, in
 * Chromium and in Firefox, in the element's own pixels: CSS px for an
 * element, canvas px for a canvas.
 *
 * A filter's shift is fixed in its markup, so each distinct shift is its
 * own `<filter>`, made on first use and kept in one hidden `<svg>` in the
 * document. Each shift is rounded to whole pixels of the surface it is
 * drawn on (#980, `devicePixels.ts`): canvas px for the export, device px
 * for the preview. The browsers land a fractional shift differently, which
 * made a VHS fringe a quarter narrower in Firefox; a whole number of device
 * px is drawn alike by both. That rounding also bounds how many filters a
 * zoom animating the preview's scale can make.
 */

/** The id of the hidden `<svg>` that holds the filters. */
export const CHANNEL_OFFSET_FILTERS_ID = 'picture-channel-offset-filters'

/**
 * A shift in the filtered element's own pixels: red moves by
 * (−dx, −dy), blue by (+dx, +dy), green stays.
 */
export interface ChannelShift {
  dx: number
  dy: number
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * The shift as its filter draws it: each component rounded to whole
 * device pixels, at `ratio` device px per px of the filtered element. The
 * ratio is 1 for the export's canvas, and `devicePixelRatio` for the
 * preview's element, whose filter is drawn in its own CSS px at the
 * screen's density.
 */
export function roundedChannelShift(shift: ChannelShift, ratio = 1): ChannelShift {
  const scale = usableRatio(ratio)
  return { dx: deviceRounded(shift.dx, scale), dy: deviceRounded(shift.dy, scale) }
}

/**
 * The filter's id for a shift, already rounded: one id per drawn shift,
 * made of characters an id and `url(#…)` both take as they are.
 */
export function channelOffsetFilterId(shift: ChannelShift): string {
  const part = (value: number) => `${value < 0 ? 'm' : ''}${String(Math.abs(value)).replace('.', '_')}`
  return `picture-channel-offset-${part(shift.dx)}-${part(shift.dy)}`
}

/** One channel of the source, the other two zeroed, alpha kept. */
function channelMatrix(channel: 0 | 1 | 2): string {
  const rows = [0, 1, 2].map((row) => [0, 1, 2, 3, 4].map((column) => (row === channel && column === row ? 1 : 0)))
  return [...rows, [0, 0, 0, 1, 0]].map((row) => row.join(' ')).join('  ')
}

/**
 * The filter's primitives, as #870's measurement took them: red and blue
 * isolated and moved, green isolated in place, the three screened back
 * together. `color-interpolation-filters="sRGB"` keeps the screen in the
 * picture's own colour space; without it the blend would happen in
 * linearRGB, which the measurement did not take. The region is the
 * filtered box itself, so nothing shifted spills out past it.
 */
function buildFilter(doc: Document, id: string, shift: ChannelShift): SVGFilterElement {
  const filter = doc.createElementNS(SVG_NS, 'filter')
  const set = (element: Element, attributes: Record<string, string>) => {
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value)
    return element
  }
  set(filter, { id, x: '0', y: '0', width: '100%', height: '100%', 'color-interpolation-filters': 'sRGB' })
  const primitive = (name: string, attributes: Record<string, string>) =>
    filter.appendChild(set(doc.createElementNS(SVG_NS, name), attributes))
  primitive('feColorMatrix', { in: 'SourceGraphic', type: 'matrix', values: channelMatrix(0), result: 'red' })
  primitive('feOffset', { in: 'red', dx: String(-shift.dx), dy: String(-shift.dy), result: 'red-moved' })
  primitive('feColorMatrix', { in: 'SourceGraphic', type: 'matrix', values: channelMatrix(1), result: 'green' })
  primitive('feColorMatrix', { in: 'SourceGraphic', type: 'matrix', values: channelMatrix(2), result: 'blue' })
  primitive('feOffset', { in: 'blue', dx: String(shift.dx), dy: String(shift.dy), result: 'blue-moved' })
  primitive('feBlend', { in: 'red-moved', in2: 'green', mode: 'screen', result: 'red-green' })
  primitive('feBlend', { in: 'red-green', in2: 'blue-moved', mode: 'screen' })
  return filter as SVGFilterElement
}

/**
 * The `url(#id)` filter function for `shift`, making its `<filter>` in
 * `doc` first when it is not there yet. `ratio` is the device px per px of
 * the filtered element (`roundedChannelShift`). Null for a shift that
 * rounds to nothing, which draws as the picture unchanged, so a caller
 * adds no function at all. The `<svg>` is sized to nothing and positioned
 * out of the flow rather than hidden with `display: none`, the shape
 * #870's measurement took.
 */
export function channelOffsetFilterUrl(doc: Document, shift: ChannelShift, ratio = 1): string | null {
  const drawn = roundedChannelShift(shift, ratio)
  if (drawn.dx === 0 && drawn.dy === 0) return null
  const id = channelOffsetFilterId(drawn)
  if (doc.getElementById(id) === null) {
    let svg: Element | null = doc.getElementById(CHANNEL_OFFSET_FILTERS_ID)
    if (svg === null) {
      const made = doc.createElementNS(SVG_NS, 'svg')
      made.setAttribute('id', CHANNEL_OFFSET_FILTERS_ID)
      made.setAttribute('width', '0')
      made.setAttribute('height', '0')
      made.setAttribute('aria-hidden', 'true')
      made.setAttribute('style', 'position: absolute; width: 0; height: 0; overflow: hidden')
      doc.body.appendChild(made)
      svg = made
    }
    svg.appendChild(buildFilter(doc, id, drawn))
  }
  return `url(#${id})`
}

/**
 * The shift, in the preview's media element's own pixels, that lands as
 * `screenPx` to the right on the screen (#870). The preview filters the
 * element before its own transform, which is the orientation's rotation
 * and flips, then the crop's scale innermost (`croppedOrientedMediaStyle`),
 * so the screen's horizontal shift is turned back through all three: a
 * quarter turn makes it vertical in the element, a flip mirrors it, and a
 * crop's scale, which magnifies it, divides it. The export filters the
 * canvas after the source is drawn, so its shift is horizontal as it is.
 */
export function previewChannelShift(
  screenPx: number,
  orientation: Orientation | undefined,
  cropScale = 1,
): ChannelShift {
  const { rotation, scaleX, scaleY } = orientationTransform(orientation)
  const radians = (rotation * Math.PI) / 180
  const scale = cropScale > 0 ? cropScale : 1
  // The inverse of rotate(θ) on (screenPx, 0), then the flip, which is its own inverse.
  const dx = (scaleX * screenPx * Math.round(Math.cos(radians))) / scale
  const dy = (scaleY * -screenPx * Math.round(Math.sin(radians))) / scale
  return { dx: dx === 0 ? 0 : dx, dy: dy === 0 ? 0 : dy }
}
