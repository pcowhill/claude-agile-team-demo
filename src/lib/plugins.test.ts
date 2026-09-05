import { describe, expect, it, vi } from 'vitest'
import { ENABLED_PLUGINS_KEY, PluginRuntime, loadEnabledPluginIds } from './plugins'
import type { PluginModule, PluginSpec, PluginStorage } from './plugins'
import { emptyLibrary } from './mediaLibrary'
import { emptyTimeline } from './timeline'

/** An in-memory Storage slice, so persistence is observable and hermetic. */
function memoryStorage(initial: Record<string, string> = {}): PluginStorage & {
  data: Map<string, string>
} {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  }
}

/** A fixture plugin whose module records activations and deactivations. */
function fixturePlugin(
  id: string,
  overrides: Partial<PluginSpec> = {},
): { spec: PluginSpec; loads: () => number; activations: () => number; active: () => boolean } {
  let loads = 0
  let activations = 0
  let active = false
  const module: PluginModule = {
    activate: () => {
      activations++
      active = true
      return () => {
        active = false
      }
    },
  }
  const spec: PluginSpec = {
    id,
    name: id.toUpperCase(),
    description: `The ${id} plugin.`,
    version: '1.0.0',
    load: () => {
      loads++
      return Promise.resolve(module)
    },
    ...overrides,
  }
  return { spec, loads: () => loads, activations: () => activations, active: () => active }
}

describe('PluginRuntime enable/disable (#197)', () => {
  it('enable loads the chunk, activates, and persists; disable deactivates and persists', async () => {
    const storage = memoryStorage()
    const fixture = fixturePlugin('sample')
    const runtime = new PluginRuntime([fixture.spec], storage)

    expect(runtime.status('sample')).toEqual({ kind: 'disabled' })
    await runtime.enable('sample')
    expect(runtime.status('sample')).toEqual({ kind: 'enabled' })
    expect(fixture.active()).toBe(true)
    expect(storage.data.get(ENABLED_PLUGINS_KEY)).toBe('["sample"]')

    runtime.disable('sample')
    expect(runtime.status('sample')).toEqual({ kind: 'disabled' })
    expect(fixture.active()).toBe(false)
    expect(storage.data.get(ENABLED_PLUGINS_KEY)).toBe('[]')
  })

  it('re-enabling reuses the loaded module but activates again', async () => {
    const fixture = fixturePlugin('sample')
    const runtime = new PluginRuntime([fixture.spec], memoryStorage())
    await runtime.enable('sample')
    runtime.disable('sample')
    await runtime.enable('sample')
    expect(fixture.loads()).toBe(1)
    expect(fixture.activations()).toBe(2)
    expect(fixture.active()).toBe(true)
  })

  it('enabling an already-enabled plugin is a no-op', async () => {
    const fixture = fixturePlugin('sample')
    const runtime = new PluginRuntime([fixture.spec], memoryStorage())
    await runtime.enable('sample')
    await runtime.enable('sample')
    expect(fixture.activations()).toBe(1)
  })

  it('concurrent enables share one load and one activation', async () => {
    const fixture = fixturePlugin('sample')
    const runtime = new PluginRuntime([fixture.spec], memoryStorage())
    await Promise.all([runtime.enable('sample'), runtime.enable('sample')])
    expect(fixture.loads()).toBe(1)
    expect(fixture.activations()).toBe(1)
  })

  it('rejects an unknown plugin id', async () => {
    const runtime = new PluginRuntime([], memoryStorage())
    await expect(runtime.enable('nope')).rejects.toThrow(/Unknown plugin 'nope'/)
  })

  it('refuses a catalog with a duplicated id — silent shadowing would be a bug', () => {
    const a = fixturePlugin('sample').spec
    const b = fixturePlugin('sample').spec
    expect(() => new PluginRuntime([a, b], memoryStorage())).toThrow(/appears twice/)
  })

  it('shows loading while the chunk downloads, and disable during loading wins', async () => {
    let resolveLoad: (module: PluginModule) => void
    const module: PluginModule = { activate: vi.fn(() => () => {}) }
    const spec: PluginSpec = {
      id: 'slow',
      name: 'Slow',
      description: 'Loads slowly.',
      version: '1.0.0',
      load: () =>
        new Promise<PluginModule>((resolve) => {
          resolveLoad = resolve
        }),
    }
    const storage = memoryStorage()
    const runtime = new PluginRuntime([spec], storage)
    const enabling = runtime.enable('slow')
    expect(runtime.status('slow')).toEqual({ kind: 'loading' })

    runtime.disable('slow')
    resolveLoad!(module)
    await enabling
    expect(runtime.status('slow')).toEqual({ kind: 'disabled' })
    expect(module.activate).not.toHaveBeenCalled()
    expect(storage.data.has(ENABLED_PLUGINS_KEY)).toBe(false)
  })

  it('a failed load reports failure, does not persist, and the next enable retries', async () => {
    let attempts = 0
    const fixture = fixturePlugin('flaky', {
      load: () => {
        attempts++
        if (attempts === 1) return Promise.reject(new Error('chunk unreachable'))
        return Promise.resolve({ activate: () => () => {} })
      },
    })
    const storage = memoryStorage()
    const runtime = new PluginRuntime([fixture.spec], storage)
    await runtime.enable('flaky')
    expect(runtime.status('flaky')).toEqual({ kind: 'failed', message: 'chunk unreachable' })
    expect(storage.data.has(ENABLED_PLUGINS_KEY)).toBe(false)

    await runtime.enable('flaky')
    expect(runtime.status('flaky')).toEqual({ kind: 'enabled' })
    expect(attempts).toBe(2)
  })

  it('a throwing activate reports failure instead of half-enabling', async () => {
    const fixture = fixturePlugin('broken', {
      load: () =>
        Promise.resolve({
          activate: () => {
            throw new Error('activation exploded')
          },
        }),
    })
    const runtime = new PluginRuntime([fixture.spec], memoryStorage())
    await runtime.enable('broken')
    expect(runtime.status('broken')).toEqual({ kind: 'failed', message: 'activation exploded' })
    expect(runtime.isEnabled('broken')).toBe(false)
  })

  it('notifies subscribers on every state change', async () => {
    const fixture = fixturePlugin('sample')
    const runtime = new PluginRuntime([fixture.spec], memoryStorage())
    const listener = vi.fn()
    const unsubscribe = runtime.subscribe(listener)
    const before = runtime.version
    await runtime.enable('sample')
    expect(listener).toHaveBeenCalled()
    expect(runtime.version).toBeGreaterThan(before)

    listener.mockClear()
    unsubscribe()
    runtime.disable('sample')
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('startup restore (#197)', () => {
  it('re-activates persisted plugins', async () => {
    const fixture = fixturePlugin('sample')
    const storage = memoryStorage({ [ENABLED_PLUGINS_KEY]: '["sample"]' })
    const runtime = new PluginRuntime([fixture.spec], storage)
    await runtime.restore()
    expect(runtime.isEnabled('sample')).toBe(true)
    expect(fixture.activations()).toBe(1)
  })

  it('is memoized, so awaiting it twice restores once', async () => {
    const fixture = fixturePlugin('sample')
    const storage = memoryStorage({ [ENABLED_PLUGINS_KEY]: '["sample"]' })
    const runtime = new PluginRuntime([fixture.spec], storage)
    await Promise.all([runtime.restore(), runtime.restore()])
    await runtime.restore()
    expect(fixture.activations()).toBe(1)
  })

  it('skips ids the catalog no longer knows and plugins that fail to load', async () => {
    const good = fixturePlugin('good')
    const bad = fixturePlugin('bad', { load: () => Promise.reject(new Error('gone')) })
    const storage = memoryStorage({
      [ENABLED_PLUGINS_KEY]: '["removed-plugin","bad","good"]',
    })
    const runtime = new PluginRuntime([good.spec, bad.spec], storage)
    await runtime.restore()
    expect(runtime.isEnabled('good')).toBe(true)
    expect(runtime.status('bad')).toEqual({ kind: 'failed', message: 'gone' })
  })

  it('tolerates a corrupt or missing store', async () => {
    const fixture = fixturePlugin('sample')
    const corrupt = memoryStorage({ [ENABLED_PLUGINS_KEY]: 'not json' })
    await new PluginRuntime([fixture.spec], corrupt).restore()
    const throwing: PluginStorage = {
      getItem: () => {
        throw new Error('storage blocked')
      },
      setItem: () => {
        throw new Error('storage blocked')
      },
    }
    const runtime = new PluginRuntime([fixture.spec], throwing)
    await runtime.restore()
    // Enabling still works in-session even when persistence is blocked.
    await runtime.enable('sample')
    expect(runtime.isEnabled('sample')).toBe(true)
  })
})

describe('loadEnabledPluginIds (#197)', () => {
  it('reads the persisted array and drops non-string entries', () => {
    const storage = memoryStorage({ [ENABLED_PLUGINS_KEY]: '["a",3,"b",null]' })
    expect(loadEnabledPluginIds(storage)).toEqual(['a', 'b'])
  })

  it('is empty for missing, corrupt, or non-array values and a null store', () => {
    expect(loadEnabledPluginIds(memoryStorage())).toEqual([])
    expect(loadEnabledPluginIds(memoryStorage({ [ENABLED_PLUGINS_KEY]: '{}' }))).toEqual([])
    expect(loadEnabledPluginIds(memoryStorage({ [ENABLED_PLUGINS_KEY]: '!' }))).toEqual([])
    expect(loadEnabledPluginIds(null)).toEqual([])
  })
})

describe('projectPlugins (#197, #199)', () => {
  it('names every plugin whose predicate says the project uses it, enabled or not', async () => {
    const used = fixturePlugin('used', { usedByProject: () => true })
    const unused = fixturePlugin('unused', { usedByProject: () => false })
    const noPredicate = fixturePlugin('formats-only')
    const disabled = fixturePlugin('disabled-but-used', { usedByProject: () => true })
    const runtime = new PluginRuntime(
      [used.spec, unused.spec, noPredicate.spec, disabled.spec],
      memoryStorage(),
    )
    await Promise.all([
      runtime.enable('used'),
      runtime.enable('unused'),
      runtime.enable('formats-only'),
    ])
    // 'disabled-but-used' is recorded despite being disabled (#199):
    // disabling tears down contributions, not user edits, so a plugin's
    // features (a pack transition on the timeline) can outlive its enabled
    // state — the saved file must still name the dependency.
    expect(runtime.projectPlugins(emptyLibrary, emptyTimeline)).toEqual([
      'used',
      'disabled-but-used',
    ])
  })
})
