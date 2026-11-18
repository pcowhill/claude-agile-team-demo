/**
 * Shape annotations (#683, from the approved design #681 for feedback #679):
 * rectangles and ellipses drawn on the output frame in timed **shape
 * groups**. A group shows for a window of sequence time and fades as a
 * whole, exactly as a text overlay does (#139/#177); its shapes appear and
 * disappear together, which is what the customer asked for instead of
 * timing three circles by hand.
 *
 * Geometry is in frame fractions, like text positions and overlay
 * rectangles, so a canvas preset or export size never needs a migration.
 * Border thickness and corner radius are fractions of the frame's
 * **shorter side** — the spotlight-softening rule — so a shape keeps its
 * look at every output size; the row shows them in px at the current output
 * frame (#681 §2, approved answer 4a).
 *
 * One drawing routine (`drawShapeGroups`) serves the preview's canvas, the
 * export's composer, Save frame as PNG and the GIF plugin, so the renders
 * cannot drift — the same idiom as `drawSpotlights`.
 */

/** The shapes this version draws; arrows follow in #684. */
export const SHAPE_KINDS = ['rectangle', 'ellipse'] as const
export type ShapeKind = (typeof SHAPE_KINDS)[number]

export function isShapeKind(value: unknown): value is ShapeKind {
  return typeof value === 'string' && (SHAPE_KINDS as readonly string[]).includes(value)
}

/** How each kind reads in a group's derived name and its row. */
export const SHAPE_KIND_LABELS: Record<ShapeKind, string> = {
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
}

/** A shape's look (#681 §2, PowerPoint's *Format Shape*). */
export interface ShapeStyle {
  /** Border colour, lowercase #rrggbb. */
  stroke: string
  /** Border opacity, 0..1. */
  strokeOpacity: number
  /** Border thickness as a fraction of the frame's shorter side; 0 = no border. */
  thickness: number
  /** Fill colour, lowercase #rrggbb. */
  fill: string
  /** Fill opacity, 0..1; 0 is a transparent centre. */
  fillOpacity: number
}

export interface Shape extends ShapeStyle {
  id: string
  kind: ShapeKind
  /** Left edge of the shape's box, as a fraction of frame width. */
  x: number
  /** Top edge of the shape's box, as a fraction of frame height. */
  y: number
  /** Box width, as a fraction of frame width. */
  width: number
  /** Box height, as a fraction of frame height. */
  height: number
  /**
   * Rectangles only: corner radius as a fraction of the frame's shorter
   * side. Absent or 0 is a sharp corner; ellipses never carry it.
   */
  cornerRadius?: number
}

/** A shape group's editable fields: timing, fades and its shapes. */
export interface ShapeGroupSpec {
  /** Seconds into the composed timeline where the group appears. ≥ 0. */
  offset: number
  /** Seconds the group stays visible. > 0. */
  duration: number
  /** Fade-in seconds (the text rule, #177). Absent means none. */
  fadeIn?: number
  /** Fade-out seconds. Absent means none. */
  fadeOut?: number
  /** Bottom to top: a later shape draws over an earlier one. Never empty. */
  shapes: Shape[]
}

export type ShapeGroup = ShapeGroupSpec & { id: string }

/** The smallest box side a shape may have, as a frame fraction. */
export const MIN_SHAPE_SIZE = 0.005
/** The thickest border, as a fraction of the frame's shorter side. */
export const MAX_SHAPE_THICKNESS = 0.1
/** The largest corner radius, as a fraction of the frame's shorter side. */
export const MAX_CORNER_RADIUS = 0.5
/** What Add ▾ › Shape group gives a new group, in seconds (#681 §1). */
export const DEFAULT_SHAPE_GROUP_DURATION = 3

/**
 * The first shape's style (#681 §2): a red border at full opacity, about
 * 6 px at 1080p, and a transparent centre — the customer's "red circle with
 * a transparent center". The fill colour is the same red, so raising its
 * opacity gives a filled shape without a second choice.
 */
export const DEFAULT_SHAPE_STYLE: ShapeStyle = {
  stroke: '#e53935',
  strokeOpacity: 1,
  thickness: 6 / 1080,
  fill: '#e53935',
  fillOpacity: 0,
}

/** A new shape of a kind, centred in the frame, in the given style. */
export function defaultShape(
  id: string,
  kind: ShapeKind,
  style: ShapeStyle = DEFAULT_SHAPE_STYLE,
): Shape {
  const width = kind === 'ellipse' ? 0.2 : 0.3
  const height = kind === 'ellipse' ? 0.3 : 0.2
  return {
    id,
    kind,
    x: (1 - width) / 2,
    y: (1 - height) / 2,
    width,
    height,
    ...pickStyle(style),
  }
}

/** Add ▾ › Shape group (#681 §1): one red ellipse, 3 s from `offset`. */
export function defaultShapeGroup(id: string, shapeId: string, offset: number): ShapeGroup {
  return {
    id,
    offset: Math.max(0, offset),
    duration: DEFAULT_SHAPE_GROUP_DURATION,
    shapes: [defaultShape(shapeId, 'ellipse')],
  }
}

export function pickStyle(style: ShapeStyle): ShapeStyle {
  return {
    stroke: style.stroke,
    strokeOpacity: style.strokeOpacity,
    thickness: style.thickness,
    fill: style.fill,
    fillOpacity: style.fillOpacity,
  }
}

const COLOR = /^#[0-9a-f]{6}$/

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const fraction = (value: unknown): value is number => finite(value) && value >= 0 && value <= 1

export function isValidShape(shape: Shape): boolean {
  return (
    typeof shape.id === 'string' &&
    shape.id !== '' &&
    isShapeKind(shape.kind) &&
    fraction(shape.x) &&
    fraction(shape.y) &&
    finite(shape.width) &&
    shape.width >= MIN_SHAPE_SIZE &&
    shape.width <= 1 &&
    finite(shape.height) &&
    shape.height >= MIN_SHAPE_SIZE &&
    shape.height <= 1 &&
    typeof shape.stroke === 'string' &&
    COLOR.test(shape.stroke) &&
    fraction(shape.strokeOpacity) &&
    finite(shape.thickness) &&
    shape.thickness >= 0 &&
    shape.thickness <= MAX_SHAPE_THICKNESS &&
    typeof shape.fill === 'string' &&
    COLOR.test(shape.fill) &&
    fraction(shape.fillOpacity) &&
    (shape.cornerRadius === undefined ||
      (shape.kind === 'rectangle' &&
        finite(shape.cornerRadius) &&
        shape.cornerRadius >= 0 &&
        shape.cornerRadius <= MAX_CORNER_RADIUS))
  )
}

/** Whether a group spec is well-formed: the reducer refuses anything else. */
export function isValidShapeGroupSpec(group: ShapeGroupSpec): boolean {
  if (!finite(group.offset) || group.offset < 0) return false
  if (!finite(group.duration) || group.duration <= 0) return false
  if (group.fadeIn !== undefined && (!finite(group.fadeIn) || group.fadeIn < 0)) return false
  if (group.fadeOut !== undefined && (!finite(group.fadeOut) || group.fadeOut < 0)) return false
  if (!Array.isArray(group.shapes) || group.shapes.length === 0) return false
  const ids = new Set<string>()
  for (const shape of group.shapes) {
    if (!isValidShape(shape)) return false
    if (ids.has(shape.id)) return false
    ids.add(shape.id)
  }
  return true
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/**
 * Clamps a group's fades into its window — the text rule (`clampTextOverlay`):
 * `fadeIn` keeps its value first and `fadeOut` absorbs the shortfall. A zero
 * fade is stored as no key, so a group never faded stays shaped as one.
 * Returns the same object when nothing changes.
 */
export function clampShapeGroup(group: ShapeGroup): ShapeGroup {
  const fadeIn = clamp(group.fadeIn ?? 0, 0, group.duration)
  const fadeOut = clamp(group.fadeOut ?? 0, 0, group.duration - fadeIn)
  const storedIn = fadeIn > 0 ? fadeIn : undefined
  const storedOut = fadeOut > 0 ? fadeOut : undefined
  if (storedIn === group.fadeIn && storedOut === group.fadeOut) return group
  const { fadeIn: _in, fadeOut: _out, ...rest } = group
  return {
    ...rest,
    ...(storedIn === undefined ? {} : { fadeIn: storedIn }),
    ...(storedOut === undefined ? {} : { fadeOut: storedOut }),
  }
}

function shapesEqual(a: Shape, b: Shape): boolean {
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.stroke === b.stroke &&
    a.strokeOpacity === b.strokeOpacity &&
    a.thickness === b.thickness &&
    a.fill === b.fill &&
    a.fillOpacity === b.fillOpacity &&
    (a.cornerRadius ?? 0) === (b.cornerRadius ?? 0)
  )
}

export function shapeGroupsEqual(a: ShapeGroup, b: ShapeGroup): boolean {
  return (
    a.id === b.id &&
    a.offset === b.offset &&
    a.duration === b.duration &&
    (a.fadeIn ?? 0) === (b.fadeIn ?? 0) &&
    (a.fadeOut ?? 0) === (b.fadeOut ?? 0) &&
    a.shapes.length === b.shapes.length &&
    a.shapes.every((shape, index) => shapesEqual(shape, b.shapes[index]))
  )
}

/** Visible at a sequence time; half-open on the end, as text is (#139). */
export function shapeGroupActiveAt(group: ShapeGroupSpec, sequenceTime: number): boolean {
  return sequenceTime >= group.offset && sequenceTime < group.offset + group.duration
}

/**
 * The group's opacity at a sequence time: 0 outside its window, otherwise
 * the linear fade envelope — the same shape as `textOpacityAt` (#177), so a
 * group and a caption given the same timing fade identically.
 */
export function shapeGroupOpacityAt(group: ShapeGroupSpec, sequenceTime: number): number {
  if (!shapeGroupActiveAt(group, sequenceTime)) return 0
  const into = sequenceTime - group.offset
  const fadeIn = group.fadeIn ?? 0
  const fadeOut = group.fadeOut ?? 0
  const inRamp = fadeIn > 0 ? Math.min(into / fadeIn, 1) : 1
  const outRamp = fadeOut > 0 ? Math.min((group.duration - into) / fadeOut, 1) : 1
  return Math.min(inRamp, outRamp)
}

/**
 * A shape that draws nothing (#681 §6): no visible border and no visible
 * fill. The fields allow it; the row explains it.
 */
export function isInvisibleShape(shape: ShapeStyle): boolean {
  const borderVisible = shape.thickness > 0 && shape.strokeOpacity > 0
  const fillVisible = shape.fillOpacity > 0
  return !borderVisible && !fillVisible
}

/**
 * The name a group's row shows (#681 §1): its shapes by kind, in first-seen
 * order, counted — *Ellipse*, *Ellipse + Rectangle*, *3 ellipses*.
 */
export function shapeGroupLabel(group: ShapeGroupSpec): string {
  const counts = new Map<ShapeKind, number>()
  for (const shape of group.shapes) counts.set(shape.kind, (counts.get(shape.kind) ?? 0) + 1)
  return [...counts.entries()]
    .map(([kind, count]) =>
      count === 1 ? SHAPE_KIND_LABELS[kind] : `${count} ${SHAPE_KIND_LABELS[kind].toLowerCase()}s`,
    )
    .join(' + ')
}

/** A fraction of the frame's shorter side in output pixels — what the row shows. */
export function shorterSidePixels(value: number, frameWidth: number, frameHeight: number): number {
  return value * Math.min(frameWidth, frameHeight)
}

/** The inverse of `shorterSidePixels`, for a px value typed into a field. */
export function shorterSideFraction(pixels: number, frameWidth: number, frameHeight: number): number {
  const side = Math.min(frameWidth, frameHeight)
  return side > 0 ? pixels / side : 0
}

/**
 * The groups to draw at an instant, bottom to top (#681 §4): the one that
 * starts later is on top; groups starting together keep their list order.
 */
export function activeShapeGroups(
  groups: readonly ShapeGroup[],
  sequenceTime: number,
): ShapeGroup[] {
  return groups
    .map((group, index) => ({ group, index }))
    .filter(({ group }) => shapeGroupActiveAt(group, sequenceTime))
    .sort((a, b) => a.group.offset - b.group.offset || a.index - b.index)
    .map(({ group }) => group)
}

/** The 2D-context surface the draw uses, so tests can record calls. */
export type ShapeContext = Pick<
  CanvasRenderingContext2D,
  | 'save'
  | 'restore'
  | 'beginPath'
  | 'closePath'
  | 'moveTo'
  | 'lineTo'
  | 'arcTo'
  | 'ellipse'
  | 'rect'
  | 'fill'
  | 'stroke'
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'lineJoin'
  | 'globalAlpha'
>

function traceShape(context: ShapeContext, shape: Shape, frameWidth: number, frameHeight: number) {
  const x = shape.x * frameWidth
  const y = shape.y * frameHeight
  const width = shape.width * frameWidth
  const height = shape.height * frameHeight
  context.beginPath()
  if (shape.kind === 'ellipse') {
    context.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2)
    return
  }
  const radius = Math.min(
    shorterSidePixels(shape.cornerRadius ?? 0, frameWidth, frameHeight),
    width / 2,
    height / 2,
  )
  if (radius <= 0) {
    context.rect(x, y, width, height)
    return
  }
  context.moveTo(x + radius, y)
  context.arcTo(x + width, y, x + width, y + height, radius)
  context.arcTo(x + width, y + height, x, y + height, radius)
  context.arcTo(x, y + height, x, y, radius)
  context.arcTo(x, y, x + width, y, radius)
  context.closePath()
}

/**
 * Draws every shape group visible at `sequenceTime` onto a frame-sized
 * context (#683). The one routine the preview, the export's composer, Save
 * frame as PNG and the GIF plugin all call, so the four cannot disagree.
 *
 * Each shape fills first and strokes second, the border centred on the
 * outline as PowerPoint draws it. The group's fade multiplies each shape's
 * own opacities, so a group fading in brings its shapes up together.
 */
export function drawShapeGroups(
  context: ShapeContext,
  groups: readonly ShapeGroup[],
  sequenceTime: number,
  frameWidth: number,
  frameHeight: number,
): void {
  const active = activeShapeGroups(groups, sequenceTime)
  if (active.length === 0) return
  context.save()
  context.lineJoin = 'round'
  for (const group of active) {
    const opacity = shapeGroupOpacityAt(group, sequenceTime)
    if (opacity <= 0) continue
    for (const shape of group.shapes) {
      traceShape(context, shape, frameWidth, frameHeight)
      if (shape.fillOpacity > 0) {
        context.globalAlpha = shape.fillOpacity * opacity
        context.fillStyle = shape.fill
        context.fill()
      }
      const lineWidth = shorterSidePixels(shape.thickness, frameWidth, frameHeight)
      if (lineWidth > 0 && shape.strokeOpacity > 0) {
        context.globalAlpha = shape.strokeOpacity * opacity
        context.strokeStyle = shape.stroke
        context.lineWidth = lineWidth
        context.stroke()
      }
    }
  }
  context.restore()
}
