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
 * frame of the entry's trimmed range (`lib/thumbnails.ts`). While the
 * capture runs — and for clips that cannot be captured — it renders nothing,
 * leaving the row exactly as it was before thumbnails existed. Purely
 * decorative: the row's name stays the accessible identification, so the
 * image is hidden from assistive tech. Image entries and slates do not
 * capture (the Timeline renders the image itself, or a color swatch).
 */
export function ClipThumbnail({
  url,
  inPoint,
  'data-testid': testId,
  thumbnailFor = thumbnailForTrim,
}: ClipThumbnailProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  useEffect(() => {
    let stale = false
    // Reset so a re-trim never leaves the previous frame standing while the
    // new capture runs (a cached capture resolves in a microtask anyway).
    setDataUrl(null)
    void thumbnailFor(url, inPoint).then((captured) => {
      if (!stale) setDataUrl(captured)
    })
    return () => {
      stale = true
    }
  }, [url, inPoint, thumbnailFor])

  if (dataUrl === null) return null
  return <img className="clip-thumbnail" src={dataUrl} alt="" aria-hidden="true" data-testid={testId} />
}
