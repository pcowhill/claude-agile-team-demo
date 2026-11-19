import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import {
  FREE_RECT_HANDLES,
  ZOOM_SCRUB_STEP,
  loopPositionAt,
  loopScrubStop,
  rectGuides,
  rectKeyStep,
} from '../lib/frameEditor'
import type { Corner, Edge, RectHandle } from '../lib/frameEditor'
import type { snapshotTimelineFrame } from '../lib/frameSnapshot'
import {
  HIGHLIGHTER_STYLE,
  arrowAfterEndDrag,
  boxAfterGesture,
  drawnArrow,
  drawnBox,
  duplicatedShapes,
  movedArrow,
  movedBadge,
  movedShapes,
  placedBadgeCenter,
  pointGuides,
  reorderedShapes,
  restyledShape,
  selectionBounds,
  selectionStyle,
  shapeBounds,
  shapesAfterKeyStep,
  withShape,
  withShapes,
  withoutShapes,
} from '../lib/shapeEditor'
import type { ArrowEnd, FramePoint, Shared, ShapeTool, StyleChange } from '../lib/shapeEditor'
import {
  ARROW_HEADS,
  ARROW_HEAD_LABELS,
  ARROW_HEAD_SIZES,
  ARROW_HEAD_SIZE_LABELS,
  LINE_STYLES,
  LINE_STYLE_LABELS,
  MAX_CORNER_RADIUS,
  MAX_SHAPE_THICKNESS,
  SHAPE_KIND_LABELS,
  SHAPE_KINDS,
  activeShapeGroups,
  defaultShape,
  drawShapeGroups,
  newBadge,
  pickStyle,
  shorterSideFraction,
  shorterSidePixels,
  styleForNextShape,
} from '../lib/shapes'
import type { ArrowHeadSize, ArrowHeads, BadgeShape, LineStyle, Shape, ShapeGroup, ShapeKind, ShapeStyle } from '../lib/shapes'
import { shapeGroupsOf, totalDuration } from '../lib/timeline'
import type { TimelineState } from '../lib/timeline'
import { FrameEditor } from './FrameEditor'
import './ShapeEditor.css'

/**
 * The shape editor (#685 part 1, #686 part 2, from the approved design #681
 * §3 for the customer's #679): a group's shapes drawn on a still of the
 * frame they sit over, where a drag draws a rectangle, an ellipse or an
 * arrow, a click places a numbered badge (#689), and shapes are selected,
 * moved, resized, restyled, reordered, deleted and duplicated. It answers the customer's main ask in #679, to
 * build shapes "like in the *Adjust Visually* tools", straight onto the
 * picture.
 *
 * **One commit per gesture**, on release, through the same `set` the row's
 * fields use, and always the whole shape list. So a drag, a key press or a
 * style-bar change is one undo step — for the whole selection at once — and
 * the fields and the editor are two views of one value and cannot disagree.
 *
 * **The still leaves this group out** and the editor draws it itself, live,
 * on a canvas over the still through `drawShapeGroups`, the routine the
 * preview and every export use. So a shape being dragged looks exactly as it
 * will render, with no stale copy left behind in the still. The cost is
 * stacking and fades: in the editor the group sits above text it would sit
 * beneath, at full opacity. **Show result** (#686) is the true composite:
 * the still with this group in it, below the text and faded as it will be
 * at the Preview slider's instant, through the export's own composer.
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
const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)
const seconds = (value: number) => `${value.toFixed(2)} s`
/** A number as the style bar shows it: at most two decimals, like the row. */
const shown = (value: number) => String(Math.round(value * 100) / 100)

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
  | {
      /** A selection of several shapes dragged by one of them (#686). */
      kind: 'move-many'
      pointerId: number
      origin: FramePoint
      originPx: { x: number; y: number }
      /** The shape the press landed on: a click without a drag selects it alone. */
      pressed: string
      starts: Shape[]
      lives: Shape[]
      moved: boolean
    }

interface ShapeEditorProps {
  timeline: TimelineState
  group: ShapeGroup
  /** "shape group at position 1": the row's own wording, so labels match its fields'. */
  position: string
  /** The output frame, for Shift's square and 15° in pixels, and the bar's px. */
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
 * A number box in the style bar (#686): the row's field idiom — the unit
 * inside the box, a commit on Enter or blur, and a spinner click in Firefox
 * (which never focuses the box, #593) committing at once. A selection whose
 * shapes disagree shows it empty, with "mixed" as its placeholder, and
 * typing a number gives every one of them that number.
 */
function StyleNumber({
  label,
  value,
  unit,
  max,
  step,
  disabled,
  onCommit,
}: {
  label: string
  /** Undefined when the field does not apply to the selection. */
  value: Shared<number> | undefined
  unit: '%' | 'px'
  max: number
  step: number
  disabled: boolean
  onCommit: (value: number) => void
}) {
  const text = value === undefined || value === 'mixed' ? '' : shown(value)
  const [draft, setDraft] = useState(text)
  useEffect(() => setDraft(text), [text])
  const commitText = (typed: string) => {
    const parsed = Number(typed)
    if (typed.trim() !== '' && Number.isFinite(parsed) && (value === 'mixed' || parsed !== value)) {
      onCommit(clamp(parsed, 0, max))
    }
    setDraft(text)
  }
  return (
    <span className="timeline-unit-box shape-editor-number">
      <input
        type="number"
        inputMode="decimal"
        className="timeline-unit-input"
        aria-label={label}
        min={0}
        max={max}
        step={step}
        value={draft}
        placeholder={value === 'mixed' ? 'mixed' : undefined}
        disabled={disabled}
        onChange={(event) => {
          if (document.activeElement !== event.currentTarget) commitText(event.target.value)
          else setDraft(event.target.value)
        }}
        onBlur={() => commitText(draft)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
      <span className="timeline-unit" aria-hidden="true">
        {unit}
      </span>
    </span>
  )
}

/** A colour box in the style bar, with a visible "mixed" beside it when the selection disagrees. */
function StyleColor({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: Shared<string> | undefined
  disabled: boolean
  onChange: (value: string) => void
}) {
  const mixed = value === 'mixed'
  return (
    <>
      <input
        type="color"
        aria-label={label}
        // A colour input cannot be empty; a mixed selection shows a neutral
        // grey and says "mixed" beside it.
        value={value === undefined || mixed ? '#808080' : value}
        disabled={disabled}
        data-mixed={mixed ? 'true' : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {mixed && !disabled && <span className="shape-editor-mixed">mixed</span>}
    </>
  )
}

/** A drop-down in the style bar; a mixed selection shows "Mixed" until one is chosen. */
function StyleSelect<T extends string>({
  label,
  value,
  options,
  labels,
  disabled,
  onChange,
}: {
  label: string
  value: Shared<T> | undefined
  options: readonly T[]
  labels: Record<T, string>
  disabled: boolean
  onChange: (value: T) => void
}) {
  return (
    <select
      aria-label={label}
      value={value === undefined ? '' : value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as T)}
    >
      {(value === undefined || value === 'mixed') && (
        <option value={value === undefined ? '' : 'mixed'} disabled>
          {value === undefined ? '—' : 'Mixed'}
        </option>
      )}
      {options.map((option) => (
        <option key={option} value={option}>
          {labels[option]}
        </option>
      ))}
    </select>
  )
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
  // The selection (#686): ids in the order they were picked. Shift-click
  // adds a shape or takes it out.
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [drag, setDrag] = useState<Drag | null>(null)
  // The style a new shape takes: the last shape drawn, edited or restyled
  // here, and the group's last shape until then (#681 §2). Badges are
  // passed over (#689): a new badge takes the last badge's look instead
  // (`newBadge`), and its solid disc is not what the next ellipse wants.
  const [style, setStyle] = useState<ShapeStyle>(() => styleForNextShape(group.shapes))
  const keepStyle = (shape: Shape) => {
    if (shape.kind !== 'badge') setStyle(pickStyle(shape))
  }
  // A word on what the last key or button did, when it did something the
  // picture alone would not show (a refused Delete, a preset waiting).
  const [notice, setNotice] = useState<string | null>(null)
  const [showResult, setShowResult] = useState(false)
  // Loop (#425's control): session-only, off when the editor opens, and its
  // clock runs in the effect below for exactly as long as this is true.
  const [looping, setLooping] = useState(false)
  const aspect = frameSize.height > 0 ? frameSize.width / frameSize.height : 16 / 9

  // The Preview slider spans the group's window on the sequence. The
  // window is edited in the row while the editor is open, so the scrub
  // position is kept and clamped into it rather than reset.
  const total = Math.max(0, totalDuration(timeline))
  const span = {
    start: clamp(group.offset, 0, total),
    end: clamp(group.offset + group.duration, 0, total),
  }
  const [scrubbed, setScrubbed] = useState(() =>
    loopScrubStop((span.start + span.end) / 2, span.start, span.end),
  )
  const scrub = clamp(scrubbed, span.start, span.end)

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  // The loop's clock (#425): one tick a frame, where the loop is now on the
  // slider's grid into the scrub position; the still pipeline does the rest
  // (latest wins, #458).
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

  // What is shown: the stored shapes, with the ones being dragged or drawn
  // in their live places.
  const shapes: Shape[] = (() => {
    if (drag === null) return group.shapes
    if (drag.kind === 'draw') return drag.draft === null ? group.shapes : [...group.shapes, drag.draft]
    const lives = drag.kind === 'edit' ? [drag.live] : drag.lives
    return group.shapes.map((shape) => lives.find((live) => live.id === shape.id) ?? shape)
  })()
  const selectedSet = new Set(selectedIds)
  // In drawing order, and only shapes still in the group: an undo can take
  // a selected shape away.
  const selection = shapes.filter((shape) => selectedSet.has(shape.id))
  const single = selection.length === 1 ? selection[0] : null
  const editable = !showResult

  // The other groups showing at this instant: outlined, never selectable.
  const others = activeShapeGroups(
    shapeGroupsOf(timeline).filter((other) => other.id !== group.id),
    scrub,
  ).flatMap((other) => other.shapes)

  const pictureTimeline: TimelineState = showResult
    ? timeline
    : { ...timeline, shapeGroups: shapeGroupsOf(timeline).filter((other) => other.id !== group.id) }

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

  const select = (ids: string[]) => {
    setSelectedIds(ids)
    setNotice(null)
  }

  const beginEdit = (event: ReactPointerEvent, shape: Shape, grip: RectHandle | ArrowEnd | null) => {
    if (event.button !== 0 || tool !== 'select' || !editable) return
    event.stopPropagation()
    if (grip === null && event.shiftKey) {
      // Shift-click adds the shape to the selection or takes it out (#686).
      // It starts no drag: Shift is the drag's square / 15° modifier.
      event.preventDefault()
      layerRef.current?.focus({ preventScroll: true })
      select(
        selectedSet.has(shape.id)
          ? selectedIds.filter((id) => id !== shape.id)
          : [...selectedIds, shape.id],
      )
      return
    }
    capture(event)
    const origin = toFraction(event)
    const originPx = { x: event.clientX, y: event.clientY }
    if (grip === null && selectedSet.has(shape.id) && selection.length > 1) {
      // A press on one of several selected shapes drags them all.
      setDrag({
        kind: 'move-many',
        pointerId: event.pointerId,
        origin,
        originPx,
        pressed: shape.id,
        starts: selection,
        lives: selection,
        moved: false,
      })
      return
    }
    select([shape.id])
    setDrag({ kind: 'edit', pointerId: event.pointerId, origin, originPx, start: shape, live: shape, grip, moved: false })
  }

  const handleLayerPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || !editable) return
    capture(event)
    if (tool === 'select') {
      // Bare picture: nothing is selected, unless Shift says "add to".
      if (!event.shiftKey) select([])
      return
    }
    const origin = toFraction(event)
    // The Badge tool (#689) places on the press itself: a click is a badge,
    // and dragging before letting go moves it into place.
    const draft =
      tool === 'badge'
        ? newBadge(newId(), group.shapes, placedBadgeCenter(origin, { altKey: event.altKey }))
        : null
    setDrag({ kind: 'draw', pointerId: event.pointerId, tool, origin, draft })
  }

  /**
   * The drag as it stands with the pointer at `event`: the draft, the live
   * shape or the moved selection recomputed from the drag's start. Both the
   * moves and the release go through it, so the release commits the shape
   * at its own position (#728): a pointerup dispatched before React has
   * rendered the last move's state must not commit that move's predecessor.
   * A drag that has not travelled past the threshold comes back unchanged.
   */
  const dragAt = (
    current: Drag,
    event: { clientX: number; clientY: number; altKey: boolean; shiftKey: boolean },
  ): Drag => {
    const point = toFraction(event)
    const modifiers = { altKey: event.altKey, shiftKey: event.shiftKey }
    if (current.kind === 'draw') {
      let draft: Shape | null = null
      if (current.tool === 'badge') {
        // Follows the pointer from the press; never null, so a click commits.
        if (current.draft?.kind !== 'badge') return current
        const center = placedBadgeCenter(point, modifiers)
        return { ...current, draft: { ...current.draft, centerX: center.x, centerY: center.y } }
      }
      if (current.tool === 'arrow') {
        const ends = drawnArrow(current.origin, point, modifiers, aspect)
        if (ends !== null) {
          draft = { ...defaultShape(current.draft?.id ?? newId(), 'arrow', style), ...ends }
        }
      } else {
        const box = drawnBox(current.origin, point, modifiers, aspect)
        if (box !== null) {
          draft = { ...defaultShape(current.draft?.id ?? newId(), current.tool, style), ...box }
        }
      }
      return { ...current, draft }
    }
    // A press that has not yet travelled is a click: it selects, and must
    // not snap the shape onto a guide it happens to be near.
    const moved =
      current.moved ||
      Math.hypot(event.clientX - current.originPx.x, event.clientY - current.originPx.y) >= DRAG_THRESHOLD
    if (!moved) return current
    const dx = point.x - current.origin.x
    const dy = point.y - current.origin.y
    if (current.kind === 'move-many') {
      return { ...current, lives: movedShapes(current.starts, dx, dy, modifiers), moved: true }
    }
    const start = current.start
    let live: Shape
    if (start.kind === 'badge') {
      live = movedBadge(start, dx, dy, modifiers)
    } else if (start.kind === 'arrow') {
      live =
        current.grip === 'tail' || current.grip === 'tip'
          ? arrowAfterEndDrag(start, current.grip, point, modifiers, aspect)
          : movedArrow(start, dx, dy, modifiers)
    } else if (current.grip === null) {
      live = boxAfterGesture(start, { kind: 'move', dx, dy, ...modifiers })
    } else if (current.grip === 'tail' || current.grip === 'tip') {
      live = start
    } else if (isEdge(current.grip)) {
      live = boxAfterGesture(start, { kind: 'edge', edge: current.grip, ...point, ...modifiers })
    } else {
      live = boxAfterGesture(start, { kind: 'corner', corner: current.grip, ...point, ...modifiers })
    }
    return { ...current, live, moved: true }
  }

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (drag === null || event.pointerId !== drag.pointerId) return
    const next = dragAt(drag, event)
    if (next !== drag) setDrag(next)
  }

  const endDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (drag === null || event.pointerId !== drag.pointerId) return
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    setDrag(null)
    // A cancelled pointer has no release point worth committing to; a
    // release does (#728), whether or not its last move has rendered.
    const final = event.type === 'pointercancel' ? drag : dragAt(drag, event)
    commitDrag(final)
  }

  const commitDrag = (final: Drag) => {
    if (final.kind === 'draw') {
      if (final.draft === null) return
      onCommit([...group.shapes, final.draft])
      select([final.draft.id])
      keepStyle(final.draft)
      if (!sticky) setTool('select')
      return
    }
    if (final.kind === 'move-many') {
      // A click on one of several selected shapes, without a drag, picks it alone.
      if (!final.moved) {
        select([final.pressed])
        return
      }
      const next = withShapes(group.shapes, final.lives)
      if (next !== null) onCommit(next)
      return
    }
    const next = withShape(group.shapes, final.live)
    if (next === null) return
    onCommit(next)
    keepStyle(final.live)
  }

  /** Commits `next` when it is an edit; the selection is the caller's. */
  const commit = (next: Shape[] | null) => {
    if (next !== null) onCommit(next)
    return next !== null
  }

  const removeSelection = () => {
    if (selection.length === 0) return
    const next = withoutShapes(group.shapes, selectedSet)
    if (next === null) {
      // Every shape is selected, and a group always keeps one.
      setNotice('A group always keeps one shape: remove the whole group from its row instead.')
      return
    }
    onCommit(next)
    select([])
  }

  const duplicateSelection = () => {
    const result = duplicatedShapes(group.shapes, selectedSet, newId)
    if (result === null) return
    onCommit(result.shapes)
    select(result.copies.map((copy) => copy.id))
  }

  const reorder = (direction: 'forward' | 'backward') => commit(reorderedShapes(group.shapes, selectedSet, direction))

  const handleKeyDown = (event: ReactKeyboardEvent<SVGSVGElement>) => {
    if (!editable) return
    const chord = event.ctrlKey || event.metaKey
    if (chord && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'd') {
      // Ours, never the browser's bookmark shortcut — even with nothing
      // selected, since the focus is on the picture.
      event.preventDefault()
      duplicateSelection()
      return
    }
    if (chord || event.altKey) return
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      removeSelection()
      return
    }
    if (selection.length === 0) return
    const step = rectKeyStep(event)
    if (step === null) return
    event.preventDefault()
    commit(withShapes(group.shapes, shapesAfterKeyStep(selection, step, aspect)))
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
    setNotice(null)
  }

  // The style bar (#686): what it reads, and how it writes.
  const read = selectionStyle(selection)
  const toPx = (fraction: number) => shorterSidePixels(fraction, frameSize.width, frameSize.height)
  const fromPx = (px: number) => shorterSideFraction(px, frameSize.width, frameSize.height)
  const pxOf = (value: Shared<number> | undefined) =>
    value === undefined || value === 'mixed' ? value : toPx(value)
  const percentOf = (value: Shared<number> | undefined) =>
    value === undefined || value === 'mixed' ? value : Math.round(value * 100)
  const restyle = (change: StyleChange) => {
    if (selection.length === 0) return
    const restyled = selection.map((shape) => restyledShape(shape, change))
    if (commit(withShapes(group.shapes, restyled))) keepStyle(restyled[restyled.length - 1])
  }
  const rectangles = selection.filter((shape) => shape.kind === 'rectangle')
  const highlight = () => {
    if (selection.length === 0) {
      // Nothing selected: the preset is the next rectangle's style.
      setStyle({ ...style, ...HIGHLIGHTER_STYLE })
      setTool('rectangle')
      setSticky(false)
      setNotice('The next rectangle you draw is a highlighter: no border and a 35 % yellow fill.')
      return
    }
    const restyled = rectangles.map((shape) => restyledShape(shape, HIGHLIGHTER_STYLE))
    if (commit(withShapes(group.shapes, restyled))) setStyle(pickStyle(restyled[restyled.length - 1]))
  }
  const none = read === null || !editable
  const maxThicknessPx = Math.floor(toPx(MAX_SHAPE_THICKNESS))
  // One name whatever the count, so a control keeps its name as the selection changes.
  const what = `the selected shapes of ${position}`

  // The frame's laid-out size in CSS pixels, as FrameEditor measured it for
  // the render in progress; the helpers below draw in it.
  let size = { width: 0, height: 0 }
  const px = (value: number, axis: 'x' | 'y') =>
    Math.round(value * (axis === 'x' ? size.width : size.height) * 100) / 100
  /** A badge's radius in laid-out pixels: half its diameter of the shorter side. */
  const badgeRadius = (shape: BadgeShape) =>
    Math.round(shorterSidePixels(shape.size, size.width, size.height) * 50) / 100

  const guides = (() => {
    if (drag === null) return { x: null, y: null }
    if (drag.kind === 'draw') {
      if (drag.draft === null) return { x: null, y: null }
      if (drag.draft.kind === 'badge') return pointGuides({ x: drag.draft.centerX, y: drag.draft.centerY })
      return drag.draft.kind === 'arrow'
        ? pointGuides({ x: drag.draft.tipX, y: drag.draft.tipY })
        : rectGuides(shapeBounds(drag.draft))
    }
    if (!drag.moved) return { x: null, y: null }
    if (drag.kind === 'move-many') return rectGuides(selectionBounds(drag.lives))
    if (drag.live.kind === 'badge') return pointGuides({ x: drag.live.centerX, y: drag.live.centerY })
    if (drag.live.kind === 'arrow' && (drag.grip === 'tail' || drag.grip === 'tip')) {
      return drag.grip === 'tail'
        ? pointGuides({ x: drag.live.tailX, y: drag.live.tailY })
        : pointGuides({ x: drag.live.tipX, y: drag.live.tipY })
    }
    return drag.grip === null ? rectGuides(shapeBounds(drag.live)) : { x: null, y: null }
  })()

  const outline = (shape: Shape, key: string | number, className: string, testId: string) => {
    if (shape.kind === 'badge') {
      // Round in laid-out pixels, as the canvas draws it (#689).
      return (
        <circle
          key={key}
          className={className}
          data-testid={testId}
          cx={px(shape.centerX, 'x')}
          cy={px(shape.centerY, 'y')}
          r={badgeRadius(shape)}
        />
      )
    }
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

  /** An arrow's two end rings: grips for a single selection, marks for several. */
  const arrowEnds = (shape: Shape & { kind: 'arrow' }, grips: boolean) =>
    (['tail', 'tip'] as const).map((end) => (
      <circle
        key={`${shape.id}-${end}`}
        className={`shape-editor-end shape-editor-end-${end}${grips ? '' : ' shape-editor-end-inert'}`}
        data-testid={grips ? `shape-editor-end-${end}` : undefined}
        cx={px(end === 'tail' ? shape.tailX : shape.tipX, 'x')}
        cy={px(end === 'tail' ? shape.tailY : shape.tipY, 'y')}
        r={HANDLE / 2}
        {...(grips ? { onPointerDown: (event: ReactPointerEvent) => beginEdit(event, shape, end) } : {})}
      />
    ))

  const boxHandles = (shape: Shape) => {
    if (shape.kind === 'arrow') return arrowEnds(shape, true)
    // A badge has no handles (#689): it moves by its body, and + / − or its
    // Size field resize it, so it can never be pulled out of round.
    if (shape.kind === 'badge') return null
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
    drawing && editable ? 'shape-editor-drawing' : '',
    showResult ? 'shape-editor-inert' : '',
    drag !== null ? 'frame-editor-dragging' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const guidance = showResult
    ? 'the finished frame at this moment, with the group faded and stacked as it will be. Turn Show result off to edit the shapes.'
    : drawing
      ? tool === 'badge'
        ? 'click on the picture to place the next numbered badge; drag before letting go to move it.'
        : `drag on the picture to draw ${tool === 'arrow' ? 'an arrow, tail to tip' : `a ${tool}, corner to corner`}.`
      : selection.length > 1
        ? `${selection.length} shapes selected: drag one to move them all, or restyle them together above.`
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
        <span>Draw, select, move, resize and style this group's shapes.</span>
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
            disabled={!editable}
            title={
              each === 'select'
                ? 'Select: click a shape to select it, Shift-click to add one, then drag it or its handles'
                : each === 'badge'
                  ? 'Badge: click on the picture to place the next numbered badge. Double-click to keep the tool for several.'
                  : `${SHAPE_KIND_LABELS[each]}: drag on the picture to draw one. Double-click to keep the tool for several.`
            }
            onClick={() => chooseTool(each, false)}
            onDoubleClick={() => chooseTool(each, true)}
          >
            {each === 'select' ? 'Select' : SHAPE_KIND_LABELS[each]}
          </button>
        ))}
      </div>
      {/* The style bar (#686): every control edits the whole selection as
          one undo step. A control that does not apply to every selected
          shape is disabled; one whose shapes disagree reads "mixed". */}
      <div
        className="shape-editor-style"
        role="group"
        aria-label={`Style of the selected shapes of ${position}`}
        data-testid="shape-editor-style"
      >
        <span className="shape-editor-style-item">
          <span>Border</span>
          <StyleColor
            label={`Border colour of ${what}`}
            value={read?.stroke}
            disabled={none}
            onChange={(stroke) => restyle({ stroke })}
          />
          <StyleNumber
            label={`Border opacity of ${what} (percent)`}
            value={percentOf(read?.strokeOpacity)}
            unit="%"
            max={100}
            step={5}
            disabled={none}
            onCommit={(percent) => restyle({ strokeOpacity: percent / 100 })}
          />
        </span>
        <span className="shape-editor-style-item">
          <span>Thickness</span>
          <StyleNumber
            label={`Border thickness of ${what} in pixels`}
            value={pxOf(read?.thickness)}
            unit="px"
            max={maxThicknessPx}
            step={1}
            disabled={none}
            onCommit={(value) => restyle({ thickness: Math.min(fromPx(value), MAX_SHAPE_THICKNESS) })}
          />
        </span>
        <span className="shape-editor-style-item">
          <span>Line</span>
          <StyleSelect<LineStyle>
            label={`Line style of ${what}`}
            value={read?.lineStyle}
            options={LINE_STYLES}
            labels={LINE_STYLE_LABELS}
            disabled={none}
            onChange={(lineStyle) => restyle({ lineStyle })}
          />
        </span>
        <span className="shape-editor-style-item">
          <span>Fill</span>
          <StyleColor
            label={`Fill colour of ${what}`}
            value={read?.fill}
            disabled={none || read?.fill === undefined}
            onChange={(fill) => restyle({ fill })}
          />
          <StyleNumber
            label={`Fill opacity of ${what} (percent)`}
            value={percentOf(read?.fillOpacity)}
            unit="%"
            max={100}
            step={5}
            disabled={none || read?.fillOpacity === undefined}
            onCommit={(percent) => restyle({ fillOpacity: percent / 100 })}
          />
        </span>
        <span className="shape-editor-style-item">
          <span>Corners</span>
          <StyleNumber
            label={`Corner radius of ${what} in pixels`}
            value={pxOf(read?.cornerRadius)}
            unit="px"
            max={Math.floor(toPx(MAX_CORNER_RADIUS))}
            step={1}
            disabled={none || read?.cornerRadius === undefined}
            onCommit={(value) => restyle({ cornerRadius: Math.min(fromPx(value), MAX_CORNER_RADIUS) })}
          />
        </span>
        <span className="shape-editor-style-item">
          <span>Heads</span>
          <StyleSelect<ArrowHeads>
            label={`Arrow heads of ${what}`}
            value={read?.heads}
            options={ARROW_HEADS}
            labels={ARROW_HEAD_LABELS}
            disabled={none || read?.heads === undefined}
            onChange={(heads) => restyle({ heads })}
          />
        </span>
        <span className="shape-editor-style-item">
          <span>Head size</span>
          <StyleSelect<ArrowHeadSize>
            label={`Head size of ${what}`}
            value={read?.headSize}
            options={ARROW_HEAD_SIZES}
            labels={ARROW_HEAD_SIZE_LABELS}
            disabled={none || read?.headSize === undefined || read?.heads === 'none'}
            onChange={(headSize) => restyle({ headSize })}
          />
        </span>
        <span className="shape-editor-style-item">
          <button
            type="button"
            className="shape-editor-highlighter"
            disabled={!editable || (selection.length > 0 && rectangles.length === 0)}
            title={
              selection.length === 0
                ? 'Highlighter: draw the next rectangle with no border and a 35 % yellow fill'
                : 'Highlighter: no border and a 35 % yellow fill on the selected rectangles'
            }
            onClick={highlight}
          >
            Highlighter
          </button>
          <button
            type="button"
            disabled={!editable || reorderedShapes(group.shapes, selectedSet, 'forward') === null}
            title="Bring forward: draw the selection one step higher in the group"
            onClick={() => reorder('forward')}
          >
            Bring forward
          </button>
          <button
            type="button"
            disabled={!editable || reorderedShapes(group.shapes, selectedSet, 'backward') === null}
            title="Send backward: draw the selection one step lower in the group"
            onClick={() => reorder('backward')}
          >
            Send backward
          </button>
        </span>
      </div>
      <FrameEditor
        timeline={pictureTimeline}
        sequenceTime={scrub}
        // Editing, the still leaves this group out and never changes with
        // it. The result is the composite with the group in it, so the key
        // carries everything about the group the composer draws.
        frameKey={
          showResult
            ? `shape-editor#${group.id}#result#${JSON.stringify([
                group.offset,
                group.duration,
                group.fadeIn ?? 0,
                group.fadeOut ?? 0,
                group.shapes,
              ])}`
            : `shape-editor#${group.id}`
        }
        rect={{ x: 0, y: 0, width: 1, height: 1 }}
        applyGesture={(start) => start}
        onCommit={() => undefined}
        label={`Shapes of ${position}`}
        showRegion={false}
        // A loop lands a frame every few dozen milliseconds; the badge would
        // only flicker over the motion, which is itself the sign of progress.
        showRenderingIndicator={!looping}
        fallbackAspect={aspect}
        {...(snapshot === undefined ? {} : { snapshot })}
        layer={(laidOut) => {
          size = laidOut
          return (
            <>
              {!showResult && (
                <ShapeCanvas groupId={group.id} shapes={shapes} width={laidOut.width} height={laidOut.height} />
              )}
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
                {!showResult &&
                  others.map((other, index) =>
                    outline(other, `other-${index}`, 'shape-editor-other', 'shape-editor-other'),
                  )}
                {shapes.map((shape, index) => (
                  <g
                    key={shape.id}
                    role="img"
                    aria-label={shapeName(shape, index, position)}
                    data-testid={`shape-editor-shape-${index}`}
                    data-selected={selectedSet.has(shape.id) ? 'true' : undefined}
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
                {selection.length > 0 && !drawing && editable && (
                  <g data-testid="shape-editor-selection">
                    {/* A box gets a dashed outline; an arrow's two end rings
                        are enough, and a dashed line along it would paint
                        over the very line being placed. Handles only for a
                        single shape: several move together, and are
                        resized one at a time. */}
                    {selection.map((shape) =>
                      shape.kind === 'arrow'
                        ? single === null && arrowEnds(shape, false)
                        : outline(shape, `selection-${shape.id}`, 'shape-editor-selected', 'shape-editor-selected'),
                    )}
                    {single !== null && boxHandles(single)}
                  </g>
                )}
              </svg>
            </>
          )
        }}
      />
      <div className="effect-editor-scrub">
        <span>Preview</span>
        <input
          type="range"
          aria-label={`Preview time of ${position} in seconds`}
          min={span.start}
          max={span.end}
          step={ZOOM_SCRUB_STEP}
          value={scrub}
          // Read-only while the loop drives it, as the other editors' are.
          disabled={looping}
          onChange={(event) => setScrubbed(Number(event.target.value))}
        />
        <output aria-label={`${position} preview time (live)`}>{seconds(scrub)}</output>
        <label className="effect-editor-result">
          <input
            type="checkbox"
            checked={showResult}
            onChange={(event) => {
              setShowResult(event.target.checked)
              setDrag(null)
            }}
          />
          Show result
        </label>
        <button
          type="button"
          className="effect-editor-loop"
          data-testid="shape-editor-loop"
          aria-pressed={looping}
          aria-label={`Loop the window of ${position}`}
          title={
            looping
              ? 'Pause the loop, leaving the preview where it is'
              : 'Loop: play the group’s window on repeat, resting a second on its first and last frame'
          }
          onClick={() => setLooping((on) => !on)}
        >
          ↻ Loop
        </button>
      </div>
      {/* What the chosen tool does, below the picture: text that changes
          length above it would move the frame under the pointer. */}
      <p className="effect-editor-readout shape-editor-status" data-testid="shape-editor-status">
        {showResult ? 'Result' : drawing ? 'Drawing' : 'Selecting'}: {notice ?? guidance}
      </p>
      <p className="effect-editor-hint" id={hintId}>
        Choose Rectangle, Ellipse or Arrow and drag on the picture to draw; hold Shift for a square, a
        circle or an arrow at 15° steps. Choose Badge and click to place the next numbered badge. With Select, click a shape, or Shift-click to add one to the
        selection, then drag it or a handle; arrow keys nudge the selection, Shift for five times as
        far, and + and − resize it. Delete removes the selection and Ctrl+D (Cmd+D on a Mac)
        duplicates it. Alt while dragging ignores the guides.{' '}
        {looping ? 'Loop is playing the window; pause it to scrub by hand. ' : ''}
        Each drag, key press or style change is one undo step, and the fields above show the same
        values.
      </p>
    </div>
  )
}
