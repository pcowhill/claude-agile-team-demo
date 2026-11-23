/**
 * A minimal animated-WebP muxer (#858). Browsers have no animated-WebP
 * encoder, but `canvas.toBlob(…, 'image/webp')` encodes one still in
 * Chromium and Firefox. An animated WebP is a RIFF container whose frames
 * are those stills' own bitstream chunks, each wrapped in an `ANMF` chunk
 * that says where and for how long it shows. So the plugin encodes every
 * frame as a still and this module re-wraps the stills. No dependency.
 *
 * The layout written, from Google's WebP container specification
 * ("Extended File Format"):
 *
 *     RIFF <size> WEBP
 *       VP8X  flags (animation, and alpha when a frame has it), canvas size
 *       ANIM  background colour, loop count (0 = forever)
 *       ANMF  offset, frame size, duration, blend/dispose flags, then the
 *             still's ALPH (if any) and VP8 / VP8L chunks
 *       ANMF  …
 *
 * Every number is little-endian, and a chunk whose payload has an odd
 * length is followed by one zero byte that its size field does not count.
 */

/** One encoded still's bitstream, ready to be wrapped in an `ANMF` chunk. */
export interface WebpFrameData {
  /** The still's `ALPH` and `VP8 ` / `VP8L` chunks, headers and padding included, in file order. */
  chunks: Uint8Array
  /** Whether the frame carries transparency (an `ALPH` chunk, or a VP8L stream using alpha). */
  hasAlpha: boolean
}

/** One frame of the animation. */
export interface WebpAnimationFrame {
  data: WebpFrameData
  /** How long the frame shows, in milliseconds (1 to 2^24 − 1). */
  durationMs: number
}

const fourCC = (bytes: Uint8Array, offset: number) =>
  String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])

const readUint32 = (bytes: Uint8Array, offset: number) =>
  (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)) + bytes[offset + 3] * 2 ** 24

/**
 * The bitstream chunks of one still WebP, as `canvas.toBlob` produces it:
 * a simple file (`VP8 ` or `VP8L` alone) or an extended one (`VP8X`, then
 * optionally `ICCP`, `ALPH`, the bitstream, `EXIF`, `XMP `). Only `ALPH`,
 * `VP8 ` and `VP8L` belong inside an `ANMF`; the rest describe the whole
 * file and are dropped. Throws on anything that is not a still WebP, which
 * is how a browser that quietly encoded PNG instead is caught.
 */
export function webpFrameData(file: Uint8Array): WebpFrameData {
  if (file.length < 20 || fourCC(file, 0) !== 'RIFF' || fourCC(file, 8) !== 'WEBP') {
    throw new Error('The browser did not encode the frame as WebP.')
  }
  const end = Math.min(file.length, 8 + readUint32(file, 4))
  const kept: Uint8Array[] = []
  let hasAlpha = false
  let bitstream = false
  let offset = 12
  while (offset + 8 <= end) {
    const id = fourCC(file, offset)
    const size = readUint32(file, offset + 4)
    const padded = size + (size % 2)
    if (offset + 8 + size > end) throw new Error('The encoded WebP frame is truncated.')
    if (id === 'ANIM' || id === 'ANMF') throw new Error('The encoded WebP frame is already animated.')
    if (id === 'ALPH' || id === 'VP8 ' || id === 'VP8L') {
      kept.push(file.subarray(offset, Math.min(end, offset + 8 + padded)))
      if (id === 'ALPH') hasAlpha = true
      if (id === 'VP8L' && size >= 5) {
        // VP8L header: 0x2f, then 14 bits width − 1, 14 bits height − 1,
        // and the alpha_is_used bit (#858: bit 28 of those 32 bits).
        if ((readUint32(file, offset + 9) >>> 28) & 1) hasAlpha = true
      }
      if (id !== 'ALPH') bitstream = true
    }
    offset += 8 + padded
  }
  if (!bitstream) throw new Error('The encoded WebP frame has no image data.')
  // A chunk at the very end of a file may omit its pad byte; inside an
  // ANMF it must have it, so the copy pads every chunk to an even length.
  const padded = (chunk: Uint8Array) => chunk.length + (chunk.length % 2)
  const chunks = new Uint8Array(kept.reduce((sum, chunk) => sum + padded(chunk), 0))
  let at = 0
  for (const chunk of kept) {
    chunks.set(chunk, at)
    at += padded(chunk)
  }
  return { chunks, hasAlpha }
}

/** The largest value a 24-bit field holds. */
const MAX_24 = 2 ** 24 - 1

function writeUint24(target: Uint8Array, offset: number, value: number) {
  target[offset] = value & 0xff
  target[offset + 1] = (value >> 8) & 0xff
  target[offset + 2] = (value >> 16) & 0xff
}

function writeUint32(target: Uint8Array, offset: number, value: number) {
  writeUint24(target, offset, value % 2 ** 24)
  target[offset + 3] = Math.floor(value / 2 ** 24) & 0xff
}

function writeFourCC(target: Uint8Array, offset: number, id: string) {
  for (let index = 0; index < 4; index += 1) target[offset + index] = id.charCodeAt(index)
}

/**
 * The animated WebP file: a `width` × `height` canvas showing `frames` in
 * order, each covering the whole canvas and replacing the one before it
 * (no blending, no disposal), looping forever over an opaque black
 * background — the composition's own stage colour.
 */
export function muxAnimatedWebp(
  width: number,
  height: number,
  frames: readonly WebpAnimationFrame[],
): Uint8Array<ArrayBuffer> {
  if (frames.length === 0) throw new Error('An animated WebP needs at least one frame.')
  if (width < 1 || height < 1 || width > MAX_24 + 1 || height > MAX_24 + 1) {
    throw new Error(`Animated WebP cannot be ${width}×${height}.`)
  }
  const anmfSizes = frames.map((frame) => 16 + frame.data.chunks.length)
  const body =
    (8 + 10) + // VP8X
    (8 + 6) + // ANIM
    anmfSizes.reduce((sum, size) => sum + 8 + size + (size % 2), 0)
  const file = new Uint8Array(12 + body)
  writeFourCC(file, 0, 'RIFF')
  writeUint32(file, 4, 4 + body)
  writeFourCC(file, 8, 'WEBP')

  let offset = 12
  writeFourCC(file, offset, 'VP8X')
  writeUint32(file, offset + 4, 10)
  const alpha = frames.some((frame) => frame.data.hasAlpha)
  file[offset + 8] = 0x02 | (alpha ? 0x10 : 0) // animation, alpha
  writeUint24(file, offset + 12, width - 1)
  writeUint24(file, offset + 15, height - 1)
  offset += 18

  writeFourCC(file, offset, 'ANIM')
  writeUint32(file, offset + 4, 6)
  // Background colour as B, G, R, A: opaque black. Loop count 0: forever.
  file[offset + 11] = 0xff
  offset += 14

  frames.forEach((frame, index) => {
    const duration = Math.round(frame.durationMs)
    if (!(duration >= 1 && duration <= MAX_24)) {
      throw new Error(`Frame ${index} cannot last ${frame.durationMs} ms.`)
    }
    const size = anmfSizes[index]
    writeFourCC(file, offset, 'ANMF')
    writeUint32(file, offset + 4, size)
    // Frame X and Y (in units of 2 px) are 0: every frame covers the canvas.
    writeUint24(file, offset + 14, width - 1)
    writeUint24(file, offset + 17, height - 1)
    writeUint24(file, offset + 20, duration)
    // Reserved bits, then blending (1 = do not blend), then disposal (0 = none).
    file[offset + 23] = 0x02
    file.set(frame.data.chunks, offset + 24)
    offset += 8 + size + (size % 2)
  })
  return file
}
