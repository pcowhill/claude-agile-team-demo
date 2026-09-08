import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  FREE_RECT_HANDLES,
  overlayEditorSequenceTime,
  overlayRect,
  rectAfterGesture,
  rectAfterKeyStep,
  rectGuides,
  withoutOverlay,
} from '../lib/frameEditor'
import type { FrameRect, RectBounds, RectGesture, RectKeyStep } from '../lib/frameEditor'
import type { snapshotTimelineFrame } from '../lib/frameSnapshot'
import type { TimelineState } from '../lib/timeline'
import { MAX_OVERLAY_SIZE, MIN_OVERLAY_SIZE } from '../lib/videoOverlay'
import type { VideoOverlay } from '../lib/videoOverlay'
import { FrameEditor } from './FrameEditor'

/**
 * The visual overlay placement editor (#422, from #402's design D4 / #396):
 * the overlay's rectangle drawn on a still of the frame it sits over, moved
 * by dragging inside it, resized from a corner or an edge, with the four
 * placement numbers mirrored live beneath. One `video-overlay-updated` per
 * gesture, on release — one undo step — through the same callback the row's
 * number fields use, so the two never disagree about the stored placement.
 *
 * It is the Zoom editor's sibling (#413/#421) and reuses its vocabulary
 * rather than a parallel one: the same `FrameEditor`, the same snapping with
 * an Alt bypass (#391's convention), the same arrow-key nudges each their
 * own undo step, the same inline placement under the row it edits. What
 * differs is the handle model, and only that: a zoom's region is
 * aspect-locked and resizes about its centre, while a placement is a free
 * box whose handles hold the opposite edge — see `rectAfterGesture`.
 *
 * Two things are the overlay's own. The still is taken at the middle of the
 * overlay's **own window** rather than the sequence's start, so the picture
 * underneath is the one the overlay is actually over; and this overlay's
 * layer is left out of that still, so the rectangle shows where it will go
 * instead of covering the frame it is being placed against.
 */

const format = (value: number) => String(Math.round(value * 1000) / 1000)

/**
 * The placement bounds the reducer enforces (`clampVideoOverlay`), so the
 * editor cannot propose a rectangle the model would move underneath it.
 */
const BOUNDS: RectBounds = { minSize: MIN_OVERLAY_SIZE, maxSize: MAX_OVERLAY_SIZE }

interface OverlayEditorProps {
  timeline: TimelineState
  overlay: VideoOverlay
  /** The row's position string, so labels match the fields'. */
  position: string
  /** Commits a placement change — the row's own `set`/`setImage`. */
  onUpdate: (rect: { x: number; y: number; width: number; height: number }) => void
  onClose: () => void
  /** Injectable for tests (see FrameEditor). */
  snapshot?: typeof snapshotTimelineFrame
}

export function OverlayEditor({
  timeline,
  overlay,
  position,
  onUpdate,
  onClose,
  snapshot,
}: OverlayEditorProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const hintId = useId()
  // The rectangle mid-drag; null when the stored placement is what to show.
  const [live, setLive] = useState<FrameRect | null>(null)
  const stored = overlayRect(overlay)
  const shown = live ?? stored

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  /**
   * The aspect a Shift-held corner drag keeps: the rectangle's own, as it
   * was when the gesture began.
   *
   * The issue asks for the *clip's* aspect "where known, else the current
   * box's". It is nowhere known here: `LibraryClip` carries `width`/`height`
   * only for still images (probed at import for #137), `Timeline` receives
   * no clip list at all, and an overlay itself stores only its rectangle. So
   * the fallback is the rule in every case rather than in some — which also
   * makes Shift mean what it means in every other editor: keep the
   * proportions I have. Wiring a real source probe would let Shift remove
   * the letterbox gutters an overlay shows inside a mismatched box
   * (`object-fit: contain`, `videoOverlay.ts`); that is a follow-up, not
   * something to fake here.
   */
  const lockRatio = (start: FrameRect) => start.width / start.height

  const applyGesture = (start: FrameRect, gesture: RectGesture): FrameRect =>
    rectAfterGesture(start, gesture, BOUNDS, lockRatio(start))

  const commit = (next: FrameRect) => {
    if (
      next.x !== stored.x ||
      next.y !== stored.y ||
      next.width !== stored.width ||
      next.height !== stored.height
    ) {
      onUpdate(next)
    }
  }

  const handleKeyStep = (step: RectKeyStep) => commit(rectAfterKeyStep(stored, step, BOUNDS))

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
      aria-label={`Adjust the placement of ${position}`}
      className="effect-editor overlay-editor"
      data-testid="overlay-editor"
      onKeyDown={handleKeyDown}
    >
      <div className="effect-editor-header">
        <span>
          Placement: drag the rectangle to move it, a corner or an edge to resize it.
        </span>
        <button
          ref={closeRef}
          type="button"
          aria-label={`Close the placement editor for ${position}`}
          title="Close (Esc)"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <FrameEditor
        // Without this overlay's own layer: the rectangle marks where it
        // will sit, and an overlay drawn over that frame would hide it.
        timeline={withoutOverlay(timeline, overlay.id)}
        sequenceTime={overlayEditorSequenceTime(timeline, overlay)}
        // The still is the frame minus this overlay, so a committed drag
        // cannot change it — the key stays the overlay's id, exactly as the
        // zoom editor's editing still stays keyed on the zoom's.
        frameKey={overlay.id}
        rect={shown}
        applyGesture={applyGesture}
        onLive={setLive}
        onCommit={(rect) => {
          setLive(null)
          commit(rect)
        }}
        onKeyStep={handleKeyStep}
        label={`${position} placement rectangle`}
        describedBy={hintId}
        handles={FREE_RECT_HANDLES}
        guides={rectGuides(shown)}
        {...(overlay.shapeMask === undefined ? {} : { silhouette: overlay.shapeMask })}
        {...(snapshot === undefined ? {} : { snapshot })}
      />
      <p className="effect-editor-readout">
        <span>
          X <output aria-label={`${position} left edge (live)`}>{format(shown.x)}</output>
        </span>
        <span>
          Y <output aria-label={`${position} top edge (live)`}>{format(shown.y)}</output>
        </span>
        <span>
          W <output aria-label={`${position} width (live)`}>{format(shown.width)}</output>
        </span>
        <span>
          H <output aria-label={`${position} height (live)`}>{format(shown.height)}</output>
        </span>
      </p>
      <p className="effect-editor-hint" id={hintId}>
        Arrow keys nudge the rectangle, Shift for five times as far; + and − resize it. Hold Shift
        while dragging a corner to keep its proportions, or Alt while dragging to ignore the guides.
        Timing stays in the fields above, and each change is one undo step.
      </p>
    </div>
  )
}
