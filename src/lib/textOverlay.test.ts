import { describe, expect, it } from 'vitest'
import {
  applySubtitleStyle,
  changedStyleFields,
  clampSubtitleStyle,
  clampTextOverlay,
  DEFAULT_SUBTITLE_STYLE,
  DEFAULT_TEXT,
  isValidSubtitleStyle,
  normalizeStyleOverrides,
  normalizeSubtitleStyle,
  SUBTITLE_STYLE_FIELDS,
  isTextFontId,
  isValidTextOverlaySpec,
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
  TEXT_FONTS,
  textActiveAt,
  textFontStack,
  textOpacityAt,
  textOverlaysEqual,
} from './textOverlay'
import type { TextOverlay } from './textOverlay'

const text = (overrides: Partial<TextOverlay> = {}): TextOverlay => ({
  ...DEFAULT_TEXT,
  id: 't1',
  ...overrides,
})

describe('curated fonts (#139)', () => {
  it('resolves every listed id to its stack', () => {
    for (const font of TEXT_FONTS) {
      expect(isTextFontId(font.id)).toBe(true)
      expect(textFontStack(font.id)).toBe(font.stack)
    }
    expect(isTextFontId('comic-sans')).toBe(false)
  })

  it('every stack ends in a generic family, so text renders on any platform', () => {
    for (const font of TEXT_FONTS) {
      expect(font.stack).toMatch(/(sans-serif|serif|monospace)$/)
    }
  })
})

describe('isValidTextOverlaySpec (#139)', () => {
  it('accepts the default spec', () => {
    expect(isValidTextOverlaySpec(DEFAULT_TEXT)).toBe(true)
  })

  it('accepts multi-line content', () => {
    expect(isValidTextOverlaySpec({ ...DEFAULT_TEXT, content: 'two\nlines' })).toBe(true)
  })

  it('rejects empty content', () => {
    expect(isValidTextOverlaySpec({ ...DEFAULT_TEXT, content: '' })).toBe(false)
  })

  it('rejects a non-positive or non-finite duration', () => {
    expect(isValidTextOverlaySpec({ ...DEFAULT_TEXT, duration: 0 })).toBe(false)
    expect(isValidTextOverlaySpec({ ...DEFAULT_TEXT, duration: -1 })).toBe(false)
    expect(isValidTextOverlaySpec({ ...DEFAULT_TEXT, duration: Number.NaN })).toBe(false)
  })

  it('rejects non-finite numeric fields', () => {
    expect(isValidTextOverlaySpec({ ...DEFAULT_TEXT, offset: Number.POSITIVE_INFINITY })).toBe(false)
    expect(isValidTextOverlaySpec({ ...DEFAULT_TEXT, x: Number.NaN })).toBe(false)
    expect(isValidTextOverlaySpec({ ...DEFAULT_TEXT, y: Number.NaN })).toBe(false)
    expect(isValidTextOverlaySpec({ ...DEFAULT_TEXT, size: Number.NaN })).toBe(false)
  })

  it('rejects an unknown font and a malformed color', () => {
    expect(
      isValidTextOverlaySpec({ ...DEFAULT_TEXT, font: 'papyrus' as typeof DEFAULT_TEXT.font }),
    ).toBe(false)
    // Uppercase and shorthand are rejected, matching the slate rule (#143):
    // one spelling per color, everywhere.
    expect(isValidTextOverlaySpec({ ...DEFAULT_TEXT, color: '#FFFFFF' })).toBe(false)
    expect(isValidTextOverlaySpec({ ...DEFAULT_TEXT, color: '#fff' })).toBe(false)
    expect(isValidTextOverlaySpec({ ...DEFAULT_TEXT, color: 'white' })).toBe(false)
  })
})

describe('clampTextOverlay (#139)', () => {
  it('clamps offset at zero but leaves it unbounded above (allowed tail)', () => {
    expect(clampTextOverlay(text({ offset: -2 })).offset).toBe(0)
    // A window past the sequence end stays put — the #102 decision: video
    // edits (or the sequence being short) never destructively retime it.
    expect(clampTextOverlay(text({ offset: 9999 })).offset).toBe(9999)
  })

  it('clamps the centre into the frame and the size into its bounds', () => {
    const clamped = clampTextOverlay(text({ x: -0.5, y: 1.5, size: 3 }))
    expect(clamped.x).toBe(0)
    expect(clamped.y).toBe(1)
    expect(clamped.size).toBe(MAX_TEXT_SIZE)
    expect(clampTextOverlay(text({ size: 0.001 })).size).toBe(MIN_TEXT_SIZE)
  })

  it('returns the same object when nothing changes', () => {
    const unchanged = text()
    expect(clampTextOverlay(unchanged)).toBe(unchanged)
  })
})

describe('textOverlaysEqual', () => {
  it('compares every field', () => {
    const base = text()
    expect(textOverlaysEqual(base, text())).toBe(true)
    expect(textOverlaysEqual(base, text({ content: 'other' }))).toBe(false)
    expect(textOverlaysEqual(base, text({ offset: 1 }))).toBe(false)
    expect(textOverlaysEqual(base, text({ bold: true }))).toBe(false)
    expect(textOverlaysEqual(base, text({ italic: true }))).toBe(false)
    expect(textOverlaysEqual(base, text({ color: '#000000' }))).toBe(false)
    expect(textOverlaysEqual(base, text({ font: 'serif' }))).toBe(false)
  })

  it('treats an absent subtitle marker as false, and compares it (#249)', () => {
    expect(textOverlaysEqual(text(), text({ subtitle: false }))).toBe(true)
    expect(textOverlaysEqual(text(), text({ subtitle: true }))).toBe(false)
    expect(textOverlaysEqual(text({ subtitle: true }), text({ subtitle: true }))).toBe(true)
  })
})

describe('subtitle marker validation (#249)', () => {
  it('accepts absent and boolean subtitle markers, rejects other types', () => {
    expect(isValidTextOverlaySpec(text())).toBe(true)
    expect(isValidTextOverlaySpec(text({ subtitle: true }))).toBe(true)
    expect(isValidTextOverlaySpec(text({ subtitle: false }))).toBe(true)
    expect(
      isValidTextOverlaySpec(text({ subtitle: 'yes' as unknown as boolean })),
    ).toBe(false)
  })
})

describe('textActiveAt (#139)', () => {
  it('is visible from its offset and half-open at its end, like a track window', () => {
    const overlay = text({ offset: 2, duration: 3 })
    expect(textActiveAt(overlay, 1.99)).toBe(false)
    expect(textActiveAt(overlay, 2)).toBe(true)
    expect(textActiveAt(overlay, 4.99)).toBe(true)
    expect(textActiveAt(overlay, 5)).toBe(false)
  })
})

describe('fade clamping (#177)', () => {
  it('clamps negative fades to zero', () => {
    const clamped = clampTextOverlay(text({ fadeIn: -1, fadeOut: -2 }))
    expect(clamped.fadeIn).toBe(0)
    expect(clamped.fadeOut).toBe(0)
  })

  it('keeps fadeIn first and lets fadeOut absorb the shortfall, like audio fades', () => {
    // Duration 3: a 2s fade-in leaves only 1s for the fade-out.
    const clamped = clampTextOverlay(text({ duration: 3, fadeIn: 2, fadeOut: 2 }))
    expect(clamped.fadeIn).toBe(2)
    expect(clamped.fadeOut).toBe(1)
    // A fade-in longer than the whole window consumes it entirely.
    const consumed = clampTextOverlay(text({ duration: 3, fadeIn: 5, fadeOut: 1 }))
    expect(consumed.fadeIn).toBe(3)
    expect(consumed.fadeOut).toBe(0)
  })

  it('returns the same object when fades are absent or already in range', () => {
    const absent = text()
    expect(clampTextOverlay(absent)).toBe(absent)
    const inRange = text({ duration: 3, fadeIn: 1, fadeOut: 1 })
    expect(clampTextOverlay(inRange)).toBe(inRange)
  })

  it('treats absent and zero fades as equal, and differing fades as unequal', () => {
    expect(textOverlaysEqual(text(), text({ fadeIn: 0, fadeOut: 0 }))).toBe(true)
    expect(textOverlaysEqual(text(), text({ fadeIn: 1 }))).toBe(false)
    expect(textOverlaysEqual(text(), text({ fadeOut: 1 }))).toBe(false)
  })

  it('rejects non-finite fades but accepts absent ones', () => {
    expect(isValidTextOverlaySpec(text({ fadeIn: Number.NaN }))).toBe(false)
    expect(isValidTextOverlaySpec(text({ fadeOut: Infinity }))).toBe(false)
    expect(isValidTextOverlaySpec(text({ fadeIn: 1, fadeOut: 0.5 }))).toBe(true)
  })
})

describe('textOpacityAt (#177)', () => {
  it('is 0 outside the window and 1 inside it when no fades are set', () => {
    const overlay = text({ offset: 2, duration: 3 })
    expect(textOpacityAt(overlay, 1.99)).toBe(0)
    expect(textOpacityAt(overlay, 2)).toBe(1)
    expect(textOpacityAt(overlay, 4.99)).toBe(1)
    expect(textOpacityAt(overlay, 5)).toBe(0)
  })

  it('ramps linearly 0→1 over the fade-in window', () => {
    const overlay = text({ offset: 2, duration: 4, fadeIn: 2 })
    expect(textOpacityAt(overlay, 2)).toBe(0)
    expect(textOpacityAt(overlay, 3)).toBeCloseTo(0.5, 10)
    expect(textOpacityAt(overlay, 4)).toBe(1)
    expect(textOpacityAt(overlay, 5.99)).toBe(1)
  })

  it('ramps linearly 1→0 over the fade-out window, reaching 0 at the end', () => {
    const overlay = text({ offset: 2, duration: 4, fadeOut: 2 })
    expect(textOpacityAt(overlay, 2)).toBe(1)
    expect(textOpacityAt(overlay, 4)).toBe(1)
    expect(textOpacityAt(overlay, 5)).toBeCloseTo(0.5, 10)
    expect(textOpacityAt(overlay, 5.999)).toBeLessThan(0.001)
  })

  it('takes the minimum of the two ramps where they would overlap', () => {
    // Both fades span the whole 4s window; the envelope peaks at 0.5 in the
    // middle — the same graceful degradation audioTrackGainAt applies.
    const overlay = text({ offset: 0, duration: 4, fadeIn: 4, fadeOut: 4 })
    expect(textOpacityAt(overlay, 1)).toBeCloseTo(0.25, 10)
    expect(textOpacityAt(overlay, 2)).toBeCloseTo(0.5, 10)
    expect(textOpacityAt(overlay, 3)).toBeCloseTo(0.25, 10)
  })
})

// The default subtitle style (#250): the pure rules the reducer and the
// serializer consume — validation, clamping, absent-as-default
// normalization, override bookkeeping, and the mass-restyle application.

const subtitleOverlay = (overrides: Partial<TextOverlay> = {}): TextOverlay => ({
  id: 't1',
  content: 'Hello',
  offset: 0,
  duration: 2,
  x: 0.5,
  y: 0.9,
  font: 'sans',
  size: 0.05,
  color: '#ffffff',
  bold: false,
  italic: false,
  subtitle: true,
  ...overrides,
})

describe('DEFAULT_SUBTITLE_STYLE (#250)', () => {
  it('is the #249 import style: bottom-center, readable, white sans', () => {
    expect(DEFAULT_SUBTITLE_STYLE.x).toBe(0.5)
    expect(DEFAULT_SUBTITLE_STYLE.y).toBeGreaterThan(0.75)
    expect(DEFAULT_SUBTITLE_STYLE.y).toBeLessThanOrEqual(1)
    expect(DEFAULT_SUBTITLE_STYLE.font).toBe('sans')
    expect(DEFAULT_SUBTITLE_STYLE.color).toBe('#ffffff')
    expect(isValidSubtitleStyle(DEFAULT_SUBTITLE_STYLE)).toBe(true)
  })
})

describe('isValidSubtitleStyle / clampSubtitleStyle (#250)', () => {
  it('accepts the text-overlay style surface and refuses malformed fields', () => {
    expect(isValidSubtitleStyle({ ...DEFAULT_SUBTITLE_STYLE, color: '#123abc' })).toBe(true)
    expect(isValidSubtitleStyle({ ...DEFAULT_SUBTITLE_STYLE, x: Number.NaN })).toBe(false)
    expect(isValidSubtitleStyle({ ...DEFAULT_SUBTITLE_STYLE, font: 'papyrus' as never })).toBe(false)
    expect(isValidSubtitleStyle({ ...DEFAULT_SUBTITLE_STYLE, color: 'red' })).toBe(false)
    expect(isValidSubtitleStyle({ ...DEFAULT_SUBTITLE_STYLE, bold: 1 as never })).toBe(false)
  })

  it('clamps centre and size exactly as an overlay clamps, same-object when clean', () => {
    const clean = { ...DEFAULT_SUBTITLE_STYLE, y: 0.8 }
    expect(clampSubtitleStyle(clean)).toBe(clean)
    expect(clampSubtitleStyle({ ...DEFAULT_SUBTITLE_STYLE, x: -1, y: 2, size: 5 })).toEqual({
      ...DEFAULT_SUBTITLE_STYLE,
      x: 0,
      y: 1,
      size: MAX_TEXT_SIZE,
    })
  })
})

describe('normalizeSubtitleStyle (#250)', () => {
  it('normalizes the built-in default to undefined — the stored form is no key at all', () => {
    expect(normalizeSubtitleStyle({ ...DEFAULT_SUBTITLE_STYLE })).toBeUndefined()
  })

  it('keeps a customized style, clamped', () => {
    expect(normalizeSubtitleStyle({ ...DEFAULT_SUBTITLE_STYLE, color: '#ffff00', y: 2 })).toEqual({
      ...DEFAULT_SUBTITLE_STYLE,
      color: '#ffff00',
      y: 1,
    })
  })

  it('a style that clamps back to the default normalizes away too', () => {
    expect(normalizeSubtitleStyle({ ...DEFAULT_SUBTITLE_STYLE, x: -0.5, y: 0.9 })).toEqual({
      ...DEFAULT_SUBTITLE_STYLE,
      x: 0,
    })
    // x clamps to 0 (≠ default 0.5) so it survives; but a no-op clamp equal
    // to the default vanishes:
    expect(normalizeSubtitleStyle({ ...DEFAULT_SUBTITLE_STYLE, size: 0.05 })).toBeUndefined()
  })
})

describe('normalizeStyleOverrides (#250)', () => {
  it('orders fields canonically, deduplicates, and drops empty lists', () => {
    expect(normalizeStyleOverrides([])).toBeUndefined()
    expect(normalizeStyleOverrides(['italic', 'x', 'italic'])).toEqual(['x', 'italic'])
    expect(normalizeStyleOverrides([...SUBTITLE_STYLE_FIELDS].reverse())).toEqual([
      ...SUBTITLE_STYLE_FIELDS,
    ])
  })
})

describe('changedStyleFields (#250)', () => {
  it('names exactly the style fields that differ', () => {
    const before = subtitleOverlay()
    expect(changedStyleFields(before, before)).toEqual([])
    expect(changedStyleFields(before, { ...before, color: '#000000', y: 0.1 })).toEqual([
      'y',
      'color',
    ])
    // Non-style fields never register.
    expect(changedStyleFields(before, { ...before, content: 'Edited' } as never)).toEqual([])
  })
})

describe('applySubtitleStyle (#250)', () => {
  const newStyle = { ...DEFAULT_SUBTITLE_STYLE, font: 'serif' as const, color: '#ffff00', y: 0.8 }

  it('rewrites every non-overridden style field and nothing else', () => {
    const text = subtitleOverlay({ content: 'Keep me', offset: 3, fadeIn: 0.5 })
    expect(applySubtitleStyle(text, newStyle)).toEqual({
      ...text,
      font: 'serif',
      color: '#ffff00',
      y: 0.8,
    })
  })

  it('leaves individually overridden fields alone while the rest follow', () => {
    const text = subtitleOverlay({ color: '#ff0000', styleOverrides: ['color'] })
    expect(applySubtitleStyle(text, newStyle)).toEqual({
      ...text,
      font: 'serif',
      y: 0.8,
      // color stays the overlay's own #ff0000.
    })
  })

  it('returns the same object when nothing changes', () => {
    const styled = subtitleOverlay({ font: 'serif', color: '#ffff00', y: 0.8 })
    expect(applySubtitleStyle(styled, newStyle)).toBe(styled)
    const fullyOverridden = subtitleOverlay({ styleOverrides: [...SUBTITLE_STYLE_FIELDS] })
    expect(applySubtitleStyle(fullyOverridden, newStyle)).toBe(fullyOverridden)
  })
})

describe('styleOverrides validation and equality (#250)', () => {
  it('accepts overrides only on subtitle overlays, naming known fields once', () => {
    expect(isValidTextOverlaySpec(subtitleOverlay({ styleOverrides: ['color', 'y'] }))).toBe(true)
    expect(
      isValidTextOverlaySpec(subtitleOverlay({ subtitle: undefined, styleOverrides: ['color'] })),
    ).toBe(false)
    expect(isValidTextOverlaySpec(subtitleOverlay({ styleOverrides: ['shadow'] as never }))).toBe(
      false,
    )
    expect(
      isValidTextOverlaySpec(subtitleOverlay({ styleOverrides: ['color', 'color'] })),
    ).toBe(false)
  })

  it('textOverlaysEqual distinguishes override records', () => {
    const a = subtitleOverlay({ styleOverrides: ['color'] })
    expect(textOverlaysEqual(a, subtitleOverlay({ styleOverrides: ['color'] }))).toBe(true)
    expect(textOverlaysEqual(a, subtitleOverlay())).toBe(false)
    expect(textOverlaysEqual(a, subtitleOverlay({ styleOverrides: ['y'] }))).toBe(false)
  })
})
