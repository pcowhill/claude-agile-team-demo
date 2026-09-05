import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { MediaLibrary } from './components/MediaLibrary'
import { PreviewPlayer } from './components/PreviewPlayer'
import { ProjectControls } from './components/ProjectControls'
import { Timeline } from './components/Timeline'
import { openAutosaveStore } from './lib/autosave'
import type { AutosaveStore } from './lib/autosave'
import { extractAudioClip } from './lib/extractAudio'
import { FREEZE_STILL_DURATION, freezeFrameClip } from './lib/freezeFrame'
import type { FreezeTarget } from './lib/freezeFrame'
import type { SourceDimensions } from './lib/frameSize'
import { emptyLibrary, mediaLibraryReducer } from './lib/mediaLibrary'
import type { LibraryClip } from './lib/mediaLibrary'
import type { AudioTrack, TimelineEntry } from './lib/timeline'
import {
  audioTrackFromClip,
  emptyTimeline,
  entryFromClip,
  slateEntry,
  imageOverlayFromClip,
  videoOverlayFromClip,
} from './lib/timeline'
import { emptyTimelineHistory, targetEditsText, timelineHistoryReducer } from './lib/history'
import { DEFAULT_TEXT } from './lib/textOverlay'
import { parseSrt, subtitleOverlaySpec } from './lib/srt'
import { loadPreviewExpanded, savePreviewExpanded } from './lib/previewLayout'
import type { PreviewLayoutStorage } from './lib/previewLayout'
import { loadLibraryView, saveLibraryView } from './lib/libraryView'
import type { LibraryView } from './lib/libraryView'
import { loadSettings, saveSettings } from './lib/settings'
import type { AppSettings } from './lib/settings'
import { probeMediaFile } from './lib/probeMedia'
import type { SavePort } from './lib/saveProject'
import './App.css'

interface AppProps {
  /** Injectable for tests (jsdom can probe no real media and show no picker). */
  probeMedia?: typeof probeMediaFile
  savePort?: SavePort
  /**
   * The per-browser preference store; defaults to localStorage (#128).
   * Shared by every preference that is not project content — the preview's
   * expanded state (#128), the media library's view (#311) and the settings
   * dialog's values (#286) — each under its own key. One prop because the
   * three want the same `Storage` slice, and injecting once isolates the lot
   * in a test.
   */
  layoutStorage?: PreviewLayoutStorage
}

function App({ probeMedia = probeMediaFile, savePort, layoutStorage }: AppProps) {
  const [library, dispatch] = useReducer(mediaLibraryReducer, emptyLibrary)
  // Timeline edits run through the undo/redo history (#189); the rendered
  // timeline is the history's present, and existing dispatch call sites are
  // unchanged because timeline actions pass straight through the wrapper.
  const [history, dispatchTimeline] = useReducer(timelineHistoryReducer, emptyTimelineHistory)
  const timeline = history.present
  const [isDragTarget, setIsDragTarget] = useState(false)
  // Whether the preview spans the full content width (#128). Remembered per
  // browser across page loads; a missing or blocked store means normal layout.
  const [previewExpanded, setPreviewExpanded] = useState(() => loadPreviewExpanded(layoutStorage))
  const togglePreviewExpanded = useCallback(() => {
    setPreviewExpanded((expanded) => {
      const next = !expanded
      savePreviewExpanded(next, layoutStorage)
      return next
    })
  }, [layoutStorage])
  // Which layout the media library's clip list is in (#311). A view
  // preference, not project content: it lives here beside the preview's
  // expanded state, persists in the same per-browser store under its own
  // key, and never reaches a project file or the autosave snapshot.
  const [libraryView, setLibraryView] = useState<LibraryView>(() =>
    loadLibraryView(layoutStorage),
  )
  const handleSetLibraryView = useCallback(
    (next: LibraryView) => {
      setLibraryView(next)
      saveLibraryView(next, layoutStorage)
    },
    [layoutStorage],
  )
  // Per-device preferences (#286, from customer feedback #281): read once at
  // mount, written through on every change so a reload finds them, and
  // applied from this state so a change takes effect immediately — the four
  // consumers below read these values, not the constants they default to.
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings(layoutStorage))
  const handleSetSettings = useCallback(
    (next: AppSettings) => {
      setSettings(next)
      saveSettings(next, layoutStorage)
    },
    [layoutStorage],
  )
  // dragenter/dragleave fire for every child element crossed; only the
  // outermost balance matters.
  const dragDepth = useRef(0)

  // Crash-safe autosave (#194): the IndexedDB snapshot store, opened once.
  // An environment without usable IndexedDB leaves it null — autosave is
  // simply off, never an editing failure.
  const [autosaveStore, setAutosaveStore] = useState<AutosaveStore | null>(null)
  useEffect(() => {
    let canceled = false
    openAutosaveStore().then(
      (store) => {
        if (!canceled) setAutosaveStore(store)
      },
      () => {},
    )
    return () => {
      canceled = true
    }
  }, [])

  // What the last save wrote (or the startup state). The project is dirty
  // exactly when the saveable state has moved past it — reference equality
  // suffices because both reducers return the same reference for no-op
  // actions, and `failures` (transient, never saved) lives outside `clips`.
  const [savedState, setSavedState] = useState<{
    clips: LibraryClip[]
    timeline: typeof timeline
  }>({ clips: emptyLibrary.clips, timeline: emptyTimeline })
  const dirty = library.clips !== savedState.clips || timeline !== savedState.timeline

  const importFiles = useCallback(async (files: File[]) => {
    // Sequential so clips appear in the order the user picked them.
    for (const file of files) {
      try {
        const { duration, url, kind, width, height } = await probeMedia(file)
        dispatch({
          type: 'clip-added',
          // Dimensions are probed for images (#137); the spreads keep other
          // kinds' clip objects shaped exactly as they always were.
          clip: {
            id: crypto.randomUUID(),
            name: file.name,
            duration,
            url,
            kind,
            ...(width === undefined ? {} : { width }),
            ...(height === undefined ? {} : { height }),
          },
        })
      } catch (error) {
        dispatch({
          type: 'import-failed',
          failure: {
            id: crypto.randomUUID(),
            name: file.name,
            reason: error instanceof Error ? error.message : `Could not import "${file.name}".`,
          },
        })
      }
    }
  }, [probeMedia])

  const handleImportFiles = useCallback(
    (files: File[]) => {
      void importFiles(files)
    },
    [importFiles],
  )

  // Subtitle import (#249): parse the .srt, land every cue as one batched
  // timeline action (a single undo step), and report skipped blocks — or a
  // file with no usable cues at all — in the library's dismissible failure
  // list, exactly like a failed media import.
  // New cues take the project's default subtitle style (#250) — read via a
  // ref so the stable callback always sees the current default.
  const subtitleStyleRef = useRef(timeline.subtitleStyle)
  subtitleStyleRef.current = timeline.subtitleStyle
  const importSubtitles = useCallback(async (file: File) => {
    const reportFailure = (reason: string) =>
      dispatch({
        type: 'import-failed',
        failure: { id: crypto.randomUUID(), name: file.name, reason },
      })
    let parsed: ReturnType<typeof parseSrt>
    try {
      parsed = parseSrt(await file.text())
    } catch {
      reportFailure(`Could not read "${file.name}".`)
      return
    }
    const { cues, skipped } = parsed
    if (cues.length === 0) {
      reportFailure(`No subtitle cues found in "${file.name}".`)
      return
    }
    dispatchTimeline({
      type: 'texts-added',
      texts: cues.map((cue) => ({
        ...subtitleOverlaySpec(cue, subtitleStyleRef.current),
        id: crypto.randomUUID(),
      })),
    })
    if (skipped.length > 0) {
      // The cues that did parse are in; the diagnostic names what was not.
      const details = skipped
        .slice(0, 3)
        .map(({ block, reason }) => `block ${block} ${reason}`)
        .join('; ')
      const more = skipped.length > 3 ? `; and ${skipped.length - 3} more` : ''
      reportFailure(
        `Imported ${cues.length} subtitle${cues.length === 1 ? '' : 's'} from "${file.name}" but skipped ${skipped.length} cue block${skipped.length === 1 ? '' : 's'}: ${details}${more}.`,
      )
    }
  }, [])

  const handleImportSubtitles = useCallback(
    (file: File) => {
      void importSubtitles(file)
    },
    [importSubtitles],
  )

  const stillDuration = settings.stillDurationSeconds
  const handleAddToTimeline = useCallback(
    (clip: LibraryClip) => {
      // Video joins the sequence; audio becomes a track on the audio lane (#102).
      if (clip.kind === 'audio') {
        dispatchTimeline({
          type: 'audio-track-added',
          track: audioTrackFromClip(clip, crypto.randomUUID()),
        })
        return
      }
      // Video and stills (#140) join the sequence alike; a still shows for
      // the configured duration (#286).
      dispatchTimeline({
        type: 'entry-added',
        entry: entryFromClip(clip, crypto.randomUUID(), stillDuration),
      })
    },
    [stillDuration],
  )

  // A library selection added in one step (#292): the same per-kind rule as
  // a single Add, in library order, as one action so one undo reverts all.
  const handleAddClipsToTimeline = useCallback(
    (clips: LibraryClip[]) => {
      const entries: TimelineEntry[] = []
      const audioTracks: AudioTrack[] = []
      for (const clip of clips) {
        if (clip.kind === 'audio') audioTracks.push(audioTrackFromClip(clip, crypto.randomUUID()))
        else entries.push(entryFromClip(clip, crypto.randomUUID(), stillDuration))
      }
      dispatchTimeline({ type: 'clips-added', entries, audioTracks })
    },
    [stillDuration],
  )

  // A clip composited above the sequence — picture-in-picture for video
  // (#145), a logo/watermark/sticker layer for an image (#294). The kind
  // decides which constructor builds it; the library offers the control for
  // those two kinds only.
  const handleAddOverlay = useCallback(
    (clip: LibraryClip) => {
      dispatchTimeline({
        type: 'video-overlay-added',
        overlay:
          clip.kind === 'image'
            ? // From the sequence start (offset 0), for the configured still
              // duration — a still layer is a still (#294/#286).
              imageOverlayFromClip(clip, crypto.randomUUID(), 0, stillDuration)
            : videoOverlayFromClip(clip, crypto.randomUUID()),
      })
    },
    [stillDuration],
  )

  // Open Project / New Project (#77): the whole editing state is replaced.
  // The outgoing clips' object URLs can never be cued again, so their memory
  // is released here; the incoming state becomes the new clean baseline —
  // unless it is a restored snapshot of never-saved work (#288), which must
  // keep the unsaved indicator: the startup baseline stands in, guaranteed
  // unequal to any restorable state (empty sessions are never snapshotted),
  // and the next save re-anchors the baseline as usual.
  const handleProjectReplaced = useCallback(
    (project: { clips: LibraryClip[]; timeline: typeof timeline }, options?: { unsaved: boolean }) => {
      for (const clip of library.clips) URL.revokeObjectURL(clip.url)
      dispatch({ type: 'library-replaced', clips: project.clips })
      dispatchTimeline({ type: 'timeline-replaced', timeline: project.timeline })
      setSavedState(
        options?.unsaved ? { clips: emptyLibrary.clips, timeline: emptyTimeline } : project,
      )
    },
    [library.clips],
  )

  // Extract a video clip's audio into a new library clip (#154). Async (it
  // re-blobs the clip's bytes under a fresh URL); a failure lands in the
  // library's dismissible failure list, exactly like a failed import.
  const handleExtractAudio = useCallback((clip: LibraryClip) => {
    void (async () => {
      try {
        dispatch({ type: 'clip-added', clip: await extractAudioClip(clip, crypto.randomUUID()) })
      } catch {
        dispatch({
          type: 'import-failed',
          failure: {
            id: crypto.randomUUID(),
            name: clip.name,
            reason: `Could not extract the audio from "${clip.name}".`,
          },
        })
      }
    })()
  }, [])

  // Freeze frame (#379): the captured PNG becomes an ordinary library image
  // clip (the #154 derive-a-clip pattern), and ONE timeline action places
  // its still — split-and-hold or append — so a single undo removes the
  // whole freeze from the timeline. The clip stays in the library across
  // that undo, like a recording or an extracted track: the library is not
  // under timeline history, and the capture is a deliverable of its own.
  const handleFreezeFrame = useCallback(
    (blob: Blob, frame: SourceDimensions, sequenceTime: number, target: FreezeTarget) => {
      const clip = freezeFrameClip(blob, sequenceTime, crypto.randomUUID(), frame)
      dispatch({ type: 'clip-added', clip })
      dispatchTimeline({
        type: 'frame-frozen',
        still: entryFromClip(clip, crypto.randomUUID(), FREEZE_STILL_DURATION),
        placement:
          target.kind === 'split' ? { ...target, newEntryId: crypto.randomUUID() } : target,
      })
    },
    [],
  )

  const handleRemoveClip = useCallback((clip: LibraryClip) => {
    dispatch({ type: 'clip-removed', id: clip.id })
    dispatchTimeline({ type: 'entries-removed-for-clip', clipId: clip.id })
    // The clip and every timeline entry created from it are gone from state,
    // so nothing can cue this URL again — release the imported file's memory.
    URL.revokeObjectURL(clip.url)
  }, [])

  // A whole library selection removed in one step (#293). One action pair
  // for the batch, not N: the history-clearing rule (history.ts) is then
  // evaluated once over one removal instead of N times across N
  // intermediate states, and one confirmation covers the lot.
  const handleRemoveClips = useCallback((clips: LibraryClip[]) => {
    if (clips.length === 0) return
    const ids = clips.map((clip) => clip.id)
    dispatch({ type: 'clips-removed', ids })
    dispatchTimeline({ type: 'entries-removed-for-clips', clipIds: ids })
    // Same release as the single removal: the clips and everything created
    // from them are gone from state, so no URL here can be cued again.
    for (const clip of clips) URL.revokeObjectURL(clip.url)
  }, [])

  const timelineUseCount = useCallback(
    (clipId: string) =>
      timeline.entries.filter((entry) => entry.clipId === clipId).length +
      (timeline.audioTracks ?? []).filter((track) => track.clipId === clipId).length +
      (timeline.videoOverlays ?? []).filter((overlay) => overlay.clipId === clipId).length,
    [timeline],
  )

  // Ctrl/Cmd+Z undoes and Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redoes (#189) —
  // except inside text-editing fields, where the browser's own text undo
  // must keep working (see targetEditsText).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const key = event.key.toLowerCase()
      const undo = key === 'z' && !event.shiftKey
      const redo = (key === 'z' && event.shiftKey) || key === 'y'
      if (!undo && !redo) return
      if (targetEditsText(event.target)) return
      event.preventDefault()
      dispatchTimeline({ type: undo ? 'edit-undone' : 'edit-redone' })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files')

  const handleDragEnter = (event: DragEvent) => {
    if (!hasFiles(event)) return
    event.preventDefault()
    dragDepth.current += 1
    setIsDragTarget(true)
  }

  const handleDragOver = (event: DragEvent) => {
    if (!hasFiles(event)) return
    event.preventDefault()
  }

  const handleDragLeave = (event: DragEvent) => {
    if (!hasFiles(event)) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setIsDragTarget(false)
  }

  const handleDrop = (event: DragEvent) => {
    if (!hasFiles(event)) return
    event.preventDefault()
    dragDepth.current = 0
    setIsDragTarget(false)
    const files = Array.from(event.dataTransfer.files)
    if (files.length > 0) handleImportFiles(files)
  }

  return (
    <div
      className={isDragTarget ? 'app app-drag-target' : 'app'}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <header className="app-header">
        <div>
          <h1>Browser Video Editor</h1>
          <p className="tagline">Import, arrange, trim, preview, export — all in your browser.</p>
        </div>
        <ProjectControls
          library={library}
          timeline={timeline}
          dirty={dirty}
          onSaved={setSavedState}
          onProjectReplaced={handleProjectReplaced}
          port={savePort}
          probeMedia={probeMedia}
          autosave={autosaveStore}
          onSetCanvasPreset={(preset) => dispatchTimeline({ type: 'canvas-preset-set', preset })}
          settings={settings}
          onSetSettings={handleSetSettings}
        />
      </header>
      <main className={previewExpanded ? 'app-main app-main-preview-expanded' : 'app-main'}>
        <MediaLibrary
          library={library}
          onImportFiles={handleImportFiles}
          onRecordingFailed={(reason) =>
            dispatch({
              type: 'import-failed',
              failure: { id: crypto.randomUUID(), name: 'Voice-over', reason },
            })
          }
          onDismissFailures={() => dispatch({ type: 'failures-dismissed' })}
          onAddToTimeline={handleAddToTimeline}
          onAddClipsToTimeline={handleAddClipsToTimeline}
          onAddOverlay={handleAddOverlay}
          onExtractAudio={handleExtractAudio}
          onRemoveClip={handleRemoveClip}
          onRemoveClips={handleRemoveClips}
          onSortClips={(key, direction) => dispatch({ type: 'clips-sorted', key, direction })}
          timelineUseCount={timelineUseCount}
          view={libraryView}
          onSetView={handleSetLibraryView}
        />
        <PreviewPlayer
          timeline={timeline}
          expanded={previewExpanded}
          onToggleExpanded={togglePreviewExpanded}
          stepSeconds={settings.stepSeconds}
          largeStepSeconds={settings.largeStepSeconds}
          onSplit={(id, atSourceTime) =>
            dispatchTimeline({
              type: 'entry-split',
              id,
              atSourceTime,
              newEntryId: crypto.randomUUID(),
            })
          }
          onFreezeFrame={handleFreezeFrame}
        />
        <Timeline
          timeline={timeline}
          canUndo={history.past.length > 0}
          canRedo={history.future.length > 0}
          onUndo={() => dispatchTimeline({ type: 'edit-undone' })}
          onRedo={() => dispatchTimeline({ type: 'edit-redone' })}
          onMoveEntry={(id, direction) => dispatchTimeline({ type: 'entry-moved', id, direction })}
          onDuplicate={(kind, id) =>
            dispatchTimeline({ type: 'element-duplicated', kind, id, newId: crypto.randomUUID() })
          }
          onPasteSettings={(kind, id, settings) =>
            dispatchTimeline({ type: 'settings-pasted', kind, id, settings })
          }
          onRemoveEntry={(id) => dispatchTimeline({ type: 'entry-removed', id })}
          onTrimEntry={(id, inPoint, outPoint) =>
            dispatchTimeline({ type: 'entry-trimmed', id, inPoint, outPoint })
          }
          onSetStillDuration={(id, duration) =>
            dispatchTimeline({ type: 'still-duration-set', id, duration })
          }
          onAddSlate={() =>
            dispatchTimeline({
              type: 'entry-added',
              // The default color (#143) with the configured duration (#286).
              entry: slateEntry(crypto.randomUUID(), undefined, stillDuration),
            })
          }
          onSetSlateColor={(id, color) => dispatchTimeline({ type: 'slate-color-set', id, color })}
          onSetTransition={(beforeId, afterId, transition) =>
            dispatchTimeline({ type: 'transition-set', beforeId, afterId, transition })
          }
          onRemoveTransition={(beforeId, afterId) =>
            dispatchTimeline({ type: 'transition-removed', beforeId, afterId })
          }
          onAddZoom={(entryId, zoom) =>
            dispatchTimeline({
              type: 'zoom-added',
              zoom: { ...zoom, id: crypto.randomUUID(), entryId },
            })
          }
          onUpdateZoom={(id, zoom) => dispatchTimeline({ type: 'zoom-updated', id, zoom })}
          onRemoveZoom={(id) => dispatchTimeline({ type: 'zoom-removed', id })}
          onAddRemap={(entryId, remap) =>
            dispatchTimeline({
              type: 'remap-added',
              remap: { ...remap, id: crypto.randomUUID(), entryId },
            })
          }
          onUpdateRemap={(id, remap) => dispatchTimeline({ type: 'remap-updated', id, remap })}
          onRemoveRemap={(id) => dispatchTimeline({ type: 'remap-removed', id })}
          onAddText={() =>
            dispatchTimeline({
              type: 'text-added',
              text: { ...DEFAULT_TEXT, id: crypto.randomUUID() },
            })
          }
          onImportSubtitles={handleImportSubtitles}
          subtitleStyle={timeline.subtitleStyle}
          onSetSubtitleStyle={(style) => dispatchTimeline({ type: 'subtitle-style-set', style })}
          onUpdateText={(id, text) => dispatchTimeline({ type: 'text-updated', id, text })}
          onRemoveText={(id) => dispatchTimeline({ type: 'text-removed', id })}
          onUpdateVideoOverlay={(id, placement) =>
            dispatchTimeline({ type: 'video-overlay-updated', id, placement })
          }
          onRemoveVideoOverlay={(id) => dispatchTimeline({ type: 'video-overlay-removed', id })}
          onRemoveAudioTrack={(id) => dispatchTimeline({ type: 'audio-track-removed', id })}
          onRetimeAudioTrack={(id, offset) =>
            dispatchTimeline({ type: 'audio-track-retimed', id, offset })
          }
          onTrimAudioTrack={(id, inPoint, outPoint) =>
            dispatchTimeline({ type: 'audio-track-trimmed', id, inPoint, outPoint })
          }
          onSetEntryVolume={(id, volume) =>
            dispatchTimeline({ type: 'entry-volume-set', id, volume })
          }
          onSetEntryMuted={(id, muted) => dispatchTimeline({ type: 'entry-mute-set', id, muted })}
          onSetEntryFades={(id, fadeIn, fadeOut) =>
            dispatchTimeline({ type: 'entry-fades-set', id, fadeIn, fadeOut })
          }
          onSetEntryColor={(id, adjustments) =>
            dispatchTimeline({ type: 'entry-color-set', id, adjustments })
          }
          onSetVideoOverlayColor={(id, adjustments) =>
            dispatchTimeline({ type: 'video-overlay-color-set', id, adjustments })
          }
          onSetEntryOrientation={(id, orientation) =>
            dispatchTimeline({ type: 'entry-orient-set', id, orientation })
          }
          onSetVideoOverlayOrientation={(id, orientation) =>
            dispatchTimeline({ type: 'video-overlay-orient-set', id, orientation })
          }
          onSetEntryCrop={(id, crop) => dispatchTimeline({ type: 'entry-crop-set', id, crop })}
          onSetEntryBackgroundFill={(id, fill) =>
            dispatchTimeline({ type: 'entry-background-fill-set', id, fill })
          }
          onSetVideoOverlayCrop={(id, crop) =>
            dispatchTimeline({ type: 'video-overlay-crop-set', id, crop })
          }
          onSetVideoOverlayMask={(id, mask) =>
            dispatchTimeline({ type: 'video-overlay-mask-set', id, mask })
          }
          onSetAudioTrackVolume={(id, volume) =>
            dispatchTimeline({ type: 'audio-track-volume-set', id, volume })
          }
          onSetAudioTrackFades={(id, fadeIn, fadeOut) =>
            dispatchTimeline({ type: 'audio-track-fades-set', id, fadeIn, fadeOut })
          }
          onSetAudioTrackDuck={(id, duck, duckLevel) =>
            dispatchTimeline({ type: 'audio-track-duck-set', id, duck, duckLevel })
          }
        />
      </main>
    </div>
  )
}

export default App
