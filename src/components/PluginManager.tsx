import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { PluginRuntime } from '../lib/plugins'
import { pluginRuntime } from '../plugins/runtime'
import './dialog.css'
import './PluginManager.css'

interface PluginManagerProps {
  /** Injectable for tests; the app uses its plugin runtime singleton. */
  runtime?: PluginRuntime
}

/**
 * The Plugins… button and manager modal (#197, ADR 0003): lists every
 * built-in plugin with its description and version, and enables or disables
 * each one. Enabling lazy-loads the plugin's chunk (the toggle shows the
 * loading state meanwhile) and activates its registrations, which appear in
 * the UI immediately (e.g. an export format joins the picker); disabling
 * deactivates immediately — see the disable-semantics rule in
 * `lib/plugins.ts`. A failed load reports its reason on the row and the
 * toggle retries. Same hand-rolled modal idiom as ConfirmDialog.
 */
export function PluginManager({ runtime = pluginRuntime }: PluginManagerProps) {
  const [open, setOpen] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  const headingId = useId()
  // Re-render on every runtime change: loading → enabled/failed, restores.
  useSyncExternalStore(runtime.subscribe, () => runtime.version)

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open])

  const plugins = runtime.list()

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Plugins…
      </button>
      {open && (
        <div className="dialog-overlay" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
            className="dialog plugin-manager"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id={headingId}>Plugins</h3>
            <p>
              Optional features, loaded only when enabled. Your choices are remembered in this
              browser.
            </p>
            {plugins.length === 0 && <p>No plugins are available in this build.</p>}
            <ul className="plugin-list">
              {plugins.map((plugin) => {
                const status = runtime.status(plugin.id)
                const enabled = status.kind === 'enabled'
                return (
                  <li key={plugin.id} className="plugin-row">
                    <div className="plugin-info">
                      <span className="plugin-name">
                        {plugin.name}{' '}
                        <span className="plugin-version">v{plugin.version}</span>
                      </span>
                      <span className="plugin-description">{plugin.description}</span>
                      {status.kind === 'failed' && (
                        <span className="plugin-error" role="alert">
                          Could not enable: {status.message}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={status.kind === 'loading'}
                      aria-label={`${enabled ? 'Disable' : 'Enable'} ${plugin.name}`}
                      onClick={() => {
                        if (enabled) runtime.disable(plugin.id)
                        else void runtime.enable(plugin.id)
                      }}
                    >
                      {status.kind === 'loading' ? 'Enabling…' : enabled ? 'Disable' : 'Enable'}
                    </button>
                  </li>
                )
              })}
            </ul>
            <div className="dialog-actions">
              <button type="button" ref={closeRef} onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
