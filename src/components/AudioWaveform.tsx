import { useEffect, useState } from 'react'
import { peakWindow, peaksForClip, waveformPath } from '../lib/audioPeaks'

/** Height of the waveform's SVG coordinate space; stretched to the bar. */
const WAVEFORM_VIEW_HEIGHT = 2

interface AudioWaveformProps {
  /** Object URL of the source clip — also the peaks cache key. */
  url: string
  /** Source duration in seconds; the peaks span exactly this. */
  duration: number
  /** Trim window within the source, in seconds. */
  inPoint: number
  outPoint: number
  'data-testid'?: string
  /** Injectable for tests (jsdom has no Web Audio or blob fetch). */
  peaksFor?: typeof peaksForClip
}

/**
 * The waveform inside an audio track's coverage bar (#191): the clip's
 * cached peaks (decoded once per clip, `lib/audioPeaks.ts`), windowed to the
 * track's trim, drawn as an SVG band that stretches to the bar. While peaks
 * are still computing — and for clips that fail to decode — it renders
 * nothing, leaving the bar exactly as it was before waveforms existed.
 * Purely decorative: the bar's strip is already `aria-hidden`, and the
 * numeric trim fields stay the accessible representation.
 */
export function AudioWaveform({
  url,
  duration,
  inPoint,
  outPoint,
  'data-testid': testId,
  peaksFor = peaksForClip,
}: AudioWaveformProps) {
  const [peaks, setPeaks] = useState<Float32Array | null>(null)
  useEffect(() => {
    let stale = false
    void peaksFor(url).then((decoded) => {
      if (!stale) setPeaks(decoded)
    })
    return () => {
      stale = true
    }
  }, [url, peaksFor])

  if (peaks === null) return null
  const visible = peakWindow(peaks, inPoint, outPoint, duration)
  if (visible.length === 0) return null
  return (
    <svg
      className="audio-waveform"
      data-testid={testId}
      viewBox={`0 0 ${visible.length} ${WAVEFORM_VIEW_HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={waveformPath(visible, WAVEFORM_VIEW_HEIGHT)} />
    </svg>
  )
}
