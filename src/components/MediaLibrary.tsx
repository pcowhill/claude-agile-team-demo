import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react'
import type { ChangeEvent } from 'react'
import type {
  ClipSortDirection,
  ClipSortKey,
  LibraryClip,
  MediaLibraryState,
  PendingImport,
} from '../lib/mediaLibrary'
import { clipFileName, formatDuration } from '../lib/mediaLibrary'
import { downloadClip } from '../lib/clipDownload'
import { emptySelection, librarySelectionReducer, selectedClips } from '../lib/librarySelection'
import type { LibraryView } from '../lib/libraryView'
import { libraryHeaderContributions } from '../lib/libraryHeader'
import type { LibraryHeaderRegistry } from '../lib/libraryHeader'
import { AudioWaveform } from './AudioWaveform'
import { ClipPropertiesDialog } from './ClipPropertiesDialog'
import { ClipThumbnail } from './ClipThumbnail'
import { ConfirmDialog } from './ConfirmDialog'
import { RecordControl } from './RecordControl'
import type { ScreenRecordingQuality } from '../lib/recording'
import { Menu } from './Menu'
import type { MenuItem } from './Menu'
import { NameField } from './NameField'
import './MediaLibrary.css'

interface MediaLibraryProps {
  library: MediaLibraryState
  onImportFiles: (files: File[]) => void
  /**
   * Files still being read (#798), in the order they were picked: each shows
   * as a placeholder row with a busy bar and Cancel until it lands as a clip
   * or a failure. Optional so tests predating it keep compiling.
   */
  importing?: readonly PendingImport[]
  /** Cancels one pending import (#798): its row goes, and nothing is added. */
  onCancelImport?: (id: string) => void
  /** Receives a finished screen + camera take (#388) — both files together,
   * so the app can import and place them as one arrival. Optional so tests
   * predating the paired source keep compiling; without it the source is
   * simply not offered. */
  onRecordedPair?: (files: { screen: File; camera: File }) => void
  /** The recording dialog's countdown, in seconds; 0 is off (#514, a setting). */
  countdownSeconds?: number
  /** The bitrate screen recordings ask for (#853, a setting). */
  screenRecordingQuality?: ScreenRecordingQuality
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
  /**
   * Shows a clip alone in the preview panel without adding it to the
   * timeline (#403). Optional so tests predating the source preview keep
   * compiling; without it the action is not offered.
   */
  onPreviewClip?: (clip: LibraryClip) => void
  /**
   * Renames a clip's display name (#404) — the reducer's `clip-renamed`,
   * which keeps the original filename for re-linking. Optional so tests
   * predating it keep compiling; without it no rename control is offered.
   */
  onRenameClip?: (clip: LibraryClip, name: string) => void
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
  /** Injectable for tests: the header buttons plugins add (#861). */
  headerRegistry?: LibraryHeaderRegistry
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

/** The two view choices, in menu order (#416). Named for their place in
 * View ▾'s "View" group — the group's own label supplies the "view" the
 * standalone buttons used to carry in their names. */
const VIEW_CONTROLS: readonly { view: LibraryView; label: string }[] = [
  { view: 'list', label: 'List' },
  { view: 'thumbnails', label: 'Thumbnails' },
]

export function MediaLibrary({
  library,
  onImportFiles,
  importing = [],
  onCancelImport,
  onRecordedPair,
  countdownSeconds,
  screenRecordingQuality,
  onRecordingFailed,
  onDismissFailures,
  onAddToTimeline,
  onAddClipsToTimeline,
  onAddOverlay,
  onExtractAudio,
  onPreviewClip,
  onRenameClip,
  onRemoveClip,
  onRemoveClips,
  onSortClips,
  timelineUseCount,
  view,
  onSetView,
  headerRegistry = libraryHeaderContributions,
}: MediaLibraryProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  // Plugins' header buttons (#861) re-read the registry when a plugin
  // arrives or leaves. The open dialog is held by id, so a plugin disabled
  // while its dialog is open closes the dialog rather than orphaning it.
  useSyncExternalStore(headerRegistry.subscribe, () => headerRegistry.version)
  const [openSourceId, setOpenSourceId] = useState<string | null>(null)
  const openSource = openSourceId === null ? undefined : headerRegistry.find(openSourceId)
  // Forget a dialog whose button has left, so re-enabling the plugin later
  // does not reopen it unasked.
  useEffect(() => {
    if (openSourceId !== null && openSource === undefined) setOpenSourceId(null)
  }, [openSourceId, openSource])
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

  /**
   * View ▾'s items (#416). Two radio groups: the layout, always offered,
   * and the sort keys, offered only with more than one clip — the exact
   * condition the standalone cluster rendered under. The sort group's
   * checked option carries the direction arrow the pressed button used to
   * show, `aria-hidden` as it was there, so the item's accessible name
   * stays the bare key. With nothing sorted yet no option is checked, which
   * is what no button being pressed meant.
   */
  const viewItems: MenuItem[] = [
    {
      kind: 'radio-group',
      label: 'View',
      value: view,
      options: VIEW_CONTROLS.map((control) => ({ value: control.view, label: control.label })),
      onChange: (value) => onSetView(value as LibraryView),
    },
    ...(library.clips.length > 1
      ? ([
          { kind: 'separator' },
          {
            kind: 'radio-group',
            label: 'Sort by',
            value: lastSort?.key ?? '',
            options: SORT_CONTROLS.map(({ key, label }) => ({
              value: key,
              label: (
                <>
                  {label}
                  {lastSort?.key === key && (
                    <span aria-hidden="true"> {lastSort.direction === 'asc' ? '↑' : '↓'}</span>
                  )}
                </>
              ),
            })),
            onChange: (value) => handleSort(value as ClipSortKey),
          },
        ] satisfies MenuItem[])
      : []),
  ]

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

  // Inline rename (#404): which clip's name is being edited, if any — one
  // at a time, since the field takes the name's place in its row.
  const [renamingId, setRenamingId] = useState<string | null>(null)
  // The clip whose Properties… dialog is open (#804), by id so a clip
  // removed meanwhile simply closes it.
  const [propertiesId, setPropertiesId] = useState<string | null>(null)
  const closeProperties = useCallback(() => setPropertiesId(null), [])
  const propertiesClip = library.clips.find((clip) => clip.id === propertiesId)
  // Download failures (#803): only an extracted audio clip can fail, when
  // its video's sound will not decode. Shown in the failure list beside the
  // import failures, and dismissed with them; transient like them.
  const [downloadFailures, setDownloadFailures] = useState<{ id: string; reason: string }[]>([])
  const startDownload = (clip: LibraryClip) => {
    downloadClip(clip).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : 'The download failed.'
      setDownloadFailures((failures) => [
        ...failures,
        { id: crypto.randomUUID(), reason: `${clip.name} could not be downloaded: ${reason}` },
      ])
    })
  }

  // A gap beside the scrollbar (#460, from feedback #457), only while the
  // list actually scrolls: CSS cannot see overflow, and an always-on right
  // padding would indent a short library's rows away from the header's
  // right edge for no reason. Measured on mount, whenever the clip count or
  // the view changes (both change scrollHeight without changing the box),
  // and through a ResizeObserver on the list for viewport changes (the
  // #308 cap is 50vh, so the box itself moves with the window).
  const listRef = useRef<HTMLUListElement>(null)
  const [listScrolls, setListScrolls] = useState(false)
  useEffect(() => {
    const list = listRef.current
    if (list === null) {
      setListScrolls(false)
      return
    }
    const measure = () => setListScrolls(list.scrollHeight > list.clientHeight + 1)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(list)
    return () => observer.disconnect()
  }, [library.clips.length, view])

  // Double-clicking the name previews the clip (#403), like the ▶ action
  // below — the way a source monitor opens a clip in desktop editors.
  // Renaming (#404) is ⋯ → Rename… since #416; the field still takes the
  // name's slot, so the row's width does not change while editing.
  const clipName = (clip: LibraryClip) => (
    <span className="clip-name-wrap">
      {renamingId === clip.id ? (
        <NameField
          label={`New name for ${clip.name}`}
          value={clip.name}
          onCommit={(next) => {
            setRenamingId(null)
            if (next !== clip.name) onRenameClip?.(clip, next)
          }}
          onCancel={() => setRenamingId(null)}
        />
      ) : (
        <span
          className="clip-name"
          title={clipFileName(clip) === clip.name ? clip.name : `${clip.name} (file: ${clipFileName(clip)})`}
          onDoubleClick={onPreviewClip === undefined ? undefined : () => onPreviewClip(clip)}
        >
          {clip.name}
        </span>
      )}
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

  /**
   * A row's ⋯ items (#416, from the approved redesign #401 option L1 /
   * feedback #395), grouped play-or-place · edit-identity · destructive.
   * Each item is present exactly where its button was — no overlay for
   * audio (it has no picture), no extract for anything but video (#154), no
   * rename without App's wiring — and the groups are joined only where both
   * sides exist, so no menu opens on a separator.
   *
   * The menu also repeats the row's two inline actions, Preview and Add
   * (#621, the customer's #619): a reader who opens ⋯ looking for what can
   * be done with a clip finds all of it there. The buttons stay — Preview is
   * the frequent action #416 kept visible — and each item calls the same
   * handler as its button.
   */
  const clipMenuItems = (clip: LibraryClip): MenuItem[] => {
    const place: MenuItem[] = []
    if (onPreviewClip !== undefined) {
      place.push({ kind: 'action', label: 'Preview', onSelect: () => onPreviewClip(clip) })
    }
    place.push({ kind: 'action', label: 'Add to timeline', onSelect: () => onAddToTimeline(clip) })
    // Video (#145) and images (#294) can layer above the sequence — a
    // picture-in-picture, or a logo, watermark or sticker.
    if (clip.kind !== 'audio') {
      place.push({
        kind: 'action',
        label: 'Add as overlay',
        onSelect: () => onAddOverlay(clip),
      })
    }
    if (clip.kind === 'video') {
      place.push({
        kind: 'action',
        label: 'Extract audio',
        onSelect: () => onExtractAudio(clip),
      })
    }
    const identity: MenuItem[] = []
    if (onRenameClip !== undefined) {
      identity.push({
        kind: 'action',
        label: 'Rename…',
        title: 'Rename this clip (the original filename is kept for re-linking)',
        onSelect: () => setRenamingId(clip.id),
      })
    }
    // Properties… (#804, the customer's #800): what the clip's file is.
    // With the identity items, after Rename…, as triage placed it.
    identity.push({
      kind: 'action',
      label: 'Properties…',
      title: "Show this clip's length, size, dimensions and other details",
      onSelect: () => setPropertiesId(clip.id),
    })
    // Download (#803, the customer's #800): the clip's own file, unchanged,
    // or a WAV of an extracted clip's sound (clipDownload.ts says why).
    // With the identity items: it concerns the clip's file, not the timeline.
    identity.push({
      kind: 'action',
      label: 'Download',
      title:
        clip.extractedFrom === undefined
          ? "Save this clip's file on its own"
          : "Save this clip's sound on its own, as a WAV file",
      onSelect: () => startDownload(clip),
    })
    const destructive: MenuItem[] = [
      {
        kind: 'action',
        label: 'Remove',
        onSelect: () => setPendingRemoval({ kind: 'single', clip }),
      },
    ]
    return [place, identity, destructive]
      .filter((group) => group.length > 0)
      .flatMap((group, index) =>
        index === 0 ? group : [{ kind: 'separator' } as MenuItem, ...group],
      )
  }

  const clipActions = (clip: LibraryClip) => (
    <>
      {/* Preview (#403): the clip alone in the preview panel, nothing added
          to the timeline. Stays inline through the redesign (#416):
          auditioning is the frequent action the customer asked for, and
          the plan's rule is frequent → visible. */}
      {onPreviewClip && (
        <button
          type="button"
          className="clip-preview"
          aria-label={`Preview ${clip.name}`}
          title="Preview this clip in the preview panel without adding it to the timeline"
          onClick={() => onPreviewClip(clip)}
        >
          ▶
        </button>
      )}
      {/* The primary action, and the only word left in the row: video and
          images join the sequence (#102, #140), audio joins the audio lane. */}
      <button
        type="button"
        aria-label={`Add ${clip.name} to timeline`}
        onClick={() => onAddToTimeline(clip)}
      >
        Add
      </button>
      {/* Everything else behind one ⋯ (#416). The panel is named for the
          clip, so its items need only say what they do: an item labelled
          for the row as well ("Add a.mp4 as overlay" over a visible "Add as
          overlay") would be an accessible name that does not contain its
          own visible label. */}
      <Menu
        label="⋯"
        caret={false}
        ariaLabel={`More actions for ${clip.name}`}
        menuLabel={`More actions for ${clip.name}`}
        className="clip-more"
        items={clipMenuItems(clip)}
      />
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
    <div
      className={`clip-card-picture clip-card-picture-${clip.kind}`}
      // Double-clicking the picture previews the clip (#403), like the name.
      onDoubleClick={onPreviewClip === undefined ? undefined : () => onPreviewClip(clip)}
    >
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
    <section className="panel library-panel" aria-label="Media library">
      <div className="library-header">
        <h2>Media Library</h2>
        <button type="button" onClick={() => inputRef.current?.click()}>
          Import clips
        </button>
        {/* Plugins' media sources (#861), after Import clips in
            registration order. Each opens its dialog, whose files take the
            Import clips path. */}
        {headerRegistry.list().map((source) => (
          <button key={source.id} type="button" onClick={() => setOpenSourceId(source.id)}>
            {source.label}
          </button>
        ))}
        {openSource !== undefined && (
          <openSource.Dialog onImportFiles={onImportFiles} onClose={() => setOpenSourceId(null)} />
        )}
        {/* Voice-over recording (#224): the finished capture goes through
            the exact same import path as a picked file. Hidden where the
            platform cannot record. */}
        <RecordControl
          existingNames={library.clips.map((clip) => clip.name)}
          onRecorded={(file) => onImportFiles([file])}
          onRecordedPair={onRecordedPair}
          onFailed={onRecordingFailed}
          {...(countdownSeconds === undefined ? {} : { countdownSeconds })}
          {...(screenRecordingQuality === undefined
            ? {}
            : { screenQuality: screenRecordingQuality })}
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
        {/* View ▾ (#416): the layout choice (#311) and the sort keys (#123)
            in one menu, as radio groups — the current choice keeps the ✓ the
            two aria-pressed button clusters used to carry, and the header
            goes from five controls to three. Shown even with an empty
            library, as the toggle was, so the preference can be set before
            importing and the header does not reflow on the first import;
            the Sort group inside appears only with more than one clip, also
            as today. */}
        <Menu label="View" menuLabel="View menu" className="library-view-menu" items={viewItems} />
      </div>

      {library.failures.length + downloadFailures.length > 0 && (
        <div className="import-errors" role="alert">
          <ul>
            {library.failures.map((failure) => (
              <li key={failure.id}>{failure.reason}</li>
            ))}
            {downloadFailures.map((failure) => (
              <li key={failure.id}>{failure.reason}</li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              setDownloadFailures([])
              if (library.failures.length > 0) onDismissFailures()
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {library.clips.length === 0 ? (
        // While the first files are still being read, their rows below say
        // so; "No clips yet" beside them would contradict them.
        importing.length > 0 ? null : (
          <p className="placeholder">
            No clips yet. Import video, audio, or image files, or drag and drop them anywhere in
            the app.
          </p>
        )
      ) : (
        <>
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
            ref={listRef}
            className={[
              'clip-list',
              view === 'thumbnails' ? 'clip-list-thumbnails' : null,
              listScrolls ? 'clip-list-scrolls' : null,
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
                  {/* The three actions wrap as one cluster, not as three
                      loose buttons (#416): with the row's own flex-wrap
                      (#208) they used to break wherever the width ran out,
                      which at 1280px left the ⋯ alone on a second line under
                      ▶ and Add. Their combined min-content is ~125px, well
                      under the ~540px floor #208 removed, so the row's
                      min-content — and the library column with it — is
                      unaffected. */}
                  <div className="clip-actions">{clipActions(clip)}</div>
                </li>
              ),
            )}
          </ul>
        </>
      )}

      {/* Files still being read (#798): one placeholder each, after the
          clips, where each lands when its probe settles. A list of its own,
          so the clip list's selection, scrolling and queries never see a
          row that is not a clip yet. The bar says "working", not how far:
          the browser reports no progress while it reads a duration. */}
      {importing.length > 0 && (
        <ul
          className={['import-list', view === 'thumbnails' ? 'import-list-thumbnails' : null]
            .filter(Boolean)
            .join(' ')}
          aria-label="Importing clips"
        >
          {importing.map((entry) => (
            <li
              key={entry.id}
              className={view === 'thumbnails' ? 'import-item import-item-card' : 'import-item'}
            >
              <span className="import-name" title={entry.name}>
                Importing {entry.name}…
              </span>
              <span
                className="import-bar"
                role="progressbar"
                aria-label={`Importing ${entry.name}`}
                aria-valuetext="Reading the file"
              />
              {onCancelImport !== undefined && (
                <button
                  type="button"
                  className="import-cancel"
                  aria-label={`Cancel importing ${entry.name}`}
                  onClick={() => onCancelImport(entry.id)}
                >
                  Cancel
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {propertiesClip !== undefined && (
        <ClipPropertiesDialog
          clip={propertiesClip}
          placements={timelineUseCount(propertiesClip.id)}
          onClose={closeProperties}
        />
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
