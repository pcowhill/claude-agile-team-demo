import { describe, expect, it } from 'vitest'
import { PluginRuntime } from '../lib/plugins'
import type { PluginStorage } from '../lib/plugins'
import { emptyLibrary } from '../lib/mediaLibrary'
import type { TimelineState } from '../lib/timeline'
import { builtInPlugins } from './catalog'
import { visualEffectDefinitions } from './visualEffects/index'

/**
 * What the Plugins dialog says Visual effects adds (#959): every effect
 * the plugin registers, by its menu name and in the menu's order, so an
 * effect added later cannot leave the description behind it again.
 */
describe('the Visual effects description (#959)', () => {
  it("names every effect the plugin registers, in the menu's order", () => {
    const description = builtInPlugins.find((spec) => spec.id === 'visual-effects')!.description
    const names = visualEffectDefinitions.map((definition) => definition.name)
    expect(names.length).toBeGreaterThan(0)
    const positions = names.map((name) => description.indexOf(name))
    expect(
      names.filter((_, index) => positions[index] < 0),
      'effects the description does not name',
    ).toEqual([])
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })
})

/**
 * The catalog's use counts are the one source for two answers (#953): the
 * dependencies a project file records (`projectPlugins`, which *Enable
 * plugins to open?* reads back) and the count the manager's confirmation
 * states before disabling a plugin in use. These tests pin that the two
 * cannot disagree on the real catalog.
 */

function memoryStorage(): PluginStorage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  }
}

const style = { x: 0.5, y: 0.9, size: 0.06, color: '#ffffff', bold: false, italic: false }
const text = (id: string, font: string) => ({ ...style, id, text: id, font, start: 0, end: 1 })

/** Timelines that use none, one or several of the catalog's plugins. */
const timelines: Record<string, TimelineState> = {
  empty: { entries: [] },
  'core features only': {
    entries: [
      { id: 'a', clipId: 'c1' },
      { id: 'b', clipId: 'c2' },
    ],
    transitions: [{ fromEntryId: 'a', toEntryId: 'b', type: 'crossfade', duration: 0.5 }],
    texts: [text('t1', 'sans')],
  } as unknown as TimelineState,
  'every dependency kind': {
    entries: [
      { id: 'a', clipId: 'c1' },
      { id: 'b', clipId: 'c2' },
      { id: 'c', clipId: 'c3' },
    ],
    transitions: [
      { fromEntryId: 'a', toEntryId: 'b', type: 'box-open', duration: 0.5 },
      { fromEntryId: 'b', toEntryId: 'c', type: 'spiral', duration: 0.5 },
    ],
    pictureEffects: [
      { id: 'p1', entryId: 'a', type: 'vignette', start: 0, end: 1, params: {} },
      { id: 'p2', entryId: 'b', type: 'old-film', start: 0, end: 1, params: {} },
    ],
    texts: [text('t1', 'pack-caveat'), text('t2', 'sans')],
    subtitleStyle: { ...style, font: 'pack-oswald' },
  } as unknown as TimelineState,
  'only the subtitle style': {
    entries: [],
    subtitleStyle: { ...style, font: 'pack-oswald' },
  } as unknown as TimelineState,
}

describe('plugin use counts (#953)', () => {
  for (const [name, timeline] of Object.entries(timelines)) {
    it(`a plugin is a recorded dependency exactly when its count is above zero: ${name}`, () => {
      const runtime = new PluginRuntime(builtInPlugins, memoryStorage())
      const counted = builtInPlugins
        .filter((spec) => runtime.projectUseCount(spec.id, emptyLibrary, timeline).count > 0)
        .map((spec) => spec.id)
      expect(runtime.projectPlugins(emptyLibrary, timeline)).toEqual(counted)
    })
  }

  it('counts each plugin on a project that uses several', () => {
    const runtime = new PluginRuntime(builtInPlugins, memoryStorage())
    const timeline = timelines['every dependency kind']
    const counts = Object.fromEntries(
      builtInPlugins.map((spec) => [spec.id, runtime.projectUseCount(spec.id, emptyLibrary, timeline).count]),
    )
    expect(counts).toEqual({
      'gif-export': 0,
      'shaped-wipes': 1,
      'pattern-transitions': 1,
      'visual-effects': 2,
      'more-export-formats': 0,
      'title-templates': 0,
      'sound-library': 0,
      'font-pack': 2,
    })
  })

  it('only the plugins whose features live in a project have a count', () => {
    expect(builtInPlugins.filter((spec) => spec.projectUses !== undefined).map((spec) => spec.id)).toEqual([
      'shaped-wipes',
      'pattern-transitions',
      'visual-effects',
      'font-pack',
    ])
  })
})
