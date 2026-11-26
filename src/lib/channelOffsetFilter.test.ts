import { afterEach, describe, expect, it } from 'vitest'
import {
  CHANNEL_OFFSET_FILTERS_ID,
  channelOffsetFilterId,
  channelOffsetFilterUrl,
  previewChannelShift,
  roundedChannelShift,
} from './channelOffsetFilter'

/**
 * The SVG filter behind a channel offset (#870, step 2b(ii)2): one
 * `<filter>` per drawn shift, made once, holding the primitives #870's
 * measurement took; and the preview's shift turned back through the media
 * element's own transform, so it lands horizontal on the screen as the
 * export's does.
 */

afterEach(() => {
  document.getElementById(CHANNEL_OFFSET_FILTERS_ID)?.remove()
})

describe('channelOffsetFilterUrl', () => {
  it('makes one filter per drawn shift, once, and references it by id', () => {
    const url = channelOffsetFilterUrl(document, { dx: 5.76, dy: 0 })
    expect(url).toBe('url(#picture-channel-offset-5_8-0)')
    // A shift that rounds to the same one reuses its filter.
    expect(channelOffsetFilterUrl(document, { dx: 5.79, dy: 0.01 })).toBe(url)
    const svg = document.getElementById(CHANNEL_OFFSET_FILTERS_ID)!
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg')
    expect(svg.querySelectorAll('filter')).toHaveLength(1)
    expect(channelOffsetFilterUrl(document, { dx: 0, dy: -3 })).toBe('url(#picture-channel-offset-0-m3)')
    expect(svg.querySelectorAll('filter')).toHaveLength(2)
    expect(document.querySelectorAll(`#${CHANNEL_OFFSET_FILTERS_ID}`)).toHaveLength(1)
  })

  it('moves red against the shift and blue with it, keeps green, and screens them in sRGB', () => {
    channelOffsetFilterUrl(document, { dx: 6, dy: -2 })
    const filter = document.getElementById(channelOffsetFilterId({ dx: 6, dy: -2 }))!
    expect(filter.getAttribute('color-interpolation-filters')).toBe('sRGB')
    expect([filter.getAttribute('x'), filter.getAttribute('width')]).toEqual(['0', '100%'])
    const offsets = [...filter.querySelectorAll('feOffset')].map((offset) => [
      offset.getAttribute('in'),
      offset.getAttribute('dx'),
      offset.getAttribute('dy'),
    ])
    expect(offsets).toEqual([
      ['red', '-6', '2'],
      ['blue', '6', '-2'],
    ])
    const matrices = [...filter.querySelectorAll('feColorMatrix')].map((matrix) => [
      matrix.getAttribute('result'),
      matrix.getAttribute('values'),
    ])
    expect(matrices).toEqual([
      ['red', '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0'],
      ['green', '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0'],
      ['blue', '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0'],
    ])
    expect([...filter.querySelectorAll('feBlend')].map((blend) => blend.getAttribute('mode'))).toEqual([
      'screen',
      'screen',
    ])
  })

  it('draws nothing for a shift that rounds to none', () => {
    expect(channelOffsetFilterUrl(document, { dx: 0.04, dy: -0.04 })).toBeNull()
    expect(document.getElementById(CHANNEL_OFFSET_FILTERS_ID)).toBeNull()
    expect(roundedChannelShift({ dx: -0.04, dy: 0.26 })).toEqual({ dx: 0, dy: 0.3 })
  })
})

describe('previewChannelShift', () => {
  it('is the screen shift itself for an element as shot, divided by a crop scale', () => {
    expect(previewChannelShift(6, undefined)).toEqual({ dx: 6, dy: 0 })
    expect(previewChannelShift(6, { rotation: 180 })).toEqual({ dx: -6, dy: 0 })
    expect(previewChannelShift(6, undefined, 2)).toEqual({ dx: 3, dy: 0 })
  })

  it('turns a quarter turn back, so the shift lands horizontal on the screen', () => {
    // rotate(90deg) takes (0, -6) in the element to (6, 0) on the screen.
    expect(previewChannelShift(6, { rotation: 90 })).toEqual({ dx: 0, dy: -6 })
    expect(previewChannelShift(6, { rotation: 270 })).toEqual({ dx: 0, dy: 6 })
  })

  it('mirrors the shift through a flip, which the element applies before its rotation', () => {
    expect(previewChannelShift(6, { flipH: true })).toEqual({ dx: -6, dy: 0 })
    expect(previewChannelShift(6, { flipV: true })).toEqual({ dx: 6, dy: 0 })
    // rotate(90deg) scale(1, -1) takes (0, 6) to (6, 0).
    expect(previewChannelShift(6, { rotation: 90, flipV: true })).toEqual({ dx: 0, dy: 6 })
  })
})
