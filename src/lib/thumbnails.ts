/**
 * Clip thumbnails (#193): one still per video clip, captured from the first
 * frame of the entry's trimmed range so clips are recognizable at a glance.
 * Captures are cached by (url, inPoint) — every surface showing the same
 * trim of the same clip shares one capture, and re-trimming the in-point is
 * a new key, which is what triggers the re-capture #193 asks for.
 *
 * Thumbnails are session state only: they are recomputable from the media,
 * so they are never written to project files (which stay small) and simply
 * re-capture after a project opens.
 *
 * One capture serves both surfaces, sized for the larger of them (#359).
 * #193 captured 64×36 because a timeline row is 64×36, and the media
 * library's card view (#311) then reused the same cache for a picture box
 * that measures 152–188 px square — upscaling a 64×36 frame about three
 * times across and five times down after the square crop, which the
 * customer reported as poor quality (#353). Capturing once at card size and
 * letting the row downscale keeps one decode per clip and one cache key;
 * per-surface sizes would buy the row's small payload back for a second
 * decode and a key a caller can get wrong.
 */

/**
 * Fixed capture size: 16:9, tall enough for a library card at 2× its
 * measured box.
 *
 * **Why 16:9 and not square**, when the card's box is square: the row
 * displays the capture in a 64×36 box with `object-fit: cover`, so a square
 * capture would have cropped the source's sides *before* the row cropped it
 * again — the row would show less of the frame than it does today. Keeping
 * the capture's aspect exactly the row's means the row's framing is
 * unchanged and only its pixel count goes up; the card crops the sides
 * itself, from a frame with pixels to spare.
 *
 * **Why 405 high**: the card picture measures 152.0–187.5 px square across
 * 800–1920 px viewports (measured, and independent of the clip count — the
 * grid's `auto-fill` tracks do not stretch with fewer cards), so 405 clears
 * 2× at the widest of those. The browser spec asserts that ratio at the
 * viewport it pins rather than trusting this comment.
 *
 * **The cost**, since it is no longer negligible: a capture is now tens of
 * KB rather than the ~1–2 KB #193 noted, so a 30-clip library holds a few
 * hundred KB of data URLs instead of ~50 KB. That is the trade the quality
 * bug bought. A library-column width where a card grows past ~200 px (the
 * grid's minimum track is 9rem, so one track can approach ~290 px) gets
 * less than 2×; a heavier capture for every clip is the wrong price for
 * that case.
 */
export const THUMBNAIL_WIDTH = 720
export const THUMBNAIL_HEIGHT = 405

/**
 * JPEG quality. #193 used 0.7, which is invisible at 64×36 and shows as
 * mush at 405 — the artefacts scale with the display size, not the file's.
 */
export const THUMBNAIL_JPEG_QUALITY = 0.82

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
 * a value: the surface then renders its placeholder, exactly as before
 * thumbnails.
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
              resolve(canvas.toDataURL('image/jpeg', THUMBNAIL_JPEG_QUALITY))
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
