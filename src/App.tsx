import { useCallback, useReducer, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { MediaLibrary } from './components/MediaLibrary'
import { emptyLibrary, mediaLibraryReducer } from './lib/mediaLibrary'
import { probeVideoFile } from './lib/probeVideo'
import './App.css'

function App() {
  const [library, dispatch] = useReducer(mediaLibraryReducer, emptyLibrary)
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
        />
        <section className="panel" aria-label="Preview">
          <h2>Preview</h2>
          <p className="placeholder">Playback preview is coming soon.</p>
        </section>
        <section className="panel panel-wide" aria-label="Timeline">
          <h2>Timeline</h2>
          <p className="placeholder">Clip arrangement is coming soon.</p>
        </section>
      </main>
    </div>
  )
}

export default App
