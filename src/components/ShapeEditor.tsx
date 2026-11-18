import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { FREE_RECT_HANDLES, rectGuides, rectKeyStep, textEditorSequenceTime } from '../lib/frameEditor'
import type { Corner, Edge, RectHandle } from '../lib/frameEditor'
import type { snapshotTimelineFrame } from '../lib/frameSnapshot'
import {
  arrowAfterEndDrag,
  boxAfterGesture,
  drawnArrow,
  drawnBox,
  movedArrow,
  pointGuides,
  shapeAfterKeyStep,
  shapeBounds,
  withShape,
} from '../lib/shapeEditor'
import type { ArrowEnd, FramePoint, ShapeTool } from '../lib/shapeEditor'
import {
  SHAPE_KIND_LABELS,
  SHAPE_KINDS,
  activeShapeGroups,
  defaultShape,
  drawShapeGroups,
  pickStyle,
} from '../lib/shapes'
import type { Shape, ShapeGroup, ShapeKind, ShapeStyle } from '../lib/shapes'
import { shapeGroupsOf } from '../lib/timeline'
import type { TimelineState } from '../lib/timeline'
import { FrameEditor } from './FrameEditor'
import './ShapeEditor.css'

/**
 * The shape editor, part 1 (#685, from the approved design #681 §3 for the
 * customer's #679): a group's shapes drawn on a still of the frame they sit
 * over, where a drag draws a rectangle, an ellipse or an arrow, and a shape
 * is selected, moved and resized by its handles. It answers the customer's
 * main ask in #679, to build shapes "like in the *Adjust Visually* tools",
 * straight onto the picture.
 *
 * **One commit per gesture**, on release, through the same `set` the row's
 * fields use, and always the whole shape list. So a drag or a key press is
 * one undo step, and the fields and the editor are two views of one value
 * and cannot disagree.
 *
 * **The still leaves this group out** and the editor draws it itself, live,
 * on a canvas over the still through `drawShapeGroups`, the routine the
 * preview and every export use. So a shape being dragged looks exactly as it
 * will render, with no stale copy left behind in the still. The cost is
 * stacking: in the editor the group sits above text it would sit beneath.
 * Show result (#686) is where the true composite will be shown.
 *
 * Other groups showing at the same instant are already in the still. They
 * are also outlined, faint and dashed, so they read as "not this group",
 * and they take no pointer.
 */

const HANDLE = 12
const EDGE_THICKNESS = 7
const EDGE_LENGTH = 0.3
/** How far a pointer must travel, in CSS px, before a press becomes a drag. */
const DRAG_THRESHOLD = 3

const isEdge = (handle: RectHandle): handle is Edge => handle.length === 1

type Drag =
  | { kind: 'draw'; pointerId: number; tool: ShapeKind; origin: FramePoint; draft: Shape | null }
  | {
      kind: 'edit'
      pointerId: number
      origin: FramePoint
      originPx: { x: number; y: number }
      start: Shape
      live: Shape
      /** The body (null), a box handle, or an arrow end. */
      grip: RectHandle | ArrowEnd | null
      moved: boolean
    }

interface ShapeEditorProps {
  timeline: TimelineState
  group: ShapeGroup
  /** "shape group at position 1": the row's own wording, so labels match its fields'. */
  position: string
  /** The output frame, for Shift's square and 15° in pixels. */
  frameSize: { width: number; height: number }
  /** Commits the group's whole shape list, as the row's own fields do. */
  onCommit: (shapes: Shape[]) => void
  onClose: () => void
  /** Injectable for tests (see FrameEditor). */
  snapshot?: typeof snapshotTimelineFrame
  /** Injectable for tests: jsdom has no crypto.randomUUID everywhere. */
  newId?: () => string
}

/**
 * This group, drawn live through the export's own routine on a canvas the
 * size of the laid-out frame. It is drawn at full opacity, without its fades,
 * because the editor places shapes rather than previewing a moment of a fade.
 */
function ShapeCanvas({
  groupId,
  shapes,
  width,
  height,
}: {
  groupId: string
  shapes: readonly Shape[]
  width: number
  height: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || width === 0 || height === 0) return
    // Backed at the device's pixel density, so a 1 px border stays crisp.
    const scale = window.devicePixelRatio || 1
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    const context = canvas.getContext('2d')
    if (context === null) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    drawShapeGroups(
      context,
      [{ id: groupId, offset: 0, duration: 1, shapes: [...shapes] }],
      0.5,
      canvas.width,
      canvas.height,
    )
  }, [groupId, shapes, width, height])
  return (
    <canvas
      ref={canvasRef}
      className="shape-editor-canvas"
      data-testid="shape-editor-canvas"
      aria-hidden="true"
    />
  )
}

/** The same name the row gives a shape: "Ellipse 1 of shape group at position 1". */
const shapeName = (shape: Shape, index: number, position: string) =>
  `${SHAPE_KIND_LABELS[shape.kind]} ${index + 1} of ${position}`

export function ShapeEditor({
  timeline,
  group,
  position,
  frameSize,
  onCommit,
  onClose,
  snapshot,
  newId = () => crypto.randomUUID(),
}: ShapeEditorProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const layerRef = useRef<SVGSVGElement>(null)
  const hintId = useId()
  const [tool, setTool] = useState<ShapeTool>('select')
  // Double-clicking a tool keeps it after a shape is drawn (#685).
  const [sticky, setSticky] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  // The style a new shape takes: the last shape drawn or edited here, and
  // the group's last shape until then (#681 §2).
  const [style, setStyle] = useState<ShapeStyle>(() =>
    pickStyle(group.shapes[group.shapes.length - 1] ?? defaultShape('', 'ellipse')),
  )
  const aspect = frameSize.height > 0 ? frameSize.width / frameSize.height : 16 / 9
  const sequenceTime = textEditorSequenceTime(timeline, group)

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  // What is shown: the stored shapes, with the one being dragged or drawn
  // in its live place.
  const shapes: Shape[] = (() => {
    if (drag === null) return group.shapes
    if (drag.kind === 'draw') return drag.draft === null ? group.shapes : [...group.shapes, drag.draft]
    return group.shapes.map((shape) => (shape.id === drag.live.id ? drag.live : shape))
  })()
  const selected = shapes.find((shape) => shape.id === selectedId) ?? null

  // The other groups showing at this instant: outlined, never selectable.
  const others = activeShapeGroups(
    shapeGroupsOf(timeline).filter((other) => other.id !== group.id),
    sequenceTime,
  ).flatMap((other) => other.shapes)

  const pictureTimeline: TimelineState = {
    ...timeline,
    shapeGroups: shapeGroupsOf(timeline).filter((other) => other.id !== group.id),
  }

  const toFraction = (event: { clientX: number; clientY: number }): FramePoint => {
    const box = layerRef.current?.getBoundingClientRect()
    if (box === undefined || box.width === 0 || box.height === 0) return { x: 0, y: 0 }
    return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height }
  }

  const capture = (event: ReactPointerEvent) => {
    event.preventDefault()
    // A press focuses the layer, where the keys live (#662's rule), without
    // scrolling the frame out from under the drag.
    layerRef.current?.focus({ preventScroll: true })
    layerRef.current?.setPointerCapture?.(event.pointerId)
  }

  const beginEdit = (event: ReactPointerEvent, shape: Shape, grip: RectHandle | ArrowEnd | null) => {
    if (event.button !== 0 || tool !== 'select') return
    event.stopPropagation()
    capture(event)
    setSelectedId(shape.id)
    setDrag({
      kind: 'edit',
      pointerId: event.pointerId,
      origin: toFraction(event),
      originPx: { x: event.clientX, y: event.clientY },
      start: shape,
      live: shape,
      grip,
      moved: false,
    })
  }

  const handleLayerPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return
    capture(event)
    if (tool === 'select') {
      // Bare picture: nothing is selected.
      setSelectedId(null)
      return
    }
    setDrag({ kind: 'draw', pointerId: event.pointerId, tool, origin: toFraction(event), draft: null })
  }

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (drag === null || event.pointerId !== drag.pointerId) return
    const point = toFraction(event)
    const modifiers = { altKey: event.altKey, shiftKey: event.shiftKey }
    if (drag.kind === 'draw') {
      let draft: Shape | null = null
      if (drag.tool === 'arrow') {
        const ends = drawnArrow(drag.origin, point, modifiers, aspect)
        if (ends !== null) {
          draft = { ...defaultShape(drag.draft?.id ?? newId(), 'arrow', style), ...ends }
        }
      } else {
        const box = drawnBox(drag.origin, point, modifiers, aspect)
        if (box !== null) {
          draft = { ...defaultShape(drag.draft?.id ?? newId(), drag.tool, style), ...box }
        }
      }
      setDrag({ ...drag, draft })
      return
    }
    // A press that has not yet travelled is a click: it selects, and must
    // not snap the shape onto a guide it happens to be near.
    const moved =
      drag.moved ||
      Math.hypot(event.clientX - drag.originPx.x, event.clientY - drag.originPx.y) >= DRAG_THRESHOLD
    if (!moved) return
    const dx = point.x - drag.origin.x
    const dy = point.y - drag.origin.y
    const start = drag.start
    let live: Shape
    if (start.kind === 'arrow') {
      live =
        drag.grip === 'tail' || drag.grip === 'tip'
          ? arrowAfterEndDrag(start, drag.grip, point, modifiers, aspect)
          : movedArrow(start, dx, dy, modifiers)
    } else if (drag.grip === null) {
      live = boxAfterGesture(start, { kind: 'move', dx, dy, ...modifiers })
    } else if (drag.grip === 'tail' || drag.grip === 'tip') {
      live = start
    } else if (isEdge(drag.grip)) {
      live = boxAfterGesture(start, { kind: 'edge', edge: drag.grip, ...point, ...modifiers })
    } else {
      live = boxAfterGesture(start, { kind: 'corner', corner: drag.grip, ...point, ...modifiers })
    }
    setDrag({ ...drag, live, moved: true })
  }

  const endDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (drag === null || event.pointerId !== drag.pointerId) return
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    setDrag(null)
    if (drag.kind === 'draw') {
      if (drag.draft === null) return
      onCommit([...group.shapes, drag.draft])
      setSelectedId(drag.draft.id)
      if (!sticky) setTool('select')
      return
    }
    const next = withShape(group.shapes, drag.live)
    if (next === null) return
    onCommit(next)
    setStyle(pickStyle(drag.live))
  }

  const handleKeyDown = (event: ReactKeyboardEvent<SVGSVGElement>) => {
    if (selected === null) return
    const step = rectKeyStep(event)
    if (step === null) return
    event.preventDefault()
    const next = withShape(group.shapes, shapeAfterKeyStep(selected, step, aspect))
    if (next !== null) onCommit(next)
  }

  const handlePanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    // Ours, not a dialog's underneath.
    event.stopPropagation()
    onClose()
  }

  const chooseTool = (next: ShapeTool, keep: boolean) => {
    setTool(next)
    setSticky(keep && next !== 'select')
  }

  // The frame's laid-out size in CSS pixels, as FrameEditor measured it for
  // the render in progress; the helpers below draw in it.
  let size = { width: 0, height: 0 }
  const px = (value: number, axis: 'x' | 'y') =>
    Math.round(value * (axis === 'x' ? size.width : size.height) * 100) / 100

  const guides = (() => {
    if (drag === null) return { x: null, y: null }
    if (drag.kind === 'draw') {
      if (drag.draft === null) return { x: null, y: null }
      return drag.draft.kind === 'arrow'
        ? pointGuides({ x: drag.draft.tipX, y: drag.draft.tipY })
        : rectGuides(shapeBounds(drag.draft))
    }
    if (!drag.moved) return { x: null, y: null }
    if (drag.live.kind === 'arrow' && (drag.grip === 'tail' || drag.grip === 'tip')) {
      return drag.grip === 'tail'
        ? pointGuides({ x: drag.live.tailX, y: drag.live.tailY })
        : pointGuides({ x: drag.live.tipX, y: drag.live.tipY })
    }
    return drag.grip === null ? rectGuides(shapeBounds(drag.live)) : { x: null, y: null }
  })()

  const outline = (shape: Shape, key: string | number, className: string, testId: string) => {
    if (shape.kind === 'arrow') {
      return (
        <line
          key={key}
          className={className}
          data-testid={testId}
          x1={px(shape.tailX, 'x')}
          y1={px(shape.tailY, 'y')}
          x2={px(shape.tipX, 'x')}
          y2={px(shape.tipY, 'y')}
        />
      )
    }
    if (shape.kind === 'ellipse') {
      return (
        <ellipse
          key={key}
          className={className}
          data-testid={testId}
          cx={px(shape.x + shape.width / 2, 'x')}
          cy={px(shape.y + shape.height / 2, 'y')}
          rx={px(shape.width / 2, 'x')}
          ry={px(shape.height / 2, 'y')}
        />
      )
    }
    return (
      <rect
        key={key}
        className={className}
        data-testid={testId}
        x={px(shape.x, 'x')}
        y={px(shape.y, 'y')}
        width={px(shape.width, 'x')}
        height={px(shape.height, 'y')}
      />
    )
  }

  const boxHandles = (shape: Shape) => {
    if (shape.kind === 'arrow') {
      return (['tail', 'tip'] as const).map((end) => (
        <circle
          key={end}
          className={`shape-editor-end shape-editor-end-${end}`}
          data-testid={`shape-editor-end-${end}`}
          cx={px(end === 'tail' ? shape.tailX : shape.tipX, 'x')}
          cy={px(end === 'tail' ? shape.tailY : shape.tipY, 'y')}
          r={HANDLE / 2}
          onPointerDown={(event) => beginEdit(event, shape, end)}
        />
      ))
    }
    const x = px(shape.x, 'x')
    const y = px(shape.y, 'y')
    const width = px(shape.width, 'x')
    const height = px(shape.height, 'y')
    return FREE_RECT_HANDLES.map((handle) => {
      if (isEdge(handle)) {
        const vertical = handle === 'n' || handle === 's'
        const along = (vertical ? width : height) * EDGE_LENGTH
        const at =
          handle === 'n' ? y : handle === 's' ? y + height : handle === 'w' ? x : x + width
        const box = vertical
          ? { x: x + width / 2 - along / 2, y: at - EDGE_THICKNESS / 2, width: along, height: EDGE_THICKNESS }
          : { x: at - EDGE_THICKNESS / 2, y: y + height / 2 - along / 2, width: EDGE_THICKNESS, height: along }
        return (
          <rect
            key={handle}
            className={`frame-editor-edge frame-editor-edge-${handle}`}
            data-testid={`shape-editor-edge-${handle}`}
            {...box}
            onPointerDown={(event) => beginEdit(event, shape, handle)}
          />
        )
      }
      const corner: Corner = handle
      const cx = corner.endsWith('w') ? x : x + width
      const cy = corner.startsWith('n') ? y : y + height
      return (
        <rect
          key={handle}
          className={`frame-editor-corner frame-editor-corner-${handle}`}
          data-testid={`shape-editor-corner-${handle}`}
          x={cx - HANDLE / 2}
          y={cy - HANDLE / 2}
          width={HANDLE}
          height={HANDLE}
          onPointerDown={(event) => beginEdit(event, shape, handle)}
        />
      )
    })
  }

  const drawing = tool !== 'select'
  const layerClass = [
    'shape-editor-layer',
    drawing ? 'shape-editor-drawing' : '',
    drag !== null ? 'frame-editor-dragging' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const guidance = drawing
    ? `drag on the picture to draw ${tool === 'arrow' ? 'an arrow, tail to tip' : `a ${tool}, corner to corner`}.`
    : 'click a shape to select it, drag it to move it, or drag a handle to resize it.'

  return (
    <div
      role="dialog"
      aria-label={`Draw the shapes of ${position}`}
      className="effect-editor shape-editor"
      data-testid="shape-editor"
      onKeyDown={handlePanelKeyDown}
    >
      <div className="effect-editor-header">
        <span>Draw, select, move and resize this group's shapes.</span>
        <button
          ref={closeRef}
          type="button"
          aria-label={`Close the shape editor for ${position}`}
          title="Close (Esc)"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <div className="shape-editor-tools" role="toolbar" aria-label={`Shape tools for ${position}`}>
        {(['select', ...SHAPE_KINDS] as const).map((each) => (
          <button
            key={each}
            type="button"
            // "… tool" names the control for what it is: bare "Select" is
            // already the media library's checkbox in the Feature Index.
            aria-label={`${each === 'select' ? 'Select' : SHAPE_KIND_LABELS[each]} tool`}
            aria-pressed={tool === each}
            data-sticky={tool === each && sticky ? 'true' : undefined}
            title={
              each === 'select'
                ? 'Select: click a shape to select it, then drag it or its handles'
                : `${SHAPE_KIND_LABELS[each]}: drag on the picture to draw one. Double-click to keep the tool for several.`
            }
            onClick={() => chooseTool(each, false)}
            onDoubleClick={() => chooseTool(each, true)}
          >
            {each === 'select' ? 'Select' : SHAPE_KIND_LABELS[each]}
          </button>
        ))}
      </div>
      <FrameEditor
        timeline={pictureTimeline}
        sequenceTime={sequenceTime}
        frameKey={`shape-editor#${group.id}`}
        rect={{ x: 0, y: 0, width: 1, height: 1 }}
        applyGesture={(start) => start}
        onCommit={() => undefined}
        label={`Shapes of ${position}`}
        showRegion={false}
        fallbackAspect={aspect}
        {...(snapshot === undefined ? {} : { snapshot })}
        layer={(laidOut) => {
          size = laidOut
          return (
            <>
              <ShapeCanvas groupId={group.id} shapes={shapes} width={laidOut.width} height={laidOut.height} />
              <svg
                ref={layerRef}
                className={layerClass}
                data-testid="shape-editor-layer"
                role="group"
                aria-label={`Shapes of ${position}`}
                aria-describedby={hintId}
                tabIndex={0}
                width={laidOut.width}
                height={laidOut.height}
                viewBox={`0 0 ${laidOut.width} ${laidOut.height}`}
                onPointerDown={handleLayerPointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onKeyDown={handleKeyDown}
              >
                {others.map((other, index) =>
                  outline(other, `other-${index}`, 'shape-editor-other', 'shape-editor-other'),
                )}
                {shapes.map((shape, index) => (
                  <g
                    key={shape.id}
                    role="img"
                    aria-label={shapeName(shape, index, position)}
                    data-testid={`shape-editor-shape-${index}`}
                    data-selected={shape.id === selectedId ? 'true' : undefined}
                    onPointerDown={(event) => beginEdit(event, shape, null)}
                  >
                    {outline(shape, 'hit', 'shape-editor-hit', `shape-editor-hit-${index}`)}
                  </g>
                ))}
                {guides.x !== null && (
                  <line
                    className="frame-editor-guide"
                    data-testid="shape-editor-guide-x"
                    x1={px(guides.x, 'x')}
                    y1={0}
                    x2={px(guides.x, 'x')}
                    y2={laidOut.height}
                  />
                )}
                {guides.y !== null && (
                  <line
                    className="frame-editor-guide"
                    data-testid="shape-editor-guide-y"
                    x1={0}
                    y1={px(guides.y, 'y')}
                    x2={laidOut.width}
                    y2={px(guides.y, 'y')}
                  />
                )}
                {selected !== null && !drawing && (
                  <g data-testid="shape-editor-selection">
                    {/* A box gets a dashed outline; an arrow's two end rings
                        are enough, and a dashed line along it would paint
                        over the very line being placed. */}
                    {selected.kind !== 'arrow' &&
                      outline(selected, 'selection', 'shape-editor-selected', 'shape-editor-selected')}
                    {boxHandles(selected)}
                  </g>
                )}
              </svg>
            </>
          )
        }}
      />
      {/* What the chosen tool does, below the picture: text that changes
          length above it would move the frame under the pointer. */}
      <p className="effect-editor-readout shape-editor-status" data-testid="shape-editor-status">
        {drawing ? 'Drawing' : 'Selecting'}: {guidance}
      </p>
      <p className="effect-editor-hint" id={hintId}>
        Choose Rectangle, Ellipse or Arrow and drag on the picture to draw; hold Shift for a square, a
        circle or an arrow at 15° steps. With Select, click a shape, then drag it or a handle; arrow
        keys nudge it, Shift for five times as far, and + and − resize it. Alt while dragging ignores
        the guides. Each drag or key press is one undo step, and the fields above show the same
        values.
      </p>
    </div>
  )
}
