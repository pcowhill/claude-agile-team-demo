import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { TimelineState } from '../lib/timeline'
import {
  EXPORT_FORMAT_SPECS,
  ExportCanceledError,
  exportFileName,
  exportTimeline,
  supportedExportFormats,
} from '../lib/exportVideo'
import type { ExportFormat } from '../lib/exportVideo'
import './dialog.css'
import './ExportControl.css'

interface ExportControlProps {
  timeline: TimelineState
  /** Injectable for tests (jsdom cannot run the real media pipeline). */
  doExport?: typeof exportTimeline
  /** Injectable for tests (jsdom has no MediaRecorder). */
  isTypeSupported?: (type: string) => boolean
}

type ExportStatus =
  | { kind: 'idle' }
  | { kind: 'exporting'; fraction: number }
  | { kind: 'error'; message: string }

const defaultIsTypeSupported = (type: string) =>
  typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)

/**
 * The toolbar's Export Project… button and its modal (#164), replacing the
 * export card that used to sit below the timeline (#163). The modal asks the
 * format, Export records the sequence with visible progress (exports run in
 * real time, so the dialog stays up while one records), and on completion
 * the file downloads and the dialog closes. Cancel — idle or mid-export —
 * abandons the export and returns to the main view.
 */
export function ExportControl({
  timeline,
  doExport = exportTimeline,
  isTypeSupported = defaultIsTypeSupported,
}: ExportControlProps) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<ExportStatus>({ kind: 'idle' })
  // Feature-detected once per mount: what MediaRecorder encodes is a fixed
  // property of the running browser (#114).
  const formats = useMemo(() => supportedExportFormats(isTypeSupported), [isTypeSupported])
  // WebM stays the default wherever it is recordable (#114).
  const [format, setFormat] = useState<ExportFormat>(() =>
    formats.includes('webm') ? 'webm' : (formats[0] ?? 'webm'),
  )
  // The finished export: a hidden anchor auto-clicks it into a download. It
  // outlives the (closed) dialog so the object URL stays alive until the
  // next export or unmount.
  const [result, setResult] = useState<{ url: string; fileName: string } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const resultUrlRef = useRef<string | null>(null)
  const downloadRef = useRef<HTMLAnchorElement>(null)
  const exportRef = useRef<HTMLButtonElement>(null)
  const headingId = useId()

  const releaseResult = () => {
    if (resultUrlRef.current !== null) {
      URL.revokeObjectURL(resultUrlRef.current)
      resultUrlRef.current = null
    }
  }

  // The abort must fire on unmount and the object URL must not leak.
  useEffect(
    () => () => {
      abortRef.current?.abort()
      releaseResult()
    },
    [],
  )

  const exporting = status.kind === 'exporting'

  const openDialog = () => {
    // A previous run's error does not belong to this attempt.
    setStatus({ kind: 'idle' })
    setOpen(true)
  }

  /** Closes the dialog, abandoning any export still recording. */
  const cancel = () => {
    abortRef.current?.abort()
    setStatus({ kind: 'idle' })
    setOpen(false)
  }

  const startExport = async () => {
    releaseResult()
    setResult(null)
    const controller = new AbortController()
    abortRef.current = controller
    // Captured now so the finished download keeps this export's name even if
    // the picker changed while a slow export recorded.
    const fileName = exportFileName(format)
    setStatus({ kind: 'exporting', fraction: 0 })
    try {
      const blob = await doExport(timeline, {
        format,
        signal: controller.signal,
        onProgress: (fraction) => setStatus({ kind: 'exporting', fraction }),
      })
      const url = URL.createObjectURL(blob)
      resultUrlRef.current = url
      setStatus({ kind: 'idle' })
      setOpen(false)
      setResult({ url, fileName })
    } catch (error) {
      if (error instanceof ExportCanceledError) {
        setStatus({ kind: 'idle' })
      } else {
        setStatus({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Export failed unexpectedly.',
        })
      }
    }
  }

  // Rendering the finished result also starts the download, so the modal's
  // Export click ends in a saved file without another click.
  useEffect(() => {
    if (result !== null) downloadRef.current?.click()
  }, [result])

  // Same hand-rolled modal idiom as SaveModeDialog: focus starts on the
  // confirm action, Escape cancels from anywhere.
  useEffect(() => {
    if (!open) return
    exportRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open])

  return (
    <>
      <button
        type="button"
        disabled={timeline.entries.length === 0}
        title={
          timeline.entries.length === 0
            ? 'Add clips to the timeline to export your edit.'
            : undefined
        }
        onClick={openDialog}
      >
        Export Project…
      </button>
      {result !== null && (
        // Hidden on purpose: the click above is the download; no visible UI
        // remains once the dialog closes.
        <a
          ref={downloadRef}
          href={result.url}
          download={result.fileName}
          data-testid="export-download"
          hidden
        >
          Download {result.fileName}
        </a>
      )}
      {open && (
        <div className="dialog-overlay" onClick={cancel}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
            className="dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id={headingId}>Export project</h3>
            <fieldset className="export-format-options">
              <legend>Format</legend>
              {formats.map((supported) => (
                <label key={supported} className="export-format-option">
                  <input
                    type="radio"
                    name="export-format"
                    disabled={exporting}
                    checked={format === supported}
                    onChange={() => setFormat(supported)}
                  />
                  {EXPORT_FORMAT_SPECS[supported].label}
                </label>
              ))}
            </fieldset>
            {exporting ? (
              <div className="export-progress-row">
                <progress
                  className="export-progress"
                  aria-label="Export progress"
                  max={1}
                  value={status.fraction}
                />
                <span data-testid="export-progress-text">
                  {Math.round(status.fraction * 100)}%
                </span>
              </div>
            ) : (
              <p className="export-note">
                Exports in real time — a 30 second sequence takes about 30 seconds. Audio exports
                at the preview’s levels.
              </p>
            )}
            {status.kind === 'error' && (
              <p className="export-error" role="alert">
                {status.message}
              </p>
            )}
            <div className="dialog-actions">
              <button type="button" onClick={cancel}>
                Cancel
              </button>
              <button
                type="button"
                ref={exportRef}
                disabled={exporting}
                onClick={() => void startExport()}
              >
                Export
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
