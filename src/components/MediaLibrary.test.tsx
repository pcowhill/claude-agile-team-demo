import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { probeMediaFile } from '../lib/probeMedia'
import { extractAudioClip } from '../lib/extractAudio'

vi.mock('../lib/probeMedia', () => ({
  probeMediaFile: vi.fn(),
}))

// The real implementation fetches blob: URLs, which jsdom cannot; the
// function itself is unit-tested in lib/extractAudio.test.ts.
vi.mock('../lib/extractAudio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/extractAudio')>()),
  extractAudioClip: vi.fn(),
}))

const probeMock = vi.mocked(probeMediaFile)
const extractMock = vi.mocked(extractAudioClip)

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

  it('Add places an audio clip on the audio lane, never in the video sequence (#102)', async () => {
    probeMock
      .mockResolvedValueOnce({ duration: 5, url: 'blob:v', kind: 'video' })
      .mockResolvedValueOnce({ duration: 6, url: 'blob:a', kind: 'audio' })
    render(<App />)

    const input = screen.getByTestId('clip-file-input')
    await userEvent.upload(input, videoFile('clip.mp4'))
    await userEvent.upload(input, audioFile('music.mp3', 'audio/mpeg'))
    await screen.findByText('music.mp3')

    // Every clip carries its kind badge (#120): Video here, Audio below.
    const list = screen.getByRole('list', { name: 'Imported clips' })
    const [videoItem, audioItem] = within(list).getAllByRole('listitem')
    expect(videoItem).toHaveTextContent('clip.mp4')
    expect(videoItem).toHaveTextContent('Video')
    expect(videoItem).not.toHaveTextContent('Audio')
    expect(audioItem).toHaveTextContent('Audio')
    expect(audioItem).not.toHaveTextContent('Video')
    // Distinct per-kind classes are what lets the CSS color them apart —
    // while the kind stays readable as text alone.
    expect(videoItem.querySelector('.clip-kind')).toHaveClass('clip-kind-video')
    expect(audioItem.querySelector('.clip-kind')).toHaveClass('clip-kind-audio')

    await userEvent.click(screen.getByRole('button', { name: 'Add music.mp3 to timeline' }))

    const lane = screen.getByRole('list', { name: 'Audio tracks' })
    expect(within(lane).getByRole('listitem')).toHaveTextContent('music.mp3')
    // The video sequence stays empty — audio never becomes a sequence entry.
    expect(screen.queryByRole('list', { name: 'Sequence' })).not.toBeInTheDocument()
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

describe('audio extraction (#154)', () => {
  it('offers Extract audio on video clips only', async () => {
    probeMock
      .mockResolvedValueOnce({ duration: 5, url: 'blob:v', kind: 'video' })
      .mockResolvedValueOnce({ duration: 6, url: 'blob:a', kind: 'audio' })
      .mockResolvedValueOnce({ duration: 0, url: 'blob:i', kind: 'image', width: 8, height: 8 })
    render(<App />)

    const input = screen.getByTestId('clip-file-input')
    await userEvent.upload(input, videoFile('clip.mp4'))
    await userEvent.upload(input, new File(['content'], 'music.mp3', { type: 'audio/mpeg' }))
    await userEvent.upload(input, new File(['content'], 'logo.png', { type: 'image/png' }))
    await screen.findByText('logo.png')

    expect(
      screen.getByRole('button', { name: 'Extract audio from clip.mp4' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Extract audio from music.mp3' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Extract audio from logo.png' }),
    ).not.toBeInTheDocument()
  })

  it('extracting adds an independent audio clip that survives removing the source', async () => {
    URL.revokeObjectURL = vi.fn()
    probeMock.mockResolvedValueOnce({ duration: 6, url: 'blob:v', kind: 'video' })
    extractMock.mockResolvedValueOnce({
      id: 'extracted-1',
      name: 'clip.mp4 (audio)',
      duration: 6,
      url: 'blob:extracted',
      kind: 'audio',
      extractedFrom: 'clip.mp4',
    })
    render(<App />)
    await userEvent.upload(screen.getByTestId('clip-file-input'), videoFile('clip.mp4'))
    await screen.findByText('clip.mp4')

    await userEvent.click(screen.getByRole('button', { name: 'Extract audio from clip.mp4' }))

    // The new clip lists as ordinary audio: badge, duration, source name.
    const list = screen.getByRole('list', { name: 'Imported clips' })
    const extracted = (await within(list).findAllByRole('listitem'))[1]
    expect(extracted).toHaveTextContent('clip.mp4 (audio)')
    expect(extracted).toHaveTextContent('0:06')
    expect(extracted.querySelector('.clip-kind')).toHaveClass('clip-kind-audio')
    // Being audio, it has no extract button of its own.
    expect(
      screen.queryByRole('button', { name: 'Extract audio from clip.mp4 (audio)' }),
    ).not.toBeInTheDocument()

    // Removing the source video leaves the extracted clip playable: it stays
    // listed and only the video's own URL is revoked.
    await userEvent.click(screen.getByRole('button', { name: 'Remove clip.mp4 from library' }))
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }),
    )
    expect(screen.queryByRole('button', { name: 'Add clip.mp4 to timeline' })).not.toBeInTheDocument()
    expect(screen.getByText('clip.mp4 (audio)')).toBeInTheDocument()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:v')
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:extracted')

    // And its Add button places it on the audio lane, like any audio clip.
    await userEvent.click(
      screen.getByRole('button', { name: 'Add clip.mp4 (audio) to timeline' }),
    )
    const lane = screen.getByRole('list', { name: 'Audio tracks' })
    expect(within(lane).getByRole('listitem')).toHaveTextContent('clip.mp4 (audio)')
  })

  it('surfaces a failed extraction in the dismissible failure list', async () => {
    probeMock.mockResolvedValueOnce({ duration: 6, url: 'blob:v', kind: 'video' })
    extractMock.mockRejectedValueOnce(new Error('unreadable'))
    render(<App />)
    await userEvent.upload(screen.getByTestId('clip-file-input'), videoFile('clip.mp4'))
    await screen.findByText('clip.mp4')

    await userEvent.click(screen.getByRole('button', { name: 'Extract audio from clip.mp4' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not extract the audio from "clip.mp4".',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('image import (#137)', () => {
  const imageFile = (name: string) => new File(['content'], name, { type: 'image/png' })

  it('adds an image with an Image badge and no duration, and the picker accepts images', async () => {
    probeMock.mockResolvedValueOnce({
      duration: 0,
      url: 'blob:logo',
      kind: 'image',
      width: 640,
      height: 480,
    })
    render(<App />)

    const input = screen.getByTestId('clip-file-input')
    expect(input).toHaveAttribute('accept', 'video/*,audio/*,image/*')
    await userEvent.upload(input, imageFile('logo.png'))

    const list = await screen.findByRole('list', { name: 'Imported clips' })
    const item = within(list).getByRole('listitem')
    expect(item).toHaveTextContent('logo.png')
    expect(item).toHaveTextContent('Image')
    expect(item.querySelector('.clip-kind')).toHaveClass('clip-kind-image')
    // A still has no duration: the column shows a dash, not "0:00".
    expect(item.querySelector('.clip-duration')).toHaveTextContent('—')
    expect(item).not.toHaveTextContent('0:00')
  })

  it('adding an image places a 5-second still entry on the timeline (#140)', async () => {
    probeMock
      .mockResolvedValueOnce({ duration: 0, url: 'blob:logo', kind: 'image', width: 8, height: 8 })
      .mockResolvedValueOnce({ duration: 5, url: 'blob:v', kind: 'video' })
    render(<App />)

    const input = screen.getByTestId('clip-file-input')
    await userEvent.upload(input, imageFile('logo.png'))
    await userEvent.upload(input, videoFile('clip.mp4'))
    await screen.findByText('clip.mp4')

    // Images join the sequence like videos do (#140)...
    await userEvent.click(screen.getByRole('button', { name: 'Add logo.png to timeline' }))
    const sequence = screen.getByRole('list', { name: 'Sequence' })
    const entry = within(sequence).getByRole('listitem')
    expect(entry).toHaveTextContent('logo.png')
    // ...showing for the default 5 seconds, editable as a duration (no trim).
    expect(
      within(entry).getByRole('spinbutton', {
        name: 'Duration of logo.png at position 1 in seconds',
      }),
    ).toHaveValue(5)
    // Images can still be removed like any clip.
    expect(
      screen.getByRole('button', { name: 'Remove logo.png from library' }),
    ).toBeInTheDocument()
  })

  it('surfaces an undecodable image as an import failure, not a crash', async () => {
    probeMock.mockRejectedValueOnce(
      new Error('"broken.png" is not an image this browser can display.'),
    )
    render(<App />)
    await userEvent.upload(screen.getByTestId('clip-file-input'), imageFile('broken.png'))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '"broken.png" is not an image this browser can display.',
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

describe('sorting (#123)', () => {
  /** Imports one clip through the mocked probe with a chosen kind/duration. */
  async function importAs(name: string, kind: 'video' | 'audio', duration: number) {
    probeMock.mockResolvedValueOnce({ duration, url: `blob:${name}`, kind })
    await userEvent.upload(screen.getByTestId('clip-file-input'), videoFile(name))
    await screen.findByText(name)
  }

  const listedNames = () =>
    within(screen.getByRole('list', { name: 'Imported clips' }))
      .getAllByRole('listitem')
      .map((item) => item.querySelector('.clip-name')!.textContent)

  it('shows the controls only once there are at least two clips', async () => {
    render(<App />)
    expect(screen.queryByRole('group', { name: 'Sort clips' })).not.toBeInTheDocument()
    await importAs('one.mp4', 'video', 5)
    expect(screen.queryByRole('group', { name: 'Sort clips' })).not.toBeInTheDocument()
    await importAs('two.mp4', 'video', 5)
    expect(screen.getByRole('group', { name: 'Sort clips' })).toBeInTheDocument()
  })

  it('sorts by each key, marks the active key and direction, and reverses on repeat', async () => {
    render(<App />)
    await importAs('zebra.mp4', 'video', 30)
    await importAs('mango.mp3', 'audio', 90)
    await importAs('apple.mp4', 'video', 3)

    const nameButton = screen.getByRole('button', { name: 'Sort by name' })
    await userEvent.click(nameButton)
    expect(listedNames()).toEqual(['apple.mp4', 'mango.mp3', 'zebra.mp4'])
    expect(nameButton).toHaveAttribute('aria-pressed', 'true')
    expect(nameButton).toHaveTextContent('Name ↑')

    // The same key again reverses; the indicator follows.
    await userEvent.click(nameButton)
    expect(listedNames()).toEqual(['zebra.mp4', 'mango.mp3', 'apple.mp4'])
    expect(nameButton).toHaveTextContent('Name ↓')

    // Length sorts numerically and takes the active marker over.
    const lengthButton = screen.getByRole('button', { name: 'Sort by length' })
    await userEvent.click(lengthButton)
    expect(listedNames()).toEqual(['apple.mp4', 'zebra.mp4', 'mango.mp3'])
    expect(lengthButton).toHaveAttribute('aria-pressed', 'true')
    expect(lengthButton).toHaveTextContent('Length ↑')
    expect(nameButton).toHaveAttribute('aria-pressed', 'false')
    expect(nameButton).toHaveTextContent('Name')
    expect(nameButton).not.toHaveTextContent('↓')
  })

  it("carries the previous sort over as tie order (the customer's example)", async () => {
    render(<App />)
    await importAs('zebra.mp4', 'video', 10)
    await importAs('mango.mp3', 'audio', 10)
    await importAs('apple.mp4', 'video', 10)
    await importAs('banana.mp3', 'audio', 10)

    await userEvent.click(screen.getByRole('button', { name: 'Sort by name' }))
    expect(listedNames()).toEqual(['apple.mp4', 'banana.mp3', 'mango.mp3', 'zebra.mp4'])

    // By type: videos grouped first, each group still alphabetical.
    await userEvent.click(screen.getByRole('button', { name: 'Sort by type' }))
    expect(listedNames()).toEqual(['apple.mp4', 'zebra.mp4', 'banana.mp3', 'mango.mp3'])
  })
})
