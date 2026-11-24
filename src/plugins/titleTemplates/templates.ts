import type { PlacedElements } from '../../lib/addMenu'
import { textCanvasFont } from '../../lib/exportVideo'
import { MIN_SHAPE_SIZE } from '../../lib/shapes'
import type { BoxShape, ShapeGroupSpec } from '../../lib/shapes'
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
 * **Fitting.** Every line is measured the way the export draws it
 * (`textCanvasFont` under the app's canvas measurer, #424) and shrinks when
 * it would run wider than the room the template gives it. Sizes start from
 * the frame's *shorter* side, so a 9:16 title is not set at a 16:9 title's
 * height. A line never wraps: text overlays have no automatic wrapping
 * (#139), so a long name gets smaller instead.
 */

/** One text the template asks for. */
export interface TemplateField {
  key: string
  label: string
  defaultValue: string
  /** An optional field left empty places no text for it. */
  optional?: boolean
}

export interface TitleTemplate {
  id: string
  name: string
  /** One line for the gallery. */
  description: string
  fields: readonly TemplateField[]
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
  frame: { width: number; height: number },
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

const rectangle = (
  id: string,
  box: { x: number; y: number; width: number; height: number },
  fill: string,
  fillOpacity: number,
): BoxShape => ({
  id,
  kind: 'rectangle',
  ...box,
  stroke: fill,
  strokeOpacity: 0,
  thickness: 0,
  fill,
  fillOpacity,
})

const group = (name: string, duration: number, shapes: BoxShape[]): ShapeGroupSpec => ({
  name,
  offset: 0,
  duration,
  fadeIn: TEMPLATE_FADE,
  fadeOut: TEMPLATE_FADE,
  shapes,
})

const value = (values: Readonly<Record<string, string>>, key: string) => (values[key] ?? '').trim()

const BOLD_SANS: LineStyle = { font: 'sans', bold: true, italic: false }
const SANS: LineStyle = { font: 'sans', bold: false, italic: false }

/**
 * Lower third: a name and a role over a dark bar at the lower left, with an
 * accent strip down the bar's left edge. The bar grows with the longer line,
 * and both lines are left-aligned inside it (a text overlay is centred on
 * its x, so each line's x is its own measured half-width from the left).
 */
const LOWER_THIRD: TitleTemplate = {
  id: 'lower-third',
  name: 'Lower third',
  description: 'A name and a role over a bar at the lower left.',
  fields: [
    { key: 'name', label: 'Name', defaultValue: 'Alex Morgan' },
    { key: 'role', label: 'Role', defaultValue: 'Product designer', optional: true },
  ],
  build(values, frame, measure) {
    const duration = 5
    const { width: W, height: H } = frame
    const S = Math.min(W, H)
    const margin = TEMPLATE_MARGIN * S
    const pad = 0.02 * S
    // Never narrower than the smallest shape the timeline accepts.
    const strip = Math.max(0.01 * S, MIN_SHAPE_SIZE * W)
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
      text(name, nameLine, (textLeft + nameLine.width / 2) / W, (top + pad + nameHeight / 2) / H, '#ffffff', BOLD_SANS, duration),
    ]
    if (roleLine !== null) {
      texts.push(
        text(
          role,
          roleLine,
          (textLeft + roleLine.width / 2) / W,
          (top + pad + nameHeight + roleHeight / 2) / H,
          '#d0d7e2',
          SANS,
          duration,
        ),
      )
    }
    const box = { y: top / H, height: barHeight / H }
    return {
      texts,
      shapeGroups: [
        group('Lower third', duration, [
          rectangle('bar', { x: margin / W, width: barWidth / W, ...box }, '#111827', 0.85),
          rectangle('accent', { x: margin / W, width: strip / W, ...box }, '#f59e0b', 1),
        ]),
      ],
    }
  },
}

/** The lines of a centred card, stacked as one block about the frame's middle. */
function centredLines(
  lines: { content: string; line: FittedLine; color: string; style: LineStyle }[],
  frame: { width: number; height: number },
  gap: number,
  duration: number,
): TextOverlaySpec[] {
  const H = frame.height
  const heights = lines.map(({ line }) => line.size * H * TEXT_LINE_HEIGHT)
  const total = heights.reduce((sum, height) => sum + height, 0) + gap * (lines.length - 1)
  let y = H / 2 - total / 2
  return lines.map(({ content, line, color, style }, index) => {
    const centre = y + heights[index] / 2
    y += heights[index] + gap
    return text(content, line, 0.5, centre / H, color, style, duration)
  })
}

/** Chapter card: a large centred title and an optional subtitle over a dimmed frame. */
const CHAPTER_CARD: TitleTemplate = {
  id: 'chapter-card',
  name: 'Chapter card',
  description: 'A large centred title, with an optional subtitle, over a dimmed picture.',
  fields: [
    { key: 'title', label: 'Title', defaultValue: 'Chapter 1' },
    { key: 'subtitle', label: 'Subtitle', defaultValue: 'Getting started', optional: true },
  ],
  build(values, frame, measure) {
    const duration = 3
    const S = Math.min(frame.width, frame.height)
    const room = frame.width - 2 * TEMPLATE_MARGIN * S
    const title = value(values, 'title')
    const subtitle = value(values, 'subtitle')
    const lines = [
      { content: title, line: fitLine(title, 0.1 * S, room, BOLD_SANS, frame, measure), color: '#ffffff', style: BOLD_SANS },
    ]
    if (subtitle !== '') {
      lines.push({
        content: subtitle,
        line: fitLine(subtitle, 0.045 * S, room, SANS, frame, measure),
        color: '#e5e7eb',
        style: SANS,
      })
    }
    return {
      texts: centredLines(lines, frame, 0.02 * S, duration),
      shapeGroups: [
        group('Chapter card', duration, [
          rectangle('backdrop', { x: 0, y: 0, width: 1, height: 1 }, '#000000', 0.6),
        ]),
      ],
    }
  },
}

/** End card: a closing line and a secondary line on a solid background. */
const END_CARD: TitleTemplate = {
  id: 'end-card',
  name: 'End card',
  description: 'A closing line and a second line on a solid background.',
  fields: [
    { key: 'closing', label: 'Closing line', defaultValue: 'Thanks for watching' },
    { key: 'second', label: 'Second line', defaultValue: 'See you next time', optional: true },
  ],
  build(values, frame, measure) {
    const duration = 5
    const S = Math.min(frame.width, frame.height)
    const room = frame.width - 2 * TEMPLATE_MARGIN * S
    const closing = value(values, 'closing')
    const second = value(values, 'second')
    const lines = [
      { content: closing, line: fitLine(closing, 0.09 * S, room, BOLD_SANS, frame, measure), color: '#ffffff', style: BOLD_SANS },
    ]
    if (second !== '') {
      lines.push({
        content: second,
        line: fitLine(second, 0.045 * S, room, SANS, frame, measure),
        color: '#f59e0b',
        style: SANS,
      })
    }
    return {
      texts: centredLines(lines, frame, 0.025 * S, duration),
      shapeGroups: [
        group('End card', duration, [
          rectangle('background', { x: 0, y: 0, width: 1, height: 1 }, '#111827', 1),
        ]),
      ],
    }
  },
}

/** The gallery, in order. */
export const TITLE_TEMPLATES: readonly TitleTemplate[] = [LOWER_THIRD, CHAPTER_CARD, END_CARD]

/** The values a template's fields start with. */
export function defaultValues(template: TitleTemplate): Record<string, string> {
  return Object.fromEntries(template.fields.map((field) => [field.key, field.defaultValue]))
}

/** Whether every required field has text; Place is disabled until it does. */
export function canPlace(template: TitleTemplate, values: Readonly<Record<string, string>>): boolean {
  return template.fields.every((field) => field.optional === true || value(values, field.key) !== '')
}
