import { useEffect, useMemo, useRef, useState } from 'react'
import type { TimelineState } from '../lib/timeline'
import {
  EXPORT_FORMAT_SPECS,
  ExportCanceledError,
  exportFileName,
  exportTimeline,
  supportedExportFormats,
} from '../lib/exportVideo'
import type { ExportFormat } from '../lib/exportVideo'
import './ExportPanel.css'

interface ExportPanelProps {
  timeline: TimelineState
  /** Injectable for tests (jsdom cannot run the real media pipeline). */
  doExport?: typeof exportTimeline
  /** Injectable for tests (jsdom has no MediaRecorder). */
  isTypeSupported?: (type: string) => boolean
}

type ExportStatus =
  | { kind: 'idle' }
  | { kind: 'exporting'; fraction: number }
  | { kind: 'done'; url: string; sizeBytes: number; fileName: string }
  | { kind: 'error'; message: string }

const defaultIsTypeSupported = (type: string) =>
  typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1_000))} kB`
}

/**
 * Exports the current timeline to a downloadable WebM file, with progress
 * while the sequence records and a re-download link once finished.
 */
export function ExportPanel({
  timeline,
  doExport = exportTimeline,
  isTypeSupported = defaultIsTypeSupported,
}: ExportPanelProps) {
  const [status, setStatus] = useState<ExportStatus>({ kind: 'idle' })
  // Feature-detected once per mount: what MediaRecorder encodes is a fixed
  // property of the running browser (#114).
  const formats = useMemo(() => supportedExportFormats(isTypeSupported), [isTypeSupported])
  // WebM stays the default wherever it is recordable — no behavior change
  // for existing users; the picker only appears when there is a real choice.
  const [format, setFormat] = useState<ExportFormat>(() =>
    formats.includes('webm') ? 'webm' : (formats[0] ?? 'webm'),
  )
  const abortRef = useRef<AbortController | null>(null)
  const resultUrlRef = useRef<string | null>(null)
  const downloadRef = useRef<HTMLAnchorElement>(null)

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

  const startExport = async () => {
    releaseResult()
    const controller = new AbortController()
    abortRef.current = controller
    // Captured now so the finished download keeps this export's name even if
    // the picker changes while a slow export records.
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
      setStatus({ kind: 'done', url, sizeBytes: blob.size, fileName })
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

  // Rendering the finished state also starts the download, so one click on
  // "Export video" ends in a saved file without a second click.
  useEffect(() => {
    if (status.kind === 'done') downloadRef.current?.click()
  }, [status])

  const empty = timeline.entries.length === 0
  const exporting = status.kind === 'exporting'

  return (
    <section className="panel panel-wide" aria-label="Export">
      <h2>Export</h2>
      <div className="export-controls">
        {formats.length > 1 && (
          <label className="export-format">
            Format
            <select
              value={format}
              disabled={exporting}
              onChange={(event) => setFormat(event.target.value as ExportFormat)}
            >
              {formats.map((supported) => (
                <option key={supported} value={supported}>
                  {EXPORT_FORMAT_SPECS[supported].label}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          disabled={empty || exporting}
          onClick={() => void startExport()}
        >
          Export video
        </button>
        {exporting && (
          <>
            <progress
              className="export-progress"
              aria-label="Export progress"
              max={1}
              value={status.fraction}
            />
            <span data-testid="export-progress-text">{Math.round(status.fraction * 100)}%</span>
            <button type="button" onClick={() => abortRef.current?.abort()}>
              Cancel
            </button>
          </>
        )}
        {status.kind === 'done' && (
          <a
            ref={downloadRef}
            className="export-download"
            href={status.url}
            download={status.fileName}
            data-testid="export-download"
          >
            Download {status.fileName} ({formatSize(status.sizeBytes)})
          </a>
        )}
      </div>
      {status.kind === 'error' && (
        <p className="export-error" role="alert">
          {status.message}
        </p>
      )}
      <p className="export-note">
        {empty
          ? 'Add clips to the timeline to export your edit.'
          : 'Exports in real time — a 30 second sequence takes about 30 seconds. Audio exports at the preview’s levels.'}
      </p>
    </section>
  )
}
