/**
 * Shape annotations (#683, from the approved design #681 for feedback #679):
 * rectangles, ellipses, arrows (#684) and numbered badges (#689) drawn on the
 * output frame in timed **shape groups**. A group shows for a window of
 * sequence time and fades as a whole, exactly as a text overlay does (#139/#177); its shapes appear and
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

import { textFontStack } from './textOverlay'

/**
 * The shapes this version draws: rectangles and ellipses (#683), defined by
 * a box; arrows (#684), defined by a tail and a tip point; and numbered step
 * badges (#689), defined by a centre and a diameter.
 */
export const SHAPE_KINDS = ['rectangle', 'ellipse', 'arrow', 'badge'] as const
export type ShapeKind = (typeof SHAPE_KINDS)[number]
/** The kinds placed by a box (x, y, width, height). */
export type BoxShapeKind = Exclude<ShapeKind, 'arrow' | 'badge'>

export function isShapeKind(value: unknown): value is ShapeKind {
  return typeof value === 'string' && (SHAPE_KINDS as readonly string[]).includes(value)
}

/** How each kind reads in a group's derived name and its row. */
export const SHAPE_KIND_LABELS: Record<ShapeKind, string> = {
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  arrow: 'Arrow',
  badge: 'Badge',
}

/**
 * Where an arrow carries heads (#681 §2): at the tip, at both ends, or
 * nowhere — an arrow with no head is a plain line.
 */
export const ARROW_HEADS = ['tip', 'both', 'none'] as const
export type ArrowHeads = (typeof ARROW_HEADS)[number]

export function isArrowHeads(value: unknown): value is ArrowHeads {
  return typeof value === 'string' && (ARROW_HEADS as readonly string[]).includes(value)
}

export const ARROW_HEAD_LABELS: Record<ArrowHeads, string> = {
  tip: 'At the tip',
  both: 'Both ends',
  none: 'None (a line)',
}

/** An arrow head's size: a preset, as PowerPoint offers (#684). */
export const ARROW_HEAD_SIZES = ['small', 'medium', 'large'] as const
export type ArrowHeadSize = (typeof ARROW_HEAD_SIZES)[number]

export function isArrowHeadSize(value: unknown): value is ArrowHeadSize {
  return typeof value === 'string' && (ARROW_HEAD_SIZES as readonly string[]).includes(value)
}

export const ARROW_HEAD_SIZE_LABELS: Record<ArrowHeadSize, string> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
}

/**
 * A head's length, as a multiple of the arrow's border thickness: the head
 * scales with the line it ends (#681 §9's mitigation), so a thicker arrow
 * gets a proportionally bigger head.
 */
export const ARROW_HEAD_SIZE_FACTORS: Record<ArrowHeadSize, number> = {
  small: 3,
  medium: 4.5,
  large: 6,
}

/**
 * The shortest a head may be, as a fraction of the frame's shorter side —
 * about 22 px at 1080p and 7 px at 360p — so a 1 px arrow still ends in a
 * recognisable head rather than a 3 px nub (#684).
 */
export const MIN_ARROW_HEAD = 0.02

/** A head's width across its base, as a multiple of its length. */
export const ARROW_HEAD_WIDTH_RATIO = 1

/**
 * How a shape's border is drawn (#688, extra C of #681): solid, dashed or
 * dotted. It applies to a rectangle's or ellipse's border and to an arrow's
 * shaft; an arrow's heads stay solid.
 */
export const LINE_STYLES = ['solid', 'dashed', 'dotted'] as const
export type LineStyle = (typeof LINE_STYLES)[number]

export function isLineStyle(value: unknown): value is LineStyle {
  return typeof value === 'string' && (LINE_STYLES as readonly string[]).includes(value)
}

export const LINE_STYLE_LABELS: Record<LineStyle, string> = {
  solid: 'Solid',
  dashed: 'Dashed',
  dotted: 'Dotted',
}

/**
 * A line style's dash and gap, as multiples of the border's thickness
 * (#688), so a style looks the same at every output size and every
 * thickness. Dashes are three thicknesses long with two between; dots are
 * square, one thickness each way. Solid has no pattern.
 */
export const LINE_DASH_FACTORS: Record<Exclude<LineStyle, 'solid'>, readonly [number, number]> = {
  dashed: [3, 2],
  dotted: [1, 1],
}

/** The canvas dash pattern for a line style at a line width in px; empty for solid. */
export function lineDashFor(lineStyle: LineStyle | undefined, lineWidth: number): number[] {
  if (lineStyle === undefined || lineStyle === 'solid' || lineWidth <= 0) return []
  const [dash, gap] = LINE_DASH_FACTORS[lineStyle]
  return [dash * lineWidth, gap * lineWidth]
}

/**
 * A shape with its line style set (#688). Solid is stored as no key, so a
 * shape that was never dashed and one dashed and set back read — and save —
 * the same, and a file without the field opens with every shape solid.
 */
export function withLineStyle<T extends ShapeStyle>(shape: T, lineStyle: LineStyle): T {
  if (lineStyle !== 'solid') return { ...shape, lineStyle }
  if (shape.lineStyle === undefined) return shape
  const { lineStyle: _dropped, ...rest } = shape
  return rest as T
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
  /**
   * The border's line style (#688). Absent is solid — what every shape
   * saved before it reads as; `withLineStyle` stores solid as no key.
   */
  lineStyle?: LineStyle
}

/**
 * A rectangle or an ellipse (#683): a box in frame fractions. The style is
 * common to every kind, so a new shape can take the last shape's style
 * whatever kind either is (#681 §2).
 */
export interface BoxShape extends ShapeStyle {
  id: string
  kind: BoxShapeKind
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

/**
 * An arrow or a line (#684): from a tail point to a tip point, each in frame
 * fractions. It is drawn in its border colour, opacity and thickness, heads
 * included; it carries a fill like every shape (so the style passes on to
 * the next shape added) but never draws one.
 */
export interface ArrowShape extends ShapeStyle {
  id: string
  kind: 'arrow'
  /** The tail's x, as a fraction of frame width. */
  tailX: number
  /** The tail's y, as a fraction of frame height. */
  tailY: number
  /** The tip's x, as a fraction of frame width. */
  tipX: number
  /** The tip's y, as a fraction of frame height. */
  tipY: number
  heads: ArrowHeads
  headSize: ArrowHeadSize
}

/**
 * A numbered step badge (#689, extra A of #681): a filled circle with a
 * number centred in it, for walking a viewer through a sequence of clicks.
 *
 * It is placed by its **centre**, in frame fractions, and sized by its
 * **diameter** as a fraction of the frame's shorter side — the thickness
 * rule — so it is round at every canvas preset and export size, which a box
 * in frame fractions could not promise. It carries the common style: its
 * fill is the disc, its border rings it, and the number is drawn in its own
 * colour on top.
 */
export interface BadgeShape extends ShapeStyle {
  id: string
  kind: 'badge'
  /** The centre's x, as a fraction of frame width. */
  centerX: number
  /** The centre's y, as a fraction of frame height. */
  centerY: number
  /** Diameter, as a fraction of the frame's shorter side. */
  size: number
  /** The number shown: a whole number from 0 to `MAX_BADGE_NUMBER`. */
  number: number
  /** The number's colour, lowercase #rrggbb. */
  numberColor: string
}

export type Shape = BoxShape | ArrowShape | BadgeShape

export function isArrow(shape: Shape): shape is ArrowShape {
  return shape.kind === 'arrow'
}

/** Whether a shape is placed by a box (a rectangle or an ellipse). */
export function isBoxShape(shape: Shape): shape is BoxShape {
  return shape.kind === 'rectangle' || shape.kind === 'ellipse'
}

/**
 * Whether a shape's kind draws its fill (#689): a box's inside and a
 * badge's disc do; an arrow is all border and never does (#684).
 */
export function drawsFill(kind: ShapeKind): boolean {
  return kind !== 'arrow'
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
  /**
   * The *Draw on* entrance's length in seconds (#690). Present means the
   * group enters by drawing its shapes on over this many seconds from its
   * start (`shapeGroupRevealAt`); absent is the *Fade* entrance, which
   * every group saved before it reads as. The two entrances are
   * alternatives, so a group never holds this and `fadeIn` together: it
   * takes `fadeIn`'s place in the window, and `clampShapeGroup` fits it
   * there exactly as it fits a fade-in. > 0.
   */
  drawOn?: number
  /** Bottom to top: a later shape draws over an earlier one. Never empty. */
  shapes: Shape[]
  /**
   * The group's own name, set by Rename… (#687). Absent means the row shows
   * the name derived from its shapes (`shapeGroupLabel`), so clearing it
   * returns to that. When present it is trimmed and never empty.
   */
  name?: string
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

/** The entrances a shape group can make (#690): fade in, or draw on. */
export const SHAPE_ENTRANCES = ['fade', 'draw-on'] as const
export type ShapeEntrance = (typeof SHAPE_ENTRANCES)[number]

export const SHAPE_ENTRANCE_LABELS: Record<ShapeEntrance, string> = {
  fade: 'Fade',
  'draw-on': 'Draw on',
}

/** A group's entrance: *Draw on* exactly when it holds a draw-on time. */
export function shapeGroupEntrance(group: Pick<ShapeGroupSpec, 'drawOn'>): ShapeEntrance {
  return group.drawOn === undefined ? 'fade' : 'draw-on'
}

/** Seconds a group switched to *Draw on* takes, when it had no fade-in to keep. */
export const DEFAULT_DRAW_ON = 1

/**
 * The group with its entrance switched (#690). The entrance's length moves
 * with it: a fade-in becomes a draw-on of the same length and back, so
 * switching twice returns the group it started from. A group with no
 * fade-in draws on over `DEFAULT_DRAW_ON`, or its whole window if that is
 * shorter. Same object when the entrance is already the one asked for.
 */
export function withShapeEntrance<T extends ShapeGroupSpec>(group: T, entrance: ShapeEntrance): T {
  if (shapeGroupEntrance(group) === entrance) return group
  const { fadeIn, drawOn, ...rest } = group
  if (entrance === 'fade') {
    return { ...rest, ...(drawOn === undefined || drawOn <= 0 ? {} : { fadeIn: drawOn }) } as T
  }
  const length = fadeIn !== undefined && fadeIn > 0 ? fadeIn : Math.min(DEFAULT_DRAW_ON, group.duration)
  return { ...rest, drawOn: length } as T
}

/**
 * A badge's smallest diameter, as a fraction of the frame's shorter side:
 * about 22 px at 1080p and 7 px at 360p, below which no digit is legible.
 */
export const MIN_BADGE_SIZE = 0.02
/** A badge's largest diameter: half the frame's shorter side. */
export const MAX_BADGE_SIZE = 0.5
/**
 * A new badge's diameter (#689): about 86 px at 1080p and 29 px at 360p,
 * the size of a mouse-click marker in a screen recording.
 */
export const DEFAULT_BADGE_SIZE = 0.08
/** The highest number a badge shows: three digits still fit its disc. */
export const MAX_BADGE_NUMBER = 999

/**
 * A badge's own look (#689): a solid red disc (`#E53935` at 100 %, the
 * shapes' red), a white number, and no border until one is given — the
 * border colour is white, so giving it a thickness rings the disc in white.
 */
export const DEFAULT_BADGE_STYLE: ShapeStyle & Pick<BadgeShape, 'numberColor'> = {
  stroke: '#ffffff',
  strokeOpacity: 1,
  thickness: 0,
  fill: '#e53935',
  fillOpacity: 1,
  numberColor: '#ffffff',
}

/**
 * The number the next badge in a group takes (#689): one more than the
 * highest badge already there, or 1 in a group without one. Deleting a
 * badge renumbers nothing, so after 1, 2, 3 with 2 deleted the next is 4.
 */
export function nextBadgeNumber(shapes: readonly Shape[]): number {
  let highest = 0
  for (const shape of shapes) if (shape.kind === 'badge') highest = Math.max(highest, shape.number)
  return Math.min(highest + 1, MAX_BADGE_NUMBER)
}

/** How far right of the group's last badge a badge added from the row lands. */
export const BADGE_ADD_STEP = 0.1

/**
 * A new badge for a group (#689): the next number, and the look of the
 * group's last badge (its style, size and number colour) or else the badge
 * defaults — never the last rectangle's or arrow's style, whose transparent
 * fill would leave a number floating with no disc behind it.
 *
 * It is centred at `center` when given (a click in the shape editor);
 * otherwise `BADGE_ADD_STEP` right of the group's last badge, wrapping to
 * the left a step lower at the frame's edge, or at the frame's centre for
 * the group's first badge — so badges added from the row do not stack.
 */
export function newBadge(id: string, shapes: readonly Shape[], center?: { x: number; y: number }): BadgeShape {
  const badges = shapes.filter((shape): shape is BadgeShape => shape.kind === 'badge')
  const last = badges[badges.length - 1]
  const base = defaultShape(id, 'badge')
  const look =
    last === undefined
      ? {}
      : { ...pickStyle(last), size: last.size, numberColor: last.numberColor }
  let centerX = 0.5
  let centerY = 0.5
  if (center !== undefined) {
    centerX = center.x
    centerY = center.y
  } else if (last !== undefined) {
    centerX = last.centerX + BADGE_ADD_STEP
    centerY = last.centerY
    if (centerX > 1 - BADGE_ADD_STEP / 2) {
      centerX = BADGE_ADD_STEP
      centerY = last.centerY + BADGE_ADD_STEP > 1 ? BADGE_ADD_STEP : last.centerY + BADGE_ADD_STEP
    }
  }
  const round = (value: number) => Math.round(clamp(value, 0, 1) * 100) / 100
  return {
    ...base,
    ...look,
    centerX: round(centerX),
    centerY: round(centerY),
    number: nextBadgeNumber(shapes),
  }
}

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

/**
 * A new shape of a kind, centred in the frame, in the given style. A badge
 * ignores the style and takes the badge defaults, numbered 1; `newBadge` is
 * what gives it a group's next number and last badge's look.
 */
export function defaultShape(id: string, kind: 'arrow', style?: ShapeStyle): ArrowShape
export function defaultShape(id: string, kind: 'badge', style?: ShapeStyle): BadgeShape
export function defaultShape(id: string, kind: BoxShapeKind, style?: ShapeStyle): BoxShape
export function defaultShape(id: string, kind: ShapeKind, style?: ShapeStyle): Shape
export function defaultShape(
  id: string,
  kind: ShapeKind,
  style: ShapeStyle = DEFAULT_SHAPE_STYLE,
): Shape {
  if (kind === 'badge') {
    return {
      id,
      kind,
      centerX: 0.5,
      centerY: 0.5,
      size: DEFAULT_BADGE_SIZE,
      number: 1,
      ...DEFAULT_BADGE_STYLE,
    }
  }
  if (kind === 'arrow') {
    // Across the middle of the frame, pointing right (#684).
    return {
      id,
      kind,
      tailX: 0.35,
      tailY: 0.5,
      tipX: 0.65,
      tipY: 0.5,
      heads: 'tip',
      headSize: 'medium',
      ...pickStyle(style),
    }
  }
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

/**
 * The style the next rectangle, ellipse or arrow in a group takes (#681 §2,
 * "the last shape you drew or edited"): the group's last such shape's. A
 * badge is passed over (#689): its solid disc would otherwise turn the next
 * ellipse into a solid red blot over the very thing it is meant to circle.
 */
export function styleForNextShape(shapes: readonly Shape[]): ShapeStyle {
  for (let index = shapes.length - 1; index >= 0; index -= 1) {
    if (shapes[index].kind !== 'badge') return pickStyle(shapes[index])
  }
  return pickStyle(DEFAULT_SHAPE_STYLE)
}

export function pickStyle(style: ShapeStyle): ShapeStyle {
  const picked: ShapeStyle = {
    stroke: style.stroke,
    strokeOpacity: style.strokeOpacity,
    thickness: style.thickness,
    fill: style.fill,
    fillOpacity: style.fillOpacity,
  }
  return withLineStyle(picked, style.lineStyle ?? 'solid')
}

const COLOR = /^#[0-9a-f]{6}$/

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const fraction = (value: unknown): value is number => finite(value) && value >= 0 && value <= 1

function isValidStyle(style: ShapeStyle): boolean {
  return (
    typeof style.stroke === 'string' &&
    COLOR.test(style.stroke) &&
    fraction(style.strokeOpacity) &&
    finite(style.thickness) &&
    style.thickness >= 0 &&
    style.thickness <= MAX_SHAPE_THICKNESS &&
    typeof style.fill === 'string' &&
    COLOR.test(style.fill) &&
    fraction(style.fillOpacity) &&
    (style.lineStyle === undefined || isLineStyle(style.lineStyle))
  )
}

export function isValidShape(shape: Shape): boolean {
  if (typeof shape.id !== 'string' || shape.id === '' || !isShapeKind(shape.kind)) return false
  if (!isValidStyle(shape)) return false
  if (shape.kind === 'badge') {
    return (
      fraction(shape.centerX) &&
      fraction(shape.centerY) &&
      finite(shape.size) &&
      shape.size >= MIN_BADGE_SIZE &&
      shape.size <= MAX_BADGE_SIZE &&
      Number.isInteger(shape.number) &&
      shape.number >= 0 &&
      shape.number <= MAX_BADGE_NUMBER &&
      typeof shape.numberColor === 'string' &&
      COLOR.test(shape.numberColor)
    )
  }
  if (shape.kind === 'arrow') {
    return (
      fraction(shape.tailX) &&
      fraction(shape.tailY) &&
      fraction(shape.tipX) &&
      fraction(shape.tipY) &&
      // A zero-length arrow has no direction to point in.
      Math.hypot(shape.tipX - shape.tailX, shape.tipY - shape.tailY) >= MIN_SHAPE_SIZE &&
      isArrowHeads(shape.heads) &&
      isArrowHeadSize(shape.headSize)
    )
  }
  return (
    fraction(shape.x) &&
    fraction(shape.y) &&
    finite(shape.width) &&
    shape.width >= MIN_SHAPE_SIZE &&
    shape.width <= 1 &&
    finite(shape.height) &&
    shape.height >= MIN_SHAPE_SIZE &&
    shape.height <= 1 &&
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
  if (group.drawOn !== undefined) {
    if (!finite(group.drawOn) || group.drawOn <= 0) return false
    // The entrances are alternatives (#690): a group draws on or fades in.
    if (group.fadeIn !== undefined) return false
  }
  if (
    group.name !== undefined &&
    (typeof group.name !== 'string' || group.name === '' || group.name !== group.name.trim())
  ) {
    return false
  }
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
 * A draw-on (#690) takes the fade-in's place in that rule: it is clamped to
 * the window, and the fade-out absorbs what it leaves. It stays a key even
 * when clamped, since it is the entrance itself, not only its length.
 * Returns the same object when nothing changes.
 */
export function clampShapeGroup(group: ShapeGroup): ShapeGroup {
  const drawOn = group.drawOn === undefined ? undefined : Math.min(group.drawOn, group.duration)
  const fadeIn = drawOn === undefined ? clamp(group.fadeIn ?? 0, 0, group.duration) : 0
  const fadeOut = clamp(group.fadeOut ?? 0, 0, group.duration - (drawOn ?? fadeIn))
  const storedIn = fadeIn > 0 ? fadeIn : undefined
  const storedOut = fadeOut > 0 ? fadeOut : undefined
  if (storedIn === group.fadeIn && storedOut === group.fadeOut && drawOn === group.drawOn) return group
  const { fadeIn: _in, fadeOut: _out, drawOn: _drawOn, ...rest } = group
  return {
    ...rest,
    ...(storedIn === undefined ? {} : { fadeIn: storedIn }),
    ...(storedOut === undefined ? {} : { fadeOut: storedOut }),
    ...(drawOn === undefined ? {} : { drawOn }),
  }
}

function stylesEqual(a: ShapeStyle, b: ShapeStyle): boolean {
  return (
    a.stroke === b.stroke &&
    a.strokeOpacity === b.strokeOpacity &&
    a.thickness === b.thickness &&
    a.fill === b.fill &&
    a.fillOpacity === b.fillOpacity &&
    (a.lineStyle ?? 'solid') === (b.lineStyle ?? 'solid')
  )
}

function shapesEqual(a: Shape, b: Shape): boolean {
  if (a.id !== b.id || !stylesEqual(a, b)) return false
  if (a.kind === 'badge' || b.kind === 'badge') {
    return (
      a.kind === 'badge' &&
      b.kind === 'badge' &&
      a.centerX === b.centerX &&
      a.centerY === b.centerY &&
      a.size === b.size &&
      a.number === b.number &&
      a.numberColor === b.numberColor
    )
  }
  if (a.kind === 'arrow' || b.kind === 'arrow') {
    return (
      a.kind === 'arrow' &&
      b.kind === 'arrow' &&
      a.tailX === b.tailX &&
      a.tailY === b.tailY &&
      a.tipX === b.tipX &&
      a.tipY === b.tipY &&
      a.heads === b.heads &&
      a.headSize === b.headSize
    )
  }
  return (
    a.kind === b.kind &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    (a.cornerRadius ?? 0) === (b.cornerRadius ?? 0)
  )
}

export function shapeGroupsEqual(a: ShapeGroup, b: ShapeGroup): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.offset === b.offset &&
    a.duration === b.duration &&
    (a.fadeIn ?? 0) === (b.fadeIn ?? 0) &&
    (a.fadeOut ?? 0) === (b.fadeOut ?? 0) &&
    a.drawOn === b.drawOn &&
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
 * How much of a group's shapes is drawn at a sequence time (#690), 0..1: 1
 * for a group that fades in (or none), and for a *Draw on* group the time
 * into its window over its draw-on time, clamped — so it starts at 0 on
 * the group's first instant and holds at 1 once the draw-on is over. The
 * draw-on itself is clamped into the window by `clampShapeGroup`, as a
 * fade-in is, so a group always finishes drawing before it ends.
 */
export function shapeGroupRevealAt(group: ShapeGroupSpec, sequenceTime: number): number {
  const drawOn = group.drawOn
  if (drawOn === undefined || drawOn <= 0) return 1
  return clamp((sequenceTime - group.offset) / drawOn, 0, 1)
}

/**
 * A shape that draws nothing (#681 §6): no visible border and no visible
 * fill. The fields allow it; the row explains it. An arrow draws only in
 * its border style, so its fill never makes it visible (#684). A badge
 * always draws its number (#689), so it is never invisible.
 */
export function isInvisibleShape(shape: ShapeStyle & { kind?: ShapeKind }): boolean {
  if (shape.kind === 'badge') return false
  const borderVisible = shape.thickness > 0 && shape.strokeOpacity > 0
  const fillVisible = shape.kind !== 'arrow' && shape.fillOpacity > 0
  return !borderVisible && !fillVisible
}

/**
 * The name derived from a group's shapes (#681 §1), which its row shows
 * unless the group has been renamed (`shapeGroupName`): its shapes by kind, in first-seen
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

/**
 * The name a group's row shows: its own, set by Rename… (#687), or else the
 * one derived from its shapes.
 */
export function shapeGroupName(group: ShapeGroupSpec): string {
  return group.name ?? shapeGroupLabel(group)
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
  | 'lineCap'
  | 'setLineDash'
  | 'globalAlpha'
  | 'fillText'
  | 'font'
  | 'textAlign'
  | 'textBaseline'
>

/** A point in frame pixels. */
export interface Point {
  x: number
  y: number
}

/**
 * An arrow's outline in frame pixels (#684): one closed polygon — the shaft
 * as a band of the border's thickness, widened into a triangle at each end
 * that carries a head. Filling one polygon (rather than stroking a shaft and
 * filling heads separately) means a half-opaque arrow has no darker seam
 * where shaft and head would overlap.
 *
 * A head is `ARROW_HEAD_SIZE_FACTORS[size]` times the thickness long, never
 * shorter than `MIN_ARROW_HEAD` of the frame's shorter side, and never
 * longer than the arrow can hold (half of it per head with heads at both
 * ends). Empty when the arrow has no thickness or no length.
 */
export function arrowOutline(shape: ArrowShape, frameWidth: number, frameHeight: number): Point[] {
  const geometry = arrowGeometry(shape, frameWidth, frameHeight)
  if (geometry === null) return []
  const { tail, tip, at, halfLine, headLength, halfHead } = geometry
  if (shape.heads === 'none') {
    return [at(tail, 0, halfLine), at(tip, 0, halfLine), at(tip, 0, -halfLine), at(tail, 0, -halfLine)]
  }
  const points: Point[] = []
  if (shape.heads === 'both') {
    points.push(tail, at(tail, headLength, halfHead), at(tail, headLength, halfLine))
  } else {
    points.push(at(tail, 0, halfLine))
  }
  points.push(
    at(tip, -headLength, halfLine),
    at(tip, -headLength, halfHead),
    tip,
    at(tip, -headLength, -halfHead),
    at(tip, -headLength, -halfLine),
  )
  if (shape.heads === 'both') {
    points.push(at(tail, headLength, -halfLine), at(tail, headLength, -halfHead))
  } else {
    points.push(at(tail, 0, -halfLine))
  }
  return points
}

/** A dashed or dotted arrow's pieces in frame pixels (#688). */
export interface ArrowPieces {
  /** Each head as a solid triangle. */
  heads: Point[][]
  /** The shaft's centre line, from head base to head base (or end). */
  shaft: { from: Point; to: Point }
  lineWidth: number
}

/**
 * A dashed or dotted arrow's pieces (#688): its heads as solid triangles —
 * the same triangles `arrowOutline` draws — and its shaft as the centre
 * line between them, to be stroked with the dash pattern at `lineWidth`.
 * The shaft ends exactly at each head's base, so with butt caps a
 * half-opaque arrow has no darker seam where a dash would overlap a head.
 * Null when the arrow has no thickness or no length.
 */
export function arrowPieces(shape: ArrowShape, frameWidth: number, frameHeight: number): ArrowPieces | null {
  const geometry = arrowGeometry(shape, frameWidth, frameHeight)
  if (geometry === null) return null
  const { tail, tip, at, halfLine, headLength, halfHead } = geometry
  const heads: Point[][] = []
  let from = tail
  let to = tip
  if (shape.heads !== 'none') {
    heads.push([at(tip, -headLength, halfHead), tip, at(tip, -headLength, -halfHead)])
    to = at(tip, -headLength, 0)
  }
  if (shape.heads === 'both') {
    heads.push([at(tail, headLength, halfHead), tail, at(tail, headLength, -halfHead)])
    from = at(tail, headLength, 0)
  }
  return { heads, shaft: { from, to }, lineWidth: halfLine * 2 }
}

/**
 * What `arrowOutline` and `arrowPieces` share: the arrow's ends in frame
 * pixels, a point helper along and across it, and the head's length and
 * half-width as drawn (`headLength` 0 when it has no heads).
 */
function arrowGeometry(shape: ArrowShape, frameWidth: number, frameHeight: number) {
  const tail = { x: shape.tailX * frameWidth, y: shape.tailY * frameHeight }
  const tip = { x: shape.tipX * frameWidth, y: shape.tipY * frameHeight }
  const length = Math.hypot(tip.x - tail.x, tip.y - tail.y)
  const lineWidth = shorterSidePixels(shape.thickness, frameWidth, frameHeight)
  if (length <= 0 || lineWidth <= 0) return null
  // Unit vector along the arrow, and its normal.
  const ux = (tip.x - tail.x) / length
  const uy = (tip.y - tail.y) / length
  const nx = -uy
  const ny = ux
  const at = (from: Point, along: number, across: number): Point => ({
    x: from.x + ux * along + nx * across,
    y: from.y + uy * along + ny * across,
  })
  const halfLine = lineWidth / 2
  const headCount = shape.heads === 'both' ? 2 : shape.heads === 'tip' ? 1 : 0
  const headLength =
    headCount === 0 ? 0 : Math.min(arrowHeadLength(shape, frameWidth, frameHeight), length / headCount)
  // A head never narrower than the shaft it ends.
  const halfHead = Math.max((headLength * ARROW_HEAD_WIDTH_RATIO) / 2, halfLine)
  return { tail, tip, at, halfLine, headLength, halfHead }
}

/**
 * The length an arrow's head is drawn at, before any fitting to the
 * arrow's own length: its size preset times the border thickness, with
 * `MIN_ARROW_HEAD` of the frame's shorter side as the floor (#684).
 */
export function arrowHeadLength(shape: ArrowShape, frameWidth: number, frameHeight: number): number {
  const lineWidth = shorterSidePixels(shape.thickness, frameWidth, frameHeight)
  return Math.max(
    lineWidth * ARROW_HEAD_SIZE_FACTORS[shape.headSize],
    shorterSidePixels(MIN_ARROW_HEAD, frameWidth, frameHeight),
  )
}

function traceArrow(context: ShapeContext, outline: readonly Point[]) {
  context.beginPath()
  outline.forEach((point, index) =>
    index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y),
  )
  context.closePath()
}

function traceShape(context: ShapeContext, shape: BoxShape, frameWidth: number, frameHeight: number) {
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
 * A dashed or dotted arrow (#688): its heads filled solid, then its shaft
 * stroked with the line style's pattern between them, both in the border
 * colour at `alpha`.
 */
function drawBrokenArrow(
  context: ShapeContext,
  shape: ArrowShape,
  alpha: number,
  frameWidth: number,
  frameHeight: number,
) {
  const pieces = arrowPieces(shape, frameWidth, frameHeight)
  if (pieces === null) return
  context.globalAlpha = alpha
  context.fillStyle = shape.stroke
  for (const head of pieces.heads) {
    traceArrow(context, head)
    context.fill()
  }
  const { from, to } = pieces.shaft
  if (Math.hypot(to.x - from.x, to.y - from.y) <= 0) return
  context.save()
  context.setLineDash(lineDashFor(shape.lineStyle, pieces.lineWidth))
  context.lineCap = 'butt'
  context.strokeStyle = shape.stroke
  context.lineWidth = pieces.lineWidth
  context.beginPath()
  context.moveTo(from.x, from.y)
  context.lineTo(to.x, to.y)
  context.stroke()
  context.restore()
}

/**
 * The part of an arrow's shaft a *Draw on* entrance shows at `reveal`
 * (#690), in frame pixels: from the shaft's start — the tail, or the base
 * of a tail head — to `reveal` of the way to its end, the tip or the base
 * of the tip's head. The heads appear only once the shaft is complete,
 * which is the whole arrow at `reveal` 1, so they are not part of this.
 * Null when the arrow has no thickness or no length.
 */
export function arrowShaftAt(
  shape: ArrowShape,
  reveal: number,
  frameWidth: number,
  frameHeight: number,
): { from: Point; to: Point; lineWidth: number } | null {
  const pieces = arrowPieces(shape, frameWidth, frameHeight)
  if (pieces === null) return null
  const { from, to } = pieces.shaft
  const r = clamp(reveal, 0, 1)
  return {
    from,
    to: { x: from.x + (to.x - from.x) * r, y: from.y + (to.y - from.y) * r },
    lineWidth: pieces.lineWidth,
  }
}

/** One stretch of a box's border, for tracing part of it (#690). */
type BorderPiece =
  | { kind: 'line'; from: Point; to: Point; length: number }
  | { kind: 'arc'; cx: number; cy: number; rx: number; ry: number; start: number; end: number; length: number }

/**
 * A box shape's border as the pieces a *Draw on* traces in order (#690),
 * in frame pixels. An ellipse is one arc from the top, clockwise: a canvas
 * angle grows clockwise on screen, so the top is −π/2. Its length is the
 * angle swept, since only the order matters to the reveal and an ellipse
 * is traced by angle. A rectangle starts at its top-left corner and runs
 * clockwise along the top first; with rounded corners, its four corners
 * are quarter arcs between the straight sides, each at its own length.
 */
function boxBorderPieces(shape: BoxShape, frameWidth: number, frameHeight: number): BorderPiece[] {
  const x = shape.x * frameWidth
  const y = shape.y * frameHeight
  const width = shape.width * frameWidth
  const height = shape.height * frameHeight
  if (shape.kind === 'ellipse') {
    return [
      {
        kind: 'arc',
        cx: x + width / 2,
        cy: y + height / 2,
        rx: width / 2,
        ry: height / 2,
        start: -Math.PI / 2,
        end: (3 * Math.PI) / 2,
        length: 2 * Math.PI,
      },
    ]
  }
  const radius = Math.max(
    0,
    Math.min(shorterSidePixels(shape.cornerRadius ?? 0, frameWidth, frameHeight), width / 2, height / 2),
  )
  const line = (from: Point, to: Point): BorderPiece => ({
    kind: 'line',
    from,
    to,
    length: Math.hypot(to.x - from.x, to.y - from.y),
  })
  const corner = (cx: number, cy: number, start: number): BorderPiece => ({
    kind: 'arc',
    cx,
    cy,
    rx: radius,
    ry: radius,
    start,
    end: start + Math.PI / 2,
    length: (radius * Math.PI) / 2,
  })
  const right = x + width
  const bottom = y + height
  const pieces: BorderPiece[] = [
    line({ x: x + radius, y }, { x: right - radius, y }),
    corner(right - radius, y + radius, -Math.PI / 2),
    line({ x: right, y: y + radius }, { x: right, y: bottom - radius }),
    corner(right - radius, bottom - radius, 0),
    line({ x: right - radius, y: bottom }, { x: x + radius, y: bottom }),
    corner(x + radius, bottom - radius, Math.PI / 2),
    line({ x, y: bottom - radius }, { x, y: y + radius }),
    corner(x + radius, y + radius, Math.PI),
  ]
  return pieces.filter((piece) => piece.length > 0)
}

/**
 * Traces the first `reveal` of a box shape's border as one open path
 * (#690), in the order `boxBorderPieces` gives — the part a *Draw on*
 * entrance has drawn so far, to be stroked like the whole border.
 */
function traceBorderPart(
  context: ShapeContext,
  shape: BoxShape,
  reveal: number,
  frameWidth: number,
  frameHeight: number,
) {
  const pieces = boxBorderPieces(shape, frameWidth, frameHeight)
  const total = pieces.reduce((sum, piece) => sum + piece.length, 0)
  let left = clamp(reveal, 0, 1) * total
  context.beginPath()
  let started = false
  for (const piece of pieces) {
    if (left <= 0) break
    const part = Math.min(1, left / piece.length)
    left -= piece.length
    if (piece.kind === 'line') {
      if (!started) context.moveTo(piece.from.x, piece.from.y)
      context.lineTo(
        piece.from.x + (piece.to.x - piece.from.x) * part,
        piece.from.y + (piece.to.y - piece.from.y) * part,
      )
    } else {
      // An arc joins the path with a straight line from where it stands to
      // the arc's start, which is exactly where the previous piece ended.
      context.ellipse(
        piece.cx,
        piece.cy,
        piece.rx,
        piece.ry,
        0,
        piece.start,
        piece.start + (piece.end - piece.start) * part,
      )
    }
    started = true
  }
}

/**
 * A group's shape part-way through a *Draw on* entrance (#690), at
 * `reveal` in [0, 1): an arrow's shaft grows from its tail, with its heads
 * still to come; a box's border is traced on from the top (an ellipse) or
 * the top-left corner (a rectangle), clockwise; a fill fades in over the
 * same time, and a badge fades in whole. Every stroke keeps its own line
 * style, so a dashed border draws on dashed. `opacity` is the group's fade.
 */
function drawShapePart(
  context: ShapeContext,
  shape: Shape,
  reveal: number,
  opacity: number,
  frameWidth: number,
  frameHeight: number,
) {
  if (reveal <= 0) return
  if (shape.kind === 'badge') {
    drawBadge(context, shape, opacity * reveal, frameWidth, frameHeight)
    return
  }
  if (shape.kind === 'arrow') {
    if (shape.strokeOpacity <= 0) return
    const shaft = arrowShaftAt(shape, reveal, frameWidth, frameHeight)
    if (shaft === null) return
    strokePart(context, shape, shape.strokeOpacity * opacity, shaft.lineWidth, () => {
      context.beginPath()
      context.moveTo(shaft.from.x, shaft.from.y)
      context.lineTo(shaft.to.x, shaft.to.y)
    })
    return
  }
  if (shape.fillOpacity > 0) {
    traceShape(context, shape, frameWidth, frameHeight)
    context.globalAlpha = shape.fillOpacity * opacity * reveal
    context.fillStyle = shape.fill
    context.fill()
  }
  const lineWidth = shorterSidePixels(shape.thickness, frameWidth, frameHeight)
  if (lineWidth <= 0 || shape.strokeOpacity <= 0) return
  strokePart(context, shape, shape.strokeOpacity * opacity, lineWidth, () =>
    traceBorderPart(context, shape, reveal, frameWidth, frameHeight),
  )
}

/**
 * Strokes the open path `trace` builds in the shape's border colour, at
 * `alpha` and `lineWidth`, in its line style, with butt ends: the end of a
 * stroke still being drawn is where the pen is, not a rounded cap past it.
 */
function strokePart(
  context: ShapeContext,
  shape: ShapeStyle,
  alpha: number,
  lineWidth: number,
  trace: () => void,
) {
  context.save()
  context.setLineDash(lineDashFor(shape.lineStyle, lineWidth))
  context.lineCap = 'butt'
  context.globalAlpha = alpha
  context.strokeStyle = shape.stroke
  context.lineWidth = lineWidth
  trace()
  context.stroke()
  context.restore()
}

/**
 * A badge's number size, as a fraction of its diameter, by how many digits
 * it has (#689): one digit large, three small enough to sit inside the disc.
 * Sized by count rather than measured, so every engine sets the same size.
 */
export const BADGE_DIGIT_SCALE: Record<1 | 2 | 3, number> = { 1: 0.6, 2: 0.5, 3: 0.38 }

/**
 * How far below a badge's centre its number's baseline sits, as a fraction
 * of the number's font size (#689): half a digit's height in Arial and its
 * metric twins (0.716 em), so the digits' own middle lands on the centre.
 * Set on the alphabetic baseline, which every engine places alike, rather
 * than `middle`, which centres the em box — digits drawn that way sit about
 * 4 % of the disc high, and engines compute it differently.
 */
export const BADGE_DIGIT_DROP = 0.358

/**
 * The font a badge's number is set in (#689): bold, in the text overlays'
 * sans-serif stack (`textFontStack('sans')`), at `px` pixels.
 */
export function badgeFont(px: number): string {
  return `700 ${px}px ${textFontStack('sans')}`
}

/** A badge in frame pixels: its centre, radius, number size and number baseline. */
export function badgeGeometry(shape: BadgeShape, frameWidth: number, frameHeight: number) {
  const radius = shorterSidePixels(shape.size, frameWidth, frameHeight) / 2
  const digits = Math.min(Math.max(String(shape.number).length, 1), 3) as 1 | 2 | 3
  return {
    cx: shape.centerX * frameWidth,
    cy: shape.centerY * frameHeight,
    radius,
    fontPx: 2 * radius * BADGE_DIGIT_SCALE[digits],
    baselineY: shape.centerY * frameHeight + 2 * radius * BADGE_DIGIT_SCALE[digits] * BADGE_DIGIT_DROP,
  }
}

/**
 * A badge (#689): its disc filled, its border stroked centred on the
 * circle as a box shape's is, and its number centred on top, each at its
 * own opacity times the group's fade.
 */
function drawBadge(
  context: ShapeContext,
  shape: BadgeShape,
  opacity: number,
  frameWidth: number,
  frameHeight: number,
) {
  const { cx, cy, radius, fontPx, baselineY } = badgeGeometry(shape, frameWidth, frameHeight)
  if (radius <= 0) return
  context.beginPath()
  context.ellipse(cx, cy, radius, radius, 0, 0, Math.PI * 2)
  if (shape.fillOpacity > 0) {
    context.globalAlpha = shape.fillOpacity * opacity
    context.fillStyle = shape.fill
    context.fill()
  }
  const lineWidth = shorterSidePixels(shape.thickness, frameWidth, frameHeight)
  if (lineWidth > 0 && shape.strokeOpacity > 0) {
    const dash = lineDashFor(shape.lineStyle, lineWidth)
    context.save()
    if (dash.length > 0) {
      context.setLineDash(dash)
      context.lineCap = 'butt'
    }
    context.globalAlpha = shape.strokeOpacity * opacity
    context.strokeStyle = shape.stroke
    context.lineWidth = lineWidth
    context.stroke()
    context.restore()
  }
  context.globalAlpha = opacity
  context.fillStyle = shape.numberColor
  context.font = badgeFont(fontPx)
  context.textAlign = 'center'
  context.textBaseline = 'alphabetic'
  context.fillText(String(shape.number), cx, baselineY)
}

/**
 * Draws every shape group visible at `sequenceTime` onto a frame-sized
 * context (#683). The one routine the preview, the export's composer, Save
 * frame as PNG and the GIF plugin all call, so the four cannot disagree.
 *
 * Each box shape fills first and strokes second, the border centred on the
 * outline as PowerPoint draws it; an arrow fills its one outline (shaft and
 * heads) in the border's colour; a badge fills its disc, rings it and sets
 * its number on top (#689). The group's fade multiplies each shape's
 * own opacities, so a group fading in brings its shapes up together. A
 * group entering by *Draw on* (#690) draws each shape's revealed part
 * until its draw-on is over (`drawShapePart`).
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
    // A *Draw on* group still drawing (#690) takes the partial path; once
    // its draw-on is over it draws exactly as a group with no entrance.
    const reveal = shapeGroupRevealAt(group, sequenceTime)
    for (const shape of group.shapes) {
      if (reveal < 1) {
        drawShapePart(context, shape, reveal, opacity, frameWidth, frameHeight)
        continue
      }
      if (shape.kind === 'badge') {
        drawBadge(context, shape, opacity, frameWidth, frameHeight)
        continue
      }
      if (shape.kind === 'arrow') {
        if (shape.strokeOpacity <= 0) continue
        if ((shape.lineStyle ?? 'solid') !== 'solid') {
          drawBrokenArrow(context, shape, shape.strokeOpacity * opacity, frameWidth, frameHeight)
          continue
        }
        // An arrow is all border: one filled outline in the border's colour
        // and opacity (#684).
        const outline = arrowOutline(shape, frameWidth, frameHeight)
        if (outline.length === 0) continue
        traceArrow(context, outline)
        context.globalAlpha = shape.strokeOpacity * opacity
        context.fillStyle = shape.stroke
        context.fill()
        continue
      }
      traceShape(context, shape, frameWidth, frameHeight)
      if (shape.fillOpacity > 0) {
        context.globalAlpha = shape.fillOpacity * opacity
        context.fillStyle = shape.fill
        context.fill()
      }
      const lineWidth = shorterSidePixels(shape.thickness, frameWidth, frameHeight)
      if (lineWidth > 0 && shape.strokeOpacity > 0) {
        // A dashed or dotted border (#688) is set up inside its own
        // save/restore, so the pattern ends with it and a solid shape never
        // touches the dash state at all.
        const dash = lineDashFor(shape.lineStyle, lineWidth)
        if (dash.length > 0) {
          context.save()
          context.setLineDash(dash)
          context.lineCap = 'butt'
        }
        context.globalAlpha = shape.strokeOpacity * opacity
        context.strokeStyle = shape.stroke
        context.lineWidth = lineWidth
        context.stroke()
        if (dash.length > 0) context.restore()
      }
    }
  }
  context.restore()
}
