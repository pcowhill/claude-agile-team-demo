import { useCallback, useReducer, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { ExportPanel } from './components/ExportPanel'
import { MediaLibrary } from './components/MediaLibrary'
import { PreviewPlayer } from './components/PreviewPlayer'
import { ProjectControls } from './components/ProjectControls'
import { Timeline } from './components/Timeline'
import { emptyLibrary, mediaLibraryReducer } from './lib/mediaLibrary'
import type { LibraryClip } from './lib/mediaLibrary'
import { emptyTimeline, entryFromClip, timelineReducer } from './lib/timeline'
import { probeVideoFile } from './lib/probeVideo'
import type { SavePort } from './lib/saveProject'
import './App.css'

interface AppProps {
  /** Injectable for tests (jsdom can probe no real video and show no picker). */
  probeVideo?: typeof probeVideoFile
  savePort?: SavePort
}

function App({ probeVideo = probeVideoFile, savePort }: AppProps) {
  const [library, dispatch] = useReducer(mediaLibraryReducer, emptyLibrary)
  const [timeline, dispatchTimeline] = useReducer(timelineReducer, emptyTimeline)
  const [isDragTarget, setIsDragTarget] = useState(false)
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
        const { duration, url } = await probeVideo(file)
        dispatch({
          type: 'clip-added',
          clip: { id: crypto.randomUUID(), name: file.name, duration, url },
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
  }, [probeVideo])

  const handleImportFiles = useCallback(
    (files: File[]) => {
      void importFiles(files)
    },
    [importFiles],
  )

  const handleAddToTimeline = useCallback((clip: LibraryClip) => {
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
    (clipId: string) => timeline.entries.filter((entry) => entry.clipId === clipId).length,
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
          probeVideo={probeVideo}
        />
      </header>
      <main className="app-main">
        <MediaLibrary
          library={library}
          onImportFiles={handleImportFiles}
          onDismissFailures={() => dispatch({ type: 'failures-dismissed' })}
          onAddToTimeline={handleAddToTimeline}
          onRemoveClip={handleRemoveClip}
          timelineUseCount={timelineUseCount}
        />
        <PreviewPlayer timeline={timeline} />
        <Timeline
          timeline={timeline}
          onMoveEntry={(id, direction) => dispatchTimeline({ type: 'entry-moved', id, direction })}
          onRemoveEntry={(id) => dispatchTimeline({ type: 'entry-removed', id })}
          onTrimEntry={(id, inPoint, outPoint) =>
            dispatchTimeline({ type: 'entry-trimmed', id, inPoint, outPoint })
          }
          onSetTransition={(beforeId, afterId, transition) =>
            dispatchTimeline({ type: 'transition-set', beforeId, afterId, transition })
          }
          onRemoveTransition={(beforeId, afterId) =>
            dispatchTimeline({ type: 'transition-removed', beforeId, afterId })
          }
          onSetZoom={(entryId, zoom) => dispatchTimeline({ type: 'zoom-set', entryId, zoom })}
          onRemoveZoom={(entryId) => dispatchTimeline({ type: 'zoom-removed', entryId })}
        />
        <ExportPanel timeline={timeline} />
      </main>
    </div>
  )
}

export default App
