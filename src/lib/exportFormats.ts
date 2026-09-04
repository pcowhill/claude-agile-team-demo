import type { TimelineState } from './timeline'
import {
  AUDIO_WEBM_CONTAINER,
  EXPORT_AUDIO_MIME_CANDIDATES,
  EXPORT_MIME_CANDIDATES,
  EXPORT_MIME_CANDIDATES_WITH_AUDIO,
  EXPORT_MP4_MIME_CANDIDATES,
  EXPORT_MP4_MIME_CANDIDATES_WITH_AUDIO,
  exportTimeline,
  pickExportMimeType,
} from './exportVideo'
import type { ExportOptions } from './exportVideo'

/**
 * The export-format registry — the first plugin extension point (#196, ADR
 * 0003). The export UI consults the registry for the formats it offers, and
 * every export runs through a registered spec's `encode` entry point; nothing
 * outside this module hard-codes the list of formats. Core formats (WebM,
 * MP4) register at startup, below; a plugin (the GIF exporter, phase 3 #198)
 * contributes a format by calling `exportFormats.register` when it is
 * enabled.
 *
 * **This interface is a contract future plugins depend on** (#183's API
 * stability concern): change it deliberately, with the registered specs and
 * ADR 0003 updated in the same PR. Per the approved scope-creep guard it
 * carries only what a registered format demonstrably needs today; it grows
 * when a concrete plugin needs more (e.g. a support probe beyond MIME
 * candidates), not in anticipation. Phase 2 (#197) grew it deliberately:
 * `unregister` (a disabled plugin's format leaves the picker) and
 * `subscribe` (the picker re-reads the registry when plugins change it at
 * runtime) — recorded in ADR 0003. Phase 3 (#198) grew it again, for the
 * GIF plugin's concrete needs: `isSupported` (the support probe beyond MIME
 * candidates the doc above anticipated — GIF encodes in pure JS, so
 * MediaRecorder support is the wrong question) and `note` (a line the
 * export modal shows for the selected format — where a format states its
 * limits in the UI) — recorded in ADR 0003. #245 grew it once more:
 * `audioOnly` (the export modal hides the video-only output settings for a
 * format that records no video track) — recorded in ADR 0003.
 */
export interface ExportFormatSpec {
  /** Stable identifier, unique within the registry (e.g. 'webm'). */
  id: string
  /** Human-readable name, shown in the format picker and error messages. */
  label: string
  /** Download filename extension, without the dot. */
  extension: string
  /**
   * Recorder MIME types in preference order, video-only. A format counts as
   * exportable in the running browser when any of these is recordable
   * (`supportedExportFormats`); they also parameterize the shared recording
   * pipeline for formats that encode through it.
   */
  candidates: readonly string[]
  /**
   * The preference order when the recording carries an audio track. Naming
   * only a video codec makes some browsers drop the audio track, so these
   * spell the audio codec out.
   */
  candidatesWithAudio: readonly string[]
  /**
   * The encode entry point: renders the timeline into a Blob of this format.
   * Core formats delegate to the shared MediaRecorder pipeline
   * (`exportTimeline`); a plugin format may bring its own encoder.
   */
  encode: (timeline: TimelineState, options?: ExportEncodeOptions) => Promise<Blob>
  /**
   * Support probe beyond MIME candidates (#198): when present it replaces
   * the candidates rule in `supportedExportFormats` — for a format that
   * does not encode through MediaRecorder (the GIF plugin), recordable MIME
   * types are the wrong question. Receives the same feature-detection
   * function the candidates rule uses, for probes that still care about it.
   */
  isSupported?: (isTypeSupported: (type: string) => boolean) => boolean
  /**
   * One short line the export modal shows while this format is selected
   * (#198) — where a format states its limits (e.g. the GIF plugin's frame
   * rate and size caps) in the UI. Absent means nothing to state.
   */
  note?: string
  /**
   * The format records no video track (#245): the export modal hides the
   * video-only output settings (frame size, frame rate) while it is
   * selected and passes no frame overrides to `encode`. Absent means a
   * video format.
   */
  audioOnly?: boolean
}

/**
 * What the export UI passes a spec's `encode`: everything `exportTimeline`
 * accepts except the container, which the spec itself supplies.
 */
export type ExportEncodeOptions = Omit<ExportOptions, 'container'>

/**
 * Registry of export formats, in registration order (which is picker order).
 * The app uses the `exportFormats` singleton; tests construct their own.
 */
export class ExportFormatRegistry {
  private readonly specs = new Map<string, ExportFormatSpec>()
  private readonly listeners = new Set<() => void>()
  /** Monotonic change counter — the snapshot for `useSyncExternalStore`. */
  version = 0

  /** Adds a format. A duplicate id is a programming error and throws. */
  register(spec: ExportFormatSpec): void {
    if (this.specs.has(spec.id)) {
      throw new Error(`Export format '${spec.id}' is already registered.`)
    }
    this.specs.set(spec.id, spec)
    this.notify()
  }

  /**
   * Removes a format (#197): how a disabled plugin's contribution leaves the
   * picker. Removing an id that is not registered is a no-op — a plugin's
   * deactivate must stay safe whatever order teardown runs in.
   */
  unregister(id: string): void {
    if (this.specs.delete(id)) this.notify()
  }

  /**
   * Change notification for the UI (#197): the export picker subscribes so a
   * plugin registering or unregistering a format at runtime re-renders it.
   * Pair with `version` under React's `useSyncExternalStore`.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    this.version++
    for (const listener of this.listeners) listener()
  }

  has(id: string): boolean {
    return this.specs.has(id)
  }

  /** The spec for `id`; an unknown id is a programming error and throws. */
  get(id: string): ExportFormatSpec {
    const spec = this.specs.get(id)
    if (spec === undefined) {
      throw new Error(`Unknown export format '${id}'.`)
    }
    return spec
  }

  /** All registered specs, in registration order. */
  list(): ExportFormatSpec[] {
    return [...this.specs.values()]
  }
}

/**
 * Whether the running browser's MediaRecorder can encode a MIME type — the
 * feature probe every format decision starts from (#114). Lives here rather
 * than in one component because two surfaces now ask the same question: the
 * export picker, and the settings dialog offering a default format (#286).
 * Guarded because a browser without MediaRecorder has no answer to give.
 */
export function mediaRecorderSupports(type: string): boolean {
  return typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)
}

/** The app's registry. Core formats are registered into it at startup. */
export const exportFormats = new ExportFormatRegistry()

/**
 * The formats the current browser can actually record, in registration
 * order (#114). What MediaRecorder encodes is a runtime property of the
 * visitor's browser (Firefox is WebM-only; MP4 needs Chromium 126+ or
 * Safari), so the offered formats come from feature detection, never a
 * hardcoded list. A format counts as supported when any of its video-only
 * candidates is: the with-audio lists target the same container and end in
 * the same bare fallback, and an export may run video-only anyway when Web
 * Audio is unavailable.
 */
export function supportedExportFormats(
  isSupported: (type: string) => boolean,
  registry: ExportFormatRegistry = exportFormats,
): ExportFormatSpec[] {
  return registry
    .list()
    .filter((spec) =>
      spec.isSupported !== undefined
        ? spec.isSupported(isSupported)
        : pickExportMimeType(isSupported, spec.candidates) !== null,
    )
}

/** Download filename for an export; the extension follows the container. */
export function exportFileName(
  id: string,
  registry: ExportFormatRegistry = exportFormats,
): string {
  return `sequence-export.${registry.get(id).extension}`
}

/**
 * Registers the core formats: WebM and MP4 (#114), both encoding through the
 * shared MediaRecorder pipeline. WebM registers first so it stays the picker
 * default. Exported so registry tests can populate fresh instances; the app
 * itself uses the singleton registration below.
 */
export function registerCoreExportFormats(registry: ExportFormatRegistry): void {
  /** A core spec encodes through the shared pipeline, in its own container. */
  const coreFormat = (data: Omit<ExportFormatSpec, 'encode'>): ExportFormatSpec => ({
    ...data,
    encode: (timeline, options = {}) =>
      exportTimeline(timeline, {
        ...options,
        container: {
          label: data.label,
          candidates: data.candidates,
          candidatesWithAudio: data.candidatesWithAudio,
        },
      }),
  })
  registry.register(
    coreFormat({
      id: 'webm',
      label: 'WebM',
      extension: 'webm',
      candidates: EXPORT_MIME_CANDIDATES,
      candidatesWithAudio: EXPORT_MIME_CANDIDATES_WITH_AUDIO,
    }),
  )
  registry.register(
    coreFormat({
      id: 'mp4',
      label: 'MP4',
      extension: 'mp4',
      candidates: EXPORT_MP4_MIME_CANDIDATES,
      candidatesWithAudio: EXPORT_MP4_MIME_CANDIDATES_WITH_AUDIO,
    }),
  )
  // Audio only (#245): the project's mixed soundtrack, recorded through the
  // same pipeline with no canvas video track. Registers last so the video
  // formats keep their picker positions; support needs Web Audio (the mix
  // capture is the point) on top of a recordable audio MIME type.
  registry.register({
    id: 'audio-webm',
    label: 'Audio only (WebM/Opus)',
    extension: 'webm',
    candidates: EXPORT_AUDIO_MIME_CANDIDATES,
    candidatesWithAudio: EXPORT_AUDIO_MIME_CANDIDATES,
    audioOnly: true,
    note: 'Saves just the mixed soundtrack — the file has no video track.',
    isSupported: (isTypeSupported) =>
      typeof AudioContext !== 'undefined' &&
      pickExportMimeType(isTypeSupported, EXPORT_AUDIO_MIME_CANDIDATES) !== null,
    encode: (timeline, options = {}) =>
      exportTimeline(timeline, {
        ...options,
        audioOnly: true,
        container: AUDIO_WEBM_CONTAINER,
      }),
  })
}

// Startup registration: this module is part of the core bundle, so the core
// formats exist in the singleton before any UI renders. Plugins register
// theirs later, when enabled (phase 2/3 — #197, #198).
registerCoreExportFormats(exportFormats)
