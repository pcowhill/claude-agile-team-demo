import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { targetEditsText } from '../lib/history'
import { targetClaimsKeys } from '../lib/transport'
import {
  clampIn,
  clampOut,
  formatTrimTime,
  frameStep,
  keptLength,
  playTrimStart,
  playTrimStep,
  sourceTime,
  stripFraction,
  timeAtStripFraction,
} from '../lib/trim'
import type { TrimRange } from '../lib/trim'
import { trimFramesFor } from '../lib/trimFrames'
import { AudioWaveform } from './AudioWaveform'
import './dialog.css'
import './TrimDialog.css'

interface TrimDialogProps {
  /** The sequence entry being trimmed: its source and its current trim. */
  entry: { name: string; url: string; duration: number; inPoint: number; outPoint: number }
  /** "clip.webm at position 2": the row's own wording, so the title matches its fields'. */
  position: string
  /** The clamps' arrow steps: the nudge and jump sizes from Settings. */
  stepSeconds: number
  largeStepSeconds: number
  /** Apply: the new In and Out, as one `entry-trimmed`, so one undo step. */
  onApply: (inPoint: number, outPoint: number) => void
  /** Cancel, ✕ and Escape: close, changing nothing. */
  onClose: () => void
  /**
   * Called once as the window opens (#722): the app pauses its preview here,
   * so the sequence does not play on, unseen and unpausable, behind the
   * modal. Nothing resumes it on closing.
   */
  onOpen?: () => void
  /** Injectable for tests (jsdom has no Web Audio or blob fetch). */
  peaksFor?: Parameters<typeof AudioWaveform>[0]['peaksFor']
  /** The strip's frame row (#708); injectable for tests, as `peaksFor` is. */
  framesFor?: (url: string, duration: number) => Promise<(string | null)[]>
}

type Grip = 'in' | 'out' | 'playhead'

/**
 * The Trim window (#707, from the approved design #703 for the customer's
 * #701, PowerPoint's *Trim Video*): the raw source clip at the top, the
 * whole clip as a strip under it with a row of its frames (#708) over its
 * waveform, an In and an Out clamp
 * to drag, and buttons that play only the kept part.
 *
 * **Nothing changes until Apply** (#703 question 2): the clamps are this
 * window's own state, and Apply hands both to the row's `onTrimEntry` at
 * once — one `entry-trimmed`, one undo step. Cancel, ✕ and Escape drop
 * them.
 *
 * **The preview is the raw clip** (#703 question 4): this window's own
 * `<video>`, cued from the entry's URL, with no effects, so a crop or zoom
 * cannot hide what is at the edges. Nothing it does reaches the sequence's
 * player.
 *
 * **Its keys are its own.** It is a `role="dialog"` with `aria-modal`, the
 * rule every app-wide key handler already stands down for
 * (`modalDialogOpen`), so I and O here move the clamps and never set the
 * sequence's export marks behind it.
 */
export function TrimDialog({
  entry,
  position,
  stepSeconds,
  largeStepSeconds,
  onApply,
  onClose,
  onOpen,
  peaksFor,
  framesFor = trimFramesFor,
}: TrimDialogProps) {
  const { duration, url } = entry
  const headingId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const [range, setRange] = useState<TrimRange>({ inPoint: entry.inPoint, outPoint: entry.outPoint })
  // The playhead: where the preview is, in source seconds. It opens on In.
  const [time, setTime] = useState(entry.inPoint)
  const [playing, setPlaying] = useState(false)
  const [looping, setLooping] = useState(false)
  const [grip, setGrip] = useState<Grip | null>(null)
  // The rAF tick reads the live values through refs, as the players do.
  const rangeRef = useRef(range)
  rangeRef.current = range
  const loopRef = useRef(looping)
  loopRef.current = looping
  const timeRef = useRef(time)
  timeRef.current = time
  const frameRef = useRef<number | null>(null)

  const stopTicking = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
  }, [])
  useEffect(() => stopTicking, [stopTicking])

  // The strip's frames (#708), decoded in the background and cached per
  // clip. Nothing waits for them: until they arrive the strip is its bar,
  // and the clamps, playhead and buttons already work (#703 §5).
  const [frames, setFrames] = useState<(string | null)[] | null>(null)
  useEffect(() => {
    let stale = false
    void framesFor(url, duration).then((captured) => {
      if (!stale) setFrames(captured)
    })
    return () => {
      stale = true
    }
  }, [framesFor, url, duration])

  // Focus starts on the window itself, so Space plays at once rather than
  // pressing whichever button would otherwise hold the focus.
  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  // The preview behind the window stops as it opens (#722), once: only the
  // opening is the moment, so a new onOpen identity on a later render must
  // not pause it again.
  useEffect(() => {
    onOpen?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pause = useCallback(() => {
    stopTicking()
    videoRef.current?.pause()
    setPlaying(false)
  }, [stopTicking])

  /**
   * Moves the playhead, and the picture with it. A seek stops a play in
   * progress: whatever moved the playhead is now what the window shows.
   */
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
    const step = playTrimStep(element.currentTime, rangeRef.current, loopRef.current)
    if (step.kind === 'stop') {
      element.pause()
      element.currentTime = step.at
      setTime(step.at)
      setPlaying(false)
      frameRef.current = null
      return
    }
    if (step.kind === 'wrap') {
      element.currentTime = step.seekTo
      // At the clip's very end the element has ended, and a seek alone does
      // not restart it.
      if (element.paused) void element.play().catch(() => undefined)
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

  const playTrim = useCallback(() => {
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
    else playTrim()
  }, [playing, pause, playTrim])

  const setIn = useCallback(
    (asked: number) => {
      const inPoint = clampIn(asked, rangeRef.current, duration)
      setRange((current) => ({ ...current, inPoint }))
      return inPoint
    },
    [duration],
  )
  const setOut = useCallback(
    (asked: number) => {
      const outPoint = clampOut(asked, rangeRef.current, duration)
      setRange((current) => ({ ...current, outPoint }))
      return outPoint
    },
    [duration],
  )
  // Set In here / Set Out here: the clamp moves to the playhead. The
  // playhead stays: it is already where the clamp was asked to go, unless
  // the minimum stopped the clamp short.
  const setInHere = useCallback(() => setIn(timeRef.current), [setIn])
  const setOutHere = useCallback(() => setOut(timeRef.current), [setOut])

  const apply = () => {
    pause()
    onApply(range.inPoint, range.outPoint)
  }

  // The window's keys (#707): Escape closes; Space plays and pauses; I and O
  // set the clamps. Listened for on the document, as the other dialogs do,
  // so they work wherever the focus is inside the window — except in a
  // field you are typing into, and Space on a button or field, which is
  // that control's own key.
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
      const key = event.key.toLowerCase()
      if (key === 'i') {
        event.preventDefault()
        setInHere()
      } else if (key === 'o') {
        event.preventDefault()
        setOutHere()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, pause, togglePlay, setInHere, setOutHere])

  // ── The strip ─────────────────────────────────────────────────────────
  const timeAtPointer = (event: { clientX: number }) => {
    const box = stripRef.current?.getBoundingClientRect()
    if (box === undefined || box.width <= 0) return 0
    return timeAtStripFraction((event.clientX - box.left) / box.width, duration)
  }
  // Dragging a clamp moves the preview to that clamp's time, live, so you
  // see the exact frame the kept part will start or end on.
  const moveGrip = (which: Grip, to: number) => {
    if (which === 'in') seek(setIn(to))
    else if (which === 'out') seek(setOut(to))
    else seek(to)
  }
  const beginDrag = (which: Grip) => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    stripRef.current?.setPointerCapture?.(event.pointerId)
    // A press on a clamp gives it the keyboard too, so ← → carry on from it.
    if (which !== 'playhead') (event.currentTarget as HTMLElement).focus({ preventScroll: true })
    setGrip(which)
    // A press on the bare strip shows that moment at once; a press on a
    // clamp waits for the drag, so a click on one does not nudge it.
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
  // jump size, Home and End to its limits. The preview follows it.
  const clampKeys = (which: 'in' | 'out') => (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const at = which === 'in' ? range.inPoint : range.outPoint
    const size = event.shiftKey ? largeStepSeconds : stepSeconds
    let to: number | null = null
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') to = at - size
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') to = at + size
    else if (event.key === 'Home') to = 0
    else if (event.key === 'End') to = duration
    if (to === null || event.ctrlKey || event.metaKey || event.altKey) return
    event.preventDefault()
    moveGrip(which, to)
  }

  const percent = (at: number) => `${stripFraction(at, duration) * 100}%`
  const inAt = percent(range.inPoint)
  const outAt = percent(range.outPoint)
  const changed = range.inPoint !== entry.inPoint || range.outPoint !== entry.outPoint

  return (
    // No close on a click outside, unlike a confirmation: a clamp dragged
    // past the window's edge ends outside it, and must not throw the trim
    // away. Cancel, ✕ and Escape are the ways out.
    <div className="dialog-overlay">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        className="dialog trim-dialog"
        data-testid="trim-dialog"
      >
        <div className="trim-header">
          <h3 id={headingId}>Trim {position}</h3>
          <button
            type="button"
            aria-label="Close the Trim window without applying"
            title="Close without applying (Esc)"
            onClick={() => {
              pause()
              onClose()
            }}
          >
            ✕
          </button>
        </div>

        <div className="trim-preview">
          <video
            ref={videoRef}
            className="trim-video"
            data-testid="trim-video"
            src={url}
            playsInline
            preload="auto"
            // Firefox drops a seek made while an element has only its
            // metadata (#615), so the playhead is applied again once the
            // first frame is there.
            onLoadedData={(event) => {
              if (!playing) event.currentTarget.currentTime = timeRef.current
            }}
            onEnded={() => {
              if (!loopRef.current) setPlaying(false)
            }}
          />
        </div>
        <p className="trim-position" data-testid="trim-position">
          <output aria-label="Trim window playhead">{formatTrimTime(time)}</output> /{' '}
          {formatTrimTime(duration)}
        </p>

        {/* The whole source, left to right: its waveform, the parts outside
            the clamps dimmed, the clamps, and the playhead. A press on the
            bare strip moves the playhead; a press on a clamp drags it. */}
        <div
          ref={stripRef}
          className={`trim-strip${grip === null ? '' : ' trim-strip-dragging'}`}
          data-testid="trim-strip"
          onPointerDown={beginDrag('playhead')}
          onPointerMove={onStripPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {frames !== null && frames.some((frame) => frame !== null) && (
            <div className="trim-strip-frames" data-testid="trim-frames" aria-hidden="true">
              {frames.map((frame, index) =>
                frame === null ? (
                  <span key={index} className="trim-frame" />
                ) : (
                  <img key={index} className="trim-frame" src={frame} alt="" data-testid="trim-frame" />
                ),
              )}
            </div>
          )}
          <div className="trim-strip-waveform">
            <AudioWaveform
              url={url}
              duration={duration}
              inPoint={0}
              outPoint={duration}
              data-testid="trim-waveform"
              {...(peaksFor === undefined ? {} : { peaksFor })}
            />
          </div>
          <div className="trim-strip-dim" style={{ left: 0, width: inAt }} aria-hidden="true" />
          <div
            className="trim-strip-dim"
            style={{ left: outAt, right: 0 }}
            aria-hidden="true"
          />
          <div
            className="trim-strip-kept"
            data-testid="trim-kept"
            style={{ left: inAt, width: `calc(${outAt} - ${inAt})` }}
            aria-hidden="true"
          />
          <div
            className="trim-playhead"
            data-testid="trim-playhead"
            style={{ left: percent(time) }}
            aria-hidden="true"
          />
          {(['in', 'out'] as const).map((which) => {
            const at = which === 'in' ? range.inPoint : range.outPoint
            return (
              <div
                key={which}
                role="slider"
                tabIndex={0}
                className={`trim-clamp trim-clamp-${which}`}
                data-testid={`trim-clamp-${which}`}
                aria-label={which === 'in' ? 'In clamp' : 'Out clamp'}
                aria-valuemin={which === 'in' ? 0 : clampOut(0, range, duration)}
                aria-valuemax={which === 'in' ? clampIn(duration, range, duration) : duration}
                aria-valuenow={at}
                aria-valuetext={`${formatTrimTime(at)} into the clip`}
                style={{ left: percent(at) }}
                onPointerDown={beginDrag(which)}
                onKeyDown={clampKeys(which)}
              >
                <span aria-hidden="true">{which === 'in' ? '[' : ']'}</span>
              </div>
            )
          })}
        </div>
        <div className="trim-strip-labels" aria-hidden="true">
          <span>In {formatTrimTime(range.inPoint)}</span>
          <span>Out {formatTrimTime(range.outPoint)}</span>
        </div>

        <div className="trim-transport" role="group" aria-label="Trim playback">
          <button type="button" title="Jump the playhead to In" onClick={() => seek(range.inPoint)}>
            ⏮ In
          </button>
          <button
            type="button"
            aria-label="Back one frame"
            title="Back one frame"
            onClick={() => seek(frameStep(timeRef.current, -1, duration))}
          >
            ◀ frame
          </button>
          <button
            type="button"
            className="trim-play"
            aria-label={playing ? 'Pause' : 'Play trim'}
            title={playing ? 'Pause (Space)' : 'Play from In to Out (Space)'}
            onClick={togglePlay}
          >
            {playing ? '⏸ Pause' : '▶ Play trim'}
          </button>
          <button
            type="button"
            aria-label="Forward one frame"
            title="Forward one frame"
            onClick={() => seek(frameStep(timeRef.current, 1, duration))}
          >
            frame ▶
          </button>
          <button type="button" title="Jump the playhead to Out" onClick={() => seek(range.outPoint)}>
            Out ⏭
          </button>
          <button
            type="button"
            className="trim-loop"
            aria-pressed={looping}
            title="Loop: Play trim goes back to In at Out, until you pause it"
            onClick={() => setLooping((on) => !on)}
          >
            ↻ Loop
          </button>
        </div>

        <div className="trim-set">
          <button type="button" title="Move the In clamp to the playhead (I)" onClick={setInHere}>
            Set In here (I)
          </button>
          <span className="trim-kept-length" data-testid="trim-kept-length">
            kept {formatTrimTime(keptLength(range))}
          </span>
          <button type="button" title="Move the Out clamp to the playhead (O)" onClick={setOutHere}>
            Set Out here (O)
          </button>
        </div>

        <div className="trim-footer">
          <span className="trim-fields">
            <label>
              <span>In</span>
              <TrimField
                label="In point to apply in seconds"
                value={range.inPoint}
                max={duration}
                onCommit={(asked) => seek(setIn(asked))}
              />
            </label>
            <label>
              <span>Out</span>
              <TrimField
                label="Out point to apply in seconds"
                value={range.outPoint}
                max={duration}
                onCommit={(asked) => seek(setOut(asked))}
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
            <button type="button" className="trim-apply" disabled={!changed} onClick={apply}>
              Apply
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * The exact In or Out, for typing: the row's field idiom — the unit inside
 * the box, a commit on Enter or blur, and a spinner click in Firefox (which
 * never focuses the box, #593) committing at once. The clamps' rules apply
 * to what is typed, so a value past the other clamp lands the minimum short
 * of it.
 */
function TrimField({
  label,
  value,
  max,
  onCommit,
}: {
  label: string
  value: number
  max: number
  onCommit: (value: number) => void
}) {
  const text = String(value)
  const [draft, setDraft] = useState(text)
  useEffect(() => setDraft(text), [text])
  const commitText = (typed: string) => {
    const parsed = Number(typed)
    if (typed.trim() !== '' && Number.isFinite(parsed) && parsed !== value) onCommit(parsed)
    setDraft(text)
  }
  return (
    <span className="timeline-unit-box">
      <input
        type="number"
        inputMode="decimal"
        className="timeline-unit-input"
        aria-label={label}
        min={0}
        max={max}
        step={0.1}
        value={draft}
        onChange={(event) => {
          if (document.activeElement !== event.currentTarget) commitText(event.target.value)
          else setDraft(event.target.value)
        }}
        onBlur={() => commitText(draft)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
      <span className="timeline-unit" aria-hidden="true">
        s
      </span>
    </span>
  )
}
