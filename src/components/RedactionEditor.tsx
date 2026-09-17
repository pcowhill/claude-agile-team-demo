import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  REDACTION_HANDLES,
  ZOOM_SCRUB_STEP,
  loopPositionAt,
  loopScrubStop,
  rectGuides,
  redactionAfterGesture,
  redactionAfterKeyStep,
  redactionFrameKey,
  redactionRect,
  redactionResultFrameKey,
  redactionResultTimeline,
  redactionSourceTimeline,
  redactionWindow,
  redactionWindowMidpoint,
  regionFromRect,
  regionRectsEqual,
} from '../lib/frameEditor'
import type { CropSubject, FrameRect, RectKeyStep } from '../lib/frameEditor'
import type { snapshotTimelineFrame } from '../lib/frameSnapshot'
import type { RedactionRegion } from '../lib/redaction'
import { FrameEditor } from './FrameEditor'

/**
 * The visual redaction editor (#493, part 2 of #489's approved suggestion;
 * the model, fields and rendering are #492's): one region drawn as a
 * rectangle on the element's own source still, moved by dragging inside it
 * and resized from a corner or an edge, with the four percent fields beside
 * it mirroring every drag live. One `…-redactions-set` per gesture, on
 * release — the whole list, so one undo step — through the same commit the
 * row's own fields use, so the two never disagree about the stored region.
 *
 * It is the fifth editor on the shared frame (#413/#421 zoom, #422
 * placement, #423 crop, #424 text) and borrows from two of them rather than
 * inventing: the **picture** is the crop editor's — the source alone,
 * uncropped, filling the frame, because a region is a fraction of the
 * source and not of the composed frame, and it maps through orientation
 * exactly as a crop does (`redactionRect`, on `sourceCropEdge`); the
 * **handles** are the overlay editor's free rectangle, with the snapping,
 * the guides and the Alt bypass (#391's convention). What is the region's
 * own is time: a region has a **window** in source seconds, which no other
 * editor's subject has, so the zoom editor's Preview slider and Loop (#421,
 * #425) scrub and play that window rather than a zoom's envelope, and
 * **Show result** draws the regions through `drawRedactions` — the one
 * place this editor renders the treatment instead of an outline.
 *
 * Other regions on the same element are drawn as inert outlines, so the
 * user sees what is already covered; nothing outside the rectangle is
 * shaded, since a redaction hides the inside and a dimmed outside would
 * read as a crop. Rendered inline under the region's rows of fields, as the
 * other editors are under theirs; Close, Escape, or the row's Adjust button
 * (a toggle) dismiss it.
 */

/** A fraction as the percent its own field shows — two decimals, like the row's. */
const percent = (value: number) => String(Math.round(value * 10000) / 100)
const seconds = (value: number) => `${value.toFixed(2)} s`
const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

interface RedactionEditorProps {
  /** The entry or overlay whose region this is — the same fields under both names. */
  subject: CropSubject
  /** The element's regions, in stored order; the editor commits the whole list. */
  regions: readonly RedactionRegion[]
  /** Which of them is being edited. */
  index: number
  /** "Redaction region 2" — the row's numbering, so labels match the fields'. */
  regionName: string
  /** The row's position string, so labels match the fields'. */
  position: string
  /** Commits the whole list, as the row's own fields do. */
  onCommit: (regions: RedactionRegion[]) => void
  onClose: () => void
  /** Injectable for tests (see FrameEditor). */
  snapshot?: typeof snapshotTimelineFrame
}

export function RedactionEditor({
  subject,
  regions,
  index,
  regionName,
  position,
  onCommit,
  onClose,
  snapshot,
}: RedactionEditorProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const hintId = useId()
  const region = regions[index]
  // The rectangle mid-drag; null when the stored region is what to show.
  const [live, setLive] = useState<FrameRect | null>(null)
  const [showResult, setShowResult] = useState(false)
  // Loop (#425's control): session-only, off when the editor opens, and its
  // clock runs in the effect below for exactly as long as this is true.
  const [looping, setLooping] = useState(false)
  const orientation = subject.orientation
  // The window is edited in the row's fields while the editor is open, so
  // it can move under the slider; the scrub position is kept and clamped
  // into the current window rather than reset, so a window tweak does not
  // throw away where the user was looking.
  const span = redactionWindow(
    region ?? { start: 0, end: 0 },
    Math.max(subject.duration, subject.outPoint),
  )
  const [scrubbed, setScrubbed] = useState(() => redactionWindowMidpoint(span))
  const scrub = clamp(scrubbed, span.start, span.end)

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  // The loop's clock (#425): one tick a frame, where the loop is now on the
  // slider's grid into the scrub position, and the still pipeline does the
  // rest (latest wins, #458). The first tick runs at once, so toggling Loop
  // on shows the window's first frame without waiting; the cleanup stops
  // the clock, which is also what closing the editor does.
  useEffect(() => {
    if (!looping) return
    const startedAt = performance.now()
    let handle = 0
    const tick = () => {
      const at = loopPositionAt(performance.now() - startedAt, span.start, span.end)
      setScrubbed(loopScrubStop(at, span.start, span.end))
      handle = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(handle)
  }, [looping, span.start, span.end])

  if (region === undefined) return null

  const stored = redactionRect(region, orientation)
  const shown = live ?? stored
  const shownRegion = regionFromRect(shown, orientation)
  // The siblings, as they sit on the same oriented picture.
  const outlines = regions
    .filter((_, at) => at !== index)
    .map((other) => redactionRect(other, orientation))

  const commit = (rect: FrameRect) => {
    const next = regionFromRect(rect, orientation)
    // The reducer would store an unchanged region again; refusing it here
    // keeps a gesture that landed back where it started from being an edit.
    if (regionRectsEqual(next, region)) return
    onCommit(regions.map((each, at) => (at === index ? { ...each, ...next } : each)))
  }

  const handleKeyStep = (step: RectKeyStep) => commit(redactionAfterKeyStep(stored, step))

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    // Ours, not the source preview's or a dialog's.
    event.stopPropagation()
    onClose()
  }

  const guidance = showResult
    ? 'the source with every region drawn as the viewer gets it. Turn Show result off to adjust the region.'
    : 'drag the region to move it, a corner or an edge to resize it.'

  return (
    <div
      role="dialog"
      aria-label={`Adjust ${regionName} of ${position}`}
      className="effect-editor redaction-editor"
      data-testid="redaction-editor"
      onKeyDown={handleKeyDown}
    >
      <div className="effect-editor-header">
        <span>
          {regionName}: {guidance}
        </span>
        <button
          ref={closeRef}
          type="button"
          aria-label={`Close the redaction editor for ${position}`}
          title="Close (Esc)"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <FrameEditor
        // The element's own source, uncropped and alone, so the picture
        // fills the frame and a region fraction is a frame fraction; the
        // result view draws the regions on it through the export's painter.
        timeline={
          showResult ? redactionResultTimeline(subject, regions) : redactionSourceTimeline(subject)
        }
        // The source's own clock (`redactionSourceTimeline`): a source
        // second is a sequence second, so the slider's value is the instant.
        sequenceTime={scrub}
        frameKey={
          showResult ? redactionResultFrameKey(subject, regions) : redactionFrameKey(subject)
        }
        rect={shown}
        applyGesture={redactionAfterGesture}
        onLive={setLive}
        onCommit={(rect) => {
          setLive(null)
          commit(rect)
        }}
        onKeyStep={handleKeyStep}
        label={`${regionName} area of ${position}`}
        describedBy={hintId}
        showRegion={!showResult}
        interactive={!showResult}
        // A loop lands a frame every few dozen milliseconds; the badge would
        // only flicker over the motion, which is itself the sign of progress.
        showRenderingIndicator={!looping}
        guides={rectGuides(shown)}
        handles={REDACTION_HANDLES}
        // A redaction hides the inside of its rectangle; the outside is the
        // picture the user keeps, and dimming it would read as a crop.
        shade={false}
        outlines={showResult ? [] : outlines}
        {...(snapshot === undefined ? {} : { snapshot })}
      />
      <div className="effect-editor-scrub">
        <span>Preview</span>
        <input
          type="range"
          aria-label={`Preview time of ${regionName} of ${position} in seconds`}
          min={span.start}
          max={span.end}
          step={ZOOM_SCRUB_STEP}
          value={scrub}
          // Read-only while the loop drives it, as the zoom editor's is: a
          // range input has no read-only state, and a thumb the clock keeps
          // taking back would fight the hand. Pausing hands it back.
          disabled={looping}
          onChange={(event) => setScrubbed(Number(event.target.value))}
        />
        <output aria-label={`${regionName} preview time (live)`}>{seconds(scrub)}</output>
        <label className="effect-editor-result">
          <input
            type="checkbox"
            checked={showResult}
            onChange={(event) => setShowResult(event.target.checked)}
          />
          Show result
        </label>
        <button
          type="button"
          className="effect-editor-loop"
          data-testid="redaction-editor-loop"
          aria-pressed={looping}
          aria-label={`Loop the window of ${regionName} of ${position}`}
          title={
            looping
              ? 'Pause the loop, leaving the preview where it is'
              : 'Loop: play the region’s window on repeat, resting a second on its first and last frame'
          }
          onClick={() => setLooping((on) => !on)}
        >
          ↻ Loop
        </button>
      </div>
      <p className="effect-editor-readout">
        <span>
          Left <output aria-label={`${regionName} left (live)`}>{percent(shownRegion.left)}</output>%
        </span>
        <span>
          Top <output aria-label={`${regionName} top (live)`}>{percent(shownRegion.top)}</output>%
        </span>
        <span>
          Width <output aria-label={`${regionName} width (live)`}>{percent(shownRegion.width)}</output>
          %
        </span>
        <span>
          Height{' '}
          <output aria-label={`${regionName} height (live)`}>{percent(shownRegion.height)}</output>%
        </span>
      </p>
      <p className="effect-editor-hint" id={hintId}>
        {orientation === undefined
          ? ''
          : 'The picture is shown turned, and a region is stored in the source’s own space before that, so an edge you drag may move a different stored edge; the readout names the stored value. '}
        {showResult
          ? ''
          : 'Arrow keys nudge the region, Shift for five times as far; + and − resize it. Hold Shift on a corner to keep its proportions, or Alt while dragging to ignore the guides. '}
        {looping ? 'Loop is playing the window; pause it to scrub by hand. ' : ''}
        The window stays in the fields above, and each change is one undo step.
      </p>
    </div>
  )
}
