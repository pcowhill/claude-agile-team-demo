/**
 * An overlay source's pixel size, for the overlay placement editor's
 * silhouette (#795): where the picture sits inside its rectangle depends on
 * it, and a `VideoOverlay` does not carry it.
 */

/** A source's intrinsic pixel size. */
export interface SourceSize {
  width: number
  height: number
}

/**
 * Reads a video's size from its metadata, or an image's from the decoded
 * image — the same probe the preview runs for its outlines (#791). Calls
 * `found` once, with nothing when the source reports no size; returns the
 * cleanup that abandons the probe.
 */
export function probeSourceSize(url: string, image: boolean, found: (size: SourceSize) => void): () => void {
  const record = (width: number, height: number) => {
    if (width > 0 && height > 0) found({ width, height })
  }
  if (image) {
    const probe = new Image()
    probe.onload = () => record(probe.naturalWidth, probe.naturalHeight)
    probe.src = url
    return () => {
      probe.onload = null
      probe.removeAttribute('src')
    }
  }
  const probe = document.createElement('video')
  probe.preload = 'metadata'
  probe.muted = true
  const loaded = () => record(probe.videoWidth, probe.videoHeight)
  probe.addEventListener('loadedmetadata', loaded, { once: true })
  probe.src = url
  return () => {
    probe.removeEventListener('loadedmetadata', loaded)
    probe.removeAttribute('src')
    probe.load()
  }
}
