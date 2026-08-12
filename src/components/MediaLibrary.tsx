import { useRef } from 'react'
import type { ChangeEvent } from 'react'
import type { LibraryClip, MediaLibraryState } from '../lib/mediaLibrary'
import { formatDuration } from '../lib/mediaLibrary'
import './MediaLibrary.css'

interface MediaLibraryProps {
  library: MediaLibraryState
  onImportFiles: (files: File[]) => void
  onDismissFailures: () => void
  onAddToTimeline: (clip: LibraryClip) => void
}

export function MediaLibrary({
  library,
  onImportFiles,
  onDismissFailures,
  onAddToTimeline,
}: MediaLibraryProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length > 0) onImportFiles(files)
    // Allow re-importing the same file (e.g. after a failure).
    event.target.value = ''
  }

  return (
    <section className="panel" aria-label="Media library">
      <div className="library-header">
        <h2>Media Library</h2>
        <button type="button" onClick={() => inputRef.current?.click()}>
          Import clips
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          multiple
          hidden
          data-testid="clip-file-input"
          onChange={handleInputChange}
        />
      </div>

      {library.failures.length > 0 && (
        <div className="import-errors" role="alert">
          <ul>
            {library.failures.map((failure) => (
              <li key={failure.id}>{failure.reason}</li>
            ))}
          </ul>
          <button type="button" onClick={onDismissFailures}>
            Dismiss
          </button>
        </div>
      )}

      {library.clips.length === 0 ? (
        <p className="placeholder">
          No clips yet. Import video files, or drag and drop them anywhere in the app.
        </p>
      ) : (
        <ul className="clip-list" aria-label="Imported clips">
          {library.clips.map((clip) => (
            <li key={clip.id} className="clip-item">
              <span className="clip-name" title={clip.name}>
                {clip.name}
              </span>
              <span className="clip-duration">{formatDuration(clip.duration)}</span>
              <button
                type="button"
                aria-label={`Add ${clip.name} to timeline`}
                onClick={() => onAddToTimeline(clip)}
              >
                Add
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
