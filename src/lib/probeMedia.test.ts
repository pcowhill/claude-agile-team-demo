import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { detectMediaKind, probeMediaFile } from './probeMedia'
import type { MediaKind } from './mediaLibrary'

// jsdom implements neither media loading nor object URLs, so the probe is
// exercised with an injected fake element and stubbed URL statics.
class FakeMedia {
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

const asMedia = (fake: FakeMedia) => () => fake as unknown as HTMLMediaElement

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

describe('detectMediaKind', () => {
  it.each([
    ['song.mp3', 'audio/mpeg', 'audio'],
    ['take.wav', 'audio/wav', 'audio'],
    ['clip.webm', 'video/webm', 'video'],
    ['movie.mp4', 'video/mp4', 'video'],
  ] as const)('classifies %s (%s) by MIME type as %s', (name, type, expected) => {
    expect(detectMediaKind(new File(['x'], name, { type }))).toBe(expected)
  })

  it.each([
    ['song.mp3', 'audio'],
    ['take.WAV', 'audio'],
    ['voice.m4a', 'audio'],
    ['fx.flac', 'audio'],
    ['note.opus', 'audio'],
    ['clip.webm', 'video'],
    ['unknown.bin', 'video'],
  ] as const)('falls back to the extension for un-typed %s → %s', (name, expected) => {
    expect(detectMediaKind(new File(['x'], name, { type: '' }))).toBe(expected)
  })

  it('trusts a MIME type over a contradicting extension', () => {
    expect(detectMediaKind(new File(['x'], 'weird.mp3', { type: 'video/mp4' }))).toBe('video')
  })
})

describe('probeMediaFile', () => {
  it('resolves with the duration and kind once metadata loads', async () => {
    const fake = new FakeMedia()
    const promise = probeMediaFile(file, asMedia(fake))
    fake.duration = 12.5
    fake.onloadedmetadata?.()
    await expect(promise).resolves.toEqual({
      duration: 12.5,
      url: 'blob:probe-test',
      kind: 'video',
    })
    expect(revokeObjectURL).not.toHaveBeenCalled()
  })

  it('probes an audio file through an audio element and reports kind audio', async () => {
    const fake = new FakeMedia()
    const createElement = vi.fn((_kind: MediaKind) => fake as unknown as HTMLMediaElement)
    const promise = probeMediaFile(new File(['x'], 'song.mp3', { type: 'audio/mpeg' }), createElement)
    fake.duration = 4.25
    fake.onloadedmetadata?.()
    await expect(promise).resolves.toEqual({
      duration: 4.25,
      url: 'blob:probe-test',
      kind: 'audio',
    })
    expect(createElement).toHaveBeenCalledExactlyOnceWith('audio')
  })

  it('recovers the real duration when metadata reports Infinity', async () => {
    const fake = new FakeMedia()
    const promise = probeMediaFile(file, asMedia(fake))
    fake.duration = Number.POSITIVE_INFINITY
    fake.onloadedmetadata?.()
    // The probe must force a far seek to make the browser scan the file.
    expect(fake.currentTime).toBeGreaterThan(1e6)
    fake.duration = 2.75
    fake.ondurationchange?.()
    await expect(promise).resolves.toEqual({
      duration: 2.75,
      url: 'blob:probe-test',
      kind: 'video',
    })
  })

  it('rejects and revokes the object URL when a video cannot be decoded', async () => {
    const fake = new FakeMedia()
    const promise = probeMediaFile(file, asMedia(fake))
    fake.onerror?.()
    await expect(promise).rejects.toThrow('"clip.webm" is not a video this browser can decode.')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:probe-test')
  })

  it('rejects with an audio-specific message when an audio file cannot be decoded', async () => {
    const fake = new FakeMedia()
    const promise = probeMediaFile(
      new File(['x'], 'broken.mp3', { type: 'audio/mpeg' }),
      asMedia(fake),
    )
    fake.onerror?.()
    await expect(promise).rejects.toThrow(
      '"broken.mp3" is not an audio file this browser can decode.',
    )
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:probe-test')
  })

  it('rejects and revokes the object URL when metadata never arrives', async () => {
    vi.useFakeTimers()
    const fake = new FakeMedia()
    const promise = probeMediaFile(file, asMedia(fake))
    const assertion = expect(promise).rejects.toThrow('Timed out')
    vi.advanceTimersByTime(15_000)
    await assertion
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:probe-test')
  })
})
