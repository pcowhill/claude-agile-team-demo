import { floatTo16BitPcm } from '../../lib/exportMp3'

/**
 * The WAV audio format's writer (#866): the mixed soundtrack as 16-bit PCM
 * stereo in a RIFF/WAVE file, at the mix's own sample rate.
 *
 * The layout is the canonical 44-byte header followed by the samples:
 * - `RIFF`, the size of everything after this field, `WAVE`;
 * - a 16-byte `fmt ` chunk: format 1 (PCM), 2 channels, the sample rate,
 *   the byte rate (rate × 4), the block align (4) and 16 bits per sample;
 * - a `data` chunk holding the samples, left and right interleaved,
 *   little-endian.
 *
 * RIFF sizes are 32-bit, so a file holds at most 4 GiB. The `RIFF` size
 * field counts the 36 header bytes after it as well as the samples, so the
 * samples get 2³² − 1 − 36 bytes, rounded down to whole stereo frames:
 * `WAV_MAX_FRAMES`. Past that the writer refuses with a message rather than
 * write sizes that wrap.
 */

/** WAV is written as stereo: a mono mix up-mixes into both channels in the graph. */
export const WAV_CHANNELS = 2

/** Bytes per sample: 16-bit PCM. */
const BYTES_PER_SAMPLE = 2

/** Bytes per stereo frame: the `fmt ` chunk's block align. */
const BLOCK_ALIGN = WAV_CHANNELS * BYTES_PER_SAMPLE

/** Stereo frames interleaved per step: 4 MiB of output. */
const WAV_CHUNK_FRAMES = 1 << 20

/** The canonical header: RIFF (12) + fmt (24) + data's own header (8). */
export const WAV_HEADER_BYTES = 44

/** The most stereo frames a WAV's 32-bit sizes can describe. */
export const WAV_MAX_FRAMES = Math.floor((0xffffffff - (WAV_HEADER_BYTES - 8)) / BLOCK_ALIGN)

/** The longest export a WAV holds at `sampleRate`, in seconds. */
export function wavMaxSeconds(sampleRate: number): number {
  return WAV_MAX_FRAMES / sampleRate
}

/** "6 h 12 min": a duration in whole minutes, for the refusal message. */
function hoursAndMinutes(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

/**
 * Why `frames` stereo frames at `sampleRate` cannot be written as one WAV,
 * or null when they can. The message says what to change.
 */
export function wavLimitError(frames: number, sampleRate: number): string | null {
  if (frames <= WAV_MAX_FRAMES) return null
  const longest = hoursAndMinutes(wavMaxSeconds(sampleRate))
  return `A WAV file holds at most 4 GB, about ${longest} at ${sampleRate.toLocaleString('en-US')} Hz. Export a shorter range.`
}

/**
 * Writes the left and right channels as one 16-bit stereo WAV. The two
 * channels are the same length, as the tap delivers them; a shorter one
 * would be padded with silence rather than shift the other.
 */
export function encodeWav(left: Float32Array, right: Float32Array, sampleRate: number): Blob {
  const frames = Math.max(left.length, right.length)
  const limit = wavLimitError(frames, sampleRate)
  if (limit !== null) throw new Error(limit)
  const dataBytes = frames * BLOCK_ALIGN
  const header = new ArrayBuffer(WAV_HEADER_BYTES)
  const view = new DataView(header)
  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index++) view.setUint8(offset + index, text.charCodeAt(index))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, WAV_HEADER_BYTES - 8 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // the fmt chunk's size: plain PCM
  view.setUint16(20, 1, true) // format: PCM
  view.setUint16(22, WAV_CHANNELS, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * BLOCK_ALIGN, true) // byte rate
  view.setUint16(32, BLOCK_ALIGN, true)
  view.setUint16(34, BYTES_PER_SAMPLE * 8, true) // bits per sample
  ascii(36, 'data')
  view.setUint32(40, dataBytes, true)

  // Interleaved a chunk at a time, so a long export never needs one buffer
  // the size of the whole file, nor a second full-length copy of either
  // channel as 16-bit samples.
  const parts: ArrayBuffer[] = [header]
  for (let start = 0; start < frames; start += WAV_CHUNK_FRAMES) {
    const end = Math.min(frames, start + WAV_CHUNK_FRAMES)
    const leftPcm = floatTo16BitPcm(left.subarray(start, end))
    const rightPcm = floatTo16BitPcm(right.subarray(start, end))
    const chunk = new DataView(new ArrayBuffer((end - start) * BLOCK_ALIGN))
    for (let frame = 0; frame < end - start; frame++) {
      chunk.setInt16(frame * BLOCK_ALIGN, leftPcm[frame] ?? 0, true)
      chunk.setInt16(frame * BLOCK_ALIGN + BYTES_PER_SAMPLE, rightPcm[frame] ?? 0, true)
    }
    parts.push(chunk.buffer)
  }
  return new Blob(parts, { type: 'audio/wav' })
}
