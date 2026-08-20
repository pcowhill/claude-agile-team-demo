import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryClip } from './mediaLibrary'
import {
  DEFAULT_PROJECT_FILE_NAME,
  collectClipMedia,
  createSavePort,
  fetchClipMedia,
} from './saveProject'

const bytes = new TextEncoder().encode('project bytes')

describe('createSavePort feature detection', () => {
  afterEach(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker
  })

  it('uses the File System Access port when showSaveFilePicker exists', () => {
    window.showSaveFilePicker = vi.fn()
    expect(createSavePort().kind).toBe('file-system-access')
  })

  it('falls back to the download port without it', () => {
    expect(window.showSaveFilePicker).toBeUndefined()
    expect(createSavePort().kind).toBe('download')
  })
})

describe('the File System Access port', () => {
  afterEach(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker
  })

  it('picks a handle and writes through it', async () => {
    const write = vi.fn()
    const close = vi.fn()
    const picker = vi.fn().mockResolvedValue({
      name: 'my-edit.bvep',
      createWritable: () => Promise.resolve({ write, close }),
    })
    window.showSaveFilePicker = picker

    const picked = await createSavePort().pickDestination('project.bvep')
    expect(picker).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: 'project.bvep' }),
    )
    expect(picked.kind).toBe('picked')
    if (picked.kind !== 'picked') return
    expect(picked.destination.name).toBe('my-edit.bvep')

    await picked.destination.write(bytes)
    expect(write).toHaveBeenCalledWith(bytes)
    expect(close).toHaveBeenCalledOnce()
  })

  it('reports a dismissed picker as canceled, not an error', async () => {
    window.showSaveFilePicker = vi
      .fn()
      .mockRejectedValue(new DOMException('The user aborted a request.', 'AbortError'))
    await expect(createSavePort().pickDestination('project.bvep')).resolves.toEqual({
      kind: 'canceled',
    })
  })

  it('propagates real picker failures', async () => {
    window.showSaveFilePicker = vi
      .fn()
      .mockRejectedValue(new DOMException('blocked', 'SecurityError'))
    await expect(createSavePort().pickDestination('project.bvep')).rejects.toThrow('blocked')
  })
})

describe('the download port', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:project-save'),
      revokeObjectURL: vi.fn(),
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.runAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('"picks" the suggested name without asking and downloads on write', async () => {
    const clicked: { download: string; href: string }[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ download: this.download, href: this.href })
    })

    const picked = await createSavePort().pickDestination(DEFAULT_PROJECT_FILE_NAME)
    expect(picked.kind).toBe('picked')
    if (picked.kind !== 'picked') return
    expect(picked.destination.name).toBe(DEFAULT_PROJECT_FILE_NAME)

    await picked.destination.write(bytes)
    expect(clicked).toEqual([{ download: DEFAULT_PROJECT_FILE_NAME, href: 'blob:project-save' }])
    // The object URL is released only after the download had time to start.
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:project-save')
  })
})

describe('collecting clip media for an embedded save (#98)', () => {
  const clips: LibraryClip[] = [
    { id: 'c1', name: 'holiday.mp4', duration: 10, url: 'blob:c1' },
    { id: 'c2', name: 'city.webm', duration: 5, url: 'blob:c2' },
  ]

  it('collects every clip keyed by id, preserving each blob type', async () => {
    const fetchMedia = vi.fn((clip: LibraryClip) =>
      Promise.resolve({
        bytes: new TextEncoder().encode(clip.id) as Uint8Array<ArrayBuffer>,
        mimeType: 'video/mp4',
      }),
    )
    const media = await collectClipMedia(clips, fetchMedia)
    expect([...media.keys()]).toEqual(['c1', 'c2'])
    expect(media.get('c1')).toEqual({
      bytes: new TextEncoder().encode('c1'),
      mimeType: 'video/mp4',
    })
    expect(fetchMedia).toHaveBeenCalledTimes(2)
  })

  it('fails the whole collection by clip name when one clip cannot be read', async () => {
    const fetchMedia = (clip: LibraryClip) =>
      clip.id === 'c2'
        ? Promise.reject(new Error('gone'))
        : Promise.resolve({ bytes: new Uint8Array([1]) as Uint8Array<ArrayBuffer> })
    await expect(collectClipMedia(clips, fetchMedia)).rejects.toThrow(
      'could not read the media for clip "city.webm" (gone)',
    )
  })

  describe('the default fetcher', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('reads bytes and type back through the object URL', async () => {
      const payload = new Uint8Array([9, 8, 7])
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            blob: () =>
              Promise.resolve(new Blob([payload as unknown as BlobPart], { type: 'video/webm' })),
          }),
        ),
      )
      const media = await fetchClipMedia(clips[0])
      expect(fetch).toHaveBeenCalledWith('blob:c1')
      expect(media.bytes).toEqual(payload)
      expect(media.mimeType).toBe('video/webm')
    })

    it('omits mimeType for an untyped blob', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob([new Uint8Array([1]) as unknown as BlobPart])) }),
        ),
      )
      expect((await fetchClipMedia(clips[0])).mimeType).toBeUndefined()
    })

    it('reports a failed read as an error, not silent absence', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 404 })))
      await expect(fetchClipMedia(clips[0])).rejects.toThrow(
        'the media could not be read back (HTTP 404)',
      )
    })
  })
})
