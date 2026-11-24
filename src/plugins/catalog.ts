import type { PluginSpec } from '../lib/plugins'
import { transitionsOf } from '../lib/timeline'
import { isPatternTransition } from './patternTransitionsIds'
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
  {
    id: 'pattern-transitions',
    name: 'Pattern transitions',
    description:
      'Adds nine transitions with patterned reveals: horizontal and vertical blinds, ' +
      'a checkerboard, a spiral, clock and radial wipes, and diamond, star and heart irises.',
    version: '1.0.0',
    load: () => import('./patternTransitions/index'),
    // As with Shaped wipes (#199): pattern transitions live in the
    // timeline, so a project carrying one depends on this plugin (#857).
    usedByProject: (_library, timeline) =>
      transitionsOf(timeline).some((transition) => isPatternTransition(transition.type)),
  },
  {
    id: 'more-export-formats',
    name: 'More export formats',
    description:
      'Adds an "Animated WebP" format to the export dialog: the composed timeline as a ' +
      'soundless, looping animation in full colour, usually smaller than a GIF.',
    version: '1.0.0',
    load: () => import('./moreFormats/index'),
    // Export formats are outputs, not project state, so no project depends
    // on this plugin (#858), as with GIF export.
  },
  {
    id: 'title-templates',
    name: 'Title templates',
    description:
      'Adds "Title template…" to the timeline\'s Add menu: a lower third, a chapter card or an ' +
      'end card, placed as ordinary text and shapes you can edit like any other.',
    version: '1.0.0',
    load: () => import('./titleTemplates/index'),
    // What a template places is ordinary text and shapes, which stay when
    // the plugin is disabled, so no project depends on it (#860).
  },
]
