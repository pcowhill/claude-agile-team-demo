import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PROJECT_FILE_NAME, createSavePort } from './saveProject'

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
