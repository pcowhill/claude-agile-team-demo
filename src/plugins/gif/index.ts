import { exportTimeline } from '../../lib/exportVideo'
import { exportFormats } from '../../lib/exportFormats'
import { createGifFrameSink, GIF_FRAME_RATE, GIF_MAX_DIMENSION } from './gifSink'

/**
 * The GIF export plugin (#198) — the first official plugin (phase 3 of the
 * customer-approved plugin architecture, #183/ADR 0003), replacing the
 * sample plugin that #197 shipped as a placeholder. Enabling it contributes
 * an "Animated GIF" format to the export-format registry; the frames come
 * from exactly the composition the WebM export records (the shared
 * pipeline's frame sink, exportVideo.ts), encoded by `gifenc` inside this
 * lazy chunk. GIF is soundless by nature; the sink-driven pipeline skips
 * audio, and the format's `note` says so in the export modal along with the
 * frame-rate and size caps (gifSink.ts documents why those numbers).
 */

/** The contributed format's id — what the picker selection and project-
 * independent UI state key off. */
export const GIF_FORMAT_ID = 'gif'

/** Registers the GIF export format; returns the undo (#197's contract). */
export function activate(): () => void {
  exportFormats.register({
    id: GIF_FORMAT_ID,
    label: 'Animated GIF',
    extension: 'gif',
    // GIF encodes in pure JS — no MediaRecorder involved — so support is
    // probed directly (`isSupported` below) and the recorder MIME candidate
    // lists are deliberately empty.
    candidates: [],
    candidatesWithAudio: [],
    // The pipeline's sink path needs a readable 2D canvas; that is the whole
    // requirement (the entry pipeline verifies it again at export time).
    isSupported: () => document.createElement('canvas').getContext('2d') !== null,
    note:
      `GIFs are soundless and sample at ${GIF_FRAME_RATE} fps, scaled down to at ` +
      `most ${GIF_MAX_DIMENSION} px, to keep files manageable.`,
    encode: (timeline, options = {}) =>
      exportTimeline(timeline, {
        ...options,
        container: { label: 'Animated GIF', candidates: [], candidatesWithAudio: [] },
        sink: createGifFrameSink(),
      }),
  })
  return () => exportFormats.unregister(GIF_FORMAT_ID)
}
