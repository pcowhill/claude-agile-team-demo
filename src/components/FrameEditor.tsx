import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { createSnapshotSession, snapshotTimelineFrame } from '../lib/frameSnapshot'
import type { SnapshotSession } from '../lib/frameSnapshot'
import { rectKeyStep } from '../lib/frameEditor'
import type { Corner, Edge, FrameRect, RectGesture, RectHandle, RectKeyStep } from '../lib/frameEditor'
import { inscribedEllipse, roundedCornerRadius } from '../lib/shapeMask'
import type { ShapeMask } from '../lib/shapeMask'
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
/** The handles a caller gets unless it asks for others — the zoom's four. */
const DEFAULT_HANDLES: readonly RectHandle[] = CORNERS
/** Handle size in CSS pixels — the target a fingertip or a pointer can hit. */
const HANDLE = 12
/**
 * How thick an edge handle's grab strip is, and how far along its edge it
 * runs (#422). Both are small on purpose, and looking at the rendered panel
 * is what set them: a 10 px strip running half its side read as a second
 * rectangle nested inside the first, competing with the region's own outline
 * and with an overlay's mask silhouette, and slabbed over the very picture
 * the placement is being judged against. Under a third of the side keeps the
 * corners — the primary handles — obviously dominant, and leaves plenty of
 * room either side of each strip for them.
 */
const EDGE_THICKNESS = 7
const EDGE_LENGTH = 0.3

const isEdge = (handle: RectHandle): handle is Edge => handle.length === 1
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
  /**
   * Which resize handles to offer (#422). Corners only by default, which is
   * all an aspect-locked region can use; a free rectangle asks for the edges
   * too, so one dimension can be changed without the other.
   */
  handles?: readonly RectHandle[]
  /**
   * The silhouette the effect will actually paint inside the rectangle
   * (#422), when it is not the rectangle itself — an overlay's shape mask
   * (#266). Drawn as an outline over the picture so the placement shows the
   * shape it will really have; the geometry is `shapeMask.ts`'s own, so the
   * outline cannot disagree with what the preview clips or the export draws.
   */
  silhouette?: ShapeMask
  /** Aspect to show until the snapshot arrives (the output frame's, if known). */
  fallbackAspect?: number
  /**
   * Reports the still's pixel size once it has loaded (#424) — the output
   * frame the snapshot composed, which is the resolution the frame's text
   * was drawn at. A caller whose rectangle is *measured* rather than stored
   * (a text block's width is a property of the rendered text) measures at
   * this size so its box is the drawn text's, and until it arrives it has
   * only a guess to measure at.
   */
  onFrame?: (frame: { width: number; height: number }) => void
  /** Injectable for tests: jsdom has no canvas to compose on. */
  snapshot?: typeof snapshotTimelineFrame
}

interface Drag {
  pointerId: number
  start: FrameRect
  origin: { x: number; y: number }
  /** The handle being pulled, or null for a move from inside the region. */
  handle: RectHandle | null
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
  handles = DEFAULT_HANDLES,
  silhouette,
  fallbackAspect = 16 / 9,
  onFrame,
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
  // One snapshot session per mounted editor (#458): the sources the first
  // still loads stay loaded, so every later instant is a seek on them rather
  // than a reload of each from scratch. Released with the cache when the
  // editor closes — or, if a render is mid-flight then, once it lands.
  const sessionRef = useRef<SnapshotSession | null>(null)
  // Latest-wins scheduling (#458). One render is in flight at a time; an
  // instant asked for while it runs waits in `pendingRef`, replacing any
  // earlier one still waiting, so a slider dragged across forty stops renders
  // the one it started on and the one it stopped at — not forty, each with
  // its own decode competing for the machine. `wantedRef` is the instant on
  // order right now: only its still is shown when a render lands, though
  // every render that lands is cached for a revisit.
  const wantedRef = useRef<string | null>(null)
  const inFlightRef = useRef(false)
  const pendingRef = useRef<{ key: string; time: number } | null>(null)
  const unmountedRef = useRef(false)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aspect, setAspect] = useState(fallbackAspect)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [drag, setDrag] = useState<Drag | null>(null)

  // Every still the editor rendered, and every source its session loaded,
  // released together when it closes. A render still in flight at that
  // moment holds the session's elements, so it releases them when it lands
  // (below) rather than having them pulled out from under its seek.
  useEffect(() => {
    unmountedRef.current = false
    if (sessionRef.current === null) sessionRef.current = createSnapshotSession()
    const cache = cacheRef.current
    return () => {
      unmountedRef.current = true
      for (const url of cache.values()) revoke(url)
      cache.clear()
      if (!inFlightRef.current) {
        sessionRef.current?.release()
        sessionRef.current = null
      }
    }
  }, [])

  // The still for the instant asked for: taken from the cache when it has
  // been drawn before, rendered otherwise. The one on screen is left there
  // meanwhile, so scrubbing shows motion rather than flashing black.
  useEffect(() => {
    const startRender = (request: { key: string; time: number }) => {
      const session = sessionRef.current ?? createSnapshotSession()
      sessionRef.current = session
      inFlightRef.current = true
      snapshot(timelineRef.current, request.time, { session })
        .then((blob) => {
          const url = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : null
          if (unmountedRef.current) {
            if (url !== null) revoke(url)
            return
          }
          if (url !== null) {
            const cache = cacheRef.current
            cache.set(request.key, url)
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
          if (wantedRef.current !== request.key) return
          setRendering(false)
          setImageUrl(url)
        })
        .catch((reason: unknown) => {
          if (unmountedRef.current || wantedRef.current !== request.key) return
          setRendering(false)
          setError(reason instanceof Error ? reason.message : 'The frame could not be rendered.')
        })
        .finally(() => {
          inFlightRef.current = false
          if (unmountedRef.current) {
            sessionRef.current?.release()
            sessionRef.current = null
            return
          }
          const next = pendingRef.current
          pendingRef.current = null
          if (next === null) return
          // What waited may have landed meanwhile — the user scrubbed away
          // and back while the same instant rendered — so the cache is
          // checked before a render is spent on it.
          const cached = cacheRef.current.get(next.key)
          if (cached === undefined) {
            startRender(next)
            return
          }
          if (wantedRef.current !== next.key) return
          setRendering(false)
          setImageUrl(cached)
        })
    }

    const key = `${frameKey}@${sequenceTime}`
    wantedRef.current = key
    const cached = cacheRef.current.get(key)
    if (cached !== undefined) {
      // Shown at once, and nothing else is owed: an instant still waiting
      // to render was asked for before this one.
      pendingRef.current = null
      setError(null)
      setRendering(false)
      setImageUrl(cached)
      return
    }
    setError(null)
    setRendering(true)
    const request = { key, time: sequenceTime }
    if (inFlightRef.current) {
      pendingRef.current = request
      return
    }
    startRender(request)
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

  const beginDrag = (event: ReactPointerEvent, handle: RectHandle | null) => {
    if (event.button !== 0) return
    event.preventDefault()
    // Capture on the layer, so the move and release reach it wherever the
    // pointer goes (jsdom has no capture; tests fire on the layer directly).
    ;(event.currentTarget as SVGGraphicsElement).ownerSVGElement?.setPointerCapture?.(
      event.pointerId,
    )
    setDrag({ pointerId: event.pointerId, start: rect, origin: toFraction(event), handle, live: rect })
  }

  const gestureOf = (current: Drag, event: ReactPointerEvent): RectGesture => {
    const point = toFraction(event)
    // Both modifiers travel raw: this component says what the pointer did,
    // and the caller's handle model decides what Alt and Shift mean for it.
    const modifiers = { altKey: event.altKey, shiftKey: event.shiftKey }
    if (current.handle === null) {
      return {
        kind: 'move',
        dx: point.x - current.origin.x,
        dy: point.y - current.origin.y,
        ...modifiers,
      }
    }
    return isEdge(current.handle)
      ? { kind: 'edge', edge: current.handle, x: point.x, y: point.y, ...modifiers }
      : { kind: 'corner', corner: current.handle, x: point.x, y: point.y, ...modifiers }
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
  // An edge handle is a strip centred on the middle of its side, running
  // half its length, so the two corners it sits between stay grabbable.
  const edgeBox = (edge: Edge) => {
    const vertical = edge === 'n' || edge === 's'
    const along = vertical ? px.width * EDGE_LENGTH : px.height * EDGE_LENGTH
    const midX = px.x + px.width / 2
    const midY = px.y + px.height / 2
    const at = edge === 'n' ? px.y : edge === 's' ? px.y + px.height : edge === 'w' ? px.x : px.x + px.width
    return vertical
      ? { x: midX - along / 2, y: at - EDGE_THICKNESS / 2, width: along, height: EDGE_THICKNESS }
      : { x: at - EDGE_THICKNESS / 2, y: midY - along / 2, width: EDGE_THICKNESS, height: along }
  }
  const ellipse = inscribedEllipse(px)
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
              if (naturalWidth > 0 && naturalHeight > 0) {
                setAspect(naturalWidth / naturalHeight)
                onFrame?.({ width: naturalWidth, height: naturalHeight })
              }
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
            {/* The shape the effect will really paint, inside the box that
                positions it (#422/#266) — drawn whether or not the region
                takes drags, since it describes the placement rather than
                the gesture. */}
            {silhouette !== undefined &&
              (silhouette.kind === 'ellipse' ? (
                <ellipse
                  className="frame-editor-silhouette"
                  data-testid="frame-editor-silhouette"
                  data-shape="ellipse"
                  cx={toPx(ellipse.cx)}
                  cy={toPx(ellipse.cy)}
                  rx={toPx(ellipse.rx)}
                  ry={toPx(ellipse.ry)}
                />
              ) : (
                <rect
                  className="frame-editor-silhouette"
                  data-testid="frame-editor-silhouette"
                  data-shape="rounded"
                  x={px.x}
                  y={px.y}
                  width={px.width}
                  height={px.height}
                  rx={toPx(roundedCornerRadius(px, silhouette.radius))}
                />
              ))}
            {interactive &&
              handles.map((handle) => {
                if (isEdge(handle)) {
                  const box = edgeBox(handle)
                  return (
                    <rect
                      key={handle}
                      className={`frame-editor-edge frame-editor-edge-${handle}`}
                      data-testid={`frame-editor-edge-${handle}`}
                      x={toPx(box.x)}
                      y={toPx(box.y)}
                      width={toPx(box.width)}
                      height={toPx(box.height)}
                      onPointerDown={(event) => beginDrag(event, handle)}
                    />
                  )
                }
                const point = cornerPoint(handle)
                return (
                  <rect
                    key={handle}
                    className={`frame-editor-corner frame-editor-corner-${handle}`}
                    data-testid={`frame-editor-corner-${handle}`}
                    x={point.x - HANDLE / 2}
                    y={point.y - HANDLE / 2}
                    width={HANDLE}
                    height={HANDLE}
                    onPointerDown={(event) => beginDrag(event, handle)}
                  />
                )
              })}
          </svg>
        )}
      </div>
    </div>
  )
}
