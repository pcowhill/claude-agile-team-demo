import { describe, expect, it } from 'vitest'
import { textCanvasFont } from '../../lib/exportVideo'
import { isBoxShape, isValidShapeGroupSpec } from '../../lib/shapes'
import { createTextMeasurer } from '../../lib/textMeasure'
import { isValidTextOverlaySpec, TEXT_LINE_HEIGHT } from '../../lib/textOverlay'
import { canPlace, defaultValues, fitLine, TEMPLATE_MARGIN, TITLE_TEMPLATES } from './templates'

/**
 * The app's text measurer (`createTextMeasurer`, #424) over a stand-in
 * canvas, because jsdom has none. Its `measureText` reads the px size out of
 * the font shorthand the measurer sets, and gives each character 0.62 of it
 * in bold and 0.55 in regular. Those are wider than Arial's averages
 * (about 0.6 and 0.5), so a layout that fits here has room to spare in a
 * browser. The real fonts are measured in `e2e/title-templates.spec.ts`.
 */
function stubMeasurer() {
  let font = ''
  const context = {
    set font(value: string) {
      font = value
    },
    get font() {
      return font
    },
    measureText: (line: string) => {
      const px = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 0)
      return { width: line.length * px * (font.includes('700') ? 0.62 : 0.55) }
    },
  }
  return createTextMeasurer(() => ({ getContext: () => context }) as unknown as HTMLCanvasElement)
}

const FRAMES = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
}

const LONG = 'Maximiliana Montgomery-Ashford' // 30 characters
const SHORT = 'Ana'

describe('title templates (#860)', () => {
  it('the long name is 30 characters', () => {
    expect(LONG).toHaveLength(30)
  })

  for (const template of TITLE_TEMPLATES) {
    for (const [aspect, frame] of Object.entries(FRAMES)) {
      for (const [length, words] of [
        ['long', LONG],
        ['short', SHORT],
      ] as const) {
        it(`${template.name} keeps every line and shape inside a ${aspect} frame with a ${length} first line`, () => {
          const measure = stubMeasurer()
          const values = { ...defaultValues(template), [template.fields[0].key]: words }
          const placed = template.build(values, frame, measure)
          expect(placed.texts.length).toBeGreaterThan(0)
          expect(placed.texts[0].content).toBe(words)
          // What the reducer accepts: a refused element refuses the whole
          // placement, so an out-of-range shape would place nothing at all.
          expect(placed.texts.every(isValidTextOverlaySpec)).toBe(true)
          expect(placed.shapeGroups.every(isValidShapeGroupSpec)).toBe(true)
          const margin = TEMPLATE_MARGIN * Math.min(frame.width, frame.height)
          for (const text of placed.texts) {
            const width = measure(textCanvasFont(text, frame.height), text.content)
            const height = text.size * frame.height * TEXT_LINE_HEIGHT
            const left = text.x * frame.width - width / 2
            const right = text.x * frame.width + width / 2
            const top = text.y * frame.height - height / 2
            const bottom = text.y * frame.height + height / 2
            const where = `"${text.content}" spans x ${left.toFixed(1)}–${right.toFixed(1)}, y ${top.toFixed(1)}–${bottom.toFixed(1)}`
            // Inside the margin, not merely inside the frame.
            expect(left, where).toBeGreaterThanOrEqual(margin - 0.5)
            expect(right, where).toBeLessThanOrEqual(frame.width - margin + 0.5)
            expect(top, where).toBeGreaterThanOrEqual(0)
            expect(bottom, where).toBeLessThanOrEqual(frame.height)
            expect(text.fadeIn).toBeGreaterThan(0)
            expect(text.fadeOut).toBeGreaterThan(0)
          }
          for (const group of placed.shapeGroups) {
            for (const shape of group.shapes) {
              if (!isBoxShape(shape)) throw new Error('templates place boxes only')
              expect(shape.x).toBeGreaterThanOrEqual(0)
              expect(shape.y).toBeGreaterThanOrEqual(0)
              expect(shape.x + shape.width).toBeLessThanOrEqual(1 + 1e-9)
              expect(shape.y + shape.height).toBeLessThanOrEqual(1 + 1e-9)
            }
          }
        })
      }
    }
  }

  it('a long name shrinks to fit a portrait frame, and a short one keeps its size', () => {
    const measure = stubMeasurer()
    const lowerThird = TITLE_TEMPLATES[0]
    const nameSize = (frame: { width: number; height: number }, name: string) =>
      lowerThird.build({ name, role: '' }, frame, measure).texts[0].size * frame.height
    // The nominal size is 5.5% of the shorter side: 59.4 px in either frame.
    expect(nameSize(FRAMES['16:9'], SHORT)).toBeCloseTo(59.4, 5)
    expect(nameSize(FRAMES['9:16'], SHORT)).toBeCloseTo(59.4, 5)
    // 30 characters at 59.4 px bold measure 1105 px: wider than a 1080 px frame.
    expect(nameSize(FRAMES['9:16'], LONG)).toBeLessThan(59.4 * 0.9)
  })

  it('the lower third sits at the lower left, its lines left-aligned in the bar', () => {
    const measure = stubMeasurer()
    const frame = FRAMES['16:9']
    const placed = TITLE_TEMPLATES[0].build(defaultValues(TITLE_TEMPLATES[0]), frame, measure)
    const [name, role] = placed.texts
    const leftEdge = (text: typeof name) =>
      text.x * frame.width - measure(textCanvasFont(text, frame.height), text.content) / 2
    expect(leftEdge(name)).toBeCloseTo(leftEdge(role), 6)
    expect(name.y).toBeLessThan(role.y)
    expect(name.y).toBeGreaterThan(0.75)
    const [bar] = placed.shapeGroups[0].shapes
    if (!isBoxShape(bar)) throw new Error('the bar is a box')
    expect(bar.x).toBeLessThan(0.1)
    // The bar holds the text it backs.
    expect(leftEdge(name) / frame.width).toBeGreaterThan(bar.x)
  })

  it('an optional field left empty places no text, and a required one blocks Place', () => {
    const measure = stubMeasurer()
    for (const template of TITLE_TEMPLATES) {
      const optional = template.fields.find((field) => field.optional === true)
      const required = template.fields.find((field) => field.optional !== true)
      if (optional === undefined || required === undefined) throw new Error('each template has both')
      const values = { ...defaultValues(template), [optional.key]: '  ' }
      expect(template.build(values, FRAMES['16:9'], measure).texts).toHaveLength(1)
      expect(canPlace(template, values)).toBe(true)
      expect(canPlace(template, { ...values, [required.key]: ' ' })).toBe(false)
    }
  })

  it('fitLine leaves the nominal size where nothing can be measured (no canvas)', () => {
    const fitted = fitLine(LONG, 60, 100, { font: 'sans', bold: true, italic: false }, FRAMES['16:9'], () => 0)
    expect(fitted.size * 1080).toBeCloseTo(60, 6)
  })
})
