import { describe, expect, it } from 'vitest'
import {
  loadPreviewExpanded,
  PREVIEW_EXPANDED_KEY,
  savePreviewExpanded,
} from './previewLayout'
import type { PreviewLayoutStorage } from './previewLayout'

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

describe('preview layout persistence (#128)', () => {
  it('defaults to the normal layout with nothing stored', () => {
    expect(loadPreviewExpanded(fakeStorage())).toBe(false)
    expect(loadPreviewExpanded(null)).toBe(false)
  })

  it('round-trips both choices', () => {
    const storage = fakeStorage()
    savePreviewExpanded(true, storage)
    expect(loadPreviewExpanded(storage)).toBe(true)
    savePreviewExpanded(false, storage)
    expect(loadPreviewExpanded(storage)).toBe(false)
  })

  it('ignores unrecognized stored values', () => {
    expect(loadPreviewExpanded(fakeStorage({ [PREVIEW_EXPANDED_KEY]: 'yes' }))).toBe(false)
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
    expect(loadPreviewExpanded(throwing)).toBe(false)
    expect(() => savePreviewExpanded(true, throwing)).not.toThrow()
  })
})
