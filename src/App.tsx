import { useCallback, useReducer, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { ExportPanel } from './components/ExportPanel'
import { MediaLibrary } from './components/MediaLibrary'
import { PreviewPlayer } from './components/PreviewPlayer'
import { Timeline } from './components/Timeline'
import { emptyLibrary, mediaLibraryReducer } from './lib/mediaLibrary'
import type { LibraryClip } from './lib/mediaLibrary'
import { emptyTimeline, entryFromClip, timelineReducer } from './lib/timeline'
import { probeVideoFile } from './lib/probeVideo'
import './App.css'

function App() {
  const [library, dispatch] = useReducer(mediaLibraryReducer, emptyLibrary)
  const [timeline, dispatchTimeline] = useReducer(timelineReducer, emptyTimeline)
  const [isDragTarget, setIsDragTarget] = useState(false)
  // dragenter/dragleave fire for every child element crossed; only the
  // outermost balance matters.
  const dragDepth = useRef(0)

  const importFiles = useCallback(async (files: File[]) => {
    // Sequential so clips appear in the order the user picked them.
    for (const file of files) {
      try {
        const { duration, url } = await probeVideoFile(file)
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
  }, [])

  const handleImportFiles = useCallback(
    (files: File[]) => {
      void importFiles(files)
    },
    [importFiles],
  )

  const handleAddToTimeline = useCallback((clip: LibraryClip) => {
    dispatchTimeline({ type: 'entry-added', entry: entryFromClip(clip, crypto.randomUUID()) })
  }, [])

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
        <h1>Browser Video Editor</h1>
        <p className="tagline">Import, arrange, trim, preview, export — all in your browser.</p>
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
        />
        <ExportPanel timeline={timeline} />
      </main>
    </div>
  )
}

export default App
