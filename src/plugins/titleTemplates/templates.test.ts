import { describe, expect, it } from 'vitest'
import { textCanvasFont } from '../../lib/exportVideo'
import { placeElementsAt } from '../../lib/addMenu'
import { emptyTimelineHistory, timelineHistoryReducer } from '../../lib/history'
import { isBoxShape, isValidShapeGroupSpec } from '../../lib/shapes'
import type { BadgeShape, Shape, ShapeGroupSpec } from '../../lib/shapes'
import { createTextMeasurer } from '../../lib/textMeasure'
import { isValidTextOverlaySpec, TEXT_LINE_HEIGHT } from '../../lib/textOverlay'
import type { TextOverlaySpec } from '../../lib/textOverlay'
import { shapeGroupsOf, textsOf } from '../../lib/timeline'
import { canPlace, defaultValues, fitLine, nextStepNumber, PAIR_GUTTER, TEMPLATE_MARGIN, TITLE_TEMPLATES } from './templates'
import type { TitleTemplate } from './templates'

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

/** The first field that takes words: what the fitting tests type a long or short line into. */
const firstWordsField = (template: TitleTemplate) => template.fields.find((field) => field.wholeNumber === undefined)!

/** A shape's extent in px, whatever its kind: a box, an arrow's two ends, or a badge's disc. */
function shapeExtent(shape: Shape, frame: { width: number; height: number }) {
  const { width: W, height: H } = frame
  if (shape.kind === 'arrow') {
    return {
      left: Math.min(shape.tailX, shape.tipX) * W,
      right: Math.max(shape.tailX, shape.tipX) * W,
      top: Math.min(shape.tailY, shape.tipY) * H,
      bottom: Math.max(shape.tailY, shape.tipY) * H,
    }
  }
  if (shape.kind === 'badge') {
    const radius = (shape.size * Math.min(W, H)) / 2
    return {
      left: shape.centerX * W - radius,
      right: shape.centerX * W + radius,
      top: shape.centerY * H - radius,
      bottom: shape.centerY * H + radius,
    }
  }
  return { left: shape.x * W, right: (shape.x + shape.width) * W, top: shape.y * H, bottom: (shape.y + shape.height) * H }
}

const template = (id: string) => TITLE_TEMPLATES.find((candidate) => candidate.id === id)!

const badgeGroup = (...numbers: number[]): ShapeGroupSpec => ({
  offset: 0,
  duration: 3,
  shapes: numbers.map(
    (number, index): BadgeShape => ({
      id: `b${index}`,
      kind: 'badge',
      centerX: 0.5,
      centerY: 0.5,
      size: 0.08,
      number,
      stroke: '#ffffff',
      strokeOpacity: 1,
      thickness: 0,
      fill: '#e53935',
      fillOpacity: 1,
      numberColor: '#ffffff',
    }),
  ),
})

describe('title templates part 2: the step badge, the call-out and the styles (#868)', () => {
  it('the step badge offers one more than the highest badge on the timeline, across groups', () => {
    expect(nextStepNumber({ shapeGroups: [] })).toBe(1)
    expect(nextStepNumber({ shapeGroups: [badgeGroup(1), badgeGroup(2, 3)] })).toBe(4)
    // Shapes that are not badges do not count.
    const placed = template('lower-third').build(defaultValues(template('lower-third')), FRAMES['16:9'], stubMeasurer())
    expect(nextStepNumber({ shapeGroups: placed.shapeGroups })).toBe(1)
    // Never past the highest number a badge can show.
    expect(nextStepNumber({ shapeGroups: [badgeGroup(999)] })).toBe(999)
  })

  it('after a badge is deleted, the offer is read from the badges that remain: nothing is renumbered', () => {
    // 1, 2, 3 placed, then 3 deleted: the next is 3 again.
    expect(nextStepNumber({ shapeGroups: [badgeGroup(1), badgeGroup(2)] })).toBe(3)
    // 1, 2, 3 placed, then 2 deleted: the next is still 4.
    expect(nextStepNumber({ shapeGroups: [badgeGroup(1), badgeGroup(3)] })).toBe(4)
    // Every badge deleted: back to 1.
    expect(nextStepNumber({ shapeGroups: [] })).toBe(1)
  })

  it("the step badge's Number starts at that offer, and Place needs a whole number from 0 to 999", () => {
    const step = template('step-badge')
    expect(defaultValues(step).number).toBe('1')
    const values = defaultValues(step, { shapeGroups: [badgeGroup(4)] })
    expect(values.number).toBe('5')
    expect(canPlace(step, values)).toBe(true)
    for (const number of ['', ' ', '-1', '1000', '2.5', 'two', '1e2']) {
      expect(canPlace(step, { ...values, number }), `Number "${number}"`).toBe(false)
    }
    for (const number of ['0', '999', ' 7 ']) {
      expect(canPlace(step, { ...values, number }), `Number "${number}"`).toBe(true)
    }
  })

  it('the step badge places a badge with that number, and its caption on a pill to its right', () => {
    const frame = FRAMES['16:9']
    const placed = template('step-badge').build({ number: '7', caption: 'Open the menu' }, frame, stubMeasurer())
    const [group] = placed.shapeGroups
    expect(group.name).toBe('Step 7')
    const [pill, badge] = group.shapes
    if (badge.kind !== 'badge' || !isBoxShape(pill)) throw new Error('a pill, then the badge over it')
    expect(badge.number).toBe(7)
    const [caption] = placed.texts
    expect(caption.content).toBe('Open the menu')
    // Level with the badge, and right of it.
    expect(caption.y).toBeCloseTo(badge.centerY, 9)
    expect(pill.y + pill.height / 2).toBeCloseTo(badge.centerY, 9)
    const badgeRight = badge.centerX * frame.width + (badge.size * frame.height) / 2
    expect(pill.x * frame.width).toBeGreaterThan(badgeRight)
    // With no caption, only the badge.
    const alone = template('step-badge').build({ number: '2', caption: '' }, frame, stubMeasurer())
    expect(alone.texts).toEqual([])
    expect(alone.shapeGroups[0].shapes.map((shape) => shape.kind)).toEqual(['badge'])
  })

  it('the call-out centres its label in the yellow box, and its arrow leaves from under the box', () => {
    const frame = FRAMES['9:16']
    const measure = stubMeasurer()
    const placed = template('callout').build({ label: 'Press Save' }, frame, measure)
    const [arrow, box] = placed.shapeGroups[0].shapes
    if (arrow.kind !== 'arrow' || !isBoxShape(box)) throw new Error('the arrow, then the box over it')
    expect(box.fill).toBe('#facc15')
    const [label] = placed.texts
    expect(label.x).toBeCloseTo(box.x + box.width / 2, 9)
    expect(label.y).toBeCloseTo(box.y + box.height / 2, 9)
    const labelWidth = measure(textCanvasFont(label, frame.height), label.content) / frame.width
    expect(labelWidth).toBeLessThan(box.width)
    // The tail is inside the box, so the box hides it; the tip is below and right.
    expect(arrow.tailX).toBeGreaterThan(box.x)
    expect(arrow.tailX).toBeLessThan(box.x + box.width)
    expect(arrow.tailY).toBeGreaterThan(box.y)
    expect(arrow.tailY).toBeLessThan(box.y + box.height)
    expect(arrow.tipY).toBeGreaterThan(box.y + box.height)
    expect(arrow.tipX).toBeGreaterThan(arrow.tailX)
  })

  it("the minimal lower third's rule lies between the name and the role, under the longer line", () => {
    const frame = FRAMES['16:9']
    const measure = stubMeasurer()
    const placed = template('lower-third-minimal').build(defaultValues(template('lower-third-minimal')), frame, measure)
    const [name, role] = placed.texts
    const [rule] = placed.shapeGroups[0].shapes
    if (!isBoxShape(rule)) throw new Error('the rule is a box')
    const bottom = (text: typeof name) => text.y + (text.size * TEXT_LINE_HEIGHT) / 2
    const top = (text: typeof name) => text.y - (text.size * TEXT_LINE_HEIGHT) / 2
    expect(rule.y).toBeGreaterThan(bottom(name))
    expect(rule.y + rule.height).toBeLessThan(top(role))
    const longer = Math.max(
      ...[name, role].map((text) => measure(textCanvasFont(text, frame.height), text.content) / frame.width),
    )
    expect(rule.width).toBeCloseTo(longer, 9)
  })

  it("the outlined chapter card's outline encloses both lines; the outlined end card's sits at the margins", () => {
    const frame = FRAMES['16:9']
    const measure = stubMeasurer()
    const chapter = template('chapter-card-outlined').build(defaultValues(template('chapter-card-outlined')), frame, measure)
    const outline = chapter.shapeGroups[0].shapes.find((shape) => shape.id === 'outline')
    if (outline === undefined || !isBoxShape(outline)) throw new Error('an outline box')
    expect(outline.fillOpacity).toBe(0)
    expect(outline.thickness).toBeGreaterThan(0)
    for (const text of chapter.texts) {
      const half = measure(textCanvasFont(text, frame.height), text.content) / frame.width / 2
      expect(text.x - half).toBeGreaterThan(outline.x)
      expect(text.x + half).toBeLessThan(outline.x + outline.width)
      expect(text.y - (text.size * TEXT_LINE_HEIGHT) / 2).toBeGreaterThan(outline.y)
      expect(text.y + (text.size * TEXT_LINE_HEIGHT) / 2).toBeLessThan(outline.y + outline.height)
    }
    const end = template('end-card-outlined').build(defaultValues(template('end-card-outlined')), frame, measure)
    const frameOutline = end.shapeGroups[0].shapes.find((shape) => shape.id === 'outline')
    if (frameOutline === undefined || !isBoxShape(frameOutline)) throw new Error('an outline box')
    const margin = TEMPLATE_MARGIN * frame.height
    expect(frameOutline.x * frame.width).toBeCloseTo(margin, 6)
    expect(frameOutline.y * frame.height).toBeCloseTo(margin, 6)
    expect((frameOutline.x + frameOutline.width) * frame.width).toBeCloseTo(frame.width - margin, 6)
  })

  it('the part 1 templates keep their look: the bar and strip, the dimmed frame, the solid background', () => {
    const measure = stubMeasurer()
    const look = (id: string) =>
      template(id)
        .build(defaultValues(template(id)), FRAMES['16:9'], measure)
        .shapeGroups[0].shapes.map((shape) => [shape.fill, shape.fillOpacity, shape.thickness])
    expect(look('lower-third')).toEqual([
      ['#111827', 0.85, 0],
      ['#f59e0b', 1, 0],
    ])
    expect(look('chapter-card')).toEqual([['#000000', 0.6, 0]])
    expect(look('end-card')).toEqual([['#111827', 1, 0]])
  })
})

describe('Before / after templates (#965)', () => {
  const PAIRS = ['before-after', 'before-after-split', 'before-after-bold'] as const
  const SQUARE = { width: 1080, height: 1080 }
  const frames = { ...FRAMES, '1:1': SQUARE }

  /** A placed label's measured left and right edges, in px. */
  const edges = (label: TextOverlaySpec, frame: { width: number; height: number }, measure: ReturnType<typeof stubMeasurer>) => {
    const half = measure(textCanvasFont(label, frame.height), label.content) / 2
    return { left: label.x * frame.width - half, right: label.x * frame.width + half }
  }

  it('each takes a Left label and a Right label, Before and After, both required', () => {
    for (const id of PAIRS) {
      expect(template(id).fields.map((field) => [field.label, field.defaultValue, field.optional ?? false])).toEqual([
        ['Left label', 'Before', false],
        ['Right label', 'After', false],
      ])
      expect(canPlace(template(id), { left: 'Before', right: '' })).toBe(false)
      expect(canPlace(template(id), { left: '', right: 'After' })).toBe(false)
    }
  })

  for (const id of PAIRS) {
    for (const [aspect, frame] of Object.entries(frames)) {
      for (const [which, values] of [
        ['both labels long', { left: LONG, right: LONG }],
        ['the left label long', { left: LONG, right: SHORT }],
        ['the right label long', { left: SHORT, right: LONG }],
        ['the examples', { left: 'Before', right: 'After' }],
      ] as const) {
        it(`${id} keeps each label in its own half at ${aspect}, with ${which}`, () => {
          const measure = stubMeasurer()
          const placed = template(id).build(values, frame, measure)
          const [left, right] = placed.texts
          expect([left.content, right.content]).toEqual([values.left, values.right])
          const gutter = PAIR_GUTTER * Math.min(frame.width, frame.height)
          const middle = frame.width / 2
          const a = edges(left, frame, measure)
          const b = edges(right, frame, measure)
          const where = `left ${JSON.stringify(a)}, right ${JSON.stringify(b)}, middle ${middle}`
          expect(a.right, where).toBeLessThanOrEqual(middle - gutter + 0.5)
          expect(b.left, where).toBeGreaterThanOrEqual(middle + gutter - 0.5)
          // Inside the margins, and one size, so they read as a pair.
          const margin = TEMPLATE_MARGIN * Math.min(frame.width, frame.height)
          expect(a.left, where).toBeGreaterThanOrEqual(margin - 0.5)
          expect(b.right, where).toBeLessThanOrEqual(frame.width - margin + 0.5)
          expect(left.size).toBe(right.size)
          expect(left.y).toBe(right.y)
          // A box behind a label stays in the label's half too.
          for (const shape of placed.shapeGroups[0].shapes) {
            if (!isBoxShape(shape) || shape.id === 'band' || shape.id === 'rule') continue
            const [x0, x1] = [shape.x * frame.width, (shape.x + shape.width) * frame.width]
            if (shape.id === 'left') expect(x1, `${shape.id} box ${x0}–${x1}`).toBeLessThanOrEqual(middle - gutter + 1e-6)
            else expect(x0, `${shape.id} box ${x0}–${x1}`).toBeGreaterThanOrEqual(middle + gutter - 1e-6)
          }
        })
      }
    }
  }

  it('the examples keep the nominal size: only a label too long for its half shrinks, and its partner with it', () => {
    const frame = FRAMES['16:9']
    const measure = stubMeasurer()
    const examples = template('before-after').build({ left: 'Before', right: 'After' }, frame, measure)
    expect(examples.texts[0].size).toBeCloseTo(0.05, 9)
    const long = template('before-after').build({ left: `${LONG} ${LONG}`, right: 'After' }, frame, measure)
    expect(long.texts[0].size).toBeLessThan(0.05)
    expect(long.texts[1].size).toBe(long.texts[0].size)
  })

  it("the pills and the bars enclose their labels, and the bold style's two bars differ", () => {
    for (const id of ['before-after', 'before-after-bold'] as const) {
      for (const frame of Object.values(frames)) {
        const measure = stubMeasurer()
        const placed = template(id).build(defaultValues(template(id)), frame, measure)
        const boxes = placed.shapeGroups[0].shapes.filter(isBoxShape)
        expect(boxes.map((box) => box.id)).toEqual(['left', 'right'])
        placed.texts.forEach((label, index) => {
          const box = boxes[index]
          const { left, right } = edges(label, frame, measure)
          const half = (label.size * TEXT_LINE_HEIGHT) / 2
          expect(left).toBeGreaterThan(box.x * frame.width)
          expect(right).toBeLessThan((box.x + box.width) * frame.width)
          expect(label.y - half).toBeGreaterThan(box.y)
          expect(label.y + half).toBeLessThan(box.y + box.height)
        })
      }
    }
    const pills = template('before-after').build(defaultValues(template('before-after')), FRAMES['16:9'], stubMeasurer())
    expect(pills.shapeGroups[0].shapes.map((shape) => [shape.fill, shape.fillOpacity])).toEqual([
      ['#111827', 0.85],
      ['#111827', 0.85],
    ])
    const bars = template('before-after-bold').build(defaultValues(template('before-after-bold')), FRAMES['16:9'], stubMeasurer())
    const [grey, green] = bars.shapeGroups[0].shapes
    expect([grey.fill, green.fill]).toEqual(['#4b5563', '#16a34a'])
    expect([grey.fillOpacity, green.fillOpacity]).toEqual([1, 1])
    expect(bars.texts.every((label) => label.bold)).toBe(true)
  })

  it("the split style's rule runs the frame's full height on its midline, and its band holds both labels", () => {
    for (const frame of Object.values(frames)) {
      const placed = template('before-after-split').build(defaultValues(template('before-after-split')), frame, stubMeasurer())
      const [band, rule] = placed.shapeGroups[0].shapes
      if (!isBoxShape(band) || !isBoxShape(rule)) throw new Error('the band, then the rule')
      expect([band.id, rule.id]).toEqual(['band', 'rule'])
      expect(rule.fill).toBe('#ffffff')
      expect(rule.x + rule.width / 2).toBeCloseTo(0.5, 9)
      expect([rule.y, rule.height]).toEqual([0, 1])
      expect(rule.width * frame.width).toBeLessThan(0.01 * Math.min(frame.width, frame.height))
      expect([band.x, band.width]).toEqual([0, 1])
      for (const label of placed.texts) {
        const half = (label.size * TEXT_LINE_HEIGHT) / 2
        expect(label.y - half).toBeGreaterThan(band.y)
        expect(label.y + half).toBeLessThan(band.y + band.height)
      }
      // Each label centred in its half, within the margin and the gutter.
      const [left, right] = placed.texts
      expect(left.x).toBeLessThan(0.25 + 1e-9)
      expect(right.x).toBeGreaterThan(0.75 - 1e-9)
      expect(left.x + right.x).toBeCloseTo(1, 9)
    }
  })
})

describe('title templates (#860, #868)', () => {
  it('the long name is 30 characters', () => {
    expect(LONG).toHaveLength(30)
  })

  it('the gallery holds sixteen templates, each with its own id and name (#868, #965)', () => {
    expect(TITLE_TEMPLATES.length).toBe(16)
    expect(new Set(TITLE_TEMPLATES.map((template) => template.id)).size).toBe(TITLE_TEMPLATES.length)
    expect(new Set(TITLE_TEMPLATES.map((template) => template.name)).size).toBe(TITLE_TEMPLATES.length)
    // Part 1's three stay first in their kinds, under their own ids.
    expect(TITLE_TEMPLATES.map((template) => template.id)).toEqual([
      'lower-third',
      'lower-third-minimal',
      'lower-third-bold',
      'lower-third-outlined',
      'chapter-card',
      'chapter-card-minimal',
      'chapter-card-bold',
      'chapter-card-outlined',
      'end-card',
      'end-card-bold',
      'end-card-outlined',
      'before-after',
      'before-after-split',
      'before-after-bold',
      'callout',
      'step-badge',
    ])
  })

  for (const template of TITLE_TEMPLATES) {
    it(`${template.name} places its text and shapes in one undo step`, () => {
      const placed = template.build(defaultValues(template), FRAMES['16:9'], stubMeasurer())
      let id = 0
      let history = timelineHistoryReducer(emptyTimelineHistory, {
        type: 'elements-placed',
        ...placeElementsAt(placed, 1, () => `id-${++id}`),
      })
      expect(textsOf(history.present)).toHaveLength(placed.texts.length)
      expect(shapeGroupsOf(history.present)).toHaveLength(placed.shapeGroups.length)
      expect(placed.shapeGroups.length).toBeGreaterThan(0)
      history = timelineHistoryReducer(history, { type: 'edit-undone' })
      expect(textsOf(history.present)).toEqual([])
      expect(shapeGroupsOf(history.present)).toEqual([])
    })

    for (const [aspect, frame] of Object.entries(FRAMES)) {
      for (const [length, words] of [
        ['long', LONG],
        ['short', SHORT],
      ] as const) {
        it(`${template.name} keeps every line and shape inside a ${aspect} frame with a ${length} first line`, () => {
          const measure = stubMeasurer()
          const values = { ...defaultValues(template), [firstWordsField(template).key]: words }
          const placed = template.build(values, frame, measure)
          expect(placed.texts.map((text) => text.content)).toContain(words)
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
              const extent = shapeExtent(shape, frame)
              const where = `${shape.kind} "${shape.id}" spans ${JSON.stringify(extent)}`
              expect(extent.left, where).toBeGreaterThanOrEqual(-1e-6)
              expect(extent.top, where).toBeGreaterThanOrEqual(-1e-6)
              expect(extent.right, where).toBeLessThanOrEqual(frame.width + 1e-6)
              expect(extent.bottom, where).toBeLessThanOrEqual(frame.height + 1e-6)
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
      const values = defaultValues(template)
      expect(canPlace(template, values), template.name).toBe(true)
      const all = template.build(values, FRAMES['16:9'], measure).texts.length
      for (const field of template.fields) {
        const emptied = { ...values, [field.key]: '  ' }
        if (field.optional === true) {
          expect(template.build(emptied, FRAMES['16:9'], measure).texts, `${template.name} without ${field.label}`).toHaveLength(all - 1)
          expect(canPlace(template, emptied)).toBe(true)
        } else {
          expect(canPlace(template, emptied), `${template.name} without ${field.label}`).toBe(false)
        }
      }
    }
  })

  it('fitLine leaves the nominal size where nothing can be measured (no canvas)', () => {
    const fitted = fitLine(LONG, 60, 100, { font: 'sans', bold: true, italic: false }, FRAMES['16:9'], () => 0)
    expect(fitted.size * 1080).toBeCloseTo(60, 6)
  })
})
