import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { probeVideoFile } from './probeVideo'

// jsdom implements neither media loading nor object URLs, so the probe is
// exercised with an injected fake element and stubbed URL statics.
class FakeVideo {
  onloadedmetadata: (() => void) | null = null
  ondurationchange: (() => void) | null = null
  onerror: (() => void) | null = null
  duration = Number.NaN
  currentTime = 0
  preload = ''
  muted = false
  src = ''
  removeAttribute() {}
  load() {}
}

const asVideo = (fake: FakeVideo) => fake as unknown as HTMLVideoElement

const createObjectURL = vi.fn(() => 'blob:probe-test')
const revokeObjectURL = vi.fn()

beforeEach(() => {
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
  vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const file = new File(['x'], 'clip.webm', { type: 'video/webm' })

describe('probeVideoFile', () => {
  it('resolves with the duration once metadata loads', async () => {
    const fake = new FakeVideo()
    const promise = probeVideoFile(file, () => asVideo(fake))
    fake.duration = 12.5
    fake.onloadedmetadata?.()
    await expect(promise).resolves.toEqual({ duration: 12.5, url: 'blob:probe-test' })
    expect(revokeObjectURL).not.toHaveBeenCalled()
  })

  it('recovers the real duration when metadata reports Infinity', async () => {
    const fake = new FakeVideo()
    const promise = probeVideoFile(file, () => asVideo(fake))
    fake.duration = Number.POSITIVE_INFINITY
    fake.onloadedmetadata?.()
    // The probe must force a far seek to make the browser scan the file.
    expect(fake.currentTime).toBeGreaterThan(1e6)
    fake.duration = 2.75
    fake.ondurationchange?.()
    await expect(promise).resolves.toEqual({ duration: 2.75, url: 'blob:probe-test' })
  })

  it('rejects and revokes the object URL when the file cannot be decoded', async () => {
    const fake = new FakeVideo()
    const promise = probeVideoFile(file, () => asVideo(fake))
    fake.onerror?.()
    await expect(promise).rejects.toThrow('clip.webm')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:probe-test')
  })

  it('rejects and revokes the object URL when metadata never arrives', async () => {
    vi.useFakeTimers()
    const fake = new FakeVideo()
    const promise = probeVideoFile(file, () => asVideo(fake))
    const assertion = expect(promise).rejects.toThrow('Timed out')
    vi.advanceTimersByTime(15_000)
    await assertion
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:probe-test')
  })
})
