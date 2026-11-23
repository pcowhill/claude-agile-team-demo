import { describe, expect, it } from 'vitest'
import { muxAnimatedWebp, webpFrameData } from './webpMux'

/**
 * The animated-WebP muxer (#858), on hand-built stills. The bitstream
 * payloads are opaque bytes here: the muxer only moves chunks, and the e2e
 * spec decodes real browser-encoded output. What these tests pin is the
 * container: the chunk layout, every size field, the padding rule, and the
 * fields the WebP container specification gives fixed positions.
 */

const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0))
const u32 = (value: number) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff]
const u24At = (bytes: Uint8Array, offset: number) =>
  bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
const u32At = (bytes: Uint8Array, offset: number) => u24At(bytes, offset) + bytes[offset + 3] * 2 ** 24
const fourCCAt = (bytes: Uint8Array, offset: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + 4))

/** A chunk: id, size, payload, and the pad byte an odd payload needs (unless `omitPad`). */
function chunk(id: string, payload: number[], omitPad = false): number[] {
  const pad = payload.length % 2 === 1 && !omitPad ? [0] : []
  return [...ascii(id), ...u32(payload.length), ...payload, ...pad]
}

/** A RIFF WEBP file around the given chunks. */
function riff(...chunks: number[][]): Uint8Array {
  const body = chunks.flat()
  return Uint8Array.from([...ascii('RIFF'), ...u32(4 + body.length), ...ascii('WEBP'), ...body])
}

/** Walks a RIFF body's top-level chunks: id, payload offset and size. */
function topChunks(file: Uint8Array): { id: string; offset: number; size: number }[] {
  const found: { id: string; offset: number; size: number }[] = []
  let offset = 12
  while (offset + 8 <= file.length) {
    const size = u32At(file, offset + 4)
    found.push({ id: fourCCAt(file, offset), offset: offset + 8, size })
    offset += 8 + size + (size % 2)
  }
  expect(offset).toBe(file.length)
  return found
}

describe('webpFrameData (#858)', () => {
  it('takes a simple lossy still\'s VP8 chunk whole', () => {
    const vp8 = chunk('VP8 ', [1, 2, 3, 4, 5, 6])
    const data = webpFrameData(riff(vp8))
    expect(Array.from(data.chunks)).toEqual(vp8)
    expect(data.hasAlpha).toBe(false)
  })

  it('keeps ALPH and the bitstream of an extended still, dropping the file-level chunks', () => {
    const vp8x = chunk('VP8X', [0x10, 0, 0, 0, 1, 0, 0, 1, 0, 0])
    const iccp = chunk('ICCP', [9, 9])
    const alph = chunk('ALPH', [7, 7, 7])
    const vp8 = chunk('VP8 ', [1, 2, 3, 4])
    const exif = chunk('EXIF', [8])
    const data = webpFrameData(riff(vp8x, iccp, alph, vp8, exif))
    expect(Array.from(data.chunks)).toEqual([...alph, ...vp8])
    expect(data.hasAlpha).toBe(true)
  })

  it('reads a lossless still\'s alpha_is_used bit', () => {
    // 0x2f, then 32 bits: width − 1 (14), height − 1 (14), alpha (1), version (3).
    const header = (alpha: boolean) => [0x2f, ...u32((alpha ? 1 : 0) << 28), 0xaa]
    expect(webpFrameData(riff(chunk('VP8L', header(true)))).hasAlpha).toBe(true)
    expect(webpFrameData(riff(chunk('VP8L', header(false)))).hasAlpha).toBe(false)
  })

  it('pads a final odd chunk whose file omitted the pad byte', () => {
    const data = webpFrameData(riff(chunk('VP8 ', [1, 2, 3], true)))
    expect(Array.from(data.chunks)).toEqual(chunk('VP8 ', [1, 2, 3]))
  })

  it('refuses what is not a still WebP — a PNG a browser fell back to, or an animation', () => {
    const png = Uint8Array.from([0x89, ...ascii('PNG'), 13, 10, 26, 10, ...new Array(24).fill(0)])
    expect(() => webpFrameData(png)).toThrow('did not encode the frame as WebP')
    expect(() => webpFrameData(riff(chunk('ANIM', [0, 0, 0, 0, 0, 0])))).toThrow('already animated')
    expect(() => webpFrameData(riff(chunk('EXIF', [1, 2])))).toThrow('no image data')
  })
})

describe('muxAnimatedWebp (#858)', () => {
  const still = (payload: number[]) => webpFrameData(riff(chunk('VP8 ', payload)))

  it('writes VP8X, ANIM and one ANMF per frame, with every size field consistent', () => {
    const frames = [
      { data: still([1, 2, 3, 4]), durationMs: 100 },
      { data: still([5, 6, 7]), durationMs: 250 },
    ]
    const file = muxAnimatedWebp(480, 270, frames)
    expect(fourCCAt(file, 0)).toBe('RIFF')
    expect(u32At(file, 4)).toBe(file.length - 8)
    expect(fourCCAt(file, 8)).toBe('WEBP')
    const chunks = topChunks(file)
    expect(chunks.map((entry) => entry.id)).toEqual(['VP8X', 'ANIM', 'ANMF', 'ANMF'])

    const [vp8x, anim, ...anmfs] = chunks
    expect(vp8x.size).toBe(10)
    expect(file[vp8x.offset]).toBe(0x02) // animation, no alpha
    expect(u24At(file, vp8x.offset + 4)).toBe(479)
    expect(u24At(file, vp8x.offset + 7)).toBe(269)

    expect(anim.size).toBe(6)
    // Opaque black background (B, G, R, A), loop forever.
    expect(Array.from(file.subarray(anim.offset, anim.offset + 6))).toEqual([0, 0, 0, 0xff, 0, 0])

    anmfs.forEach((anmf, index) => {
      const at = anmf.offset
      expect(u24At(file, at), 'x / 2').toBe(0)
      expect(u24At(file, at + 3), 'y / 2').toBe(0)
      expect(u24At(file, at + 6), 'width − 1').toBe(479)
      expect(u24At(file, at + 9), 'height − 1').toBe(269)
      expect(u24At(file, at + 12), 'duration').toBe(frames[index].durationMs)
      expect(file[at + 15], 'no blending, no disposal').toBe(0x02)
      expect(Array.from(file.subarray(at + 16, at + anmf.size))).toEqual(
        Array.from(frames[index].data.chunks),
      )
    })
  })

  it('sets the alpha flag when any frame carries alpha', () => {
    const alpha = webpFrameData(riff(chunk('ALPH', [1]), chunk('VP8 ', [2, 3])))
    const file = muxAnimatedWebp(2, 2, [
      { data: still([1, 2]), durationMs: 100 },
      { data: alpha, durationMs: 100 },
    ])
    expect(file[12 + 8]).toBe(0x12)
  })

  it('refuses an empty animation and durations WebP cannot store', () => {
    expect(() => muxAnimatedWebp(2, 2, [])).toThrow('at least one frame')
    expect(() => muxAnimatedWebp(2, 2, [{ data: still([1, 2]), durationMs: 0 }])).toThrow('cannot last')
    expect(() => muxAnimatedWebp(2, 2, [{ data: still([1, 2]), durationMs: 2 ** 24 }])).toThrow(
      'cannot last',
    )
  })
})
