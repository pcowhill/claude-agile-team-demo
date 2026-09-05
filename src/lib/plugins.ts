import type { MediaLibraryState } from './mediaLibrary'
import type { TimelineState } from './timeline'

/**
 * The plugin runtime (#197, ADR 0003): plugins are built-in optional modules,
 * code-split into lazy chunks, enabled through the manager UI. Enabling a
 * plugin loads its chunk with `import()` and calls its `activate`, which
 * makes the plugin's registrations (e.g. into the export-format registry)
 * and returns the function that undoes them. The enabled set persists in
 * `localStorage`, and persisted plugins re-activate on startup.
 *
 * Disable semantics (the #197 rule): disabling deactivates immediately — the
 * plugin's contributions unregister and disappear from the UI (e.g. its
 * export format leaves the picker). Work already in flight is not torn down:
 * an export that started under the plugin's encoder runs to completion,
 * because the encoder captured everything it needs when it began.
 *
 * **`PluginSpec` and the activate/deactivate shape are a contract every
 * built-in plugin depends on** (#183's API-stability concern, ADR 0003):
 * change them deliberately, updating every catalog entry and ADR 0003 in the
 * same PR.
 */

/** The shape a plugin's lazy-loaded module must export. */
export interface PluginModule {
  /**
   * Makes the plugin's registrations and returns the function that undoes
   * every one of them. Called once per enable; the returned deactivate is
   * called once per disable.
   */
  activate: () => () => void
}

/** A built-in plugin as described in the catalog (`src/plugins/catalog.ts`). */
export interface PluginSpec {
  /** Stable identifier, unique in the catalog (e.g. 'gif-export'). Project
   * files record dependencies by this id, so it must never be reused for a
   * different plugin. */
  id: string
  /** Human-readable name, shown in the manager UI and enable prompts. */
  name: string
  /** One or two sentences on what enabling the plugin adds. */
  description: string
  /** The plugin's own version, shown in the manager UI. */
  version: string
  /**
   * Loads the plugin's code. Must be a dynamic `import()` of a module under
   * `src/plugins/` so the code ships as its own lazy chunk, outside the
   * entry bundle (checked in CI — `tools/checkPluginChunks.ts`).
   */
  load: () => Promise<PluginModule>
  /**
   * Whether a project's saveable state uses this plugin's features — the
   * predicate behind recording plugin dependencies in project files and
   * prompt-and-enable on open (ADR 0003). Omitted means the plugin's
   * features never live in a project (e.g. it only contributes an export
   * format, which a project does not store).
   */
  usedByProject?: (library: MediaLibraryState, timeline: TimelineState) => boolean
}

/** What the manager UI shows for one plugin. */
export type PluginStatus =
  | { kind: 'disabled' }
  /** The chunk is downloading; the toggle is disabled meanwhile. */
  | { kind: 'loading' }
  | { kind: 'enabled' }
  /** The last enable attempt failed (chunk unreachable, activate threw). */
  | { kind: 'failed'; message: string }

export const ENABLED_PLUGINS_KEY = 'browser-video-editor.plugins.enabled'

/** The slice of Storage this needs; injectable so tests stay deterministic. */
export type PluginStorage = Pick<Storage, 'getItem' | 'setItem'>

function defaultStorage(): PluginStorage | null {
  // Accessing localStorage itself can throw (storage disabled entirely).
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** The persisted enabled set: a JSON array of plugin ids. Never throws —
 * a missing, blocked, or corrupt store means "nothing enabled". */
export function loadEnabledPluginIds(storage: PluginStorage | null): string[] {
  try {
    const raw = storage?.getItem(ENABLED_PLUGINS_KEY)
    if (raw === null || raw === undefined) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is string => typeof value === 'string')
  } catch {
    return []
  }
}

function saveEnabledPluginIds(ids: readonly string[], storage: PluginStorage | null): void {
  try {
    storage?.setItem(ENABLED_PLUGINS_KEY, JSON.stringify(ids))
  } catch {
    // Best-effort: a full or blocked store loses only the persistence,
    // never the in-session enablement.
  }
}

/**
 * Owns the lifecycle of the built-in plugins: what is enabled, loading the
 * lazy chunks, activation/deactivation, persistence, and change
 * notifications for the React UI (subscribe/version pair for
 * `useSyncExternalStore`). The app uses one instance
 * (`src/plugins/runtime.ts`); tests construct their own with fixture specs.
 */
export class PluginRuntime {
  private readonly catalog: readonly PluginSpec[]
  private readonly storage: PluginStorage | null
  /** Loaded modules, kept so re-enabling never re-fetches the chunk. */
  private readonly modules = new Map<string, Promise<PluginModule>>()
  /** Deactivate functions of currently active plugins. */
  private readonly active = new Map<string, () => void>()
  /** Plugins whose chunk is loading toward activation. */
  private readonly loading = new Set<string>()
  /** In-flight enables, so concurrent callers share one completion. */
  private readonly enabling = new Map<string, Promise<void>>()
  /** Last enable failure per plugin, cleared on the next attempt. */
  private readonly failures = new Map<string, string>()
  private readonly listeners = new Set<() => void>()
  /** Monotonic change counter — the snapshot for `useSyncExternalStore`. */
  version = 0
  /** Memoized startup restore, so every awaiter shares one run. */
  private restored: Promise<void> | null = null

  constructor(catalog: readonly PluginSpec[], storage: PluginStorage | null = defaultStorage()) {
    const ids = new Set<string>()
    for (const spec of catalog) {
      if (ids.has(spec.id)) {
        throw new Error(`Plugin '${spec.id}' appears twice in the catalog.`)
      }
      ids.add(spec.id)
    }
    this.catalog = catalog
    this.storage = storage
  }

  /** All built-in plugins, in catalog order — what the manager UI lists. */
  list(): readonly PluginSpec[] {
    return this.catalog
  }

  /** The spec for `id`, or undefined for an id this build does not know
   * (e.g. from a project file saved by a newer build). */
  find(id: string): PluginSpec | undefined {
    return this.catalog.find((spec) => spec.id === id)
  }

  status(id: string): PluginStatus {
    if (this.active.has(id)) return { kind: 'enabled' }
    if (this.loading.has(id)) return { kind: 'loading' }
    const message = this.failures.get(id)
    if (message !== undefined) return { kind: 'failed', message }
    return { kind: 'disabled' }
  }

  isEnabled(id: string): boolean {
    return this.active.has(id)
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    this.version++
    for (const listener of this.listeners) listener()
  }

  private persist(): void {
    // Catalog order keeps the stored list deterministic.
    saveEnabledPluginIds(
      this.catalog.filter((spec) => this.active.has(spec.id)).map((spec) => spec.id),
      this.storage,
    )
  }

  /**
   * Enables a plugin: loads its chunk (once — re-enabling reuses the loaded
   * module), activates it, persists the enabled set. Resolves when the
   * plugin is active. A failed load or a throwing activate leaves the
   * plugin disabled with a `failed` status and does not persist; the next
   * enable retries. Disabling while the chunk still loads wins: the load
   * completes but the plugin is not activated.
   */
  enable(id: string): Promise<void> {
    const spec = this.find(id)
    if (spec === undefined) return Promise.reject(new Error(`Unknown plugin '${id}'.`))
    if (this.active.has(id)) return Promise.resolve()
    // A concurrent enable of the same plugin shares the in-flight one, so
    // every awaiter resolves when the plugin is actually active.
    const inFlight = this.enabling.get(id)
    if (inFlight !== undefined) return inFlight
    const run = (async () => {
      this.failures.delete(id)
      this.loading.add(id)
      this.notify()
      try {
        let module = this.modules.get(id)
        if (module === undefined) {
          module = spec.load()
          this.modules.set(id, module)
        }
        const loaded = await module
        // Disabled while the chunk loaded: stop before activation.
        if (!this.loading.has(id)) return
        this.active.set(id, loaded.activate())
        this.persist()
      } catch (error) {
        // A chunk that failed to fetch must not poison later attempts.
        this.modules.delete(id)
        this.failures.set(id, error instanceof Error ? error.message : `Could not load '${id}'.`)
      } finally {
        this.loading.delete(id)
        this.enabling.delete(id)
        this.notify()
      }
    })()
    this.enabling.set(id, run)
    return run
  }

  /**
   * Disables a plugin: its deactivate runs (contributions unregister
   * immediately), and the enabled set is persisted. In-flight work that
   * already captured the plugin's contributions (a running export) is
   * unaffected — see the module doc block for the stated rule.
   */
  disable(id: string): void {
    // Cancels a pending enable: the loader checks membership on arrival.
    this.loading.delete(id)
    const deactivate = this.active.get(id)
    if (deactivate !== undefined) {
      this.active.delete(id)
      deactivate()
      this.persist()
    }
    this.notify()
  }

  /**
   * Re-activates the plugins persisted as enabled. Memoized: the app kicks
   * it off at startup (`main.tsx`), and anything that must see the restored
   * state — the project-open path checking plugin dependencies — awaits the
   * same promise instead of racing it. Ids no longer in the catalog and
   * plugins that fail to load are skipped (the failure shows in the manager
   * UI); one broken plugin never blocks the rest or the app.
   */
  restore(): Promise<void> {
    this.restored ??= (async () => {
      const persisted = loadEnabledPluginIds(this.storage)
      await Promise.all(
        persisted
          .filter((id) => this.find(id) !== undefined)
          .map((id) => this.enable(id).catch(() => {})),
      )
    })()
    return this.restored
  }

  /**
   * The ids of plugins whose features the given project state uses — what
   * `serializeProject` records so the file can prompt-and-enable when
   * reopened (#197, ADR 0003). Every catalog plugin is asked, enabled or
   * not (#199): disabling tears down a plugin's *contributions*, never the
   * user's edits, so a pack transition stays on the timeline after its
   * plugin is disabled — and a save right then must still record the
   * dependency or the file would reopen without prompting and silently
   * render fallbacks. The predicate is pure over the state and lives in the
   * entry-bundle catalog, so asking a disabled plugin loads nothing.
   */
  projectPlugins(library: MediaLibraryState, timeline: TimelineState): string[] {
    return this.catalog
      .filter((spec) => spec.usedByProject?.(library, timeline) === true)
      .map((spec) => spec.id)
  }
}
