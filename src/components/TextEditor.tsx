import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  TEXT_HANDLES,
  rectGuides,
  textAfterGesture,
  textAfterKeyStep,
  textBlockRect,
  textBlockShape,
  textEditorSequenceTime,
  textFrameKey,
} from '../lib/frameEditor'
import type { FrameRect, RectGesture, RectKeyStep, TextPlacement } from '../lib/frameEditor'
import type { snapshotTimelineFrame } from '../lib/frameSnapshot'
import { measureTextWidth } from '../lib/textMeasure'
import type { TextMeasurer } from '../lib/textMeasure'
import type { TextOverlay } from '../lib/textOverlay'
import type { TimelineState } from '../lib/timeline'
import { FrameEditor } from './FrameEditor'

/**
 * The visual text overlay editor (#424, from #402's design D4 / #396): the
 * overlay's rendered block drawn as a rectangle on a still of the frame it
 * sits over, moved by dragging it, scaled from its one corner, with the
 * centre and size mirrored live beneath. One `text-updated` per gesture, on
 * release — one undo step — through the same callback the row's number
 * fields use, so the two never disagree about the stored placement.
 *
 * It is the fourth editor on the same `FrameEditor` (#413/#421 zoom, #422
 * placement, #423 crop) and reuses their vocabulary: the same snapping with
 * an Alt bypass (#391's convention), the same arrow-key nudges each their
 * own undo step, the same inline panel under the row it edits.
 *
 * Two things are the text's own. **Nothing is bypassed**: the text is what
 * is being placed, so the still shows it, and a committed drag re-renders
 * the still with the text in its new place (`textFrameKey`). And the box is
 * **measured, not stored**: a text overlay is a centre and a type size, and
 * its width is whatever the widest line comes out as under its font — so
 * the block's shape is measured with the export's own font string, at the
 * still's own pixel size once that is known, and the handles sit on the
 * text the still shows rather than on an estimate (`textBlockShape`).
 */

const format = (value: number) => String(Math.round(value * 100) / 100)

/**
 * The frame the block is measured at until the still has loaded and said
 * its real size (`FrameEditor`'s `onFrame`). Text scales linearly with its
 * type size, so only the aspect matters to the measurement, and 16:9 is the
 * editor's own fallback aspect; the box is re-measured the moment the still
 * arrives, before any drag can begin on a wrong one.
 */
const FALLBACK_FRAME = { width: 1920, height: 1080 }

interface TextEditorProps {
  timeline: TimelineState
  text: TextOverlay
  /** The row's position string, so labels match the fields'. */
  position: string
  /** Commits a placement change — the row's own `set`, over the three fields. */
  onUpdate: (placement: TextPlacement) => void
  onClose: () => void
  /** Injectable for tests (see FrameEditor). */
  snapshot?: typeof snapshotTimelineFrame
  /** Injectable for tests: jsdom has no canvas to measure text on. */
  measure?: TextMeasurer
}

export function TextEditor({
  timeline,
  text,
  position,
  onUpdate,
  onClose,
  snapshot,
  measure = measureTextWidth,
}: TextEditorProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const hintId = useId()
  const [frame, setFrame] = useState(FALLBACK_FRAME)
  // The placement mid-drag; null when the stored one is what to show.
  const [live, setLive] = useState<TextPlacement | null>(null)
  // What the last `applyGesture` produced. `FrameEditor` speaks rectangles,
  // and reading a centre and a size back off one would round a typed value
  // the gesture never touched — so the placement itself is kept here and
  // the rectangle the editor hands back is only ever its drawing.
  const pendingRef = useRef<TextPlacement | null>(null)

  const stored: TextPlacement = { x: text.x, y: text.y, size: text.size }
  const shape = useMemo(
    () => textBlockShape(text, frame, measure),
    // Everything the measurement reads, by value; `text` itself changes
    // identity on every edit, position included, which is not a re-measure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text.content, text.font, text.size, text.bold, text.italic, frame, measure],
  )
  const shown = live ?? stored
  const rect = textBlockRect(shown, shape)

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  const applyGesture = (_start: FrameRect, gesture: RectGesture): FrameRect => {
    // A gesture always begins from the stored placement: `live` is null
    // until the first move, and the commit on release clears it again.
    const next = textAfterGesture(stored, gesture, shape)
    pendingRef.current = next
    return textBlockRect(next, shape)
  }

  const commit = (next: TextPlacement) => {
    if (next.x !== stored.x || next.y !== stored.y || next.size !== stored.size) onUpdate(next)
  }

  const handleKeyStep = (step: RectKeyStep) => commit(textAfterKeyStep(stored, step, shape))

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
      className="effect-editor text-editor"
      data-testid="text-editor"
      onKeyDown={handleKeyDown}
    >
      <div className="effect-editor-header">
        <span>Text: drag the block to place it, its corner to change the size.</span>
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
        // The text drawn, not bypassed: it is what is being placed.
        timeline={timeline}
        sequenceTime={textEditorSequenceTime(timeline, text)}
        // Every field the draw reads, so a committed move re-renders the
        // still with the text where the box now is.
        frameKey={textFrameKey(text)}
        rect={rect}
        applyGesture={applyGesture}
        onLive={() => {
          if (pendingRef.current !== null) setLive(pendingRef.current)
        }}
        onCommit={() => {
          const next = pendingRef.current
          pendingRef.current = null
          setLive(null)
          if (next !== null) commit(next)
        }}
        onKeyStep={handleKeyStep}
        label={`${position} text block`}
        describedBy={hintId}
        handles={TEXT_HANDLES}
        guides={rectGuides(rect)}
        onFrame={(size) =>
          setFrame((previous) =>
            previous.width === size.width && previous.height === size.height ? previous : size,
          )
        }
        {...(snapshot === undefined ? {} : { snapshot })}
      />
      <p className="effect-editor-readout">
        <span>
          Centre X <output aria-label={`${position} centre X (live)`}>{format(shown.x)}</output>
        </span>
        <span>
          Centre Y <output aria-label={`${position} centre Y (live)`}>{format(shown.y)}</output>
        </span>
        <span>
          Size <output aria-label={`${position} size (live)`}>{format(shown.size)}</output>
        </span>
      </p>
      <p className="effect-editor-hint" id={hintId}>
        Arrow keys nudge the block, Shift for five times as far; + and − change the size by the
        field's own step. Drag the corner to scale the block about its centre, or hold Alt while
        dragging to ignore the guides. Each change is one undo step.
      </p>
    </div>
  )
}
