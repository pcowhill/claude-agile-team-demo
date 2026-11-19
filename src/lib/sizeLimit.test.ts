import { describe, expect, it } from 'vitest'
import { exportedDuration } from './exportVideo'
import {
  BLUR_BITS_PER_PIXEL,
  BYTES_PER_MB,
  MAX_AUDIO_ONLY_BITRATE,
  RESERVED_AUDIO_BITRATE,
  SIZE_LIMIT_MARGIN,
  formatBitrate,
  formatMegabytes,
  formatSizeAgainstLimit,
  rateControlledCandidates,
  recorderOptions,
  sizeLimitBitrates,
  videoBitrateReading,
} from './sizeLimit'
import type { TimelineEntry, TimelineState } from './timeline'

const entry = (overrides: Partial<TimelineEntry> & { id: string }): TimelineEntry => ({
  clipId: 'clip-a',
  name: 'clip.webm',
  duration: 10,
  url: 'blob:clip-a',
  inPoint: 0,
  outPoint: 10,
  ...overrides,
})

describe('exportedDuration: what the Size limit is spread over (#726)', () => {
  it('is the output duration, not the clip lengths, through a speed segment and a pause', () => {
    // A 10 s clip with a 2× segment over source [2, 6] plays that 4 s of
    // source in 2 s, and a 3 s pause adds 3 s: 10 - 2 + 3 = 11 s of output.
    // Worked by hand; the clip's own length (10 s) is the wrong answer.
    const timeline: TimelineState = {
      entries: [entry({ id: 'e1' })],
      remaps: [
        { id: 'r1', entryId: 'e1', kind: 'speed', start: 2, end: 6, factor: 2 },
        { id: 'r2', entryId: 'e1', kind: 'pause', at: 8, hold: 3 },
      ],
    }
    expect(exportedDuration(timeline)).toBeCloseTo(11, 9)
  })

  it('is a range’s own length, with an end past the sequence clamped into it', () => {
    const timeline: TimelineState = { entries: [entry({ id: 'e1' }), entry({ id: 'e2' })] }
    expect(exportedDuration(timeline)).toBe(20)
    expect(exportedDuration(timeline, { start: 4, end: 9 })).toBe(5)
    expect(exportedDuration(timeline, { start: 15, end: 40 })).toBe(5)
  })
})

describe('sizeLimitBitrates (#726)', () => {
  // 25 MB over 100 s with the 10 % margin: 25e6 × 8 × 0.9 / 100 =
  // 1,800,000 bit/s in all. Worked by hand from the formula in #726.
  const limitBytes = 25 * BYTES_PER_MB

  it('pins the margin and the audio reserve these expectations were worked from', () => {
    expect(SIZE_LIMIT_MARGIN).toBe(0.1)
    expect(RESERVED_AUDIO_BITRATE).toBe(128_000)
  })

  it('gives the video the budget less the sound’s reserve, and asks for the reserve', () => {
    expect(sizeLimitBitrates({ limitBytes, durationSeconds: 100, audio: true })).toEqual({
      ok: true,
      bitrates: { videoBitsPerSecond: 1_672_000, audioBitsPerSecond: 128_000 },
    })
  })

  it('gives the video the whole budget when the export carries no sound', () => {
    expect(sizeLimitBitrates({ limitBytes, durationSeconds: 100, audio: false })).toEqual({
      ok: true,
      bitrates: { videoBitsPerSecond: 1_800_000 },
    })
  })

  it('spreads the limit over the duration it is given: half the length, twice the rate', () => {
    expect(sizeLimitBitrates({ limitBytes, durationSeconds: 50, audio: false })).toEqual({
      ok: true,
      bitrates: { videoBitsPerSecond: 3_600_000 },
    })
  })

  it('takes a timeline’s output duration through exportedDuration, as the export does', () => {
    // The 11 s timeline above: 25e6 × 8 × 0.9 / 11 = 16,363,636.36…, floored.
    const timeline: TimelineState = {
      entries: [entry({ id: 'e1' })],
      remaps: [
        { id: 'r1', entryId: 'e1', kind: 'speed', start: 2, end: 6, factor: 2 },
        { id: 'r2', entryId: 'e1', kind: 'pause', at: 8, hold: 3 },
      ],
    }
    expect(
      sizeLimitBitrates({ limitBytes, durationSeconds: exportedDuration(timeline), audio: false }),
    ).toEqual({ ok: true, bitrates: { videoBitsPerSecond: 16_363_636 } })
  })

  it('gives an audio-only export the whole budget as its audio rate, within Opus’s range', () => {
    // 1 MB over 100 s: 1e6 × 8 × 0.9 / 100 = 72,000 bit/s.
    expect(
      sizeLimitBitrates({ limitBytes: BYTES_PER_MB, durationSeconds: 100, audio: true, audioOnly: true }),
    ).toEqual({ ok: true, bitrates: { audioBitsPerSecond: 72_000 } })
    // 25 MB over 100 s would be 1.8 Mbit/s: more than Opus can use.
    expect(
      sizeLimitBitrates({ limitBytes, durationSeconds: 100, audio: true, audioOnly: true }),
    ).toEqual({ ok: true, bitrates: { audioBitsPerSecond: MAX_AUDIO_ONLY_BITRATE } })
  })

  it('refuses a limit that leaves no video bitrate after the sound’s reserve, with a message', () => {
    // 1 MB over 60 s is 120,000 bit/s in all: less than the 128 kbit/s
    // reserve, so nothing is left for the picture.
    const result = sizeLimitBitrates({ limitBytes: BYTES_PER_MB, durationSeconds: 60, audio: true })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe(
        'A 1 MB limit leaves no room for the picture over 1:00 once the sound has its 128 kbit/s. Choose a larger limit or a shorter range.',
      )
    }
    // The same limit without sound leaves the picture its 120 kbit/s.
    expect(sizeLimitBitrates({ limitBytes: BYTES_PER_MB, durationSeconds: 60, audio: false })).toEqual({
      ok: true,
      bitrates: { videoBitsPerSecond: 120_000 },
    })
  })

  it('refuses an audio-only limit below Opus’s floor, and a limit or duration that is not positive', () => {
    expect(
      sizeLimitBitrates({ limitBytes: 1000, durationSeconds: 60, audio: true, audioOnly: true }).ok,
    ).toBe(false)
    expect(sizeLimitBitrates({ limitBytes: 0, durationSeconds: 60, audio: false }).ok).toBe(false)
    expect(sizeLimitBitrates({ limitBytes: -5, durationSeconds: 60, audio: false }).ok).toBe(false)
    expect(sizeLimitBitrates({ limitBytes, durationSeconds: 0, audio: false }).ok).toBe(false)
  })
})

describe('recorderOptions (#726)', () => {
  it('is the MIME type alone with no limit, exactly what the recorder got before', () => {
    const options = recorderOptions('video/webm;codecs=vp9,opus', null)
    expect(options).toEqual({ mimeType: 'video/webm;codecs=vp9,opus' })
    expect(Object.keys(options)).toEqual(['mimeType'])
  })

  it('adds the limit’s rates when there is one', () => {
    expect(
      recorderOptions('video/webm', { videoBitsPerSecond: 1_672_000, audioBitsPerSecond: 128_000 }),
    ).toEqual({ mimeType: 'video/webm', videoBitsPerSecond: 1_672_000, audioBitsPerSecond: 128_000 })
  })
})

describe('rateControlledCandidates (#726)', () => {
  it('puts VP8 ahead of VP9 and leaves every other candidate where it was', () => {
    expect(
      rateControlledCandidates(['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']),
    ).toEqual(['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm'])
    expect(
      rateControlledCandidates(['video/mp4;codecs=avc1', 'video/mp4;codecs=vp9', 'video/mp4', 'video/mp4;codecs=vp8']),
    ).toEqual(['video/mp4;codecs=avc1', 'video/mp4;codecs=vp8', 'video/mp4', 'video/mp4;codecs=vp9'])
    expect(rateControlledCandidates(['audio/webm;codecs=opus', 'audio/webm'])).toEqual([
      'audio/webm;codecs=opus',
      'audio/webm',
    ])
  })
})

describe('the estimate line’s reading (#726)', () => {
  it('reads a rate as blurry below the threshold and fine at or above it', () => {
    const pixelsPerSecond = 1280 * 720 * 30
    const threshold = BLUR_BITS_PER_PIXEL * pixelsPerSecond
    const fine = videoBitrateReading({ videoBitsPerSecond: 1_400_000, width: 1280, height: 720, frameRate: 30 })
    expect(fine).toEqual({ blurry: false, rate: 'about 1.4 Mbit/s', reading: 'fine for screen text at 1280×720' })
    expect(
      videoBitrateReading({ videoBitsPerSecond: threshold, width: 1280, height: 720, frameRate: 30 }).blurry,
    ).toBe(false)
    const blurry = videoBitrateReading({ videoBitsPerSecond: 200_000, width: 1280, height: 720, frameRate: 30 })
    expect(blurry.blurry).toBe(true)
    expect(blurry.rate).toBe('about 200 kbit/s')
    expect(blurry.reading).toBe(
      'text will be blurry at 1280×720; consider a larger limit or a smaller output size',
    )
    // The same 200 kbit/s is plenty for a small frame: the reading is per pixel.
    expect(
      videoBitrateReading({ videoBitsPerSecond: 200_000, width: 320, height: 180, frameRate: 30 }).blurry,
    ).toBe(false)
  })

  it('formats rates and sizes the way the dialog states them', () => {
    expect(formatBitrate(1_672_000)).toBe('1.7 Mbit/s')
    expect(formatBitrate(16_363_636)).toBe('16 Mbit/s')
    expect(formatBitrate(830_000)).toBe('830 kbit/s')
    expect(formatMegabytes(23_100_000)).toBe('23.1 MB')
    expect(formatMegabytes(25_000_000)).toBe('25 MB')
    expect(formatMegabytes(25_040_000)).toBe('25 MB')
    expect(formatMegabytes(400_000)).toBe('0.4 MB')
  })

  it('never states a file over its limit as the limit itself', () => {
    expect(formatSizeAgainstLimit(25_040_000, 25_000_000)).toBe('25.04 MB')
    expect(formatSizeAgainstLimit(25_000_400, 25_000_000)).toBe('25.0004 MB')
    expect(formatSizeAgainstLimit(23_100_000, 25_000_000)).toBe('23.1 MB')
    expect(formatSizeAgainstLimit(24_990_000, 25_000_000)).toBe('25 MB')
  })
})
