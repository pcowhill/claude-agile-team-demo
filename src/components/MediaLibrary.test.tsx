import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
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
