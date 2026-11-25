import { useEffect, useId, useRef, useState } from 'react'
import type { LibraryClip } from '../lib/mediaLibrary'
import {
  clipPropertyRows,
  readAudioChannels,
  readClipFile,
  readVideoDimensions,
} from '../lib/clipProperties'
import type { ClipReads, Read } from '../lib/clipProperties'
import { readClipContainer } from '../lib/containerInfo'
import type { ContainerInfo } from '../lib/containerInfo'
import './dialog.css'
import './ClipPropertiesDialog.css'

/** The file reads, injectable for tests: jsdom has no blob fetch, media metadata or Web Audio. */
export interface ClipPropertyReaders {
  file: (url: string) => Promise<{ type: string; size: number }>
  dimensions: (url: string) => Promise<{ width: number; height: number }>
  channels: (url: string) => Promise<number | null>
  container: (url: string) => Promise<ContainerInfo>
}

const defaultReaders: ClipPropertyReaders = {
  file: readClipFile,
  dimensions: readVideoDimensions,
  channels: readAudioChannels,
  container: readClipContainer,
}

interface ClipPropertiesDialogProps {
  clip: LibraryClip
  /** Timeline elements made from the clip, in every lane. */
  placements: number
  onClose: () => void
  readers?: ClipPropertyReaders
}

const reading = { state: 'reading' } as const

/**
 * Properties… (#804, from the customer's #800): a read-only dialog of what
 * the app can measure about a library clip's file. The same hand-rolled
 * modal idiom as ConfirmDialog and the shortcut sheet, so Escape, a click
 * outside and Close all dismiss it, and the transport and undo keys wait
 * behind it like behind any other modal (modalDialogOpen).
 *
 * Focus goes to Close on open and back to whatever had it before — the
 * clip's ⋯ button, which the menu refocuses as it closes — when the dialog
 * goes. Reading a file changes nothing in the project.
 */
export function ClipPropertiesDialog({
  clip,
  placements,
  onClose,
  readers = defaultReaders,
}: ClipPropertiesDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const headingId = useId()
  const [reads, setReads] = useState<ClipReads>({
    file: reading,
    dimensions: reading,
    channels: reading,
    container: reading,
  })

  useEffect(() => {
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (returnTo?.isConnected) returnTo.focus()
    }
  }, [onClose])

  useEffect(() => {
    let live = true
    const settle = <K extends keyof ClipReads>(key: K, pending: Promise<unknown>) => {
      pending.then(
        (value) => {
          if (live) setReads((current) => ({ ...current, [key]: { state: 'done', value } as Read<unknown> }))
        },
        () => {
          if (live) setReads((current) => ({ ...current, [key]: { state: 'failed' } }))
        },
      )
    }
    settle('file', readers.file(clip.url))
    // Only what the rows will show is read: no metadata for a still, which
    // carries its size from import, and no decode for one either.
    if (clip.kind === 'video') settle('dimensions', readers.dimensions(clip.url))
    if (clip.kind !== 'image') {
      settle('channels', readers.channels(clip.url))
      settle('container', readers.container(clip.url))
    }
    return () => {
      live = false
    }
  }, [clip.url, clip.kind, readers])

  const rows = clipPropertyRows(clip, reads, placements)

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="dialog clip-properties-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id={headingId}>Properties of {clip.name}</h3>
        <div className="dialog-body">
          <dl className="clip-properties" aria-label="Properties">
            {rows.map((row) => (
              <div className="clip-properties-row" key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="dialog-actions">
          <button type="button" ref={closeRef} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
