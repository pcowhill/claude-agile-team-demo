import { useCallback, useEffect, useRef, useState } from 'react'
import type { TimelineState } from '../lib/timeline'
import { totalDuration } from '../lib/timeline'
import { locateInSequence, sequenceTimeAt } from '../lib/playback'
import type { PlaybackLocation } from '../lib/playback'
import { formatDuration } from '../lib/mediaLibrary'
import './PreviewPlayer.css'

interface PreviewPlayerProps {
  timeline: TimelineState
}

/**
 * Tolerance (seconds) when comparing the <video>'s clock against an entry's
 * out-point: currentTime advances in discrete steps, so an exact match would
 * overshoot into the next clip's source material before switching.
 */
const BOUNDARY_EPSILON = 0.02

/**
 * Plays the timeline sequence — each entry from its in-point to its
 * out-point, in order — through a single <video> element whose src switches
 * between source clips at entry boundaries.
 */
export function PreviewPlayer({ timeline }: PreviewPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const frameRef = useRef(0)
  // The entry index the <video> is currently cued to. Kept in a ref (not
  // state) because the rAF loop reads and writes it between renders.
  const indexRef = useRef(0)
  const [playing, setPlaying] = useState(false)
  const [sequenceTime, setSequenceTime] = useState(0)

  const total = totalDuration(timeline)
  const empty = timeline.entries.length === 0

  /**
   * Cues the <video> to a location, switching src when the location's entry
   * uses a different source clip. currentTime is only settable once metadata
   * is loaded, so after a src switch the seek (and optional play) waits for
   * loadedmetadata.
   */
  const cueVideo = useCallback((location: PlaybackLocation, thenPlay: boolean) => {
    const video = videoRef.current
    if (!video) return
    indexRef.current = location.index
    const start = () => {
      video.currentTime = location.sourceTime
      // play() rejects (AbortError) when interrupted by pause or a src
      // switch — an expected outcome here, not an error to surface.
      if (thenPlay) video.play().catch(() => {})
    }
    if (video.currentSrc !== location.entry.url) {
      video.src = location.entry.url
      video.addEventListener('loadedmetadata', start, { once: true })
    } else {
      start()
    }
  }, [])

  const stopLoop = useCallback(() => {
    cancelAnimationFrame(frameRef.current)
  }, [])

  /**
   * Per-frame while playing: publish the current sequence position and, when
   * the clip reaches its out-point (or actually ends), either advance to the
   * next entry or finish the sequence.
   */
  const tick = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    const index = indexRef.current
    const entry = timeline.entries[index]
    if (!entry) return

    const reachedOut = video.currentTime >= entry.outPoint - BOUNDARY_EPSILON || video.ended
    if (reachedOut) {
      const next = timeline.entries[index + 1]
      if (next) {
        setSequenceTime(sequenceTimeAt(timeline, index + 1, next.inPoint))
        cueVideo({ index: index + 1, entry: next, sourceTime: next.inPoint }, true)
      } else {
        video.pause()
        setPlaying(false)
        setSequenceTime(totalDuration(timeline))
        return
      }
    } else {
      setSequenceTime(sequenceTimeAt(timeline, index, video.currentTime))
    }
    frameRef.current = requestAnimationFrame(tick)
  }, [timeline, cueVideo])

  const play = useCallback(() => {
    // Play from the end restarts the sequence.
    const from = sequenceTime >= total ? 0 : sequenceTime
    const location = locateInSequence(timeline, from)
    if (!location) return
    setPlaying(true)
    setSequenceTime(from)
    cueVideo(location, true)
    stopLoop()
    frameRef.current = requestAnimationFrame(tick)
  }, [sequenceTime, total, timeline, cueVideo, stopLoop, tick])

  const pause = useCallback(() => {
    stopLoop()
    videoRef.current?.pause()
    setPlaying(false)
  }, [stopLoop])

  const seek = useCallback(
    (time: number) => {
      const location = locateInSequence(timeline, time)
      if (!location) return
      setSequenceTime(time)
      cueVideo(location, playing)
    },
    [timeline, cueVideo, playing],
  )

  // Edits to the sequence invalidate the playback position (entries may be
  // gone, reordered, or retrimmed): stop and re-clamp rather than guessing.
  useEffect(() => {
    stopLoop()
    const video = videoRef.current
    if (video && !video.paused) video.pause()
    setPlaying(false)
    setSequenceTime((time) => Math.min(time, totalDuration(timeline)))
  }, [timeline, stopLoop])

  useEffect(() => stopLoop, [stopLoop])

  const location = locateInSequence(timeline, sequenceTime)

  return (
    <section className="panel preview-panel" aria-label="Preview">
      <h2>Preview</h2>
      {empty ? (
        <p className="placeholder">Add clips to the timeline to preview your edit.</p>
      ) : (
        <div className="preview-player">
          {/* Sized by CSS; sequence audio plays. Controls are the app's own. */}
          <video
            ref={videoRef}
            className="preview-video"
            data-testid="preview-video"
            playsInline
            preload="auto"
          />
          <div className="preview-controls">
            <button
              type="button"
              aria-label={playing ? 'Pause preview' : 'Play preview'}
              onClick={playing ? pause : play}
            >
              {playing ? '⏸' : '▶'}
            </button>
            <input
              type="range"
              aria-label="Seek within sequence"
              min={0}
              max={total}
              step={0.01}
              value={Math.min(sequenceTime, total)}
              onChange={(event) => seek(Number(event.target.value))}
            />
            <span className="preview-position" data-testid="preview-position">
              {formatDuration(Math.min(sequenceTime, total))} / {formatDuration(total)}
            </span>
          </div>
          {location && (
            <p className="preview-now-playing" data-testid="preview-now-playing">
              Clip {location.index + 1} of {timeline.entries.length}: {location.entry.name}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
