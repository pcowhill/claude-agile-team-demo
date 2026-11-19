/**
 * The export's Size limit (#726, from the approved suggestion #693): a file
 * size the export aims under, by giving the browser's recorder a bitrate
 * worked out from the limit and the exported duration. `MediaRecorder` with
 * only a `mimeType` picks its own bitrate, and a screen recording then comes
 * out far larger than its content needs. Most places a tutorial is sent cap
 * uploads, at about 25 MB for e-mail.
 *
 * Everything here is arithmetic, so the export dialog's estimate line and
 * the export itself compute the same numbers from the same function.
 */

/** A megabyte as upload limits count it, and as the dialog states sizes. */
export const BYTES_PER_MB = 1_000_000

/** The limits the dialog offers besides No limit and Custom…, in MB. */
export const SIZE_LIMIT_PRESETS_MB = [10, 25, 100] as const

/**
 * The share of the limit the export does **not** aim at. A recorder treats
 * its bitrate as a target, not a ceiling: it encodes at a variable rate, and
 * the container adds its own bytes. The value was set from the overshoot
 * measured in Chromium and Firefox for #726 (the PR states the runs); see
 * `docs/guide/export.md`, which tells the user the limit is aimed at, not
 * guaranteed.
 */
export const SIZE_LIMIT_MARGIN = 0.1

/**
 * The bitrate kept for the sound in a video export that carries sound, in
 * bits per second. It is passed to the recorder as `audioBitsPerSecond`, so
 * the reservation is what the recorder is asked for rather than a guess at
 * its default. 128 kbit/s Opus is transparent for speech and comfortably
 * good for music.
 */
export const RESERVED_AUDIO_BITRATE = 128_000

/**
 * The most an audio-only export is asked for. Opus tops out at 510 kbit/s,
 * so a generous limit on a short soundtrack is capped rather than sent to
 * the recorder as a rate it cannot use.
 */
export const MAX_AUDIO_ONLY_BITRATE = 510_000

/**
 * The least an audio-only export may be asked for: Opus's own floor. Below
 * it there is no recording to make, so the limit is refused as too small.
 */
export const MIN_AUDIO_ONLY_BITRATE = 6_000

/**
 * Bits per pixel per frame below which screen text blurs (the estimate
 * line's warning). 0.03 is about 830 kbit/s at 1280×720 and 30 fps. A
 * browser's recorder is a real-time encoder, tuned for speed over
 * efficiency, and screen text is the detail it loses first: its edges are
 * one or two pixels wide. Mostly still screen content stays sharp well
 * below the rates camera footage needs (around 0.1), so the line sits at
 * the low end of what keeps text readable while the picture changes. It
 * is a reading for the user, not a guarantee: the actual file is the
 * evidence, and the dialog states its size.
 */
export const BLUR_BITS_PER_PIXEL = 0.03

/** What the recorder is given for a limit: both rates in bits per second. */
export interface SizeLimitBitrates {
  /** Absent for an audio-only export, which records no video track. */
  videoBitsPerSecond?: number
  /** Absent for a video export that carries no sound. */
  audioBitsPerSecond?: number
}

export type SizeLimitResult =
  | { ok: true; bitrates: SizeLimitBitrates }
  | { ok: false; error: string }

/**
 * The bitrates that aim an export under `limitBytes` (#726).
 *
 * The budget is the limit less `SIZE_LIMIT_MARGIN`, spread over the
 * exported duration:
 * - **a video export with sound** reserves `RESERVED_AUDIO_BITRATE` for the
 *   sound, and the video gets the rest;
 * - **a video export without sound** gives the video all of it;
 * - **an audio-only export** gives the sound all of it, within Opus's range.
 *
 * A limit too small to leave any video bitrate after the sound's reserve
 * (or, for sound alone, less than Opus's floor) is refused with a message.
 * It is never sent to the recorder as a zero or negative rate.
 */
export function sizeLimitBitrates({
  limitBytes,
  durationSeconds,
  audio,
  audioOnly = false,
}: {
  limitBytes: number
  durationSeconds: number
  /** Whether the recording carries a sound track. */
  audio: boolean
  /** Whether it records sound alone (#245). */
  audioOnly?: boolean
}): SizeLimitResult {
  if (!(limitBytes > 0) || !Number.isFinite(limitBytes)) {
    return { ok: false, error: 'The size limit must be a number of MB above 0.' }
  }
  if (!(durationSeconds > 0) || !Number.isFinite(durationSeconds)) {
    return { ok: false, error: 'There is nothing to export.' }
  }
  const budget = Math.floor((limitBytes * 8 * (1 - SIZE_LIMIT_MARGIN)) / durationSeconds)
  const limit = formatMegabytes(limitBytes)
  const length = formatSeconds(durationSeconds)
  if (audioOnly) {
    if (budget < MIN_AUDIO_ONLY_BITRATE) {
      return {
        ok: false,
        error: `A ${limit} limit is too small for ${length} of sound. Choose a larger limit or a shorter range.`,
      }
    }
    return { ok: true, bitrates: { audioBitsPerSecond: Math.min(budget, MAX_AUDIO_ONLY_BITRATE) } }
  }
  const video = audio ? budget - RESERVED_AUDIO_BITRATE : budget
  if (video <= 0) {
    return {
      ok: false,
      error: audio
        ? `A ${limit} limit leaves no room for the picture over ${length} once the sound has its ${formatBitrate(RESERVED_AUDIO_BITRATE)}. Choose a larger limit or a shorter range.`
        : `A ${limit} limit is too small for ${length} of video. Choose a larger limit or a shorter range.`,
    }
  }
  return {
    ok: true,
    bitrates: audio
      ? { videoBitsPerSecond: video, audioBitsPerSecond: RESERVED_AUDIO_BITRATE }
      : { videoBitsPerSecond: video },
  }
}

/**
 * The recorder MIME candidates for a size-limited export: VP8 ahead of VP9,
 * everything else in its place. Measured for #726 in Chromium on a 60 s,
 * 1280×720 screen-like export: asked for a 5 MB limit, VP9 wrote 9.7 MB
 * (193 % of the limit) and VP8 4.0 MB (81 %); at 8 MB, 10.5 MB against
 * 5.7 MB. Chromium's VP9 recorder all but ignores `videoBitsPerSecond` on
 * this content, and VP8 holds it. VP9 stays first without a limit, where it
 * makes the smaller file for the same picture. Firefox records VP8 either
 * way; an MP4 list (H.264) is unaffected.
 */
export function rateControlledCandidates(candidates: readonly string[]): string[] {
  const codec = (type: string) => (/codecs=vp8/i.test(type) ? 0 : /codecs=vp9/i.test(type) ? 1 : -1)
  const ordered = [...candidates]
  const slots = ordered.flatMap((type, index) => (codec(type) === -1 ? [] : [index]))
  const vp = slots.map((index) => ordered[index]).sort((a, b) => codec(a) - codec(b))
  slots.forEach((index, i) => {
    ordered[index] = vp[i]
  })
  return ordered
}

/**
 * The options the export's `MediaRecorder` is created with. With no limit it
 * is the MIME type alone, exactly as before #726, so the browser keeps
 * choosing the bitrate. With one, the limit's rates join it.
 */
export function recorderOptions(
  mimeType: string,
  bitrates: SizeLimitBitrates | null,
): MediaRecorderOptions {
  return bitrates === null ? { mimeType } : { mimeType, ...bitrates }
}

/**
 * How the estimate line reads a video bitrate at an output size: the rate
 * ("about 1.4 Mbit/s") and what it means for screen text there.
 */
export function videoBitrateReading({
  videoBitsPerSecond,
  width,
  height,
  frameRate,
}: {
  videoBitsPerSecond: number
  width: number
  height: number
  frameRate: number
}): { blurry: boolean; rate: string; reading: string } {
  const bitsPerPixel = videoBitsPerSecond / (width * height * frameRate)
  const blurry = bitsPerPixel < BLUR_BITS_PER_PIXEL
  return {
    blurry,
    rate: `about ${formatBitrate(videoBitsPerSecond)}`,
    reading: blurry
      ? `text will be blurry at ${width}×${height}; consider a larger limit or a smaller output size`
      : `fine for screen text at ${width}×${height}`,
  }
}

/** "1.4 Mbit/s", "830 kbit/s". */
export function formatBitrate(bitsPerSecond: number): string {
  if (bitsPerSecond >= 1_000_000) {
    const mbit = bitsPerSecond / 1_000_000
    return `${mbit >= 10 ? Math.round(mbit) : mbit.toFixed(1)} Mbit/s`
  }
  return `${Math.round(bitsPerSecond / 1000)} kbit/s`
}

/** "23.1 MB", "0.4 MB", "25 MB": one decimal, dropped when it is zero. */
export function formatMegabytes(bytes: number, decimals = 1): string {
  const scale = 10 ** decimals
  const mb = Math.round((bytes / BYTES_PER_MB) * scale) / scale
  return `${Number.isInteger(mb) ? mb.toFixed(0) : String(mb)} MB`
}

/**
 * A file's size against its limit, as the dialog states it: one decimal,
 * or as many more as it takes for a file over the limit not to read as
 * the limit itself ("25.04 MB", never "25 MB — over the 25 MB limit").
 */
export function formatSizeAgainstLimit(bytes: number, limitBytes: number): string {
  let decimals = 1
  while (
    bytes > limitBytes &&
    decimals < 6 &&
    formatMegabytes(bytes, decimals) === formatMegabytes(limitBytes, decimals)
  ) {
    decimals++
  }
  return formatMegabytes(bytes, decimals)
}

/** "1:05", "0:12": minutes and whole seconds, for messages. */
function formatSeconds(seconds: number): string {
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}
