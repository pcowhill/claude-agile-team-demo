/**
 * Timeline clip thumbnails (#193): a tiny still per video entry, captured
 * from the first frame of the entry's trimmed range so entries are
 * recognizable at a glance. Captures are cached by (url, inPoint) — every
 * entry showing the same trim of the same clip shares one capture, and
 * re-trimming the in-point is a new key, which is what triggers the
 * re-capture the issue asks for.
 *
 * Thumbnails are session state only: they are recomputable from the media,
 * so they are never written to project files (which stay small) and simply
 * re-capture after a project opens.
 *
 * Memory stays trivially bounded: each thumbnail is a fixed
 * `THUMBNAIL_WIDTH × THUMBNAIL_HEIGHT` JPEG data URL (~1–2 KB), whatever the
 * source size — the pattern #191's audio peaks established.
 */

/** Fixed thumbnail size: 16:9 at a row-friendly height. */
export const THUMBNAIL_WIDTH = 64
export const THUMBNAIL_HEIGHT = 36

/** A capture that never settles would wedge its cache entry; captures in
 * practice take well under a second, so treat a stuck one as failed. */
const CAPTURE_TIMEOUT_MS = 8000

/**
 * The source rectangle that covers a destination box (like CSS
 * `object-fit: cover`): centered, cropping the overflowing dimension.
 */
export function coverCrop(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight)
  const sw = targetWidth / scale
  const sh = targetHeight / scale
  return { sx: (sourceWidth - sw) / 2, sy: (sourceHeight - sh) / 2, sw, sh }
}

/**
 * Captures one frame of the clip at `atTime` into a fixed-size JPEG data
 * URL, or null when the browser cannot (undecodable media, no 2D canvas, a
 * capture that never settles). Failure is an expected outcome, reported as
 * a value: the row then renders text-only, exactly as before thumbnails.
 */
export async function captureVideoThumbnail(url: string, atTime: number): Promise<string | null> {
  const video = document.createElement('video')
  video.muted = true
  video.preload = 'auto'
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const drawn = new Promise<string | null>((resolve) => {
      video.addEventListener('error', () => resolve(null))
      video.addEventListener(
        'loadeddata',
        () => {
          const draw = () => {
            try {
              const canvas = document.createElement('canvas')
              canvas.width = THUMBNAIL_WIDTH
              canvas.height = THUMBNAIL_HEIGHT
              const context = canvas.getContext('2d')
              if (context === null || video.videoWidth === 0 || video.videoHeight === 0) {
                resolve(null)
                return
              }
              const { sx, sy, sw, sh } = coverCrop(
                video.videoWidth,
                video.videoHeight,
                THUMBNAIL_WIDTH,
                THUMBNAIL_HEIGHT,
              )
              context.drawImage(video, sx, sy, sw, sh, 0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT)
              resolve(canvas.toDataURL('image/jpeg', 0.7))
            } catch {
              // A tainted canvas or a codec quirk: degrade, never crash.
              resolve(null)
            }
          }
          // loadeddata leaves the first frame current; only a real trim
          // needs a seek (seeking to the current 0 fires no 'seeked').
          if (atTime > 0.001) {
            video.addEventListener('seeked', draw, { once: true })
            video.currentTime = atTime
          } else {
            draw()
          }
        },
        { once: true },
      )
      video.src = url
    })
    const timedOut = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), CAPTURE_TIMEOUT_MS)
    })
    return await Promise.race([drawn, timedOut])
  } catch {
    return null
  } finally {
    clearTimeout(timer)
    // Release the decoder; the object URL itself belongs to the library.
    video.removeAttribute('src')
    video.load()
  }
}

const thumbnailCache = new Map<string, Promise<string | null>>()

/**
 * The thumbnail for a clip's trimmed range, captured at most once per
 * (url, inPoint) and shared by every row showing it (#193). Failures cache
 * as null, so a clip that cannot be captured is not retried on every
 * render. `capture` is injectable for tests (jsdom decodes no video).
 */
export function thumbnailForTrim(
  url: string,
  inPoint: number,
  capture: (url: string, atTime: number) => Promise<string | null> = captureVideoThumbnail,
): Promise<string | null> {
  const key = `${url}#${inPoint}`
  let pending = thumbnailCache.get(key)
  if (pending === undefined) {
    pending = capture(url, inPoint)
    thumbnailCache.set(key, pending)
  }
  return pending
}
