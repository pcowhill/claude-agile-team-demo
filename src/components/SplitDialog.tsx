import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { targetEditsText } from '../lib/history'
import { targetClaimsKeys } from '../lib/transport'
import {
  formatTrimTime,
  frameStep,
  playTrimStart,
  playTrimStep,
  stripFraction,
  timeAtStripFraction,
} from '../lib/trim'
import type { TrimRange } from '../lib/trim'
import { trimFramesFor } from '../lib/trimFrames'
import type { AudioWaveform } from './AudioWaveform'
import { StripPicture, TrimField } from './TrimDialog'
import './dialog.css'
import './TrimDialog.css'
import './SplitDialog.css'

interface SplitDialogProps {
  /**
   * The element being split — a sequence entry, a video overlay or an audio
   * track (#826) — as its source and its current trim.
   */
  entry: { name: string; url: string; duration: number; inPoint: number; outPoint: number }
  /**
   * An audio track (#826): no picture, as in the Trim window's mode for
   * tracks (#711). The window plays the source through an `<audio>`
   * element, the strip is its waveform alone, and there are no frames to
   * step by.
   */
  audioOnly?: boolean
  /** "clip.webm at position 2": the row's own wording, as the Trim window's title. */
  position: string
  /** The arrow keys' steps: the nudge and jump sizes from Settings. */
  stepSeconds: number
  largeStepSeconds: number
  /**
   * Apply: the split point, in source seconds. The caller dispatches its
   * own one action with it — `entry-split`, Split at playhead's razor
   * (#190), or `element-split` for an overlay or a track (#826) — so the
   * split is one undo step.
   */
  onApply: (atSourceTime: number) => void
  /** Cancel, ✕ and Escape: close, changing nothing. */
  onClose: () => void
  /** Called once as the window opens: the app pauses its preview, as for Trim… (#722). */
  onOpen?: () => void
  /**
   * Why the razor refuses to cut at a source time, or null where it cuts:
   * Split at playhead's own rule (`entrySplitRefusal`), so Apply is enabled
   * exactly where that razor would cut — not on In or Out (`'edge'`), and
   * not inside a transition's overlap at either end of the entry, where
   * the split would re-clamp the transition (`'transition'`). Defaults to
   * the edge rule alone, strictly inside the trimmed range.
   */
  refusalAt?: (atSourceTime: number) => 'edge' | 'transition' | null
  /** Injectable for tests (jsdom has no Web Audio or blob fetch). */
  peaksFor?: Parameters<typeof AudioWaveform>[0]['peaksFor']
  framesFor?: (url: string, duration: number) => Promise<(string | null)[]>
}

/**
 * The Split window (#825, the customer's request on #731): the Trim
 * window's frame — the raw clip at the top, the whole clip as a strip of its
 * frames over its waveform, the part outside In and Out dimmed — with one
 * position on it instead of two clamps, the split point.
 *
 * **The split point is the window's playhead.** The picture always shows
 * the frame the cut falls at: a press or drag on the strip, ◀ frame /
 * frame ▶, the arrow keys and the field all move both at once, and ▶ Play
 * plays on from it and leaves it where you pause. It stays within In and
 * Out — the strip's dimmed parts are not part of the entry.
 *
 * **Nothing changes until Apply**, which hands the point to the row's
 * split callback (`onSplitEntry`, or `onSplitElement` for an overlay or a
 * track, #826). It is enabled exactly where Split at playhead's razor
 * cuts: strictly inside the trimmed range, so not on In or on Out, and not
 * inside a transition's overlap at either end of the entry.
 *
 * Its keys are its own, for the reason the Trim window's are: it is a
 * modal dialog (`modalDialogOpen`), so the app-wide keys stand down.
 */
export function SplitDialog({
  entry,
  position,
  audioOnly = false,
  stepSeconds,
  largeStepSeconds,
  onApply,
  onClose,
  onOpen,
  refusalAt,
  peaksFor,
  framesFor = trimFramesFor,
}: SplitDialogProps) {
  const { duration, url } = entry
  const range: TrimRange = { inPoint: entry.inPoint, outPoint: entry.outPoint }
  const headingId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  // The window's own player: a <video>, or an <audio> for a track (#826).
  const videoRef = useRef<HTMLMediaElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  /** A time, held to the entry's trimmed range. */
  const within = useCallback(
    (to: number) => Math.min(entry.outPoint, Math.max(entry.inPoint, to)),
    [entry.inPoint, entry.outPoint],
  )
  // The split point, in source seconds: it opens at the middle of the
  // trimmed range (#825), to the millisecond as the fields show times.
  const [time, setTime] = useState(() => Math.round(((entry.inPoint + entry.outPoint) / 2) * 1000) / 1000)
  const [playing, setPlaying] = useState(false)
  const [dragging, setDragging] = useState(false)
  const timeRef = useRef(time)
  timeRef.current = time
  const rangeRef = useRef(range)
  rangeRef.current = range
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

  /** Moves the split point, and the picture with it; a play in progress stops. */
  const seek = useCallback(
    (to: number) => {
      const target = within(to)
      pause()
      setTime(target)
      const element = videoRef.current
      if (element !== null) element.currentTime = target
    },
    [within, pause],
  )

  // ▶ Play plays on from the split point to Out, the point following the
  // picture: pausing leaves it where you stopped, which is how a moment is
  // found by watching. The step rule is Play trim's, without Loop.
  const tick = useCallback(() => {
    const element = videoRef.current
    if (element === null) return
    const step = playTrimStep(element.currentTime, rangeRef.current, false)
    if (step.kind === 'stop' || (step.kind === 'play' && element.paused)) {
      if (step.kind === 'stop') {
        element.pause()
        element.currentTime = step.at
      }
      setTime(step.at)
      setPlaying(false)
      frameRef.current = null
      return
    }
    setTime(step.at)
    frameRef.current = requestAnimationFrame(tick)
  }, [])

  const play = useCallback(() => {
    const element = videoRef.current
    if (element === null) return
    const start = playTrimStart(timeRef.current, rangeRef.current)
    if (Math.abs(element.currentTime - start) > 0.001) element.currentTime = start
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
    else play()
  }, [playing, pause, play])

  const refusal = (
    refusalAt ?? ((at: number) => (at > entry.inPoint && at < entry.outPoint ? null : 'edge'))
  )(time)
  const splittable = refusal === null
  const apply = () => {
    if (!splittable) return
    pause()
    onApply(time)
  }

  // The window's keys: Escape closes; Space plays and pauses; ← → move the
  // split point by the nudge size, Shift for the jump size — anywhere in the
  // window but a field being typed in, which keeps its own arrows.
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
        if (targetClaimsKeys(event.target)) return
        event.preventDefault()
        togglePlay()
        return
      }
      if (targetEditsText(event.target)) return
      const size = event.shiftKey ? largeStepSeconds : stepSeconds
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        seek(timeRef.current - size)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        seek(timeRef.current + size)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, pause, togglePlay, seek, stepSeconds, largeStepSeconds])

  // ── The strip ─────────────────────────────────────────────────────────
  const timeAtPointer = (event: { clientX: number }) => {
    const box = stripRef.current?.getBoundingClientRect()
    if (box === undefined || box.width <= 0) return entry.inPoint
    return timeAtStripFraction((event.clientX - box.left) / box.width, duration)
  }
  // A press anywhere on the strip — the grip included — moves the point
  // there, and a drag carries it along.
  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    stripRef.current?.setPointerCapture?.(event.pointerId)
    setDragging(true)
    seek(timeAtPointer(event))
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    seek(timeAtPointer(event))
  }
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    stripRef.current?.releasePointerCapture?.(event.pointerId)
    setDragging(false)
  }

  const percent = (at: number) => `${stripFraction(at, duration) * 100}%`
  const inAt = percent(entry.inPoint)
  const outAt = percent(entry.outPoint)

  return (
    <div className="dialog-overlay">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        className="dialog trim-dialog split-dialog"
        data-testid="split-dialog"
      >
        <div className="trim-header">
          <h3 id={headingId}>Split {position}</h3>
          <button
            type="button"
            aria-label="Close the Split window without splitting"
            title="Close without splitting (Esc)"
            onClick={() => {
              pause()
              onClose()
            }}
          >
            ✕
          </button>
        </div>

        {audioOnly ? (
          // An audio track (#826): no picture, so no preview box, as in the
          // Trim window's mode for tracks (#711). The element has no
          // controls and takes no room; the window's own buttons play it.
          <audio
            ref={videoRef as RefObject<HTMLAudioElement>}
            data-testid="split-audio"
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
              data-testid="split-video"
              src={url}
              playsInline
              preload="auto"
              // Firefox drops a seek made while an element has only its
              // metadata (#615): apply the point again once a frame is there.
              onLoadedData={(event) => {
                if (!playing) event.currentTarget.currentTime = timeRef.current
              }}
              onEnded={() => setPlaying(false)}
            />
          </div>
        )}
        <p className="trim-position" data-testid="split-position">
          <output aria-label="Split point">{formatTrimTime(time)}</output> /{' '}
          {formatTrimTime(duration)}
        </p>

        <div
          ref={stripRef}
          className={`trim-strip${audioOnly ? ' trim-strip-audio' : ''}${dragging ? ' trim-strip-dragging' : ''}`}
          data-testid="split-strip"
          onPointerDown={beginDrag}
          onPointerMove={onPointerMove}
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
            role="slider"
            tabIndex={0}
            className={`split-point${splittable ? '' : ' split-point-refused'}`}
            data-testid="split-point"
            aria-label="Split point"
            aria-valuemin={entry.inPoint}
            aria-valuemax={entry.outPoint}
            aria-valuenow={time}
            aria-valuetext={`${formatTrimTime(time)} into the clip`}
            style={{ left: percent(time) }}
          />
        </div>
        <div className="trim-strip-labels" aria-hidden="true">
          <span>In {formatTrimTime(entry.inPoint)}</span>
          <span>Out {formatTrimTime(entry.outPoint)}</span>
        </div>

        <div className="trim-transport" role="group" aria-label="Split playback">
          {/* An audio track has no frames to step by (#826, as #711). */}
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
            aria-label={playing ? 'Pause' : 'Play from the split point'}
            title={playing ? 'Pause (Space)' : 'Play on from the split point (Space)'}
            onClick={togglePlay}
          >
            {playing ? '⏸ Pause' : '▶ Play'}
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

        {/* What Apply will leave: the two parts' lengths, in the clip's own
            seconds, or why it cannot split here. */}
        <p className="split-parts" data-testid="split-parts" role="status">
          {refusal === null
            ? `First part ${formatTrimTime(time - entry.inPoint)} · second part ${formatTrimTime(entry.outPoint - time)}`
            : refusal === 'transition'
              ? 'It cannot split inside a transition, where two clips play.'
              : 'Move the split point inside the clip: it cannot split on In or Out.'}
        </p>

        <div className="trim-footer">
          <span className="trim-fields">
            <label>
              <span>Split at</span>
              <TrimField
                label="Split point in seconds"
                value={time}
                max={duration}
                onCommit={(asked) => seek(asked)}
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
            <button type="button" className="split-apply" disabled={!splittable} onClick={apply}>
              Apply
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}
