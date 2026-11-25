import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { disableConfirmationText } from '../lib/plugins'
import type { PluginRuntime, PluginUseCount } from '../lib/plugins'
import type { MediaLibraryState } from '../lib/mediaLibrary'
import type { TimelineState } from '../lib/timeline'
import { pluginRuntime } from '../plugins/runtime'
import { ConfirmDialog } from './ConfirmDialog'
import './dialog.css'
import './PluginManager.css'

interface PluginManagerProps {
  /** Injectable for tests; the app uses its plugin runtime singleton. */
  runtime?: PluginRuntime
  /**
   * Controlled mode (#415): the File ▾ menu owns whether the dialog is open
   * and supplies the menu item that opens it, so this renders no trigger of
   * its own. Omitting both keeps the standalone Plugins… button, so callers
   * and tests that predate the menu are unchanged.
   */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /**
   * The open project (#953). Disabling a plugin it uses asks first, saying
   * how many times it is used; a plugin it does not use disables at once.
   * Omitting either means no project to ask about, so every Disable acts at
   * once, as before #953.
   */
  library?: MediaLibraryState
  timeline?: TimelineState
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
export function PluginManager({
  runtime = pluginRuntime,
  open: controlledOpen,
  onOpenChange,
  library,
  timeline,
}: PluginManagerProps) {
  const [ownOpen, setOwnOpen] = useState(false)
  const controlled = controlledOpen !== undefined
  const open = controlled ? controlledOpen : ownOpen
  const setOpen = useCallback(
    (next: boolean) => {
      if (controlled) onOpenChange?.(next)
      else setOwnOpen(next)
    },
    [controlled, onOpenChange],
  )
  const closeRef = useRef<HTMLButtonElement>(null)
  const headingId = useId()
  // Re-render on every runtime change: loading → enabled/failed, restores.
  useSyncExternalStore(runtime.subscribe, () => runtime.version)
  // Disabling a plugin the project uses waits on this confirmation (#953).
  const [pending, setPending] = useState<{ id: string; uses: PluginUseCount } | null>(null)
  // The row's Disable button, which gets focus back when the confirmation closes.
  const returnFocusRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (open) closeRef.current?.focus()
    else setPending(null)
  }, [open])

  useEffect(() => {
    // While the confirmation is up, Escape is its Cancel, not this dialog's
    // Close: ConfirmDialog listens for it itself.
    if (!open || pending !== null) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, pending, setOpen])

  useEffect(() => {
    if (pending !== null || returnFocusRef.current === null) return
    returnFocusRef.current.focus()
    returnFocusRef.current = null
  }, [pending])

  const disable = (id: string, button: HTMLButtonElement) => {
    const uses =
      library !== undefined && timeline !== undefined
        ? runtime.projectUseCount(id, library, timeline)
        : { count: 0, what: '' }
    if (uses.count === 0) {
      runtime.disable(id)
      return
    }
    returnFocusRef.current = button
    setPending({ id, uses })
  }
  const pendingSpec = pending === null ? undefined : runtime.find(pending.id)

  const plugins = runtime.list()

  return (
    <>
      {!controlled && (
        <button type="button" onClick={() => setOpen(true)}>
          Plugins…
        </button>
      )}
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
            <div className="dialog-body">
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
                        onClick={(event) => {
                          if (enabled) disable(plugin.id, event.currentTarget)
                          else void runtime.enable(plugin.id)
                        }}
                      >
                        {status.kind === 'loading' ? 'Enabling…' : enabled ? 'Disable' : 'Enable'}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
            <div className="dialog-actions">
              <button type="button" ref={closeRef} onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {/* A sibling of the Plugins overlay, not inside it, so a click on its
          backdrop cancels it without also reaching the Plugins backdrop. */}
      {open && pending !== null && pendingSpec?.projectUses !== undefined && (
        <ConfirmDialog
          title={`Disable ${pendingSpec.name}?`}
          body={disableConfirmationText(pendingSpec.name, pending.uses, pendingSpec.projectUses.whileDisabled)}
          confirmLabel="Disable"
          onCancel={() => setPending(null)}
          onConfirm={() => {
            if (runtime.isEnabled(pending.id)) runtime.disable(pending.id)
            setPending(null)
          }}
        />
      )}
    </>
  )
}
