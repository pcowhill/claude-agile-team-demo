import { createPcmAudioSink } from '../../lib/exportMp3'
import { exportedDuration, exportTimeline, resolveExportRange } from '../../lib/exportVideo'
import { exportFormats } from '../../lib/exportFormats'
import { totalDuration } from '../../lib/timeline'
import { APNG_FRAME_RATE, APNG_MAX_DIMENSION, WEBP_FRAME_RATE, WEBP_MAX_DIMENSION } from '../moreFormatsLimits'
import { createApngFrameSink } from './apngSink'
import { createPngSequenceFrameSink } from './pngSequenceSink'
import { encodeWav, wavLimitError } from './wavWriter'
import { createWebpFrameSink } from './webpSink'

/**
 * The More export formats plugin (#858, from the customer's pick of idea
 * 12 on #856): export formats beyond the core set, one per issue. Animated
 * WebP is the first — a looping, soundless animation in full colour, where
 * the GIF plugin (#198) has 256 colours per frame. It is built the way the
 * GIF plugin is: a frame sink on the shared export pipeline, so the frames
 * are exactly the composition every other export records, and an encoder
 * that lives in this lazy chunk. The encoder here is the browser's own
 * still-WebP encoder plus a small muxer (`webpMux.ts`), so the plugin adds
 * no dependency. Animated PNG (#864) is built the same way, from the
 * browser's still-PNG encoder and `apngMux.ts`: lossless, at the cost of
 * size. The PNG image sequence (#865) uses the same encoder for frames to
 * hand to another tool: one PNG per frame at the export's own Frame rate
 * and Frame size, in a store-only ZIP (`zipStore.ts`). WAV audio (#866) is
 * the one audio format: the MP3 export's tap of the mix, written as 16-bit
 * PCM by `wavWriter.ts`.
 */

/** The Animated WebP format's id. */
export const WEBP_FORMAT_ID = 'webp'

/** The Animated PNG format's id (#864). */
export const APNG_FORMAT_ID = 'apng'

/** The PNG image sequence format's id (#865). */
export const PNG_SEQUENCE_FORMAT_ID = 'png-sequence'

/** The WAV audio format's id (#866). */
export const WAV_FORMAT_ID = 'audio-wav'

/**
 * The sample rate the WAV format checks its length against before it
 * starts: the highest rate browsers commonly run Web Audio at. The file is
 * written at the mix's own rate, and the writer refuses at that rate too.
 */
export const WAV_PLANNING_SAMPLE_RATE = 48_000

/**
 * Whether this browser's canvas really encodes WebP. A browser that cannot
 * returns a PNG from `toDataURL('image/webp')` instead, silently, so the
 * answer is read from what comes back rather than assumed (#858).
 */
export function canvasEncodesWebp(): boolean {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    if (canvas.getContext('2d') === null) return false
    return canvas.toDataURL('image/webp').startsWith('data:image/webp')
  } catch {
    return false
  }
}

/**
 * Whether this browser's canvas can be drawn on and so encoded. Every
 * browser encodes PNG from a canvas (the HTML standard requires it), so
 * the only thing to probe is a 2D context (#864).
 */
export function canvasEncodesPng(): boolean {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    if (canvas.getContext('2d') === null) return false
    return canvas.toDataURL('image/png').startsWith('data:image/png')
  } catch {
    return false
  }
}

/** Registers the plugin's export formats; returns the undo (#197's contract). */
export function activate(): () => void {
  exportFormats.register({
    id: WEBP_FORMAT_ID,
    label: 'Animated WebP',
    extension: 'webp',
    // Encoded in the page from canvas stills, not through MediaRecorder, so
    // support is probed directly and the recorder candidate lists are empty.
    candidates: [],
    candidatesWithAudio: [],
    isSupported: canvasEncodesWebp,
    note:
      `Animated WebP is soundless and samples at ${WEBP_FRAME_RATE} fps, scaled down to at ` +
      `most ${WEBP_MAX_DIMENSION} px, in full colour.`,
    encode: (timeline, options = {}) =>
      exportTimeline(timeline, {
        ...options,
        container: { label: 'Animated WebP', candidates: [], candidatesWithAudio: [] },
        sink: createWebpFrameSink(),
      }),
  })
  exportFormats.register({
    id: APNG_FORMAT_ID,
    label: 'Animated PNG (APNG)',
    // `.png`: an APNG is a PNG, and a viewer that shows PNG but not APNG
    // still opens it, on its first frame. `.apng` is not recognised as an
    // image by every tool that plays APNG.
    extension: 'png',
    candidates: [],
    candidatesWithAudio: [],
    isSupported: canvasEncodesPng,
    note:
      `Animated PNG is soundless, lossless and large: it samples at ${APNG_FRAME_RATE} fps, ` +
      `scaled down to at most ${APNG_MAX_DIMENSION} px.`,
    encode: (timeline, options = {}) =>
      exportTimeline(timeline, {
        ...options,
        container: { label: 'Animated PNG', candidates: [], candidatesWithAudio: [] },
        sink: createApngFrameSink(),
      }),
  })
  exportFormats.register({
    id: PNG_SEQUENCE_FORMAT_ID,
    label: 'PNG image sequence (ZIP)',
    extension: 'zip',
    candidates: [],
    candidatesWithAudio: [],
    isSupported: canvasEncodesPng,
    // Unlike the two animations, no rate or size of its own: the point is
    // frames for another tool, so it takes the dialog's Frame rate and
    // Frame size as they are.
    note:
      'A ZIP of lossless PNGs, one per frame at the Frame rate and Frame size below, ' +
      'named frame-00001.png onwards. It is soundless and large.',
    encode: async (timeline, options = {}) => {
      // The window's end, by the pipeline's own rule, so the archive has a
      // file for every tick up to it (#904's review). A range that collapses
      // rejects here, with the message the pipeline would give.
      const total = totalDuration(timeline)
      const end = resolveExportRange(total, options.range)?.end ?? total
      return exportTimeline(timeline, {
        ...options,
        container: { label: 'PNG image sequence', candidates: [], candidatesWithAudio: [] },
        sink: createPngSequenceFrameSink({ frameRate: options.frameRate, end }),
      })
    },
  })
  exportFormats.register({
    id: WAV_FORMAT_ID,
    label: 'WAV audio (uncompressed)',
    extension: 'wav',
    candidates: [],
    candidatesWithAudio: [],
    // The MP3 export's tap (#269) with a WAV writer in place of LAME, so it
    // hears exactly the samples the other audio exports do.
    audioOnly: true,
    note:
      'Saves just the mixed soundtrack as 16-bit stereo PCM at the mix’s own sample rate, ' +
      'usually 44.1 or 48 kHz: about 10–11.5 MB per minute. The file has no video track.',
    isSupported: () => typeof AudioContext !== 'undefined',
    encode: async (timeline, options = {}) => {
      // Refused before it runs, not after: a WAV past 4 GB is hours long.
      const seconds = exportedDuration(timeline, options.range)
      const limit = wavLimitError(Math.ceil(seconds * WAV_PLANNING_SAMPLE_RATE), WAV_PLANNING_SAMPLE_RATE)
      if (limit !== null) throw new Error(limit)
      return exportTimeline(timeline, {
        ...options,
        audioOnly: true,
        audioSink: createPcmAudioSink(async (left, right, sampleRate) => encodeWav(left, right, sampleRate), 'WAV'),
      })
    },
  })
  return () => {
    exportFormats.unregister(WEBP_FORMAT_ID)
    exportFormats.unregister(APNG_FORMAT_ID)
    exportFormats.unregister(PNG_SEQUENCE_FORMAT_ID)
    exportFormats.unregister(WAV_FORMAT_ID)
  }
}
