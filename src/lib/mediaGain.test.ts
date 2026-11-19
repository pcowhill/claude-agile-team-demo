import { describe, expect, it } from 'vitest'
import { attachBoost, boostOf, intendedGain, setMediaGain } from './mediaGain'
import type { BoostNode } from './mediaGain'

const boost = (): BoostNode => ({ gain: { value: 1 } })

describe('setMediaGain (#692)', () => {
  it('puts a gain at or below 1 on the element alone, routing nothing', () => {
    const element = { volume: 1 }
    let routed = 0
    const route = () => {
      routed++
      return boost()
    }
    for (const gain of [0, 0.25, 1]) {
      setMediaGain(element, gain, route)
      expect(element.volume).toBe(gain)
    }
    expect(routed).toBe(0)
    expect(boostOf(element)).toBeUndefined()
  })

  it('routes an element once, the first time its gain passes 1, and splits the gain', () => {
    const element = { volume: 1 }
    const node = boost()
    let routed = 0
    const route = () => {
      routed++
      return node
    }
    setMediaGain(element, 2, route)
    expect(element.volume).toBe(1)
    expect(node.gain.value).toBe(2)
    // Back under 1: the element carries it and the boost returns to identity.
    setMediaGain(element, 0.5, route)
    expect(element.volume).toBe(0.5)
    expect(node.gain.value).toBe(1)
    setMediaGain(element, 3.5, route)
    expect(element.volume * node.gain.value).toBe(3.5)
    expect(routed).toBe(1)
  })

  it('plays a gain above 1 at 1 when no route is given or the route refuses', () => {
    const plain = { volume: 0.2 }
    setMediaGain(plain, 2)
    expect(plain.volume).toBe(1)
    const refused = { volume: 0.2 }
    setMediaGain(refused, 2, () => null)
    expect(refused.volume).toBe(1)
    expect(boostOf(refused)).toBeUndefined()
  })

  it('uses a boost attached ahead of time — the export’s, made with the graph', () => {
    const element = { volume: 1 }
    const node = boost()
    attachBoost(element, node)
    setMediaGain(element, 4)
    expect([element.volume, node.gain.value]).toEqual([1, 4])
  })

  it('never sets a negative or non-finite gain', () => {
    const element = { volume: 1 }
    setMediaGain(element, -1)
    expect(element.volume).toBe(0)
    setMediaGain(element, Number.NaN)
    expect(element.volume).toBe(0)
  })

  it('remembers the whole gain asked, so an audio twin can follow it past 1', () => {
    const replay = { volume: 1 }
    setMediaGain(replay, 2.5)
    expect(replay.volume).toBe(1)
    expect(intendedGain(replay)).toBe(2.5)
    // An element never given a gain here answers with its own volume.
    expect(intendedGain({ volume: 0.3 })).toBe(0.3)
  })
})
