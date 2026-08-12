export interface ProbedVideo {
  /** Duration in seconds. Finite and > 0. */
  duration: number
  /** Object URL for the file. Owned by the caller once resolved. */
  url: string
}

const PROBE_TIMEOUT_MS = 15_000

/**
 * Reads video metadata from a File by loading it into an off-DOM <video>
 * element. Resolves with the duration and an object URL for later playback;
 * the URL is revoked automatically on failure but kept alive on success.
 *
 * `createVideo` is injectable for tests (jsdom never fires media events).
 */
export function probeVideoFile(
  file: File,
  createVideo: () => HTMLVideoElement = () => document.createElement('video'),
): Promise<ProbedVideo> {
  const url = URL.createObjectURL(file)
  const video = createVideo()

  return new Promise<ProbedVideo>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined

    const finish = (result: ProbedVideo | Error) => {
      clearTimeout(timer)
      video.onloadedmetadata = null
      video.ondurationchange = null
      video.onerror = null
      video.removeAttribute('src')
      video.load()
      if (result instanceof Error) {
        URL.revokeObjectURL(url)
        reject(result)
      } else {
        resolve(result)
      }
    }

    const settleIfKnown = () => {
      const { duration } = video
      if (Number.isFinite(duration) && duration > 0) {
        finish({ duration, url })
        return true
      }
      return false
    }

    video.onloadedmetadata = () => {
      if (settleIfKnown()) return
      // Streamed recordings (e.g. MediaRecorder WebM) report Infinity until
      // the browser is forced to scan to the end: seek far past it, then a
      // durationchange delivers the real value.
      video.ondurationchange = () => settleIfKnown()
      video.currentTime = Number.MAX_SAFE_INTEGER
    }

    video.onerror = () => {
      finish(new Error(`"${file.name}" is not a video this browser can decode.`))
    }

    timer = setTimeout(() => {
      finish(new Error(`Timed out reading video metadata from "${file.name}".`))
    }, PROBE_TIMEOUT_MS)

    video.preload = 'metadata'
    video.muted = true
    video.src = url
  })
}
