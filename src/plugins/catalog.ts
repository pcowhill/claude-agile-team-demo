import type { PluginSpec } from '../lib/plugins'
import { transitionsOf } from '../lib/timeline'
import { isShapedWipeTransition } from './shapedWipesIds'

/**
 * The built-in plugin catalog (#197, ADR 0003): every plugin this build
 * ships, in the order the manager UI lists them. This module is part of the
 * entry bundle, so it carries descriptions only — each plugin's code lives
 * behind its `load()`'s dynamic `import()`, shipped as a lazy chunk that
 * downloads when the plugin is first enabled (bundle discipline is checked
 * in CI — `tools/checkPluginChunks.ts`).
 *
 * Adding a plugin = adding an entry here plus its module under
 * `src/plugins/<id>/`. The GIF export plugin (#198) is the first real one;
 * it retired the sample plugin that #197 shipped as a placeholder.
 */
export const builtInPlugins: readonly PluginSpec[] = [
  {
    id: 'gif-export',
    name: 'GIF export',
    description:
      'Adds an "Animated GIF" format to the export dialog: the composed timeline — ' +
      'transitions, zooms, overlays, text and all — encoded as a soundless animated GIF, ' +
      'downscaled and rate-capped to keep file sizes manageable.',
    version: '1.0.0',
    load: () => import('./gif/index'),
    // The plugin contributes only an export format, which projects do not
    // store — no project ever depends on it (`usedByProject` omitted).
  },
  {
    id: 'shaped-wipes',
    name: 'Shaped wipes',
    description:
      'Adds seven transitions with richer reveal shapes than the core edge wipes: ' +
      'box open, barn doors, letterbox, and four corner wipes.',
    version: '1.0.0',
    load: () => import('./shapedWipes/index'),
    // Pack transitions live in the timeline, so a project that carries one
    // depends on this plugin (#199). The predicate reads only the id list
    // (top-level wiring), never the plugin's lazy chunk.
    usedByProject: (_library, timeline) =>
      transitionsOf(timeline).some((transition) => isShapedWipeTransition(transition.type)),
  },
]
