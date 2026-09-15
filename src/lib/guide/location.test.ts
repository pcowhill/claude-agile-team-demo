import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GUIDE_LOCATION,
  guideHash,
  isGuideHash,
  parseGuideHash,
  sameGuideLocation,
} from './location'

describe('guide hash (#478 §4)', () => {
  it('parses a section, a section with an anchor, and the bare prefix', () => {
    expect(parseGuideHash('#guide/concepts')).toEqual({ section: 'concepts', anchor: null })
    expect(parseGuideHash('#guide/undo-redo/what-is-an-edit')).toEqual({
      section: 'undo-redo',
      anchor: 'what-is-an-edit',
    })
    expect(parseGuideHash('#guide')).toEqual(DEFAULT_GUIDE_LOCATION)
    expect(parseGuideHash('#guide/')).toEqual(DEFAULT_GUIDE_LOCATION)
  })

  it('leaves every other hash alone', () => {
    expect(parseGuideHash('')).toBeNull()
    expect(parseGuideHash('#')).toBeNull()
    expect(parseGuideHash('#guidebook')).toBeNull()
    expect(parseGuideHash('#export')).toBeNull()
    expect(isGuideHash('#guide/x')).toBe(true)
    expect(isGuideHash('#guided')).toBe(false)
  })

  it('opens the default location on a malformed segment rather than nothing', () => {
    expect(parseGuideHash('#guide/Not%20A%20Section')).toEqual(DEFAULT_GUIDE_LOCATION)
    expect(parseGuideHash('#guide/concepts/Bad Anchor')).toEqual({ section: 'concepts', anchor: null })
  })

  it('formats what it parses', () => {
    for (const location of [
      { section: 'concepts', anchor: null },
      { section: 'undo-redo', anchor: 'history-limit' },
    ]) {
      expect(parseGuideHash(guideHash(location))).toEqual(location)
    }
    expect(guideHash({ section: 'concepts', anchor: null })).toBe('#guide/concepts')
  })

  it('compares locations, null included', () => {
    expect(sameGuideLocation(null, null)).toBe(true)
    expect(sameGuideLocation({ section: 'a', anchor: null }, null)).toBe(false)
    expect(sameGuideLocation({ section: 'a', anchor: 'b' }, { section: 'a', anchor: 'b' })).toBe(true)
    expect(sameGuideLocation({ section: 'a', anchor: 'b' }, { section: 'a', anchor: null })).toBe(false)
  })
})
