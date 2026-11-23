import { exportTimeline } from '../../lib/exportVideo'
import { exportFormats } from '../../lib/exportFormats'
import { WEBP_FRAME_RATE, WEBP_MAX_DIMENSION } from '../moreFormatsLimits'
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
 * no dependency.
 */

/** The Animated WebP format's id. */
export const WEBP_FORMAT_ID = 'webp'

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
  return () => exportFormats.unregister(WEBP_FORMAT_ID)
}
