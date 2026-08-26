import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { TimelineState, TransitionType } from '../lib/timeline'
import {
  audioTracksOf,
  boundaryTransitions,
  effectiveDuration,
  entryOutputDuration,
  isSlateEntry,
  isStillEntry,
  remapsForEntry,
  remapsOf,
  textsOf,
  totalDuration,
  videoOverlaysOf,
} from '../lib/timeline'
import { textActiveAt, textFontStack } from '../lib/textOverlay'
import { outputTimeAtSource, rateAtSourceTime, remapPlaybackAt } from '../lib/remap'
import {
  audioTrackPlaybackAt,
  entryStartTime,
  isTransitionOverlayActive,
  locateInSequence,
  sequenceTimeAt,
} from '../lib/playback'
import type { PlaybackLocation, TransitionOverlap } from '../lib/playback'
import { audioTrackGainAt, videoEntryGain } from '../lib/gain'
import { transitionLayerSpec } from '../lib/transitionRender'
import { IDENTITY_ZOOM, zoomAt } from '../lib/zoom'
import type { ZoomState } from '../lib/zoom'
import { formatDuration } from '../lib/mediaLibrary'
import './PreviewPlayer.css'

interface PreviewPlayerProps {
  timeline: TimelineState
  /** Whether the panel spans the full content width (#128). Owned by App —
   * the expansion rearranges the app grid, not just this panel. */
  expanded?: boolean
  onToggleExpanded?: () => void
}

/**
 * Tolerance (seconds) when comparing a <video>'s clock against an entry's
 * out-point: currentTime advances in discrete steps, so an exact match would
 * overshoot into the next clip's source material before switching.
 */
const BOUNDARY_EPSILON = 0.02

/**
 * Tolerance (seconds) between an audio track element's clock and the
 * position the sequence publishes (#103). Element clocks drift a few tens of
 * milliseconds apart; re-seeking on every frame would stutter the audio, so
 * a track is only snapped back when it strays audibly far.
 */
const AUDIO_DRIFT_EPSILON = 0.25

/**
 * Tolerance (seconds) between the incoming (secondary) element's clock and
 * the source position the remapped mapping expects for the published
 * sequence time (#141). Same reasoning as AUDIO_DRIFT_EPSILON: with the
 * playback rate driven every frame the drift stays tiny, so only visible
 * strays re-seek.
 */
const VIDEO_DRIFT_EPSILON = 0.25

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
 *
 * Still entries (#140) render as an <img> in the same stacked slots, styled
 * by the same transition/zoom mapping; having no element clock, a fronting
 * still is timed by a wall clock the rAF loop advances while playing.
 */
export function PreviewPlayer({
  timeline,
  expanded = false,
  onToggleExpanded,
}: PreviewPlayerProps) {
  const videoARef = useRef<HTMLVideoElement>(null)
  const videoBRef = useRef<HTMLVideoElement>(null)
  const frameRef = useRef(0)
  // The entry index the primary element is currently cued to. Kept in a ref
  // (not state) because the rAF loop reads and writes it between renders.
  const indexRef = useRef(0)
  // A still entry has no element clock (#140): while one fronts the
  // sequence, this wall clock stands in for `video.currentTime`, advanced
  // by the rAF loop only while playing (so pausing freezes it for free).
  const stillClockRef = useRef<{ sourceTime: number; lastNow: number } | null>(null)
  // An active pause plateau on the fronting entry (#141): the element is
  // paused on the frozen instant (`at`, relative to the entry's in-point)
  // while this wall clock — the still clock's pattern — advances the
  // sequence's output position from `outputNow` to `outputEnd` (output
  // seconds into the entry). Advanced only while playing, so pausing the
  // preview freezes the hold too.
  const holdRef = useRef<{ at: number; outputEnd: number; outputNow: number; lastNow: number } | null>(
    null,
  )
  // The fronting video entry's last observed source position relative to its
  // in-point, for detecting that the element's clock crossed a pause instant
  // between frames (#141). Reset on every cue.
  const lastRelSourceRef = useRef(0)
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
  // The playing video's intrinsic aspect ratio, driving the expanded stage's
  // height (#128): the customer asked the height to follow along when the
  // preview goes full width. Null until any metadata loads (CSS falls back
  // to 16:9).
  const [videoAspect, setVideoAspect] = useState<number | null>(null)

  const total = totalDuration(timeline)
  const empty = timeline.entries.length === 0
  const audioTracks = audioTracksOf(timeline)
  // One <audio> element per track, keyed by track id (#103). A ref map, not
  // state: the rAF loop reads it every frame.
  const audioRefs = useRef(new Map<string, HTMLAudioElement | null>())
  const videoOverlays = videoOverlaysOf(timeline)
  // One <video> element per overlay layer (#145), keyed by overlay id —
  // rendered inside the stage at its rectangle, synced like an audio track.
  const overlayRefs = useRef(new Map<string, HTMLVideoElement | null>())

  const primaryVideo = () => (primaryIsARef.current ? videoARef.current : videoBRef.current)
  const secondaryVideo = () => (primaryIsARef.current ? videoBRef.current : videoARef.current)

  /**
   * Aligns every audio track element with a sequence position (#103): a
   * track whose window covers the position plays from the matching source
   * time while `running`, and is paused otherwise. Its volume is set to the
   * track's effective gain at that position on every call — the rAF loop
   * calls this each frame, which is what renders fades as continuous ramps
   * (#104). Elements are re-cued exactly when they start; while running they
   * keep their own clock unless it drifts audibly. Each element keeps a
   * single source for the track's lifetime (src set in the render), so
   * cueing is only ever a seek — never the video elements' src-switch dance.
   */
  const syncAudioTracks = useCallback(
    (sequenceTime: number, running: boolean) => {
      for (const track of audioTracks) {
        const element = audioRefs.current.get(track.id)
        if (!element) continue
        const { shouldPlay, sourceTime } = audioTrackPlaybackAt(track, sequenceTime)
        element.volume = audioTrackGainAt(track, sequenceTime)
        if (shouldPlay && running) {
          if (element.paused) {
            element.currentTime = sourceTime
            // play() rejects (AbortError) when interrupted by pause — an
            // expected outcome, matching the video elements.
            element.play().catch(() => {})
          } else if (Math.abs(element.currentTime - sourceTime) > AUDIO_DRIFT_EPSILON) {
            element.currentTime = sourceTime
          }
        } else {
          if (!element.paused) element.pause()
          // Keep the paused element cued to the position (its in-point while
          // the position is before the window) so resuming starts aligned.
          if (Math.abs(element.currentTime - sourceTime) > AUDIO_DRIFT_EPSILON) {
            element.currentTime = sourceTime
          }
        }
      }
    },
    [audioTracks],
  )

  const pauseAudioTracks = useCallback(() => {
    for (const element of audioRefs.current.values()) {
      if (element && !element.paused) element.pause()
    }
  }, [])

  /**
   * Aligns every overlay video layer's element with a sequence position
   * (#145), exactly as syncAudioTracks aligns the audio tracks — the same
   * window math (`audioTrackPlaybackAt` applies structurally: offset +
   * trim, half-open) and the same drift tolerance. Volume is the overlay's
   * own volume × mute (`videoEntryGain`), set every call so edits apply
   * mid-play; overlays have no fades. Each element keeps a single source
   * for the overlay's lifetime (src set in the render), so cueing is only
   * ever a seek.
   */
  const syncVideoOverlays = useCallback(
    (sequenceTime: number, running: boolean) => {
      for (const overlay of videoOverlays) {
        const element = overlayRefs.current.get(overlay.id)
        if (!element) continue
        const { shouldPlay, sourceTime } = audioTrackPlaybackAt(overlay, sequenceTime)
        element.volume = videoEntryGain(overlay)
        if (shouldPlay && running) {
          if (element.paused) {
            element.currentTime = sourceTime
            // play() rejects (AbortError) when interrupted by pause — an
            // expected outcome, matching the other media elements.
            element.play().catch(() => {})
          } else if (Math.abs(element.currentTime - sourceTime) > AUDIO_DRIFT_EPSILON) {
            element.currentTime = sourceTime
          }
        } else {
          if (!element.paused) element.pause()
          // Keep the paused element cued to the position (its in-point while
          // the position is before the window) so resuming starts aligned —
          // and so a paused scrub through the window shows the right frame.
          if (Math.abs(element.currentTime - sourceTime) > AUDIO_DRIFT_EPSILON) {
            element.currentTime = sourceTime
          }
        }
      }
    },
    [videoOverlays],
  )

  const pauseVideoOverlays = useCallback(() => {
    for (const element of overlayRefs.current.values()) {
      if (element && !element.paused) element.pause()
    }
  }, [])

  /** Single writer for the engagement, keeping the ref and its state mirror in step. */
  const setEngaged = useCallback((value: number | null) => {
    engagedForRef.current = value
    setEngagedFor(value)
  }, [])

  /**
   * Cues one element to a source time, switching src when it plays a
   * different source clip. currentTime is only settable once metadata is
   * loaded, so after a src switch the seek (and optional play) waits for
   * loadedmetadata. `rate` is the remapped playback rate at the cue point
   * (#141) — set with the seek so a cue into a speed segment starts at the
   * segment's speed rather than at whatever the element last played.
   */
  const cueElement = useCallback(
    (video: HTMLVideoElement, url: string, sourceTime: number, thenPlay: boolean, rate = 1) => {
      const start = () => {
        video.playbackRate = rate
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

  /**
   * Cues the primary element to a position given as *output* seconds into
   * the entry (#141) — the remapped currency locateInSequence's results are
   * found at — resolving the source instant, playback rate, and (inside a
   * pause plateau) the hold to freeze through via remapPlaybackAt. For an
   * entry without effects this is the identity: source = output, rate 1,
   * never a hold.
   */
  const cuePrimary = useCallback(
    (location: PlaybackLocation, outputInto: number, thenPlay: boolean) => {
      const video = primaryVideo()
      if (!video) return
      indexRef.current = location.index
      holdRef.current = null
      if (isStillEntry(location.entry)) {
        // A still fronts declaratively (#140): its <img> renders from the
        // published location, so cueing is just starting its wall clock;
        // the idle primary video element must not keep sounding underneath.
        stillClockRef.current = { sourceTime: location.sourceTime, lastNow: performance.now() }
        if (!video.paused) video.pause()
        return
      }
      stillClockRef.current = null
      const trimmed = effectiveDuration(location.entry)
      const state = remapPlaybackAt(trimmed, remapsForEntry(timeline, location.entry.id), outputInto)
      lastRelSourceRef.current = state.sourceTime
      if (state.hold) {
        // Inside a pause plateau: freeze the element on the instant's frame;
        // the rAF loop advances the hold while playing.
        holdRef.current = {
          at: state.sourceTime,
          outputEnd: state.hold.outputEnd,
          outputNow: Math.min(Math.max(outputInto, state.hold.outputStart), state.hold.outputEnd),
          lastNow: performance.now(),
        }
        if (!video.paused) video.pause()
        cueElement(video, location.entry.url, location.entry.inPoint + state.sourceTime, false)
      } else {
        cueElement(
          video,
          location.entry.url,
          location.entry.inPoint + state.sourceTime,
          thenPlay,
          state.rate,
        )
      }
    },
    [cueElement, timeline],
  )

  /**
   * Aligns the secondary element with a location: inside an overlap it is
   * cued to the incoming entry and the two elements' audio is split by the
   * transition's progress (a volume crossfade, for both transition types);
   * outside one it is silenced and paused. Every volume routes through the
   * composed gain (#104), so a muted or reduced entry stays that way through
   * a transition.
   */
  const syncSecondary = useCallback(
    (location: PlaybackLocation, thenPlay: boolean) => {
      const primary = primaryVideo()
      const secondary = secondaryVideo()
      if (!primary || !secondary) return
      const overlap = location.transition
      if (overlap) {
        // A still layer has no audio to ramp (#140); only video elements
        // carry gain through the crossfade.
        if (!isStillEntry(location.entry)) {
          primary.volume = videoEntryGain(location.entry, 1 - overlap.progress)
        }
        setEngaged(location.index)
        if (isStillEntry(overlap.entry)) {
          // The incoming still renders declaratively — nothing to cue, and
          // whatever clip the secondary element held must not keep playing.
          if (!secondary.paused) secondary.pause()
        } else {
          secondary.volume = videoEntryGain(overlap.entry, overlap.progress)
          // The incoming entry's remap state at this point of the overlap
          // (#141): output seconds into it are the overlap's elapsed output.
          const duration = boundaryTransitions(timeline)[location.index]?.duration ?? 0
          const inState = remapPlaybackAt(
            effectiveDuration(overlap.entry),
            remapsForEntry(timeline, overlap.entry.id),
            overlap.progress * duration,
          )
          cueElement(
            secondary,
            overlap.entry.url,
            overlap.sourceTime,
            thenPlay && inState.hold === null,
            inState.hold === null ? inState.rate : 1,
          )
        }
      } else {
        if (!isStillEntry(location.entry)) primary.volume = videoEntryGain(location.entry)
        if (engagedForRef.current !== null) {
          setEngaged(null)
          secondary.pause()
        }
      }
    },
    [cueElement, setEngaged, timeline],
  )

  const stopLoop = useCallback(() => {
    cancelAnimationFrame(frameRef.current)
  }, [])

  /**
   * Per-frame while playing: publish the current sequence position, run the
   * transition overlap (engage the secondary element, split the audio), and
   * when the outgoing clip reaches its out-point (or actually ends) either
   * hand over to the next entry or finish the sequence.
   *
   * Under time remapping (#141) the entry's position is tracked in *output*
   * seconds into it: outside a pause the element clock is authoritative and
   * maps to output through the entry's effects (its rate driven to the
   * active segment's factor); inside a pause the element freezes on the
   * instant's frame and the hold's wall clock is authoritative. An entry
   * without effects reduces exactly to the pre-remap math.
   */
  const tick = useCallback(() => {
    const video = primaryVideo()
    if (!video) return
    const index = indexRef.current
    const entry = timeline.entries[index]
    if (!entry) return
    const next = timeline.entries[index + 1]
    const overlap = boundaryTransitions(timeline)[index]
    const still = isStillEntry(entry)
    const effects = still ? [] : remapsForEntry(timeline, entry.id)
    const trimmed = effectiveDuration(entry)

    // The fronting entry's source-clip clock: the element's for a video, the
    // wall clock for a still (#140), advanced here — only while playing —
    // so pausing freezes it and edits/seeks reset it via cuePrimary.
    let sourceTime: number
    // Output seconds into the entry at this frame — what the sequence
    // position and transition progress are measured in (#141). For an entry
    // with no effects it equals sourceTime − inPoint.
    let outputInto: number
    // Whether the entry has played out: its source consumed *and* no pause
    // still holding or left to hold.
    let reachedOut = false
    if (still) {
      const clock = stillClockRef.current
      if (!clock) return
      const now = performance.now()
      clock.sourceTime += (now - clock.lastNow) / 1000
      clock.lastNow = now
      sourceTime = clock.sourceTime
      outputInto = sourceTime - entry.inPoint
      reachedOut = sourceTime >= entry.outPoint - BOUNDARY_EPSILON
    } else if (holdRef.current) {
      // A pause plateau in progress: the element stays frozen while the wall
      // clock advances the output position through the hold.
      const hold = holdRef.current
      const now = performance.now()
      hold.outputNow += (now - hold.lastNow) / 1000
      hold.lastNow = now
      sourceTime = entry.inPoint + hold.at
      if (hold.outputNow < hold.outputEnd) {
        outputInto = hold.outputNow
      } else {
        outputInto = hold.outputEnd
        // Plateau over: re-resolve the position rather than assume playback
        // resumes — a second pause at the same instant plateaus again right
        // where this one ends (#153), so back-to-back holds chain into
        // their combined duration instead of the sequence clock jumping
        // over the later one. Chained plateaus share the frozen instant, so
        // the element simply stays paused where it is.
        const chained = remapPlaybackAt(trimmed, effects, hold.outputEnd)
        if (chained.hold !== null && chained.hold.outputEnd > hold.outputEnd) {
          holdRef.current = {
            at: chained.sourceTime,
            outputEnd: chained.hold.outputEnd,
            outputNow: hold.outputEnd,
            lastNow: now,
          }
          lastRelSourceRef.current = chained.sourceTime
        } else if (hold.at < trimmed - BOUNDARY_EPSILON && !video.ended) {
          // Resume the element from the frozen instant — unless the entry's
          // source is already consumed (an end-of-entry pause), in which
          // case the branch below hands over. play() on an ended element
          // would restart it from the beginning.
          holdRef.current = null
          lastRelSourceRef.current = hold.at
          video.playbackRate = rateAtSourceTime(effects, hold.at)
          video.play().catch(() => {})
        } else {
          holdRef.current = null
          lastRelSourceRef.current = hold.at
          reachedOut = true
        }
      }
    } else {
      sourceTime = video.currentTime
      const relSource = sourceTime - entry.inPoint
      const sourceDone = relSource >= trimmed - BOUNDARY_EPSILON || video.ended
      // Crossing a pause instant between frames starts its hold (#141):
      // freeze the element on the instant's frame. An end-of-entry pause is
      // reached through `sourceDone` — the element clock stops just short of
      // the exact out-point.
      const crossed = effects.find(
        (effect) =>
          effect.kind === 'pause' &&
          effect.at > lastRelSourceRef.current &&
          (effect.at <= relSource || sourceDone),
      )
      if (crossed !== undefined && crossed.kind === 'pause') {
        video.pause()
        video.currentTime = entry.inPoint + crossed.at
        const outputStart = outputTimeAtSource(trimmed, effects, crossed.at)
        holdRef.current = {
          at: crossed.at,
          outputEnd: outputStart + crossed.hold,
          outputNow: outputStart,
          lastNow: performance.now(),
        }
        lastRelSourceRef.current = crossed.at
        sourceTime = entry.inPoint + crossed.at
        outputInto = outputStart
      } else {
        lastRelSourceRef.current = relSource
        const rate = rateAtSourceTime(effects, relSource)
        if (video.playbackRate !== rate) video.playbackRate = rate
        outputInto = outputTimeAtSource(trimmed, effects, relSource)
        reachedOut = sourceDone
      }
    }

    if (reachedOut) {
      if (next && overlap && isStillEntry(next)) {
        // Handover into a still (#140): nothing was cued — the incoming
        // still has been rendering declaratively through the overlap — so
        // just start its wall clock where the overlap ends.
        if (!still) video.pause()
        setEngaged(null)
        indexRef.current = index + 1
        stillClockRef.current = {
          sourceTime: next.inPoint + overlap.duration,
          lastNow: performance.now(),
        }
        const time = sequenceTimeAt(timeline, index + 1, next.inPoint + overlap.duration)
        setSequenceTime(time)
        syncAudioTracks(time, true)
        syncVideoOverlays(time, true)
      } else if (next && overlap) {
        // Handover mid-transition: the incoming entry is already playing in
        // the secondary element — promote it to primary instead of re-cueing.
        const incoming = secondaryVideo()
        if (!incoming) return
        const wasEngaged = engagedForRef.current === index
        if (!still) video.pause()
        // The incoming entry leaves its transition ramp for its own steady
        // gain; the outgoing element is paused, its volume set when next cued.
        incoming.volume = videoEntryGain(next)
        setEngaged(null)
        indexRef.current = index + 1
        stillClockRef.current = null
        primaryIsARef.current = !primaryIsARef.current
        setPrimaryIsA(primaryIsARef.current)
        const nextEffects = remapsForEntry(timeline, next.id)
        if (wasEngaged && nextEffects.length === 0) {
          const time = sequenceTimeAt(timeline, index + 1, incoming.currentTime)
          setSequenceTime(time)
          syncAudioTracks(time, true)
          syncVideoOverlays(time, true)
          holdRef.current = null
          lastRelSourceRef.current = incoming.currentTime - next.inPoint
          if (incoming.playbackRate !== 1) incoming.playbackRate = 1
        } else {
          // A remapped incoming entry (or an overlap shorter than a frame,
          // where engagement raced the out-point): land on the geometric
          // handover point — overlap.duration output seconds into the
          // incoming entry — and let cuePrimary resolve its rate or hold.
          // For an already-engaged element this is at most a drift-sized
          // snap.
          const time = entryStartTime(timeline, index + 1) + overlap.duration
          setSequenceTime(time)
          syncAudioTracks(time, true)
          syncVideoOverlays(time, true)
          cuePrimary({ index: index + 1, entry: next, sourceTime: next.inPoint }, overlap.duration, true)
        }
      } else if (next) {
        const time = entryStartTime(timeline, index + 1)
        setSequenceTime(time)
        syncAudioTracks(time, true)
        syncVideoOverlays(time, true)
        // A hard cut continues in the same element — apply the next entry's
        // gain (#104) where the transition path would have swapped roles.
        // (A still has no element or gain; cuePrimary starts its clock.)
        if (!isStillEntry(next)) video.volume = videoEntryGain(next)
        cuePrimary({ index: index + 1, entry: next, sourceTime: next.inPoint }, 0, true)
      } else {
        video.pause()
        secondaryVideo()?.pause()
        setPlaying(false)
        setSequenceTime(totalDuration(timeline))
        // End of the video sequence ends the mix: any track still inside its
        // window (a silent tail per #102) pauses with everything else.
        pauseAudioTracks()
        pauseVideoOverlays()
        return
      }
    } else {
      const time = entryStartTime(timeline, index) + outputInto
      setSequenceTime(time)
      // Tracks start and stop mid-play as the position crosses their
      // windows, and drifting clocks are snapped back (#103).
      syncAudioTracks(time, true)
      syncVideoOverlays(time, true)
      if (next && overlap) {
        // The overlap plays out in output seconds (#141): it starts where
        // the entry's remaining *output* equals the transition's duration —
        // for an entry without effects, exactly the old source-time math.
        const overlapStartOut = entryOutputDuration(entry, remapsOf(timeline)) - overlap.duration
        if (outputInto >= overlapStartOut) {
          const progress = Math.min((outputInto - overlapStartOut) / overlap.duration, 1)
          if (isStillEntry(next)) {
            // The incoming still renders declaratively from the published
            // time (#140) — engagement just marks the overlay active. Only
            // the outgoing side has audio to ramp.
            if (engagedForRef.current !== index) setEngaged(index)
            if (!still) video.volume = videoEntryGain(entry, 1 - progress)
          } else {
            const secondary = secondaryVideo()
            if (secondary) {
              // The incoming entry's remap state this far into the overlap
              // (#141): where its source should stand, at what rate — or
              // frozen inside a pause plateau. Its element free-runs between
              // frames; the published mapping is authoritative, so a clock
              // that strays visibly is snapped back (the drift correction,
              // now against the remapped mapping).
              const inState = remapPlaybackAt(
                effectiveDuration(next),
                remapsForEntry(timeline, next.id),
                outputInto - overlapStartOut,
              )
              const expected = next.inPoint + inState.sourceTime
              if (engagedForRef.current !== index) {
                setEngaged(index)
                cueElement(
                  secondary,
                  next.url,
                  expected,
                  inState.hold === null,
                  inState.hold === null ? inState.rate : 1,
                )
              } else if (inState.hold !== null) {
                if (!secondary.paused) secondary.pause()
                if (Math.abs(secondary.currentTime - expected) > VIDEO_DRIFT_EPSILON) {
                  secondary.currentTime = expected
                }
              } else {
                if (secondary.playbackRate !== inState.rate) secondary.playbackRate = inState.rate
                if (secondary.paused) {
                  secondary.currentTime = expected
                  secondary.play().catch(() => {})
                } else if (Math.abs(secondary.currentTime - expected) > VIDEO_DRIFT_EPSILON) {
                  secondary.currentTime = expected
                }
              }
              if (!still) video.volume = videoEntryGain(entry, 1 - progress)
              secondary.volume = videoEntryGain(next, progress)
            }
          }
        }
      }
    }
    frameRef.current = requestAnimationFrame(tick)
  }, [timeline, cueElement, cuePrimary, setEngaged, syncAudioTracks, syncVideoOverlays, pauseAudioTracks, pauseVideoOverlays])

  const play = useCallback(() => {
    // Play from the end restarts the sequence.
    const from = sequenceTime >= total ? 0 : sequenceTime
    const location = locateInSequence(timeline, from)
    if (!location) return
    setPlaying(true)
    setSequenceTime(from)
    cuePrimary(location, from - entryStartTime(timeline, location.index), true)
    syncSecondary(location, true)
    syncAudioTracks(from, true)
    syncVideoOverlays(from, true)
    stopLoop()
    frameRef.current = requestAnimationFrame(tick)
  }, [sequenceTime, total, timeline, cuePrimary, syncSecondary, syncAudioTracks, syncVideoOverlays, stopLoop, tick])

  const pause = useCallback(() => {
    stopLoop()
    primaryVideo()?.pause()
    secondaryVideo()?.pause()
    pauseAudioTracks()
    pauseVideoOverlays()
    setPlaying(false)
  }, [stopLoop, pauseAudioTracks, pauseVideoOverlays])

  const seek = useCallback(
    (time: number) => {
      const location = locateInSequence(timeline, time)
      if (!location) return
      setSequenceTime(time)
      cuePrimary(location, time - entryStartTime(timeline, location.index), playing)
      syncSecondary(location, playing)
      // Scrubbing re-cues every track: active ones re-seek (and keep playing
      // if we are playing), the rest pause where they would next start.
      syncAudioTracks(time, playing)
      syncVideoOverlays(time, playing)
    },
    [timeline, cuePrimary, syncSecondary, syncAudioTracks, syncVideoOverlays, playing],
  )

  // Edits to the timeline invalidate the playback position (entries or
  // tracks may be gone, reordered, or retrimmed): stop and re-clamp rather
  // than guessing.
  useEffect(() => {
    stopLoop()
    for (const video of [videoARef.current, videoBRef.current]) {
      if (video && !video.paused) video.pause()
    }
    pauseAudioTracks()
    pauseVideoOverlays()
    setEngaged(null)
    holdRef.current = null
    setPlaying(false)
    setSequenceTime((time) => Math.min(time, totalDuration(timeline)))
  }, [timeline, stopLoop, setEngaged, pauseAudioTracks, pauseVideoOverlays])

  useEffect(() => stopLoop, [stopLoop])

  const location = locateInSequence(timeline, sequenceTime)
  // Gate the overlay on the actual engagement, not the recomputed location
  // alone: right after a handover the published time can still trail inside
  // the overlap, and then the top-layer element holds the outgoing clip (#61).
  const overlap = isTransitionOverlayActive(location, engagedFor)
    ? location?.transition
    : undefined

  const layerStyles = overlap ? transitionLayerStyles(overlap) : undefined
  // Which layers are stills (#140): a still renders in the same stacked slot
  // a video element would occupy, styled identically — an <img> for an image
  // still, a solid-color div for a slate (#143).
  const stillPrimary = location !== null && isStillEntry(location.entry)
  const stillIncoming = overlap !== undefined && isStillEntry(overlap.entry)
  const slatePrimary = location !== null && isSlateEntry(location.entry)
  const slateIncoming = overlap !== undefined && isSlateEntry(overlap.entry)

  // The fronting entry's intrinsic dimensions, read via an off-DOM
  // metadata-only element: the stacked elements are cued lazily (on play or
  // seek), so their own metadata may not exist when the panel is expanded
  // before anything played. Blob metadata is in memory — this is cheap — and
  // keying on the URL re-probes exactly when a different clip fronts. An
  // image still probes through an <img> (#140), a video cannot decode it. A
  // slate (#143) has no dimensions of its own: it fills whatever stage the
  // last real source (or the 16:9 default) shaped, so nothing is probed.
  const frontingUrl = location?.entry.url ?? null
  useEffect(() => {
    if (frontingUrl === null || slatePrimary) return undefined
    let stale = false
    if (stillPrimary) {
      const probe = new Image()
      probe.onload = () => {
        if (!stale && probe.naturalWidth > 0 && probe.naturalHeight > 0) {
          setVideoAspect(probe.naturalWidth / probe.naturalHeight)
        }
      }
      probe.src = frontingUrl
      return () => {
        stale = true
        probe.onload = null
        probe.removeAttribute('src')
      }
    }
    const probe = document.createElement('video')
    probe.preload = 'metadata'
    probe.addEventListener(
      'loadedmetadata',
      () => {
        if (!stale && probe.videoWidth > 0 && probe.videoHeight > 0) {
          setVideoAspect(probe.videoWidth / probe.videoHeight)
        }
      },
      { once: true },
    )
    probe.src = frontingUrl
    return () => {
      stale = true
      probe.removeAttribute('src')
    }
  }, [frontingUrl, stillPrimary, slatePrimary])

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

  /**
   * Role-dependent props for one of the two stacked video elements. A still
   * layer (#140) takes over its slot with an <img> instead, so the video
   * element standing in that role hides as idle.
   */
  const videoProps = (isA: boolean) => {
    const isPrimary = isA === primaryIsA
    if (isPrimary) {
      if (stillPrimary) return { className: 'preview-video preview-video-idle' }
      return {
        className: 'preview-video',
        'data-testid': 'preview-video',
        style: withZoom(layerStyles?.outgoing, primaryZoom),
      }
    }
    const videoOverlap = overlap !== undefined && !stillIncoming
    return {
      className: `preview-video preview-video-incoming${videoOverlap ? '' : ' preview-video-idle'}`,
      style: videoOverlap ? withZoom(layerStyles?.incoming, incomingZoom) : undefined,
      'data-testid': videoOverlap ? 'preview-video-incoming' : undefined,
    }
  }

  return (
    <section className="panel preview-panel" aria-label="Preview">
      <div className="preview-header">
        <h2>Preview</h2>
        {onToggleExpanded && (
          <button
            type="button"
            className="preview-expand"
            aria-label={expanded ? 'Restore preview size' : 'Expand preview'}
            onClick={onToggleExpanded}
          >
            {expanded ? 'Restore size' : 'Expand'}
          </button>
        )}
      </div>
      {empty ? (
        <p className="placeholder">Add clips to the timeline to preview your edit.</p>
      ) : (
        <div className="preview-player">
          {/* Sized by CSS; sequence audio plays. Controls are the app's own. */}
          <div
            className={expanded ? 'preview-stage preview-stage-expanded' : 'preview-stage'}
            style={
              expanded && videoAspect !== null
                ? ({ '--preview-aspect': String(videoAspect) } as CSSProperties)
                : undefined
            }
          >
            <video ref={videoARef} playsInline preload="auto" {...videoProps(true)} />
            <video ref={videoBRef} playsInline preload="auto" {...videoProps(false)} />
            {/* Still layers (#140): an <img> in the same stacked slot,
                sharing the video layers' classes so transitions and zooms
                style it identically. Decorative — the still's name is
                announced by the now-playing line below. A slate (#143)
                renders as its flat color instead: same slot, same styles,
                no media behind it. */}
            {slatePrimary && location ? (
              <div
                className="preview-video"
                data-testid="preview-slate"
                style={{
                  ...withZoom(layerStyles?.outgoing, primaryZoom),
                  backgroundColor: location.entry.color,
                }}
              />
            ) : (
              stillPrimary &&
              location && (
                <img
                  className="preview-video"
                  data-testid="preview-image"
                  alt=""
                  src={location.entry.url}
                  style={withZoom(layerStyles?.outgoing, primaryZoom)}
                />
              )
            )}
            {slateIncoming && overlap ? (
              <div
                className="preview-video preview-video-incoming"
                data-testid="preview-slate-incoming"
                style={{
                  ...withZoom(layerStyles?.incoming, incomingZoom),
                  backgroundColor: overlap.entry.color,
                }}
              />
            ) : (
              stillIncoming &&
              overlap && (
                <img
                  className="preview-video preview-video-incoming"
                  data-testid="preview-image-incoming"
                  alt=""
                  src={overlap.entry.url}
                  style={withZoom(layerStyles?.incoming, incomingZoom)}
                />
              )
            )}
            {/* Overlay video layers (#145): one <video> per layer, kept
                mounted for the overlay's lifetime (so scrubbing never
                re-loads a source) and positioned at its fractional rectangle
                within the stage — the same frame proxy text overlays and
                zoom fractions address. The clip letterboxes inside the
                rectangle (object-fit: contain) with transparent gutters, so
                the base video shows through rather than black bars.
                Stacking, bottom to top: base video/still layers (transitions
                and zooms apply to those), then overlay layers in add order,
                then text overlays — a title is never hidden by a
                picture-in-picture. Visibility is declarative from the
                published time (hidden outside the window); playback and
                audio follow via syncVideoOverlays each frame. */}
            {videoOverlays.map((overlay, index) => {
              const active = audioTrackPlaybackAt(overlay, Math.min(sequenceTime, total)).shouldPlay
              return (
                <video
                  key={overlay.id}
                  ref={(element) => {
                    overlayRefs.current.set(overlay.id, element)
                  }}
                  src={overlay.url}
                  preload="auto"
                  playsInline
                  className={`preview-overlay-video${active ? '' : ' preview-overlay-hidden'}`}
                  data-testid={`preview-overlay-${index}`}
                  style={{
                    left: `${overlay.x * 100}%`,
                    top: `${overlay.y * 100}%`,
                    width: `${overlay.width * 100}%`,
                    height: `${overlay.height * 100}%`,
                  }}
                />
              )
            })}
            {/* Text overlays (#139): items whose window covers the published
                sequence time, drawn above the composed frame. Stacking order,
                bottom to top: video/still layers (transitions and zooms apply
                to them below), then overlays in add order — an overlay never
                zooms or slides with a clip; it annotates the output frame.
                Position is the block's centre in frame fractions; size is a
                fraction of the frame height, realized via container-query
                height units against the stage (the frame proxy the preview
                already letterboxes real sources into). Declarative from the
                published time, so playing, pausing, and scrubbing all show
                exactly the overlays for the current instant. */}
            {textsOf(timeline).map(
              (text, index) =>
                textActiveAt(text, Math.min(sequenceTime, total)) && (
                  <p
                    key={text.id}
                    className="preview-text"
                    data-testid={`preview-text-${index}`}
                    style={{
                      left: `${text.x * 100}%`,
                      top: `${text.y * 100}%`,
                      fontSize: `${text.size * 100}cqh`,
                      fontFamily: textFontStack(text.font),
                      fontWeight: text.bold ? 700 : 400,
                      fontStyle: text.italic ? 'italic' : 'normal',
                      color: text.color,
                    }}
                  >
                    {text.content}
                  </p>
                ),
            )}
          </div>
          {/* One element per audio track (#103), driven by syncAudioTracks.
              Sound only — nothing rendered, nothing announced. Keyed by track
              id so retiming or trimming a track never re-creates (and never
              re-loads) another track's element. */}
          {audioTracks.map((track, index) => (
            <audio
              key={track.id}
              ref={(element) => {
                audioRefs.current.set(track.id, element)
              }}
              src={track.url}
              preload="auto"
              data-testid={`preview-audio-${index}`}
            />
          ))}
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
