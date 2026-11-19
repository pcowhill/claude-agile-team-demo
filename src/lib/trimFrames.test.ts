import { describe, expect, it, vi } from 'vitest'
import { TRIM_FRAME_COUNT, trimFrameTimes, trimFramesFor } from './trimFrames'

describe('trimFrameTimes (#708)', () => {
  it('takes about twenty frames, each at the centre of its slice of the whole clip', () => {
    const times = trimFrameTimes(6)
    expect(TRIM_FRAME_COUNT).toBe(20)
    expect(times).toHaveLength(20)
    expect(times[0]).toBeCloseTo(0.15)
    expect(times[19]).toBeCloseTo(5.85)
    // Evenly spaced, so each frame stands over its own twentieth of the strip.
    for (let index = 1; index < times.length; index++) {
      expect(times[index] - times[index - 1]).toBeCloseTo(0.3)
    }
    // Never at either end: the last is inside the clip, where a seek lands.
    expect(Math.min(...times)).toBeGreaterThan(0)
    expect(Math.max(...times)).toBeLessThan(6)
  })

  it('takes none from a clip whose length is not known', () => {
    expect(trimFrameTimes(0)).toEqual([])
    expect(trimFrameTimes(Number.NaN)).toEqual([])
    expect(trimFrameTimes(5, 0)).toEqual([])
  })
})

describe('trimFramesFor (#708)', () => {
  it('captures a clip’s frames once, however often it is asked, and again only for another clip', async () => {
    const capture = vi.fn((_url: string, times: number[]) => Promise.resolve(times.map((time) => `frame@${time}`)))
    const first = await trimFramesFor('blob:cache-a', 4, capture)
    const again = await trimFramesFor('blob:cache-a', 4, capture)
    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture).toHaveBeenCalledWith('blob:cache-a', trimFrameTimes(4))
    expect(again).toBe(first)
    await trimFramesFor('blob:cache-b', 4, capture)
    expect(capture).toHaveBeenCalledTimes(2)
  })

  it('remembers a failed capture rather than retrying it on every opening', async () => {
    const capture = vi.fn((_url: string, times: number[]) => Promise.resolve(times.map(() => null)))
    expect(await trimFramesFor('blob:cache-broken', 3, capture)).toEqual(Array(20).fill(null))
    await trimFramesFor('blob:cache-broken', 3, capture)
    expect(capture).toHaveBeenCalledTimes(1)
  })
})
