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
    expect(url).toBe('url(#picture-channel-offset-6-0)')
    // A shift that rounds to the same one reuses its filter.
    expect(channelOffsetFilterUrl(document, { dx: 6.4, dy: 0.01 })).toBe(url)
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
    expect(channelOffsetFilterUrl(document, { dx: 0.4, dy: -0.4 })).toBeNull()
    expect(document.getElementById(CHANNEL_OFFSET_FILTERS_ID)).toBeNull()
    expect(roundedChannelShift({ dx: -0.4, dy: 0.6 })).toEqual({ dx: 0, dy: 1 })
    // At 2 device px per px, half a px is a whole device px.
    expect(channelOffsetFilterUrl(document, { dx: 0.4, dy: 0 }, 2)).toBe('url(#picture-channel-offset-0_5-0)')
  })

  it('writes the shift in the px of the ratio it was rounded at', () => {
    channelOffsetFilterUrl(document, { dx: 1.91, dy: 0 }, 2)
    const filter = document.getElementById(channelOffsetFilterId({ dx: 2, dy: 0 }))!
    expect([...filter.querySelectorAll('feOffset')].map((offset) => offset.getAttribute('dx'))).toEqual(['-2', '2'])
  })
})

describe('roundedChannelShift: whole device px, which Chromium and Firefox draw alike (#980)', () => {
  /**
   * The device px a browser lands a written shift on: Chromium rounds,
   * Firefox truncates toward zero (CI run 45739047158: 3.8 px drawn as 4
   * and 3). The written value is read as a 32-bit float, as an SVG
   * attribute is, and multiplied by the ratio in 32 bits.
   */
  const landed = (px: number, ratio: number) => {
    const device = Math.fround(Math.fround(px) * Math.fround(ratio))
    return { chromium: Math.round(device), firefox: Math.trunc(device) }
  }

  it('rounds to whole canvas px at a ratio of 1: the export', () => {
    // VHS at Amount 100 on a 1920 px frame: 3.84 px, drawn as 4 in both.
    expect(roundedChannelShift({ dx: 3.84, dy: 0 })).toEqual({ dx: 4, dy: 0 })
    // channel-offset.spec.ts's saved frame: 0.03 of 1920 px is 57.6.
    expect(roundedChannelShift({ dx: 57.6, dy: 0 })).toEqual({ dx: 58, dy: 0 })
    expect(roundedChannelShift({ dx: -3.4, dy: 2.5 })).toEqual({ dx: -3, dy: 3 })
  })

  it('rounds to whole device px at a ratio of 2: a preview on a high-density screen', () => {
    // VHS in a 955 CSS px preview: 1.91 CSS px, 3.82 device px, drawn as 4.
    expect(roundedChannelShift({ dx: 1.91, dy: 0 }, 2)).toEqual({ dx: 2, dy: 0 })
    expect(roundedChannelShift({ dx: 1.7, dy: -0.3 }, 2)).toEqual({ dx: 1.5, dy: -0.5 })
  })

  it('rounds to whole device px at a ratio of 1.25, where a whole CSS px would not be', () => {
    // 3 CSS px is 3.75 device px, so it rounds to 4, which is 3.2 CSS px;
    // 2.3 CSS px is 2.875 device px, so it rounds to 3, which is 2.4.
    expect(roundedChannelShift({ dx: 3, dy: 0 }, 1.25)).toEqual({ dx: 3.2, dy: 0 })
    expect(roundedChannelShift({ dx: 2.3, dy: 0 }, 1.25)).toEqual({ dx: 2.4, dy: 0 })
  })

  it('lands every shift on the same whole device px in both browsers, at ratios 1, 1.25 and 2', () => {
    for (const ratio of [1, 1.25, 2]) {
      for (let tenths = -400; tenths <= 400; tenths++) {
        const exact = tenths / 10
        const { dx } = roundedChannelShift({ dx: exact, dy: 0 }, ratio)
        const whole = Math.sign(exact) * Math.round(Math.abs(exact) * ratio)
        const { chromium, firefox } = landed(dx, ratio)
        const at = `${exact} px at ${ratio}: written ${dx}`
        // Both browsers land the rounded whole device px...
        expect(chromium, at).toBe(whole === 0 ? 0 : whole)
        expect(firefox, at).toBe(whole === 0 ? 0 : whole)
        // ...which is within half a device px of the exact shift.
        expect(Math.abs(whole - exact * ratio), at).toBeLessThanOrEqual(0.5 + 1e-9)
      }
    }
  })

  it('nudges a written shift up where it would fall short of the whole device px', () => {
    // 1.3 px at 1.5 is 1.95 device px, which rounds to 2: 1.3333… px. Written
    // to 4 decimals, 1.3333 is 1.99995 device px, which Firefox would
    // truncate to 1. The ratios 1.5, 1.75 and 2.25 all have such cases.
    expect(Math.trunc(Math.fround(Math.fround(1.3333) * Math.fround(1.5)))).toBe(1)
    const { dx } = roundedChannelShift({ dx: 1.3, dy: 0 }, 1.5)
    expect(dx).toBe(1.3334)
    expect(landed(dx, 1.5)).toEqual({ chromium: 2, firefox: 2 })
    for (const ratio of [1.5, 1.75, 2.25, 3]) {
      for (let whole = 1; whole <= 200; whole++) {
        const written = roundedChannelShift({ dx: -whole / ratio, dy: 0 }, ratio).dx
        expect(landed(written, ratio), `${whole} device px at ${ratio}`).toEqual({ chromium: -whole, firefox: -whole })
      }
    }
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
