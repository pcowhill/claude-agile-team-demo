import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type {
  ClipSortDirection,
  ClipSortKey,
  LibraryClip,
  MediaLibraryState,
} from '../lib/mediaLibrary'
import { formatDuration } from '../lib/mediaLibrary'
import { emptySelection, librarySelectionReducer, selectedClips } from '../lib/librarySelection'
import type { LibraryView } from '../lib/libraryView'
import { AudioWaveform } from './AudioWaveform'
import { ClipThumbnail } from './ClipThumbnail'
import { ConfirmDialog } from './ConfirmDialog'
import { RecordControl } from './RecordControl'
import './MediaLibrary.css'

interface MediaLibraryProps {
  library: MediaLibraryState
  onImportFiles: (files: File[]) => void
  /** Routes a recording failure into the library's failure list (#224). */
  onRecordingFailed: (reason: string) => void
  onDismissFailures: () => void
  onAddToTimeline: (clip: LibraryClip) => void
  /**
   * Adds a whole selection in library order as one undoable step (#292):
   * the same per-kind rule as `onAddToTimeline`, applied to every clip.
   */
  onAddClipsToTimeline: (clips: LibraryClip[]) => void
  /** Adds a video (#145) or image (#294) clip as an overlay layer above the sequence. */
  onAddOverlay: (clip: LibraryClip) => void
  /** Extracts a video clip's audio into a new library clip (#154). */
  onExtractAudio: (clip: LibraryClip) => void
  onRemoveClip: (clip: LibraryClip) => void
  /**
   * Removes a whole selection in one step (#293): the same per-clip
   * semantics as `onRemoveClip` — library clip, every timeline item made
   * from it, and the object URL — for all of them as one action.
   */
  onRemoveClips: (clips: LibraryClip[]) => void
  /** Reorders the stored clip list (#123). */
  onSortClips: (key: ClipSortKey, direction: ClipSortDirection) => void
  /** How many timeline entries were created from the given library clip. */
  timelineUseCount: (clipId: string) => number
  /** Which layout the clip list is in (#311); remembered per browser by `App`. */
  view: LibraryView
  onSetView: (view: LibraryView) => void
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

/**
 * The thumbnail card's placeholder mark per kind (#311): what a card shows
 * before its picture resolves, and instead of it when the media cannot be
 * decoded or drawn. Purely decorative — the card's name and kind badge carry
 * the identification — so it is `aria-hidden` and plain glyphs suffice.
 */
const KIND_GLYPHS: Record<LibraryClip['kind'], string> = {
  video: '▶',
  audio: '♪',
  image: '▣',
}

/** The two view choices, in header order, with their accessible names. */
const VIEW_CONTROLS: readonly { view: LibraryView; label: string }[] = [
  { view: 'list', label: 'List view' },
  { view: 'thumbnails', label: 'Thumbnail view' },
]

export function MediaLibrary({
  library,
  onImportFiles,
  onRecordingFailed,
  onDismissFailures,
  onAddToTimeline,
  onAddClipsToTimeline,
  onAddOverlay,
  onExtractAudio,
  onRemoveClip,
  onRemoveClips,
  onSortClips,
  timelineUseCount,
  view,
  onSetView,
}: MediaLibraryProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  // What the confirmation is about: one row's Remove, or the selection
  // bar's batch Remove (#293). One dialog serves both; only the wording
  // differs, since a batch has no single name to show.
  const [pendingRemoval, setPendingRemoval] = useState<
    { kind: 'single'; clip: LibraryClip } | { kind: 'batch'; clips: LibraryClip[] } | null
  >(null)
  // Multi-selection (#292) lives here, not in the library model, so it can
  // never reach project files or the autosave snapshot. The effective
  // selection is the intersection with the current clips in display order:
  // removed clips drop out, a replaced library starts unselected.
  const [selection, dispatchSelection] = useReducer(librarySelectionReducer, emptySelection)
  const selected = selectedClips(selection, library.clips)
  const selectedIds = new Set(selected.map((clip) => clip.id))
  const allSelected = library.clips.length > 0 && selected.length === library.clips.length
  const someSelected = selected.length > 0 && !allSelected
  // `indeterminate` is a DOM property, not an attribute — set it imperatively.
  const selectAllRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected
  }, [someSelected])

  const displayOrder = () => library.clips.map((clip) => clip.id)

  const handleSelectClip = (clip: LibraryClip, event: ChangeEvent<HTMLInputElement>) => {
    // React drives a checkbox's change from its click, so the native event
    // carries the modifier: Shift+click ranges from the anchor.
    const shift = (event.nativeEvent as Partial<MouseEvent>).shiftKey === true
    dispatchSelection(
      shift
        ? { type: 'range-selected', id: clip.id, order: displayOrder() }
        : { type: 'toggled', id: clip.id },
    )
  }

  const addSelectedToTimeline = () => {
    onAddClipsToTimeline(selected)
    dispatchSelection({ type: 'cleared' })
  }
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
    if (pendingRemoval?.kind === 'single') onRemoveClip(pendingRemoval.clip)
    if (pendingRemoval?.kind === 'batch') {
      onRemoveClips(pendingRemoval.clips)
      // The removed ids are gone, so the effective selection would empty
      // itself anyway; clearing also drops the anchor and the bar.
      dispatchSelection({ type: 'cleared' })
    }
    setPendingRemoval(null)
  }

  // ---------------------------------------------------------------------
  // The pieces both views share. List rows and thumbnail cards differ only
  // in how these are arranged, so each accessible name is written once:
  // "identical names in both views" is then true by construction rather
  // than by two copies of the JSX agreeing (#311).
  // ---------------------------------------------------------------------

  const selectCheckbox = (clip: LibraryClip) => (
    // Faded while idle (CSS) so the list stays quiet; always a real,
    // focusable checkbox for keyboard and screen readers.
    <input
      type="checkbox"
      className="clip-select"
      aria-label={`Select ${clip.name}`}
      checked={selectedIds.has(clip.id)}
      onChange={(event) => handleSelectClip(clip, event)}
    />
  )

  const clipName = (clip: LibraryClip) => (
    <span className="clip-name" title={clip.name}>
      {clip.name}
    </span>
  )

  const kindBadge = (clip: LibraryClip) => (
    <span className={`clip-kind clip-kind-${clip.kind}`}>{KIND_LABELS[clip.kind]}</span>
  )

  // An image has no duration (#137); an em dash keeps the column aligned
  // without pretending stills are zero seconds long.
  const clipDuration = (clip: LibraryClip) => (
    <span className="clip-duration">
      {clip.kind === 'image' ? '—' : formatDuration(clip.duration)}
    </span>
  )

  const clipActions = (clip: LibraryClip) => (
    <>
      {/* Video and images join the sequence (#102, #140); audio joins the
          audio lane. */}
      <button
        type="button"
        aria-label={`Add ${clip.name} to timeline`}
        onClick={() => onAddToTimeline(clip)}
      >
        Add
      </button>
      {/* Video (#145) and images (#294) can layer above the sequence — a
          picture-in-picture, or a logo, watermark or sticker. Audio cannot:
          it has no picture. */}
      {clip.kind !== 'audio' && (
        <button
          type="button"
          aria-label={`Add ${clip.name} as overlay`}
          onClick={() => onAddOverlay(clip)}
        >
          Overlay
        </button>
      )}
      {/* Only a video has audio to pull out (#154): the extracted clip
          appears in this list as ordinary audio. */}
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
        onClick={() => setPendingRemoval({ kind: 'single', clip })}
      >
        Remove
      </button>
    </>
  )

  /**
   * A card's square picture (#311): the media itself where the browser can
   * show it, drawn over a per-kind glyph. `ClipThumbnail` (#193) and
   * `AudioWaveform` (#191) both render nothing until they resolve and
   * nothing at all when they fail, which is what makes the glyph beneath
   * them the placeholder the issue asks for — no extra failure plumbing.
   * A video reuses the capture cache at `(url, 0)`, shared with every
   * untrimmed timeline entry made from the same clip.
   */
  const cardPicture = (clip: LibraryClip, index: number) => (
    <div className={`clip-card-picture clip-card-picture-${clip.kind}`}>
      <span className="clip-card-glyph" aria-hidden="true">
        {KIND_GLYPHS[clip.kind]}
      </span>
      {clip.kind === 'video' && (
        <ClipThumbnail
          url={clip.url}
          inPoint={0}
          data-testid={`clip-card-thumbnail-${index}`}
        />
      )}
      {clip.kind === 'image' && (
        // Decorative: the card's name is the accessible identification.
        <img
          className="clip-card-image"
          src={clip.url}
          alt=""
          aria-hidden="true"
          data-testid={`clip-card-image-${index}`}
        />
      )}
      {clip.kind === 'audio' && (
        // The clip's whole amplitude — the customer's reference image
        // (#309) — windowed to the untrimmed source.
        <AudioWaveform
          url={clip.url}
          duration={clip.duration}
          inPoint={0}
          outPoint={clip.duration}
          data-testid={`clip-card-waveform-${index}`}
        />
      )}
    </div>
  )

  return (
    <section className="panel" aria-label="Media library">
      <div className="library-header">
        <h2>Media Library</h2>
        <button type="button" onClick={() => inputRef.current?.click()}>
          Import clips
        </button>
        {/* Voice-over recording (#224): the finished capture goes through
            the exact same import path as a picked file. Hidden where the
            platform cannot record. */}
        <RecordControl
          existingNames={library.clips.map((clip) => clip.name)}
          onRecorded={(file) => onImportFiles([file])}
          onFailed={onRecordingFailed}
        />
        <input
          ref={inputRef}
          type="file"
          accept="video/*,audio/*,image/*"
          multiple
          hidden
          data-testid="clip-file-input"
          onChange={handleInputChange}
        />
        {/* View toggle (#311): the customer asked to switch back and forth
            between the row list and thumbnails, so both choices are always
            visible with the active one pressed — not a single button whose
            label has to be read to know the current state. Shown even with
            an empty library, so the preference can be set before importing
            and the header does not reflow on the first import. */}
        <div className="library-view-toggle" role="group" aria-label="Clip view">
          {VIEW_CONTROLS.map((control) => (
            <button
              key={control.view}
              type="button"
              aria-label={control.label}
              aria-pressed={view === control.view}
              onClick={() => onSetView(control.view)}
            >
              {control.label}
            </button>
          ))}
        </div>
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
          {/* Selection header (#292): Select-all plus, while anything is
              selected, the action bar. The bar is what turns the selection
              into work; it disappears with the selection. */}
          <div className="clip-selection-header">
            <label className="clip-select-all">
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allSelected}
                onChange={(event) =>
                  dispatchSelection({
                    type: 'all-set',
                    ids: displayOrder(),
                    selected: event.target.checked,
                  })
                }
              />
              Select all
            </label>
            {selected.length > 0 && (
              <div className="clip-selection-bar" role="toolbar" aria-label="Selected clips">
                <span className="clip-selection-count">{selected.length} selected</span>
                <button type="button" onClick={addSelectedToTimeline}>
                  Add to timeline
                </button>
                {/* Named for assistive tech: three "Remove" controls can be
                    on screen at once (each row's, this one, the dialog's). */}
                <button
                  type="button"
                  aria-label="Remove selected clips"
                  onClick={() => setPendingRemoval({ kind: 'batch', clips: selected })}
                >
                  Remove
                </button>
                <button type="button" onClick={() => dispatchSelection({ type: 'cleared' })}>
                  Clear
                </button>
              </div>
            )}
          </div>
          {/* One list element, two layouts (#311). Keeping
              ul.clip-list[aria-label="Imported clips"] and its li items in
              both views means the selection header above it (#292), the
              bounded internal scrolling (#308) and every existing query
              keep working; only a modifier class and the arrangement of the
              shared pieces change. */}
          <ul
            className={[
              'clip-list',
              view === 'thumbnails' ? 'clip-list-thumbnails' : null,
              selected.length > 0 ? 'has-selection' : null,
            ]
              .filter(Boolean)
              .join(' ')}
            aria-label="Imported clips"
          >
            {library.clips.map((clip, index) =>
              view === 'thumbnails' ? (
                <li key={clip.id} className="clip-item clip-item-card">
                  {/* Positioned over the picture's top-left corner, so a
                      card's own checkbox stays where the eye expects it
                      whatever the card's height — but written first, so
                      keyboard focus reaches it before the card's actions,
                      matching both that visual placement and the row view's
                      order (#342). It is absolutely positioned, so document
                      order does not move it; it only decides paint order,
                      which is why the CSS lifts it above the picture. */}
                  <div className="clip-card-select">{selectCheckbox(clip)}</div>
                  {cardPicture(clip, index)}
                  <div className="clip-card-body">
                    {clipName(clip)}
                    <div className="clip-card-meta">
                      {kindBadge(clip)}
                      {clipDuration(clip)}
                    </div>
                    <div className="clip-card-actions">{clipActions(clip)}</div>
                  </div>
                </li>
              ) : (
                <li key={clip.id} className="clip-item">
                  {selectCheckbox(clip)}
                  {clipName(clip)}
                  {kindBadge(clip)}
                  {clipDuration(clip)}
                  {clipActions(clip)}
                </li>
              ),
            )}
          </ul>
        </>
      )}

      {pendingRemoval && (
        <ConfirmDialog
          title={
            pendingRemoval.kind === 'single'
              ? `Remove ${pendingRemoval.clip.name}?`
              : `Remove ${pendingRemoval.clips.length} ${
                  pendingRemoval.clips.length === 1 ? 'clip' : 'clips'
                }?`
          }
          body={(() => {
            // The body reads off the count alone, so a one-clip batch and a
            // single row's Remove word it identically; only the title
            // differs, because a batch has no one name to show.
            const clips =
              pendingRemoval.kind === 'single' ? [pendingRemoval.clip] : pendingRemoval.clips
            // Each timeline item comes from exactly one clip, so summing the
            // per-clip counts counts every affected item once.
            const count = clips.reduce((total, clip) => total + timelineUseCount(clip.id), 0)
            if (count > 0) {
              return `This also removes ${
                count === 1 ? 'the 1 timeline entry' : `all ${count} timeline entries`
              } created from ${clips.length === 1 ? 'this clip' : 'them'}.`
            }
            return clips.length === 1
              ? 'The clip will be removed from the media library.'
              : 'The clips will be removed from the media library.'
          })()}
          confirmLabel="Remove"
          onCancel={cancelRemoval}
          onConfirm={confirmRemoval}
        />
      )}
    </section>
  )
}
