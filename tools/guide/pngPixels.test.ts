import { readFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { comparePixels, decodePng, isRasterNoise } from './pngPixels.ts'

/** A tiny RGBA PNG encoder for the tests: one IDAT, the given filter on every row. */
function encodePng(width: number, height: number, rgba: Uint8Array, filter: 0 | 1 | 2 | 3 | 4): Uint8Array {
  const stride = width * 4
  const raw = new Uint8Array(height * (stride + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = filter
    for (let i = 0; i < stride; i++) {
      const value = rgba[y * stride + i]
      const a = i >= 4 ? rgba[y * stride + i - 4] : 0
      const b = y > 0 ? rgba[(y - 1) * stride + i] : 0
      const c = y > 0 && i >= 4 ? rgba[(y - 1) * stride + i - 4] : 0
      let predictor = 0
      if (filter === 1) predictor = a
      else if (filter === 2) predictor = b
      else if (filter === 3) predictor = (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      raw[y * (stride + 1) + 1 + i] = (value - predictor) & 0xff
    }
  }
  const chunk = (type: string, body: Uint8Array) => {
    const out = new Uint8Array(12 + body.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, body.length)
    out.set(Array.from(type, (ch) => ch.charCodeAt(0)), 4)
    out.set(body, 8)
    view.setUint32(8 + body.length, 0) // CRC unchecked by the decoder
    return out
  }
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  ihdr.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ])
}

const gradient = (width: number, height: number): Uint8Array => {
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      rgba[i] = (x * 37) & 0xff
      rgba[i + 1] = (y * 91) & 0xff
      rgba[i + 2] = (x * y) & 0xff
      rgba[i + 3] = 255
    }
  return rgba
}

describe('pngPixels (#483)', () => {
  it('decodes every filter type back to the pixels that were encoded', () => {
    const rgba = gradient(7, 5)
    for (const filter of [0, 1, 2, 3, 4] as const) {
      const decoded = decodePng(encodePng(7, 5, rgba, filter))
      expect(decoded.width).toBe(7)
      expect(decoded.height).toBe(5)
      expect(Array.from(decoded.data), `filter ${filter}`).toEqual(Array.from(rgba))
    }
  })

  it('decodes a screenshot Chromium wrote, at its declared size', () => {
    const decoded = decodePng(readFileSync('docs/guide/images/transition-added.png'))
    expect(decoded.width).toBeGreaterThan(1000)
    expect(decoded.data.length).toBe(decoded.width * decoded.height * 4)
  })

  it('tells rasterizer noise from a change', () => {
    const a = decodePng(encodePng(40, 40, gradient(40, 40), 4))
    const same = comparePixels(a, a)
    expect(same).toEqual({ count: 0, maxDelta: 0 })
    expect(isRasterNoise(same, 1600)).toBe(true)

    const noisy = { ...a, data: Uint8Array.from(a.data) }
    noisy.data[0] += 1 // one pixel, one shade
    expect(isRasterNoise(comparePixels(a, noisy), 1600, { maxDelta: 2, maxFraction: 0.001 })).toBe(true)

    const moved = { ...a, data: Uint8Array.from(a.data) }
    for (let i = 0; i < 40 * 4; i += 4) moved.data[i] = 0 // a whole row changed
    expect(isRasterNoise(comparePixels(a, moved), 1600, { maxDelta: 2, maxFraction: 0.001 })).toBe(false)

    const shifted = { ...a, data: Uint8Array.from(a.data) }
    shifted.data[0] += 40 // one pixel, a real colour change
    expect(isRasterNoise(comparePixels(a, shifted), 1600)).toBe(false)

    expect(comparePixels(a, { width: 41, height: 40, data: new Uint8Array(41 * 40 * 4) })).toBeNull()
    expect(isRasterNoise(null, 1600)).toBe(false)
  })
})
