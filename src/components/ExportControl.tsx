import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { markersOf, totalDuration } from '../lib/timeline'
import type { TimelineState } from '../lib/timeline'
import { EXPORT_FRAME_RATE, ExportCanceledError } from '../lib/exportVideo'
import type { ExportRange } from '../lib/exportVideo'
import { INTRO_CHAPTER_NAME, formatChapterList } from '../lib/chapterList'
import { chapterFileName, chapterSpans } from '../lib/chapterExport'
import type { ChapterSpan } from '../lib/chapterExport'
import { formatDuration } from '../lib/mediaLibrary'
import { customExportRange, formatTimeInput } from '../lib/exportRangeInput'
import {
  exportFileName,
  exportFormats,
  mediaRecorderSupports,
  supportedExportFormats,
} from '../lib/exportFormats'
import type { ExportEncodeOptions, ExportFormatSpec } from '../lib/exportFormats'
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
  /**
   * Which format the modal opens preselected on — the user's setting (#286),
   * defaulting to WebM, which is what it always was (#114). Ignored when the
   * id is not currently recordable, so a preference for a plugin's format
   * survives the plugin being off.
   */
  defaultFormat?: string
  /**
   * The transport marks' current export range (#385), pre-validated by the
   * shared rule (`markedExportRange`); null when the marks offer none. When
   * present the modal offers "Marked range" beside "Whole project" — whole
   * project stays the default, reset on every open like the size settings.
   */
  range?: ExportRange | null
  /** Injectable for tests (jsdom cannot run the real media pipeline). */
  doExport?: DoExport
  /** Injectable for tests (jsdom has no MediaRecorder). */
  isTypeSupported?: (type: string) => boolean
  /** Injectable for tests (jsdom never fires media metadata events). */
  probeFrame?: typeof automaticExportFrame
  /**
   * A request from outside to open the modal (#415: File ▾ → Export ▸ picks
   * a format). Each distinct object opens it once, preselecting `format`
   * where given — so choosing the same format twice reopens, because the
   * caller passes a new object each time. The Export Project… button stays
   * and is unaffected; null or omitted means nothing was requested.
   */
  openRequest?: { format?: string } | null
}

/**
 * The size selector's state (#179): 'auto' follows the sources (no override
 * is sent to the export), a preset id fills the fields with that tier, and
 * 'custom' is whatever the fields say — which is where any manual edit puts
 * the selector.
 */
type SizeMode = 'auto' | 'custom' | (typeof EXPORT_SIZE_PRESETS)[number]['id']

/**
 * Which chapter a per-chapter run (#529) is on. Present only for that run,
 * so the single-file path's progress is unchanged — the bar still shows one
 * export's fraction, and this says which of how many that export is.
 */
interface ChapterProgress {
  index: number
  count: number
  name: string
}

/** One file a per-chapter run produced, recorded as it was written. */
interface ChapterFile {
  index: number
  name: string
  /** What the browser was actually told to save it as, not recomputed after. */
  fileName: string
  duration: number
}

/** Why a per-chapter run stopped before its last chapter (#530). */
type ChapterStop = { kind: 'cancelled' } | { kind: 'error'; message: string }

/**
 * The encode options a per-chapter run was started with — `encodeOptions()`
 * below, captured once so a resume sends what the first chapters got.
 */
interface ChapterEncodeOptions {
  frame?: { width: number; height: number }
  frameRate?: number
}

/**
 * A per-chapter run (#529): what it wrote, and — once it can stop early and
 * be carried on (#530) — everything a resume has to **reuse rather than
 * recompute**. The spans are the chapters as the markers stood when the
 * run started, so a resumed file keeps the number, the padding and the
 * boundaries the first run gave it; the format and encode options are the
 * ones the first chapters were recorded with, whatever the dialog's
 * controls have been set to since; and the timeline is the project the run
 * was started against, which is how a project that changed under the open
 * dialog is told apart from one that did not.
 */
interface ChapterRun {
  spans: ChapterSpan[]
  format: string
  extension: string
  encode: ChapterEncodeOptions
  timeline: TimelineState
  /** What has been written so far, in order, across every resume. */
  files: ChapterFile[]
  /** Null once every span has been written. */
  stopped: ChapterStop | null
}

type ExportStatus =
  | { kind: 'idle' }
  | { kind: 'exporting'; fraction: number; chapter?: ChapterProgress }
  | { kind: 'error'; message: string }

/**
 * Which format to preselect: the configured default where the browser can
 * record it, else WebM (the historical default, #114), else whatever is
 * offered first. One function because three places need the same answer —
 * the first render, every open of the modal, and the moment a format
 * disappears because its plugin was disabled (#197).
 */
function preferredFormat(available: ExportFormatSpec[], configured: string): string {
  if (available.some((spec) => spec.id === configured)) return configured
  if (available.some((spec) => spec.id === 'webm')) return 'webm'
  return available[0]?.id ?? 'webm'
}

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
  defaultFormat = 'webm',
  range = null,
  doExport = defaultDoExport,
  isTypeSupported = mediaRecorderSupports,
  probeFrame = automaticExportFrame,
  openRequest = null,
}: ExportControlProps) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<ExportStatus>({ kind: 'idle' })
  // Output settings (#179), reset to the automatic values on every open —
  // they apply to one export only, per the feedback (#169). Drafts are
  // strings so the user can type freely; validity gates the Export button.
  const [sizeMode, setSizeMode] = useState<SizeMode>('auto')
  // What the export covers (#385, #400): the whole sequence, the transport
  // marks' range, or a range typed into the two fields. One-export state
  // like the size settings — reset on open, never remembered. The marked
  // option is offered only while the marks form a range; Custom always is,
  // pre-filled from the marks when they form one and from the whole
  // sequence otherwise, so a span can be exported with no marks set at all.
  const [scope, setScope] = useState<'whole' | 'range' | 'custom' | 'chapters'>('whole')
  const [rangeStartDraft, setRangeStartDraft] = useState('0:00')
  const [rangeEndDraft, setRangeEndDraft] = useState('0:00')
  /**
   * The last Copy chapter list attempt (#488), carrying the exact text it
   * was made for. Comparing that text against the list the current range
   * yields is what expires the outcome: change the range and the "copied"
   * line disappears by itself, because it is no longer true of what the
   * button would now write. Cheaper and harder to get wrong than resetting
   * it from each of the controls that can change the range.
   */
  const [chapterCopy, setChapterCopy] = useState<{ text: string; failed: boolean } | null>(null)
  /**
   * The last per-chapter run of this open (#529) — finished, or stopped
   * early (#530) — or null while none has run or one is running. Its list of
   * files is the run's *mitigation*, not a flourish: browsers treat a burst
   * of downloads as suspicious and may prompt once or quietly drop later
   * files, and a chapter missing from the folder looks exactly like a
   * successful export. Listing what was asked for is what makes a dropped
   * file visible. A stopped run additionally carries what a resume needs
   * (see `ChapterRun`).
   */
  const [chapterRun, setChapterRun] = useState<ChapterRun | null>(null)
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
  const [format, setFormat] = useState<string>(() => preferredFormat(formats, defaultFormat))
  // A picked format can vanish mid-session — its plugin was disabled (#197).
  // Fall back to the preselection rather than exporting an unknown id.
  useEffect(() => {
    if (formats.length > 0 && !formats.some((spec) => spec.id === format)) {
      setFormat(preferredFormat(formats, defaultFormat))
    }
  }, [formats, format, defaultFormat])
  // The finished export: a hidden anchor auto-clicks it into a download. It
  // outlives the (closed) dialog so the object URL stays alive until the
  // next export or unmount.
  const [result, setResult] = useState<{ url: string; fileName: string } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const resultUrlRef = useRef<string | null>(null)
  /**
   * The object URLs a per-chapter run created (#529). The single path keeps
   * one alive until the next export because the anchor that downloads it
   * outlives the dialog; a chapter run makes one per file and holds them the
   * same way rather than revoking at the click, which would race a download
   * the browser has not started reading yet.
   */
  const chapterUrlsRef = useRef<string[]>([])
  const downloadRef = useRef<HTMLAnchorElement>(null)
  const exportRef = useRef<HTMLButtonElement>(null)
  const headingId = useId()

  const releaseChapterUrls = () => {
    for (const url of chapterUrlsRef.current) URL.revokeObjectURL(url)
    chapterUrlsRef.current = []
  }

  const releaseResult = () => {
    releaseChapterUrls()
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

  const openDialog = (formatOverride?: string) => {
    // A previous run's error does not belong to this attempt.
    setStatus({ kind: 'idle' })
    // The configured default format (#286), read at every open so a change
    // in the settings dialog applies without a reload. Like the size
    // settings below, the format is a one-export choice: an override picked
    // last time does not quietly become this export's format.
    // An explicit choice from File ▾ → Export ▸ (#415) wins over the
    // configured default for this one export; the picker still shows every
    // format, so the choice is a starting point rather than a lock.
    setFormat(preferredFormat(formats, formatOverride ?? defaultFormat))
    // Fresh automatic settings for this export (#179): the fallback shows
    // until the probe below resolves the sources' real frame.
    setSizeMode('auto')
    // Whole project is every export's starting point (#385): a range picked
    // for the last export never quietly becomes this one's. The custom
    // fields start from the marks when they form a range, else the whole
    // sequence (#400), so the typed range begins as something exportable.
    setScope('whole')
    setRangeStartDraft(formatTimeInput(range?.start ?? 0))
    setRangeEndDraft(formatTimeInput(range?.end ?? totalDuration(timeline)))
    // A previous run's copy outcome does not belong to this one either,
    // and neither does a previous run's list of files (#529).
    setChapterCopy(null)
    setChapterRun(null)
    setWidthDraft(String(FALLBACK_FRAME.width))
    setHeightDraft(String(FALLBACK_FRAME.height))
    setFrameRateDraft(String(EXPORT_FRAME_RATE))
    setOpen(true)
  }

  // An outside request to open (#415). Keyed on the request's identity, so
  // each menu selection opens once and picking the same format again — a new
  // object — opens again.
  useEffect(() => {
    if (openRequest != null) openDialog(openRequest.format)
    // openDialog reads this render's props deliberately: the request carries
    // only the format, and everything else it resets is current by then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest])

  // Pre-fill the fields with the values the automatic behavior would use
  // (#179): the same canvasFrameSize rule the export applies (#176/#274) —
  // sources composed with the project's canvas preset — probed from the
  // current sources each time the dialog opens.
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
  // The typed range (#400), validated against the sequence's length on every
  // render: null range with a message while the fields do not form one.
  const customRange = customExportRange(
    { start: rangeStartDraft, end: rangeEndDraft },
    totalDuration(timeline),
  )
  // An audio-only format (#245) records no video track, so the video-only
  // output settings are hidden while it is selected — and their drafts,
  // valid or not, neither gate nor parameterize the export.
  const selectedSpec = formats.find((spec) => spec.id === format)
  const audioOnly = selectedSpec?.audioOnly === true

  /**
   * The spans an Each chapter run would produce (#529). Always against the
   * **whole project**: the Range group is exclusive, so combining chapters
   * with a marked or typed range would need a second control and #523 did
   * not ask for one.
   *
   * Empty means the project has no chapter marker to split on, which is what
   * the option is offered on — the same thing that makes Copy chapter list
   * worth pressing.
   */
  const chapterRunSpans = chapterSpans(markersOf(timeline), {
    start: 0,
    end: totalDuration(timeline),
  })
  const canExportChapters = chapterRunSpans.length > 0

  /**
   * The span Copy chapter list (#488) writes its times against: whatever
   * this export would cover. Null only while the typed range is not yet a
   * range — Export is disabled then too, and a list offset to a range that
   * cannot be exported would be a list of wrong times.
   */
  const chapterRange: ExportRange | null =
    scope === 'custom'
      ? customRange.range
      : scope === 'range' && range !== null
        ? range
        : // Whole project, and Each chapter too: that run covers everything,
          // so the list it would copy is the whole project's.
          { start: 0, end: totalDuration(timeline) }
  const chapterList =
    chapterRange === null ? '' : formatChapterList(markersOf(timeline), chapterRange)
  /** Why the button is disabled, on the button itself (#488). */
  const chapterListTitle =
    chapterRange === null
      ? 'Set a range that can be exported first.'
      : chapterList === ''
        ? 'No chapter markers in the exported range.'
        : undefined
  // The outcome is shown only while it still describes what the button
  // would write — see `chapterCopy`.
  const chapterOutcome =
    chapterCopy !== null && chapterCopy.text === chapterList ? chapterCopy : null

  /**
   * Writes the list to the clipboard, and on refusal shows it instead
   * (#488). The clipboard is denied often enough — an insecure origin, a
   * permissions policy, a browser that has no `navigator.clipboard` at all —
   * that failing silently would leave the user with no list and no reason,
   * and the list is short enough to select by hand. The property access is
   * inside the `try` deliberately: a missing `clipboard` throws there.
   */
  const copyChapterList = async () => {
    const text = chapterList
    if (text === '') return
    try {
      await navigator.clipboard.writeText(text)
      setChapterCopy({ text, failed: false })
    } catch {
      setChapterCopy({ text, failed: true })
    }
  }

  /** A manual field edit puts the selector into its Custom state (#179). */
  const editField = (set: (value: string) => void) => (value: string) => {
    set(value)
    setSizeMode('custom')
  }

  /** Typing into a range field selects the Custom range (#400), the same
   * way editing a size field selects the Custom size. */
  const editRangeField = (set: (value: string) => void) => (value: string) => {
    set(value)
    setScope('custom')
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
    // Cancel during a per-chapter run stops the run and **keeps the dialog**
    // (#530): the stopped state is where the files already saved are listed
    // and where Resume lives, and a dialog that closed would take both away
    // at the moment they become useful — the same reason a finished run
    // stays open. The abort ends the run through `runChapters`'s catch,
    // which records the stop; Cancel again, on the stopped dialog, closes
    // it. A single export's Cancel is unchanged: its abort has nothing to
    // list, so it closes.
    if (exporting && status.chapter !== undefined) {
      abortRef.current?.abort()
      return
    }
    abortRef.current?.abort()
    setStatus({ kind: 'idle' })
    setOpen(false)
  }

  /**
   * The encode options every export sends, whatever its range: the picked
   * format's frame and rate, or nothing at all for an audio-only format.
   * Factored out because the per-chapter run below has to send exactly the
   * same ones — a chapter exported at different settings from its
   * neighbours would be a bug nobody would think to look for.
   */
  const encodeOptions = () =>
    audioOnly
      ? {}
      : {
          ...(sizeMode === 'auto'
            ? {}
            : { frame: { width: parsedSettings.width, height: parsedSettings.height } }),
          frameRate: parsedSettings.frameRate,
        }

  /**
   * Saves one finished blob under `fileName`, the way the single-file path's
   * hidden anchor does — created, clicked and dropped, with the object URL
   * kept alive until the run is released.
   */
  const downloadChapter = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob)
    chapterUrlsRef.current.push(url)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }

  /**
   * Each chapter, one file at a time (#529). The pipeline is the single
   * export's, run once per span — there is no new rendering path here, which
   * is why a boundary inside a transition exports exactly what the preview
   * shows, as it already did for a typed range.
   *
   * The dialog **stays open** when the run finishes, unlike a single export
   * which closes on its download: the completion list is the point, and a
   * dialog that closed would take it away at the moment it becomes useful.
   *
   * One loop serves a fresh run and a resume (#530): it writes the spans
   * after the files the run already has, and everything it sends comes from
   * the run record rather than from the dialog's current controls, so a
   * resumed chapter is recorded exactly as the first chapters were. Whatever
   * ends it, the files already saved are saved — they are downloads, not a
   * transaction — so the record keeps them, and a stop records where and
   * why so the dialog can offer to carry on.
   */
  const runChapters = async (run: ChapterRun) => {
    const controller = new AbortController()
    abortRef.current = controller
    const files = [...run.files]
    try {
      for (const span of run.spans.slice(files.length)) {
        // Cancel between chapters, not only within one: the signal is
        // checked before each export starts, so a Cancel that lands in the
        // gap between two files stops the run rather than being ignored
        // until the next chapter has recorded.
        if (controller.signal.aborted) throw new ExportCanceledError()
        const chapter = { index: span.index, count: run.spans.length, name: span.name }
        const fileName = chapterFileName(span, run.spans.length, run.extension)
        setStatus({ kind: 'exporting', fraction: 0, chapter })
        const blob = await doExport(timeline, {
          format: run.format,
          ...run.encode,
          range: span.range,
          signal: controller.signal,
          onProgress: (fraction) => setStatus({ kind: 'exporting', fraction, chapter }),
        })
        downloadChapter(blob, fileName)
        // Recorded as each file goes out rather than recomputed at the end —
        // the same discipline that captures the single path's name before
        // its run.
        files.push({
          index: span.index,
          name: span.name,
          fileName,
          duration: span.range.end - span.range.start,
        })
      }
      setStatus({ kind: 'idle' })
      setChapterRun({ ...run, files, stopped: null })
    } catch (error) {
      // The reason lives on the run's own stopped line rather than in
      // `status`: it belongs beside the chapter it stopped at and the files
      // that did land, and the status error is the single export's, which
      // has neither.
      setStatus({ kind: 'idle' })
      setChapterRun({
        ...run,
        files,
        stopped:
          error instanceof ExportCanceledError
            ? { kind: 'cancelled' }
            : {
                kind: 'error',
                message: error instanceof Error ? error.message : 'Export failed unexpectedly.',
              },
      })
    }
  }

  const startChapterExport = async () => {
    releaseResult()
    setResult(null)
    setChapterRun(null)
    await runChapters({
      spans: chapterRunSpans,
      format,
      extension: selectedSpec?.extension ?? 'webm',
      encode: encodeOptions(),
      timeline,
      files: [],
      stopped: null,
    })
  }

  /**
   * Carry a stopped run on from the chapter it stopped at (#530). Offered
   * only while the run is resumable (see `resumableRun` below); the record
   * is cleared for the duration, as a fresh run's is, and comes back with
   * the resumed files appended, so the final list is the whole set.
   */
  const resumeChapterExport = async () => {
    if (chapterRun === null || chapterRun.stopped === null) return
    releaseResult()
    setResult(null)
    const run = chapterRun
    setChapterRun(null)
    await runChapters(run)
  }

  /**
   * A stopped run can be resumed only against the project it was started
   * on (#530): its spans and names came from the markers as they stood then,
   * and a resume renders against the timeline as it stands now, so if the
   * two differ the offer is withdrawn and the dialog says so rather than
   * exporting a different film under the first run's names. The timeline is
   * reducer state — a new object on every edit, the same one otherwise — so
   * identity is the honest test. The dialog is modal, but not everything is
   * behind it: Ctrl/Cmd+Z reaches the reducer while it is open (App.tsx),
   * so this is a state the user can reach.
   */
  const stoppedRun = chapterRun !== null && chapterRun.stopped !== null ? chapterRun : null
  const resumableRun = stoppedRun !== null && stoppedRun.timeline === timeline ? stoppedRun : null
  /** The chapter a stopped run would carry on from: the first one not written. */
  const nextSpan = stoppedRun === null ? null : stoppedRun.spans[stoppedRun.files.length]

  const startExport = async () => {
    if (scope === 'chapters') {
      await startChapterExport()
      return
    }
    releaseResult()
    setResult(null)
    // A per-chapter run leaves the dialog open on its completion list, and
    // from there the user can pick another Range and export again (#541).
    // That list describes a run the user is no longer doing, so it goes
    // when any export starts — here as well as in the chapter path — rather
    // than sitting finished-looking under a bar that has not finished, or
    // reappearing under an error if this export fails.
    setChapterRun(null)
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
        // frame rate to send at all. Shared with the per-chapter run (#529).
        ...encodeOptions(),
        // The marked range (#385) or the typed one (#400), when this export
        // is scoped to either. Read at the click: the dialog is modal, so the
        // marks cannot change under an open dialog, and the pipeline
        // re-validates against the timeline.
        ...(scope === 'range' && range !== null ? { range } : {}),
        ...(scope === 'custom' && customRange.range !== null ? { range: customRange.range } : {}),
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
  // confirm action, Escape cancels from anywhere. Through a ref, because the
  // listener is registered once per open and `cancel` now reads the status
  // (#530): the closure the effect captured would still see the idle dialog
  // it opened on, and Escape during a chapter run would close the dialog
  // instead of stopping the run. `npm run lint`'s --deny-warnings (#550)
  // is what caught the stale closure.
  const cancelRef = useRef(cancel)
  cancelRef.current = cancel
  useEffect(() => {
    if (!open) return
    exportRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelRef.current()
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
        onClick={() => openDialog()}
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
            {/* The exported span (#385, #400): the whole project, the
                transport marks' range while they form one, or a range typed
                here. Applies to every format: the range narrows the
                pipeline's replay window, not any one encoder. */}
            <fieldset className="export-format-options export-range-options">
              <legend>Range</legend>
              <label className="export-format-option">
                <input
                  type="radio"
                  name="export-scope"
                  data-testid="export-scope-whole"
                  disabled={exporting}
                  checked={scope === 'whole'}
                  onChange={() => setScope('whole')}
                />
                Whole project
              </label>
              {range !== null && (
                <label className="export-format-option">
                  <input
                    type="radio"
                    name="export-scope"
                    data-testid="export-scope-range"
                    disabled={exporting}
                    checked={scope === 'range'}
                    onChange={() => setScope('range')}
                  />
                  Marked range ({formatDuration(range.start)} – {formatDuration(range.end)})
                </label>
              )}
              {/* The fields sit beside the radio's label, not inside it: a
                  label wrapping several controls would name the radio after
                  the fields' contents too, and clicking a field would not
                  read as choosing the option — typing does that instead. */}
              <div className="export-format-option export-range-custom">
                <label>
                  <input
                    type="radio"
                    name="export-scope"
                    data-testid="export-scope-custom"
                    disabled={exporting}
                    checked={scope === 'custom'}
                    onChange={() => setScope('custom')}
                  />
                  Custom range
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label="Custom range start"
                  data-testid="export-range-start"
                  disabled={exporting}
                  value={rangeStartDraft}
                  onChange={(event) => editRangeField(setRangeStartDraft)(event.target.value)}
                />
                <span aria-hidden="true">–</span>
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label="Custom range end"
                  data-testid="export-range-end"
                  disabled={exporting}
                  value={rangeEndDraft}
                  onChange={(event) => editRangeField(setRangeEndDraft)(event.target.value)}
                />
              </div>
              {/* Each chapter (#529, from the approved #523): one file per
                  chapter marker instead of one file for the run. Offered
                  only when there is a marker to split on — with none, the
                  option would produce a single file under a chapter's name,
                  which is the whole-project export wearing a disguise. */}
              {canExportChapters && (
                <label className="export-format-option">
                  <input
                    type="radio"
                    name="export-scope"
                    data-testid="export-scope-chapters"
                    disabled={exporting}
                    checked={scope === 'chapters'}
                    onChange={() => setScope('chapters')}
                  />
                  Each chapter ({chapterRunSpans.length}{' '}
                  {chapterRunSpans.length === 1 ? 'file' : 'files'})
                </label>
              )}
              {scope === 'chapters' && (
                <p className="export-format-note">
                  One file per chapter, named “NN Name”, covering the whole project. Your browser
                  may ask to allow several downloads.
                </p>
              )}
              {scope === 'custom' && customRange.error !== null && (
                <p className="export-format-note export-range-error" data-testid="export-range-error">
                  {customRange.error} Times are m:ss or seconds.
                </p>
              )}
              {/* Copy chapter list (#488, part 2 of the approved #461): the
                  chapter markers inside the exported span, as the plain-text
                  list players parse. It belongs to the Range group because
                  the range is what decides both which markers appear and
                  what their times are. */}
              <div className="export-chapter-row">
                <button
                  type="button"
                  data-testid="export-copy-chapters"
                  disabled={exporting || chapterList === ''}
                  title={chapterListTitle}
                  onClick={() => void copyChapterList()}
                >
                  Copy chapter list
                </button>
                {/* The live region is always in the DOM and only its text
                    changes: a `role="status"` element inserted at the moment
                    it has something to say is not reliably announced. */}
                <span className="export-chapter-copied" role="status">
                  {chapterOutcome !== null && !chapterOutcome.failed ? 'Chapter list copied' : ''}
                </span>
              </div>
              <p className="export-format-note">
                A “mm:ss Name” list of the chapter markers in the exported span, with the times
                offset to its start. Players need a chapter at the very start, so a first line
                “00:00 {INTRO_CHAPTER_NAME}” is added when no marker sits there.
              </p>
              {chapterOutcome !== null && chapterOutcome.failed && (
                <>
                  <p className="export-format-note export-range-error" role="alert">
                    The clipboard refused the copy. Select the list below and copy it by hand.
                  </p>
                  <textarea
                    className="export-chapter-fallback"
                    aria-label="Chapter list"
                    data-testid="export-chapter-fallback"
                    readOnly
                    rows={Math.min(8, chapterOutcome.text.split('\n').length)}
                    value={chapterOutcome.text}
                  />
                </>
              )}
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
            {/* Which chapter is recording (#529). This is the one export
                where "how far along" needs two numbers: the bar below shows
                the current file's fraction, and a run of seven chapters
                would otherwise appear to restart six times. */}
            {exporting && status.chapter !== undefined && (
              <p
                className="export-chapter-progress"
                data-testid="export-chapter-progress"
                role="status"
              >
                Chapter {status.chapter.index} of {status.chapter.count}: {status.chapter.name}
              </p>
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
            {/* What the run produced (#529). Not a flourish — it is the
                mitigation for the one risk this feature has: a browser that
                prompts once and quietly drops the rest leaves a folder that
                looks plausible, and only a list of what was asked for makes
                the gap visible. Hence the count in the heading. */}
            {chapterRun !== null && (
              <div className="export-chapter-results" data-testid="export-chapter-results">
                <h4>
                  {chapterRun.stopped === null
                    ? `Exported ${chapterRun.files.length} ${chapterRun.files.length === 1 ? 'file' : 'files'}`
                    : `Exported ${chapterRun.files.length} of ${chapterRun.spans.length} files`}
                </h4>
                {/* Where and why a run stopped (#530): the chapter it did not
                    write, and the export's own error text or "cancelled". An
                    error is an alert, as the single export's is; a cancel is
                    the user's own doing and is announced as status. */}
                {stoppedRun !== null && nextSpan !== undefined && nextSpan !== null && (
                  <p
                    className={
                      stoppedRun.stopped?.kind === 'error' ? 'export-error' : 'export-chapter-stopped'
                    }
                    role={stoppedRun.stopped?.kind === 'error' ? 'alert' : 'status'}
                    data-testid="export-chapter-stopped"
                  >
                    Stopped at chapter {nextSpan.index} of {stoppedRun.spans.length}: {nextSpan.name}{' '}
                    — {stoppedRun.stopped?.kind === 'error' ? stoppedRun.stopped.message : 'cancelled.'}
                  </p>
                )}
                {chapterRun.files.length > 0 && (
                  <ul aria-label="Exported chapters">
                    {chapterRun.files.map((file) => (
                      <li key={file.index}>
                        <span className="export-chapter-result-name">
                          {file.index}. {file.name}
                        </span>
                        <span className="export-chapter-result-duration">
                          {formatDuration(file.duration)}
                        </span>
                        <span className="export-chapter-result-file">{file.fileName}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {chapterRun.stopped === null ? (
                  <p className="export-format-note">
                    Check your downloads folder holds all {chapterRun.files.length}. A browser that
                    asks to allow several downloads may drop the rest if it is refused.
                  </p>
                ) : resumableRun !== null && nextSpan !== undefined && nextSpan !== null ? (
                  <p className="export-format-note" data-testid="export-chapter-resume-note">
                    Resume from chapter {nextSpan.index} writes the{' '}
                    {resumableRun.spans.length - resumableRun.files.length === 1
                      ? 'one file'
                      : `${resumableRun.spans.length - resumableRun.files.length} files`}{' '}
                    still missing, with the format and output settings this run started with; the{' '}
                    {resumableRun.files.length === 1 ? 'file' : 'files'} already saved{' '}
                    {resumableRun.files.length === 1 ? 'stays' : 'stay'} saved.
                  </p>
                ) : (
                  <p className="export-format-note" data-testid="export-chapter-resume-withdrawn">
                    The project changed while this dialog was open, so this run cannot be carried on
                    against it. Export runs every chapter again, from the project as it is now.
                  </p>
                )}
              </div>
            )}
            <div className="dialog-actions export-dialog-actions">
              <button type="button" onClick={cancel}>
                Cancel
              </button>
              {resumableRun !== null && nextSpan !== undefined && nextSpan !== null && (
                <button type="button" onClick={() => void resumeChapterExport()}>
                  Resume from chapter {nextSpan.index}
                </button>
              )}
              <button
                type="button"
                ref={exportRef}
                disabled={
                  exporting ||
                  (!audioOnly && !settingsValid) ||
                  (scope === 'custom' && customRange.range === null) ||
                  (scope === 'chapters' && !canExportChapters)
                }
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
