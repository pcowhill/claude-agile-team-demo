import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from 'react'
import { targetEditsText } from '../lib/history'
import { targetClaimsKeys } from '../lib/transport'
import { formatTrimTime, frameStep, sourceTime, stripFraction, timeAtStripFraction } from '../lib/trim'
import type { TrimRange } from '../lib/trim'
import { trimFramesFor } from '../lib/trimFrames'
import type { CutClamps, CutRefusal } from '../lib/cutWindow'
import {
  clampCut,
  cutClampsRefusal,
  cutRefusalText,
  initialCutClamps,
  playCutStart,
  playCutStep,
} from '../lib/cutWindow'
import type { AudioWaveform } from './AudioWaveform'
import { StripPicture, TrimField } from './TrimDialog'
import './dialog.css'
import './TrimDialog.css'
import './CutDialog.css'

interface CutDialogProps {
  /**
   * The element being cut — a sequence entry (#827), or a video overlay or
   * an audio track (#828) — as its source and its current trim.
   */
  entry: { name: string; url: string; duration: number; inPoint: number; outPoint: number }
  /**
   * An audio track (#828): no picture, as in the Trim and Split windows'
   * mode for tracks (#711, #826). The window plays the source through an
   * `<audio>` element, the strip is its waveform alone, and there are no
   * frames to step by.
   */
  audioOnly?: boolean
  /** "clip.webm at position 2": the row's own wording, as the Trim window's title. */
  position: string
  /** The clamps' arrow steps: the nudge and jump sizes from Settings. */
  stepSeconds: number
  largeStepSeconds: number
  /**
   * Apply: the part to remove, in source seconds. On a sequence entry the
   * caller cuts it out with Cut out marked range (#823) over the same span
   * of sequence time, ripple and confirmation included (#824); on an
   * overlay or a track with `element-cut` (#828), which closes the element
   * up and moves nothing else. Either way, one undo step.
   */
  onApply: (clamps: CutClamps) => void
  /** Cancel, ✕ and Escape: close, changing nothing. */
  onClose: () => void
  /** Called once as the window opens: the app pauses its preview, as for Trim… (#722). */
  onOpen?: () => void
  /**
   * Why the cut is refused, or null where Apply cuts: the timeline answers
   * with `entryCutRefusal`, which adds Cut out marked range's own rule to
   * the clamps'. Defaults to the clamps' rule alone (`cutClampsRefusal`).
   */
  refusalFor?: (clamps: CutClamps) => CutRefusal | null
  /** Injectable for tests (jsdom has no Web Audio or blob fetch). */
  peaksFor?: Parameters<typeof AudioWaveform>[0]['peaksFor']
  framesFor?: (url: string, duration: number) => Promise<(string | null)[]>
}

type Grip = 'from' | 'to' | 'playhead'

/**
 * The Cut window (#827, the customer's request on #731): the Trim window's
 * frame (the raw clip at the top, the whole clip as a strip of its frames
 * over its waveform, the part outside In and Out dimmed) with two clamps,
 * *Cut from* and *Cut to*. It is Trim…'s inverse: the part **between** the
 * clamps is shaded as removed, and what lies either side is kept.
 *
 * **▶ Play cut** plays the clip as it will be after the cut: from a short
 * lead-in before *Cut from*, then straight on from *Cut to*, so the join is
 * heard and seen before it is applied.
 *
 * **Nothing changes until Apply**, which hands the clamps to the row's
 * `onCutRange` path: Cut out marked range over the entry's span. Apply is
 * disabled where that cut would remove nothing from the middle (a clamp on
 * In or Out, which is a trim, or the clamps inverted or equal) and where
 * the cut itself refuses, inside a transition.
 *
 * Its keys are its own, for the reason the Trim window's are: it is a
 * modal dialog (`modalDialogOpen`), so the app-wide keys stand down.
 */
export function CutDialog({
  entry,
  audioOnly = false,
  position,
  stepSeconds,
  largeStepSeconds,
  onApply,
  onClose,
  onOpen,
  refusalFor,
  peaksFor,
  framesFor = trimFramesFor,
}: CutDialogProps) {
  const { duration, url } = entry
  const range: TrimRange = { inPoint: entry.inPoint, outPoint: entry.outPoint }
  const headingId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  // The window's own player: a <video>, or an <audio> for a track (#828).
  const videoRef = useRef<HTMLMediaElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const [clamps, setClamps] = useState<CutClamps>(() => initialCutClamps(range))
  // The playhead: what the picture shows, in source seconds. It opens on
  // Cut from, the first frame the cut removes.
  const [time, setTime] = useState(() => clamps.from)
  const [playing, setPlaying] = useState(false)
  const [grip, setGrip] = useState<Grip | null>(null)
  // The rAF tick reads the live values through refs, as the players do.
  const rangeRef = useRef(range)
  rangeRef.current = range
  const clampsRef = useRef(clamps)
  clampsRef.current = clamps
  const timeRef = useRef(time)
  timeRef.current = time
  const frameRef = useRef<number | null>(null)

  const stopTicking = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
  }, [])
  useEffect(() => stopTicking, [stopTicking])

  // Focus starts on the window, so Space plays at once (as in Trim…).
  useEffect(() => {
    dialogRef.current?.focus()
  }, [])
  useEffect(() => {
    onOpen?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pause = useCallback(() => {
    stopTicking()
    videoRef.current?.pause()
    setPlaying(false)
  }, [stopTicking])

  /** Moves the playhead, and the picture with it; a play in progress stops. */
  const seek = useCallback(
    (to: number) => {
      const target = sourceTime(to, duration)
      pause()
      setTime(target)
      const element = videoRef.current
      if (element !== null) element.currentTime = target
    },
    [duration, pause],
  )

  const tick = useCallback(() => {
    const element = videoRef.current
    if (element === null) return
    const step = playCutStep(element.currentTime, rangeRef.current, clampsRef.current)
    if (step.kind === 'stop') {
      element.pause()
      element.currentTime = step.at
      setTime(step.at)
      setPlaying(false)
      frameRef.current = null
      return
    }
    if (step.kind === 'jump') {
      // Over the removed part: straight on from Cut to.
      element.currentTime = step.at
    } else if (element.paused) {
      // Paused by something other than this window (a media key, say).
      setTime(step.at)
      setPlaying(false)
      frameRef.current = null
      return
    }
    setTime(step.at)
    frameRef.current = requestAnimationFrame(tick)
  }, [])

  const playCut = useCallback(() => {
    const element = videoRef.current
    if (element === null) return
    const start = playCutStart(rangeRef.current, clampsRef.current)
    element.currentTime = start
    setTime(start)
    stopTicking()
    void element.play().catch(() => {
      stopTicking()
      setPlaying(false)
    })
    setPlaying(true)
    frameRef.current = requestAnimationFrame(tick)
  }, [stopTicking, tick])

  const togglePlay = useCallback(() => {
    if (playing) pause()
    else playCut()
  }, [playing, pause, playCut])

  const setClamp = useCallback(
    (which: 'from' | 'to', asked: number) => {
      const at = clampCut(asked, rangeRef.current)
      setClamps((current) => ({ ...current, [which]: at }))
      return at
    },
    [],
  )
  const setFromHere = useCallback(() => setClamp('from', timeRef.current), [setClamp])
  const setToHere = useCallback(() => setClamp('to', timeRef.current), [setClamp])

  const refusal = (refusalFor ?? ((asked: CutClamps) => cutClampsRefusal(range, asked)))(clamps)
  const cuttable = refusal === null
  const apply = () => {
    if (!cuttable) return
    pause()
    onApply(clamps)
  }

  // The window's keys: Escape closes; Space plays and pauses — anywhere in
  // the window but a control that claims the key.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        pause()
        onClose()
        return
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key === ' ') {
        if (targetClaimsKeys(event.target) || targetEditsText(event.target)) return
        event.preventDefault()
        togglePlay()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, pause, togglePlay])

  // ── The strip ─────────────────────────────────────────────────────────
  const timeAtPointer = (event: { clientX: number }) => {
    const box = stripRef.current?.getBoundingClientRect()
    if (box === undefined || box.width <= 0) return 0
    return timeAtStripFraction((event.clientX - box.left) / box.width, duration)
  }
  // Dragging a clamp moves the picture to that clamp, live, so you see the
  // exact frame the cut starts or ends on.
  const moveGrip = (which: Grip, to: number) => {
    if (which === 'playhead') seek(to)
    else seek(setClamp(which, to))
  }
  const beginDrag = (which: Grip) => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    stripRef.current?.setPointerCapture?.(event.pointerId)
    if (which !== 'playhead') (event.currentTarget as HTMLElement).focus({ preventScroll: true })
    setGrip(which)
    if (which === 'playhead') moveGrip('playhead', timeAtPointer(event))
  }
  const onStripPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (grip === null) return
    moveGrip(grip, timeAtPointer(event))
  }
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (grip === null) return
    stripRef.current?.releasePointerCapture?.(event.pointerId)
    setGrip(null)
  }
  // A clamp is a keyboard slider too: ← → by the nudge size, Shift for the
  // jump size, Home and End to In and Out. The picture follows it.
  const clampKeys = (which: 'from' | 'to') => (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const at = clamps[which]
    const size = event.shiftKey ? largeStepSeconds : stepSeconds
    let to: number | null = null
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') to = at - size
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') to = at + size
    else if (event.key === 'Home') to = range.inPoint
    else if (event.key === 'End') to = range.outPoint
    if (to === null || event.ctrlKey || event.metaKey || event.altKey) return
    event.preventDefault()
    moveGrip(which, to)
  }

  const percent = (at: number) => `${stripFraction(at, duration) * 100}%`
  const inAt = percent(entry.inPoint)
  const outAt = percent(entry.outPoint)
  const removedFrom = percent(Math.min(clamps.from, clamps.to))
  const removedTo = percent(Math.max(clamps.from, clamps.to))
  const removedLength = Math.max(0, clamps.to - clamps.from)

  return (
    // No close on a click outside, as the Trim window: a clamp dragged past
    // the window's edge ends outside it, and must not throw the cut away.
    <div className="dialog-overlay">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        className="dialog trim-dialog cut-dialog"
        data-testid="cut-dialog"
      >
        <div className="trim-header">
          <h3 id={headingId}>Cut {position}</h3>
          <button
            type="button"
            aria-label="Close the Cut window without cutting"
            title="Close without cutting (Esc)"
            onClick={() => {
              pause()
              onClose()
            }}
          >
            ✕
          </button>
        </div>

        <div className="dialog-body">
          {audioOnly ? (
            // An audio track (#828): no picture, so no preview box, as in the
            // Split window's mode for tracks (#826). The element has no
            // controls and takes no room; the window's own buttons play it.
            <audio
              ref={videoRef as RefObject<HTMLAudioElement>}
              data-testid="cut-audio"
              src={url}
              preload="auto"
              onLoadedData={(event) => {
                if (!playing) event.currentTarget.currentTime = timeRef.current
              }}
              onEnded={() => setPlaying(false)}
            />
          ) : (
            <div className="trim-preview">
              <video
                ref={videoRef as RefObject<HTMLVideoElement>}
                className="trim-video"
                data-testid="cut-video"
                src={url}
                playsInline
                preload="auto"
                // Firefox drops a seek made while an element has only its
                // metadata (#615): apply the playhead again once a frame is there.
                onLoadedData={(event) => {
                  if (!playing) event.currentTarget.currentTime = timeRef.current
                }}
                onEnded={() => setPlaying(false)}
              />
            </div>
          )}
          <p className="trim-position" data-testid="cut-position">
            <output aria-label="Cut window playhead">{formatTrimTime(time)}</output> /{' '}
            {formatTrimTime(duration)}
          </p>

          {/* The whole source, left to right: the parts outside In and Out
              dimmed, the part between the clamps shaded as removed, the
              clamps, and the playhead. */}
          <div
            ref={stripRef}
            className={`trim-strip${audioOnly ? ' trim-strip-audio' : ''}${grip === null ? '' : ' trim-strip-dragging'}`}
            data-testid="cut-strip"
            onPointerDown={beginDrag('playhead')}
            onPointerMove={onStripPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <StripPicture
              url={url}
              duration={duration}
              audioOnly={audioOnly}
              peaksFor={peaksFor}
              framesFor={framesFor}
            />
            <div className="trim-strip-dim" style={{ left: 0, width: inAt }} aria-hidden="true" />
            <div className="trim-strip-dim" style={{ left: outAt, right: 0 }} aria-hidden="true" />
            <div
              className="trim-strip-kept"
              style={{ left: inAt, width: `calc(${outAt} - ${inAt})` }}
              aria-hidden="true"
            />
            <div
              className={`cut-strip-removed${cuttable ? '' : ' cut-strip-removed-refused'}`}
              data-testid="cut-removed"
              style={{ left: removedFrom, width: `calc(${removedTo} - ${removedFrom})` }}
              aria-hidden="true"
            />
            <div
              className="trim-playhead"
              data-testid="cut-playhead"
              style={{ left: percent(time) }}
              aria-hidden="true"
            />
            {(['from', 'to'] as const).map((which) => (
              <div
                key={which}
                role="slider"
                tabIndex={0}
                className={`trim-clamp cut-clamp cut-clamp-${which}`}
                data-testid={`cut-clamp-${which}`}
                aria-label={which === 'from' ? 'Cut from clamp' : 'Cut to clamp'}
                aria-valuemin={entry.inPoint}
                aria-valuemax={entry.outPoint}
                aria-valuenow={clamps[which]}
                aria-valuetext={`${formatTrimTime(clamps[which])} into the clip`}
                style={{ left: percent(clamps[which]) }}
                onPointerDown={beginDrag(which)}
                onKeyDown={clampKeys(which)}
              >
                <span aria-hidden="true">{which === 'from' ? ']' : '['}</span>
              </div>
            ))}
          </div>
          <div className="trim-strip-labels" aria-hidden="true">
            <span>In {formatTrimTime(entry.inPoint)}</span>
            <span>Out {formatTrimTime(entry.outPoint)}</span>
          </div>

          <div className="trim-transport" role="group" aria-label="Cut playback">
            {!audioOnly && (
              <button
                type="button"
                aria-label="Back one frame"
                title="Back one frame"
                onClick={() => seek(frameStep(timeRef.current, -1, duration))}
              >
                ◀ frame
              </button>
            )}
            <button
              type="button"
              className="trim-play"
              aria-label={playing ? 'Pause' : 'Play cut'}
              title={
                playing
                  ? 'Pause (Space)'
                  : 'Play the clip as it will be after the cut: up to Cut from, then on from Cut to (Space)'
              }
              onClick={togglePlay}
            >
              {playing ? '⏸ Pause' : '▶ Play cut'}
            </button>
            {!audioOnly && (
              <button
                type="button"
                aria-label="Forward one frame"
                title="Forward one frame"
                onClick={() => seek(frameStep(timeRef.current, 1, duration))}
              >
                frame ▶
              </button>
            )}
          </div>

          <div className="trim-set">
            <button type="button" title="Move the Cut from clamp to the playhead" onClick={setFromHere}>
              Cut from here
            </button>
            <span className="trim-kept-length" data-testid="cut-removed-length">
              removes {formatTrimTime(removedLength)}
            </span>
            <button type="button" title="Move the Cut to clamp to the playhead" onClick={setToHere}>
              Cut to here
            </button>
          </div>

          {/* Why Apply is disabled, held open while empty so the buttons
              below do not move as it comes and goes. */}
          <p className="cut-status" data-testid="cut-status" role="status">
            {refusal === null ? '' : cutRefusalText(refusal)}
          </p>
        </div>

        <div className="trim-footer">
          <span className="trim-fields">
            <label>
              <span>Cut from</span>
              <TrimField
                label="Cut from in seconds"
                value={clamps.from}
                max={duration}
                onCommit={(asked) => seek(setClamp('from', asked))}
              />
            </label>
            <label>
              <span>Cut to</span>
              <TrimField
                label="Cut to in seconds"
                value={clamps.to}
                max={duration}
                onCommit={(asked) => seek(setClamp('to', asked))}
              />
            </label>
          </span>
          <span className="dialog-actions">
            <button
              type="button"
              onClick={() => {
                pause()
                onClose()
              }}
            >
              Cancel
            </button>
            <button type="button" className="cut-apply" disabled={!cuttable} onClick={apply}>
              Apply
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}
