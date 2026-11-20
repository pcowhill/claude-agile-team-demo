import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClipPropertiesDialog } from './ClipPropertiesDialog'
import type { ClipPropertyReaders } from './ClipPropertiesDialog'
import type { LibraryClip } from '../lib/mediaLibrary'

const video: LibraryClip = { id: 'v', name: 'a.webm', duration: 6.008, url: 'blob:v', kind: 'video' }

/** The value beside `label` in the dialog's list. */
const valueOf = (label: string) => {
  const term = within(screen.getByRole('dialog')).getByText(label, { selector: 'dt' })
  return term.nextElementSibling?.textContent
}

const resolvedReaders = (): ClipPropertyReaders => ({
  file: vi.fn(async () => ({ type: 'video/webm', size: 2048 })),
  dimensions: vi.fn(async () => ({ width: 320, height: 180 })),
  channels: vi.fn(async () => 1),
})

describe('ClipPropertiesDialog (#804)', () => {
  it('is named for the clip, focuses Close, and fills in its reads', async () => {
    const readers = resolvedReaders()
    render(<ClipPropertiesDialog clip={video} placements={1} onClose={() => {}} readers={readers} />)
    expect(screen.getByRole('dialog', { name: 'Properties of a.webm' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
    await waitFor(() => expect(valueOf('Dimensions')).toBe('320 × 180 px'))
    expect(valueOf('File size')).toBe('2.0 kB (2,048 bytes)')
    expect(valueOf('Has sound')).toBe('Yes')
    expect(valueOf('Audio channels')).toBe('Mono')
    expect(valueOf('Length')).toBe('0:06 (6.01 s)')
    expect(valueOf('On the timeline')).toBe('1 placement')
    expect(readers.file).toHaveBeenCalledWith('blob:v')
  })

  it('shows Reading… while a read runs and Unknown when it fails', async () => {
    let finish: (value: { type: string; size: number }) => void = () => {}
    const readers: ClipPropertyReaders = {
      file: () => new Promise((resolve) => (finish = resolve)),
      dimensions: async () => {
        throw new Error('no metadata')
      },
      channels: async () => null,
    }
    render(<ClipPropertiesDialog clip={video} placements={0} onClose={() => {}} readers={readers} />)
    expect(valueOf('File size')).toBe('Reading…')
    await waitFor(() => expect(valueOf('Dimensions')).toBe('Unknown'))
    expect(valueOf('Has sound')).toBe('No (none this browser can decode)')
    finish({ type: 'video/webm', size: 10 })
    await waitFor(() => expect(valueOf('File size')).toBe('10 bytes'))
  })

  it('reads neither metadata nor sound for an image', async () => {
    const readers = resolvedReaders()
    render(
      <ClipPropertiesDialog
        clip={{ id: 'i', name: 'still.png', duration: 0, url: 'blob:i', kind: 'image', width: 64, height: 64 }}
        placements={0}
        onClose={() => {}}
        readers={readers}
      />,
    )
    await waitFor(() => expect(readers.file).toHaveBeenCalled())
    expect(readers.dimensions).not.toHaveBeenCalled()
    expect(readers.channels).not.toHaveBeenCalled()
    expect(valueOf('Dimensions')).toBe('64 × 64 px')
  })

  it('closes on Escape, on Close and on a click outside, and gives focus back', async () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const onClose = vi.fn()
    const { unmount } = render(
      <ClipPropertiesDialog clip={video} placements={0} onClose={onClose} readers={resolvedReaders()} />,
    )
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    await userEvent.click(document.querySelector('.dialog-overlay')!)
    expect(onClose).toHaveBeenCalledTimes(3)
    unmount()
    expect(opener).toHaveFocus()
    opener.remove()
  })
})
