import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { extractAudioClip, extractedAudioName } from './extractAudio'
import type { LibraryClip } from './mediaLibrary'

const source: LibraryClip = {
  id: 'v1',
  name: 'holiday.mp4',
  duration: 42.5,
  url: 'blob:source',
  kind: 'video',
}

// jsdom implements neither createObjectURL nor blob-URL fetches; the fetch
// is injected and the URL minting stubbed, exactly as probeMedia.test does.
const createObjectURL = vi.fn(() => 'blob:extracted')
const originalURL = URL

beforeEach(() => {
  createObjectURL.mockClear()
  vi.stubGlobal('URL', { ...originalURL, createObjectURL })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('extractedAudioName (#154)', () => {
  it('derives the display name from the source filename', () => {
    expect(extractedAudioName('holiday.mp4')).toBe('holiday.mp4 (audio)')
  })
})

describe('extractAudioClip (#154)', () => {
  it('builds an audio clip over the same bytes with its own object URL', async () => {
    const blob = new Blob(['bytes'], { type: 'video/webm' })
    const fetchBlob = vi.fn().mockResolvedValue(blob)

    const clip = await extractAudioClip(source, 'a1', fetchBlob)

    // The bytes come from the source clip's URL…
    expect(fetchBlob).toHaveBeenCalledWith('blob:source')
    expect(createObjectURL).toHaveBeenCalledWith(blob)
    // …but the clip's lifetime is its own: a fresh URL, so revoking the
    // source's on removal (App.tsx) cannot break this clip.
    expect(clip).toEqual({
      id: 'a1',
      name: 'holiday.mp4 (audio)',
      duration: 42.5,
      url: 'blob:extracted',
      kind: 'audio',
      extractedFrom: 'holiday.mp4',
    })
    expect(clip.url).not.toBe(source.url)
  })

  it('propagates a failure to read the media', async () => {
    const fetchBlob = vi.fn().mockRejectedValue(new Error('gone'))
    await expect(extractAudioClip(source, 'a1', fetchBlob)).rejects.toThrow('gone')
    expect(createObjectURL).not.toHaveBeenCalled()
  })
})
