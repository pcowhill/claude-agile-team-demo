import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { TimelineState } from '../lib/timeline'
import { EXPORT_FRAME_RATE, ExportCanceledError } from '../lib/exportVideo'
import { exportFileName, exportFormats, supportedExportFormats } from '../lib/exportFormats'
import type { ExportEncodeOptions } from '../lib/exportFormats'
import {
  EXPORT_SIZE_PRESETS,
  MAX_EXPORT_DIMENSION,
  MAX_EXPORT_FRAME_RATE,
  MIN_EXPORT_DIMENSION,
  automaticExportFrame,
  isValidExportSettings,
} from '../lib/exportSettings'
import { FALLBACK_FRAME } from '../lib/frameSize'
import './dialog.css'
import './ExportControl.css'

/**
 * How the modal runs an export: the picked format's id plus everything the
 * format's encode entry point takes. The default routes through the
 * export-format registry (#196).
 */
export type DoExport = (
  timeline: TimelineState,
  options: ExportEncodeOptions & { format: string },
) => Promise<Blob>

const defaultDoExport: DoExport = (timeline, { format, ...options }) =>
  exportFormats.get(format).encode(timeline, options)

interface ExportControlProps {
  timeline: TimelineState
  /** Injectable for tests (jsdom cannot run the real media pipeline). */
  doExport?: DoExport
  /** Injectable for tests (jsdom has no MediaRecorder). */
  isTypeSupported?: (type: string) => boolean
  /** Injectable for tests (jsdom never fires media metadata events). */
  probeFrame?: typeof automaticExportFrame
}

/**
 * The size selector's state (#179): 'auto' follows the sources (no override
 * is sent to the export), a preset id fills the fields with that tier, and
 * 'custom' is whatever the fields say — which is where any manual edit puts
 * the selector.
 */
type SizeMode = 'auto' | 'custom' | (typeof EXPORT_SIZE_PRESETS)[number]['id']

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
  doExport = defaultDoExport,
  isTypeSupported = defaultIsTypeSupported,
  probeFrame = automaticExportFrame,
}: ExportControlProps) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<ExportStatus>({ kind: 'idle' })
  // Output settings (#179), reset to the automatic values on every open —
  // they apply to one export only, per the feedback (#169). Drafts are
  // strings so the user can type freely; validity gates the Export button.
  const [sizeMode, setSizeMode] = useState<SizeMode>('auto')
  const [widthDraft, setWidthDraft] = useState(String(FALLBACK_FRAME.width))
  const [heightDraft, setHeightDraft] = useState(String(FALLBACK_FRAME.height))
  const [frameRateDraft, setFrameRateDraft] = useState(String(EXPORT_FRAME_RATE))
  // The probe resolves after the dialog opens; it must not overwrite fields
  // the user has already put into a preset or custom state.
  const sizeModeRef = useRef<SizeMode>('auto')
  sizeModeRef.current = sizeMode
  // What MediaRecorder encodes is a fixed property of the running browser
  // (#114), but the registry's contents are not: plugins register and
  // unregister formats at runtime (#197), so the picker subscribes and
  // re-reads on every registry change. Cheap enough to recompute per render
  // (a handful of specs against a feature probe), so no memo to invalidate.
  useSyncExternalStore(exportFormats.subscribe, () => exportFormats.version)
  const formats = supportedExportFormats(isTypeSupported)
  // WebM stays the default wherever it is recordable (#114).
  const [format, setFormat] = useState<string>(() =>
    formats.some((spec) => spec.id === 'webm') ? 'webm' : (formats[0]?.id ?? 'webm'),
  )
  // A picked format can vanish mid-session — its plugin was disabled (#197).
  // Fall back to the default choice rather than exporting an unknown id.
  useEffect(() => {
    if (formats.length > 0 && !formats.some((spec) => spec.id === format)) {
      setFormat(formats.some((spec) => spec.id === 'webm') ? 'webm' : formats[0].id)
    }
  }, [formats, format])
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
    // Fresh automatic settings for this export (#179): the fallback shows
    // until the probe below resolves the sources' real frame.
    setSizeMode('auto')
    setWidthDraft(String(FALLBACK_FRAME.width))
    setHeightDraft(String(FALLBACK_FRAME.height))
    setFrameRateDraft(String(EXPORT_FRAME_RATE))
    setOpen(true)
  }

  // Pre-fill the fields with the values the automatic behavior would use
  // (#179): the same outputFrameSize rule the export applies, probed from
  // the current sources each time the dialog opens.
  useEffect(() => {
    if (!open) return undefined
    let stale = false
    void probeFrame(timeline).then((frame) => {
      if (stale || sizeModeRef.current !== 'auto') return
      setWidthDraft(String(frame.width))
      setHeightDraft(String(frame.height))
    })
    return () => {
      stale = true
    }
  }, [open, probeFrame, timeline])

  const parsedSettings = {
    width: Number(widthDraft),
    height: Number(heightDraft),
    frameRate: Number(frameRateDraft),
  }
  const settingsValid = isValidExportSettings(parsedSettings)
  // An audio-only format (#245) records no video track, so the video-only
  // output settings are hidden while it is selected — and their drafts,
  // valid or not, neither gate nor parameterize the export.
  const audioOnly = formats.find((spec) => spec.id === format)?.audioOnly === true

  /** A manual field edit puts the selector into its Custom state (#179). */
  const editField = (set: (value: string) => void) => (value: string) => {
    set(value)
    setSizeMode('custom')
  }

  const selectSizeMode = (mode: SizeMode) => {
    setSizeMode(mode)
    const preset = EXPORT_SIZE_PRESETS.find((candidate) => candidate.id === mode)
    if (preset !== undefined) {
      setWidthDraft(String(preset.width))
      setHeightDraft(String(preset.height))
    }
    if (mode === 'auto') {
      // Back to following the sources: re-show the automatic values (the
      // effect above re-fills them when the probe resolves).
      setWidthDraft(String(FALLBACK_FRAME.width))
      setHeightDraft(String(FALLBACK_FRAME.height))
      void probeFrame(timeline).then((frame) => {
        if (sizeModeRef.current !== 'auto') return
        setWidthDraft(String(frame.width))
        setHeightDraft(String(frame.height))
      })
    }
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
        // Auto sends no frame override — the export derives the frame from
        // the sources exactly as before (#179); anything else exports at
        // what the fields say. An audio-only format (#245) has no frame or
        // frame rate to send at all.
        ...(audioOnly
          ? {}
          : {
              ...(sizeMode === 'auto'
                ? {}
                : { frame: { width: parsedSettings.width, height: parsedSettings.height } }),
              frameRate: parsedSettings.frameRate,
            }),
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
              {formats.map((spec) => (
                <label key={spec.id} className="export-format-option">
                  <input
                    type="radio"
                    name="export-format"
                    disabled={exporting}
                    checked={format === spec.id}
                    onChange={() => setFormat(spec.id)}
                  />
                  {spec.label}
                </label>
              ))}
              {/* The selected format's stated limits (#198): a spec with a
                  note (e.g. the GIF plugin's frame-rate and size caps) says
                  so right where the format is chosen. */}
              {(() => {
                const note = formats.find((spec) => spec.id === format)?.note
                return note !== undefined && <p className="export-format-note">{note}</p>
              })()}
            </fieldset>
            {!audioOnly && (
            <fieldset className="export-settings">
              <legend>Output</legend>
              <label className="export-settings-row">
                Size
                <select
                  aria-label="Export size preset"
                  disabled={exporting}
                  value={sizeMode}
                  onChange={(event) => selectSizeMode(event.target.value as SizeMode)}
                >
                  <option value="auto">Auto (match sources)</option>
                  {EXPORT_SIZE_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                  <option value="custom">Custom</option>
                </select>
              </label>
              <div className="export-settings-row">
                <label>
                  Width
                  <input
                    type="number"
                    inputMode="numeric"
                    aria-label="Export width in pixels"
                    min={MIN_EXPORT_DIMENSION}
                    max={MAX_EXPORT_DIMENSION}
                    step={1}
                    disabled={exporting}
                    value={widthDraft}
                    onChange={(event) => editField(setWidthDraft)(event.target.value)}
                  />
                </label>
                <label>
                  Height
                  <input
                    type="number"
                    inputMode="numeric"
                    aria-label="Export height in pixels"
                    min={MIN_EXPORT_DIMENSION}
                    max={MAX_EXPORT_DIMENSION}
                    step={1}
                    disabled={exporting}
                    value={heightDraft}
                    onChange={(event) => editField(setHeightDraft)(event.target.value)}
                  />
                </label>
                <label>
                  Frame rate
                  <input
                    type="number"
                    inputMode="decimal"
                    aria-label="Export frame rate in frames per second"
                    min={1}
                    max={MAX_EXPORT_FRAME_RATE}
                    step={1}
                    disabled={exporting}
                    value={frameRateDraft}
                    onChange={(event) => editField(setFrameRateDraft)(event.target.value)}
                  />
                </label>
              </div>
              {!settingsValid && (
                <p className="export-error" role="alert">
                  Width and height must be whole numbers between {MIN_EXPORT_DIMENSION} and{' '}
                  {MAX_EXPORT_DIMENSION}, and the frame rate between 1 and{' '}
                  {MAX_EXPORT_FRAME_RATE}.
                </p>
              )}
            </fieldset>
            )}
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
                disabled={exporting || (!audioOnly && !settingsValid)}
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
