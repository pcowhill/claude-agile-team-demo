import { formatFrameRate, formatSampleRate } from './containerInfo'
import type { ContainerInfo } from './containerInfo'
import { clipFileName, formatDuration } from './mediaLibrary'
import type { LibraryClip } from './mediaLibrary'

/**
 * Properties… (#804, from the customer's #800): what the app can measure
 * about a library clip's file, as rows of a read-only dialog.
 *
 * Every value is either known from the clip, read from its file, or
 * "Unknown". A read that has not settled yet is "Reading…". Nothing is
 * guessed. The container, codecs, frame rate and sample rate are read from
 * the file's container headers (#805, `containerInfo.ts`), and show "Not
 * stated in the file" where the headers are readable but say nothing.
 */

/** One row: what it is, and its value in words with units. */
export interface PropertyRow {
  label: string
  value: string
}

/** A read's state: still running, settled with a value, or failed (shown as Unknown). */
export type Read<T> = { state: 'reading' } | { state: 'done'; value: T } | { state: 'failed' }

/** What the file reads found. Each one is independent, and each may still be running. */
export interface ClipReads {
  /** The blob behind the clip's URL: its MIME type ('' when the browser has none) and size. */
  file: Read<{ type: string; size: number }>
  /** A video's intrinsic size, read from its metadata. Images carry theirs on the clip. */
  dimensions: Read<{ width: number; height: number }>
  /** Channels in the decoded sound; null when there is no sound the browser can decode. */
  channels: Read<number | null>
  /** What the file's container headers state (#805). Not read for an image. */
  container: Read<ContainerInfo>
}

export const READING = 'Reading…'
export const UNKNOWN = 'Unknown'

const KIND_LABEL: Record<LibraryClip['kind'], string> = { video: 'Video', audio: 'Audio', image: 'Image' }

/**
 * A size the way a file manager writes it, in decimal units, with the
 * exact bytes after it: "4.2 MB (4,212,345 bytes)".
 */
export function formatFileSize(bytes: number): string {
  const exact = `${bytes.toLocaleString('en-US')} ${bytes === 1 ? 'byte' : 'bytes'}`
  if (bytes < 1000) return exact
  const units = ['kB', 'MB', 'GB', 'TB']
  let value = bytes / 1000
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit++
  }
  // One decimal below ten, none above: "4.2 MB", "42 MB", "420 MB".
  const shown = value < 10 ? value.toFixed(1) : Math.round(value).toString()
  return `${shown} ${units[unit]} (${exact})`
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

/**
 * An aspect ratio in its smallest whole terms when those are ones a person
 * would recognise ("16:9", "4:3", "1:1"), else as a decimal against 1
 * ("1.78:1"), since 683:384 says nothing.
 */
export function formatAspectRatio(width: number, height: number): string {
  const divisor = gcd(width, height)
  const w = width / divisor
  const h = height / divisor
  if (w <= 32 && h <= 32) return `${w}:${h}`
  return `${(width / height).toFixed(2)}:1`
}

/** Mono, Stereo, or a count. */
export function formatChannels(channels: number): string {
  if (channels === 1) return 'Mono'
  if (channels === 2) return 'Stereo'
  return `${channels} channels`
}

/** A length in the app's own format and in seconds: "1:05 (65.20 s)". */
export function formatLength(seconds: number): string {
  return `${formatDuration(seconds)} (${seconds.toFixed(2)} s)`
}

/** A read's value through `show`, or Reading… / Unknown. */
function shown<T>(read: Read<T>, show: (value: T) => string): string {
  if (read.state === 'reading') return READING
  if (read.state === 'failed') return UNKNOWN
  return show(read.value)
}

/** Audio codec and Sample rate, from the container's first audio track. */
function audioTrackRows(reads: ClipReads): PropertyRow[] {
  return [
    { label: 'Audio codec', value: shown(reads.container, ({ audio }) => audio?.codec ?? UNKNOWN) },
    {
      label: 'Sample rate',
      value: shown(reads.container, ({ audio }) => (audio === null ? UNKNOWN : formatSampleRate(audio.sampleRate))),
    },
  ]
}

/**
 * The dialog's rows for `clip`, present only where they apply (#804's
 * table). `placements` is how many timeline elements were made from the
 * clip, across the sequence, the overlay lane and the audio lane.
 */
export function clipPropertyRows(
  clip: Pick<LibraryClip, 'name' | 'fileName' | 'kind' | 'duration' | 'width' | 'height' | 'extractedFrom'>,
  reads: ClipReads,
  placements: number,
): PropertyRow[] {
  const rows: PropertyRow[] = [{ label: 'Name', value: clip.name }]
  if (clipFileName(clip) !== clip.name) rows.push({ label: 'Original filename', value: clipFileName(clip) })
  rows.push({ label: 'Kind', value: KIND_LABEL[clip.kind] })
  if (clip.extractedFrom !== undefined) rows.push({ label: 'Extracted from', value: clip.extractedFrom })

  // An extracted clip plays from its video's bytes (#154): the file rows
  // describe that file, and say so rather than pass it off as the clip's own.
  const ofSource = clip.extractedFrom === undefined ? '' : ' (the source video’s file)'
  rows.push({
    label: 'File type',
    value: shown(reads.file, ({ type }) => (type === '' ? UNKNOWN : `${type}${ofSource}`)),
  })
  if (clip.kind !== 'image') {
    rows.push({ label: 'Container', value: shown(reads.container, ({ container }) => `${container}${ofSource}`) })
  }
  rows.push({ label: 'File size', value: shown(reads.file, ({ size }) => `${formatFileSize(size)}${ofSource}`) })

  if (clip.kind !== 'image') rows.push({ label: 'Length', value: formatLength(clip.duration) })

  if (clip.kind === 'image') {
    if (clip.width !== undefined && clip.height !== undefined) {
      rows.push({ label: 'Dimensions', value: `${clip.width} × ${clip.height} px` })
      rows.push({ label: 'Aspect ratio', value: formatAspectRatio(clip.width, clip.height) })
    } else {
      rows.push({ label: 'Dimensions', value: UNKNOWN }, { label: 'Aspect ratio', value: UNKNOWN })
    }
  }
  if (clip.kind === 'video') {
    rows.push({ label: 'Dimensions', value: shown(reads.dimensions, ({ width, height }) => `${width} × ${height} px`) })
    rows.push({
      label: 'Aspect ratio',
      value: shown(reads.dimensions, ({ width, height }) => formatAspectRatio(width, height)),
    })
    rows.push({
      label: 'Frame rate',
      value: shown(reads.container, ({ video }) => (video === null ? UNKNOWN : formatFrameRate(video.frameRate))),
    })
    rows.push({ label: 'Video codec', value: shown(reads.container, ({ video }) => video?.codec ?? UNKNOWN) })
    // Whether decoding yields sound: a decode that fails says there is none
    // this browser can play, which is what the editor can use, not a claim
    // about every player.
    rows.push({
      label: 'Has sound',
      value: shown(reads.channels, (channels) => (channels === null ? 'No (none this browser can decode)' : 'Yes')),
    })
    if (reads.channels.state !== 'done' || reads.channels.value !== null) {
      rows.push({
        label: 'Audio channels',
        value: shown(reads.channels, (channels) => (channels === null ? UNKNOWN : formatChannels(channels))),
      })
    }
    // The sound's codec and rate as the container states them: a video
    // whose container has no audio track has neither row. A track the
    // browser cannot decode still has them — the file names its codec.
    if (reads.container.state !== 'done' || reads.container.value.audio !== null) rows.push(...audioTrackRows(reads))
  }
  if (clip.kind === 'audio') {
    rows.push({
      label: 'Audio channels',
      value: shown(reads.channels, (channels) => (channels === null ? UNKNOWN : formatChannels(channels))),
    })
    rows.push(...audioTrackRows(reads))
  }

  rows.push({
    label: 'On the timeline',
    value: placements === 0 ? 'Not placed' : `${placements} ${placements === 1 ? 'placement' : 'placements'}`,
  })
  return rows
}

/** The blob behind a clip's object URL: its type and size. */
export async function readClipFile(url: string): Promise<{ type: string; size: number }> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`The clip's media could not be read (${response.status}).`)
  const blob = await response.blob()
  return { type: blob.type, size: blob.size }
}

/** A video's intrinsic size, from its metadata alone. */
export function readVideoDimensions(url: string, timeoutMs = 15_000): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    const done = () => {
      clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
    }
    const timer = setTimeout(() => {
      done()
      reject(new Error('The video’s metadata did not load.'))
    }, timeoutMs)
    video.preload = 'metadata'
    video.muted = true
    video.onloadedmetadata = () => {
      const { videoWidth: width, videoHeight: height } = video
      done()
      if (width > 0 && height > 0) resolve({ width, height })
      else reject(new Error('The video reports no picture size.'))
    }
    video.onerror = () => {
      done()
      reject(new Error('The video could not be read.'))
    }
    video.src = url
  })
}

/**
 * Channels in a clip's decoded sound, or null when the browser cannot
 * decode any sound from it (a silent video). Rejects only when the browser
 * cannot decode at all, which the dialog shows as Unknown.
 */
export async function readAudioChannels(url: string): Promise<number | null> {
  if (typeof OfflineAudioContext === 'undefined') throw new Error('No Web Audio in this browser.')
  const response = await fetch(url)
  if (!response.ok) throw new Error(`The clip's media could not be read (${response.status}).`)
  const encoded = await response.arrayBuffer()
  // As audioPeaks.ts: decodes without an audible context or autoplay gating.
  const context = new OfflineAudioContext(1, 1, 44100)
  try {
    const buffer = await context.decodeAudioData(encoded)
    return buffer.numberOfChannels
  } catch {
    return null
  }
}
