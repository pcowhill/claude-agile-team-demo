import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PICTURE_EFFECT_SECONDS,
  NO_PICTURE_LOOK,
  PictureEffectRegistry,
  clampPictureEffect,
  defaultPictureEffectWindow,
  isValidPictureEffectSpec,
  pictureEffectNames,
  pictureEffectParamsFor,
  pictureEffectSpecsEqual,
  pictureEffectsEqual,
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
