import { useCallback, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type {
  ClipSortDirection,
  ClipSortKey,
  LibraryClip,
  MediaLibraryState,
} from '../lib/mediaLibrary'
import { formatDuration } from '../lib/mediaLibrary'
import { ConfirmDialog } from './ConfirmDialog'
import './MediaLibrary.css'

interface MediaLibraryProps {
  library: MediaLibraryState
  onImportFiles: (files: File[]) => void
  onDismissFailures: () => void
  onAddToTimeline: (clip: LibraryClip) => void
  /** Extracts a video clip's audio into a new library clip (#154). */
  onExtractAudio: (clip: LibraryClip) => void
  onRemoveClip: (clip: LibraryClip) => void
  /** Reorders the stored clip list (#123). */
  onSortClips: (key: ClipSortKey, direction: ClipSortDirection) => void
  /** How many timeline entries were created from the given library clip. */
  timelineUseCount: (clipId: string) => number
}

/** Control order and labels, per the customer's wording (#121): Name
 * (alphabetical), Type (videos together, audios together), Length. */
const SORT_CONTROLS: readonly { key: ClipSortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'kind', label: 'Type' },
  { key: 'duration', label: 'Length' },
]

/** Badge text per kind (#101, #120, #137) — meaning as text, never color alone. */
const KIND_LABELS: Record<LibraryClip['kind'], string> = {
  video: 'Video',
  audio: 'Audio',
  image: 'Image',
}

export function MediaLibrary({
  library,
  onImportFiles,
  onDismissFailures,
  onAddToTimeline,
  onExtractAudio,
  onRemoveClip,
  onSortClips,
  timelineUseCount,
}: MediaLibraryProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pendingRemoval, setPendingRemoval] = useState<LibraryClip | null>(null)
  // The last sort applied (#123). Sorting is an action on the stored list,
  // not a persistent view — this only marks which key a repeat click would
  // reverse, and which direction it ran.
  const [lastSort, setLastSort] = useState<{
    key: ClipSortKey
    direction: ClipSortDirection
  } | null>(null)

  const handleSort = (key: ClipSortKey) => {
    // Same key again reverses that sort; a different key starts ascending.
    const direction: ClipSortDirection =
      lastSort?.key === key && lastSort.direction === 'asc' ? 'desc' : 'asc'
    setLastSort({ key, direction })
    onSortClips(key, direction)
  }

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length > 0) onImportFiles(files)
    // Allow re-importing the same file (e.g. after a failure).
    event.target.value = ''
  }

  const cancelRemoval = useCallback(() => setPendingRemoval(null), [])

  const confirmRemoval = () => {
    if (pendingRemoval) onRemoveClip(pendingRemoval)
    setPendingRemoval(null)
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
          accept="video/*,audio/*,image/*"
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
          No clips yet. Import video, audio, or image files, or drag and drop them anywhere in the
          app.
        </p>
      ) : (
        <>
          {library.clips.length > 1 && (
            <div className="clip-sort" role="group" aria-label="Sort clips">
              <span className="clip-sort-label">Sort by</span>
              {SORT_CONTROLS.map(({ key, label }) => {
                const active = lastSort?.key === key
                return (
                  <button
                    key={key}
                    type="button"
                    aria-label={`Sort by ${label.toLowerCase()}`}
                    aria-pressed={active}
                    onClick={() => handleSort(key)}
                  >
                    {label}
                    {active && (
                      <span aria-hidden="true"> {lastSort.direction === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
          <ul className="clip-list" aria-label="Imported clips">
          {library.clips.map((clip) => (
            <li key={clip.id} className="clip-item">
              <span className="clip-name" title={clip.name}>
                {clip.name}
              </span>
              <span className={`clip-kind clip-kind-${clip.kind}`}>
                {KIND_LABELS[clip.kind]}
              </span>
              {/* An image has no duration (#137); an em dash keeps the column
                  aligned without pretending stills are zero seconds long. */}
              <span className="clip-duration">
                {clip.kind === 'image' ? '—' : formatDuration(clip.duration)}
              </span>
              {/* Video and images join the sequence (#102, #140); audio
                  joins the audio lane. */}
              <button
                type="button"
                aria-label={`Add ${clip.name} to timeline`}
                onClick={() => onAddToTimeline(clip)}
              >
                Add
              </button>
              {/* Only a video has audio to pull out (#154): the extracted
                  clip appears in this list as ordinary audio. */}
              {clip.kind === 'video' && (
                <button
                  type="button"
                  aria-label={`Extract audio from ${clip.name}`}
                  onClick={() => onExtractAudio(clip)}
                >
                  Extract audio
                </button>
              )}
              <button
                type="button"
                aria-label={`Remove ${clip.name} from library`}
                onClick={() => setPendingRemoval(clip)}
              >
                Remove
              </button>
            </li>
          ))}
          </ul>
        </>
      )}

      {pendingRemoval && (
        <ConfirmDialog
          title={`Remove ${pendingRemoval.name}?`}
          body={(() => {
            const count = timelineUseCount(pendingRemoval.id)
            return count > 0
              ? `This also removes ${
                  count === 1 ? 'the 1 timeline entry' : `all ${count} timeline entries`
                } created from this clip.`
              : 'The clip will be removed from the media library.'
          })()}
          confirmLabel="Remove"
          onCancel={cancelRemoval}
          onConfirm={confirmRemoval}
        />
      )}
    </section>
  )
}
