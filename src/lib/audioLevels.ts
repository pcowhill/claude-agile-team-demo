/**
 * How loud a stretch of sound is (#691, from the approved suggestion #540):
 * the reduction Match levels measures with, made in the same decode as the
 * waveform peaks (`audioPeaks.ts`) so a clip is decoded once for both.
 *
 * **The measure** is an RMS level with silence gating — "the average level
 * of the sound, ignoring silences", as the guide says. A clip is cut into
 * fixed `LEVEL_BLOCK_SECONDS` blocks; each block keeps its mean square
 * (averaged over every channel) and its peak. A window — an element's trim —
 * is then measured from the blocks it covers without decoding again:
 *
 * 1. blocks quieter than `ABSOLUTE_GATE_DB` are dropped (digital silence,
 *    the hiss of an idle input);
 * 2. of the rest, blocks more than `RELATIVE_GATE_DB` below their own
 *    average are dropped too, so the pauses between sentences — room tone,
 *    not speech — do not count as the speaker being quiet;
 * 3. the level is the average power of what remains, in dB.
 *
 * Two gates rather than one is the shape of ITU-R BS.1770's loudness gating
 * (an absolute gate, then a relative one); the K-weighting and the LUFS
 * scale are left out, as #540 recommended, until plain RMS proves
 * inadequate. Levels are dB relative to full scale amplitude: a full-scale
 * square wave reads 0 dB and a full-scale sine −3 dB.
 *
 * Memory is bounded per second of source rather than fixed like the peaks:
 * two floats per block, 80 bytes a second, about 288 KB for an hour.
 */

/** The block length levels are kept at, in seconds (#691). */
export const LEVEL_BLOCK_SECONDS = 0.1

/**
 * Blocks quieter than this, in dB, are silence and never count (#691): far
 * below any recording's speech, and above the dither and hiss of an idle
 * input.
 */
export const ABSOLUTE_GATE_DB = -70

/**
 * Of the blocks the absolute gate keeps, those more than this many dB below
 * their own average are pauses and are left out (#691). 20 dB keeps the
 * quiet syllables of normal speech, whose dynamics span well under that,
 * and drops room tone between sentences, which sits further down.
 */
export const RELATIVE_GATE_DB = -20

/** A clip's level blocks: what Match levels measures any window of it from. */
export interface ClipLevels {
  /** Seconds per block: `LEVEL_BLOCK_SECONDS`, kept with the data it describes. */
  blockSeconds: number
  /** Each block's mean square, averaged over the channels (linear power). */
  meanSquares: Float32Array
  /** Each block's largest absolute sample, over every channel. */
  peaks: Float32Array
}

/** Linear power to dB; silence is −Infinity. */
export function powerToDb(power: number): number {
  return power > 0 ? 10 * Math.log10(power) : -Infinity
}

/** A gain in dB to a linear amplitude factor. */
export function dbToGain(db: number): number {
  return 10 ** (db / 20)
}

/** A linear amplitude factor to dB; zero is −Infinity. */
export function gainToDb(gain: number): number {
  return gain > 0 ? 20 * Math.log10(gain) : -Infinity
}

/**
 * Cuts decoded channel data into level blocks (#691). The last block may be
 * short; it is averaged over the samples it has, so a clip's tail is neither
 * diluted nor dropped.
 */
export function computeLevels(
  channels: readonly Float32Array[],
  sampleRate: number,
  blockSeconds: number = LEVEL_BLOCK_SECONDS,
): ClipLevels {
  const length = channels.length === 0 ? 0 : channels[0].length
  const blockSamples = Math.max(1, Math.round(sampleRate * blockSeconds))
  const count = length === 0 ? 0 : Math.ceil(length / blockSamples)
  const meanSquares = new Float32Array(count)
  const peaks = new Float32Array(count)
  for (let block = 0; block < count; block++) {
    const start = block * blockSamples
    const end = Math.min(start + blockSamples, length)
    let sum = 0
    let peak = 0
    for (const channel of channels) {
      for (let index = start; index < end; index++) {
        const sample = channel[index]
        sum += sample * sample
        const amplitude = Math.abs(sample)
        if (amplitude > peak) peak = amplitude
      }
    }
    meanSquares[block] = sum / ((end - start) * channels.length)
    peaks[block] = peak
  }
  return { blockSeconds, meanSquares, peaks }
}

/** A window's measurement: its gated level in dB and its peak amplitude. */
export interface WindowLevel {
  /** The gated RMS level, in dB relative to full scale amplitude. */
  levelDb: number
  /** The largest absolute sample in the window (1 is full scale). */
  peak: number
}

/**
 * The gated level and the peak of `[inPoint, outPoint]` seconds of a clip
 * (#691) — an element's trimmed window, what actually plays. Null when the
 * window holds no sound above the absolute gate: silence has no level to
 * match.
 *
 * The level is taken from the blocks the window covers **whole**: a block a
 * trim cuts through also holds sound the trim removed, and half a block of
 * a loud take 20 dB up outweighs whole seconds of the quiet part kept (it
 * read 3.6 dB high on a 2 s window when such blocks were weighted by the
 * share kept — the case `audioLevels.test.ts` now pins). Only a window
 * too short to cover one whole block falls back to the blocks it touches.
 * Every touched block's peak counts, which can only overstate the peak —
 * the safe side for the clipping guard.
 */
export function windowLevel(levels: ClipLevels, inPoint: number, outPoint: number): WindowLevel | null {
  const { blockSeconds, meanSquares, peaks } = levels
  const touched: number[] = []
  const whole: number[] = []
  let peak = 0
  for (let block = Math.max(0, Math.floor(inPoint / blockSeconds)); block < meanSquares.length; block++) {
    const start = block * blockSeconds
    const end = start + blockSeconds
    if (start >= outPoint) break
    if (end <= inPoint) continue
    touched.push(meanSquares[block])
    peak = Math.max(peak, peaks[block])
    // A tolerance for float block edges: 0.3 / 0.1 is not exactly 3.
    const eps = blockSeconds * 1e-6
    if (start >= inPoint - eps && (end <= outPoint + eps || block === meanSquares.length - 1)) {
      whole.push(meanSquares[block])
    }
  }
  const blocks = whole.length > 0 ? whole : touched
  const average = (kept: readonly number[]) =>
    kept.length > 0 ? kept.reduce((total, power) => total + power, 0) / kept.length : 0
  const audible = blocks.filter((power) => powerToDb(power) >= ABSOLUTE_GATE_DB)
  if (audible.length === 0) return null
  const threshold = powerToDb(average(audible)) + RELATIVE_GATE_DB
  const gated = audible.filter((power) => powerToDb(power) >= threshold)
  return { levelDb: powerToDb(average(gated)), peak }
}
