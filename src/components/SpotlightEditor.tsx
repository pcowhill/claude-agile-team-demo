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
  redactionRect,
  redactionWindow,
  redactionWindowMidpoint,
  regionFromRect,
  regionRectsEqual,
  spotlightFrameKey,
  spotlightResultFrameKey,
  spotlightResultTimeline,
  spotlightSourceTimeline,
} from '../lib/frameEditor'
import type { CropSubject, FrameRect, RectKeyStep } from '../lib/frameEditor'
import type { snapshotTimelineFrame } from '../lib/frameSnapshot'
import type { SpotlightRegion } from '../lib/spotlight'
import { FrameEditor } from './FrameEditor'

/**
 * The visual spotlight editor (#533, part 2 of #531's approved suggestion;
 * the model, fields and rendering are #532's): one region drawn on the
 * element's own source still, moved by dragging inside it and resized from
 * a corner or an edge, with the four percent fields beside it mirroring
 * every drag live. One `…-spotlights-set` per gesture, on release — the
 * whole list, so one undo step — through the same commit the row's own
 * fields use, so the two never disagree about the stored region.
 *
 * It is the redaction editor (#493) over a spotlight, and deliberately so:
 * a spotlight stores the rectangle a redaction stores, so every piece of
 * geometry here is that editor's (`frameEditor.ts`, the spotlight section).
 * Two things differ because the feature differs. The **shade is on** — a
 * spotlight dims the outside, so the editor's dimmed outside is the effect
 * rather than a metaphor for it — and it is cut to the region's **stored
 * shape**: an oval region shows an ellipse inscribed in its box, with the
 * box's corners dimmed, exactly as the frame will have them, while the
 * handles stay on the box because that is what the geometry is. And
 * **Show result** draws every region through `drawSpotlights` — the dim,
 * the shape and the soft edge as the export paints them.
 *
 * Other regions on the same element are drawn as inert outlines of their
 * boxes, so the user sees what is already lit. Rendered inline under the
 * region's rows of fields; Close, Escape, or the row's Adjust button (a
 * toggle) dismiss it.
 */

/** A fraction as the percent its own field shows — two decimals, like the row's. */
const percent = (value: number) => String(Math.round(value * 10000) / 100)
const seconds = (value: number) => `${value.toFixed(2)} s`
const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

interface SpotlightEditorProps {
  /** The entry or overlay whose region this is — the same fields under both names. */
  subject: CropSubject
  /** The element's regions, in stored order; the editor commits the whole list. */
  regions: readonly SpotlightRegion[]
  /** Which of them is being edited. */
  index: number
  /** "Spotlight region 2" — the row's numbering, so labels match the fields'. */
  regionName: string
  /** The row's position string, so labels match the fields'. */
  position: string
  /** Commits the whole list, as the row's own fields do. */
  onCommit: (regions: SpotlightRegion[]) => void
  onClose: () => void
  /** Injectable for tests (see FrameEditor). */
  snapshot?: typeof snapshotTimelineFrame
}

export function SpotlightEditor({
  subject,
  regions,
  index,
  regionName,
  position,
  onCommit,
  onClose,
  snapshot,
}: SpotlightEditorProps) {
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
  // into the current window rather than reset.
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
  // rest (latest wins, #458).
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
  // The siblings' boxes, as they sit on the same oriented picture.
  const outlines = regions
    .filter((_, at) => at !== index)
    .map((other) => redactionRect(other, orientation))
  const oval = region.shape === 'oval'

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
    ? 'the source with every region lit as the viewer gets it. Turn Show result off to adjust the region.'
    : `drag the ${oval ? 'oval' : 'region'} to move it, a corner or an edge of its box to resize it.`

  return (
    <div
      role="dialog"
      aria-label={`Adjust ${regionName} of ${position}`}
      className="effect-editor spotlight-editor"
      data-testid="spotlight-editor"
      onKeyDown={handleKeyDown}
    >
      <div className="effect-editor-header">
        <span>
          {regionName}: {guidance}
        </span>
        <button
          ref={closeRef}
          type="button"
          aria-label={`Close the spotlight editor for ${position}`}
          title="Close (Esc)"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <FrameEditor
        // The element's own source, uncropped and alone, so the picture
        // fills the frame and a region fraction is a frame fraction; the
        // result view lights the regions on it through the export's painter.
        timeline={
          showResult ? spotlightResultTimeline(subject, regions) : spotlightSourceTimeline(subject)
        }
        // The source's own clock (`spotlightSourceTimeline`): a source
        // second is a sequence second, so the slider's value is the instant.
        sequenceTime={scrub}
        frameKey={
          showResult ? spotlightResultFrameKey(subject, regions) : spotlightFrameKey(subject)
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
        // The dimmed outside IS the effect here, cut to the stored shape: an
        // oval lights its inscribed ellipse and dims the box's own corners.
        shade
        shadeHole={oval ? 'ellipse' : 'rect'}
        {...(oval ? { silhouette: { kind: 'ellipse' as const } } : {})}
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
          // Read-only while the loop drives it, as the zoom editor's is.
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
          data-testid="spotlight-editor-loop"
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
        {oval && !showResult
          ? 'The oval fills the box the handles sit on; a square box draws a circle. '
          : ''}
        {looping ? 'Loop is playing the window; pause it to scrub by hand. ' : ''}
        The window, shape, dim and soften stay in the fields above, and each change is one undo
        step.
      </p>
    </div>
  )
}
