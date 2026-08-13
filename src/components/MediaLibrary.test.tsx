import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { probeVideoFile } from '../lib/probeVideo'

vi.mock('../lib/probeVideo', () => ({
  probeVideoFile: vi.fn(),
}))

const probeMock = vi.mocked(probeVideoFile)

const videoFile = (name: string) => new File(['content'], name, { type: 'video/mp4' })

describe('media library import', () => {
  it('adds picked files to the library with filename and duration', async () => {
    probeMock.mockResolvedValueOnce({ duration: 65, url: 'blob:a' })
    render(<App />)

    await userEvent.upload(screen.getByTestId('clip-file-input'), videoFile('holiday.mp4'))

    const list = await screen.findByRole('list', { name: 'Imported clips' })
    expect(list).toHaveTextContent('holiday.mp4')
    expect(list).toHaveTextContent('1:05')
  })

  it('imports the same file twice as two library entries', async () => {
    probeMock.mockResolvedValue({ duration: 5, url: 'blob:a' })
    render(<App />)

    const input = screen.getByTestId('clip-file-input')
    await userEvent.upload(input, videoFile('same.mp4'))
    await userEvent.upload(input, videoFile('same.mp4'))

    expect(await screen.findAllByText('same.mp4')).toHaveLength(2)
  })

  it('adds files dropped onto the app', async () => {
    probeMock.mockResolvedValueOnce({ duration: 9, url: 'blob:d' })
    const { container } = render(<App />)

    fireEvent.drop(container.firstElementChild!, {
      dataTransfer: { files: [videoFile('dropped.mp4')], types: ['Files'] },
    })

    const list = await screen.findByRole('list', { name: 'Imported clips' })
    expect(list).toHaveTextContent('dropped.mp4')
    expect(list).toHaveTextContent('0:09')
  })

  it('shows a dismissible error for undecodable files and keeps working', async () => {
    probeMock
      .mockRejectedValueOnce(new Error('"notes.txt" is not a video this browser can decode.'))
      .mockResolvedValueOnce({ duration: 3, url: 'blob:ok' })
    render(<App />)

    const input = screen.getByTestId('clip-file-input')
    // applyAccept off: the browser's picker filter can be bypassed (e.g. "All
    // files"), so the app must handle non-video files anyway.
    await userEvent.upload(input, new File(['x'], 'notes.txt', { type: 'text/plain' }), {
      applyAccept: false,
    })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('notes.txt')

    // The failure must not break subsequent imports.
    await userEvent.upload(input, videoFile('after.mp4'))
    expect(await screen.findByText('after.mp4')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('media library clip removal', () => {
  // jsdom does not implement object URLs — provide a spyable stand-in.
  const revokeSpy = vi.fn()
  beforeEach(() => {
    revokeSpy.mockClear()
    URL.revokeObjectURL = revokeSpy
  })

  const importClip = async (name: string, url = `blob:${name}`) => {
    probeMock.mockResolvedValueOnce({ duration: 10, url })
    await userEvent.upload(screen.getByTestId('clip-file-input'), videoFile(name))
    await screen.findByText(name)
  }

  it('opens a confirmation dialog naming the clip and removes nothing until confirmed', async () => {
    render(<App />)
    await importClip('keepsake.mp4')

    await userEvent.click(screen.getByRole('button', { name: 'Remove keepsake.mp4 from library' }))

    const dialog = screen.getByRole('dialog', { name: 'Remove keepsake.mp4?' })
    // Focus moved into the dialog, onto the safe action.
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    // Nothing removed yet.
    expect(within(screen.getByRole('list', { name: 'Imported clips' })).getByText('keepsake.mp4'))
      .toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('keepsake.mp4')).not.toBeInTheDocument()
    expect(revokeSpy).toHaveBeenCalledWith('blob:keepsake.mp4')
  })

  it('cancel button and Escape both close the dialog without removing anything', async () => {
    render(<App />)
    await importClip('safe.mp4')
    const removeButton = screen.getByRole('button', { name: 'Remove safe.mp4 from library' })

    await userEvent.click(removeButton)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('safe.mp4')).toBeInTheDocument()

    await userEvent.click(removeButton)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('safe.mp4')).toBeInTheDocument()
    expect(revokeSpy).not.toHaveBeenCalled()
  })

  it('warns about timeline entries created from the clip and removes them on confirm', async () => {
    render(<App />)
    await importClip('used.mp4')
    await importClip('other.mp4')

    // used.mp4 twice, other.mp4 once.
    await userEvent.click(screen.getByRole('button', { name: 'Add used.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add used.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add other.mp4 to timeline' }))
    const sequence = screen.getByRole('list', { name: 'Sequence' })
    expect(within(sequence).getAllByRole('listitem')).toHaveLength(3)

    await userEvent.click(screen.getByRole('button', { name: 'Remove used.mp4 from library' }))
    const dialog = screen.getByRole('dialog', { name: 'Remove used.mp4?' })
    expect(dialog).toHaveTextContent('This also removes all 2 timeline entries')

    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    // The clip's entries are gone; the other clip's entry survives.
    expect(within(sequence).getAllByRole('listitem')).toHaveLength(1)
    expect(within(sequence).getByText('other.mp4')).toBeInTheDocument()
  })

  it('does not mention timeline entries when the clip is unused', async () => {
    render(<App />)
    await importClip('unused.mp4')

    await userEvent.click(screen.getByRole('button', { name: 'Remove unused.mp4 from library' }))
    const dialog = screen.getByRole('dialog', { name: 'Remove unused.mp4?' })
    expect(dialog).not.toHaveTextContent('timeline')
    expect(dialog).toHaveTextContent('The clip will be removed from the media library.')
  })
})
