import type { MediaKind } from './mediaLibrary'
import { withWebmCues } from './webmCues'

export interface ProbedMedia {
  /** Duration in seconds. Finite and > 0 for video/audio; 0 for images (#137). */
  duration: number
  /** Object URL for the file. Owned by the caller once resolved. */
  url: string
  /** What the file was probed as — decides the element and the library kind. */
  kind: MediaKind
  /** Intrinsic pixel width. Present exactly when `kind` is 'image' (#137). */
  width?: number
  /** Intrinsic pixel height. Present exactly when `kind` is 'image' (#137). */
  height?: number
}

const PROBE_TIMEOUT_MS = 15_000

/**
 * Extensions probed as audio when the browser supplies no usable MIME type.
 * The MIME check below is the primary signal; this catches files arriving
 * with an empty `File.type` (some platforms report none for less common
 * containers).
 */
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'weba']

/** Extensions probed as still images (#137) when the MIME type is unusable. */
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif']

/**
 * Decides whether a file should be probed as audio, video, or a still image
 * (#101, #137), from its MIME type first and its extension as fallback.
 * Anything unrecognized is probed as video — the historical path — and fails
 * there with a clear message if it is not decodable.
 */
export function detectMediaKind(file: File): MediaKind {
  if (file.type.startsWith('audio/')) return 'audio'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('image/')) return 'image'
  const extension = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase()
  if (AUDIO_EXTENSIONS.includes(extension)) return 'audio'
  return IMAGE_EXTENSIONS.includes(extension) ? 'image' : 'video'
}

/**
 * Reads media metadata from a File by loading it into an off-DOM element —
 * a <video> for video files, an <audio> for audio files (#101); both are
 * HTMLMediaElements and behave identically for metadata. Still images
 * (#137) load into an <img> instead and probe their pixel dimensions.
 * Resolves with the duration (0 for images), the detected kind, and an
 * object URL for later playback; the URL is revoked automatically on
 * failure but kept alive on success.
 *
 * The URL a video or audio probe resolves with is for `playable(file)`
 * rather than the file itself when that differs: a WebM with no seek index
 * gets one there, because Firefox cannot seek it otherwise (#584,
 * `webmCues.ts`). It runs alongside the probe, which reads the duration
 * from the file as it came; the index does not change the duration.
 *
 * `createElement`, `createImage` and `playable` are injectable for tests
 * (jsdom never fires media or image load events).
 */
export function probeMediaFile(
  file: File,
  createElement: (kind: MediaKind) => HTMLMediaElement = (kind) =>
    document.createElement(kind === 'audio' ? 'audio' : 'video'),
  createImage: () => HTMLImageElement = () => new Image(),
  playable: (file: File) => Promise<Blob> = withWebmCues,
): Promise<ProbedMedia> {
  const kind = detectMediaKind(file)
  if (kind === 'image') return probeImageFile(file, createImage)
  const url = URL.createObjectURL(file)
  const media = createElement(kind)
  // Started now, so it overlaps the probe; a failure plays the file as is.
  const source = playable(file).catch(() => file)
  const withPlayableUrl = async (probed: ProbedMedia): Promise<ProbedMedia> => {
    const blob = await source
    if (blob === file) return probed
    URL.revokeObjectURL(url)
    return { ...probed, url: URL.createObjectURL(blob) }
  }

  return new Promise<ProbedMedia>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined

    const finish = (result: ProbedMedia | Error) => {
      clearTimeout(timer)
      media.onloadedmetadata = null
      media.ondurationchange = null
      media.onerror = null
      media.removeAttribute('src')
      media.load()
      if (result instanceof Error) {
        URL.revokeObjectURL(url)
        reject(result)
      } else {
        resolve(withPlayableUrl(result))
      }
    }

    const settleIfKnown = () => {
      const { duration } = media
      if (Number.isFinite(duration) && duration > 0) {
        finish({ duration, url, kind })
        return true
      }
      return false
    }

    media.onloadedmetadata = () => {
      if (settleIfKnown()) return
      // Streamed recordings (e.g. MediaRecorder WebM) report Infinity until
      // the browser is forced to scan to the end: seek far past it, then a
      // durationchange delivers the real value.
      media.ondurationchange = () => settleIfKnown()
      media.currentTime = Number.MAX_SAFE_INTEGER
    }

    media.onerror = () => {
      finish(
        new Error(
          kind === 'audio'
            ? `"${file.name}" is not an audio file this browser can decode.`
            : `"${file.name}" is not a video this browser can decode.`,
        ),
      )
    }

    timer = setTimeout(() => {
      finish(new Error(`Timed out reading media metadata from "${file.name}".`))
    }, PROBE_TIMEOUT_MS)

    media.preload = 'metadata'
    media.muted = true
    media.src = url
  })
}

/**
 * Probes a still image (#137) by decoding it in an off-DOM <img>. Success
 * means the browser can display it and reports positive natural dimensions —
 * which become the clip's width/height; duration is 0 because a still has
 * none (its on-screen time is a timeline decision, see #140).
 */
function probeImageFile(file: File, createImage: () => HTMLImageElement): Promise<ProbedMedia> {
  const url = URL.createObjectURL(file)
  const image = createImage()

  return new Promise<ProbedMedia>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined

    const finish = (result: ProbedMedia | Error) => {
      clearTimeout(timer)
      image.onload = null
      image.onerror = null
      image.removeAttribute('src')
      if (result instanceof Error) {
        URL.revokeObjectURL(url)
        reject(result)
      } else {
        resolve(result)
      }
    }

    image.onload = () => {
      const { naturalWidth, naturalHeight } = image
      if (naturalWidth > 0 && naturalHeight > 0) {
        finish({ duration: 0, url, kind: 'image', width: naturalWidth, height: naturalHeight })
      } else {
        // Decoded but dimensionless (e.g. an SVG with no intrinsic size):
        // nothing downstream could size a frame from it, so refuse it here.
        finish(new Error(`"${file.name}" is an image with no usable pixel dimensions.`))
      }
    }

    image.onerror = () => {
      finish(new Error(`"${file.name}" is not an image this browser can display.`))
    }

    timer = setTimeout(() => {
      finish(new Error(`Timed out reading media metadata from "${file.name}".`))
    }, PROBE_TIMEOUT_MS)

    image.src = url
  })
}
