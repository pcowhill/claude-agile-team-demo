import type { PluginSpec } from '../lib/plugins'

/**
 * The built-in plugin catalog (#197, ADR 0003): every plugin this build
 * ships, in the order the manager UI lists them. This module is part of the
 * entry bundle, so it carries descriptions only — each plugin's code lives
 * behind its `load()`'s dynamic `import()`, shipped as a lazy chunk that
 * downloads when the plugin is first enabled (bundle discipline is checked
 * in CI — `tools/checkPluginChunks.ts`).
 *
 * Adding a plugin = adding an entry here plus its module under
 * `src/plugins/<id>/`. The GIF export plugin (phase 3, #198) is the first
 * real one; until it lands, the sample plugin proves the chain end to end.
 */
export const builtInPlugins: readonly PluginSpec[] = [
  {
    id: 'sample-webm',
    name: 'Sample plugin',
    description:
      'Demonstrates the plugin system: adds a "Sample (WebM)" export format that encodes ' +
      'through the same pipeline as the built-in WebM export. Safe to enable or disable ' +
      'at any time; it will be retired when the first real plugin arrives.',
    version: '1.0.0',
    load: () => import('./sample/index'),
    // The sample contributes only an export format, which projects do not
    // store — no project ever depends on it (`usedByProject` omitted).
  },
]
