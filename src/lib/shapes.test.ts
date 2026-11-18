import { describe, expect, it } from 'vitest'
import type { ArrowShape, BoxShape, Shape, ShapeContext, ShapeGroup } from './shapes'
import {
  activeShapeGroups,
  arrowHeadLength,
  arrowOutline,
  ARROW_HEAD_SIZE_FACTORS,
  MIN_ARROW_HEAD,
  clampShapeGroup,
  defaultShape,
  defaultShapeGroup,
  DEFAULT_SHAPE_STYLE,
  drawShapeGroups,
  isInvisibleShape,
  isValidShapeGroupSpec,
  shapeGroupLabel,
  shapeGroupName,
  shapeGroupOpacityAt,
  shorterSideFraction,
  shorterSidePixels,
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
