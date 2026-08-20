import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { probeMediaFile } from '../lib/probeMedia'

vi.mock('../lib/probeMedia', () => ({
  probeMediaFile: vi.fn(),
}))

const probeMock = vi.mocked(probeMediaFile)

const videoFile = (name: string) => new File(['content'], name, { type: 'video/mp4' })

describe('media library import', () => {
  it('adds picked files to the library with filename and duration', async () => {
    probeMock.mockResolvedValueOnce({ duration: 65, url: 'blob:a', kind: 'video' })
    render(<App />)

    await userEvent.upload(screen.getByTestId('clip-file-input'), videoFile('holiday.mp4'))

    const list = await screen.findByRole('list', { name: 'Imported clips' })
    expect(list).toHaveTextContent('holiday.mp4')
    expect(list).toHaveTextContent('1:05')
  })

  it('imports the same file twice as two library entries', async () => {
    probeMock.mockResolvedValue({ duration: 5, url: 'blob:a', kind: 'video' })
    render(<App />)

    const input = screen.getByTestId('clip-file-input')
    await userEvent.upload(input, videoFile('same.mp4'))
    await userEvent.upload(input, videoFile('same.mp4'))

    expect(await screen.findAllByText('same.mp4')).toHaveLength(2)
  })

  it('adds files dropped onto the app', async () => {
    probeMock.mockResolvedValueOnce({ duration: 9, url: 'blob:d', kind: 'video' })
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
      .mockResolvedValueOnce({ duration: 3, url: 'blob:ok', kind: 'video' })
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

describe('audio import (#101)', () => {
  const audioFile = (name: string, type: string) => new File(['content'], name, { type })

  it('adds an mp3 and a wav to the library with duration, marked as audio', async () => {
    probeMock
      .mockResolvedValueOnce({ duration: 185, url: 'blob:song', kind: 'audio' })
      .mockResolvedValueOnce({ duration: 4, url: 'blob:take', kind: 'audio' })
    render(<App />)

    const input = screen.getByTestId('clip-file-input')
    await userEvent.upload(input, audioFile('song.mp3', 'audio/mpeg'))
    await userEvent.upload(input, audioFile('take.wav', 'audio/wav'))

    const list = await screen.findByRole('list', { name: 'Imported clips' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('song.mp3')
    expect(items[0]).toHaveTextContent('3:05')
    expect(items[0]).toHaveTextContent('Audio')
    expect(items[1]).toHaveTextContent('take.wav')
    expect(items[1]).toHaveTextContent('0:04')
    expect(items[1]).toHaveTextContent('Audio')
  })

  it('offers no Add-to-timeline for audio clips while video clips keep theirs', async () => {
    probeMock
      .mockResolvedValueOnce({ duration: 5, url: 'blob:v', kind: 'video' })
      .mockResolvedValueOnce({ duration: 6, url: 'blob:a', kind: 'audio' })
    render(<App />)

    const input = screen.getByTestId('clip-file-input')
    await userEvent.upload(input, videoFile('clip.mp4'))
    await userEvent.upload(input, audioFile('music.mp3', 'audio/mpeg'))
    await screen.findByText('music.mp3')

    expect(screen.getByRole('button', { name: 'Add clip.mp4 to timeline' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Add music.mp3 to timeline' }),
    ).not.toBeInTheDocument()
    // Video clips carry no badge — the badge is what marks audio.
    const list = screen.getByRole('list', { name: 'Imported clips' })
    const [videoItem] = within(list).getAllByRole('listitem')
    expect(videoItem).toHaveTextContent('clip.mp4')
    expect(videoItem).not.toHaveTextContent('Audio')
  })

  it('an audio clip can still be removed from the library', async () => {
    URL.revokeObjectURL = vi.fn()
    probeMock.mockResolvedValueOnce({ duration: 6, url: 'blob:gone', kind: 'audio' })
    render(<App />)
    await userEvent.upload(
      screen.getByTestId('clip-file-input'),
      audioFile('voiceover.wav', 'audio/wav'),
    )
    await screen.findByText('voiceover.wav')

    await userEvent.click(
      screen.getByRole('button', { name: 'Remove voiceover.wav from library' }),
    )
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }),
    )
    expect(screen.queryByText('voiceover.wav')).not.toBeInTheDocument()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:gone')
  })

  it('surfaces a corrupt audio file as an import failure, not a crash', async () => {
    probeMock.mockRejectedValueOnce(
      new Error('"broken.mp3" is not an audio file this browser can decode.'),
    )
    render(<App />)
    await userEvent.upload(
      screen.getByTestId('clip-file-input'),
      audioFile('broken.mp3', 'audio/mpeg'),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '"broken.mp3" is not an audio file this browser can decode.',
    )
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
    probeMock.mockResolvedValueOnce({ duration: 10, url, kind: 'video' })
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
