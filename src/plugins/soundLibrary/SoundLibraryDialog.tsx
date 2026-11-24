import { useEffect, useId, useRef, useState } from 'react'
import type { LibraryHeaderDialogProps } from '../../lib/libraryHeader'
import { formatSoundLength, SOUNDS, soundFileName } from './sounds'
import type { LibrarySound } from './sounds'
import '../../components/dialog.css'
import './SoundLibraryDialog.css'

interface SoundLibraryDialogProps extends LibraryHeaderDialogProps {
  /** Injectable for tests. */
  sounds?: readonly LibrarySound[]
  /** Injectable for tests: jsdom has no network. */
  fetchSound?: (url: string) => Promise<Response>
  /** Injectable for tests: jsdom's media elements cannot play. */
  createAudio?: () => HTMLAudioElement
}

/**
 * Media Library › Sound library… (#861): the set, grouped by category, each
 * with its length, ▶ preview and Add. Add downloads that one file and hands
 * it to the library's import path. The dialog stays open, so several sounds
 * can be added in a row. ▶ streams the one file, and one preview plays at a
 * time: starting another stops the first, and closing the dialog stops it.
 * Hand-rolled modal rather than `<dialog>`, as the other plugin dialogs are.
 */
export function SoundLibraryDialog({
  onImportFiles,
  onClose,
  sounds = SOUNDS,
  fetchSound = (url) => fetch(url),
  createAudio = () => new Audio(),
}: SoundLibraryDialogProps) {
  const headingId = useId()
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [adding, setAdding] = useState<ReadonlySet<string>>(new Set())
  const [status, setStatus] = useState('')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const firstButtonRef = useRef<HTMLButtonElement>(null)
  // The downloads in flight, read by `add` itself: the state above can lag
  // a fast second press by a render.
  const addingRef = useRef(new Set<string>())

  // On open only. The host passes a new `onClose` on every render, and Add
  // re-renders the host (its clip list changes), so focusing in the Escape
  // effect below sent focus, and the scrolled list, back to the first ▶
  // after every Add (#889's review).
  useEffect(() => {
    firstButtonRef.current?.focus()
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Closing the dialog, or disabling the plugin while it is open, stops the
  // preview and lets the element drop the file.
  useEffect(
    () => () => {
      const audio = audioRef.current
      if (audio === null) return
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    },
    [],
  )

  const stopPreview = () => {
    audioRef.current?.pause()
    setPlayingId(null)
  }

  const togglePreview = (sound: LibrarySound) => {
    if (playingId === sound.id) {
      stopPreview()
      return
    }
    audioRef.current ??= createAudio()
    const audio = audioRef.current
    audio.pause()
    audio.onended = () => setPlayingId(null)
    audio.src = sound.url
    setPlayingId(sound.id)
    audio.play().catch(() => {
      // A refused play (or a file that would not load) ends the preview.
      setPlayingId((current) => (current === sound.id ? null : current))
    })
  }

  const add = async (sound: LibrarySound) => {
    if (addingRef.current.has(sound.id)) return
    addingRef.current.add(sound.id)
    setAdding((current) => new Set(current).add(sound.id))
    setStatus(`Adding ${sound.name}…`)
    try {
      const response = await fetchSound(sound.url)
      if (!response.ok) throw new Error(`the server answered ${response.status}`)
      const bytes = await response.arrayBuffer()
      onImportFiles([new File([bytes], soundFileName(sound), { type: 'audio/webm' })])
      setStatus(`Added ${sound.name} to the library.`)
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'the download failed'
      setStatus(`${sound.name} could not be downloaded: ${reason}.`)
    } finally {
      addingRef.current.delete(sound.id)
      setAdding((current) => {
        const next = new Set(current)
        next.delete(sound.id)
        return next
      })
    }
  }

  const categories = [...new Set(sounds.map((sound) => sound.category))]

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="dialog sound-library-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id={headingId}>Sound library</h3>
        <p className="sound-library-licence">
          Free to use in your videos, with no credit needed (CC0). A sound downloads only when you
          play or add it.
        </p>
        <div className="sound-library-list" data-testid="sound-library-list" tabIndex={-1}>
          {categories.map((category) => (
            <section key={category} aria-label={category}>
              <h4>{category}</h4>
              <ul>
                {sounds
                  .filter((sound) => sound.category === category)
                  .map((sound) => {
                    const playing = playingId === sound.id
                    return (
                      <li key={sound.id} className="sound-library-row">
                        <span className="sound-library-name">{sound.name}</span>
                        <span className="sound-library-length">{formatSoundLength(sound.duration)}</span>
                        <button
                          type="button"
                          className="sound-library-play"
                          ref={sound === sounds[0] ? firstButtonRef : undefined}
                          aria-label={`${playing ? 'Stop' : 'Play'} ${sound.name}`}
                          aria-pressed={playing}
                          onClick={() => togglePreview(sound)}
                        >
                          {playing ? '■' : '▶'}
                        </button>
                        {/* aria-disabled, not disabled: disabling the
                            focused button would drop focus to the page
                            while the sound downloads. `add` ignores a
                            press while its download is in flight. */}
                        <button
                          type="button"
                          aria-label={`Add ${sound.name} to the library`}
                          aria-disabled={adding.has(sound.id) || undefined}
                          onClick={() => void add(sound)}
                        >
                          Add
                        </button>
                      </li>
                    )
                  })}
              </ul>
            </section>
          ))}
        </div>
        <p className="sound-library-status" role="status">
          {status}
        </p>
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
