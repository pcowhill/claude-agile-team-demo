import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { MediaLibrary } from './components/MediaLibrary'
import { PreviewPlayer } from './components/PreviewPlayer'
import { ProjectControls } from './components/ProjectControls'
import { Timeline } from './components/Timeline'
import { openAutosaveStore } from './lib/autosave'
import type { AutosaveStore } from './lib/autosave'
import { extractAudioClip } from './lib/extractAudio'
import { emptyLibrary, mediaLibraryReducer } from './lib/mediaLibrary'
import type { LibraryClip } from './lib/mediaLibrary'
import {
  audioTrackFromClip,
  emptyTimeline,
  entryFromClip,
  slateEntry,
  videoOverlayFromClip,
} from './lib/timeline'
import { emptyTimelineHistory, targetEditsText, timelineHistoryReducer } from './lib/history'
import { DEFAULT_TEXT } from './lib/textOverlay'
import { parseSrt, subtitleOverlaySpec } from './lib/srt'
import { loadPreviewExpanded, savePreviewExpanded } from './lib/previewLayout'
import type { PreviewLayoutStorage } from './lib/previewLayout'
import { probeMediaFile } from './lib/probeMedia'
import type { SavePort } from './lib/saveProject'
import './App.css'

interface AppProps {
  /** Injectable for tests (jsdom can probe no real media and show no picker). */
  probeMedia?: typeof probeMediaFile
  savePort?: SavePort
  /** Injectable for tests; defaults to localStorage (#128). */
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
      texts: cues.map((cue) => ({ ...subtitleOverlaySpec(cue), id: crypto.randomUUID() })),
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

  const handleAddToTimeline = useCallback((clip: LibraryClip) => {
    // Video joins the sequence; audio becomes a track on the audio lane (#102).
    if (clip.kind === 'audio') {
      dispatchTimeline({
        type: 'audio-track-added',
        track: audioTrackFromClip(clip, crypto.randomUUID()),
      })
      return
    }
    // Video and stills (#140) join the sequence alike.
    dispatchTimeline({ type: 'entry-added', entry: entryFromClip(clip, crypto.randomUUID()) })
  }, [])

  // A video clip composited above the sequence (#145) — picture-in-picture.
  const handleAddOverlay = useCallback((clip: LibraryClip) => {
    dispatchTimeline({
      type: 'video-overlay-added',
      overlay: videoOverlayFromClip(clip, crypto.randomUUID()),
    })
  }, [])

  // Open Project / New Project (#77): the whole editing state is replaced.
  // The outgoing clips' object URLs can never be cued again, so their memory
  // is released here; the incoming state becomes the new clean baseline.
  const handleProjectReplaced = useCallback(
    (project: { clips: LibraryClip[]; timeline: typeof timeline }) => {
      for (const clip of library.clips) URL.revokeObjectURL(clip.url)
      dispatch({ type: 'library-replaced', clips: project.clips })
      dispatchTimeline({ type: 'timeline-replaced', timeline: project.timeline })
      setSavedState(project)
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

  const handleRemoveClip = useCallback((clip: LibraryClip) => {
    dispatch({ type: 'clip-removed', id: clip.id })
    dispatchTimeline({ type: 'entries-removed-for-clip', clipId: clip.id })
    // The clip and every timeline entry created from it are gone from state,
    // so nothing can cue this URL again — release the imported file's memory.
    URL.revokeObjectURL(clip.url)
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
          onAddOverlay={handleAddOverlay}
          onExtractAudio={handleExtractAudio}
          onRemoveClip={handleRemoveClip}
          onSortClips={(key, direction) => dispatch({ type: 'clips-sorted', key, direction })}
          timelineUseCount={timelineUseCount}
        />
        <PreviewPlayer
          timeline={timeline}
          expanded={previewExpanded}
          onToggleExpanded={togglePreviewExpanded}
          onSplit={(id, atSourceTime) =>
            dispatchTimeline({
              type: 'entry-split',
              id,
              atSourceTime,
              newEntryId: crypto.randomUUID(),
            })
          }
        />
        <Timeline
          timeline={timeline}
          canUndo={history.past.length > 0}
          canRedo={history.future.length > 0}
          onUndo={() => dispatchTimeline({ type: 'edit-undone' })}
          onRedo={() => dispatchTimeline({ type: 'edit-redone' })}
          onMoveEntry={(id, direction) => dispatchTimeline({ type: 'entry-moved', id, direction })}
          onRemoveEntry={(id) => dispatchTimeline({ type: 'entry-removed', id })}
          onTrimEntry={(id, inPoint, outPoint) =>
            dispatchTimeline({ type: 'entry-trimmed', id, inPoint, outPoint })
          }
          onSetStillDuration={(id, duration) =>
            dispatchTimeline({ type: 'still-duration-set', id, duration })
          }
          onAddSlate={() =>
            dispatchTimeline({ type: 'entry-added', entry: slateEntry(crypto.randomUUID()) })
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
