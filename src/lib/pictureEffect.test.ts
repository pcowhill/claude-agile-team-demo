import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PICTURE_EFFECT_SECONDS,
  NO_PICTURE_LOOK,
  PICTURE_TEXTURE_RATE,
  PictureEffectRegistry,
  clampPictureEffect,
  DUST_COLUMNS,
  DUST_LIGHT_SHARE,
  MAX_DUST,
  MAX_SCRATCHES,
  SCRATCH_CHANCE,
  SCRATCH_COLUMNS,
  SCRATCH_ROWS,
  SCANLINE_ROWS,
  SCANLINE_WAVER,
  scanlinesTile,
  defaultPictureEffectWindow,
  dustTile,
  grainTile,
  scratchesTile,
  textureTile,
  textureTileKey,
  isValidPictureEffectSpec,
  pictureEffectNames,
  pictureEffectParamsFor,
  pictureEffectSpecsEqual,
  pictureEffectsEqual,
  textureHash,
  textureStep,
  unregisteredPictureEffectTypes,
} from './pictureEffect'
import type { PictureEffect, PictureEffectDefinition } from './pictureEffect'

const vignette: PictureEffectDefinition = {
  id: 'vignette',
  name: 'Vignette',
  params: [{ key: 'strength', label: 'Strength', min: 0, max: 1, default: 0.5 }],
  look: () => NO_PICTURE_LOOK,
}

const blur: PictureEffectDefinition = {
  id: 'blur',
  name: 'Blur',
  params: [{ key: 'amount', label: 'Amount', min: 0, max: 20, default: 6, unit: 'px' }],
  look: () => NO_PICTURE_LOOK,
}

const effect = (overrides: Partial<PictureEffect> = {}): PictureEffect => ({
  id: 'p1',
  entryId: 'e1',
  type: 'vignette',
  start: 1,
  end: 3,
  params: { strength: 0.6 },
  ...overrides,
})

describe('isValidPictureEffectSpec', () => {
  it('accepts a finite, non-empty window with finite parameter values', () => {
    expect(isValidPictureEffectSpec(effect())).toBe(true)
    expect(isValidPictureEffectSpec(effect({ params: {} }))).toBe(true)
  })

  it('refuses an empty or reversed window, a non-finite bound, and a non-finite or unnamed parameter', () => {
    expect(isValidPictureEffectSpec(effect({ start: 2, end: 2 }))).toBe(false)
    expect(isValidPictureEffectSpec(effect({ start: 3, end: 2 }))).toBe(false)
    expect(isValidPictureEffectSpec(effect({ start: Number.NaN }))).toBe(false)
    expect(isValidPictureEffectSpec(effect({ end: Number.POSITIVE_INFINITY }))).toBe(false)
    expect(isValidPictureEffectSpec(effect({ params: { strength: Number.NaN } }))).toBe(false)
    expect(isValidPictureEffectSpec(effect({ params: { '': 1 } }))).toBe(false)
  })
})

describe('clampPictureEffect', () => {
  it('returns the same object when the window already fits', () => {
    const fits = effect()
    expect(clampPictureEffect(fits, 4)).toBe(fits)
  })

  it('clamps the end into the length, and collapses a window that starts past it', () => {
    expect(clampPictureEffect(effect({ start: 1, end: 9 }), 4)).toMatchObject({ start: 1, end: 4 })
    expect(clampPictureEffect(effect({ start: 6, end: 9 }), 4)).toMatchObject({ start: 4, end: 4 })
  })

  it('clamps a negative start to 0 and treats a negative length as 0', () => {
    expect(clampPictureEffect(effect({ start: -1, end: 2 }), 4)).toMatchObject({ start: 0, end: 2 })
    expect(clampPictureEffect(effect(), -1)).toMatchObject({ start: 0, end: 0 })
  })
})

describe('picture effect equality', () => {
  it('compares parameters by key and value, not by reference or key order', () => {
    const a = effect({ params: { strength: 0.6, softness: 0.2 } })
    expect(pictureEffectsEqual(a, effect({ params: { softness: 0.2, strength: 0.6 } }))).toBe(true)
    expect(pictureEffectsEqual(a, effect({ params: { strength: 0.6 } }))).toBe(false)
    expect(pictureEffectsEqual(a, effect({ params: { strength: 0.6, other: 0.2 } }))).toBe(false)
    expect(pictureEffectSpecsEqual(a, { ...a, end: 4 })).toBe(false)
  })

  it('tells effects apart by id, entry and type, which a spec does not carry', () => {
    expect(pictureEffectsEqual(effect(), effect({ id: 'p2' }))).toBe(false)
    expect(pictureEffectsEqual(effect(), effect({ entryId: 'e2' }))).toBe(false)
    expect(pictureEffectsEqual(effect(), effect({ type: 'blur' }))).toBe(false)
    expect(pictureEffectSpecsEqual(effect(), effect({ type: 'blur' }))).toBe(true)
  })
})

describe('pictureEffectParamsFor', () => {
  it('gives a new effect every declared parameter at its default', () => {
    expect(pictureEffectParamsFor(blur)).toEqual({ amount: 6 })
  })

  it('clamps declared values into range, fills missing or non-finite ones, and drops undeclared keys', () => {
    expect(pictureEffectParamsFor(blur, { amount: 99, stray: 1 })).toEqual({ amount: 20 })
    expect(pictureEffectParamsFor(vignette, { strength: -1 })).toEqual({ strength: 0 })
    expect(pictureEffectParamsFor(vignette, { strength: Number.NaN })).toEqual({ strength: 0.5 })
  })
})

describe('PictureEffectRegistry', () => {
  it('holds definitions in registration order, and starts empty: every effect comes from a plugin', () => {
    const registry = new PictureEffectRegistry()
    expect(registry.list()).toEqual([])
    registry.register(vignette)
    registry.register(blur)
    expect(registry.list().map(({ id }) => id)).toEqual(['vignette', 'blur'])
    expect(registry.has('blur')).toBe(true)
    expect(registry.find('vignette')).toBe(vignette)
    expect(registry.find('swirl')).toBeUndefined()
  })

  it('throws on a duplicate id and on a parameter with no valid range or default', () => {
    const registry = new PictureEffectRegistry()
    registry.register(vignette)
    expect(() => registry.register(vignette)).toThrow("Picture effect 'vignette' is already registered.")
    const bad = (params: PictureEffectDefinition['params']) => () =>
      registry.register({ id: 'bad', name: 'Bad', params, look: () => NO_PICTURE_LOOK })
    const param = vignette.params[0]
    expect(bad([{ ...param, min: 2, max: 1 }])).toThrow('has no valid range')
    expect(bad([{ ...param, default: 3 }])).toThrow('has a default outside its range')
    expect(bad([param, param])).toThrow('declared twice')
    expect(() => registry.register({ ...vignette, id: '' })).toThrow('its id is empty')
    expect(registry.has('bad')).toBe(false)
  })

  it('notifies subscribers and bumps its version on each change, and unregistering an unknown id is a no-op', () => {
    const registry = new PictureEffectRegistry()
    const listener = vi.fn()
    const unsubscribe = registry.subscribe(listener)
    registry.register(vignette)
    registry.unregister('vignette')
    expect(listener).toHaveBeenCalledTimes(2)
    expect(registry.version).toBe(2)
    registry.unregister('vignette')
    expect(registry.version).toBe(2)
    unsubscribe()
    registry.register(blur)
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('defaultPictureEffectWindow (#862)', () => {
  it('starts a new effect at the first gap of its type that holds the default length', () => {
    expect(defaultPictureEffectWindow([], 10)).toEqual({ start: 0, end: DEFAULT_PICTURE_EFFECT_SECONDS })
    // Vignettes at 0-2 and 3-6: the 1 s gap is too short, so after the last one.
    expect(defaultPictureEffectWindow([{ start: 3, end: 6 }, { start: 0, end: 2 }], 10)).toEqual({ start: 6, end: 8 })
  })

  it('takes the widest gap, shortened, when none holds the default; none when the type covers the entry', () => {
    expect(defaultPictureEffectWindow([{ start: 0.5, end: 3 }], 3.5)).toEqual({ start: 0, end: 0.5 })
    expect(defaultPictureEffectWindow([], 1.2)).toEqual({ start: 0, end: 1.2 })
    expect(defaultPictureEffectWindow([{ start: 0, end: 4 }], 4)).toBeNull()
  })
})

describe('pictureEffectNames (#862)', () => {
  it('numbers each type separately in the order given, and marks an unregistered type', () => {
    const registry = new PictureEffectRegistry()
    registry.register(vignette)
    registry.register(blur)
    const names = pictureEffectNames(
      [
        { id: 'a', type: 'vignette' },
        { id: 'b', type: 'blur' },
        { id: 'c', type: 'vignette' },
        { id: 'd', type: 'glitch' },
      ],
      registry,
    )
    expect([...names]).toEqual([
      ['a', 'Vignette 1'],
      ['b', 'Blur 1'],
      ['c', 'Vignette 2'],
      ['d', 'glitch 1 (unavailable)'],
    ])
  })
})

describe('generated textures (#870)', () => {
  const grain = (seed: number, amount = 0.5, cell = 1 / 64) => ({ kind: 'grain' as const, amount, cell, seed })

  it('steps 24 times a second of the entry\'s clock, a boundary counting as the step it starts', () => {
    expect(PICTURE_TEXTURE_RATE).toBe(24)
    expect(textureStep(0)).toBe(0)
    expect(textureStep(1 / 48)).toBe(0)
    // 0.5 s is exactly step 12, whatever float error 0.5 × 24 carries.
    expect(textureStep(0.5)).toBe(12)
    expect(textureStep(0.5 - 1 / 48)).toBe(11)
    expect(textureStep(2.1)).toBe(50)
    expect(textureStep(-1)).toBe(0)
  })

  it('hashes to [0, 1), the same for the same input, and spread across the range', () => {
    const values: number[] = []
    for (let x = 0; x < 64; x++) {
      for (let y = 0; y < 64; y++) values.push(textureHash(7, x, y))
    }
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true)
    expect(textureHash(7, 3, 4)).toBe(textureHash(7, 3, 4))
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    expect(mean).toBeGreaterThan(0.47)
    expect(mean).toBeLessThan(0.53)
    // Every tenth of the range is used: no band of values is missing.
    const deciles = new Set(values.map((value) => Math.floor(value * 10)))
    expect(deciles.size).toBe(10)
  })

  it('a grain tile is one pixel per cell, as many rows as the aspect gives', () => {
    const tile = grainTile(grain(1, 0.5, 1 / 64), 16 / 9)
    expect([tile.width, tile.height]).toEqual([64, 36])
    expect(tile.data).toHaveLength(64 * 36 * 4)
    expect(grainTile(grain(1, 0.5, 1 / 10), 1).height).toBe(10)
  })

  it('the same seed draws the same pixels, and the next step a different pattern', () => {
    const first = grainTile(grain(50), 16 / 9)
    const again = grainTile(grain(50), 16 / 9)
    expect(again.data).toEqual(first.data)
    const next = grainTile(grain(51), 16 / 9)
    let differing = 0
    for (let index = 3; index < first.data.length; index += 4) {
      if (first.data[index] !== next.data[index] || first.data[index - 1] !== next.data[index - 1]) differing++
    }
    // Two independent patterns: nearly every cell differs.
    expect(differing / (first.data.length / 4)).toBeGreaterThan(0.9)
  })

  it('lightens and darkens about evenly, each cell at most Amount strong, and nothing at Amount 0', () => {
    const tile = grainTile(grain(3, 0.4), 16 / 9)
    let signed = 0
    let maxAlpha = 0
    let white = 0
    let black = 0
    for (let index = 0; index < tile.data.length; index += 4) {
      const [r, g, b, alpha] = tile.data.slice(index, index + 4)
      // Monochrome: every cell is pure white or pure black.
      expect(r === g && g === b && (r === 0 || r === 255)).toBe(true)
      maxAlpha = Math.max(maxAlpha, alpha)
      signed += r === 255 ? alpha : -alpha
      if (alpha > 0) {
        if (r === 255) white++
        else black++
      }
    }
    const cells = tile.data.length / 4
    expect(maxAlpha).toBeLessThanOrEqual(Math.round(0.4 * 255))
    expect(maxAlpha).toBeGreaterThan(0.3 * 255)
    // The mean signed alpha is a small fraction of the largest.
    expect(Math.abs(signed / cells)).toBeLessThan(0.05 * maxAlpha)
    expect(white / (white + black)).toBeGreaterThan(0.45)
    expect(white / (white + black)).toBeLessThan(0.55)
    const none = grainTile(grain(3, 0), 16 / 9)
    for (let index = 3; index < none.data.length; index += 4) expect(none.data[index]).toBe(0)
  })
})

describe('Old film\'s scratches and dust (#870, step 2a(ii))', () => {
  const scratches = (seed: number, amount = 0.5) => ({ kind: 'scratches' as const, amount, seed })
  const dust = (seed: number, amount = 0.7) => ({ kind: 'dust' as const, amount, seed })

  /** The columns holding a scratch, and their largest alpha. */
  const scratchColumns = (data: Uint8ClampedArray) => {
    const columns = new Map<number, number>()
    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3]
      if (alpha === 0) continue
      const column = (index / 4) % SCRATCH_COLUMNS
      columns.set(column, Math.max(columns.get(column) ?? 0, alpha))
    }
    return columns
  }
  /** The tile's visible pixels, as [index, shade, alpha]. */
  const specks = (data: Uint8ClampedArray) => {
    const found: [number, number, number][] = []
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] > 0) found.push([index / 4, data[index], data[index + 3]])
    }
    return found
  }

  it('a scratches tile is fixed in size, and the same seed draws the same pixels', () => {
    const tile = scratchesTile(scratches(50), 16 / 9)
    expect([tile.width, tile.height]).toEqual([SCRATCH_COLUMNS, SCRATCH_ROWS])
    expect(scratchesTile(scratches(50), 4 / 3).data).toEqual(tile.data)
    expect(scratchesTile(scratches(50), 16 / 9).data).toEqual(tile.data)
  })

  it('scratches are white full-height columns, at most three, often none, and move from step to step', () => {
    const counts: number[] = []
    const places: string[] = []
    let maxAlpha = 0
    for (let seed = 0; seed < 480; seed++) {
      const tile = scratchesTile(scratches(seed), 16 / 9)
      const columns = scratchColumns(tile.data)
      counts.push(columns.size)
      places.push([...columns.keys()].sort((a, b) => a - b).join(','))
      for (const [column, alpha] of columns) {
        maxAlpha = Math.max(maxAlpha, alpha)
        // White, and drawn on every row: a scratch runs the frame's height.
        for (let row = 0; row < SCRATCH_ROWS; row++) {
          const index = (row * SCRATCH_COLUMNS + column) * 4
          expect([tile.data[index], tile.data[index + 1], tile.data[index + 2]]).toEqual([255, 255, 255])
          expect(tile.data[index + 3]).toBeGreaterThan(0)
        }
      }
    }
    expect(Math.max(...counts)).toBeLessThanOrEqual(MAX_SCRATCHES)
    // Each of three candidates shows 30 % of the time: none on about a
    // third of the steps (0.7³ = 0.343), and about 0.9 a step on average.
    const none = counts.filter((count) => count === 0).length / counts.length
    expect(none).toBeGreaterThan(0.25)
    expect(none).toBeLessThan(0.45)
    const mean = counts.reduce((sum, count) => sum + count, 0) / counts.length
    expect(mean).toBeGreaterThan(MAX_SCRATCHES * SCRATCH_CHANCE - 0.2)
    expect(mean).toBeLessThan(MAX_SCRATCHES * SCRATCH_CHANCE + 0.2)
    // At most the Amount, and the brightest near it.
    expect(maxAlpha).toBeLessThanOrEqual(Math.round(0.5 * 255))
    expect(maxAlpha).toBeGreaterThan(0.45 * 255)
    // Neighbouring steps with scratches put them in different places.
    let moved = 0
    let pairs = 0
    for (let seed = 1; seed < places.length; seed++) {
      if (places[seed] === '' || places[seed - 1] === '') continue
      pairs++
      if (places[seed] !== places[seed - 1]) moved++
    }
    expect(moved).toBe(pairs)
  })

  it('a dust tile is 480 cells across, as many down as the aspect gives, and the same seed draws the same pixels', () => {
    const tile = dustTile(dust(50), 16 / 9)
    expect([tile.width, tile.height]).toEqual([DUST_COLUMNS, 270])
    expect(dustTile(dust(50), 1).height).toBe(DUST_COLUMNS)
    expect(dustTile(dust(50), 16 / 9).data).toEqual(tile.data)
  })

  it('dust is a few specks, none to six, mostly dark, each at most Amount strong, in new places each step', () => {
    const counts: number[] = []
    let light = 0
    let total = 0
    let maxAlpha = 0
    let previous = ''
    let repeats = 0
    for (let seed = 0; seed < 480; seed++) {
      const found = specks(dustTile(dust(seed), 16 / 9).data)
      counts.push(found.length)
      for (const [, shade, alpha] of found) {
        expect(shade === 0 || shade === 255).toBe(true)
        if (shade === 255) light++
        total++
        maxAlpha = Math.max(maxAlpha, alpha)
      }
      const places = found.map(([index]) => index).join(',')
      if (places !== '' && places === previous) repeats++
      previous = places
    }
    // Two specks of one step can land on one cell, so a count can fall short.
    expect(Math.max(...counts)).toBeLessThanOrEqual(MAX_DUST)
    expect(counts.filter((count) => count === 0).length).toBeGreaterThan(0)
    expect(counts.filter((count) => count >= MAX_DUST - 1).length).toBeGreaterThan(0)
    expect(light / total).toBeGreaterThan(DUST_LIGHT_SHARE - 0.08)
    expect(light / total).toBeLessThan(DUST_LIGHT_SHARE + 0.08)
    expect(maxAlpha).toBeLessThanOrEqual(Math.round(0.7 * 255))
    expect(maxAlpha).toBeGreaterThan(0.65 * 255)
    expect(repeats).toBe(0)
  })

  it('Amount 0 draws nothing in either', () => {
    for (let seed = 0; seed < 48; seed++) {
      expect(specks(scratchesTile(scratches(seed, 0), 16 / 9).data)).toEqual([])
      expect(specks(dustTile(dust(seed, 0), 16 / 9).data)).toEqual([])
    }
  })

  it('textureTile draws each kind with its own tile, and textureTileKey changes exactly when the tile does', () => {
    const grain = { kind: 'grain' as const, amount: 0.3, cell: 1 / 64, seed: 9 }
    expect(textureTile(grain, 16 / 9).data).toEqual(grainTile(grain, 16 / 9).data)
    expect(textureTile(scratches(9), 16 / 9).data).toEqual(scratchesTile(scratches(9), 16 / 9).data)
    expect(textureTile(dust(9), 16 / 9).data).toEqual(dustTile(dust(9), 16 / 9).data)
    const key = textureTileKey(dust(9), 16 / 9)
    expect(textureTileKey(dust(9), 16 / 9)).toBe(key)
    expect(textureTileKey(dust(10), 16 / 9)).not.toBe(key)
    expect(textureTileKey(dust(9, 0.5), 16 / 9)).not.toBe(key)
    expect(textureTileKey(dust(9), 4 / 3)).not.toBe(key)
    // Two kinds at the same seed and amount are different tiles.
    expect(textureTileKey(scratches(9, 0.7), 16 / 9)).not.toBe(key)
    expect(textureTileKey({ ...grain, cell: 1 / 32 }, 16 / 9)).not.toBe(textureTileKey(grain, 16 / 9))
  })
})

describe("VHS's scanlines (#870, step 2b(i))", () => {
  const scanlines = (seed: number, amount = 0.4) => ({ kind: 'scanlines' as const, amount, seed })
  /** Each row's alpha, and whether every pixel is black. */
  const rows = (data: Uint8ClampedArray) => {
    const alphas: number[] = []
    for (let index = 0; index < data.length; index += 4) {
      expect([data[index], data[index + 1], data[index + 2]]).toEqual([0, 0, 0])
      alphas.push(data[index + 3])
    }
    return alphas
  }

  it('a scanlines tile is one column of 540 rows whatever the aspect, and the same seed draws the same pixels', () => {
    const tile = scanlinesTile(scanlines(50), 16 / 9)
    expect([tile.width, tile.height]).toEqual([1, SCANLINE_ROWS])
    expect(scanlinesTile(scanlines(50), 4 / 3).data).toEqual(tile.data)
    expect(scanlinesTile(scanlines(50), 16 / 9).data).toEqual(tile.data)
  })

  it('every other row is a black line, between 75 % and 100 % of Amount, and the gaps are clear', () => {
    const top = Math.round(0.4 * 255)
    const bottom = Math.round(0.4 * (1 - SCANLINE_WAVER) * 255)
    let sum = 0
    let lines = 0
    for (let seed = 0; seed < 48; seed++) {
      const alphas = rows(scanlinesTile(scanlines(seed), 16 / 9).data)
      alphas.forEach((alpha, row) => {
        if (row % 2 === 0) {
          expect(alpha).toBe(0)
          return
        }
        expect(alpha).toBeGreaterThanOrEqual(bottom)
        expect(alpha).toBeLessThanOrEqual(top)
        sum += alpha
        lines++
      })
    }
    // 270 lines a tile, and the waver spread across its range: the mean
    // line sits near the middle of it, 87.5 % of Amount.
    expect(lines).toBe(48 * SCANLINE_ROWS / 2)
    expect(sum / lines / 255).toBeGreaterThan(0.4 * 0.85)
    expect(sum / lines / 255).toBeLessThan(0.4 * 0.9)
  })

  it('the lines shimmer: the next step wavers differently, row by row, and Amount 0 draws nothing', () => {
    for (let seed = 0; seed < 48; seed++) {
      const here = rows(scanlinesTile(scanlines(seed), 16 / 9).data)
      const next = rows(scanlinesTile(scanlines(seed + 1), 16 / 9).data)
      const changed = here.filter((alpha, row) => alpha !== next[row]).length
      // Nearly every line changes: two of 270 may land on one level by chance.
      expect(changed).toBeGreaterThan(SCANLINE_ROWS / 2 - 20)
      expect(rows(scanlinesTile(scanlines(seed, 0), 16 / 9).data).every((alpha) => alpha === 0)).toBe(true)
    }
  })

  it('textureTile draws scanlines with their own tile, and textureTileKey tells them from dust at the same seed', () => {
    expect(textureTile(scanlines(9), 16 / 9).data).toEqual(scanlinesTile(scanlines(9), 16 / 9).data)
    const key = textureTileKey(scanlines(9), 16 / 9)
    expect(textureTileKey(scanlines(10), 16 / 9)).not.toBe(key)
    expect(textureTileKey(scanlines(9, 0.3), 16 / 9)).not.toBe(key)
    expect(textureTileKey({ kind: 'dust', amount: 0.4, seed: 9 }, 16 / 9)).not.toBe(key)
  })
})

describe('unregisteredPictureEffectTypes', () => {
  it('names each type no definition covers, once', () => {
    const registry = new PictureEffectRegistry()
    registry.register(vignette)
    expect(unregisteredPictureEffectTypes(['vignette', 'swirl', 'swirl', 'blur'], registry)).toEqual([
      'swirl',
      'blur',
    ])
    expect(unregisteredPictureEffectTypes([], registry)).toEqual([])
  })
})
