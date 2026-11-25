import type { PluginSpec } from '../lib/plugins'
import { pictureEffectsOf, textsOf, transitionsOf } from '../lib/timeline'
import { isFontPackFont } from './fontPackIds'
import { isPatternTransition } from './patternTransitionsIds'
import { isShapedWipeTransition } from './shapedWipesIds'
import { isVisualEffect } from './visualEffectsIds'

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
    id: 'visual-effects',
    name: 'Visual effects',
    description:
      'Adds picture effects for a stretch of a clip: a vignette that darkens the edges of ' +
      'the frame, and a blur over the whole picture. Each eases in and out.',
    version: '1.0.0',
    load: () => import('./visualEffects/index'),
    // Picture effects live in the timeline, so a project carrying one of
    // this plugin's depends on it (#862), as with the transition packs.
    usedByProject: (_library, timeline) =>
      pictureEffectsOf(timeline).some((effect) => isVisualEffect(effect.type)),
  },
  {
    id: 'more-export-formats',
    name: 'More export formats',
    description:
      'Adds "Animated WebP" and "Animated PNG (APNG)" formats to the export dialog: the ' +
      'composed timeline as a soundless, looping animation in full colour. The WebP is ' +
      'usually smaller than a GIF; the APNG is lossless, and larger. Also "PNG image ' +
      'sequence (ZIP)", one lossless PNG per frame, and "WAV audio (uncompressed)", the ' +
      'soundtrack as lossless 16-bit stereo.',
    version: '1.0.0',
    load: () => import('./moreFormats/index'),
    // Export formats are outputs, not project state, so no project depends
    // on this plugin (#858), as with GIF export.
  },
  {
    id: 'title-templates',
    name: 'Title templates',
    description:
      'Adds "Title template…" to the timeline\'s Add menu: lower thirds, chapter cards and end ' +
      'cards in several styles, a call-out and a step badge, placed as ordinary text and shapes ' +
      'you can edit like any other.',
    version: '1.0.0',
    load: () => import('./titleTemplates/index'),
    // What a template places is ordinary text and shapes, which stay when
    // the plugin is disabled, so no project depends on it (#860).
  },
  {
    id: 'sound-library',
    name: 'Sound library',
    description:
      'Adds "Sound library…" to the Media Library: short sound effects such as a whoosh, a click ' +
      'or a ding, free to use without credit, each added to the library as an ordinary audio clip.',
    version: '1.0.0',
    load: () => import('./soundLibrary/index'),
    // An added sound is an ordinary library clip, imported like a picked
    // file, so no project depends on this plugin (#861).
  },
  {
    id: 'font-pack',
    name: 'Font pack',
    description:
      'Adds ten open-licence typefaces to every Font menu: rounded, geometric, condensed and ' +
      'display sans-serifs, a slab and an elegant serif, a typewriter, a handwritten script, a ' +
      'comic face and a pixel face. Each downloads from this site the first time it is used.',
    version: '1.0.0',
    load: () => import('./fontPack/index'),
    // A text overlay or the subtitle style that names a pack font needs the
    // pack to draw it, so the project depends on this plugin (#867). The
    // predicate reads only the id list, never the plugin's lazy chunk.
    usedByProject: (_library, timeline) =>
      textsOf(timeline).some((text) => isFontPackFont(text.font)) ||
      (timeline.subtitleStyle !== undefined && isFontPackFont(timeline.subtitleStyle.font)),
  },
]
