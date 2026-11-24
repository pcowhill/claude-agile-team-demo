import { beforeAll, describe, expect, it } from 'vitest'
import { muxApng, pngCrc32, pngFrameData } from './apngMux'
import type { PngAnimationFrame } from './apngMux'

/**
 * The APNG muxer (#864). The frames here are compressed and decompressed
 * by the platform's own zlib (`CompressionStream` / `DecompressionStream`,
 * 'deflate'), not by this module. Each frame's image data is decompressed
 * back out of the animation, so a frame that was cut, reordered or
 * mis-sequenced does not come back as the pixels that went in. The CRC is
 * checked against published values first, then used to check every chunk.
 * The browser's own decoder judges the real thing in
 * `e2e/export-apng.spec.ts`.
 */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const latin1 = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0))
const text = (bytes: Uint8Array) => String.fromCharCode(...bytes)
const u32 = (bytes: Uint8Array, at: number) => new DataView(bytes.buffer, bytes.byteOffset).getUint32(at)
const u16 = (bytes: Uint8Array, at: number) => new DataView(bytes.buffer, bytes.byteOffset).getUint16(at)

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

async function through(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(bytes as Uint8Array<ArrayBuffer>)
      controller.close()
    },
  })
  const reader = source.pipeThrough(stream).getReader()
  const parts: Uint8Array[] = []
  for (let read = await reader.read(); !read.done; read = await reader.read()) parts.push(read.value)
  return concat(parts)
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, body.length)
  out.set(latin1(type), 4)
  out.set(body, 8)
  view.setUint32(8 + body.length, pngCrc32(out.subarray(4, 8 + body.length)))
  return out
}

/**
 * A still PNG, as an encoder might write it: an RGBA image of `width` ×
 * `height` filled with one colour, its zlib stream split across `idats`
 * IDAT chunks, with an `sRGB` and a `tEXt` chunk in front of the data.
 */
async function stillPng(width: number, height: number, rgba: number[], idats = 1) {
  const header = new Uint8Array(13)
  new DataView(header.buffer).setUint32(0, width)
  new DataView(header.buffer).setUint32(4, height)
  header[8] = 8 // bit depth
  header[9] = 6 // colour type: RGBA
  const raw = new Uint8Array(height * (1 + width * 4))
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 4)
    for (let x = 0; x < width; x += 1) raw.set(rgba, row + 1 + x * 4)
  }
  const compressed = await through(raw, new CompressionStream('deflate'))
  const step = Math.ceil(compressed.length / idats)
  const parts = [new Uint8Array(SIGNATURE), chunk('IHDR', header), chunk('sRGB', new Uint8Array([0]))]
  parts.push(chunk('tEXt', latin1('Software\0test')))
  for (let at = 0; at < compressed.length; at += step) parts.push(chunk('IDAT', compressed.subarray(at, at + step)))
  parts.push(chunk('IEND', new Uint8Array(0)))
  return { file: concat(parts), raw }
}

interface Chunk {
  type: string
  body: Uint8Array
}

/** Every chunk of a PNG, each CRC checked. */
function walk(file: Uint8Array): Chunk[] {
  expect([...file.subarray(0, 8)]).toEqual(SIGNATURE)
  const chunks: Chunk[] = []
  let offset = 8
  while (offset < file.length) {
    const length = u32(file, offset)
    const type = text(file.subarray(offset + 4, offset + 8))
    expect(u32(file, offset + 8 + length), `${type}'s CRC`).toBe(pngCrc32(file.subarray(offset + 4, offset + 8 + length)))
    chunks.push({ type, body: file.subarray(offset + 8, offset + 8 + length) })
    offset += 12 + length
  }
  expect(offset, 'the chunks fill the file exactly').toBe(file.length)
  return chunks
}

describe('pngCrc32 (#864)', () => {
  it('gives the published CRC-32 values', () => {
    expect(pngCrc32(new Uint8Array(0))).toBe(0)
    // Every PNG ends with this chunk, so its CRC is in every PNG file.
    expect(pngCrc32(latin1('IEND'))).toBe(0xae426082)
    expect(pngCrc32(latin1('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339)
  })
})

describe('pngFrameData (#864)', () => {
  it('keeps the header, the colour chunks before the data, and every IDAT in order', async () => {
    const { file } = await stillPng(3, 2, [255, 0, 0, 255], 3)
    const frame = pngFrameData(file)
    expect(frame.header.length).toBe(13)
    expect(frame.data).toHaveLength(3)
    // sRGB says how to show the pixels and is kept; tEXt is not.
    expect(frame.ancillary.map((whole) => text(whole.subarray(4, 8)))).toEqual(['sRGB'])
  })

  it('refuses what is not a still PNG', async () => {
    expect(() => pngFrameData(latin1('RIFF'))).toThrow('did not encode the frame as PNG')
    const { file } = await stillPng(2, 2, [0, 0, 0, 255])
    const damaged = file.slice()
    damaged[damaged.length - 20] ^= 0xff
    expect(() => pngFrameData(damaged)).toThrow('fails its CRC')
    const animated = muxApng([{ data: pngFrameData(file), durationMs: 100 }])
    expect(() => pngFrameData(animated)).toThrow('already an animated PNG')
  })
})

describe('muxApng (#864)', () => {
  let raws: Uint8Array[] = []
  let frames: PngAnimationFrame[] = []
  let chunks: Chunk[] = []

  beforeAll(async () => {
    const stills = [
      await stillPng(4, 3, [192, 48, 32, 255], 2),
      await stillPng(4, 3, [32, 80, 208, 255], 1),
      await stillPng(4, 3, [0, 160, 0, 128], 3),
    ]
    raws = stills.map((still) => still.raw)
    frames = stills.map((still, index) => ({ data: pngFrameData(still.file), durationMs: index === 1 ? 200 : 100 }))
    chunks = walk(muxApng(frames))
  })

  it('lays the chunks out as the APNG specification orders them', () => {
    expect(chunks.map((part) => part.type)).toEqual([
      'IHDR',
      'acTL',
      'sRGB',
      'fcTL',
      'IDAT',
      'IDAT',
      'fcTL',
      'fdAT',
      'fcTL',
      'fdAT',
      'fdAT',
      'fdAT',
      'IEND',
    ])
  })

  it('counts the frames and loops forever', () => {
    const control = chunks.find((part) => part.type === 'acTL')!.body
    expect(u32(control, 0)).toBe(3)
    expect(u32(control, 4)).toBe(0)
  })

  it('numbers fcTL and fdAT on one counter from 0, with no gap', () => {
    const numbered = chunks.filter((part) => part.type === 'fcTL' || part.type === 'fdAT')
    expect(numbered.map((part) => u32(part.body, 0))).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('gives each frame the whole canvas, its own delay, and replaces rather than blends', () => {
    const controls = chunks.filter((part) => part.type === 'fcTL').map((part) => part.body)
    expect(controls).toHaveLength(3)
    for (const [index, body] of controls.entries()) {
      expect(body.length).toBe(26)
      expect([u32(body, 4), u32(body, 8)]).toEqual([4, 3])
      expect([u32(body, 12), u32(body, 16)]).toEqual([0, 0])
      expect(u16(body, 20) / u16(body, 22)).toBe(frames[index].durationMs / 1000)
      expect([body[24], body[25]]).toEqual([0, 0])
    }
  })

  it('carries every frame\'s pixels back out intact', async () => {
    // Frame 0 is the IDATs; each later frame is the fdATs after its fcTL,
    // less their sequence numbers. Each inflates to the frame's own pixels.
    const streams: Uint8Array[][] = []
    for (const part of chunks) {
      if (part.type === 'fcTL') streams.push([])
      if (part.type === 'IDAT') streams[streams.length - 1].push(part.body)
      if (part.type === 'fdAT') streams[streams.length - 1].push(part.body.subarray(4))
    }
    const inflated = await Promise.all(
      streams.map((parts) => through(concat(parts), new DecompressionStream('deflate'))),
    )
    expect(inflated).toEqual(raws)
  })

  it('refuses frames of different headers, and delays APNG cannot store', async () => {
    const small = pngFrameData((await stillPng(2, 2, [0, 0, 0, 255])).file)
    expect(() => muxApng([frames[0], { data: small, durationMs: 100 }])).toThrow('different PNG header')
    expect(() => muxApng([{ ...frames[0], durationMs: 0 }])).toThrow('cannot store')
    expect(() => muxApng([{ ...frames[0], durationMs: 70_000 }])).toThrow('cannot store')
    expect(() => muxApng([])).toThrow('at least one frame')
  })
})
