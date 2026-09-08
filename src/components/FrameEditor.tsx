import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { snapshotTimelineFrame } from '../lib/frameSnapshot'
import { rectKeyStep } from '../lib/frameEditor'
import type { Corner, FrameRect, RectGesture, RectKeyStep } from '../lib/frameEditor'
import type { TimelineState } from '../lib/timeline'
import './FrameEditor.css'

/**
 * The frame editor (#413, from #402 / #396): a still of the composed frame
 * with a draggable rectangle on it. The snapshot is the export's own draw
 * (`snapshotTimelineFrame`, #237), rendered when the editor opens and again
 * whenever the caller names a different instant — never during a drag — and
 * shown at the output frame's aspect.
 *
 * The rectangle is generic: this component measures pointers, reports a
 * gesture (a move by an offset, or a corner dragged to a point, both as
 * frame fractions) and draws whatever rectangle the caller's *handle model*
 * (`applyGesture`) returns for it. The zoom editor's model keeps the aspect
 * locked and the region inside the frame; later editors (overlay placement,
 * crop, text) bring their own. Live values flow through `onLive` while the
 * pointer is down; `onCommit` fires once, on release, so a drag is one edit.
 * A key press is its own language (`RectKeyStep`) and commits on its own —
 * one press, one edit (#421).
 */

const CORNERS: readonly Corner[] = ['nw', 'ne', 'sw', 'se']
/** Handle size in CSS pixels — the target a fingertip or a pointer can hit. */
const HANDLE = 12
/**
 * How many rendered stills one editor keeps (#421). Scrubbing an envelope
 * asks for a still per slider stop, and each is a full output-resolution
 * PNG, so the cache is bounded rather than "everything until close": at
 * 1080p a few dozen frames is already hundreds of megabytes. Oldest goes
 * first, and a revisited time inside the window still costs no render.
 */
const STILL_CACHE_LIMIT = 24

interface FrameEditorProps {
  timeline: TimelineState
  /** The instant to render — the caller's choice (a zoom's scrub position). */
  sequenceTime: number
  /**
   * Re-renders the snapshot only when this, or `sequenceTime`, changes. The
   * timeline itself is deliberately not a trigger: a committed drag changes
   * it, and the editor's picture (with the edited effect bypassed) does not.
   * Callers that *do* want the picture to follow an edit — a result preview,
   * which draws the effect rather than bypassing it — say so by putting the
   * committed values in this key.
   */
  frameKey: string
  rect: FrameRect
  /** The handle model: the rectangle a gesture that began at `start` yields. */
  applyGesture: (start: FrameRect, gesture: RectGesture) => FrameRect
  onLive?: (rect: FrameRect) => void
  onCommit: (rect: FrameRect) => void
  /** One key press on the focused rectangle; the caller commits it (#421). */
  onKeyStep?: (step: RectKeyStep) => void
  /** Accessible name of the rectangle. */
  label: string
  /** Id of the text describing how to drive the rectangle, for its focus. */
  describedBy?: string
  /**
   * Whether to draw the region at all (#421). A result preview shows the
   * frame the viewer will see, where the region is the whole picture and
   * drawing it would say nothing.
   */
  showRegion?: boolean
  /**
   * Whether the region responds to a pointer or a key (#421). False leaves
   * it drawn but inert — the state a scrub part-way through a ramp is in,
   * where the rectangle shows the motion and no drag on it has a meaning.
   */
  interactive?: boolean
  /**
   * Alignment guides to draw while a gesture is in progress, as frame
   * fractions — the caller's model says which ones the rectangle is on.
   */
  guides?: { x: number | null; y: number | null }
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

const revoke = (url: string) => {
  if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url)
}

export function FrameEditor({
  timeline,
  sequenceTime,
  frameKey,
  rect,
  applyGesture,
  onLive,
  onCommit,
  onKeyStep,
  label,
  describedBy,
  showRegion = true,
  interactive = true,
  guides,
  fallbackAspect = 16 / 9,
  snapshot = snapshotTimelineFrame,
}: FrameEditorProps) {
  const frameRef = useRef<HTMLDivElement>(null)
  const timelineRef = useRef(timeline)
  timelineRef.current = timeline
  // The stills rendered so far, by the instant that produced them. Scrubbing
  // back and forth across an envelope must not re-render what it has already
  // drawn, and the previous still has to stay valid while the next one
  // renders — so a URL is released when it is evicted or the editor closes,
  // never when it stops being the one on screen.
  const cacheRef = useRef(new Map<string, string>())
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aspect, setAspect] = useState(fallbackAspect)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [drag, setDrag] = useState<Drag | null>(null)

  // Every still the editor rendered, released together when it closes.
  useEffect(() => {
    const cache = cacheRef.current
    return () => {
      for (const url of cache.values()) revoke(url)
      cache.clear()
    }
  }, [])

  // The still for the instant asked for: taken from the cache when it has
  // been drawn before, rendered otherwise. The one on screen is left there
  // meanwhile, so scrubbing shows motion rather than flashing black.
  useEffect(() => {
    const key = `${frameKey}@${sequenceTime}`
    const cached = cacheRef.current.get(key)
    if (cached !== undefined) {
      setError(null)
      setRendering(false)
      setImageUrl(cached)
      return
    }
    let cancelled = false
    setError(null)
    setRendering(true)
    snapshot(timelineRef.current, sequenceTime)
      .then((blob) => {
        if (cancelled) return
        const url = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : null
        if (url !== null) {
          const cache = cacheRef.current
          cache.set(key, url)
          while (cache.size > STILL_CACHE_LIMIT) {
            const oldest = cache.keys().next()
            if (oldest.done === true) break
            const evicted = cache.get(oldest.value)
            cache.delete(oldest.value)
            // Never release what is about to be shown: object URLs repeat in
            // tests, and a revoked-but-shown URL is a broken image.
            if (evicted !== undefined && evicted !== url) revoke(evicted)
          }
        }
        setRendering(false)
        setImageUrl(url)
      })
      .catch((reason: unknown) => {
        if (cancelled) return
        setRendering(false)
        setError(reason instanceof Error ? reason.message : 'The frame could not be rendered.')
      })
    return () => {
      cancelled = true
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
      ? {
          kind: 'move',
          dx: point.x - current.origin.x,
          dy: point.y - current.origin.y,
          altKey: event.altKey,
        }
      : { kind: 'corner', corner: current.corner, x: point.x, y: point.y, altKey: event.altKey }
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

  const handleKeyDown = (event: ReactKeyboardEvent<SVGRectElement>) => {
    if (onKeyStep === undefined) return
    const step = rectKeyStep(event)
    // Anything else — Escape, Tab — belongs to the panel around us.
    if (step === null) return
    event.preventDefault()
    onKeyStep(step)
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
  // Guides mark the alignment a gesture is holding, so they belong to the
  // gesture: at rest the default centre sits on one, and a permanent cross
  // through the frame would say nothing.
  const shownGuides = drag === null ? { x: null, y: null } : (guides ?? { x: null, y: null })

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
        {imageUrl !== null && rendering && (
          <span
            className="frame-editor-updating"
            data-testid="frame-editor-updating"
            aria-hidden="true"
          >
            Rendering…
          </span>
        )}
        {error !== null && (
          <p className="frame-editor-error" role="alert">
            {error}
          </p>
        )}
        {showRegion && (
          <svg
            className={
              drag === null ? 'frame-editor-handles' : 'frame-editor-handles frame-editor-dragging'
            }
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
            {shownGuides.x !== null && (
              <line
                className="frame-editor-guide"
                data-testid="frame-editor-guide-x"
                x1={toPx(shownGuides.x * size.width)}
                y1={0}
                x2={toPx(shownGuides.x * size.width)}
                y2={size.height}
              />
            )}
            {shownGuides.y !== null && (
              <line
                className="frame-editor-guide"
                data-testid="frame-editor-guide-y"
                x1={0}
                y1={toPx(shownGuides.y * size.height)}
                x2={size.width}
                y2={toPx(shownGuides.y * size.height)}
              />
            )}
            <rect
              className={
                interactive ? 'frame-editor-rect' : 'frame-editor-rect frame-editor-rect-inert'
              }
              data-testid="frame-editor-rect"
              role="img"
              aria-label={label}
              {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
              {...(interactive
                ? {
                    tabIndex: 0,
                    onPointerDown: (event: ReactPointerEvent) => beginDrag(event, null),
                    onKeyDown: handleKeyDown,
                  }
                : {})}
              x={px.x}
              y={px.y}
              width={px.width}
              height={px.height}
            />
            {interactive &&
              CORNERS.map((corner) => {
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
        )}
      </div>
    </div>
  )
}
