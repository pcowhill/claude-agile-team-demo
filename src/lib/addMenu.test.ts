import { describe, expect, it, vi } from 'vitest'
import { AddMenuRegistry, placeElementsAt } from './addMenu'
import type { AddMenuContribution, PlacedElements } from './addMenu'
import { emptyTimelineHistory, timelineHistoryReducer } from './history'
import type { BoxShape } from './shapes'
import { DEFAULT_TEXT } from './textOverlay'
import { emptyTimeline, shapeGroupsOf, textsOf, timelineReducer } from './timeline'

const Dialog = () => null

const contribution = (id: string, label = id): AddMenuContribution => ({ id, label, Dialog })

const bar: BoxShape = {
  id: 'bar',
  kind: 'rectangle',
  x: 0.05,
  y: 0.8,
  width: 0.4,
  height: 0.15,
  stroke: '#000000',
  strokeOpacity: 0,
  thickness: 0,
  fill: '#111827',
  fillOpacity: 0.85,
}

/** A lower third's shape: two texts and a one-shape group, timed from 0. */
const elements: PlacedElements = {
  texts: [
    { ...DEFAULT_TEXT, content: 'Alex Morgan', offset: 0, duration: 5 },
    { ...DEFAULT_TEXT, content: 'Product designer', offset: 0, duration: 5 },
  ],
  shapeGroups: [{ offset: 0, duration: 5, fadeIn: 0.5, fadeOut: 0.5, shapes: [bar] }],
}

const counter = () => {
  let next = 0
  return () => `id-${++next}`
}

describe('Add ▾ contributions (#860)', () => {
  it('registers in order, notifies, and refuses a duplicate id', () => {
    const registry = new AddMenuRegistry()
    const listener = vi.fn()
    registry.subscribe(listener)
    registry.register(contribution('b'))
    registry.register(contribution('a'))
    expect(registry.list().map((item) => item.id)).toEqual(['b', 'a'])
    expect(listener).toHaveBeenCalledTimes(2)
    expect(registry.version).toBe(2)
    expect(() => registry.register(contribution('a'))).toThrow(/already registered/)
    expect(registry.find('a')?.label).toBe('a')
  })

  it('unregisters, and unregistering an unknown id is a silent no-op', () => {
    const registry = new AddMenuRegistry()
    registry.register(contribution('a'))
    const listener = vi.fn()
    registry.subscribe(listener)
    registry.unregister('missing')
    expect(listener).not.toHaveBeenCalled()
    registry.unregister('a')
    expect(registry.list()).toEqual([])
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('places elements at the Preview time under fresh ids, shapes included', () => {
    const placed = placeElementsAt(
      { ...elements, texts: [{ ...elements.texts[0], offset: 0.25 }, elements.texts[1]] },
      7,
      counter(),
    )
    expect(placed.texts.map((text) => [text.id, text.offset])).toEqual([
      ['id-1', 7.25],
      ['id-2', 7],
    ])
    expect(placed.shapeGroups[0].id).toBe('id-3')
    expect(placed.shapeGroups[0].offset).toBe(7)
    expect(placed.shapeGroups[0].shapes.map((shape) => shape.id)).toEqual(['id-4'])
    // A negative Preview time cannot place anything before the start.
    expect(placeElementsAt(elements, -1, counter()).texts[0].offset).toBe(0)
  })

  it('elements-placed adds every text and group as one edit, so one undo removes them all', () => {
    let history = timelineHistoryReducer(emptyTimelineHistory, {
      type: 'text-added',
      text: { ...DEFAULT_TEXT, id: 'existing' },
    })
    history = timelineHistoryReducer(history, {
      type: 'elements-placed',
      ...placeElementsAt(elements, 2, counter()),
    })
    expect(textsOf(history.present).map((text) => text.content)).toEqual([
      'Title',
      'Alex Morgan',
      'Product designer',
    ])
    expect(shapeGroupsOf(history.present)).toHaveLength(1)
    expect(shapeGroupsOf(history.present)[0].offset).toBe(2)

    history = timelineHistoryReducer(history, { type: 'edit-undone' })
    expect(textsOf(history.present).map((text) => text.id)).toEqual(['existing'])
    expect(shapeGroupsOf(history.present)).toEqual([])
    history = timelineHistoryReducer(history, { type: 'edit-redone' })
    expect(textsOf(history.present)).toHaveLength(3)
    expect(shapeGroupsOf(history.present)).toHaveLength(1)
  })

  it('places groups alone, and texts alone', () => {
    const placed = placeElementsAt(elements, 0, counter())
    const groupsOnly = timelineReducer(emptyTimeline, {
      type: 'elements-placed',
      texts: [],
      shapeGroups: placed.shapeGroups,
    })
    expect(shapeGroupsOf(groupsOnly)).toHaveLength(1)
    expect(textsOf(groupsOnly)).toEqual([])
    const textsOnly = timelineReducer(emptyTimeline, {
      type: 'elements-placed',
      texts: placed.texts,
      shapeGroups: [],
    })
    expect(textsOf(textsOnly)).toHaveLength(2)
    expect(shapeGroupsOf(textsOnly)).toEqual([])
  })

  it('refuses the whole batch when any element is malformed, and an empty batch is no edit', () => {
    const placed = placeElementsAt(elements, 0, counter())
    const badGroup = { ...placed.shapeGroups[0], duration: 0 }
    expect(
      timelineReducer(emptyTimeline, { type: 'elements-placed', texts: placed.texts, shapeGroups: [badGroup] }),
    ).toBe(emptyTimeline)
    const badText = { ...placed.texts[1], content: '' }
    expect(
      timelineReducer(emptyTimeline, {
        type: 'elements-placed',
        texts: [placed.texts[0], badText],
        shapeGroups: placed.shapeGroups,
      }),
    ).toBe(emptyTimeline)
    expect(timelineReducer(emptyTimeline, { type: 'elements-placed', texts: [], shapeGroups: [] })).toBe(
      emptyTimeline,
    )
  })
})
