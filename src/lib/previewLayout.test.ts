import { describe, expect, it } from 'vitest'
import {
  loadPreviewLayout,
  PREVIEW_EXPANDED_KEY,
  PREVIEW_LAYOUT_KEY,
  savePreviewLayout,
} from './previewLayout'
import type { PreviewLayout, PreviewLayoutStorage } from './previewLayout'

function fakeStorage(initial: Record<string, string> = {}): PreviewLayoutStorage & {
  values: Map<string, string>
} {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
  }
}

describe('preview layout persistence (#128, #667)', () => {
  it('defaults to the normal layout with nothing stored', () => {
    expect(loadPreviewLayout(fakeStorage())).toBe('default')
    expect(loadPreviewLayout(null)).toBe('default')
  })

  it('round-trips all three choices', () => {
    const storage = fakeStorage()
    for (const layout of ['expanded', 'fit-width', 'default'] satisfies PreviewLayout[]) {
      savePreviewLayout(layout, storage)
      expect(loadPreviewLayout(storage)).toBe(layout)
    }
  })

  it("loads #128's stored true as Expanded and false as Default, so an upgrade changes nobody's layout", () => {
    expect(loadPreviewLayout(fakeStorage({ [PREVIEW_EXPANDED_KEY]: '1' }))).toBe('expanded')
    expect(loadPreviewLayout(fakeStorage({ [PREVIEW_EXPANDED_KEY]: '0' }))).toBe('default')
  })

  it('a choice made since outranks the legacy key', () => {
    const storage = fakeStorage({ [PREVIEW_EXPANDED_KEY]: '1' })
    savePreviewLayout('fit-width', storage)
    expect(loadPreviewLayout(storage)).toBe('fit-width')
    savePreviewLayout('default', storage)
    expect(loadPreviewLayout(storage)).toBe('default')
    // The legacy key is read, never written.
    expect(storage.values.get(PREVIEW_EXPANDED_KEY)).toBe('1')
  })

  it('ignores unrecognized stored values', () => {
    expect(loadPreviewLayout(fakeStorage({ [PREVIEW_LAYOUT_KEY]: 'huge' }))).toBe('default')
    expect(loadPreviewLayout(fakeStorage({ [PREVIEW_EXPANDED_KEY]: 'yes' }))).toBe('default')
    expect(
      loadPreviewLayout(fakeStorage({ [PREVIEW_LAYOUT_KEY]: 'huge', [PREVIEW_EXPANDED_KEY]: '1' })),
    ).toBe('expanded')
  })

  it('tolerates a throwing store on both paths', () => {
    const throwing: PreviewLayoutStorage = {
      getItem: () => {
        throw new Error('storage disabled')
      },
      setItem: () => {
        throw new Error('storage full')
      },
    }
    expect(loadPreviewLayout(throwing)).toBe('default')
    expect(() => savePreviewLayout('expanded', throwing)).not.toThrow()
  })
})
