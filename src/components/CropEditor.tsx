import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { cropsEqual } from '../lib/crop'
import type { Crop } from '../lib/crop'
import {
  CROP_BOUNDS,
  CROP_HANDLES,
  cropAfterGesture,
  cropEditorSequenceTime,
  cropFrameKey,
  cropFromRect,
  cropRect,
  cropSourceTimeline,
  rectAfterKeyStep,
} from '../lib/frameEditor'
import type { CropSubject, FrameRect, RectKeyStep } from '../lib/frameEditor'
import type { snapshotTimelineFrame } from '../lib/frameSnapshot'
import { FrameEditor } from './FrameEditor'

/**
 * The visual crop editor (#423, from #402's design D4 / #396): the kept
 * region drawn as a rectangle on the element's own source picture, with the
 * trimmed margins dimmed — which is what `FrameEditor`'s shade already is,
 * since everything outside the rectangle is exactly what a crop throws away.
 * The four percent fields beside it mirror every drag live, and one crop
 * action lands per gesture, on release.
 *
 * It is the third editor on the same frame (#413/#421 zoom, #422 placement)
 * and reuses their vocabulary: the same `FrameEditor`, the same Alt bypass
 * (#391's convention), the same arrow-key nudges each their own undo step,
 * the same inline panel under the row it edits.
 *
 * What is the crop's own is the picture underneath. A placement is already a
 * fraction of the output frame; a crop is a fraction of the **source**, and
 * where that source lands inside the frame is not something the model can
 * say (see `cropSourceTimeline`). So this editor draws the element alone,
 * uncropped, filling the frame — and a crop fraction is then a frame
 * fraction with no mapping. The one mapping that remains is orientation's:
 * crop applies before it, so on a turned clip the displayed left edge is a
 * different stored edge, which `sourceCropEdge` resolves and the readout
 * below reports honestly rather than quietly renaming.
 */

/** A fraction as the percent its own field shows — two decimals, like the row's. */
const percent = (value: number) => String(Math.round(value * 10000) / 100)

interface CropEditorProps {
  /** The entry or overlay being cropped — the same fields under both names. */
  subject: CropSubject
  /** The row's position string, so labels match the fields'. */
  position: string
  /** Commits the whole crop, as the row's own fields do; `{}` is the reset. */
  onCommit: (crop: Crop) => void
  onClose: () => void
  /** Injectable for tests (see FrameEditor). */
  snapshot?: typeof snapshotTimelineFrame
}

export function CropEditor({ subject, position, onCommit, onClose, snapshot }: CropEditorProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const hintId = useId()
  // The rectangle mid-drag; null when the stored crop is what to show.
  const [live, setLive] = useState<FrameRect | null>(null)
  const orientation = subject.orientation
  const stored = cropRect(subject.crop, orientation)
  const shown = live ?? stored
  const shownCrop = cropFromRect(shown, orientation)

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  const commit = (rect: FrameRect) => {
    const next = cropFromRect(rect, orientation)
    // The reducer would refuse an unchanged crop anyway; refusing it here
    // keeps a gesture that landed back where it started from looking like an
    // edit at all.
    if (!cropsEqual(next, subject.crop)) onCommit(next)
  }

  const handleKeyStep = (step: RectKeyStep) => commit(rectAfterKeyStep(stored, step, CROP_BOUNDS))

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
      aria-label={`Adjust the crop of ${position}`}
      className="effect-editor crop-editor"
      data-testid="crop-editor"
      onKeyDown={handleKeyDown}
    >
      <div className="effect-editor-header">
        <span>Crop: drag an edge to trim it, Shift to trim the opposite edge as far.</span>
        <button
          type="button"
          aria-label={`Reset crop of ${position} in the editor`}
          disabled={subject.crop === undefined}
          onClick={() => onCommit({})}
        >
          Reset
        </button>
        <button
          ref={closeRef}
          type="button"
          aria-label={`Close the crop editor for ${position}`}
          title="Close (Esc)"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <FrameEditor
        // The element's own source, uncropped and alone, so the picture
        // fills the frame and a crop fraction is a frame fraction.
        timeline={cropSourceTimeline(subject)}
        sequenceTime={cropEditorSequenceTime(subject)}
        // Keyed on the orientation as well as the element: a crop cannot
        // change this picture, but a rotation both turns it and moves which
        // stored edge each handle trims.
        frameKey={cropFrameKey(subject)}
        rect={shown}
        applyGesture={cropAfterGesture}
        onLive={setLive}
        onCommit={(rect) => {
          setLive(null)
          commit(rect)
        }}
        onKeyStep={handleKeyStep}
        label={`${position} kept region`}
        describedBy={hintId}
        handles={CROP_HANDLES}
        {...(snapshot === undefined ? {} : { snapshot })}
      />
      <p className="effect-editor-readout">
        <span>
          Left <output aria-label={`${position} crop left (live)`}>{percent(shownCrop.left ?? 0)}</output>%
        </span>
        <span>
          Right <output aria-label={`${position} crop right (live)`}>{percent(shownCrop.right ?? 0)}</output>%
        </span>
        <span>
          Top <output aria-label={`${position} crop top (live)`}>{percent(shownCrop.top ?? 0)}</output>%
        </span>
        <span>
          Bottom <output aria-label={`${position} crop bottom (live)`}>{percent(shownCrop.bottom ?? 0)}</output>%
        </span>
      </p>
      <p className="effect-editor-hint" id={hintId}>
        {orientation === undefined
          ? ''
          : 'The picture is shown turned, and crop applies before that (#255), so an edge you drag may be named for the source edge it really trims. '}
        Arrow keys nudge the kept region, Shift for five times as far; + and − resize it. Hold
        Shift while dragging an edge to trim the opposite one as far, or Alt while dragging for
        finer values than whole percents. Each change is one undo step.
      </p>
    </div>
  )
}
