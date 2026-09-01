import { describe, expect, it, vi } from 'vitest'
import { THUMBNAIL_HEIGHT, THUMBNAIL_WIDTH, coverCrop, thumbnailForTrim } from './thumbnails'

describe('coverCrop (#193)', () => {
  it('crops the sides of a wider-than-target source, centered', () => {
    // 1920×1080 into 64×36 is the same 16:9 shape: no crop at all.
    expect(coverCrop(1920, 1080, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT)).toEqual({
      sx: 0,
      sy: 0,
      sw: 1920,
      sh: 1080,
    })
    // A 4:3 source into 16:9 crops top and bottom, centered.
    const tall = coverCrop(640, 480, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT)
    expect(tall.sw).toBe(640)
    expect(tall.sh).toBe(360)
    expect(tall.sx).toBe(0)
    expect(tall.sy).toBe(60)
    // An ultra-wide source into 16:9 crops left and right, centered.
    const wide = coverCrop(1000, 250, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT)
    expect(wide.sh).toBeCloseTo(250)
    expect(wide.sw).toBeCloseTo((250 * 16) / 9)
    expect(wide.sy).toBeCloseTo(0)
    expect(wide.sx).toBeCloseTo((1000 - (250 * 16) / 9) / 2)
  })
})

describe('thumbnailForTrim cache (#193)', () => {
  it('captures a trim once and shares the result across rows', async () => {
    const capture = vi.fn(() => Promise.resolve<string | null>('data:image/jpeg;base64,x'))
    const first = await thumbnailForTrim('blob:cache-hit', 1.5, capture)
    const second = await thumbnailForTrim('blob:cache-hit', 1.5, capture)
    expect(first).toBe('data:image/jpeg;base64,x')
    expect(second).toBe(first)
    expect(capture).toHaveBeenCalledExactlyOnceWith('blob:cache-hit', 1.5)
  })

  it('re-captures when the in-point changes — a new key, per the issue', async () => {
    const capture = vi.fn((url: string, atTime: number) =>
      Promise.resolve<string | null>(`data:${url}@${atTime}`),
    )
    expect(await thumbnailForTrim('blob:retrim', 0, capture)).toBe('data:blob:retrim@0')
    expect(await thumbnailForTrim('blob:retrim', 2, capture)).toBe('data:blob:retrim@2')
    expect(capture).toHaveBeenCalledTimes(2)
  })

  it('caches a failed capture as null instead of retrying every render', async () => {
    const capture = vi.fn(() => Promise.resolve<string | null>(null))
    expect(await thumbnailForTrim('blob:uncapturable', 0, capture)).toBeNull()
    expect(await thumbnailForTrim('blob:uncapturable', 0, capture)).toBeNull()
    expect(capture).toHaveBeenCalledTimes(1)
  })

  it('keys strictly by url — different clips never share a thumbnail', async () => {
    const capture = vi.fn((url: string) => Promise.resolve<string | null>(`data:${url}`))
    const a = await thumbnailForTrim('blob:clip-a', 0, capture)
    const b = await thumbnailForTrim('blob:clip-b', 0, capture)
    expect(a).not.toBe(b)
    expect(capture).toHaveBeenCalledTimes(2)
  })
})
