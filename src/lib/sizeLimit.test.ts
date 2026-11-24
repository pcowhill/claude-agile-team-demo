import { describe, expect, it } from 'vitest'
import { exportedDuration } from './exportVideo'
import {
  BLUR_BITS_PER_PIXEL,
  BYTES_PER_MB,
  MAX_AUDIO_ONLY_BITRATE,
  RESERVED_AUDIO_BITRATE,
  SIZE_LIMIT_MARGIN,
  formatBitrate,
  formatLimitAgainstSize,
  formatMegabytes,
  formatSizeAgainstLimit,
  rateControlledCandidates,
  recorderOptions,
  sizeLimitBitrates,
  smallerBitrates,
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

describe('smallerBitrates: Export again smaller (#727)', () => {
  it('scales the picture by limit / actual, less the margin, and keeps the sound’s reserve', () => {
    // 1,672,000 × (25e6 / 30e6) × 0.9 = 1,672,000 × 0.75 = 1,254,000.
    // Worked by hand from #727's formula.
    expect(
      smallerBitrates({
        previous: { videoBitsPerSecond: 1_672_000, audioBitsPerSecond: 128_000 },
        limitBytes: 25_000_000,
        actualBytes: 30_000_000,
      }),
    ).toEqual({ ok: true, bitrates: { videoBitsPerSecond: 1_254_000, audioBitsPerSecond: 128_000 } })
  })

  it('takes the step from the overshoot: a file barely over is not halved', () => {
    // 1,000,000 × (10e6 / 10.2e6) × 0.9 = 882,352.94…, floored.
    expect(
      smallerBitrates({ previous: { videoBitsPerSecond: 1_000_000 }, limitBytes: 10e6, actualBytes: 10.2e6 }),
    ).toEqual({ ok: true, bitrates: { videoBitsPerSecond: 882_352 } })
    // Twice over: 1,000,000 × 0.5 × 0.9 = 450,000.
    expect(
      smallerBitrates({ previous: { videoBitsPerSecond: 1_000_000 }, limitBytes: 10e6, actualBytes: 20e6 }),
    ).toEqual({ ok: true, bitrates: { videoBitsPerSecond: 450_000 } })
  })

  it('scales the sound in an audio-only export, and refuses below Opus’s floor', () => {
    // 72,000 × (1e6 / 1.2e6) × 0.9 = 54,000.
    expect(
      smallerBitrates({ previous: { audioBitsPerSecond: 72_000 }, limitBytes: 1e6, actualBytes: 1.2e6 }),
    ).toEqual({ ok: true, bitrates: { audioBitsPerSecond: 54_000 } })
    const floor = smallerBitrates({ previous: { audioBitsPerSecond: 6_500 }, limitBytes: 1e6, actualBytes: 1.2e6 })
    expect(floor.ok).toBe(false)
    if (!floor.ok) {
      expect(floor.error).toBe(
        'The file cannot be made smaller than this under a 1 MB limit. Choose a larger limit or a shorter range.',
      )
    }
  })

  it('never returns a rate at or above the first, however little the file is over', () => {
    for (const actualBytes of [10_000_001, 10_050_000, 11e6, 50e6]) {
      for (const previous of [7, 1_000, 830_000, 16_363_636]) {
        const result = smallerBitrates({ previous: { videoBitsPerSecond: previous }, limitBytes: 10e6, actualBytes })
        if (result.ok) expect(result.bitrates.videoBitsPerSecond!).toBeLessThan(previous)
      }
    }
  })

  it('refuses a file that is not over its limit, and a picture rate that would reach zero', () => {
    expect(
      smallerBitrates({ previous: { videoBitsPerSecond: 1_000_000 }, limitBytes: 10e6, actualBytes: 10e6 }).ok,
    ).toBe(false)
    expect(
      smallerBitrates({ previous: { videoBitsPerSecond: 1_000_000 }, limitBytes: 10e6, actualBytes: 9e6 }).ok,
    ).toBe(false)
    // 1 × 0.5 × 0.9 floors to 0: nothing left to ask the recorder for.
    expect(smallerBitrates({ previous: { videoBitsPerSecond: 1 }, limitBytes: 10e6, actualBytes: 20e6 }).ok).toBe(
      false,
    )
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

  it('states the limit to the size’s precision, so a file over it never reads as under it (#905)', () => {
    // The CI case (run 45488964637): at one decimal the limit read 0.8 MB
    // beside a 0.78 MB file "over" it.
    expect(formatSizeAgainstLimit(782_907, 762_933)).toBe('0.78 MB')
    expect(formatLimitAgainstSize(762_933, 782_907)).toBe('0.76 MB')
    // The issue's arithmetic case.
    expect(formatSizeAgainstLimit(780_000, 760_000)).toBe('0.78 MB')
    expect(formatLimitAgainstSize(760_000, 780_000)).toBe('0.76 MB')
    // Deeper: four decimals for both.
    expect(formatSizeAgainstLimit(25_000_400, 24_999_900)).toBe('25.0004 MB')
    expect(formatLimitAgainstSize(24_999_900, 25_000_400)).toBe('24.9999 MB')
    // A round limit keeps its short form: trailing zeros drop.
    expect(formatLimitAgainstSize(10_000_000, 10_040_000)).toBe('10 MB')
    // Under the limit both stay at one decimal, as before.
    expect(formatSizeAgainstLimit(606_982, 693_649)).toBe('0.6 MB')
    expect(formatLimitAgainstSize(693_649, 606_982)).toBe('0.7 MB')
    expect(formatLimitAgainstSize(762_933, 700_000)).toBe('0.8 MB')
  })
})
