import { PluginRuntime } from '../lib/plugins'
import { builtInPlugins } from './catalog'

/**
 * The app's plugin runtime (#197): one instance over the built-in catalog,
 * persisting to the browser's localStorage. `main.tsx` kicks off
 * `pluginRuntime.restore()` at startup so persisted plugins re-activate
 * before anyone needs them; paths that must see the restored state (the
 * project-open dependency check) await the same memoized promise instead of
 * racing it. Tests construct their own `PluginRuntime` with fixture specs —
 * this singleton is the app wiring, not the seam.
 */
export const pluginRuntime = new PluginRuntime(builtInPlugins)
