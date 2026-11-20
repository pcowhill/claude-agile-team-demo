import { describe, expect, it } from 'vitest'
import type { ArrowShape, BadgeShape, BoxShape, Shape, ShapeContext, ShapeGroup } from './shapes'
import {
  activeShapeGroups,
  badgeFont,
  BADGE_ADD_STEP,
  BADGE_DIGIT_DROP,
  BADGE_DIGIT_SCALE,
  DEFAULT_BADGE_SIZE,
  DEFAULT_BADGE_STYLE,
  isValidShape,
  MAX_BADGE_NUMBER,
  newBadge,
  nextBadgeNumber,
  styleForNextShape,
  arrowHeadLength,
  arrowOutline,
  arrowPieces,
  arrowShaftAt,
  ARROW_HEAD_SIZE_FACTORS,
  DEFAULT_DRAW_ON,
  shapeGroupEntrance,
  shapeGroupRevealAt,
  withShapeEntrance,
  MIN_ARROW_HEAD,
  clampShapeGroup,
  defaultShape,
  defaultShapeGroup,
  DEFAULT_SHAPE_STYLE,
  drawShapeGroups,
  isInvisibleShape,
  isValidShapeGroupSpec,
  lineDashFor,
  pickStyle,
  shapeGroupsEqual,
  shapeGroupLabel,
  shapeGroupName,
  shapeGroupOpacityAt,
  shorterSideFraction,
  shorterSidePixels,
  withLineStyle,
} from './shapes'
import { textOpacityAt } from './textOverlay'
import type { TextOverlay } from './textOverlay'
import { DEFAULT_SUBTITLE_STYLE } from './textOverlay'
import { canvasFrameSize } from './frameSize'
import { shapeGroupsOf, timelineReducer } from './timeline'
import type { TimelineEntry, TimelineState } from './timeline'
import { copyElementSettings } from './settingsClipboard'

const ellipse = (id = 's1'): BoxShape => defaultShape(id, 'ellipse')
const group = (overrides: Partial<ShapeGroup> = {}): ShapeGroup => ({
  id: 'g1',
  offset: 2,
  duration: 4,
  shapes: [ellipse()],
  ...overrides,
})

describe('shape groups: defaults (#681 §1–§2)', () => {
  it('Add ▾ › Shape group gives one red, transparent-centred ellipse for 3 s from the playhead', () => {
    const added = defaultShapeGroup('g', 's', 7.5)
    expect(added.offset).toBe(7.5)
    expect(added.duration).toBe(3)
    expect(added.shapes).toHaveLength(1)
    expect(added.shapes[0].kind).toBe('ellipse')
    const shape = added.shapes[0] as BoxShape
    expect(shape.stroke).toBe('#e53935')
    expect(shape.strokeOpacity).toBe(1)
    expect(shape.fillOpacity).toBe(0)
    // Centred in the frame.
    expect(shape.x + shape.width / 2).toBeCloseTo(0.5)
    expect(shape.y + shape.height / 2).toBeCloseTo(0.5)
    // About 6 px at 1080p, stored as a fraction of the shorter side.
    expect(shorterSidePixels(shape.thickness, 1920, 1080)).toBeCloseTo(6)
    expect(isValidShapeGroupSpec(added)).toBe(true)
  })
})

describe('shape groups: thickness is stored proportionally and shown in px (#681 answer 4a)', () => {
  it('keeps the stored fraction through a canvas-preset change while the px shown follows the frame', () => {
    const shape = ellipse()
    const landscape = canvasFrameSize([{ width: 1920, height: 1080 }], '16:9')
    const portrait = canvasFrameSize([{ width: 1920, height: 1080 }], '9:16')
    const state: TimelineState = {
      entries: [],
      shapeGroups: [group({ shapes: [shape] })],
    }
    const reshaped = timelineReducer(state, { type: 'canvas-preset-set', preset: '9:16' })
    expect(shapeGroupsOf(reshaped)[0].shapes[0].thickness).toBe(shape.thickness)
    const px = (frame: { width: number; height: number }) =>
      shorterSidePixels(shape.thickness, frame.width, frame.height)
    // Both frames are derived from one 1920×1080 source, so the shorter side
    // differs between them and the px shown changes with it.
    expect(Math.min(landscape.width, landscape.height)).not.toBe(Math.min(portrait.width, portrait.height))
    expect(px(landscape)).not.toBeCloseTo(px(portrait))
    expect(px(landscape) / Math.min(landscape.width, landscape.height)).toBeCloseTo(shape.thickness)
  })

  it('converts a typed px value back to the same fraction', () => {
    expect(shorterSideFraction(shorterSidePixels(0.01, 1280, 720), 1280, 720)).toBeCloseTo(0.01)
    expect(shorterSideFraction(4, 0, 0)).toBe(0)
  })
})

describe('shape groups: fades follow the text rule (#177)', () => {
  const asText = (g: ShapeGroup): TextOverlay => ({
    id: g.id,
    content: 'x',
    offset: g.offset,
    duration: g.duration,
    x: 0.5,
    y: 0.5,
    font: 'sans',
    size: 0.1,
    color: '#ffffff',
    bold: false,
    italic: false,
    fadeIn: g.fadeIn,
    fadeOut: g.fadeOut,
  })

  it('matches textOpacityAt at the start, middle and end of each ramp, and outside the window', () => {
    const g = group({ offset: 2, duration: 4, fadeIn: 1, fadeOut: 2 })
    for (const time of [0, 1.999, 2, 2.5, 3, 4, 4.5, 5, 5.999, 6, 7]) {
      expect(shapeGroupOpacityAt(g, time), `t=${time}`).toBeCloseTo(textOpacityAt(asText(g), time))
    }
    expect(shapeGroupOpacityAt(g, 2.5)).toBeCloseTo(0.5)
    expect(shapeGroupOpacityAt(g, 5)).toBeCloseTo(0.5)
    expect(shapeGroupOpacityAt(g, 6)).toBe(0)
  })

  it('clamps fades into the window as text does: fade-in first, fade-out takes the rest', () => {
    expect(clampShapeGroup(group({ duration: 2, fadeIn: 1.5, fadeOut: 1.5 }))).toMatchObject({
      fadeIn: 1.5,
      fadeOut: 0.5,
    })
    // A zero fade is stored as no key at all.
    const cleared = clampShapeGroup(group({ fadeIn: 0 }))
    expect(cleared).not.toHaveProperty('fadeIn')
    // Nothing to change returns the same object.
    const steady = group({ fadeIn: 1 })
    expect(clampShapeGroup(steady)).toBe(steady)
  })
})

describe('shape groups: validity', () => {
  it('refuses malformed groups and shapes', () => {
    expect(isValidShapeGroupSpec(group())).toBe(true)
    expect(isValidShapeGroupSpec(group({ duration: 0 }))).toBe(false)
    expect(isValidShapeGroupSpec(group({ offset: -1 }))).toBe(false)
    expect(isValidShapeGroupSpec(group({ shapes: [] }))).toBe(false)
    expect(isValidShapeGroupSpec(group({ shapes: [ellipse('a'), ellipse('a')] }))).toBe(false)
    expect(isValidShapeGroupSpec(group({ shapes: [{ ...ellipse(), stroke: '#E53935' }] }))).toBe(false)
    expect(isValidShapeGroupSpec(group({ shapes: [{ ...ellipse(), fillOpacity: 1.5 }] }))).toBe(false)
    expect(isValidShapeGroupSpec(group({ shapes: [{ ...ellipse(), width: 0 }] }))).toBe(false)
    expect(isValidShapeGroupSpec(group({ shapes: [{ ...ellipse(), cornerRadius: 0.1 }] }))).toBe(false)
    const rectangle = { ...defaultShape('r', 'rectangle'), cornerRadius: 0.1 }
    expect(isValidShapeGroupSpec(group({ shapes: [rectangle] }))).toBe(true)
  })

  it('names an invisible shape: no visible border and no visible fill (#681 §6)', () => {
    expect(isInvisibleShape(DEFAULT_SHAPE_STYLE)).toBe(false)
    expect(isInvisibleShape({ ...DEFAULT_SHAPE_STYLE, strokeOpacity: 0 })).toBe(true)
    expect(isInvisibleShape({ ...DEFAULT_SHAPE_STYLE, thickness: 0 })).toBe(true)
    expect(isInvisibleShape({ ...DEFAULT_SHAPE_STYLE, thickness: 0, fillOpacity: 0.2 })).toBe(false)
  })
})

describe('shape groups: the row name derives from the contents (#681 §1)', () => {
  it('lists kinds in first-seen order, counting repeats', () => {
    expect(shapeGroupLabel(group())).toBe('Ellipse')
    expect(
      shapeGroupLabel(group({ shapes: [ellipse('a'), defaultShape('b', 'rectangle')] })),
    ).toBe('Ellipse + Rectangle')
    expect(
      shapeGroupLabel(
        group({ shapes: [ellipse('a'), ellipse('b'), ellipse('c'), defaultShape('d', 'rectangle')] }),
      ),
    ).toBe('3 ellipses + Rectangle')
  })
})

describe('shape groups: drawing (#683)', () => {
  /** Records the calls the routine makes, with the state each draw saw. */
  function recorder() {
    const calls: string[] = []
    const context = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      lineJoin: 'miter',
      globalAlpha: 1,
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      beginPath: () => calls.push('beginPath'),
      closePath: () => calls.push('closePath'),
      moveTo: () => calls.push('moveTo'),
      lineTo: () => calls.push('lineTo'),
      arcTo: () => calls.push('arcTo'),
      ellipse: (x: number, y: number, rx: number, ry: number) => calls.push(`ellipse ${x} ${y} ${rx} ${ry}`),
      rect: (x: number, y: number, w: number, h: number) => calls.push(`rect ${x} ${y} ${w} ${h}`),
      fill() {
        calls.push(`fill ${this.fillStyle} ${this.globalAlpha.toFixed(3)}`)
      },
      stroke() {
        calls.push(`stroke ${this.strokeStyle} ${this.globalAlpha.toFixed(3)} ${this.lineWidth.toFixed(2)}`)
      },
    }
    return { context: context as unknown as ShapeContext, calls }
  }

  it('fills then strokes each shape at frame pixels, skipping a transparent fill', () => {
    const { context, calls } = recorder()
    const rectangle: Shape = {
      ...defaultShape('r', 'rectangle'),
      x: 0.1,
      y: 0.2,
      width: 0.5,
      height: 0.25,
      fillOpacity: 0.4,
      fill: '#00ff00',
    }
    drawShapeGroups(context, [group({ shapes: [ellipse(), rectangle] })], 3, 1000, 400)
    const draws = calls.filter((call) => !['save', 'restore', 'beginPath'].includes(call))
    expect(draws).toEqual([
      // The default ellipse: centred, box 0.2 × 0.3 of the frame.
      'ellipse 500 200 100 60',
      // Transparent centre: no fill call, only the border, 6/1080 of 400 px.
      `stroke #e53935 1.000 ${((6 / 1080) * 400).toFixed(2)}`,
      'rect 100 80 500 100',
      'fill #00ff00 0.400',
      `stroke #e53935 1.000 ${((6 / 1080) * 400).toFixed(2)}`,
    ])
  })

  it('multiplies each opacity by the group fade, and draws nothing outside the window', () => {
    const { context, calls } = recorder()
    const faded = group({ offset: 0, duration: 4, fadeIn: 2, shapes: [{ ...ellipse(), fillOpacity: 0.5 }] })
    drawShapeGroups(context, [faded], 1, 100, 100)
    expect(calls).toContain('fill #e53935 0.250')
    expect(calls.some((call) => call.startsWith('stroke #e53935 0.500'))).toBe(true)
    const { context: quiet, calls: none } = recorder()
    drawShapeGroups(quiet, [faded], 4, 100, 100)
    expect(none).toEqual([])
  })

  it('traces a rounded rectangle with four arcs, the radius capped at half the shorter box side', () => {
    const { context, calls } = recorder()
    const rounded: Shape = { ...defaultShape('r', 'rectangle'), cornerRadius: 0.5 }
    drawShapeGroups(context, [group({ shapes: [rounded] })], 3, 100, 100)
    expect(calls.filter((call) => call === 'arcTo')).toHaveLength(4)
    expect(calls.some((call) => call.startsWith('rect'))).toBe(false)
  })

  it('stacks the later-starting group on top; groups starting together keep their order', () => {
    const early = group({ id: 'early', offset: 0, duration: 10 })
    const late = group({ id: 'late', offset: 1, duration: 10 })
    const alsoLate = group({ id: 'alsoLate', offset: 1, duration: 10 })
    expect(activeShapeGroups([late, early, alsoLate], 2).map((g) => g.id)).toEqual([
      'early',
      'late',
      'alsoLate',
    ])
    expect(activeShapeGroups([late, early], 0.5).map((g) => g.id)).toEqual(['early'])
  })
})

describe('shape groups: arrows and lines (#684)', () => {
  /** An arrow in frame fractions; the frame below is 1000 × 500 px. */
  const arrow = (overrides: Partial<ArrowShape> = {}): ArrowShape => ({
    ...defaultShape('a', 'arrow'),
    tailX: 0.1,
    tailY: 0.5,
    tipX: 0.9,
    tipY: 0.5,
    ...overrides,
  })
  const W = 1000
  const H = 500
  /** Thickness, as a stored fraction, that draws `px` pixels in the 1000 × 500 frame. */
  const px = (pixels: number) => pixels / H

  it('Add shape › Arrow gives a valid arrow across the middle, head at the tip, in the given style', () => {
    const yellow = { ...DEFAULT_SHAPE_STYLE, stroke: '#ffeb3b', thickness: 0.004 }
    const added = defaultShape('a', 'arrow', yellow)
    expect(added).toMatchObject({ kind: 'arrow', heads: 'tip', headSize: 'medium', stroke: '#ffeb3b' })
    expect((added.tailX + added.tipX) / 2).toBeCloseTo(0.5)
    expect(added.tailY).toBe(0.5)
    expect(added.tipY).toBe(0.5)
    expect(added.tipX).toBeGreaterThan(added.tailX)
    expect(isValidShapeGroupSpec(group({ shapes: [added] }))).toBe(true)
  })

  it('refuses an arrow off the frame, of no length, or with unknown heads', () => {
    const valid = (shape: ArrowShape) => isValidShapeGroupSpec(group({ shapes: [shape] }))
    expect(valid(arrow())).toBe(true)
    expect(valid(arrow({ tipX: 1.1 }))).toBe(false)
    expect(valid(arrow({ tipX: 0.1 }))).toBe(false)
    expect(valid(arrow({ heads: 'tail' as ArrowShape['heads'] }))).toBe(false)
    expect(valid(arrow({ headSize: 'huge' as ArrowShape['headSize'] }))).toBe(false)
  })

  it('is invisible with no visible border, whatever its fill says', () => {
    expect(isInvisibleShape(arrow())).toBe(false)
    expect(isInvisibleShape(arrow({ thickness: 0, fillOpacity: 1 }))).toBe(true)
    expect(isInvisibleShape(arrow({ strokeOpacity: 0, fillOpacity: 1 }))).toBe(true)
  })

  it('counts arrows in the row name', () => {
    expect(shapeGroupLabel(group({ shapes: [ellipse('e'), arrow({ id: 'a' }), arrow({ id: 'b' })] }))).toBe(
      'Ellipse + 2 arrows',
    )
  })

  it('sizes a head by its preset times the thickness, never below the minimum (#684)', () => {
    // 10 px thick: medium is 4.5 × 10 = 45 px, above the 0.02 × 500 = 10 px floor.
    expect(arrowHeadLength(arrow({ thickness: px(10) }), W, H)).toBeCloseTo(45)
    expect(arrowHeadLength(arrow({ thickness: px(10), headSize: 'small' }), W, H)).toBeCloseTo(30)
    expect(arrowHeadLength(arrow({ thickness: px(10), headSize: 'large' }), W, H)).toBeCloseTo(60)
    // 1 px thick: 4.5 px would be a nub, so the floor holds it at 10 px.
    expect(arrowHeadLength(arrow({ thickness: px(1) }), W, H)).toBeCloseTo(MIN_ARROW_HEAD * H)
    expect(MIN_ARROW_HEAD * H).toBeGreaterThan(ARROW_HEAD_SIZE_FACTORS.large * 1)
    // At 1080p and 360p, a 1 px arrow's head is the floor of each frame.
    expect(arrowHeadLength(arrow({ thickness: 1 / 1080 }), 1920, 1080)).toBeCloseTo(21.6)
    expect(arrowHeadLength(arrow({ thickness: 1 / 360 }), 640, 360)).toBeCloseTo(7.2)
  })

  it('outlines a tip-headed arrow: the shaft band, then a head ending exactly at the tip', () => {
    // Tail (100, 250) → tip (900, 250), 10 px thick, head 45 px long and 45 px wide.
    const points = arrowOutline(arrow({ thickness: px(10) }), W, H)
    const round = points.map(({ x, y }) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100])
    expect(round).toEqual([
      [100, 255],
      [855, 255],
      [855, 272.5],
      [900, 250],
      [855, 227.5],
      [855, 245],
      [100, 245],
    ])
    // Nothing reaches past the tip or behind the tail.
    expect(Math.max(...points.map((p) => p.x))).toBe(900)
    expect(Math.min(...points.map((p) => p.x))).toBe(100)
  })

  it('puts a head at each end for Both ends, and none for a line', () => {
    const both = arrowOutline(arrow({ thickness: px(10), heads: 'both' }), W, H)
    expect(both).toHaveLength(10)
    expect(both[0]).toEqual({ x: 100, y: 250 })
    expect(both).toContainEqual({ x: 900, y: 250 })
    const line = arrowOutline(arrow({ thickness: px(10), heads: 'none' }), W, H)
    expect(line.map(({ x, y }) => [x, y])).toEqual([
      [100, 255],
      [900, 255],
      [900, 245],
      [100, 245],
    ])
  })

  it('fits the heads into a short arrow, and is never narrower than its shaft', () => {
    // 20 px long, 10 px thick, heads both ends: each head is cut to 10 px.
    const short = arrow({ tailX: 0.49, tipX: 0.51, thickness: px(10), heads: 'both' })
    const points = arrowOutline(short, W, H)
    const xs = points.map((p) => Math.round(p.x * 1000) / 1000)
    expect(Math.min(...xs)).toBe(490)
    expect(Math.max(...xs)).toBe(510)
    // The two heads' bases meet in the middle.
    expect(xs.filter((x) => x === 500).length).toBeGreaterThanOrEqual(4)
    const ys = points.map((p) => p.y)
    expect(Math.max(...ys) - 250).toBeGreaterThanOrEqual(5)
  })

  it('draws as one filled outline in the border colour and opacity, faded with the group', () => {
    const calls: string[] = []
    const recording = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      lineJoin: 'miter',
      globalAlpha: 1,
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      beginPath: () => calls.push('beginPath'),
      closePath: () => calls.push('closePath'),
      moveTo: (x: number, y: number) => calls.push(`moveTo ${x} ${y}`),
      lineTo: () => calls.push('lineTo'),
      arcTo: () => calls.push('arcTo'),
      ellipse: () => calls.push('ellipse'),
      rect: () => calls.push('rect'),
      fill() {
        calls.push(`fill ${this.fillStyle} ${this.globalAlpha.toFixed(3)}`)
      },
      stroke: () => calls.push('stroke'),
    }
    const context = recording as unknown as ShapeContext
    const faded = group({
      offset: 0,
      duration: 4,
      fadeIn: 2,
      shapes: [arrow({ stroke: '#00ff00', strokeOpacity: 0.8, fill: '#ff0000', fillOpacity: 1 })],
    })
    drawShapeGroups(context, [faded], 1, W, H)
    // Half-way through the fade: 0.8 × 0.5. Never the fill colour, never a stroke.
    expect(calls).toContain('fill #00ff00 0.400')
    expect(calls.some((call) => call.startsWith('fill #ff0000'))).toBe(false)
    expect(calls).not.toContain('stroke')
    expect(calls.filter((call) => call.startsWith('fill'))).toHaveLength(1)
    expect(calls).toContain('closePath')
  })
})

describe('shape-group row actions: Duplicate, Paste settings and Rename… (#687)', () => {
  const twoGroups = (): TimelineState => ({
    entries: [],
    shapeGroups: [
      group({ id: 'g1', offset: 2, duration: 4, fadeIn: 0.5, fadeOut: 1, shapes: [ellipse('a'), ellipse('b')] }),
      group({ id: 'g2', offset: 10, duration: 3, shapes: [defaultShape('r', 'rectangle')] }),
    ],
  })
  const clip: TimelineEntry = {
    id: 'e1',
    clipId: 'c1',
    name: 'a.mp4',
    duration: 10,
    url: 'blob:a',
    inPoint: 0,
    outPoint: 10,
    volume: 0.4,
    fadeIn: 1,
    fadeOut: 2,
  }

  it('Duplicate starts the copy at the original end, right after it, with equal shapes, fades and name', () => {
    const state = twoGroups()
    const named = timelineReducer(state, { type: 'element-renamed', id: 'g1', name: 'Callouts' })
    const next = timelineReducer(named, { type: 'element-duplicated', kind: 'shape-group', id: 'g1', newId: 'g1b' })
    const groups = shapeGroupsOf(next)
    expect(groups.map((each) => each.id)).toEqual(['g1', 'g1b', 'g2'])
    const [original, copy] = groups
    expect(copy.offset).toBe(original.offset + original.duration)
    expect(copy.duration).toBe(original.duration)
    expect(copy.fadeIn).toBe(0.5)
    expect(copy.fadeOut).toBe(1)
    expect(copy.name).toBe('Callouts')
    expect(copy.shapes).toEqual(original.shapes)
    // A copy, not a shared reference: editing one never edits the other.
    expect(copy.shapes[0]).not.toBe(original.shapes[0])
  })

  it('Duplicate refuses an unknown original or a taken id, as the other kinds do', () => {
    const state = twoGroups()
    expect(timelineReducer(state, { type: 'element-duplicated', kind: 'shape-group', id: 'nope', newId: 'x' })).toBe(state)
    expect(timelineReducer(state, { type: 'element-duplicated', kind: 'shape-group', id: 'g1', newId: 'g2' })).toBe(state)
  })

  it('pasting one group\'s settings onto another changes its timing and fades and leaves its shapes', () => {
    const state = twoGroups()
    const [source, target] = shapeGroupsOf(state)
    const copied = copyElementSettings('shape-group', source)!
    const next = timelineReducer(state, { type: 'settings-pasted', kind: 'shape-group', id: 'g2', settings: copied })
    const pasted = shapeGroupsOf(next)[1]
    expect(pasted).toMatchObject({ id: 'g2', offset: 2, duration: 4, fadeIn: 0.5, fadeOut: 1 })
    expect(pasted.shapes).toBe(target.shapes)
    // The source is untouched, and the paste is one edit.
    expect(shapeGroupsOf(next)[0]).toBe(source)
  })

  it('pasting an unfaded group\'s settings clears the target\'s fades, the identity rule', () => {
    const state = twoGroups()
    const copied = copyElementSettings('shape-group', shapeGroupsOf(state)[1])!
    const next = timelineReducer(state, { type: 'settings-pasted', kind: 'shape-group', id: 'g1', settings: copied })
    const pasted = shapeGroupsOf(next)[0]
    expect(pasted).not.toHaveProperty('fadeIn')
    expect(pasted).not.toHaveProperty('fadeOut')
    expect(pasted).toMatchObject({ offset: 10, duration: 3 })
  })

  it('a paste equal to the target is not an edit, and an invalid one is refused whole', () => {
    const state = twoGroups()
    const [source] = shapeGroupsOf(state)
    const own = copyElementSettings('shape-group', source)!
    expect(timelineReducer(state, { type: 'settings-pasted', kind: 'shape-group', id: 'g1', settings: own })).toBe(state)
    const bad = { 'shape-timing': { offset: 0, duration: 0, fadeIn: 0, fadeOut: 0 } }
    expect(timelineReducer(state, { type: 'settings-pasted', kind: 'shape-group', id: 'g2', settings: bad })).toBe(state)
  })

  it('a video clip\'s settings onto a shape group, and a group\'s onto the clip, change nothing (#332 class)', () => {
    const state: TimelineState = { ...twoGroups(), entries: [clip] }
    const fromClip = copyElementSettings('entry', clip)!
    const ontoGroup = timelineReducer(state, {
      type: 'settings-pasted',
      kind: 'shape-group',
      id: 'g1',
      settings: fromClip,
    })
    expect(ontoGroup).toBe(state)
    const fromGroup = copyElementSettings('shape-group', shapeGroupsOf(state)[0])!
    const ontoClip = timelineReducer(state, { type: 'settings-pasted', kind: 'entry', id: 'e1', settings: fromGroup })
    expect(ontoClip).toBe(state)
    expect(ontoClip.entries[0]).toMatchObject({ volume: 0.4, fadeIn: 1, fadeOut: 2 })
  })

  it('Rename sets a trimmed name; an empty one clears it back to the derived name', () => {
    const state = twoGroups()
    const named = timelineReducer(state, { type: 'element-renamed', id: 'g2', name: '  Box  ' })
    expect(shapeGroupsOf(named)[1].name).toBe('Box')
    expect(shapeGroupName(shapeGroupsOf(named)[1])).toBe('Box')
    // The same name again is not an edit.
    expect(timelineReducer(named, { type: 'element-renamed', id: 'g2', name: 'Box' })).toBe(named)
    const cleared = timelineReducer(named, { type: 'element-renamed', id: 'g2', name: '   ' })
    expect(shapeGroupsOf(cleared)[1]).not.toHaveProperty('name')
    expect(shapeGroupName(shapeGroupsOf(cleared)[1])).toBe('Rectangle')
    // Clearing a name the group never had is not an edit either.
    expect(timelineReducer(state, { type: 'element-renamed', id: 'g2', name: '' })).toBe(state)
  })

  it('a field edit keeps the name, and validity refuses an untrimmed or empty one', () => {
    const named = timelineReducer(twoGroups(), { type: 'element-renamed', id: 'g1', name: 'Callouts' })
    const { id: _id, ...spec } = shapeGroupsOf(named)[0]
    const moved = timelineReducer(named, { type: 'shape-group-updated', id: 'g1', group: { ...spec, offset: 3 } })
    expect(shapeGroupsOf(moved)[0]).toMatchObject({ offset: 3, name: 'Callouts' })
    expect(isValidShapeGroupSpec({ ...spec, name: '' })).toBe(false)
    expect(isValidShapeGroupSpec({ ...spec, name: ' x' })).toBe(false)
    expect(isValidShapeGroupSpec({ ...spec, name: 'x' })).toBe(true)
  })
})

describe('shape groups: dashed and dotted lines (#688)', () => {
  /** Records draws, with the dash pattern and cap each one saw. */
  function recorder() {
    const calls: string[] = []
    const stack: { dash: number[]; cap: string }[] = []
    const context = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      lineJoin: 'miter',
      lineCap: 'butt',
      globalAlpha: 1,
      dash: [] as number[],
      save() {
        stack.push({ dash: this.dash, cap: this.lineCap })
        calls.push('save')
      },
      restore() {
        const top = stack.pop()
        if (top !== undefined) {
          this.dash = top.dash
          this.lineCap = top.cap
        }
        calls.push('restore')
      },
      setLineDash(segments: number[]) {
        this.dash = [...segments]
        calls.push(`setLineDash ${segments.map((n) => n.toFixed(2)).join(',')}`)
      },
      beginPath: () => calls.push('beginPath'),
      closePath: () => calls.push('closePath'),
      moveTo: (x: number, y: number) => calls.push(`moveTo ${x.toFixed(1)} ${y.toFixed(1)}`),
      lineTo: (x: number, y: number) => calls.push(`lineTo ${x.toFixed(1)} ${y.toFixed(1)}`),
      arcTo: () => calls.push('arcTo'),
      ellipse: () => calls.push('ellipse'),
      rect: () => calls.push('rect'),
      fill() {
        calls.push(`fill ${this.fillStyle} ${this.globalAlpha.toFixed(3)}`)
      },
      stroke() {
        calls.push(
          `stroke ${this.strokeStyle} ${this.lineWidth.toFixed(2)} dash=[${this.dash
            .map((n) => n.toFixed(2))
            .join(',')}] cap=${this.lineCap}`,
        )
      },
    }
    return { context: context as unknown as ShapeContext, calls }
  }
  // A 1000 × 500 frame: thickness 0.02 of the shorter side is 10 px.
  const W = 1000
  const H = 500
  const box = (lineStyle?: 'solid' | 'dashed' | 'dotted'): BoxShape => ({
    ...defaultShape('r', 'rectangle'),
    thickness: 0.02,
    ...(lineStyle === undefined ? {} : { lineStyle }),
  })

  it('patterns scale with the line width: dashes 3 on 2, dots 1 on 1, solid none', () => {
    expect(lineDashFor('dashed', 10)).toEqual([30, 20])
    expect(lineDashFor('dotted', 10)).toEqual([10, 10])
    expect(lineDashFor('dashed', 4)).toEqual([12, 8])
    expect(lineDashFor('solid', 10)).toEqual([])
    expect(lineDashFor(undefined, 10)).toEqual([])
    expect(lineDashFor('dashed', 0)).toEqual([])
  })

  it('strokes a dashed or dotted border with its pattern and butt caps, and leaves the next shape solid', () => {
    const { context, calls } = recorder()
    const shapes = [box('dashed'), { ...box('dotted'), id: 'd' }, { ...box(), id: 's' }]
    drawShapeGroups(context, [group({ shapes })], 3, W, H)
    expect(calls.filter((call) => call.startsWith('stroke'))).toEqual([
      'stroke #e53935 10.00 dash=[30.00,20.00] cap=butt',
      'stroke #e53935 10.00 dash=[10.00,10.00] cap=butt',
      // Restored after the dotted one: the solid shape draws unbroken.
      'stroke #e53935 10.00 dash=[] cap=butt',
    ])
  })

  it('leaves a solid shape exactly as before: no dash call at all, with or without the key', () => {
    for (const shape of [box(), box('solid')]) {
      const { context, calls } = recorder()
      drawShapeGroups(context, [group({ shapes: [shape] })], 3, W, H)
      expect(calls.some((call) => call.startsWith('setLineDash'))).toBe(false)
      expect(calls.filter((call) => call === 'save')).toHaveLength(1)
    }
  })

  /** An arrow along y = 250 from x 200 to x 800, 10 px thick. */
  const arrow = (overrides: Partial<ArrowShape> = {}): ArrowShape => ({
    ...defaultShape('a', 'arrow'),
    tailX: 0.2,
    tailY: 0.5,
    tipX: 0.8,
    tipY: 0.5,
    thickness: 0.02,
    lineStyle: 'dashed',
    ...overrides,
  })

  it('splits a dashed arrow into solid head triangles and a shaft that ends at their bases', () => {
    // Medium heads: 4.5 × 10 px = 45 px long and 45 px wide.
    const tip = arrowPieces(arrow(), W, H)
    expect(tip?.lineWidth).toBe(10)
    expect(tip?.shaft).toEqual({ from: { x: 200, y: 250 }, to: { x: 755, y: 250 } })
    expect(tip?.heads).toEqual([
      [
        { x: 755, y: 272.5 },
        { x: 800, y: 250 },
        { x: 755, y: 227.5 },
      ],
    ])
    // The same triangle the solid outline draws at the tip.
    const outline = arrowOutline(arrow(), W, H)
    for (const point of tip?.heads[0] ?? []) expect(outline).toContainEqual(point)
    const both = arrowPieces(arrow({ heads: 'both' }), W, H)
    expect(both?.shaft).toEqual({ from: { x: 245, y: 250 }, to: { x: 755, y: 250 } })
    expect(both?.heads).toHaveLength(2)
    const line = arrowPieces(arrow({ heads: 'none' }), W, H)
    expect(line?.shaft).toEqual({ from: { x: 200, y: 250 }, to: { x: 800, y: 250 } })
    expect(line?.heads).toEqual([])
    expect(arrowPieces(arrow({ thickness: 0 }), W, H)).toBeNull()
  })

  it('draws a dashed arrow as its filled heads, then its shaft stroked dashed, in the border colour', () => {
    const { context, calls } = recorder()
    const faded = group({
      offset: 0,
      duration: 4,
      fadeIn: 2,
      shapes: [arrow({ heads: 'both', stroke: '#00ff00', strokeOpacity: 0.8 })],
    })
    drawShapeGroups(context, [faded], 1, W, H)
    expect(calls.filter((call) => call.startsWith('fill'))).toEqual([
      'fill #00ff00 0.400',
      'fill #00ff00 0.400',
    ])
    expect(calls.filter((call) => call.startsWith('stroke'))).toEqual([
      'stroke #00ff00 10.00 dash=[30.00,20.00] cap=butt',
    ])
    const stroke = calls.findIndex((call) => call.startsWith('stroke'))
    expect(calls.slice(stroke - 2, stroke)).toEqual(['moveTo 245.0 250.0', 'lineTo 755.0 250.0'])
    // A solid arrow is still the one filled outline, with no stroke.
    const { context: solid, calls: solidCalls } = recorder()
    drawShapeGroups(solid, [group({ shapes: [arrow({ lineStyle: undefined })] })], 3, W, H)
    expect(solidCalls.filter((call) => call.startsWith('fill'))).toHaveLength(1)
    expect(solidCalls.some((call) => call.startsWith('stroke') || call.startsWith('setLineDash'))).toBe(false)
  })

  it('stores solid as no key, carries a dash to the next shape, and tells styles apart', () => {
    const dashed = withLineStyle(box(), 'dashed')
    expect(dashed.lineStyle).toBe('dashed')
    expect('lineStyle' in withLineStyle(dashed, 'solid')).toBe(false)
    const untouched = box()
    expect(withLineStyle(untouched, 'solid')).toBe(untouched)
    expect(pickStyle(dashed).lineStyle).toBe('dashed')
    expect('lineStyle' in pickStyle({ ...box(), lineStyle: 'solid' })).toBe(false)
    expect(defaultShape('n', 'ellipse', pickStyle(dashed)).lineStyle).toBe('dashed')
    expect(shapeGroupsEqual(group({ shapes: [box()] }), group({ shapes: [dashed] }))).toBe(false)
    expect(shapeGroupsEqual(group({ shapes: [box()] }), group({ shapes: [box('solid')] }))).toBe(true)
  })

  it('validates the line style', () => {
    expect(isValidShapeGroupSpec(group({ shapes: [box('dotted')] }))).toBe(true)
    expect(
      isValidShapeGroupSpec(group({ shapes: [{ ...box(), lineStyle: 'wavy' as unknown as 'dashed' }] })),
    ).toBe(false)
  })
})

describe('shape groups: numbered badges (#689)', () => {
  const badges = (shapes: readonly Shape[]) =>
    shapes.filter((shape): shape is BadgeShape => shape.kind === 'badge')

  it('numbers three new badges 1, 2, 3; with badge 2 deleted, the next is 4', () => {
    let shapes: Shape[] = [ellipse()]
    for (const id of ['b1', 'b2', 'b3']) shapes = [...shapes, newBadge(id, shapes)]
    expect(badges(shapes).map((badge) => badge.number)).toEqual([1, 2, 3])
    // Every step is a group the reducer accepts.
    expect(isValidShapeGroupSpec({ offset: 0, duration: 3, shapes })).toBe(true)
    shapes = shapes.filter((shape) => shape.id !== 'b2')
    expect(badges(shapes).map((badge) => badge.number)).toEqual([1, 3])
    shapes = [...shapes, newBadge('b4', shapes)]
    expect(badges(shapes).map((badge) => badge.number)).toEqual([1, 3, 4])
  })

  it('counts from the highest number, an edited one included, and stops at the ceiling', () => {
    const edited: BadgeShape = { ...newBadge('b1', []), number: 7 }
    expect(nextBadgeNumber([edited])).toBe(8)
    expect(nextBadgeNumber([ellipse()])).toBe(1)
    expect(nextBadgeNumber([{ ...edited, number: MAX_BADGE_NUMBER }])).toBe(MAX_BADGE_NUMBER)
  })

  it("starts as a solid red disc with a white number, whatever the group's other shapes look like", () => {
    const first = newBadge('b1', [{ ...ellipse(), fillOpacity: 0, stroke: '#0000ff' }])
    expect(first).toMatchObject({ ...DEFAULT_BADGE_STYLE, size: DEFAULT_BADGE_SIZE, number: 1 })
    expect(first.fill).toBe('#e53935')
    expect(first.fillOpacity).toBe(1)
    expect({ x: first.centerX, y: first.centerY }).toEqual({ x: 0.5, y: 0.5 })
  })

  it("takes the group's last badge's look, and lands a step to its right (or where clicked)", () => {
    const styled: BadgeShape = {
      ...newBadge('b1', []),
      fill: '#ffeb3b',
      numberColor: '#000000',
      size: 0.12,
      thickness: 0.004,
    }
    const next = newBadge('b2', [styled, ellipse()])
    expect(next).toMatchObject({ fill: '#ffeb3b', numberColor: '#000000', size: 0.12, thickness: 0.004 })
    expect(next.centerX).toBeCloseTo(styled.centerX + BADGE_ADD_STEP, 10)
    expect(next.centerY).toBe(styled.centerY)
    // At the right edge it wraps to the left, a step lower.
    const wrapped = newBadge('b3', [{ ...styled, centerX: 0.97, centerY: 0.3 }])
    expect({ x: wrapped.centerX, y: wrapped.centerY }).toEqual({ x: BADGE_ADD_STEP, y: 0.4 })
    const clicked = newBadge('b4', [styled], { x: 0.123, y: 0.789 })
    expect({ x: clicked.centerX, y: clicked.centerY }).toEqual({ x: 0.12, y: 0.79 })
  })

  it('is passed over when the next rectangle, ellipse or arrow takes a style', () => {
    const red = { ...ellipse(), stroke: '#00ff00' }
    expect(styleForNextShape([red, newBadge('b1', [red])])).toEqual(pickStyle(red))
    expect(styleForNextShape([newBadge('b1', [])])).toEqual(pickStyle(DEFAULT_SHAPE_STYLE))
  })

  it('is valid only with a whole number 0 to 999, a legible size and its centre on the frame', () => {
    const badge = newBadge('b1', [])
    expect(isValidShape(badge)).toBe(true)
    expect(isValidShape({ ...badge, number: 0 })).toBe(true)
    for (const change of [
      { number: 2.5 },
      { number: -1 },
      { number: MAX_BADGE_NUMBER + 1 },
      { size: 0.01 },
      { size: 0.6 },
      { centerX: -0.1 },
      { numberColor: 'white' },
    ]) {
      expect(isValidShape({ ...badge, ...change })).toBe(false)
    }
  })

  it('is never invisible, since its number always draws, and names itself in the group label', () => {
    expect(isInvisibleShape({ ...newBadge('b1', []), fillOpacity: 0, thickness: 0 })).toBe(false)
    const shapes = [newBadge('b1', []), newBadge('b2', [newBadge('b1', [])]), ellipse()]
    expect(shapeGroupLabel({ offset: 0, duration: 1, shapes })).toBe('2 badges + Ellipse')
  })

  it('fills the disc, rings it, then sets its number centred on top, all at frame pixels', () => {
    const calls: string[] = []
    const context = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      lineJoin: 'miter',
      lineCap: 'butt',
      globalAlpha: 1,
      font: '',
      textAlign: 'start',
      textBaseline: 'alphabetic',
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      beginPath: () => calls.push('beginPath'),
      setLineDash: (dash: number[]) => calls.push(`dash ${dash.join(',')}`),
      ellipse: (x: number, y: number, rx: number, ry: number) => calls.push(`ellipse ${x} ${y} ${rx} ${ry}`),
      fill() {
        calls.push(`fill ${this.fillStyle} ${this.globalAlpha.toFixed(3)}`)
      },
      stroke() {
        calls.push(`stroke ${this.strokeStyle} ${this.globalAlpha.toFixed(3)} ${this.lineWidth.toFixed(2)}`)
      },
      fillText(text: string, x: number, y: number) {
        calls.push(`text ${text} ${x} ${y} ${this.fillStyle} ${this.globalAlpha.toFixed(3)} ${this.font} ${this.textAlign} ${this.textBaseline}`)
      },
    }
    const badge: BadgeShape = {
      ...newBadge('b1', []),
      centerX: 0.25,
      centerY: 0.5,
      size: 0.1,
      number: 12,
      thickness: 0.01,
    }
    const faded = group({ offset: 0, duration: 4, fadeIn: 2, shapes: [badge] })
    drawShapeGroups(context as unknown as ShapeContext, [faded], 1, 1000, 400)
    const draws = calls.filter((call) => !['save', 'restore', 'beginPath'].includes(call))
    // Shorter side 400 px: a 40 px disc (radius 20), a 4 px ring, two digits at half the diameter.
    const fontPx = 40 * BADGE_DIGIT_SCALE[2]
    expect(draws).toEqual([
      'ellipse 250 200 20 20',
      'fill #e53935 0.500',
      'stroke #ffffff 0.500 4.00',
      // Set on the alphabetic baseline, dropped by BADGE_DIGIT_DROP of the font size.
      `text 12 250 ${200 + fontPx * BADGE_DIGIT_DROP} #ffffff 0.500 ${badgeFont(fontPx)} center alphabetic`,
    ])
    expect(badgeFont(fontPx)).toBe('700 20px Arial, Helvetica, sans-serif')
  })
})

describe('shape groups: the Draw on entrance (#690)', () => {
  const drawing = (overrides: Partial<ShapeGroup> = {}) => group({ offset: 2, duration: 4, drawOn: 1, ...overrides })

  it('reveals from 0 at the group start to 1 at the end of its draw-on, and holds there', () => {
    const g = drawing()
    expect(shapeGroupRevealAt(g, 2)).toBe(0)
    expect(shapeGroupRevealAt(g, 2.25)).toBeCloseTo(0.25, 10)
    expect(shapeGroupRevealAt(g, 2.5)).toBeCloseTo(0.5, 10)
    expect(shapeGroupRevealAt(g, 3)).toBe(1)
    expect(shapeGroupRevealAt(g, 5.9)).toBe(1)
    // A group that fades in, or has no entrance, is always wholly drawn.
    expect(shapeGroupRevealAt(group({ fadeIn: 1 }), 2)).toBe(1)
    expect(shapeGroupRevealAt(group(), 2)).toBe(1)
  })

  it('is clamped into the window the way a fade-in is: the fade-out absorbs the shortfall', () => {
    // A draw-on longer than the group is cut to the group's length, so the
    // group still finishes drawing on its last instant…
    const long = clampShapeGroup(drawing({ drawOn: 10, fadeOut: 1 }))
    expect(long.drawOn).toBe(4)
    expect(long).not.toHaveProperty('fadeOut')
    expect(shapeGroupRevealAt(long, 4)).toBeCloseTo(0.5, 10)
    // …and a fade-out shares the window with it as with a fade-in.
    const shared = clampShapeGroup(drawing({ drawOn: 3, fadeOut: 2 }))
    expect(shared).toMatchObject({ drawOn: 3, fadeOut: 1 })
    expect(clampShapeGroup(group({ fadeIn: 3, fadeOut: 2 }))).toMatchObject({ fadeIn: 3, fadeOut: 1 })
    // Nothing to clamp: the same object.
    const fits = drawing({ fadeOut: 1 })
    expect(clampShapeGroup(fits)).toBe(fits)
  })

  it('is one entrance or the other: a draw-on beside a fade-in, or of no length, is invalid', () => {
    expect(isValidShapeGroupSpec(drawing())).toBe(true)
    expect(isValidShapeGroupSpec(drawing({ fadeIn: 0.5 }))).toBe(false)
    expect(isValidShapeGroupSpec(drawing({ drawOn: 0 }))).toBe(false)
    expect(isValidShapeGroupSpec(drawing({ drawOn: Number.NaN }))).toBe(false)
    expect(shapeGroupsEqual(drawing(), drawing({ drawOn: 2 }))).toBe(false)
    expect(shapeGroupsEqual(drawing(), group())).toBe(false)
  })

  it('switching the entrance carries its length across, and back again', () => {
    const fading = group({ fadeIn: 0.7, fadeOut: 0.5 })
    expect(shapeGroupEntrance(fading)).toBe('fade')
    const drawn = withShapeEntrance(fading, 'draw-on')
    expect(shapeGroupEntrance(drawn)).toBe('draw-on')
    expect(drawn).toMatchObject({ drawOn: 0.7, fadeOut: 0.5 })
    expect(drawn).not.toHaveProperty('fadeIn')
    expect(withShapeEntrance(drawn, 'fade')).toEqual(fading)
    // No fade-in to keep: the default, or the whole window if shorter.
    expect(withShapeEntrance(group(), 'draw-on').drawOn).toBe(DEFAULT_DRAW_ON)
    expect(withShapeEntrance(group({ duration: 0.5 }), 'draw-on').drawOn).toBe(0.5)
    expect(withShapeEntrance(fading, 'fade')).toBe(fading)
  })

  it('a group that draws on does not also fade in', () => {
    expect(shapeGroupOpacityAt(drawing(), 2)).toBe(1)
    expect(shapeGroupOpacityAt(drawing({ fadeOut: 2 }), 5)).toBeCloseTo(0.5, 10)
  })

  /** Records each call with its arguments rounded to 0.01 px. */
  function recorder() {
    const calls: string[] = []
    const n = (value: number) => String(Math.round(value * 100) / 100)
    const context = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      lineJoin: 'miter',
      lineCap: 'round',
      globalAlpha: 1,
      dash: [] as number[],
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      beginPath: () => calls.push('beginPath'),
      closePath: () => calls.push('closePath'),
      moveTo: (x: number, y: number) => calls.push(`moveTo ${n(x)} ${n(y)}`),
      lineTo: (x: number, y: number) => calls.push(`lineTo ${n(x)} ${n(y)}`),
      arcTo: () => calls.push('arcTo'),
      ellipse: (x: number, y: number, rx: number, ry: number, _r: number, a0: number, a1: number) =>
        calls.push(`ellipse ${n(x)} ${n(y)} ${n(rx)} ${n(ry)} ${n(a0 / Math.PI)}π ${n(a1 / Math.PI)}π`),
      rect: (x: number, y: number, w: number, h: number) => calls.push(`rect ${x} ${y} ${w} ${h}`),
      setLineDash(dash: number[]) {
        this.dash = dash
      },
      fill() {
        calls.push(`fill ${this.fillStyle} ${this.globalAlpha.toFixed(3)}`)
      },
      stroke() {
        calls.push(`stroke ${this.strokeStyle} ${this.globalAlpha.toFixed(3)} ${this.lineCap} [${this.dash.join(',')}]`)
      },
      fillText: (text: string) => calls.push(`fillText ${text}`),
    }
    return { context: context as unknown as ShapeContext, calls }
  }

  const arrow = (overrides: Partial<ArrowShape> = {}): ArrowShape => ({
    ...defaultShape('a', 'arrow'),
    tailX: 0.1,
    tailY: 0.5,
    tipX: 0.9,
    tipY: 0.5,
    thickness: 0.01,
    ...overrides,
  })

  it('grows an arrow\'s shaft from its tail to the base of its head, which comes only at the end', () => {
    // 1000 × 1000: the arrow runs from x 100 to x 900 at y 500.
    const shape = arrow()
    const head = arrowPieces(shape, 1000, 1000)!.shaft.to.x
    expect(head).toBeLessThan(900)
    expect(arrowShaftAt(shape, 0.5, 1000, 1000)!.to.x).toBeCloseTo(100 + (head - 100) / 2, 10)
    const { context, calls } = recorder()
    drawShapeGroups(context, [drawing({ shapes: [shape] })], 2.5, 1000, 1000)
    // One open stroke, butt-ended, from the tail halfway to the head's base;
    // no filled outline, so no head.
    expect(calls).toContain('moveTo 100 500')
    expect(calls).toContain(`lineTo ${Math.round((100 + (head - 100) / 2) * 100) / 100} 500`)
    expect(calls.filter((call) => call.startsWith('fill'))).toEqual([])
    expect(calls.filter((call) => call.startsWith('stroke'))).toEqual(['stroke #e53935 1.000 butt []'])
    // A tail head waits too: the shaft starts at its base.
    expect(arrowShaftAt(arrow({ heads: 'both' }), 0, 1000, 1000)!.from.x).toBeGreaterThan(100)
  })

  it('after the draw-on, draws every shape exactly as a group with no entrance', () => {
    const shapes: Shape[] = [
      arrow(),
      { ...ellipse('e'), fillOpacity: 0.5 },
      { ...defaultShape('r', 'rectangle'), cornerRadius: 0.02, lineStyle: 'dashed' },
      newBadge('b', []),
    ]
    for (const time of [3, 4.5]) {
      const { context: drawn, calls: after } = recorder()
      drawShapeGroups(drawn, [drawing({ shapes })], time, 1280, 720)
      const { context: plain, calls: none } = recorder()
      drawShapeGroups(plain, [group({ shapes })], time, 1280, 720)
      expect(after).toEqual(none)
    }
  })

  it('traces an ellipse\'s border from the top, clockwise, and fades its fill in with it', () => {
    const shape: BoxShape = { ...ellipse('e'), x: 0.25, y: 0.25, width: 0.5, height: 0.5, fillOpacity: 0.8 }
    const { context, calls } = recorder()
    drawShapeGroups(context, [drawing({ shapes: [shape] })], 2.5, 1000, 1000)
    // Half the border: from the top (−π/2), through the right (0), to the
    // bottom (π/2) — canvas angles grow clockwise on screen. The bottom-left
    // (3π/4) is still to come.
    expect(calls).toContain('ellipse 500 500 250 250 -0.5π 0.5π')
    expect(calls).toContain('fill #e53935 0.400')
    expect(calls.filter((call) => call.startsWith('stroke'))).toEqual(['stroke #e53935 1.000 butt []'])
  })

  it('traces a rectangle\'s border from its top-left corner, clockwise, keeping its line style', () => {
    const shape: BoxShape = {
      ...defaultShape('r', 'rectangle'),
      x: 0.1,
      y: 0.1,
      width: 0.6,
      height: 0.2,
      lineStyle: 'dashed',
    }
    // Frame 1000 × 1000: a 600 × 200 box, 1600 px around. At a quarter,
    // 400 px: the whole top edge (600) is not yet done.
    const { context, calls } = recorder()
    drawShapeGroups(context, [drawing({ shapes: [shape] })], 2.25, 1000, 1000)
    const path = calls.filter((call) => call.startsWith('moveTo') || call.startsWith('lineTo'))
    expect(path).toEqual(['moveTo 100 100', 'lineTo 500 100'])
    expect(calls.find((call) => call.startsWith('stroke'))).toMatch(/^stroke #e53935 1\.000 butt \[\d/)
    // At three quarters, 1200 px: top (600), right side (200), and 400 of
    // the bottom edge, running right to left.
    const { context: later, calls: more } = recorder()
    drawShapeGroups(later, [drawing({ shapes: [shape] })], 2.75, 1000, 1000)
    expect(more.filter((call) => call.startsWith('moveTo') || call.startsWith('lineTo'))).toEqual([
      'moveTo 100 100',
      'lineTo 700 100',
      'lineTo 700 300',
      'lineTo 300 300',
    ])
  })

  it('a rounded rectangle turns its corners as quarter arcs', () => {
    const shape: BoxShape = { ...defaultShape('r', 'rectangle'), x: 0, y: 0, width: 1, height: 1, cornerRadius: 0.1 }
    const { context, calls } = recorder()
    // Almost all the way round: every corner but the last is a quarter arc.
    drawShapeGroups(context, [drawing({ shapes: [shape] })], 2.99, 1000, 1000)
    expect(calls.filter((call) => call.startsWith('ellipse'))).toEqual([
      'ellipse 900 100 100 100 -0.5π 0π',
      'ellipse 900 900 100 100 0π 0.5π',
      'ellipse 100 900 100 100 0.5π 1π',
      expect.stringMatching(/^ellipse 100 100 100 100 1π 1\.\d+π$/),
    ])
  })

  it('fades a badge in whole, and draws nothing at the very start', () => {
    const { context, calls } = recorder()
    drawShapeGroups(context, [drawing({ shapes: [newBadge('b', [])] })], 2.5, 1000, 1000)
    expect(calls).toContain(`fill ${DEFAULT_BADGE_STYLE.fill} 0.500`)
    expect(calls).toContain('fillText 1')
    const { context: start, calls: nothing } = recorder()
    drawShapeGroups(start, [drawing({ shapes: [arrow(), ellipse(), newBadge('b', [])] })], 2, 1000, 1000)
    expect(nothing.filter((call) => call.startsWith('fill') || call.startsWith('stroke'))).toEqual([])
  })

  it('Duplicate copies the entrance with the rest of the group', () => {
    const state: TimelineState = { entries: [], shapeGroups: [drawing({ id: 'g1', drawOn: 1.5 })] }
    const next = timelineReducer(state, { type: 'element-duplicated', kind: 'shape-group', id: 'g1', newId: 'g1b' })
    expect(shapeGroupsOf(next)[1]).toMatchObject({ id: 'g1b', drawOn: 1.5 })
  })

  it('travels with Copy settings and Paste settings as part of the timing', () => {
    const state: TimelineState = {
      entries: [],
      shapeGroups: [drawing({ id: 'g1', drawOn: 1.5, fadeOut: 0.5 }), group({ id: 'g2', offset: 9, fadeIn: 1 })],
    }
    const copied = copyElementSettings('shape-group', shapeGroupsOf(state)[0])!
    const pasted = timelineReducer(state, { type: 'settings-pasted', kind: 'shape-group', id: 'g2', settings: copied })
    const target = shapeGroupsOf(pasted)[1]
    expect(target).toMatchObject({ offset: 2, duration: 4, drawOn: 1.5, fadeOut: 0.5 })
    expect(target).not.toHaveProperty('fadeIn')
    // And back: a fading group's timing makes a drawing group fade.
    const back = copyElementSettings('shape-group', shapeGroupsOf(state)[1])!
    const undone = timelineReducer(state, { type: 'settings-pasted', kind: 'shape-group', id: 'g1', settings: back })
    expect(shapeGroupsOf(undone)[0]).toMatchObject({ fadeIn: 1 })
    expect(shapeGroupsOf(undone)[0]).not.toHaveProperty('drawOn')
  })
})

describe('shape groups in the timeline reducer (#683)', () => {
  const empty: TimelineState = { entries: [] }

  it('adds, updates and removes a group, each one edit', () => {
    const added = timelineReducer(empty, { type: 'shape-group-added', group: group() })
    expect(shapeGroupsOf(added)).toHaveLength(1)
    const { id: _id, ...spec } = group()
    const moved = timelineReducer(added, {
      type: 'shape-group-updated',
      id: 'g1',
      group: { ...spec, offset: 5 },
    })
    expect(shapeGroupsOf(moved)[0].offset).toBe(5)
    const removed = timelineReducer(moved, { type: 'shape-group-removed', id: 'g1' })
    expect(removed).not.toHaveProperty('shapeGroups')
  })

  it('refuses a malformed or duplicate group, and is same-reference for a no-op', () => {
    const added = timelineReducer(empty, { type: 'shape-group-added', group: group() })
    expect(timelineReducer(added, { type: 'shape-group-added', group: group() })).toBe(added)
    expect(timelineReducer(empty, { type: 'shape-group-added', group: group({ shapes: [] }) })).toBe(empty)
    const { id: _id, ...spec } = group()
    expect(timelineReducer(added, { type: 'shape-group-updated', id: 'g1', group: spec })).toBe(added)
    expect(
      timelineReducer(added, { type: 'shape-group-updated', id: 'g1', group: { ...spec, duration: -1 } }),
    ).toBe(added)
    expect(timelineReducer(added, { type: 'shape-group-removed', id: 'nope' })).toBe(added)
  })

  it('carries shape groups through other edits, untouched by video edits', () => {
    const withGroup = timelineReducer(empty, { type: 'shape-group-added', group: group() })
    const withText = timelineReducer(withGroup, {
      type: 'text-added',
      text: {
        id: 't',
        content: 'Hi',
        offset: 0,
        duration: 1,
        x: 0.5,
        y: 0.5,
        font: 'sans',
        size: 0.1,
        color: '#ffffff',
        bold: false,
        italic: false,
      },
    })
    expect(shapeGroupsOf(withText)).toEqual(shapeGroupsOf(withGroup))
    const restyled = timelineReducer(withText, {
      type: 'subtitle-style-set',
      style: { ...DEFAULT_SUBTITLE_STYLE, color: '#ff0000' },
    })
    expect(shapeGroupsOf(restyled)).toEqual(shapeGroupsOf(withGroup))
  })

  it('a Subtitle style change keeps chapter markers (#694)', () => {
    const markers = [{ id: 'm', time: 1, name: 'Intro' }]
    const next = timelineReducer(
      { entries: [], markers },
      { type: 'subtitle-style-set', style: { ...DEFAULT_SUBTITLE_STYLE, color: '#ff0000' } },
    )
    expect(next.markers).toEqual(markers)
    expect(next.subtitleStyle?.color).toBe('#ff0000')
  })
})
