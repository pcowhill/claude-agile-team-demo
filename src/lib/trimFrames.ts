import { coverCrop } from './thumbnails'

/**
 * The Trim window's frame row (#708, PR 2 of the design #703 for #701): a
 * row of small frames along the strip, so the clip can be seen *where* it
 * changes, not only heard in the waveform under it.
 *
 * The frames are taken at the centre of each of `TRIM_FRAME_COUNT` equal
 * slices of the whole source clip, so each frame stands for the slice of
 * strip it is drawn over. They are decoded in the background from one
 * muted element and cached per clip URL (a library clip's object URL), as
 * `thumbnailForTrim` caches the row's thumbnail: reopening the window on
 * the same clip decodes nothing. Like the thumbnails, they are session
 * state, recomputable from the media and never written to a project file.
 */

/** About twenty frames along the strip (#708): enough to see the shape of a
 * clip, few enough that a long clip's seeks finish in a second or two. */
export const TRIM_FRAME_COUNT = 20

/**
 * Each frame's capture size: 16:9 and small, since a frame is drawn in a
 * cell of the strip about 47×44 px at 1280 wide and 15×44 at 360. Twice the
 * cell's width at 1280 keeps it sharp on a 2× screen; the cell crops the
 * sides (`object-fit: cover`).
 */
export const TRIM_FRAME_WIDTH = 96
export const TRIM_FRAME_HEIGHT = 54

/** Small frames tolerate a lower quality than the library's 0.82 does. */
const TRIM_FRAME_JPEG_QUALITY = 0.7

/** A load or a seek that never settles must not hold the row forever. */
const LOAD_TIMEOUT_MS = 8000
const SEEK_TIMEOUT_MS = 4000

/**
 * The source times the frames are taken at: the centre of each of `count`
 * equal slices of `[0, duration]`. Empty when the duration is unknown.
 */
export function trimFrameTimes(duration: number, count = TRIM_FRAME_COUNT): number[] {
  if (!(duration > 0) || count < 1) return []
  return Array.from({ length: count }, (_, index) => ((index + 0.5) * duration) / count)
}

/** Resolves when `event` fires on `element`, or with false after `ms`. */
function settle(element: HTMLMediaElement, event: string, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(timer)
      element.removeEventListener(event, onEvent)
      element.removeEventListener('error', onError)
      resolve(ok)
    }
    const onEvent = () => done(true)
    const onError = () => done(false)
    const timer = setTimeout(() => done(false), ms)
    element.addEventListener(event, onEvent, { once: true })
    element.addEventListener('error', onError, { once: true })
  })
}

/**
 * Captures one small JPEG data URL per time, in order, from one muted
 * element; a frame that cannot be drawn is null, and a clip that cannot be
 * loaded gives all nulls. The seeks start only after `loadeddata`: Firefox
 * drops a seek made while an element has only its metadata (#615), and a
 * seek to where the element already stands fires no `seeked`, so that one
 * is drawn without seeking.
 */
export async function captureTrimFrames(url: string, times: number[]): Promise<(string | null)[]> {
  const frames: (string | null)[] = times.map(() => null)
  if (times.length === 0) return frames
  const video = document.createElement('video')
  video.muted = true
  video.preload = 'auto'
  try {
    const loaded = settle(video, 'loadeddata', LOAD_TIMEOUT_MS)
    video.src = url
    if (!(await loaded)) return frames
    const canvas = document.createElement('canvas')
    canvas.width = TRIM_FRAME_WIDTH
    canvas.height = TRIM_FRAME_HEIGHT
    const context = canvas.getContext('2d')
    if (context === null || video.videoWidth === 0 || video.videoHeight === 0) return frames
    const { sx, sy, sw, sh } = coverCrop(
      video.videoWidth,
      video.videoHeight,
      TRIM_FRAME_WIDTH,
      TRIM_FRAME_HEIGHT,
    )
    for (const [index, time] of times.entries()) {
      if (Math.abs(video.currentTime - time) > 0.001) {
        const seeked = settle(video, 'seeked', SEEK_TIMEOUT_MS)
        video.currentTime = time
        if (!(await seeked)) continue
      }
      try {
        context.drawImage(video, sx, sy, sw, sh, 0, 0, TRIM_FRAME_WIDTH, TRIM_FRAME_HEIGHT)
        frames[index] = canvas.toDataURL('image/jpeg', TRIM_FRAME_JPEG_QUALITY)
      } catch {
        // A tainted canvas or a codec quirk: this frame stays empty.
      }
    }
    return frames
  } catch {
    return frames
  } finally {
    // Release the decoder; the object URL itself belongs to the library.
    video.removeAttribute('src')
    video.load()
  }
}

const framesCache = new Map<string, Promise<(string | null)[]>>()

/**
 * The frame row for a clip, captured at most once per URL and duration
 * (#708): every opening of the Trim window on that clip shares it. A failed
 * capture is cached too, so a clip that cannot be decoded is not retried
 * on every opening. `capture` is injectable for tests (jsdom decodes no
 * video).
 */
export function trimFramesFor(
  url: string,
  duration: number,
  capture: (url: string, times: number[]) => Promise<(string | null)[]> = captureTrimFrames,
): Promise<(string | null)[]> {
  const key = `${url}#${duration}`
  let pending = framesCache.get(key)
  if (pending === undefined) {
    pending = capture(url, trimFrameTimes(duration))
    framesCache.set(key, pending)
  }
  return pending
}
