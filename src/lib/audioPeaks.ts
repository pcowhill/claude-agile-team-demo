/**
 * Waveform peaks for audio clips (#191): each clip is decoded once, reduced
 * to a small fixed-size array of peak amplitudes, and cached — the timeline
 * renders every audio track's waveform from that shared array, windowed to
 * the track's trim. The full decoded buffer is never retained: peaks are
 * computed inside the decode step and only the `PEAK_COUNT`-float array
 * (a few KB) survives per clip, whatever the source duration.
 */

/**
 * Peaks per clip. Fixed regardless of source duration, so memory per clip is
 * bounded (400 × 4 bytes) and rendering cost never grows with file length.
 * 400 buckets out-resolve the on-screen bar (timeline lanes render at a few
 * hundred CSS pixels) while keeping SVG paths small.
 */
export const PEAK_COUNT = 400

/**
 * Downsamples decoded channel data to `peakCount` buckets: each bucket is
 * the maximum absolute sample across all channels in its time slice, in
 * [0, 1] for well-formed audio. Buckets always cover at least one sample, so
 * sources shorter than `peakCount` samples still yield full-size output
 * (neighboring buckets repeat samples rather than reading out of range).
 */
export function computePeaks(
  channels: readonly Float32Array[],
  peakCount: number = PEAK_COUNT,
): Float32Array {
  const peaks = new Float32Array(peakCount)
  const length = channels.length === 0 ? 0 : channels[0].length
  if (length === 0) return peaks
  for (let bucket = 0; bucket < peakCount; bucket++) {
    const start = Math.min(Math.floor((bucket * length) / peakCount), length - 1)
    const end = Math.max(Math.floor(((bucket + 1) * length) / peakCount), start + 1)
    let peak = 0
    for (const channel of channels) {
      for (let index = start; index < end && index < channel.length; index++) {
        const amplitude = Math.abs(channel[index])
        if (amplitude > peak) peak = amplitude
      }
    }
    peaks[bucket] = peak
  }
  return peaks
}

/**
 * The slice of a clip's peaks that a track's trim keeps visible (#191):
 * peaks span [0, duration] of the source, the window is [inPoint, outPoint].
 * Trimming therefore shifts and rescales the rendered section exactly as it
 * shifts the audible one. Degenerate inputs (non-positive duration, an empty
 * or inverted window) return an empty slice — the caller renders no
 * waveform, never a wrong one.
 */
export function peakWindow(
  peaks: Float32Array,
  inPoint: number,
  outPoint: number,
  duration: number,
): Float32Array {
  if (duration <= 0 || peaks.length === 0) return new Float32Array(0)
  const clamp = (value: number) =>
    Math.min(Math.max(Math.round((value / duration) * peaks.length), 0), peaks.length)
  const start = clamp(inPoint)
  const end = clamp(outPoint)
  if (end <= start) return new Float32Array(0)
  return peaks.subarray(start, end)
}

/**
 * SVG path for a mirrored waveform band: bucket i spans x ∈ [i, i+1] with
 * amplitude drawn symmetrically about the vertical midline. Rendered with
 * `viewBox="0 0 <peaks.length> <height>"` and `preserveAspectRatio="none"`,
 * the band stretches to whatever box the bar gives it. Fully silent buckets
 * collapse onto the midline — silence looks silent.
 */
export function waveformPath(peaks: ArrayLike<number>, height: number): string {
  const mid = height / 2
  const y = (value: number) => Math.round(value * 1000) / 1000
  const amplitudeAt = (index: number) => Math.min(Math.max(peaks[index], 0), 1)
  const top: string[] = []
  for (let index = 0; index < peaks.length; index++) {
    const edge = y(mid - amplitudeAt(index) * mid)
    top.push(`L${index} ${edge}`, `L${index + 1} ${edge}`)
  }
  // Return along the bottom edge right-to-left, mirroring the top.
  const bottom: string[] = []
  for (let index = peaks.length - 1; index >= 0; index--) {
    const edge = y(mid + amplitudeAt(index) * mid)
    bottom.push(`L${index + 1} ${edge}`, `L${index} ${edge}`)
  }
  return `M0 ${y(mid)}${top.join('')}${bottom.join('')}Z`
}

/** Decodes a clip and reduces it to peaks; null when the browser can't. */
async function decodeClipPeaks(url: string): Promise<Float32Array | null> {
  try {
    // OfflineAudioContext decodes without an audible context or autoplay
    // gating; its constructor arguments are irrelevant to decodeAudioData.
    if (typeof OfflineAudioContext === 'undefined') return null
    const response = await fetch(url)
    const encoded = await response.arrayBuffer()
    const context = new OfflineAudioContext(1, 1, 44100)
    const buffer = await context.decodeAudioData(encoded)
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) =>
      buffer.getChannelData(channel),
    )
    // Only the peaks leave this scope; buffer and channels are garbage.
    return computePeaks(channels)
  } catch {
    // Undecodable or unreachable media: the bar renders as before (#191's
    // graceful-degradation criterion). Cached like a success, so a broken
    // clip is not re-fetched on every render.
    return null
  }
}

const peaksCache = new Map<string, Promise<Float32Array | null>>()

/**
 * The peaks for a clip's object URL, decoded at most once per clip and
 * shared by every track referencing it (#191). The object URL is unique and
 * stable per library clip, so it is the cache key. `decode` is injectable
 * for tests (jsdom has no Web Audio or blob fetch).
 */
export function peaksForClip(
  url: string,
  decode: (url: string) => Promise<Float32Array | null> = decodeClipPeaks,
): Promise<Float32Array | null> {
  let pending = peaksCache.get(url)
  if (pending === undefined) {
    pending = decode(url)
    peaksCache.set(url, pending)
  }
  return pending
}
