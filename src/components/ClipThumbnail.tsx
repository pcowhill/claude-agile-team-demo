import { useEffect, useState } from 'react'
import { thumbnailForTrim } from '../lib/thumbnails'

interface ClipThumbnailProps {
  /** Object URL of the source clip — half of the capture cache key. */
  url: string
  /** The trim's in point in seconds; changing it re-captures (#193). */
  inPoint: number
  'data-testid'?: string
  /** Injectable for tests (jsdom decodes no video). */
  thumbnailFor?: typeof thumbnailForTrim
}

/**
 * A video entry's timeline thumbnail (#193): the cached capture of the first
 * frame of the entry's trimmed range (`lib/thumbnails.ts`). Purely
 * decorative: the row's name stays the accessible identification, so the
 * image is hidden from assistive tech. Image entries and slates do not
 * capture (the Timeline renders the image itself, or a color swatch).
 *
 * While the capture runs, an empty box of the thumbnail's size holds its
 * place (#967). Rendering nothing there made the row 12px shorter for the
 * length of every re-capture, and taller again when the frame landed, so
 * everything below it, and everything the panel layout shares a column with,
 * moved under the pointer. A click begun before that move ended on another
 * element and pressed nothing: Undo straight after a Trim window Apply was
 * the measured case. A clip that cannot be captured still renders nothing,
 * once its capture has failed.
 */
export function ClipThumbnail({
  url,
  inPoint,
  'data-testid': testId,
  thumbnailFor = thumbnailForTrim,
}: ClipThumbnailProps) {
  // undefined while the capture runs; null once it has failed.
  const [dataUrl, setDataUrl] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    let stale = false
    // Reset so a re-trim never leaves the previous frame standing while the
    // new capture runs (a cached capture resolves in a microtask anyway).
    setDataUrl(undefined)
    void thumbnailFor(url, inPoint).then((captured) => {
      if (!stale) setDataUrl(captured)
    })
    return () => {
      stale = true
    }
  }, [url, inPoint, thumbnailFor])

  if (dataUrl === undefined) {
    return (
      <span
        className="clip-thumbnail clip-thumbnail-pending"
        aria-hidden="true"
        data-testid={testId === undefined ? undefined : `${testId}-pending`}
      />
    )
  }
  if (dataUrl === null) return null
  return <img className="clip-thumbnail" src={dataUrl} alt="" aria-hidden="true" data-testid={testId} />
}
