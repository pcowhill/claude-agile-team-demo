import { useEffect, useId, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { formatDuration } from '../lib/mediaLibrary'
import { matchFileToClip, restoreProject } from '../lib/openProject'
import type { RestoredProject } from '../lib/openProject'
import { probeMediaFile } from '../lib/probeMedia'
import type { Project } from '../lib/projectFile'
import './dialog.css'
import './OpenProjectDialog.css'

interface OpenProjectDialogProps {
  /** Name of the picked project file, for the heading. */
  fileName: string
  project: Project
  onCancel: () => void
  /** Called with the fully re-linked project; ownership of URLs transfers. */
  onOpen: (restored: RestoredProject) => void
  /** Injectable for tests (jsdom cannot probe real media). */
  probeMedia?: typeof probeMediaFile
}

/**
 * The re-link step of opening a project (#77): project files reference media
 * rather than embed it (#75), so the user re-selects the files and each one
 * is matched to a stored clip by filename and duration. The project opens
 * only once every clip is linked — a partially linked state is shown per
 * clip in the list, never applied to the editor half-broken.
 */
export function OpenProjectDialog({
  fileName,
  project,
  onCancel,
  onOpen,
  probeMedia = probeMediaFile,
}: OpenProjectDialogProps) {
  const headingId = useId()
  const chooseRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // clipId → object URL of the re-linked media file.
  const [links, setLinks] = useState<ReadonlyMap<string, string>>(new Map())
  const [problems, setProblems] = useState<string[]>([])
  const [probing, setProbing] = useState(false)
  // On cancel/unmount-without-open the probed URLs must be released; on open
  // they transfer to the app. A ref tracks the live set across renders.
  const linksRef = useRef(links)
  linksRef.current = links
  const openedRef = useRef(false)

  useEffect(() => {
    // Focus starts on the action that makes progress; Escape cancels.
    chooseRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onCancel])

  useEffect(
    () => () => {
      if (!openedRef.current) {
        for (const url of linksRef.current.values()) URL.revokeObjectURL(url)
      }
    },
    [],
  )

  const handleFiles = async (files: File[]) => {
    setProbing(true)
    const nextLinks = new Map(links)
    // Each pick's problems replace the previous pick's: stale reports about
    // files the user already replaced would only mislead.
    const nextProblems: string[] = []
    for (const file of files) {
      let probed
      try {
        probed = await probeMedia(file)
      } catch (error) {
        nextProblems.push(
          error instanceof Error ? error.message : `Could not read "${file.name}".`,
        )
        continue
      }
      const match = matchFileToClip(
        project.clips,
        new Set(nextLinks.keys()),
        file.name,
        probed.duration,
        probed.kind,
        // Images match on pixel dimensions instead of duration (#137).
        probed.width !== undefined && probed.height !== undefined
          ? { width: probed.width, height: probed.height }
          : undefined,
      )
      if (match.kind === 'matched') {
        nextLinks.set(match.clipId, probed.url)
      } else {
        URL.revokeObjectURL(probed.url)
        nextProblems.push(match.reason)
      }
    }
    setLinks(nextLinks)
    setProblems(nextProblems)
    setProbing(false)
  }

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length > 0) void handleFiles(files)
    // Allow re-picking the same file (e.g. after a mismatch report).
    event.target.value = ''
  }

  const allLinked = project.clips.every((clip) => links.has(clip.id))

  const handleOpen = () => {
    openedRef.current = true
    onOpen(restoreProject(project, links))
  }

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="dialog open-project-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id={headingId}>Open {fileName}</h3>
        <p>
          Project files store references to your media, not the media itself. Re-select the
          original files to link them back up; each is matched by filename and duration (images
          by filename and dimensions).
        </p>
        <ul className="relink-list" aria-label="Project media">
          {project.clips.map((clip) => (
            <li key={clip.id} className="relink-item">
              <span className="clip-name" title={clip.name}>
                {clip.name}
              </span>
              {clip.kind !== 'video' && (
                <span className="clip-kind">{clip.kind === 'audio' ? 'Audio' : 'Image'}</span>
              )}
              {/* An image has no duration to show (#137). */}
              <span className="clip-duration">
                {clip.kind === 'image' ? '—' : formatDuration(clip.duration)}
              </span>
              <span className={links.has(clip.id) ? 'relink-linked' : 'relink-missing'}>
                {links.has(clip.id) ? 'Linked ✓' : 'Missing'}
              </span>
            </li>
          ))}
        </ul>
        {problems.length > 0 && (
          <ul className="relink-problems" role="alert">
            {problems.map((problem, index) => (
              <li key={index}>{problem}</li>
            ))}
          </ul>
        )}
        <div className="dialog-actions">
          <button type="button" ref={chooseRef} disabled={probing} onClick={() => inputRef.current?.click()}>
            Choose media files…
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="video/*,audio/*,image/*"
            multiple
            hidden
            data-testid="relink-file-input"
            onChange={handleInputChange}
          />
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" disabled={!allLinked || probing} onClick={handleOpen}>
            Open project
          </button>
        </div>
      </div>
    </div>
  )
}
