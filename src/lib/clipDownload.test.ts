import { afterEach, describe, expect, it, vi } from 'vitest'
import { clipDownloadName, downloadClip, encodeWav } from './clipDownload'
import type { PcmSource } from './clipDownload'

const pcm = (channels: number[][], sampleRate = 8000): PcmSource => ({
  numberOfChannels: channels.length,
  sampleRate,
  length: channels[0].length,
  getChannelData: (channel) => Float32Array.from(channels[channel]),
})

describe('clipDownloadName (#803)', () => {
  it('is the display name when it already carries the file’s extension', () => {
    expect(clipDownloadName({ name: 'holiday.mp4' })).toBe('holiday.mp4')
    expect(clipDownloadName({ name: 'Voice-over 1.webm' })).toBe('Voice-over 1.webm')
    expect(clipDownloadName({ name: 'Freeze 0:12.png' })).toBe('Freeze 0:12.png')
  })

  it('appends the original extension to a renamed clip whose name lost it', () => {
    expect(clipDownloadName({ name: 'Beach day', fileName: 'holiday.mp4' })).toBe('Beach day.mp4')
  })

  it('leaves a renamed clip alone when its name ends in the extension, in any case', () => {
    expect(clipDownloadName({ name: 'Beach.MP4', fileName: 'holiday.mp4' })).toBe('Beach.MP4')
  })

  it('appends the real extension after a different one, so the file opens as what it is', () => {
    expect(clipDownloadName({ name: 'Beach.mov', fileName: 'holiday.mp4' })).toBe('Beach.mov.mp4')
  })

  it('adds nothing when the original file had no extension', () => {
    expect(clipDownloadName({ name: 'Beach', fileName: 'holiday' })).toBe('Beach')
    expect(clipDownloadName({ name: 'Beach', fileName: '.hidden' })).toBe('Beach')
  })

  it('names an extracted audio clip as a WAV', () => {
    expect(clipDownloadName({ name: 'holiday.mp4 (audio)', extractedFrom: 'holiday.mp4' })).toBe(
      'holiday.mp4 (audio).wav',
    )
    expect(clipDownloadName({ name: 'Narration.wav', extractedFrom: 'holiday.mp4' })).toBe('Narration.wav')
  })
})

describe('encodeWav (#803)', () => {
  it('writes a 16-bit PCM header for the source’s channels and rate', async () => {
    const view = new DataView(await encodeWav(pcm([[0, 0, 0], [0, 0, 0]], 44100)).arrayBuffer())
    const text = (offset: number) =>
      String.fromCharCode(...Array.from({ length: 4 }, (_, index) => view.getUint8(offset + index)))
    expect(text(0)).toBe('RIFF')
    expect(text(8)).toBe('WAVE')
    expect(text(36)).toBe('data')
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(2) // channels
    expect(view.getUint32(24, true)).toBe(44100)
    expect(view.getUint32(28, true)).toBe(44100 * 4)
    expect(view.getUint16(32, true)).toBe(4)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(3 * 4)
    expect(view.byteLength).toBe(44 + 3 * 4)
    expect(view.getUint32(4, true)).toBe(36 + 3 * 4)
  })

  it('interleaves the channels and scales each sample, clipping overshoot', async () => {
    const blob = encodeWav(pcm([[1, -1, 2], [0.5, 0, -3]]))
    expect(blob.type).toBe('audio/wav')
    const view = new DataView(await blob.arrayBuffer())
    const samples = Array.from({ length: 6 }, (_, index) => view.getInt16(44 + index * 2, true))
    expect(samples).toEqual([0x7fff, Math.round(0.5 * 0x7fff), -0x8000, 0, 0x7fff, -0x8000])
  })
})

describe('downloadClip (#803)', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('saves an ordinary clip straight from its own URL, decoding nothing', async () => {
    const save = vi.fn()
    const decode = vi.fn()
    await downloadClip({ name: 'Beach', fileName: 'holiday.mp4', url: 'blob:clip' }, { save, decode })
    expect(save).toHaveBeenCalledWith('blob:clip', 'Beach.mp4')
    expect(decode).not.toHaveBeenCalled()
  })

  it('saves an extracted audio clip as a WAV of its decoded sound, from a URL released later', async () => {
    vi.useFakeTimers()
    const created: Blob[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      created.push(blob as Blob)
      return 'blob:wav'
    })
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const save = vi.fn()
    const decode = vi.fn(async () => pcm([[0, 0.5]]))
    await downloadClip(
      { name: 'holiday.mp4 (audio)', extractedFrom: 'holiday.mp4', url: 'blob:video' },
      { save, decode },
    )
    expect(decode).toHaveBeenCalledWith('blob:video')
    expect(save).toHaveBeenCalledWith('blob:wav', 'holiday.mp4 (audio).wav')
    expect(created).toHaveLength(1)
    expect(created[0].type).toBe('audio/wav')
    expect(created[0].size).toBe(44 + 2 * 2)
    expect(revoke).not.toHaveBeenCalled()
    vi.advanceTimersByTime(60_000)
    expect(revoke).toHaveBeenCalledWith('blob:wav')
  })

  it('rejects, saving nothing, when an extracted clip’s sound cannot be decoded', async () => {
    const save = vi.fn()
    const decode = vi.fn(async () => {
      throw new Error('no sound')
    })
    await expect(
      downloadClip({ name: 'a (audio)', extractedFrom: 'a.mp4', url: 'blob:video' }, { save, decode }),
    ).rejects.toThrow('no sound')
    expect(save).not.toHaveBeenCalled()
  })
})
