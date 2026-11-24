import { describe, expect, it, vi } from 'vitest'
import { LibraryHeaderRegistry } from './libraryHeader'
import type { LibraryHeaderContribution } from './libraryHeader'

const Dialog = () => null

const contribution = (id: string, label = id): LibraryHeaderContribution => ({ id, label, Dialog })

describe('Media Library header contributions (#861)', () => {
  it('registers in order, notifies, and refuses a duplicate id', () => {
    const registry = new LibraryHeaderRegistry()
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

  it('unregisters, an unknown id is a silent no-op, and an unsubscribed listener hears nothing', () => {
    const registry = new LibraryHeaderRegistry()
    registry.register(contribution('a'))
    registry.register(contribution('b'))
    const listener = vi.fn()
    const unsubscribe = registry.subscribe(listener)
    registry.unregister('missing')
    expect(listener).not.toHaveBeenCalled()
    registry.unregister('a')
    expect(registry.list().map((item) => item.id)).toEqual(['b'])
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    registry.unregister('b')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(registry.list()).toEqual([])
  })
})
