/**
 * Types for the slice of `gifenc` (1.0.3) the GIF plugin uses (#198) — the
 * package ships no TypeScript declarations. Shapes follow the library's
 * README and source (https://github.com/mattdesl/gifenc); extend this file
 * if the plugin starts using more of the API.
 */
declare module 'gifenc' {
  /** Palette as RGB(A) tuples; what `quantize` returns and frames reference. */
  export type GifPalette = number[][]

  export interface GifWriteFrameOptions {
    palette?: GifPalette
    /** Frame delay in milliseconds. */
    delay?: number
    transparent?: boolean
    transparentIndex?: number
    repeat?: number
    dispose?: number
    first?: boolean
  }

  export interface GifEncoderInstance {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options?: GifWriteFrameOptions,
    ): void
    /** Writes the GIF trailer; call once, after the last frame. */
    finish(): void
    /** The encoded bytes written so far, as a view over the growing buffer. */
    bytesView(): Uint8Array
    bytes(): Uint8Array
    reset(): void
  }

  export function GIFEncoder(options?: { auto?: boolean; initialCapacity?: number }): GifEncoderInstance

  export type GifColorFormat = 'rgb565' | 'rgb444' | 'rgba4444'

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: {
      format?: GifColorFormat
      oneBitAlpha?: boolean | number
      clearAlpha?: boolean
      clearAlphaThreshold?: number
      clearAlphaColor?: number
    },
  ): GifPalette

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GifPalette,
    format?: GifColorFormat,
  ): Uint8Array
}
