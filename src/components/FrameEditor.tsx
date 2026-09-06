import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { snapshotTimelineFrame } from '../lib/frameSnapshot'
import type { Corner, FrameRect, RectGesture } from '../lib/frameEditor'
import type { TimelineState } from '../lib/timeline'
import './FrameEditor.css'

/**
 * The frame editor (#413, from #402 / #396): a still of the composed frame
 * with a draggable rectangle on it. The snapshot is the export's own draw
 * (`snapshotTimelineFrame`, #237), rendered **once when the editor opens**
 * — never during a drag — and shown at the output frame's aspect.
 *
 * The rectangle is generic: this component measures pointers, reports a
 * gesture (a move by an offset, or a corner dragged to a point, both as
 * frame fractions) and draws whatever rectangle the caller's *handle model*
 * (`applyGesture`) returns for it. The zoom editor's model keeps the aspect
 * locked and the region inside the frame; later editors (overlay placement,
 * crop, text) bring their own. Live values flow through `onLive` while the
 * pointer is down; `onCommit` fires once, on release, so a drag is one edit.
 */

const CORNERS: readonly Corner[] = ['nw', 'ne', 'sw', 'se']
/** Handle size in CSS pixels — the target a fingertip or a pointer can hit. */
const HANDLE = 12

interface FrameEditorProps {
  timeline: TimelineState
  /** The instant to render — the caller's choice (a zoom's hold midpoint). */
  sequenceTime: number
  /**
   * Re-renders the snapshot only when this changes. The timeline itself is
   * deliberately not a trigger: a committed drag changes it, and the
   * editor's picture (with the edited effect bypassed) does not.
   */
  frameKey: string
  rect: FrameRect
  /** The handle model: the rectangle a gesture that began at `start` yields. */
  applyGesture: (start: FrameRect, gesture: RectGesture) => FrameRect
  onLive?: (rect: FrameRect) => void
  onCommit: (rect: FrameRect) => void
  /** Accessible name of the rectangle. */
  label: string
  /** Aspect to show until the snapshot arrives (the output frame's, if known). */
  fallbackAspect?: number
  /** Injectable for tests: jsdom has no canvas to compose on. */
  snapshot?: typeof snapshotTimelineFrame
}

interface Drag {
  pointerId: number
  start: FrameRect
  origin: { x: number; y: number }
  corner: Corner | null
  live: FrameRect
}

export function FrameEditor({
  timeline,
  sequenceTime,
  frameKey,
  rect,
  applyGesture,
  onLive,
  onCommit,
  label,
  fallbackAspect = 16 / 9,
  snapshot = snapshotTimelineFrame,
}: FrameEditorProps) {
  const frameRef = useRef<HTMLDivElement>(null)
  const timelineRef = useRef(timeline)
  timelineRef.current = timeline
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aspect, setAspect] = useState(fallbackAspect)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [drag, setDrag] = useState<Drag | null>(null)

  // The still: rendered when the editor opens (or is pointed at another
  // effect), released when it is replaced or the editor closes.
  useEffect(() => {
    let cancelled = false
    let url: string | null = null
    setError(null)
    snapshot(timelineRef.current, sequenceTime)
      .then((blob) => {
        if (cancelled) return
        url = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : null
        setImageUrl(url)
      })
      .catch((reason: unknown) => {
        if (cancelled) return
        setError(reason instanceof Error ? reason.message : 'The frame could not be rendered.')
      })
    return () => {
      cancelled = true
      if (url !== null && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url)
    }
  }, [frameKey, sequenceTime, snapshot])

  // The handle layer is drawn in CSS pixels over the frame, so it tracks
  // the frame's laid-out size (jsdom reports zero: tests stub the box).
  useLayoutEffect(() => {
    const frame = frameRef.current
    if (frame === null) return
    const measure = () => {
      const box = frame.getBoundingClientRect()
      setSize({ width: box.width, height: box.height })
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [aspect, imageUrl])

  const toFraction = (event: ReactPointerEvent) => {
    const box = frameRef.current?.getBoundingClientRect()
    if (box === undefined || box.width === 0 || box.height === 0) return { x: 0, y: 0 }
    return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height }
  }

  const beginDrag = (event: ReactPointerEvent, corner: Corner | null) => {
    if (event.button !== 0) return
    event.preventDefault()
    // Capture on the layer, so the move and release reach it wherever the
    // pointer goes (jsdom has no capture; tests fire on the layer directly).
    ;(event.currentTarget as SVGGraphicsElement).ownerSVGElement?.setPointerCapture?.(
      event.pointerId,
    )
    setDrag({ pointerId: event.pointerId, start: rect, origin: toFraction(event), corner, live: rect })
  }

  const gestureOf = (current: Drag, event: ReactPointerEvent): RectGesture => {
    const point = toFraction(event)
    return current.corner === null
      ? { kind: 'move', dx: point.x - current.origin.x, dy: point.y - current.origin.y }
      : { kind: 'corner', corner: current.corner, x: point.x, y: point.y }
  }

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (drag === null || event.pointerId !== drag.pointerId) return
    const live = applyGesture(drag.start, gestureOf(drag, event))
    setDrag({ ...drag, live })
    onLive?.(live)
  }

  const endDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (drag === null || event.pointerId !== drag.pointerId) return
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    setDrag(null)
    onCommit(drag.live)
  }

  const shown = drag?.live ?? rect
  // Rounded to a hundredth of a pixel: tidy attributes, and fractions like
  // 0.3 − 0.25 do not leave 19.999… in the markup.
  const toPx = (value: number) => Math.round(value * 100) / 100
  const px = {
    x: toPx(shown.x * size.width),
    y: toPx(shown.y * size.height),
    width: toPx(shown.width * size.width),
    height: toPx(shown.height * size.height),
  }
  const cornerPoint = (corner: Corner) => ({
    x: corner.endsWith('w') ? px.x : px.x + px.width,
    y: corner.startsWith('n') ? px.y : px.y + px.height,
  })

  return (
    <div className="frame-editor">
      <div
        ref={frameRef}
        className="frame-editor-frame"
        data-testid="frame-editor-frame"
        style={{ '--frame-editor-aspect': String(aspect) } as CSSProperties}
      >
        {imageUrl !== null && (
          <img
            className="frame-editor-image"
            data-testid="frame-editor-image"
            src={imageUrl}
            alt=""
            draggable={false}
            onLoad={(event) => {
              const { naturalWidth, naturalHeight } = event.currentTarget
              if (naturalWidth > 0 && naturalHeight > 0) setAspect(naturalWidth / naturalHeight)
            }}
          />
        )}
        {imageUrl === null && error === null && (
          <p className="frame-editor-pending" data-testid="frame-editor-pending">
            Rendering the frame…
          </p>
        )}
        {error !== null && (
          <p className="frame-editor-error" role="alert">
            {error}
          </p>
        )}
        <svg
          className={drag === null ? 'frame-editor-handles' : 'frame-editor-handles frame-editor-dragging'}
          data-testid="frame-editor-handles"
          width={size.width}
          height={size.height}
          viewBox={`0 0 ${size.width} ${size.height}`}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {/* Everything outside the rectangle is dimmed: what the effect
              leaves out. Even-odd fill cuts the rectangle out of the frame. */}
          <path
            className="frame-editor-shade"
            fillRule="evenodd"
            d={`M0 0H${size.width}V${size.height}H0Z M${px.x} ${px.y}h${px.width}v${px.height}h${-px.width}Z`}
          />
          <rect
            className="frame-editor-rect"
            data-testid="frame-editor-rect"
            role="img"
            aria-label={label}
            x={px.x}
            y={px.y}
            width={px.width}
            height={px.height}
            onPointerDown={(event) => beginDrag(event, null)}
          />
          {CORNERS.map((corner) => {
            const point = cornerPoint(corner)
            return (
              <rect
                key={corner}
                className={`frame-editor-corner frame-editor-corner-${corner}`}
                data-testid={`frame-editor-corner-${corner}`}
                x={point.x - HANDLE / 2}
                y={point.y - HANDLE / 2}
                width={HANDLE}
                height={HANDLE}
                onPointerDown={(event) => beginDrag(event, corner)}
              />
            )
          })}
        </svg>
      </div>
    </div>
  )
}
