import { describe, expect, it, vi } from 'vitest'
import {
  PEAK_COUNT,
  computePeaks,
  peakWindow,
  peaksForClip,
  waveformPath,
} from './audioPeaks'

describe('computePeaks (#191)', () => {
  // Float32Array storage rounds literals like 0.3, so expectations compare
  // against the same values passed through Math.fround.
  const rounded = (values: number[]) => values.map(Math.fround)

  it('takes the maximum absolute sample per bucket', () => {
    // 8 samples into 4 buckets of 2: signs must not matter.
    const channel = new Float32Array([0.1, -0.5, 0.2, 0.3, -0.9, 0.1, 0.0, 0.4])
    expect(Array.from(computePeaks([channel], 4))).toEqual(rounded([0.5, 0.3, 0.9, 0.4]))
  })

  it('takes the maximum across channels', () => {
    const left = new Float32Array([0.2, 0.1])
    const right = new Float32Array([0.1, -0.8])
    expect(Array.from(computePeaks([left, right], 2))).toEqual(rounded([0.2, 0.8]))
  })

  it('is fixed-size regardless of source length — the memory bound', () => {
    const long = new Float32Array(PEAK_COUNT * 137)
    long[12345] = 1
    expect(computePeaks([long])).toHaveLength(PEAK_COUNT)
    // A short source still fills every bucket (neighbors repeat samples).
    const short = new Float32Array([0.5, 0.75])
    const peaks = computePeaks([short], 6)
    expect(peaks).toHaveLength(6)
    expect(Array.from(peaks).every((peak) => peak === 0.5 || peak === 0.75)).toBe(true)
  })

  it('yields silence for empty input', () => {
    expect(Array.from(computePeaks([], 3))).toEqual([0, 0, 0])
    expect(Array.from(computePeaks([new Float32Array(0)], 3))).toEqual([0, 0, 0])
  })
})

describe('peakWindow (#191)', () => {
  const peaks = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])

  it('returns everything for the untrimmed window', () => {
    expect(Array.from(peakWindow(peaks, 0, 10, 10))).toEqual(Array.from(peaks))
  })

  it('maps the trim to the matching slice of the source peaks', () => {
    // 10s source, window [2, 5) of it → buckets 2..4 of 10.
    expect(Array.from(peakWindow(peaks, 2, 5, 10))).toEqual([2, 3, 4])
    // Trimming the head shifts the visible section, not just shortens it.
    expect(Array.from(peakWindow(peaks, 7, 10, 10))).toEqual([7, 8, 9])
  })

  it('clamps a window reaching past the source', () => {
    expect(Array.from(peakWindow(peaks, 8, 25, 10))).toEqual([8, 9])
  })

  it('is empty for degenerate inputs — no waveform beats a wrong one', () => {
    expect(peakWindow(peaks, 4, 4, 10)).toHaveLength(0)
    expect(peakWindow(peaks, 6, 2, 10)).toHaveLength(0)
    expect(peakWindow(peaks, 0, 5, 0)).toHaveLength(0)
    expect(peakWindow(new Float32Array(0), 0, 5, 10)).toHaveLength(0)
  })
})

describe('waveformPath (#191)', () => {
  it('mirrors each bucket about the midline', () => {
    const path = waveformPath([1, 0.5], 2)
    // Full amplitude reaches both edges (y = 0 and y = 2); half amplitude
    // reaches 0.5 and 1.5. The band starts and closes on the midline.
    expect(path.startsWith('M0 1')).toBe(true)
    expect(path.endsWith('Z')).toBe(true)
    expect(path).toContain('L0 0')
    expect(path).toContain('L1 0.5')
    expect(path).toContain('L1 1.5')
    expect(path).toContain('L0 2')
  })

  it('keeps silence on the midline and clamps out-of-range amplitudes', () => {
    expect(waveformPath([0], 2)).toBe('M0 1L0 1L1 1L1 1L0 1Z')
    // A malformed sample above 1 must not draw outside the box.
    expect(waveformPath([5], 2)).toContain('L0 0')
    expect(waveformPath([5], 2)).not.toContain('-')
  })
})

describe('peaksForClip cache (#191)', () => {
  it('decodes a clip once and shares the result across callers', async () => {
    const peaks = new Float32Array([0.5])
    const decode = vi.fn(() => Promise.resolve<Float32Array | null>(peaks))
    const first = await peaksForClip('blob:cache-hit', decode)
    const second = await peaksForClip('blob:cache-hit', decode)
    expect(first).toBe(peaks)
    expect(second).toBe(peaks)
    expect(decode).toHaveBeenCalledTimes(1)
  })

  it('caches a failed decode as null instead of retrying forever', async () => {
    const decode = vi.fn(() => Promise.resolve<Float32Array | null>(null))
    expect(await peaksForClip('blob:undecodable', decode)).toBeNull()
    expect(await peaksForClip('blob:undecodable', decode)).toBeNull()
    expect(decode).toHaveBeenCalledTimes(1)
  })

  it('keys strictly by URL — different clips do not share peaks', async () => {
    const decode = vi.fn((url: string) =>
      Promise.resolve<Float32Array | null>(new Float32Array([url.length])),
    )
    const a = await peaksForClip('blob:clip-a', decode)
    const b = await peaksForClip('blob:clip-b!', decode)
    expect(decode).toHaveBeenCalledTimes(2)
    expect(a).not.toEqual(b)
  })
})
