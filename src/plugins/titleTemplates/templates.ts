import type { PlacedElements } from '../../lib/addMenu'
import { textCanvasFont } from '../../lib/exportVideo'
import { DEFAULT_BADGE_SIZE, DEFAULT_BADGE_STYLE, MAX_BADGE_NUMBER, MIN_SHAPE_SIZE, nextBadgeNumber } from '../../lib/shapes'
import type { ArrowShape, BadgeShape, BoxShape, Shape, ShapeGroupSpec } from '../../lib/shapes'
import { MIN_TEXT_SIZE, TEXT_LINE_HEIGHT } from '../../lib/textOverlay'
import type { TextOverlaySpec } from '../../lib/textOverlay'
import type { TextMeasurer } from '../../lib/textMeasure'

/**
 * The title templates (#860, from the customer's pick of idea 6 on #856):
 * each one builds ordinary text overlays and a shape group from the words
 * the user types, laid out for the project's own frame. Nothing here is a
 * new kind of element. Once placed, the elements are edited like any other,
 * and they stay when the plugin is disabled.
 *
 * Part 2 (#868) grows the gallery to thirteen: three more styles of each
 * part 1 kind (two for the end card), a call-out, and a step badge.
 *
 * **Fitting.** Every line is measured the way the export draws it
 * (`textCanvasFont` under the app's canvas measurer, #424) and shrinks when
 * it would run wider than the room the template gives it. Sizes start from
 * the frame's *shorter* side, so a 9:16 title is not set at a 16:9 title's
 * height. A line never wraps: text overlays have no automatic wrapping
 * (#139), so a long name gets smaller instead.
 */

/** One value the template asks for. */
export interface TemplateField {
  key: string
  label: string
  defaultValue: string
  /** An optional field left empty places no text for it. */
  optional?: boolean
  /** A whole number in this range rather than words (the step badge's number, #868). */
  wholeNumber?: { min: number; max: number }
}

/**
 * What a template may read of the timeline it is placed on (#868): the
 * shape groups, read-only, so a step badge can offer the next number.
 */
export interface TemplateContext {
  shapeGroups: readonly ShapeGroupSpec[]
}

/** The context of an empty timeline. */
export const EMPTY_TEMPLATE_CONTEXT: TemplateContext = { shapeGroups: [] }

export interface TitleTemplate {
  id: string
  name: string
  /** One line for the gallery. */
  description: string
  fields: readonly TemplateField[]
  /** Starting values that depend on the timeline, over the fields' own defaults. */
  initialValues?: (context: TemplateContext) => Readonly<Record<string, string>>
  build: (
    values: Readonly<Record<string, string>>,
    frame: { width: number; height: number },
    measure: TextMeasurer,
  ) => PlacedElements
}

/** Every template's fade in and out, in seconds. Fades are the only motion (#860). */
export const TEMPLATE_FADE = 0.5
/** The gap a template keeps from the frame's edges, as a fraction of its shorter side. */
export const TEMPLATE_MARGIN = 0.05

interface LineStyle {
  font: string
  bold: boolean
  italic: boolean
}

interface FittedLine {
  /** The text's `size`: line height as a fraction of the frame height. */
  size: number
  /** Its measured advance width at that size, in px. */
  width: number
}

type Frame = { width: number; height: number }

/**
 * Sizes one line: `nominalPx` tall, unless it measures wider than
 * `maxWidthPx`, in which case it shrinks until it fits. Width scales with the
 * type size, so one proportional step nearly always lands. A few re-measured
 * steps absorb rounding in the font engine. A measurer that reports 0 (no
 * canvas, as in jsdom) leaves the nominal size.
 */
export function fitLine(
  content: string,
  nominalPx: number,
  maxWidthPx: number,
  style: LineStyle,
  frame: Frame,
  measure: TextMeasurer,
): FittedLine {
  let size = nominalPx / frame.height
  let width = measure(textCanvasFont({ ...style, size }, frame.height), content)
  for (let step = 0; step < 4 && width > maxWidthPx; step++) {
    size *= (maxWidthPx / width) * 0.99
    width = measure(textCanvasFont({ ...style, size }, frame.height), content)
  }
  return { size: Math.max(MIN_TEXT_SIZE, size), width }
}

const text = (
  content: string,
  line: FittedLine,
  centreX: number,
  centreY: number,
  color: string,
  style: LineStyle,
  duration: number,
): TextOverlaySpec => ({
  content,
  offset: 0,
  duration,
  x: centreX,
  y: centreY,
  font: style.font,
  size: line.size,
  color,
  bold: style.bold,
  italic: style.italic,
  fadeIn: TEMPLATE_FADE,
  fadeOut: TEMPLATE_FADE,
})

/** A border for a box: its colour and its thickness as a fraction of the frame's shorter side. */
interface Border {
  color: string
  thickness: number
}

const rectangle = (
  id: string,
  box: { x: number; y: number; width: number; height: number },
  fill: string,
  fillOpacity: number,
  border?: Border,
  cornerRadius?: number,
): BoxShape => ({
  id,
  kind: 'rectangle',
  ...box,
  stroke: border?.color ?? fill,
  strokeOpacity: border === undefined ? 0 : 1,
  thickness: border?.thickness ?? 0,
  fill,
  fillOpacity,
  ...(cornerRadius === undefined ? {} : { cornerRadius }),
})

const group = (name: string, duration: number, shapes: Shape[]): ShapeGroupSpec => ({
  name,
  offset: 0,
  duration,
  fadeIn: TEMPLATE_FADE,
  fadeOut: TEMPLATE_FADE,
  shapes,
})

const value = (values: Readonly<Record<string, string>>, key: string) => (values[key] ?? '').trim()

/** A thin rule's height in px: 0.6% of the shorter side, never under the smallest shape the timeline takes. */
const ruleHeight = (frame: Frame) => Math.max(0.006 * Math.min(frame.width, frame.height), MIN_SHAPE_SIZE * frame.height)

const BOLD_SANS: LineStyle = { font: 'sans', bold: true, italic: false }
const SANS: LineStyle = { font: 'sans', bold: false, italic: false }

const NAME_FIELDS: readonly TemplateField[] = [
  { key: 'name', label: 'Name', defaultValue: 'Alex Morgan' },
  { key: 'role', label: 'Role', defaultValue: 'Product designer', optional: true },
]

/** How a lower third on a bar looks (#860's, and #868's bold and outlined styles). */
interface BarLowerThirdLook {
  id: string
  name: string
  description: string
  bar: { fill: string; fillOpacity: number; border?: Border }
  /** The strip down the bar's left edge; none when absent. */
  accent?: string
  nameColor: string
  roleColor: string
}

/**
 * A lower third: a name and a role over a bar at the lower left, with an
 * optional accent strip down the bar's left edge. The bar grows with the
 * longer line, and both lines are left-aligned inside it (a text overlay is
 * centred on its x, so each line's x is its own measured half-width from
 * the left).
 */
function barLowerThird(look: BarLowerThirdLook): TitleTemplate {
  return {
    id: look.id,
    name: look.name,
    description: look.description,
    fields: NAME_FIELDS,
    build(values, frame, measure) {
      const duration = 5
      const { width: W, height: H } = frame
      const S = Math.min(W, H)
      const margin = TEMPLATE_MARGIN * S
      const pad = 0.02 * S
      // Never narrower than the smallest shape the timeline accepts.
      const strip = look.accent === undefined ? 0 : Math.max(0.01 * S, MIN_SHAPE_SIZE * W)
      const room = W - 2 * margin - 2 * pad - strip
      const name = value(values, 'name')
      const role = value(values, 'role')
      const nameLine = fitLine(name, 0.055 * S, room, BOLD_SANS, frame, measure)
      const roleLine = role === '' ? null : fitLine(role, 0.035 * S, room, SANS, frame, measure)
      const nameHeight = nameLine.size * H * TEXT_LINE_HEIGHT
      const roleHeight = roleLine === null ? 0 : roleLine.size * H * TEXT_LINE_HEIGHT
      const barHeight = pad + nameHeight + roleHeight + pad
      const textWidth = Math.max(nameLine.width, roleLine?.width ?? 0)
      const barWidth = Math.min(
        W - 2 * margin,
        Math.max(strip + 2 * pad + textWidth, Math.min(0.3 * W, W - 2 * margin)),
      )
      const top = H - margin - barHeight
      const textLeft = margin + strip + pad
      const texts = [
        text(name, nameLine, (textLeft + nameLine.width / 2) / W, (top + pad + nameHeight / 2) / H, look.nameColor, BOLD_SANS, duration),
      ]
      if (roleLine !== null) {
        texts.push(
          text(
            role,
            roleLine,
            (textLeft + roleLine.width / 2) / W,
            (top + pad + nameHeight + roleHeight / 2) / H,
            look.roleColor,
            SANS,
            duration,
          ),
        )
      }
      const box = { y: top / H, height: barHeight / H }
      const shapes: Shape[] = [
        rectangle('bar', { x: margin / W, width: barWidth / W, ...box }, look.bar.fill, look.bar.fillOpacity, look.bar.border),
      ]
      if (look.accent !== undefined) {
        shapes.push(rectangle('accent', { x: margin / W, width: strip / W, ...box }, look.accent, 1))
      }
      return { texts, shapeGroups: [group(look.name, duration, shapes)] }
    },
  }
}

const LOWER_THIRD = barLowerThird({
  id: 'lower-third',
  name: 'Lower third',
  description: 'A name and a role over a bar at the lower left.',
  bar: { fill: '#111827', fillOpacity: 0.85 },
  accent: '#f59e0b',
  nameColor: '#ffffff',
  roleColor: '#d0d7e2',
})

const BOLD_LOWER_THIRD = barLowerThird({
  id: 'lower-third-bold',
  name: 'Bold lower third',
  description: 'A name and a role on a solid red bar at the lower left.',
  bar: { fill: '#e11d48', fillOpacity: 1 },
  nameColor: '#ffffff',
  roleColor: '#ffe4e6',
})

const OUTLINED_LOWER_THIRD = barLowerThird({
  id: 'lower-third-outlined',
  name: 'Outlined lower third',
  description: 'A name and a role in a white outline at the lower left.',
  bar: { fill: '#000000', fillOpacity: 0.35, border: { color: '#ffffff', thickness: 0.004 } },
  nameColor: '#ffffff',
  roleColor: '#e5e7eb',
})

/**
 * Minimal lower third (#868): no bar, only the two lines at the lower left
 * with a thin amber rule between them, as long as the longer line.
 */
const MINIMAL_LOWER_THIRD: TitleTemplate = {
  id: 'lower-third-minimal',
  name: 'Minimal lower third',
  description: 'A name and a role at the lower left, with a thin rule between them.',
  fields: NAME_FIELDS,
  build(values, frame, measure) {
    const duration = 5
    const { width: W, height: H } = frame
    const S = Math.min(W, H)
    const margin = TEMPLATE_MARGIN * S
    const room = W - 2 * margin
    const gap = 0.012 * S
    const rule = ruleHeight(frame)
    const name = value(values, 'name')
    const role = value(values, 'role')
    const nameLine = fitLine(name, 0.055 * S, room, BOLD_SANS, frame, measure)
    const roleLine = role === '' ? null : fitLine(role, 0.035 * S, room, SANS, frame, measure)
    const nameHeight = nameLine.size * H * TEXT_LINE_HEIGHT
    const roleHeight = roleLine === null ? 0 : roleLine.size * H * TEXT_LINE_HEIGHT
    const blockHeight = nameHeight + gap + rule + (roleLine === null ? 0 : gap + roleHeight)
    const top = H - margin - blockHeight
    const ruleTop = top + nameHeight + gap
    const textWidth = Math.max(nameLine.width, roleLine?.width ?? 0)
    // At least a short stroke under a very short name.
    const ruleWidth = Math.min(room, Math.max(textWidth, 0.1 * S))
    const texts = [text(name, nameLine, (margin + nameLine.width / 2) / W, (top + nameHeight / 2) / H, '#ffffff', BOLD_SANS, duration)]
    if (roleLine !== null) {
      texts.push(
        text(role, roleLine, (margin + roleLine.width / 2) / W, (ruleTop + rule + gap + roleHeight / 2) / H, '#e5e7eb', SANS, duration),
      )
    }
    return {
      texts,
      shapeGroups: [
        group('Minimal lower third', duration, [
          rectangle('rule', { x: margin / W, y: ruleTop / H, width: ruleWidth / W, height: rule / H }, '#f59e0b', 1),
        ]),
      ],
    }
  },
}

/** A line or a rule in a centred stack. */
type StackItem =
  | { kind: 'line'; content: string; line: FittedLine; color: string; style: LineStyle }
  | { kind: 'rule'; width: number; height: number; color: string }

/**
 * The items of a centred card, stacked as one block about the frame's
 * middle with `gap` px between them: the texts, the rules as boxes, and the
 * block's extent in px.
 */
function centredStack(
  items: StackItem[],
  frame: Frame,
  gap: number,
  duration: number,
): { texts: TextOverlaySpec[]; rules: BoxShape[]; top: number; bottom: number; width: number } {
  const { width: W, height: H } = frame
  const heights = items.map((item) => (item.kind === 'line' ? item.line.size * H * TEXT_LINE_HEIGHT : item.height))
  const total = heights.reduce((sum, height) => sum + height, 0) + gap * (items.length - 1)
  const top = H / 2 - total / 2
  let y = top
  const texts: TextOverlaySpec[] = []
  const rules: BoxShape[] = []
  items.forEach((item, index) => {
    if (item.kind === 'line') {
      texts.push(text(item.content, item.line, 0.5, (y + heights[index] / 2) / H, item.color, item.style, duration))
    } else {
      rules.push(
        rectangle(`rule-${rules.length + 1}`, { x: (W - item.width) / 2 / W, y: y / H, width: item.width / W, height: item.height / H }, item.color, 1),
      )
    }
    y += heights[index] + gap
  })
  const width = Math.max(0, ...items.map((item) => (item.kind === 'line' ? item.line.width : item.width)))
  return { texts, rules, top, bottom: top + total, width }
}

/** How a centred card looks: the chapter and end cards, in each style. */
interface CardLook {
  id: string
  name: string
  description: string
  fields: readonly [TemplateField, TemplateField]
  duration: number
  /** The large line's and the small line's nominal sizes, as fractions of the shorter side. */
  sizes: readonly [number, number]
  /** Between the lines, as a fraction of the shorter side. */
  gap: number
  colors: readonly [string, string]
  /** A layer over the whole frame. */
  backdrop?: { fill: string; fillOpacity: number }
  /** A short rule between the two lines, in this colour. */
  rule?: string
  /** An outline round the lines, `pad` (a fraction of the shorter side) away from them. */
  outline?: Border & { pad: number }
  /** An outline just inside the frame's margins. */
  frameOutline?: Border
}

/**
 * A centred card: a large line and an optional smaller one, stacked about
 * the frame's middle, over whatever layers the look gives it.
 */
function centredCard(look: CardLook): TitleTemplate {
  return {
    id: look.id,
    name: look.name,
    description: look.description,
    fields: look.fields,
    build(values, frame, measure) {
      const { width: W, height: H } = frame
      const S = Math.min(W, H)
      const margin = TEMPLATE_MARGIN * S
      // An outline round the lines, or one at the margins, takes its own room.
      const inset = look.outline !== undefined ? look.outline.pad * S : look.frameOutline !== undefined ? 0.04 * S : 0
      const room = W - 2 * margin - 2 * inset
      const [largeField, smallField] = look.fields
      const large = value(values, largeField.key)
      const small = value(values, smallField.key)
      const items: StackItem[] = [
        { kind: 'line', content: large, line: fitLine(large, look.sizes[0] * S, room, BOLD_SANS, frame, measure), color: look.colors[0], style: BOLD_SANS },
      ]
      if (look.rule !== undefined) {
        items.push({ kind: 'rule', width: Math.min(room, 0.2 * S), height: ruleHeight(frame), color: look.rule })
      }
      if (small !== '') {
        items.push({
          kind: 'line',
          content: small,
          line: fitLine(small, look.sizes[1] * S, room, SANS, frame, measure),
          color: look.colors[1],
          style: SANS,
        })
      }
      const stack = centredStack(items, frame, look.gap * S, look.duration)
      const shapes: Shape[] = []
      if (look.backdrop !== undefined) {
        shapes.push(rectangle('backdrop', { x: 0, y: 0, width: 1, height: 1 }, look.backdrop.fill, look.backdrop.fillOpacity))
      }
      if (look.frameOutline !== undefined) {
        shapes.push(
          rectangle(
            'outline',
            { x: margin / W, y: margin / H, width: 1 - (2 * margin) / W, height: 1 - (2 * margin) / H },
            look.frameOutline.color,
            0,
            look.frameOutline,
          ),
        )
      }
      if (look.outline !== undefined) {
        const pad = look.outline.pad * S
        const width = Math.min(W - 2 * margin, stack.width + 2 * pad)
        const top = Math.max(margin, stack.top - pad)
        const height = Math.min(H - margin, stack.bottom + pad) - top
        shapes.push(
          rectangle('outline', { x: (W - width) / 2 / W, y: top / H, width: width / W, height: height / H }, look.outline.color, 0, look.outline),
        )
      }
      shapes.push(...stack.rules)
      return { texts: stack.texts, shapeGroups: [group(look.name, look.duration, shapes)] }
    },
  }
}

const TITLE_FIELDS: readonly [TemplateField, TemplateField] = [
  { key: 'title', label: 'Title', defaultValue: 'Chapter 1' },
  { key: 'subtitle', label: 'Subtitle', defaultValue: 'Getting started', optional: true },
]

const CHAPTER = { fields: TITLE_FIELDS, duration: 3, sizes: [0.1, 0.045], gap: 0.02 } as const

/** Chapter card: a large centred title and an optional subtitle over a dimmed frame. */
const CHAPTER_CARD = centredCard({
  ...CHAPTER,
  id: 'chapter-card',
  name: 'Chapter card',
  description: 'A large centred title, with an optional subtitle, over a dimmed picture.',
  colors: ['#ffffff', '#e5e7eb'],
  backdrop: { fill: '#000000', fillOpacity: 0.6 },
})

const MINIMAL_CHAPTER_CARD = centredCard({
  ...CHAPTER,
  id: 'chapter-card-minimal',
  name: 'Minimal chapter card',
  description: 'A centred title and subtitle with a short rule between them, over the picture.',
  colors: ['#ffffff', '#f3f4f6'],
  rule: '#f59e0b',
})

const BOLD_CHAPTER_CARD = centredCard({
  ...CHAPTER,
  id: 'chapter-card-bold',
  name: 'Bold chapter card',
  description: 'A centred title and subtitle on a solid violet background.',
  colors: ['#ffffff', '#ede9fe'],
  backdrop: { fill: '#6d28d9', fillOpacity: 1 },
})

const OUTLINED_CHAPTER_CARD = centredCard({
  ...CHAPTER,
  id: 'chapter-card-outlined',
  name: 'Outlined chapter card',
  description: 'A centred title and subtitle in a white outline, over a dimmed picture.',
  colors: ['#ffffff', '#e5e7eb'],
  backdrop: { fill: '#000000', fillOpacity: 0.5 },
  outline: { color: '#ffffff', thickness: 0.005, pad: 0.04 },
})

const CLOSING_FIELDS: readonly [TemplateField, TemplateField] = [
  { key: 'closing', label: 'Closing line', defaultValue: 'Thanks for watching' },
  { key: 'second', label: 'Second line', defaultValue: 'See you next time', optional: true },
]

const END = { fields: CLOSING_FIELDS, duration: 5, sizes: [0.09, 0.045], gap: 0.025 } as const

/** End card: a closing line and a secondary line on a solid background. */
const END_CARD = centredCard({
  ...END,
  id: 'end-card',
  name: 'End card',
  description: 'A closing line and a second line on a solid background.',
  colors: ['#ffffff', '#f59e0b'],
  backdrop: { fill: '#111827', fillOpacity: 1 },
})

const BOLD_END_CARD = centredCard({
  ...END,
  id: 'end-card-bold',
  name: 'Bold end card',
  description: 'A closing line and a second line in dark type on solid amber.',
  colors: ['#111827', '#1f2937'],
  backdrop: { fill: '#f59e0b', fillOpacity: 1 },
})

const OUTLINED_END_CARD = centredCard({
  ...END,
  id: 'end-card-outlined',
  name: 'Outlined end card',
  description: 'A closing line and a second line on a dark background inside an amber frame.',
  colors: ['#ffffff', '#f59e0b'],
  backdrop: { fill: '#111827', fillOpacity: 1 },
  frameOutline: { color: '#f59e0b', thickness: 0.006 },
})

/** The call-out's yellow: its box, and the arrow from it. */
const CALLOUT_YELLOW = '#facc15'

/**
 * Call-out (#868): a short label in a filled yellow box, with an arrow from
 * the box's lower edge pointing down and to the right. It is placed above
 * the frame's middle, and is meant to be moved onto what it points at in
 * the text and shape editors. The arrow starts under the box (it is drawn
 * first), so moving the two together keeps them joined.
 */
const CALLOUT: TitleTemplate = {
  id: 'callout',
  name: 'Call-out',
  description: 'A short label in a yellow box, with an arrow pointing from it.',
  fields: [{ key: 'label', label: 'Label', defaultValue: 'Click here' }],
  build(values, frame, measure) {
    const duration = 4
    const { width: W, height: H } = frame
    const S = Math.min(W, H)
    const margin = TEMPLATE_MARGIN * S
    const padX = 0.02 * S
    const padY = 0.012 * S
    const label = value(values, 'label')
    const line = fitLine(label, 0.045 * S, W - 2 * margin - 2 * padX, BOLD_SANS, frame, measure)
    const lineHeight = line.size * H * TEXT_LINE_HEIGHT
    const boxWidth = Math.min(W - 2 * margin, line.width + 2 * padX)
    const boxHeight = lineHeight + 2 * padY
    const centreX = W / 2
    const top = 0.25 * H
    const bottom = top + boxHeight
    const arrow: ArrowShape = {
      id: 'pointer',
      kind: 'arrow',
      tailX: centreX / W,
      tailY: (bottom - padY) / H,
      tipX: (centreX + 0.12 * S) / W,
      tipY: (bottom + 0.16 * S) / H,
      heads: 'tip',
      headSize: 'medium',
      stroke: CALLOUT_YELLOW,
      strokeOpacity: 1,
      thickness: 0.008,
      fill: CALLOUT_YELLOW,
      fillOpacity: 1,
    }
    const box = rectangle(
      'box',
      { x: (centreX - boxWidth / 2) / W, y: top / H, width: boxWidth / W, height: boxHeight / H },
      CALLOUT_YELLOW,
      1,
      undefined,
      0.012,
    )
    return {
      texts: [text(label, line, 0.5, (top + boxHeight / 2) / H, '#111827', BOLD_SANS, duration)],
      shapeGroups: [group('Call-out', duration, [arrow, box])],
    }
  },
}

/**
 * The number the step badge offers (#868): one more than the highest badge
 * anywhere on the timeline, or 1 when there is none. It is #689's rule for
 * a group's next badge, read across every group, so a hand-drawn badge
 * counts as a step too. Deleting a badge renumbers nothing: after 1, 2, 3
 * with 3 deleted the next is 3, and with 2 deleted it is 4.
 */
export function nextStepNumber(context: TemplateContext): number {
  return nextBadgeNumber(context.shapeGroups.flatMap((candidate) => candidate.shapes))
}

/**
 * Step badge (#868): a numbered red disc near the upper left, the badge
 * shape #689 built, with an optional caption on a dark pill to its right.
 */
const STEP_BADGE: TitleTemplate = {
  id: 'step-badge',
  name: 'Step badge',
  description: 'A numbered circle, with an optional caption beside it.',
  fields: [
    { key: 'number', label: 'Number', defaultValue: '1', wholeNumber: { min: 0, max: MAX_BADGE_NUMBER } },
    { key: 'caption', label: 'Caption', defaultValue: 'Open the menu', optional: true },
  ],
  initialValues: (context) => ({ number: String(nextStepNumber(context)) }),
  build(values, frame, measure) {
    const duration = 4
    const { width: W, height: H } = frame
    const S = Math.min(W, H)
    const margin = TEMPLATE_MARGIN * S
    const diameter = DEFAULT_BADGE_SIZE * S
    const gap = 0.015 * S
    const padX = 0.015 * S
    const padY = 0.008 * S
    const number = Number(value(values, 'number'))
    const caption = value(values, 'caption')
    const centreX = margin + diameter / 2
    const centreY = 0.25 * H
    const badge: BadgeShape = {
      id: 'badge',
      kind: 'badge',
      centerX: centreX / W,
      centerY: centreY / H,
      size: DEFAULT_BADGE_SIZE,
      number,
      ...DEFAULT_BADGE_STYLE,
    }
    const texts: TextOverlaySpec[] = []
    const shapes: Shape[] = []
    if (caption !== '') {
      const left = margin + diameter + gap
      const line = fitLine(caption, 0.04 * S, W - margin - left - 2 * padX, SANS, frame, measure)
      const lineHeight = line.size * H * TEXT_LINE_HEIGHT
      const pillHeight = lineHeight + 2 * padY
      shapes.push(
        rectangle(
          'caption',
          { x: left / W, y: (centreY - pillHeight / 2) / H, width: (line.width + 2 * padX) / W, height: pillHeight / H },
          '#111827',
          0.85,
          undefined,
          0.01,
        ),
      )
      texts.push(text(caption, line, (left + padX + line.width / 2) / W, centreY / H, '#ffffff', SANS, duration))
    }
    shapes.push(badge)
    return { texts, shapeGroups: [group(`Step ${number}`, duration, shapes)] }
  },
}

/** The gallery, in order: each kind's styles together, the part 1 style first. */
export const TITLE_TEMPLATES: readonly TitleTemplate[] = [
  LOWER_THIRD,
  MINIMAL_LOWER_THIRD,
  BOLD_LOWER_THIRD,
  OUTLINED_LOWER_THIRD,
  CHAPTER_CARD,
  MINIMAL_CHAPTER_CARD,
  BOLD_CHAPTER_CARD,
  OUTLINED_CHAPTER_CARD,
  END_CARD,
  BOLD_END_CARD,
  OUTLINED_END_CARD,
  CALLOUT,
  STEP_BADGE,
]

/** The values a template's fields start with, on a timeline with this context. */
export function defaultValues(
  template: TitleTemplate,
  context: TemplateContext = EMPTY_TEMPLATE_CONTEXT,
): Record<string, string> {
  return {
    ...Object.fromEntries(template.fields.map((field) => [field.key, field.defaultValue])),
    ...template.initialValues?.(context),
  }
}

/** Whether a field's value is acceptable: words, or a whole number in its range. */
export function isFieldValid(field: TemplateField, values: Readonly<Record<string, string>>): boolean {
  const entered = value(values, field.key)
  if (entered === '') return field.optional === true
  if (field.wholeNumber === undefined) return true
  if (!/^\d+$/.test(entered)) return false
  const number = Number(entered)
  return number >= field.wholeNumber.min && number <= field.wholeNumber.max
}

/** Whether every required field has text and every number is in range; Place is disabled until then. */
export function canPlace(template: TitleTemplate, values: Readonly<Record<string, string>>): boolean {
  return template.fields.every((field) => isFieldValid(field, values))
}
