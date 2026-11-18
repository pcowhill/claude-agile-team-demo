import { describe, expect, it } from 'vitest'
import type { Shape, ShapeContext, ShapeGroup } from './shapes'
import {
  activeShapeGroups,
  clampShapeGroup,
  defaultShape,
  defaultShapeGroup,
  DEFAULT_SHAPE_STYLE,
  drawShapeGroups,
  isInvisibleShape,
  isValidShapeGroupSpec,
  shapeGroupLabel,
  shapeGroupOpacityAt,
  shorterSideFraction,
  shorterSidePixels,
} from './shapes'
import { textOpacityAt } from './textOverlay'
import type { TextOverlay } from './textOverlay'
import { DEFAULT_SUBTITLE_STYLE } from './textOverlay'
import { canvasFrameSize } from './frameSize'
import { shapeGroupsOf, timelineReducer } from './timeline'
import type { TimelineState } from './timeline'

const ellipse = (id = 's1'): Shape => defaultShape(id, 'ellipse')
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
    const [shape] = added.shapes
    expect(shape.kind).toBe('ellipse')
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
