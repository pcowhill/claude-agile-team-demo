import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { createAutosaver, readAutosaveSnapshot } from '../lib/autosave'
import type { AutosaveSnapshot, AutosaveStatus, AutosaveStore, Autosaver } from '../lib/autosave'
import { emptyLibrary } from '../lib/mediaLibrary'
import type { MediaLibraryState } from '../lib/mediaLibrary'
import { restoreEmbeddedProject, restoreProject } from '../lib/openProject'
import type { RestoredProject } from '../lib/openProject'
import { probeMediaFile } from '../lib/probeMedia'
import { deserializeProject } from '../lib/projectFile'
import type { ClipMedia, DeserializeResult, Project } from '../lib/projectFile'
import { serializeProject } from '../lib/projectFile'
import { CANVAS_PRESETS } from '../lib/frameSize'
import type { CanvasPreset } from '../lib/frameSize'
import { emptyTimeline } from '../lib/timeline'
import type { TimelineState } from '../lib/timeline'
import { unregisteredTransitionTypes } from '../lib/transitionRender'
import {
  DEFAULT_PROJECT_FILE_NAME,
  PROJECT_FILE_EXTENSION,
  collectClipMedia,
  createSavePort,
  fetchClipMedia as fetchClipMediaFromUrl,
} from '../lib/saveProject'
import type { SaveDestination, SaveMode, SavePort } from '../lib/saveProject'
import type { LibraryClip } from '../lib/mediaLibrary'
import type { PluginRuntime } from '../lib/plugins'
import { pluginRuntime as appPluginRuntime } from '../plugins/runtime'
import type { AppSettings, SessionRestoreMode } from '../lib/settings'
import { DEFAULT_SETTINGS } from '../lib/settings'
import { ConfirmDialog } from './ConfirmDialog'
import { ExportControl } from './ExportControl'
import { PluginManager } from './PluginManager'
import { SettingsControl } from './SettingsControl'
import { OpenProjectDialog } from './OpenProjectDialog'
import { SaveModeDialog } from './SaveModeDialog'
import './ProjectControls.css'

interface ProjectControlsProps {
  library: MediaLibraryState
  timeline: TimelineState
  /** Whether there are changes since the last save (or since startup). */
  dirty: boolean
  /** Called with exactly the state that was written, so App can clear dirty. */
  onSaved: (saved: { clips: MediaLibraryState['clips']; timeline: TimelineState }) => void
  /**
   * Replaces the whole editing state: an opened project, or the empty one
   * for New Project. The receiver owns revoking the *previous* state's
   * object URLs and resetting the dirty baseline to the given references —
   * except `unsaved: true` (a restored snapshot of never-saved work, #288),
   * where the receiver must keep the state marked dirty instead.
   * Optional only so save-focused tests that predate #77 keep compiling
   * unchanged — the app always supplies it.
   */
  onProjectReplaced?: (project: RestoredProject, options?: { unsaved: boolean }) => void
  /** Injectable for tests (the real pickers cannot be driven by automation). */
  port?: SavePort
  /** Injectable for tests (jsdom cannot probe real media). */
  probeMedia?: typeof probeMediaFile
  /** Injectable for tests (jsdom cannot fetch object URLs). */
  fetchClipMedia?: (clip: LibraryClip) => Promise<ClipMedia>
  /** Injectable for tests (jsdom has no URL.createObjectURL). */
  createMediaUrl?: (blob: Blob) => string
  /** Injectable for tests; the app uses its plugin runtime singleton (#197). */
  plugins?: PluginRuntime
  /**
   * The crash-safe autosave snapshot store (#194); absent or null means
   * autosave is off (storage unavailable, or a test that predates it).
   */
  autosave?: AutosaveStore | null
  /** Injectable for tests; defaults to the production debounce. */
  autosaveDebounceMs?: number
  /**
   * Sets the project's canvas preset (#273) — `undefined` is Auto. Optional
   * so save-focused tests that predate it keep compiling unchanged; the
   * control renders only when the app supplies it.
   */
  onSetCanvasPreset?: (preset: CanvasPreset | undefined) => void
  /**
   * The per-device preferences (#286) and the writer for them. Two of them
   * are consumed here: the startup restore offer's behaviour, and the format
   * the export modal opens on. Optional as a pair — the ⚙ button renders
   * only when the app supplies both, so tests that predate settings keep
   * compiling and keep today's defaults.
   */
  settings?: AppSettings
  onSetSettings?: (settings: AppSettings) => void
}

type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; name: string }
  | { kind: 'error'; message: string }

/**
 * A restorable autosave snapshot, as the startup read hands it on (#194):
 * the deserialized project, its media blobs, and whether it matched the last
 * save (#288). Named because four things now hold one — the offer state, the
 * in-flight ref, the startup read's local, and the starter the #286 restore
 * mode calls.
 */
type PendingRestore = {
  result: Extract<DeserializeResult, { ok: true }>
  media: Map<string, Blob>
  saved: boolean
}

/**
 * Project lifecycle controls. Save and Save As… (#76): Save As… always asks
 * where the file goes; Save re-uses the established destination, or behaves
 * as Save As… when there is none yet. Ctrl+S / Cmd+S triggers Save. The Save
 * button carries an unsaved-changes indicator while `dirty`. Open Project…
 * and New Project (#77) replace the whole editing state, guarded by an
 * "are you sure?" dialog while there are unsaved changes; opening a
 * references file runs through the media re-link dialog (see
 * `OpenProjectDialog`), while an embedded file (#98) opens immediately.
 *
 * The save mode (#98) — embed media vs. references only — is asked exactly
 * when it is not known: the first save of a project surfaces the choice
 * (defaulting to embed), Save As… re-surfaces it, and plain Save reuses the
 * remembered mode silently. Opening a file remembers that file's own mode.
 *
 * Export Project… (#164) lives here too, so exporting sits beside the other
 * project-level actions; the flow itself is `ExportControl`'s.
 */
export function ProjectControls({
  library,
  timeline,
  dirty,
  onSaved,
  onProjectReplaced,
  port,
  probeMedia,
  fetchClipMedia,
  createMediaUrl,
  plugins = appPluginRuntime,
  autosave = null,
  autosaveDebounceMs,
  onSetCanvasPreset,
  settings,
  onSetSettings,
}: ProjectControlsProps) {
  // The port touches window at creation, so default lazily, once.
  const portRef = useRef<SavePort | null>(port ?? null)
  portRef.current ??= createSavePort()
  const [destination, setDestination] = useState<SaveDestination | null>(null)
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' })
  // The project's remembered save mode (#98). null = never chosen for this
  // project (a new project), so the next save must surface the choice.
  const [mode, setMode] = useState<SaveMode | null>(null)
  const [modeDialogOpen, setModeDialogOpen] = useState(false)
  // Open/New flow (#77): the pending unsaved-changes guard, the picked
  // project awaiting media re-linking, and the last failed open's reason.
  const [pendingDiscard, setPendingDiscard] = useState<'open' | 'new' | null>(null)
  const [pendingOpen, setPendingOpen] = useState<{ fileName: string; project: Project } | null>(
    null,
  )
  // A picked file that needs disabled plugins (#197): the open waits for the
  // prompt-and-enable decision, carrying everything needed to continue.
  const [pendingPlugins, setPendingPlugins] = useState<{
    fileName: string
    result: Extract<DeserializeResult, { ok: true }>
    missing: string[]
  } | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const openInputRef = useRef<HTMLInputElement>(null)

  // Crash-safe autosave (#194). The gate keeps the autosaver from writing —
  // and thereby clobbering the stored snapshot — until the startup restore
  // offer is resolved: 'checking' while the snapshot is read, 'offer' while
  // "Restore last session?" is pending, 'active' once restored, discarded,
  // or there was nothing to offer.
  const [autosaveGate, setAutosaveGate] = useState<'checking' | 'offer' | 'active'>('checking')
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>('ok')
  const [pendingRestore, setPendingRestore] = useState<PendingRestore | null>(null)
  // Discard in flight (#240): the offer stays up (buttons disabled) until
  // the snapshot clear commits, so dismissal is an honest "cleared" signal.
  const [discarding, setDiscarding] = useState(false)
  // A restore that has left the bar but not yet replaced the project (it is
  // in the plugin prompt or the re-link dialog). If that path dead-ends —
  // canceled, declined, or failed — the offer returns instead of the
  // snapshot silently expiring with autosave still off.
  const restoreInFlight = useRef<typeof pendingRestore>(null)
  // Set once anything replaces the project: the async startup snapshot read
  // must not surface a stale offer over a project the user already opened.
  const offerSuperseded = useRef(false)
  // What to do with a snapshot that is found (#286). The startup effect runs
  // once per store and resolves asynchronously, so it reads the mode and the
  // restore starter through refs rather than taking them as dependencies:
  // both change identity on renders that have nothing to do with autosave,
  // and re-running the effect would re-read the snapshot. Same idiom as
  // App's `subtitleStyleRef` and this file's own `sizeModeRef` sibling in
  // ExportControl.
  const sessionRestoreRef = useRef<SessionRestoreMode>(DEFAULT_SETTINGS.sessionRestore)
  sessionRestoreRef.current = settings?.sessionRestore ?? DEFAULT_SETTINGS.sessionRestore
  const startRestoreRef = useRef<(pending: PendingRestore) => void>(() => {})
  const autosaverRef = useRef<Autosaver | null>(null)

  // Startup (#194): read the snapshot once the store exists. A snapshot
  // that deserializes becomes the restore offer; a corrupt or foreign one
  // is cleared (nothing restorable); no snapshot just activates autosave.
  useEffect(() => {
    if (autosave === null) return
    let canceled = false
    void (async () => {
      let offer: PendingRestore | null = null
      try {
        const snapshot: AutosaveSnapshot | null = await readAutosaveSnapshot(autosave)
        if (snapshot !== null) {
          const result = await deserializeProject(snapshot.structure)
          if (result.ok) offer = { result, media: snapshot.media, saved: snapshot.saved }
          else await autosave.clear()
        }
      } catch {
        // Unreadable storage: autosave still activates; a failing write
        // will report 'unavailable' from the autosaver itself.
      }
      if (canceled || offerSuperseded.current) return
      if (offer === null) {
        setAutosaveGate('active')
        return
      }
      // What the found snapshot does is the user's choice (#286).
      switch (sessionRestoreRef.current) {
        case 'never':
          // No offer, and the snapshot is deliberately *not* cleared:
          // autosave takes over and overwrites it, exactly as the setting
          // promises ("only the offer changes").
          setAutosaveGate('active')
          break
        case 'always':
          // Straight into the same restore the Restore button runs, with no
          // bar shown. The gate stays closed until it lands, and a path that
          // dead-ends (a declined re-link) re-offers through the usual
          // machinery, so the choice is never silently dropped.
          setAutosaveGate('offer')
          startRestoreRef.current(offer)
          break
        case 'ask':
          setPendingRestore(offer)
          setAutosaveGate('offer')
          break
      }
    })()
    return () => {
      canceled = true
    }
  }, [autosave])

  // The autosave loop (#194): one autosaver per store, running only once
  // the restore offer is resolved, mirroring every committed change.
  useEffect(() => {
    if (autosave === null || autosaveGate !== 'active') return
    const autosaver = createAutosaver({
      store: autosave,
      serialize: (lib, tl) => serializeProject(lib, tl, undefined, plugins.projectPlugins(lib, tl)),
      fetchBlob: async (clip) => {
        const media = await (fetchClipMedia ?? fetchClipMediaFromUrl)(clip)
        return new Blob([media.bytes as BlobPart], { type: media.mimeType ?? '' })
      },
      onStatus: setAutosaveStatus,
      ...(autosaveDebounceMs === undefined ? {} : { debounceMs: autosaveDebounceMs }),
    })
    autosaverRef.current = autosaver
    return () => {
      autosaver.dispose()
      autosaverRef.current = null
    }
  }, [autosave, autosaveGate, plugins, fetchClipMedia, autosaveDebounceMs])

  // Feed every committed change (and the moment the gate opens, so state
  // edited while the offer was pending is snapshotted too). `!dirty` rides
  // along (#288) so the snapshot records whether this state matched the
  // last save — a save flips `dirty` without a state change, and this
  // effect re-fires on that too, refreshing the stored marker.
  useEffect(() => {
    autosaverRef.current?.stateChanged(library, timeline, !dirty)
  }, [library, timeline, autosaveGate, dirty])

  /** Writes the project in the given mode, picking a destination if needed. */
  const performSave = async (alwaysPick: boolean, saveMode: SaveMode) => {
    // Serialize exactly what is committed now; edits made while the picker
    // or the write is pending stay unsaved (and keep the dirty flag).
    const snapshot = { clips: library.clips, timeline }
    setStatus({ kind: 'saving' })
    try {
      let target = destination
      if (alwaysPick || target === null) {
        const picked = await portRef.current!.pickDestination(
          destination?.name ?? DEFAULT_PROJECT_FILE_NAME,
        )
        if (picked.kind === 'canceled') {
          setStatus({ kind: 'idle' })
          return
        }
        target = picked.destination
        setDestination(target)
      }
      const media =
        saveMode === 'embed' ? await collectClipMedia(library.clips, fetchClipMedia) : undefined
      // Record which enabled plugins' features the project uses (#197), so
      // reopening the file can prompt to enable them.
      const pluginIds = plugins.projectPlugins(library, timeline)
      await target.write(await serializeProject(library, timeline, media, pluginIds))
      onSaved(snapshot)
      setStatus({ kind: 'saved', name: target.name })
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Saving failed unexpectedly.',
      })
    }
  }

  const save = async (alwaysPick: boolean) => {
    if (status.kind === 'saving') return
    // Save As… always re-offers the mode; plain Save asks only when this
    // project has never chosen one (#98). Otherwise the remembered mode is
    // reused silently — even when the destination still needs picking.
    if (alwaysPick || mode === null) {
      setModeDialogOpen(true)
      return
    }
    await performSave(false, mode)
  }

  const confirmSaveMode = (chosen: SaveMode) => {
    setModeDialogOpen(false)
    setMode(chosen)
    // The click on the confirm button is the user activation the file
    // picker needs, so saving can chain directly. Always pick: the dialog
    // only appears for Save As… or a first save (no destination yet).
    void performSave(true, chosen)
  }

  // Keep the handler's view of state fresh without re-subscribing per render.
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 's') {
        // Always claim the shortcut, or the browser's own save dialog opens.
        // Saving mid-edit is harmless: only committed state is serialized.
        event.preventDefault()
        if (!event.repeat) void saveRef.current(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Replacing the project invalidates everything session-scoped here: the
  // save destination belongs to the previous project, as does status text.
  // The save mode travels with the project: an opened file's own mode is
  // remembered (#98); a new project has none until its first save.
  const replaceProject = (restored: RestoredProject, nextMode: SaveMode | null) => {
    // A replacement that completes the restore flow (#288): the restore is
    // the only path that arrives here with restoreInFlight set (opening a
    // file or starting fresh never sets it), and a snapshot of never-saved
    // work must keep the unsaved indicator rather than start clean.
    const unsaved = restoreInFlight.current !== null && !restoreInFlight.current.saved
    onProjectReplaced?.(restored, { unsaved })
    setDestination(null)
    setMode(nextMode)
    setStatus({ kind: 'idle' })
    setOpenError(null)
    // Any project replacement resolves the startup restore offer (#194):
    // restoring lands here, and opening a file or starting fresh while the
    // offer was pending supersedes it — the snapshot then re-mirrors the
    // new state on the next autosave pass, which is the replace rule.
    restoreInFlight.current = null
    offerSuperseded.current = true
    setPendingRestore(null)
    setAutosaveGate('active')
  }

  const startNewProject = () => {
    replaceProject({ clips: emptyLibrary.clips, timeline: emptyTimeline }, null)
  }

  const requestNewProject = () => {
    if (dirty) setPendingDiscard('new')
    else startNewProject()
  }

  const requestOpenProject = () => {
    if (dirty) setPendingDiscard('open')
    else openInputRef.current?.click()
  }

  const confirmDiscard = () => {
    const action = pendingDiscard
    setPendingDiscard(null)
    if (action === 'new') startNewProject()
    // The click on the confirm button is the user activation the file
    // picker needs, so opening can chain directly.
    else if (action === 'open') openInputRef.current?.click()
  }

  /** The open path once plugin dependencies are settled (#197). */
  const openDeserialized = (fileName: string, result: Extract<DeserializeResult, { ok: true }>) => {
    // Transition types are enforced here rather than at parse (#199): only
    // now, with the file's plugins enabled, does the registry hold every
    // type this build can know. A type still unknown is a corrupt file or
    // one saved by a newer build; opening it would silently render
    // fallbacks, so refuse with the same posture as the plugin gate.
    const unknownTransitions = unregisteredTransitionTypes(
      result.project.timeline.transitions.map((transition) => transition.type),
    )
    if (unknownTransitions.length > 0) {
      setOpenError(
        `this project uses the unknown transition${
          unknownTransitions.length === 1 ? '' : 's'
        } ${unknownTransitions.map((type) => `"${type}"`).join(', ')} — the file is damaged, or was saved by a newer version of the editor`,
      )
      reofferRestore()
      return
    }
    if (result.media !== undefined) {
      // An embedded file (#98) carries its media: it opens fully linked with
      // no re-link step, and re-saves embedded by default.
      replaceProject(restoreEmbeddedProject(result.project, result.media, createMediaUrl), 'embed')
      return
    }
    if (result.project.clips.length === 0) {
      // Nothing to re-link; the (empty-library) project opens immediately.
      replaceProject(restoreProject(result.project, new Map()), 'references')
      return
    }
    setPendingOpen({ fileName, project: result.project })
  }

  /**
   * A restore path that dead-ended (declined plugins, canceled re-link,
   * failed enable) puts the offer back (#194): the snapshot is still there
   * and autosave is still gated, so the user must decide again — silently
   * dropping the offer would strand the session with autosave off.
   */
  const reofferRestore = () => {
    if (restoreInFlight.current === null) return
    setPendingRestore(restoreInFlight.current)
    restoreInFlight.current = null
  }

  /** The open path once bytes are deserialized: plugin gate, then open. */
  const openResult = async (fileName: string, result: Extract<DeserializeResult, { ok: true }>) => {
    setOpenError(null)
    // Plugin dependencies (#197): a file may need plugins that are disabled.
    // Startup re-activation must settle first, or a plugin enabled by the
    // persisted set would be prompted for spuriously.
    const required = result.project.plugins ?? []
    if (required.length > 0) {
      await plugins.restore()
      const unknown = required.filter((id) => plugins.find(id) === undefined)
      if (unknown.length > 0) {
        setOpenError(
          `this project needs the plugin${unknown.length === 1 ? '' : 's'} ${unknown
            .map((id) => `"${id}"`)
            .join(', ')}, which this version of the editor does not have — it was saved by a newer version`,
        )
        reofferRestore()
        return
      }
      const missing = required.filter((id) => !plugins.isEnabled(id))
      if (missing.length > 0) {
        // Prompt-and-enable (ADR 0003): opening waits for the decision.
        setPendingPlugins({ fileName, result, missing })
        return
      }
    }
    openDeserialized(fileName, result)
  }

  const handleProjectFile = async (file: File) => {
    const result = await deserializeProject(new Uint8Array(await file.arrayBuffer()))
    if (!result.ok) {
      // A failed open leaves the current project untouched — only report.
      setOpenError(result.error)
      return
    }
    await openResult(file.name, result)
  }

  /**
   * Accepting the restore offer (#194). With every clip's blob stored, the
   * snapshot is materially an embedded project: synthesize the media map
   * and the existing embedded-open path restores it fully linked under
   * fresh object URLs. With blobs missing (a structure-only degrade), the
   * same call lands in the existing re-link dialog — the established
   * re-attach flow — instead of failing.
   */
  const startRestore = (pending: PendingRestore) => {
    restoreInFlight.current = pending
    void (async () => {
      const project = pending.result.project
      let result = pending.result
      if (project.clips.length > 0 && project.clips.every((clip) => pending.media.has(clip.id))) {
        const media = new Map<string, ClipMedia>()
        for (const clip of project.clips) {
          const blob = pending.media.get(clip.id) as Blob
          media.set(clip.id, {
            bytes: new Uint8Array(await blob.arrayBuffer()),
            ...(blob.type === '' ? {} : { mimeType: blob.type }),
          })
        }
        result = { ...pending.result, media }
      }
      await openResult('the autosaved session', result)
    })()
  }
  // Reached by the startup effect when the restore mode is 'always' (#286);
  // the effect cannot depend on `startRestore` without re-reading the
  // snapshot on unrelated renders. See the ref's declaration above.
  startRestoreRef.current = startRestore

  const confirmRestore = () => {
    const pending = pendingRestore
    setPendingRestore(null)
    if (pending === null) return
    startRestore(pending)
  }

  /**
   * Declining the restore offer (#194): the snapshot is cleared for good.
   * The clear is awaited *before* the offer is dismissed (#240): dismissal
   * is the observable signal that the delete committed, so a reload right
   * after the bar disappears can never be re-offered the discarded
   * snapshot. Firing the clear and dismissing immediately let a quick
   * refresh abort the IndexedDB transaction mid-flight, leaving the
   * snapshot alive. A failed clear still dismisses — storage trouble must
   * never trap the user in the offer (the autosave failure policy).
   */
  const discardRestore = () => {
    if (discarding) return
    setDiscarding(true)
    void (async () => {
      try {
        await autosave?.clear()
      } catch {
        // Nothing to do: with storage unwritable the snapshot may survive,
        // but the autosaver will report 'unavailable' on its next pass.
      }
      setDiscarding(false)
      setPendingRestore(null)
      restoreInFlight.current = null
      setAutosaveGate('active')
    })()
  }

  /** Accepting the plugin prompt (#197): enable, then continue the open. */
  const confirmEnablePlugins = async () => {
    const pending = pendingPlugins
    setPendingPlugins(null)
    if (pending === null) return
    await Promise.all(pending.missing.map((id) => plugins.enable(id)))
    const failed = pending.missing.filter((id) => !plugins.isEnabled(id))
    if (failed.length > 0) {
      // A chunk that would not load: the project must not open degraded.
      const status = plugins.status(failed[0])
      setOpenError(
        `the "${plugins.find(failed[0])?.name ?? failed[0]}" plugin could not be enabled` +
          (status.kind === 'failed' ? ` (${status.message})` : ''),
      )
      reofferRestore()
      return
    }
    openDeserialized(pending.fileName, pending.result)
  }

  /**
   * Declining the plugin prompt (#197): the project is NOT opened — opening
   * it without its plugins would silently drop the features the file
   * records (quiet data loss, refused in ADR 0003). The current project
   * stays untouched and the refusal says why.
   */
  const declineEnablePlugins = () => {
    const pending = pendingPlugins
    setPendingPlugins(null)
    if (pending === null) return
    const names = pending.missing.map((id) => plugins.find(id)?.name ?? id).join(', ')
    setOpenError(
      `"${pending.fileName}" was not opened — it needs the disabled plugin${
        pending.missing.length === 1 ? '' : 's'
      } ${names}, and opening it without them would drop those features`,
    )
    reofferRestore()
  }

  const handleOpenInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) void handleProjectFile(file)
    // Allow re-picking the same file (e.g. after fixing it externally).
    event.target.value = ''
  }

  const saving = status.kind === 'saving'

  return (
    <div className="project-controls">
      <button type="button" disabled={saving} onClick={requestNewProject}>
        New Project
      </button>
      <button type="button" disabled={saving} onClick={requestOpenProject}>
        Open Project…
      </button>
      <input
        ref={openInputRef}
        type="file"
        accept={`${PROJECT_FILE_EXTENSION},application/gzip`}
        hidden
        data-testid="project-file-input"
        onChange={handleOpenInputChange}
      />
      <button
        type="button"
        disabled={saving}
        // The dot alone would be color-only; the label carries its meaning.
        aria-label={dirty ? 'Save (unsaved changes)' : undefined}
        onClick={() => void save(false)}
      >
        Save
        {dirty && (
          <span className="project-dirty" title="Unsaved changes" aria-hidden="true">
            ●
          </span>
        )}
      </button>
      <button type="button" disabled={saving} onClick={() => void save(true)}>
        Save As…
      </button>
      {onSetCanvasPreset !== undefined && (
        <label className="project-canvas-preset">
          Canvas
          <select
            aria-label="Canvas aspect"
            disabled={saving}
            // Auto is the absent preset (#273), so the empty option value is
            // what maps to it — never an 'auto' identifier.
            value={timeline.canvasPreset ?? ''}
            onChange={(event) =>
              onSetCanvasPreset(
                event.target.value === '' ? undefined : (event.target.value as CanvasPreset),
              )
            }
          >
            <option value="">Auto (match sources)</option>
            {CANVAS_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <ExportControl timeline={timeline} defaultFormat={settings?.exportFormat} />
      <PluginManager />
      {/* Per-device preferences (#286). Rendered only with both halves of
          the settings wiring supplied, so a caller that predates settings
          gets no dead control. */}
      {settings !== undefined && onSetSettings !== undefined && (
        <SettingsControl settings={settings} onChange={onSetSettings} />
      )}
      <span className="project-save-status" role="status">
        {status.kind === 'saved' && `Saved as ${status.name}`}
        {saving && 'Saving…'}
      </span>
      {status.kind === 'error' && (
        <span className="project-save-error" role="alert">
          Could not save: {status.message}
        </span>
      )}
      {openError !== null && (
        <span className="project-open-error" role="alert">
          Could not open: {openError}
        </span>
      )}
      {/* Crash-safe autosave (#194): the startup restore offer, and the two
          degradations worth telling the user about before a crash makes
          them matter. */}
      {pendingRestore !== null && (
        <div className="project-restore-offer" role="status">
          <span>Restore last session? An autosaved project from a previous session was found.</span>
          <button type="button" onClick={confirmRestore} disabled={discarding}>
            Restore
          </button>
          <button type="button" onClick={discardRestore} disabled={discarding}>
            Discard
          </button>
        </div>
      )}
      {autosaveStatus === 'structure-only' && (
        <span className="project-autosave-note" role="status">
          Autosave: the media no longer fits in browser storage, so only the project structure is
          being kept — restoring will ask for the media files again.
        </span>
      )}
      {autosaveStatus === 'unavailable' && (
        <span className="project-autosave-note" role="status">
          Autosave is currently unavailable — save your project to a file to keep it safe.
        </span>
      )}
      {pendingDiscard !== null && (
        <ConfirmDialog
          title="Discard unsaved changes?"
          body={
            pendingDiscard === 'new'
              ? 'Starting a new project will discard your unsaved changes.'
              : 'Opening a project will discard your unsaved changes.'
          }
          confirmLabel={pendingDiscard === 'new' ? 'Discard and start new' : 'Discard and open'}
          onCancel={() => setPendingDiscard(null)}
          onConfirm={confirmDiscard}
        />
      )}
      {pendingPlugins !== null && (
        <ConfirmDialog
          title="Enable plugins to open?"
          body={`"${pendingPlugins.fileName}" uses features from the disabled plugin${
            pendingPlugins.missing.length === 1 ? '' : 's'
          } ${pendingPlugins.missing
            .map((id) => plugins.find(id)?.name ?? id)
            .join(', ')}. Enable and open?`}
          confirmLabel="Enable and open"
          onCancel={declineEnablePlugins}
          onConfirm={() => void confirmEnablePlugins()}
        />
      )}
      {pendingOpen !== null && (
        <OpenProjectDialog
          fileName={pendingOpen.fileName}
          project={pendingOpen.project}
          probeMedia={probeMedia}
          onCancel={() => {
            setPendingOpen(null)
            // A canceled re-link that was the restore path (#194) puts the
            // restore offer back; a canceled file open reoffers nothing.
            reofferRestore()
          }}
          onOpen={(restored) => {
            setPendingOpen(null)
            replaceProject(restored, 'references')
          }}
        />
      )}
      {modeDialogOpen && (
        <SaveModeDialog
          initialMode={mode ?? 'embed'}
          onCancel={() => setModeDialogOpen(false)}
          onConfirm={confirmSaveMode}
        />
      )}
    </div>
  )
}
