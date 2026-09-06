import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  withoutZoom,
  zoomAfterGesture,
  zoomEditorSequenceTime,
  zoomFromRect,
  zoomRect,
} from '../lib/frameEditor'
import type { FrameRect, RectGesture } from '../lib/frameEditor'
import type { snapshotTimelineFrame } from '../lib/frameSnapshot'
import type { TimelineState, ZoomEffect, ZoomSpec } from '../lib/timeline'
import { FrameEditor } from './FrameEditor'

/**
 * The visual Zoom editor (#413, from #402 / #396): the zoom's region drawn
 * on a still of the unzoomed frame at the middle of its hold, moved by
 * dragging inside it and magnified by dragging a corner, with the numbers
 * mirrored live beneath. One `zoom-updated` per gesture, on release — one
 * undo step — through the same `onUpdate` the row's number fields use, so
 * the two never disagree about the stored value.
 *
 * Rendered inline under the zoom's row of fields rather than floating: it
 * is then anchored to exactly the row it edits, overlaps nothing, and needs
 * no viewport arithmetic inside the timeline's scrolling panel. Close,
 * Escape, or the row's Adjust button (a toggle) dismiss it.
 */

const format = (value: number) => String(Math.round(value * 1000) / 1000)

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
  // The spec mid-drag; null when the stored one is what to show.
  const [live, setLive] = useState<ZoomSpec | null>(null)
  const stored = specOf(zoom)
  const shown = live ?? stored

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  const applyGesture = (start: FrameRect, gesture: RectGesture): FrameRect =>
    zoomRect(zoomAfterGesture({ ...stored, ...zoomFromRect(start) }, gesture))

  const specFromRect = (rect: FrameRect): ZoomSpec => ({ ...stored, ...zoomFromRect(rect) })

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
          {zoomName}: drag the region to move it, a corner to change the magnification. The still
          is the middle of the hold.
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
        timeline={withoutZoom(timeline, zoom.id)}
        sequenceTime={zoomEditorSequenceTime(timeline, entryIndex, stored)}
        frameKey={zoom.id}
        rect={zoomRect(shown)}
        applyGesture={applyGesture}
        onLive={(rect) => setLive(specFromRect(rect))}
        onCommit={(rect) => {
          const next = specFromRect(rect)
          setLive(null)
          if (
            next.scale !== stored.scale ||
            next.centerX !== stored.centerX ||
            next.centerY !== stored.centerY
          ) {
            onUpdate(next)
          }
        }}
        label={`${zoomName} region of ${position}`}
        {...(snapshot === undefined ? {} : { snapshot })}
      />
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
      <p className="zoom-editor-hint">
        Timing stays in the fields above. Each drag is one undo step.
      </p>
    </div>
  )
}
