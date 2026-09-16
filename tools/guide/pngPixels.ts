import { inflateSync } from 'node:zlib'

/**
 * Just enough PNG to compare two screenshots (#483): decodes the 8-bit,
 * non-interlaced RGB or RGBA files Chromium writes into raw pixels, and
 * says whether two decodes differ by more than rasterizer noise. No
 * dependency — the retake script is repository tooling, and a PNG library
 * in the runtime bundle would be one more thing the bundle check guards.
 */
export interface Pixels {
  width: number
  height: number
  /** RGBA, row-major, four bytes per pixel. */
  data: Uint8Array
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export function decodePng(file: Uint8Array): Pixels {
  if (!SIGNATURE.every((byte, index) => file[index] === byte)) throw new Error('not a PNG file')
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
  let offset = 8
  let width = 0
  let height = 0
  let channels = 0
  const idat: Uint8Array[] = []
  while (offset < file.length) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(...file.subarray(offset + 4, offset + 8))
    const body = file.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8)
      height = view.getUint32(offset + 12)
      const depth = body[8]
      const colour = body[9]
      const interlace = body[12]
      if (depth !== 8 || interlace !== 0 || (colour !== 2 && colour !== 6)) {
        throw new Error('only 8-bit non-interlaced RGB or RGBA PNGs are decoded')
      }
      channels = colour === 6 ? 4 : 3
    } else if (type === 'IDAT') {
      idat.push(body)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  if (channels === 0) throw new Error('the PNG has no IHDR chunk')
  const raw = inflateSync(Buffer.concat(idat.map((part) => Buffer.from(part))))
  const stride = width * channels
  const data = new Uint8Array(width * height * 4)
  const previous = new Uint8Array(stride)
  const current = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? current[i - channels] : 0
      const b = previous[i]
      const c = i >= channels ? previous[i - channels] : 0
      let predictor: number
      switch (filter) {
        case 0:
          predictor = 0
          break
        case 1:
          predictor = a
          break
        case 2:
          predictor = b
          break
        case 3:
          predictor = (a + b) >> 1
          break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - b)
          const pc = Math.abs(p - c)
          predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
          break
        }
        default:
          throw new Error(`unknown PNG filter ${filter} on row ${y}`)
      }
      current[i] = (line[i] + predictor) & 0xff
    }
    for (let x = 0; x < width; x++) {
      const from = x * channels
      const to = (y * width + x) * 4
      data[to] = current[from]
      data[to + 1] = current[from + 1]
      data[to + 2] = current[from + 2]
      data[to + 3] = channels === 4 ? current[from + 3] : 255
    }
    previous.set(current)
  }
  return { width, height, data }
}

export interface PixelDifference {
  /** Pixels where any channel differs. */
  count: number
  /** The largest single-channel difference among them. */
  maxDelta: number
}

export function comparePixels(a: Pixels, b: Pixels): PixelDifference | null {
  if (a.width !== b.width || a.height !== b.height) return null
  let count = 0
  let maxDelta = 0
  for (let i = 0; i < a.data.length; i += 4) {
    let delta = 0
    for (let c = 0; c < 4; c++) delta = Math.max(delta, Math.abs(a.data[i + c] - b.data[i + c]))
    if (delta > 0) {
      count++
      maxDelta = Math.max(maxDelta, delta)
    }
  }
  return { count, maxDelta }
}

/**
 * Whether two screenshots show the same thing: same size, and where they
 * differ at all, only by rasterizer noise — a shade or two, on a vanishing
 * fraction of pixels. Chromium's anti-aliased rounded corners came out one
 * shade apart between otherwise identical runs (eleven pixels of 921 600,
 * measured on #483); a real UI change moves whole rows of pixels.
 */
export function isRasterNoise(
  difference: PixelDifference | null,
  pixelCount: number,
  limits: { maxDelta: number; maxFraction: number } = { maxDelta: 2, maxFraction: 0.0005 },
): boolean {
  if (difference === null) return false
  return difference.maxDelta <= limits.maxDelta && difference.count <= pixelCount * limits.maxFraction
}
