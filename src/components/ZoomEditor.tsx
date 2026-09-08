import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  ZOOM_SCRUB_STEP,
  withoutZoom,
  zoomAfterGesture,
  zoomAfterKeyStep,
  zoomEditorSequenceTime,
  zoomEnvelope,
  zoomFromRect,
  zoomGuides,
  zoomHoldMidpoint,
  zoomIsFullAt,
  zoomRect,
  zoomRectAt,
} from '../lib/frameEditor'
import type { FrameRect, RectGesture, RectKeyStep } from '../lib/frameEditor'
import type { snapshotTimelineFrame } from '../lib/frameSnapshot'
import type { TimelineState, ZoomEffect, ZoomSpec } from '../lib/timeline'
import { FrameEditor } from './FrameEditor'

/**
 * The visual Zoom editor (#413 and #421, from #402 / #396): the zoom's
 * region drawn on a still of the unzoomed frame, moved by dragging inside it
 * and magnified by dragging a corner, with the numbers mirrored live
 * beneath. One `zoom-updated` per gesture, on release — one undo step —
 * through the same `onUpdate` the row's number fields use, so the two never
 * disagree about the stored value.
 *
 * #421 adds the rest of #402's design D2-b/D3: a scrub slider across the
 * zoom's whole envelope, so the motion can be seen without playing; guides
 * the centre snaps to (Alt bypasses, as #391's playhead does); arrow-key
 * nudges and `+` / `−` scale steps, each its own undo step; and a **Show
 * result** toggle that draws the frame the viewer will get instead of the
 * region on the source.
 *
 * Rendered inline under the zoom's row of fields rather than floating: it
 * is then anchored to exactly the row it edits, overlaps nothing, and needs
 * no viewport arithmetic inside the timeline's scrolling panel. Close,
 * Escape, or the row's Adjust button (a toggle) dismiss it.
 */

const format = (value: number) => String(Math.round(value * 1000) / 1000)
const seconds = (value: number) => `${value.toFixed(2)} s`
const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

interface ZoomEditorProps {
  timeline: TimelineState
  entryIndex: number
  zoom: ZoomEffect
  /** "Zoom 1" — the row's numbering, so labels match the fields'. */
  zoomName: string
  /** The row's position string, so labels match the fields'. */
  position: string
  onUpdate: (zoom: ZoomSpec) => void
  onClose: () => void
  /** Injectable for tests (see FrameEditor). */
  snapshot?: typeof snapshotTimelineFrame
}

const specOf = ({ start, rampIn, hold, rampOut, scale, centerX, centerY }: ZoomSpec): ZoomSpec => ({
  start,
  rampIn,
  hold,
  rampOut,
  scale,
  centerX,
  centerY,
})

export function ZoomEditor({
  timeline,
  entryIndex,
  zoom,
  zoomName,
  position,
  onUpdate,
  onClose,
  snapshot,
}: ZoomEditorProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const hintId = useId()
  // The spec mid-drag; null when the stored one is what to show.
  const [live, setLive] = useState<ZoomSpec | null>(null)
  // Where along the envelope the still is taken, in seconds into the entry —
  // the clock `zoom.start` is in. Opens at the hold midpoint, which is what
  // #413 showed before there was anywhere else to be.
  const [scrubbed, setScrubbed] = useState(() => zoomHoldMidpoint(zoom))
  const [showResult, setShowResult] = useState(false)
  const stored = specOf(zoom)
  const shown = live ?? stored
  // Timing is edited in the row's fields while the editor is open, so the
  // envelope can move under the slider; the stored position is kept and read
  // through the current envelope rather than reset, so a timing tweak does
  // not throw away where the user was looking.
  const envelope = zoomEnvelope(stored)
  const scrub = clamp(scrubbed, envelope.start, envelope.end)
  const atFullZoom = zoomIsFullAt(stored, scrub)
  const interactive = !showResult && atFullZoom
  // What the panel is showing, said once. The header carried a standing
  // "drag the region" instruction until #421 gave the editor two states
  // where dragging is not offered, and an instruction that is false half
  // the time is worse than none.
  const guidance = showResult
    ? 'the frame the viewer gets at this instant. Turn Show result off to adjust the region.'
    : atFullZoom
      ? 'drag the region to move it, a corner to change the magnification.'
      : 'the region part-way through a ramp, so it cannot be dragged. Scrub back into the hold to adjust it.'

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  const applyGesture = (start: FrameRect, gesture: RectGesture): FrameRect =>
    zoomRect(zoomAfterGesture({ ...stored, ...zoomFromRect(start) }, gesture))

  const specFromRect = (rect: FrameRect): ZoomSpec => ({ ...stored, ...zoomFromRect(rect) })

  const commit = (next: ZoomSpec) => {
    if (
      next.scale !== stored.scale ||
      next.centerX !== stored.centerX ||
      next.centerY !== stored.centerY
    ) {
      onUpdate(next)
    }
  }

  const handleKeyStep = (step: RectKeyStep) => commit(zoomAfterKeyStep(stored, step))

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    // Ours, not the source preview's or a dialog's.
    event.stopPropagation()
    onClose()
  }

  return (
    <div
      role="dialog"
      aria-label={`Adjust ${zoomName} of ${position}`}
      className="zoom-editor"
      data-testid="zoom-editor"
      onKeyDown={handleKeyDown}
    >
      <div className="zoom-editor-header">
        <span>
          {zoomName}: {guidance}
        </span>
        <button
          ref={closeRef}
          type="button"
          aria-label={`Close the ${zoomName} editor`}
          title="Close (Esc)"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <FrameEditor
        // The result view draws the zoom; the editing view draws the source
        // the zoom will crop into, so the region shows what it will fill.
        timeline={showResult ? timeline : withoutZoom(timeline, zoom.id)}
        sequenceTime={zoomEditorSequenceTime(timeline, entryIndex, stored, scrub)}
        // The editing still is the source with this zoom taken out, so a
        // committed drag cannot change it and the key stays the zoom's id.
        // The result still is the zoom applied, so there the committed
        // values belong in the key — otherwise the preview would go stale
        // the moment it was used.
        frameKey={
          showResult
            ? `${zoom.id}:result:${format(stored.scale)}:${format(stored.centerX)}:${format(stored.centerY)}`
            : zoom.id
        }
        rect={zoomRectAt(shown, scrub)}
        applyGesture={applyGesture}
        onLive={(rect) => setLive(specFromRect(rect))}
        onCommit={(rect) => {
          const next = specFromRect(rect)
          setLive(null)
          commit(next)
        }}
        onKeyStep={handleKeyStep}
        label={`${zoomName} region of ${position}`}
        describedBy={hintId}
        showRegion={!showResult}
        interactive={interactive}
        guides={zoomGuides(shown)}
        {...(snapshot === undefined ? {} : { snapshot })}
      />
      <div className="zoom-editor-scrub">
        <span>Preview</span>
        <input
          type="range"
          aria-label={`Preview time of ${zoomName} of ${position} in seconds`}
          min={envelope.start}
          max={envelope.end}
          step={ZOOM_SCRUB_STEP}
          value={scrub}
          onChange={(event) => setScrubbed(Number(event.target.value))}
        />
        <output aria-label={`${zoomName} preview time (live)`}>{seconds(scrub)}</output>
        <label className="zoom-editor-result">
          <input
            type="checkbox"
            checked={showResult}
            onChange={(event) => setShowResult(event.target.checked)}
          />
          Show result
        </label>
      </div>
      <p className="zoom-editor-readout">
        <span>
          Scale ×
          <output aria-label={`${zoomName} scale (live)`}>{format(shown.scale)}</output>
        </span>
        <span>
          Centre X <output aria-label={`${zoomName} centre X (live)`}>{format(shown.centerX)}</output>
        </span>
        <span>
          Centre Y <output aria-label={`${zoomName} centre Y (live)`}>{format(shown.centerY)}</output>
        </span>
      </p>
      <p className="zoom-editor-hint" id={hintId}>
        {interactive
          ? 'Arrow keys nudge the region, Shift for five times as far; + and − change the magnification. Hold Alt while dragging to ignore the guides. '
          : ''}
        Timing stays in the fields above, and each change is one undo step.
      </p>
    </div>
  )
}
