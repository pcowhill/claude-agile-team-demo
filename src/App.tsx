import { useCallback, useReducer, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { ExportPanel } from './components/ExportPanel'
import { MediaLibrary } from './components/MediaLibrary'
import { PreviewPlayer } from './components/PreviewPlayer'
import { ProjectControls } from './components/ProjectControls'
import { Timeline } from './components/Timeline'
import { emptyLibrary, mediaLibraryReducer } from './lib/mediaLibrary'
import type { LibraryClip } from './lib/mediaLibrary'
import { audioTrackFromClip, emptyTimeline, entryFromClip, slateEntry, timelineReducer } from './lib/timeline'
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
  const [timeline, dispatchTimeline] = useReducer(timelineReducer, emptyTimeline)
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
      (timeline.audioTracks ?? []).filter((track) => track.clipId === clipId).length,
    [timeline],
  )

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
        />
      </header>
      <main className={previewExpanded ? 'app-main app-main-preview-expanded' : 'app-main'}>
        <MediaLibrary
          library={library}
          onImportFiles={handleImportFiles}
          onDismissFailures={() => dispatch({ type: 'failures-dismissed' })}
          onAddToTimeline={handleAddToTimeline}
          onRemoveClip={handleRemoveClip}
          onSortClips={(key, direction) => dispatch({ type: 'clips-sorted', key, direction })}
          timelineUseCount={timelineUseCount}
        />
        <PreviewPlayer
          timeline={timeline}
          expanded={previewExpanded}
          onToggleExpanded={togglePreviewExpanded}
        />
        <Timeline
          timeline={timeline}
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
          onSetAudioTrackVolume={(id, volume) =>
            dispatchTimeline({ type: 'audio-track-volume-set', id, volume })
          }
          onSetAudioTrackFades={(id, fadeIn, fadeOut) =>
            dispatchTimeline({ type: 'audio-track-fades-set', id, fadeIn, fadeOut })
          }
        />
        <ExportPanel timeline={timeline} />
      </main>
    </div>
  )
}

export default App
