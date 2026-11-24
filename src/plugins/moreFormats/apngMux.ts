/**
 * A minimal APNG muxer (#864). Browsers have no animated-PNG encoder, but
 * `canvas.toBlob(…, 'image/png')` encodes one still PNG in every target
 * browser. An APNG is an ordinary PNG with extra chunks, and its frames are
 * those stills' own compressed image data. So the plugin encodes every
 * frame as a still, and this module re-wraps the stills, as `webpMux.ts`
 * does for WebP. No dependency.
 *
 * The layout written, from the APNG specification (PNG 3rd edition, §11.3.6
 * and the `acTL` / `fcTL` / `fdAT` chunks):
 *
 *     PNG signature
 *     IHDR   frame 0's, unchanged: the canvas size and pixel format
 *     acTL   frame count, play count (0 = forever)
 *     …      frame 0's other chunks before its image data (sRGB, gAMA, …)
 *     fcTL   sequence 0: frame 0's size, offset 0,0, delay, dispose/blend
 *     IDAT   frame 0's image data, unchanged, so a viewer without APNG
 *            support shows the first frame
 *     fcTL   sequence 1: frame 1
 *     fdAT   sequence 2: frame 1's image data, after its sequence number
 *     …
 *     IEND
 *
 * Every chunk is a big-endian length, a four-letter type, the data, and a
 * CRC-32 of the type and data. The `fcTL` and `fdAT` chunks share one
 * sequence-number counter, from 0.
 */

/** One encoded still's image data, ready to become an animation frame. */
export interface PngFrameData {
  /** The `IHDR` chunk's 13 data bytes: size, bit depth, colour type and the rest. */
  header: Uint8Array
  /** Frame 0's chunks between `IHDR` and the first `IDAT`, whole (length, type, data, CRC). */
  ancillary: Uint8Array[]
  /** The data of each `IDAT` chunk, in order: together, one zlib stream. */
  data: Uint8Array[]
}

/** One frame of the animation. */
export interface PngAnimationFrame {
  data: PngFrameData
  /** How long the frame shows, in milliseconds (1 to 65,535). */
  durationMs: number
}

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * The chunks a still keeps in front of its image data that describe how to
 * show its pixels: colour space and gamma, so the animation shows them as
 * the still would. Any other chunk the encoder wrote (text, a timestamp,
 * physical size) describes the file rather than the picture and is dropped.
 */
const KEPT_ANCILLARY = new Set(['PLTE', 'tRNS', 'sRGB', 'gAMA', 'cHRM', 'iCCP', 'sBIT', 'cICP'])

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

/** The CRC-32 a PNG chunk carries, over its type and data. */
export function pngCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

const typeOf = (bytes: Uint8Array, offset: number) =>
  String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])

const readUint32 = (bytes: Uint8Array, offset: number) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset)

/**
 * The parts of one still PNG, as `canvas.toBlob` produces it, that an APNG
 * frame is made of. Throws on anything that is not a PNG, on a damaged
 * chunk, and on a PNG that is already animated.
 */
export function pngFrameData(file: Uint8Array): PngFrameData {
  if (file.length < SIGNATURE.length || SIGNATURE.some((byte, index) => file[index] !== byte)) {
    throw new Error('The browser did not encode the frame as PNG.')
  }
  let header: Uint8Array | null = null
  const ancillary: Uint8Array[] = []
  const data: Uint8Array[] = []
  let offset = SIGNATURE.length
  while (offset + 12 <= file.length) {
    const length = readUint32(file, offset)
    const type = typeOf(file, offset + 4)
    const end = offset + 12 + length
    if (end > file.length) throw new Error(`The frame's PNG ${type} chunk runs past the end of the file.`)
    const body = file.subarray(offset + 8, offset + 8 + length)
    if (readUint32(file, offset + 8 + length) !== pngCrc32(file.subarray(offset + 4, offset + 8 + length))) {
      throw new Error(`The frame's PNG ${type} chunk fails its CRC.`)
    }
    if (type === 'IHDR') header = body.slice()
    else if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') {
      throw new Error('The frame is already an animated PNG.')
    } else if (type === 'IDAT') data.push(body.slice())
    else if (type === 'IEND') break
    else if (data.length === 0 && KEPT_ANCILLARY.has(type)) ancillary.push(file.slice(offset, end))
    offset = end
  }
  if (header === null || header.length !== 13) throw new Error('The frame has no PNG header.')
  if (data.length === 0) throw new Error('The frame has no PNG image data.')
  return { header, ancillary, data }
}

/** A whole chunk: length, type, data and CRC. */
function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, body.length)
  for (let index = 0; index < 4; index += 1) out[4 + index] = type.charCodeAt(index)
  out.set(body, 8)
  view.setUint32(8 + body.length, pngCrc32(out.subarray(4, 8 + body.length)))
  return out
}

/** An `fcTL` body: the whole canvas, shown for `durationMs`, replacing what was there. */
function frameControl(sequence: number, width: number, height: number, durationMs: number): Uint8Array {
  const body = new Uint8Array(26)
  const view = new DataView(body.buffer)
  view.setUint32(0, sequence)
  view.setUint32(4, width)
  view.setUint32(8, height)
  view.setUint32(12, 0) // x offset
  view.setUint32(16, 0) // y offset
  // The delay is a fraction of a second: milliseconds over 1000.
  view.setUint16(20, durationMs)
  view.setUint16(22, 1000)
  body[24] = 0 // dispose: APNG_DISPOSE_OP_NONE
  // Blend: APNG_BLEND_OP_SOURCE, so a transparent pixel in a later frame
  // replaces the earlier frame's pixel instead of showing it through.
  body[25] = 0
  return body
}

/**
 * The APNG of `frames`, all one size and pixel format, looping forever.
 * Throws when a frame's `IHDR` differs from the first frame's, since an
 * APNG has one pixel format and one canvas for every frame.
 */
export function muxApng(frames: readonly PngAnimationFrame[]): Uint8Array<ArrayBuffer> {
  if (frames.length === 0) throw new Error('An animation needs at least one frame.')
  const header = frames[0].data.header
  for (const [index, frame] of frames.entries()) {
    if (frame.data.header.some((byte, at) => byte !== header[at])) {
      throw new Error(`Frame ${index} of the animation has a different PNG header from frame 0.`)
    }
    if (!Number.isInteger(frame.durationMs) || frame.durationMs < 1 || frame.durationMs > 0xffff) {
      throw new Error(`Frame ${index} of the animation has a duration APNG cannot store: ${frame.durationMs} ms.`)
    }
  }
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength)
  const width = view.getUint32(0)
  const height = view.getUint32(4)

  const animationControl = new Uint8Array(8)
  new DataView(animationControl.buffer).setUint32(0, frames.length)
  // Bytes 4–7, the play count, stay 0: loop forever.

  const parts: Uint8Array[] = [SIGNATURE, chunk('IHDR', header), chunk('acTL', animationControl)]
  parts.push(...frames[0].data.ancillary)
  let sequence = 0
  for (const [index, frame] of frames.entries()) {
    parts.push(chunk('fcTL', frameControl(sequence, width, height, frame.durationMs)))
    sequence += 1
    for (const data of frame.data.data) {
      if (index === 0) {
        parts.push(chunk('IDAT', data))
        continue
      }
      const body = new Uint8Array(4 + data.length)
      new DataView(body.buffer).setUint32(0, sequence)
      body.set(data, 4)
      parts.push(chunk('fdAT', body))
      sequence += 1
    }
  }
  parts.push(chunk('IEND', new Uint8Array(0)))

  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}
