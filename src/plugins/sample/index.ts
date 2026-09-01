import {
  EXPORT_MIME_CANDIDATES,
  EXPORT_MIME_CANDIDATES_WITH_AUDIO,
  exportTimeline,
} from '../../lib/exportVideo'
import { exportFormats } from '../../lib/exportFormats'

/**
 * The sample plugin (#197): the trivial built-in plugin that proves the
 * plugin chain — lazy chunk, activate/deactivate, an export-format
 * registration — until the GIF export plugin (phase 3, #198) replaces it as
 * the first real one. It is honest about being a demonstration: the format
 * it contributes is fully functional but deliberately redundant, encoding
 * WebM through the exact pipeline the core WebM format uses.
 */

/**
 * A string that exists in this lazy chunk and nowhere else, so the
 * bundle-discipline check (`tools/checkPluginChunks.ts`) can prove the
 * plugin's code is not part of the entry bundle. Keep it out of every
 * eagerly-loaded module — the catalog references this plugin only by id.
 */
export const SAMPLE_PLUGIN_MARKER = 'bve-plugin-chunk:sample-webm'

/** The contributed format's id — what project-independent UI state (the
 * picker selection) and the download name key off. */
export const SAMPLE_FORMAT_ID = 'sample-webm'

/** Registers the sample export format; returns the undo (#197). */
export function activate(): () => void {
  exportFormats.register({
    id: SAMPLE_FORMAT_ID,
    label: 'Sample (WebM)',
    extension: 'webm',
    candidates: EXPORT_MIME_CANDIDATES,
    candidatesWithAudio: EXPORT_MIME_CANDIDATES_WITH_AUDIO,
    encode: (timeline, options = {}) =>
      exportTimeline(timeline, {
        ...options,
        container: {
          label: 'Sample (WebM)',
          candidates: EXPORT_MIME_CANDIDATES,
          candidatesWithAudio: EXPORT_MIME_CANDIDATES_WITH_AUDIO,
        },
      }),
  })
  return () => exportFormats.unregister(SAMPLE_FORMAT_ID)
}
