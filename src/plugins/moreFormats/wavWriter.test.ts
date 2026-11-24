import { describe, expect, it } from 'vitest'
import { WAV_HEADER_BYTES, WAV_MAX_FRAMES, encodeWav, wavLimitError, wavMaxSeconds } from './wavWriter'

/**
 * The WAV writer (#866), read back field by field against the RIFF/WAVE
 * layout (Microsoft's "Multimedia Programming Interface and Data
 * Specifications 1.0", the WAVE form's `fmt ` and `data` chunks) rather
 * than against the writer's own constants.
 */

async function bytesOf(blob: Blob): Promise<DataView> {
  return new DataView(await blob.arrayBuffer())
}

function ascii(view: DataView, offset: number, length: number): string {
  let text = ''
  for (let index = 0; index < length; index++) text += String.fromCharCode(view.getUint8(offset + index))
  return text
}

describe('the WAV writer (#866)', () => {
  it('writes the canonical 44-byte header for a known stereo buffer', async () => {
    const left = new Float32Array([0, 0.5, -0.5, 1])
    const right = new Float32Array([1, -1, 0.25, 0])
    const blob = encodeWav(left, right, 44_100)
    expect(blob.type).toBe('audio/wav')
    const view = await bytesOf(blob)
    // 4 frames × 2 channels × 2 bytes = 16 bytes of samples after 44 of header.
    expect(view.byteLength).toBe(44 + 16)
    expect(ascii(view, 0, 4)).toBe('RIFF')
    expect(view.getUint32(4, true)).toBe(view.byteLength - 8)
    expect(ascii(view, 8, 4)).toBe('WAVE')
    expect(ascii(view, 12, 4)).toBe('fmt ')
    expect(view.getUint32(16, true)).toBe(16)
    expect(view.getUint16(20, true)).toBe(1) // WAVE_FORMAT_PCM
    expect(view.getUint16(22, true)).toBe(2) // channels
    expect(view.getUint32(24, true)).toBe(44_100) // samples per second
    expect(view.getUint32(28, true)).toBe(44_100 * 2 * 2) // average bytes per second
    expect(view.getUint16(32, true)).toBe(4) // block align: channels × bytes per sample
    expect(view.getUint16(34, true)).toBe(16) // bits per sample
    expect(ascii(view, 36, 4)).toBe('data')
    expect(view.getUint32(40, true)).toBe(16)
  })

  it('interleaves left then right, as signed 16-bit little-endian, clamped', async () => {
    const left = new Float32Array([0, 0.5, -0.5, 1, 2])
    const right = new Float32Array([1, -1, 0.25, 0, -3])
    const view = await bytesOf(encodeWav(left, right, 8000))
    const samples: number[] = []
    for (let offset = WAV_HEADER_BYTES; offset < view.byteLength; offset += 2) samples.push(view.getInt16(offset, true))
    expect(samples).toEqual([
      0, 32767,
      16384, -32768,
      -16384, 8192,
      32767, 0,
      // Out of range clamps to full scale rather than wrapping.
      32767, -32768,
    ])
  })

  it('writes the same samples whatever the chunking, across a chunk boundary', async () => {
    // 2^20 frames is one chunk; one more frame crosses into a second.
    const frames = (1 << 20) + 3
    const left = new Float32Array(frames)
    const right = new Float32Array(frames)
    for (let index = 0; index < frames; index++) {
      left[index] = ((index % 200) - 100) / 128
      right[index] = -left[index]
    }
    const view = await bytesOf(encodeWav(left, right, 48_000))
    expect(view.getUint32(40, true)).toBe(frames * 4)
    for (const frame of [0, (1 << 20) - 1, 1 << 20, frames - 1]) {
      const expected = Math.round(left[frame] < 0 ? left[frame] * 0x8000 : left[frame] * 0x7fff)
      expect(view.getInt16(WAV_HEADER_BYTES + frame * 4, true), `left of frame ${frame}`).toBe(expected)
      expect(view.getInt16(WAV_HEADER_BYTES + frame * 4 + 2, true), `right of frame ${frame}`).toBe(
        Math.round(-left[frame] < 0 ? -left[frame] * 0x8000 : -left[frame] * 0x7fff),
      )
    }
  })

  it('states the longest WAV, and refuses one past the 32-bit sizes', () => {
    // RIFF's size field counts 36 header bytes plus the samples, all in 32 bits.
    expect(36 + WAV_MAX_FRAMES * 4).toBeLessThanOrEqual(0xffffffff)
    expect(36 + (WAV_MAX_FRAMES + 1) * 4).toBeGreaterThan(0xffffffff)
    // About 6 h 12 min at 48 kHz, 6 h 45 min at 44.1 kHz.
    expect(wavMaxSeconds(48_000) / 3600).toBeCloseTo(6.21, 2)
    expect(wavMaxSeconds(44_100) / 3600).toBeCloseTo(6.76, 2)
    expect(wavLimitError(WAV_MAX_FRAMES, 48_000)).toBeNull()
    expect(wavLimitError(WAV_MAX_FRAMES + 1, 48_000)).toBe(
      'A WAV file holds at most 4 GB, about 6 h 12 min at 48,000 Hz. Export a shorter range.',
    )
  })
})
