import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { TimelineState, TransitionType } from '../lib/timeline'
import { boundaryTransitions, totalDuration } from '../lib/timeline'
import { isTransitionOverlayActive, locateInSequence, sequenceTimeAt } from '../lib/playback'
import type { PlaybackLocation, TransitionOverlap } from '../lib/playback'
import { transitionLayerSpec } from '../lib/transitionRender'
import { IDENTITY_ZOOM, zoomAt } from '../lib/zoom'
import type { ZoomState } from '../lib/zoom'
import { formatDuration } from '../lib/mediaLibrary'
import './PreviewPlayer.css'

interface PreviewPlayerProps {
  timeline: TimelineState
}

/**
 * Tolerance (seconds) when comparing a <video>'s clock against an entry's
 * out-point: currentTime advances in discrete steps, so an exact match would
 * overshoot into the next clip's source material before switching.
 */
const BOUNDARY_EPSILON = 0.02

const TRANSITION_LABEL: Record<TransitionType, string> = {
  crossfade: 'crossfade',
  'slide-from-above': 'slide from above',
  'slide-from-below': 'slide from below',
  'slide-from-left': 'slide from left',
  'slide-from-right': 'slide from right',
}

/**
 * Styles for the two stacked video elements mid-transition, mapped from the
 * shared layer spec (transitionRender.ts) that also drives the exporter, so
 * preview and export render the same effect (#66). For a crossfade the
 * outgoing element fades to black at `1 − progress` while the incoming one
 * is ADDED at `progress` (`plus-lighter`): covered regions blend exactly as
 * a plain opacity crossfade did, and any margin only one clip reaches fades
 * to/from the stage's black instead of popping at the handover. Slides move
 * the incoming element as a full-frame card — the element's own opaque black
 * background fills whatever its fitted clip does not (#74) — over an
 * undimmed outgoing clip, so margins are covered by sliding black instead of
 * popping at the handover.
 */
function transitionLayerStyles(overlap: TransitionOverlap): {
  outgoing: CSSProperties
  incoming: CSSProperties
} {
  const spec = transitionLayerSpec(overlap.type, overlap.progress)
  return {
    outgoing: { opacity: spec.outgoingAlpha },
    incoming: {
      opacity: spec.incomingAlpha,
      transform: `translate(${spec.incomingOffsetXFraction * 100}%, ${spec.incomingOffsetYFraction * 100}%)`,
      mixBlendMode: spec.additive ? 'plus-lighter' : undefined,
      backgroundColor: spec.incomingBacking ? '#000' : undefined,
    },
  }
}

/**
 * Composes an element's transition styles with its entry's zoom state (#64).
 * The element box is the frame (it fills the stage), so the transform maps a
 * frame fraction p to 0.5 + scale·(p − centre): the visible region
 * centre ± 1/(2·scale) lands exactly on the frame edges. Uniform scale on
 * both axes preserves the aspect ratio by construction, and the reducer's
 * centre clamp keeps the region inside the frame, so nothing beyond a frame
 * edge is ever pulled into view. The clip-path pre-cuts the element to that
 * same region — the piece the transform maps onto the (possibly
 * slide-translated) frame card — so a zoomed element, backing included
 * (#74), never paints outside where its unzoomed card would be, and a
 * zoomed slide still covers exactly its slice of the stage. The identity
 * zoom returns the transition styles untouched, transform format included.
 */
function withZoom(style: CSSProperties | undefined, zoom: ZoomState): CSSProperties | undefined {
  if (zoom.scale === 1) return style
  const { scale, centerX, centerY } = zoom
  const half = 1 / (2 * scale)
  const pct = (value: number) => `${value * 100}%`
  return {
    ...style,
    transform: [
      ...(style?.transform ? [style.transform] : []),
      `scale(${scale})`,
      `translate(${pct(0.5 - centerX)}, ${pct(0.5 - centerY)})`,
    ].join(' '),
    clipPath: `inset(${pct(centerY - half)} ${pct(1 - centerX - half)} ${pct(1 - centerY - half)} ${pct(centerX - half)})`,
  }
}

/**
 * Plays the timeline sequence — each entry from its in-point to its
 * out-point, in order — through two stacked <video> elements. Outside a
 * transition only the primary element is visible and plays the current
 * entry, src-switching at hard cuts exactly as before. Inside a transition
 * overlap (#42) the secondary element plays the incoming entry on top of the
 * still-playing outgoing one, styled by the transition's progress; when the
 * outgoing entry ends the elements swap roles, so the incoming clip never
 * has to be re-cued at the handover.
 */
export function PreviewPlayer({ timeline }: PreviewPlayerProps) {
  const videoARef = useRef<HTMLVideoElement>(null)
  const videoBRef = useRef<HTMLVideoElement>(null)
  const frameRef = useRef(0)
  // The entry index the primary element is currently cued to. Kept in a ref
  // (not state) because the rAF loop reads and writes it between renders.
  const indexRef = useRef(0)
  // Which element is primary: a ref for the rAF loop, mirrored into state so
  // the render can assign roles (testids, stacking, transition styles).
  const primaryIsARef = useRef(true)
  const [primaryIsA, setPrimaryIsA] = useState(true)
  // Outgoing-entry index the secondary element is engaged for, or null while
  // it is idle. Prevents re-cueing the incoming clip on every overlap frame.
  // The ref is for the rAF loop; the state mirror is what the render keys
  // the overlay on, so a role swap hides the outgoing element immediately
  // even while the published sequence time still trails inside the overlap
  // (#61 — element clocks drift, so that happens routinely at handover).
  const engagedForRef = useRef<number | null>(null)
  const [engagedFor, setEngagedFor] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [sequenceTime, setSequenceTime] = useState(0)

  const total = totalDuration(timeline)
  const empty = timeline.entries.length === 0

  const primaryVideo = () => (primaryIsARef.current ? videoARef.current : videoBRef.current)
  const secondaryVideo = () => (primaryIsARef.current ? videoBRef.current : videoARef.current)

  /** Single writer for the engagement, keeping the ref and its state mirror in step. */
  const setEngaged = useCallback((value: number | null) => {
    engagedForRef.current = value
    setEngagedFor(value)
  }, [])

  /**
   * Cues one element to a source time, switching src when it plays a
   * different source clip. currentTime is only settable once metadata is
   * loaded, so after a src switch the seek (and optional play) waits for
   * loadedmetadata.
   */
  const cueElement = useCallback(
    (video: HTMLVideoElement, url: string, sourceTime: number, thenPlay: boolean) => {
      const start = () => {
        video.currentTime = sourceTime
        // play() rejects (AbortError) when interrupted by pause or a src
        // switch — an expected outcome here, not an error to surface.
        if (thenPlay) video.play().catch(() => {})
      }
      if (video.currentSrc !== url) {
        video.src = url
        video.addEventListener('loadedmetadata', start, { once: true })
      } else {
        start()
      }
    },
    [],
  )

  const cuePrimary = useCallback(
    (location: PlaybackLocation, thenPlay: boolean) => {
      const video = primaryVideo()
      if (!video) return
      indexRef.current = location.index
      cueElement(video, location.entry.url, location.sourceTime, thenPlay)
    },
    [cueElement],
  )

  /**
   * Aligns the secondary element with a location: inside an overlap it is
   * cued to the incoming entry and the two elements' audio is split by the
   * transition's progress (a plain volume crossfade, for both transition
   * types); outside one it is silenced and paused.
   */
  const syncSecondary = useCallback(
    (location: PlaybackLocation, thenPlay: boolean) => {
      const primary = primaryVideo()
      const secondary = secondaryVideo()
      if (!primary || !secondary) return
      const overlap = location.transition
      if (overlap) {
        primary.volume = 1 - overlap.progress
        secondary.volume = overlap.progress
        setEngaged(location.index)
        cueElement(secondary, overlap.entry.url, overlap.sourceTime, thenPlay)
      } else {
        primary.volume = 1
        if (engagedForRef.current !== null) {
          setEngaged(null)
          secondary.pause()
        }
      }
    },
    [cueElement, setEngaged],
  )

  const stopLoop = useCallback(() => {
    cancelAnimationFrame(frameRef.current)
  }, [])

  /**
   * Per-frame while playing: publish the current sequence position, run the
   * transition overlap (engage the secondary element, split the audio), and
   * when the outgoing clip reaches its out-point (or actually ends) either
   * hand over to the next entry or finish the sequence.
   */
  const tick = useCallback(() => {
    const video = primaryVideo()
    if (!video) return
    const index = indexRef.current
    const entry = timeline.entries[index]
    if (!entry) return
    const next = timeline.entries[index + 1]
    const overlap = boundaryTransitions(timeline)[index]

    const reachedOut = video.currentTime >= entry.outPoint - BOUNDARY_EPSILON || video.ended
    if (reachedOut) {
      if (next && overlap) {
        // Handover mid-transition: the incoming entry is already playing in
        // the secondary element — promote it to primary instead of re-cueing.
        const incoming = secondaryVideo()
        if (!incoming) return
        const wasEngaged = engagedForRef.current === index
        video.pause()
        video.volume = 1
        incoming.volume = 1
        setEngaged(null)
        indexRef.current = index + 1
        primaryIsARef.current = !primaryIsARef.current
        setPrimaryIsA(primaryIsARef.current)
        if (wasEngaged) {
          setSequenceTime(sequenceTimeAt(timeline, index + 1, incoming.currentTime))
        } else {
          // The overlap was shorter than a frame (or engagement raced the
          // out-point) — cue the incoming element where the handover lands.
          setSequenceTime(sequenceTimeAt(timeline, index + 1, next.inPoint + overlap.duration))
          cueElement(incoming, next.url, next.inPoint + overlap.duration, true)
        }
      } else if (next) {
        setSequenceTime(sequenceTimeAt(timeline, index + 1, next.inPoint))
        cuePrimary({ index: index + 1, entry: next, sourceTime: next.inPoint }, true)
      } else {
        video.pause()
        secondaryVideo()?.pause()
        setPlaying(false)
        setSequenceTime(totalDuration(timeline))
        return
      }
    } else {
      setSequenceTime(sequenceTimeAt(timeline, index, video.currentTime))
      if (next && overlap) {
        const overlapStart = entry.outPoint - overlap.duration
        if (video.currentTime >= overlapStart) {
          const secondary = secondaryVideo()
          if (secondary) {
            if (engagedForRef.current !== index) {
              setEngaged(index)
              cueElement(
                secondary,
                next.url,
                next.inPoint + (video.currentTime - overlapStart),
                true,
              )
            }
            const progress = Math.min((video.currentTime - overlapStart) / overlap.duration, 1)
            video.volume = 1 - progress
            secondary.volume = progress
          }
        }
      }
    }
    frameRef.current = requestAnimationFrame(tick)
  }, [timeline, cueElement, cuePrimary, setEngaged])

  const play = useCallback(() => {
    // Play from the end restarts the sequence.
    const from = sequenceTime >= total ? 0 : sequenceTime
    const location = locateInSequence(timeline, from)
    if (!location) return
    setPlaying(true)
    setSequenceTime(from)
    cuePrimary(location, true)
    syncSecondary(location, true)
    stopLoop()
    frameRef.current = requestAnimationFrame(tick)
  }, [sequenceTime, total, timeline, cuePrimary, syncSecondary, stopLoop, tick])

  const pause = useCallback(() => {
    stopLoop()
    primaryVideo()?.pause()
    secondaryVideo()?.pause()
    setPlaying(false)
  }, [stopLoop])

  const seek = useCallback(
    (time: number) => {
      const location = locateInSequence(timeline, time)
      if (!location) return
      setSequenceTime(time)
      cuePrimary(location, playing)
      syncSecondary(location, playing)
    },
    [timeline, cuePrimary, syncSecondary, playing],
  )

  // Edits to the sequence invalidate the playback position (entries may be
  // gone, reordered, or retrimmed): stop and re-clamp rather than guessing.
  useEffect(() => {
    stopLoop()
    for (const video of [videoARef.current, videoBRef.current]) {
      if (video && !video.paused) video.pause()
    }
    setEngaged(null)
    setPlaying(false)
    setSequenceTime((time) => Math.min(time, totalDuration(timeline)))
  }, [timeline, stopLoop, setEngaged])

  useEffect(() => stopLoop, [stopLoop])

  const location = locateInSequence(timeline, sequenceTime)
  // Gate the overlay on the actual engagement, not the recomputed location
  // alone: right after a handover the published time can still trail inside
  // the overlap, and then the top-layer element holds the outgoing clip (#61).
  const overlap = isTransitionOverlayActive(location, engagedFor)
    ? location?.transition
    : undefined

  const layerStyles = overlap ? transitionLayerStyles(overlap) : undefined

  // Each element's zoom (#64) at its entry's current source time: the
  // primary element renders `location`'s entry, the incoming element (only
  // while the overlay is active) the transition's incoming entry — so a zoom
  // follows its clip through a transition on either side. Both derive from
  // the published sequence time, exactly like the transition styles, so a
  // rAF tick and a paused seek update them the same way. All easing lives in
  // zoomAt (#63); this component only maps its output to CSS.
  const primaryZoom = location
    ? zoomAt(timeline, location.index, location.sourceTime)
    : IDENTITY_ZOOM
  const incomingZoom = overlap ? zoomAt(timeline, overlap.index, overlap.sourceTime) : IDENTITY_ZOOM

  /** Role-dependent props for one of the two stacked elements. */
  const videoProps = (isA: boolean) => {
    const isPrimary = isA === primaryIsA
    if (isPrimary) {
      return {
        className: 'preview-video',
        'data-testid': 'preview-video',
        style: withZoom(layerStyles?.outgoing, primaryZoom),
      }
    }
    return {
      className: `preview-video preview-video-incoming${overlap ? '' : ' preview-video-idle'}`,
      style: overlap ? withZoom(layerStyles?.incoming, incomingZoom) : undefined,
      'data-testid': overlap ? 'preview-video-incoming' : undefined,
    }
  }

  return (
    <section className="panel preview-panel" aria-label="Preview">
      <h2>Preview</h2>
      {empty ? (
        <p className="placeholder">Add clips to the timeline to preview your edit.</p>
      ) : (
        <div className="preview-player">
          {/* Sized by CSS; sequence audio plays. Controls are the app's own. */}
          <div className="preview-stage">
            <video ref={videoARef} playsInline preload="auto" {...videoProps(true)} />
            <video ref={videoBRef} playsInline preload="auto" {...videoProps(false)} />
          </div>
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
              {overlap ? ` → ${overlap.entry.name} (${TRANSITION_LABEL[overlap.type]})` : ''}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
