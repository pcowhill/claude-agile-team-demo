import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { probeMediaFile } from '../lib/probeMedia'
import { extractAudioClip } from '../lib/extractAudio'
import { LIBRARY_VIEW_KEY } from '../lib/libraryView'
import { deserializeProject } from '../lib/projectFile'
import type { SavePort } from '../lib/saveProject'
import { peaksForClip } from '../lib/audioPeaks'
import { thumbnailForTrim } from '../lib/thumbnails'

vi.mock('../lib/probeMedia', () => ({
  probeMediaFile: vi.fn(),
}))

// The real implementation fetches blob: URLs, which jsdom cannot; the
// function itself is unit-tested in lib/extractAudio.test.ts.
vi.mock('../lib/extractAudio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/extractAudio')>()),
  extractAudioClip: vi.fn(),
}))

// A thumbnail card's picture comes from the real chain in a browser (object
// URL → decode → canvas, #193) and from Web Audio for a waveform (#191);
// jsdom has neither, so both sources are mocked at the module — the same
// seam Timeline.test.tsx already uses for peaks. Everything downstream of
// them (windowing, path building, the components' pending/failed states) is
// the real code, which is what lets a resolved value and a null one be told
// apart below.
vi.mock('../lib/thumbnails', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/thumbnails')>()),
  // Default: no capture, which is exactly what jsdom yields for real — so
  // every other suite in this file behaves as it did before these mocks.
  thumbnailForTrim: vi.fn(() => Promise.resolve(null)),
}))

vi.mock('../lib/audioPeaks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/audioPeaks')>()),
  peaksForClip: vi.fn(() => Promise.resolve(null)),
}))

const probeMock = vi.mocked(probeMediaFile)
const extractMock = vi.mocked(extractAudioClip)
const thumbnailMock = vi.mocked(thumbnailForTrim)
const peaksMock = vi.mocked(peaksForClip)

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

// Shared by the selection suites (#292 multi-select, #293 batch Remove).
type Kind = 'video' | 'audio' | 'image'
const fileOf = (name: string, kind: Kind) =>
  new File(['content'], name, {
    type: kind === 'video' ? 'video/mp4' : kind === 'audio' ? 'audio/mpeg' : 'image/png',
  })

/** Imports the given clips in order; each probes as its kind. */
async function importClips(clips: Array<[name: string, kind: Kind]>) {
  const input = screen.getByTestId('clip-file-input')
  for (const [name, kind] of clips) {
    probeMock.mockResolvedValueOnce(
      kind === 'image'
        ? { duration: 0, url: `blob:${name}`, kind, width: 64, height: 32 }
        : { duration: 7, url: `blob:${name}`, kind },
    )
    await userEvent.upload(input, fileOf(name, kind), { applyAccept: false })
    await screen.findByText(name)
  }
}

const selectAll = () => screen.getByRole('checkbox', { name: 'Select all' })
const rowBox = (name: string) => screen.getByRole('checkbox', { name: `Select ${name}` })
const bar = () => screen.queryByRole('toolbar', { name: 'Selected clips' })

describe('media library multi-select (#292)', () => {
  beforeEach(() => {
    probeMock.mockReset()
  })

  it('every row has a focusable checkbox; the action bar appears with the count and Clear empties it', async () => {
    render(<App />)
    await importClips([
      ['a.mp4', 'video'],
      ['b.mp3', 'audio'],
      ['c.png', 'image'],
    ])

    expect(bar()).toBeNull()
    expect(selectAll()).not.toBeChecked()

    // Keyboard: focus + Space toggles like any checkbox.
    rowBox('b.mp3').focus()
    await userEvent.keyboard(' ')
    expect(rowBox('b.mp3')).toBeChecked()
    expect(bar()).toHaveTextContent('1 selected')
    expect(selectAll()).toHaveProperty('indeterminate', true)

    await userEvent.click(rowBox('a.mp4'))
    expect(bar()).toHaveTextContent('2 selected')

    await userEvent.click(within(bar()!).getByRole('button', { name: 'Clear' }))
    expect(bar()).toBeNull()
    expect(rowBox('a.mp4')).not.toBeChecked()
    expect(rowBox('b.mp3')).not.toBeChecked()
    expect(selectAll()).toHaveProperty('indeterminate', false)
  })

  it('Select all selects every clip, reports checked, and unchecking clears', async () => {
    render(<App />)
    await importClips([
      ['a.mp4', 'video'],
      ['b.mp3', 'audio'],
    ])

    await userEvent.click(selectAll())
    expect(selectAll()).toBeChecked()
    expect(rowBox('a.mp4')).toBeChecked()
    expect(rowBox('b.mp3')).toBeChecked()
    expect(bar()).toHaveTextContent('2 selected')

    await userEvent.click(selectAll())
    expect(bar()).toBeNull()
    expect(rowBox('a.mp4')).not.toBeChecked()
  })

  it('Shift+click selects the inclusive range in the sorted display order', async () => {
    render(<App />)
    await importClips([
      ['zebra.mp4', 'video'],
      ['mango.mp4', 'video'],
      ['apple.mp4', 'video'],
      ['kiwi.mp4', 'video'],
    ])
    // Display order becomes apple, kiwi, mango, zebra.
    await userEvent.click(screen.getByRole('button', { name: 'Sort by name' }))

    await userEvent.click(rowBox('kiwi.mp4'))
    fireEvent.click(rowBox('zebra.mp4'), { shiftKey: true })

    expect(rowBox('apple.mp4')).not.toBeChecked()
    expect(rowBox('kiwi.mp4')).toBeChecked()
    expect(rowBox('mango.mp4')).toBeChecked()
    expect(rowBox('zebra.mp4')).toBeChecked()
    expect(bar()).toHaveTextContent('3 selected')

    // A plain click on a ranged item deselects just that one.
    await userEvent.click(rowBox('mango.mp4'))
    expect(bar()).toHaveTextContent('2 selected')
  })

  it('Add to timeline adds a mixed selection in library order as one undo step', async () => {
    render(<App />)
    await importClips([
      ['a.mp4', 'video'],
      ['b.mp3', 'audio'],
      ['c.png', 'image'],
    ])

    await userEvent.click(selectAll())
    await userEvent.click(within(bar()!).getByRole('button', { name: 'Add to timeline' }))

    // Video and image entries in library order; the audio clip on its lane.
    expect(
      screen.getByRole('spinbutton', { name: 'Trim in point of a.mp4 at position 1 in seconds' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('spinbutton', { name: 'Duration of c.png at position 2 in seconds' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Audio tracks' })).toHaveTextContent('b.mp3')
    // The selection is spent.
    expect(bar()).toBeNull()

    // One undo reverts the whole batch; redo restores it whole.
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(screen.queryByRole('list', { name: 'Sequence' })).toBeNull()
    expect(screen.queryByRole('list', { name: 'Audio tracks' })).toBeNull()
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true })
    expect(
      screen.getByRole('spinbutton', { name: 'Duration of c.png at position 2 in seconds' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Audio tracks' })).toHaveTextContent('b.mp3')
  })

  it('removing a selected clip prunes it from the selection', async () => {
    render(<App />)
    await importClips([
      ['a.mp4', 'video'],
      ['b.mp4', 'video'],
    ])
    await userEvent.click(selectAll())
    expect(bar()).toHaveTextContent('2 selected')

    await userEvent.click(screen.getByRole('button', { name: 'Remove a.mp4 from library' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }))

    expect(bar()).toHaveTextContent('1 selected')
    expect(selectAll()).toBeChecked()
  })

  it('single-row Add is unchanged and leaves the selection alone', async () => {
    render(<App />)
    await importClips([
      ['a.mp4', 'video'],
      ['b.mp4', 'video'],
    ])
    await userEvent.click(rowBox('b.mp4'))
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    expect(
      screen.getByRole('spinbutton', { name: 'Trim in point of a.mp4 at position 1 in seconds' }),
    ).toBeInTheDocument()
    expect(bar()).toHaveTextContent('1 selected')
  })
})

describe('media library thumbnail view (#311)', () => {
  beforeEach(() => {
    probeMock.mockReset()
    // Pictures that resolve, so a card's media layer is distinguishable
    // from its placeholder; the failing case sets these to null per test.
    thumbnailMock.mockResolvedValue('data:image/jpeg;base64,VGh1bWI=')
    peaksMock.mockResolvedValue(new Float32Array([0.2, 0.8, 0.5, 0.3]))
  })
  // Back to the jsdom-faithful default, so the suites after this one are
  // unaffected by what this one needed.
  afterEach(() => {
    thumbnailMock.mockResolvedValue(null)
    peaksMock.mockResolvedValue(null)
  })

  function fakeStorage(initial: Record<string, string> = {}) {
    const values = new Map(Object.entries(initial))
    return {
      values,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value)
      },
    }
  }

  const viewButton = (label: string) => screen.getByRole('button', { name: label })
  const clipList = () => screen.getByRole('list', { name: 'Imported clips' })
  const items = () => within(clipList()).getAllByRole('listitem')
  const showThumbnails = async () => userEvent.click(viewButton('Thumbnail view'))

  it('offers both views with the active one pressed, and defaults to the list', async () => {
    render(<App />)
    await importClips([['a.mp4', 'video']])

    expect(viewButton('List view')).toHaveAttribute('aria-pressed', 'true')
    expect(viewButton('Thumbnail view')).toHaveAttribute('aria-pressed', 'false')
    expect(clipList()).not.toHaveClass('clip-list-thumbnails')
    expect(items()[0]).not.toHaveClass('clip-item-card')

    await showThumbnails()

    expect(viewButton('Thumbnail view')).toHaveAttribute('aria-pressed', 'true')
    expect(viewButton('List view')).toHaveAttribute('aria-pressed', 'false')
    expect(clipList()).toHaveClass('clip-list-thumbnails')
    expect(items()[0]).toHaveClass('clip-item-card')
  })

  it('offers the toggle before anything is imported', async () => {
    render(<App />)
    // The preference can be set on an empty library, so the header does not
    // reflow when the first clip lands.
    expect(viewButton('Thumbnail view')).toBeInTheDocument()
    await showThumbnails()
    expect(viewButton('Thumbnail view')).toHaveAttribute('aria-pressed', 'true')
  })

  it('remembers the chosen view across mounts, per browser', async () => {
    const storage = fakeStorage()
    const { unmount } = render(<App layoutStorage={storage} />)
    await importClips([['a.mp4', 'video']])

    await showThumbnails()
    expect(clipList()).toHaveClass('clip-list-thumbnails')

    // A fresh mount (a page load) restores the remembered view.
    unmount()
    const remounted = render(<App layoutStorage={storage} />)
    await importClips([['a.mp4', 'video']])
    expect(viewButton('Thumbnail view')).toHaveAttribute('aria-pressed', 'true')
    expect(clipList()).toHaveClass('clip-list-thumbnails')

    // And the way back is remembered too, not just the way there.
    await userEvent.click(viewButton('List view'))
    remounted.unmount()
    render(<App layoutStorage={storage} />)
    await importClips([['a.mp4', 'video']])
    expect(viewButton('List view')).toHaveAttribute('aria-pressed', 'true')
    expect(clipList()).not.toHaveClass('clip-list-thumbnails')
  })

  it('keeps the view out of the saved project, in the browser store instead', async () => {
    // The autosave snapshot's structure record is exactly the bytes
    // `serializeProject` produces (lib/autosave.ts), so asserting on a saved
    // file covers the snapshot too.
    const writes: Uint8Array<ArrayBuffer>[] = []
    const port: SavePort = {
      kind: 'file-system-access',
      pickDestination: () =>
        Promise.resolve({
          kind: 'picked' as const,
          destination: {
            name: 'project.bvep',
            write: (bytes: Uint8Array<ArrayBuffer>) => {
              writes.push(bytes)
              return Promise.resolve()
            },
          },
        }),
    }
    const storage = fakeStorage()
    render(<App savePort={port} layoutStorage={storage} />)
    await importClips([['a.mp4', 'video']])
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await showThumbnails()

    await userEvent.click(screen.getByRole('button', { name: 'Save (unsaved changes)' }))
    const dialog = await screen.findByRole('dialog', { name: 'Save project' })
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Store references only' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save…' }))
    await screen.findByText('Saved as project.bvep')

    expect(writes).toHaveLength(1)
    const saved = await deserializeProject(writes[0])
    expect(saved.ok).toBe(true)
    if (saved.ok) {
      const serialized = JSON.stringify(saved.project)
      expect(serialized).not.toContain('thumbnails')
      expect(serialized).not.toContain(LIBRARY_VIEW_KEY)
    }
    // Discriminating: the choice was made and did persist — to the
    // per-browser store, under its own key, and nowhere near the project.
    expect(storage.values.get(LIBRARY_VIEW_KEY)).toBe('thumbnails')
  })

  it('gives each kind its own picture, over a placeholder, with name, badge and duration', async () => {
    render(<App />)
    await importClips([
      ['a.mp4', 'video'],
      ['b.mp3', 'audio'],
      ['c.png', 'image'],
    ])
    await showThumbnails()

    // Video: the captured first frame, the same (url, 0) cache key an
    // untrimmed timeline entry uses.
    expect(await screen.findByTestId('clip-card-thumbnail-0')).toBeInTheDocument()
    expect(thumbnailMock).toHaveBeenCalledWith('blob:a.mp4', 0)
    // Audio: the clip's amplitude, windowed to the untrimmed source.
    expect(await screen.findByTestId('clip-card-waveform-1')).toBeInTheDocument()
    expect(peaksMock).toHaveBeenCalledWith('blob:b.mp3')
    // Image: the image itself.
    expect(screen.getByTestId('clip-card-image-2')).toHaveAttribute('src', 'blob:c.png')

    const [videoCard, audioCard, imageCard] = items()
    // Every card carries the placeholder layer beneath its picture...
    for (const card of [videoCard, audioCard, imageCard]) {
      expect(card.querySelector('.clip-card-glyph')).not.toBeNull()
      expect(card.querySelector('.clip-card-picture')).not.toBeNull()
    }
    // ...and the same body as a row: name, kind badge, duration.
    expect(videoCard).toHaveTextContent('a.mp4')
    expect(videoCard.querySelector('.clip-kind')).toHaveClass('clip-kind-video')
    expect(videoCard.querySelector('.clip-duration')).toHaveTextContent('0:07')
    expect(audioCard.querySelector('.clip-kind')).toHaveClass('clip-kind-audio')
    expect(audioCard.querySelector('.clip-duration')).toHaveTextContent('0:07')
    expect(imageCard).toHaveTextContent('c.png')
    expect(imageCard.querySelector('.clip-kind')).toHaveClass('clip-kind-image')
    // A still has no duration here either (#137).
    expect(imageCard.querySelector('.clip-duration')).toHaveTextContent('—')
  })

  it('leaves the placeholder standing when a picture cannot be produced', async () => {
    // The failure the fallback exists for: an undecodable video and an
    // undecodable audio clip both resolve to nothing.
    thumbnailMock.mockResolvedValue(null)
    peaksMock.mockResolvedValue(null)
    render(<App />)
    await importClips([
      ['a.mp4', 'video'],
      ['b.mp3', 'audio'],
    ])
    await showThumbnails()

    // Both sources were consulted and both gave nothing back...
    await waitFor(() => expect(thumbnailMock).toHaveBeenCalled())
    await waitFor(() => expect(peaksMock).toHaveBeenCalled())
    expect(screen.queryByTestId('clip-card-thumbnail-0')).toBeNull()
    expect(screen.queryByTestId('clip-card-waveform-1')).toBeNull()

    // ...so the cards show their kind's placeholder and nothing is blank.
    const [videoCard, audioCard] = items()
    expect(videoCard.querySelector('.clip-card-glyph')?.textContent).toBe('▶')
    expect(audioCard.querySelector('.clip-card-glyph')?.textContent).toBe('♪')
    expect(videoCard).toHaveTextContent('a.mp4')
    expect(audioCard).toHaveTextContent('b.mp3')
  })

  it('offers every action under its identical accessible name, per kind', async () => {
    render(<App />)
    await importClips([
      ['a.mp4', 'video'],
      ['b.mp3', 'audio'],
      ['c.png', 'image'],
    ])
    await showThumbnails()

    // The full set on a video.
    for (const name of [
      'Add a.mp4 to timeline',
      'Add a.mp4 as overlay',
      'Extract audio from a.mp4',
      'Remove a.mp4 from library',
      'Select a.mp4',
    ]) {
      expect(screen.getByRole(name.startsWith('Select') ? 'checkbox' : 'button', { name })).toBeInTheDocument()
    }
    // And the same per-kind exclusions as a row: audio has no picture to
    // overlay, only a video has audio to pull out.
    expect(screen.queryByRole('button', { name: 'Add b.mp3 as overlay' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Add c.png as overlay' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Extract audio from b.mp3' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Extract audio from c.png' })).toBeNull()
  })

  it('the card actions do the work: Add, Overlay, Extract audio and Remove', async () => {
    extractMock.mockResolvedValueOnce({
      id: 'extracted-1',
      name: 'a.mp4 (audio)',
      duration: 7,
      url: 'blob:extracted',
      kind: 'audio',
      extractedFrom: 'a.mp4',
    })
    render(<App />)
    await importClips([['a.mp4', 'video']])
    await showThumbnails()

    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    expect(screen.getByRole('list', { name: 'Sequence' })).toHaveTextContent('a.mp4')

    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 as overlay' }))
    expect(screen.getByRole('list', { name: 'Overlay layers' })).toHaveTextContent('a.mp4')

    await userEvent.click(screen.getByRole('button', { name: 'Extract audio from a.mp4' }))
    expect(await screen.findByText('a.mp4 (audio)')).toBeInTheDocument()
    // The extracted clip is a card of its own, in the same grid.
    expect(items()).toHaveLength(2)
    expect(items()[1]).toHaveClass('clip-item-card')

    // Remove still confirms first, and the confirmation still names the
    // timeline items it takes with it.
    await userEvent.click(screen.getByRole('button', { name: 'Remove a.mp4 from library' }))
    const confirmation = screen.getByRole('dialog', { name: 'Remove a.mp4?' })
    expect(confirmation).toHaveTextContent('timeline entries')
    await userEvent.click(within(confirmation).getByRole('button', { name: 'Remove' }))
    // The video's card is gone; the extracted clip's is not — an extracted
    // clip is independent of its source (#154), and the card view inherits
    // that rather than reimplementing removal.
    expect(items()).toHaveLength(1)
    expect(items()[0]).toHaveTextContent('a.mp4 (audio)')
    expect(items()[0]).toHaveClass('clip-item-card')
    expect(screen.queryByRole('button', { name: 'Remove a.mp4 from library' })).toBeNull()
    expect(screen.queryByRole('list', { name: 'Sequence' })).toBeNull()
  })

  it('keeps selection working: card checkboxes, Select all and the action bar', async () => {
    render(<App />)
    await importClips([
      ['a.mp4', 'video'],
      ['b.mp3', 'audio'],
    ])
    await showThumbnails()

    expect(bar()).toBeNull()
    await userEvent.click(rowBox('a.mp4'))
    expect(rowBox('a.mp4')).toBeChecked()
    expect(bar()).toHaveTextContent('1 selected')
    expect(clipList()).toHaveClass('has-selection')

    await userEvent.click(selectAll())
    expect(bar()).toHaveTextContent('2 selected')
    expect(rowBox('b.mp3')).toBeChecked()

    // The bar's own work still runs from here.
    await userEvent.click(within(bar()!).getByRole('button', { name: 'Add to timeline' }))
    expect(screen.getByRole('list', { name: 'Sequence' })).toHaveTextContent('a.mp4')
    expect(bar()).toBeNull()
  })

  it('puts the selection checkbox before the actions in focus order (#342)', async () => {
    render(<App />)
    await importClips([
      ['a.mp4', 'video'],
      ['b.mp3', 'audio'],
    ])

    // In a row, the checkbox is the first child and so the first control
    // focus reaches. The card places it visually at the picture's top-left
    // corner, so it must come first there too — anything else makes focus
    // jump from the card's last button back up to its first control.
    const controlNames = (card: HTMLElement) =>
      [...card.querySelectorAll('input, button')].map((control) =>
        control.getAttribute('aria-label'),
      )

    const rowControls = controlNames(items()[0])
    expect(rowControls[0]).toBe('Select a.mp4')

    await showThumbnails()

    for (const [index, name] of ['a.mp4', 'b.mp3'].entries()) {
      const cardControls = controlNames(items()[index])
      expect(cardControls[0]).toBe(`Select ${name}`)
      // Discriminating: the card really does have actions after it, so
      // "first" is a statement about order and not about an only child.
      expect(cardControls.length).toBeGreaterThan(1)
    }

    // The same fact stated as the DOM relation the focus order follows from,
    // so a refactor that keeps the query order by accident still fails.
    const card = items()[0]
    const checkbox = card.querySelector('.clip-select')!
    const addButton = within(card).getByRole('button', { name: 'Add a.mp4 to timeline' })
    expect(checkbox.compareDocumentPosition(addButton)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    // And the checkbox still works from its new position.
    await userEvent.click(rowBox('a.mp4'))
    expect(rowBox('a.mp4')).toBeChecked()
    expect(bar()).toHaveTextContent('1 selected')
  })

  it('restores the row layout when toggled back to List view', async () => {
    render(<App />)
    await importClips([
      ['a.mp4', 'video'],
      ['b.mp3', 'audio'],
    ])
    await showThumbnails()
    expect(items()[0]).toHaveClass('clip-item-card')

    await userEvent.click(viewButton('List view'))

    expect(clipList()).not.toHaveClass('clip-list-thumbnails')
    for (const item of items()) expect(item).not.toHaveClass('clip-item-card')
    // The row's own pieces are back, and the card's are gone.
    expect(items()[0].querySelector('.clip-card-picture')).toBeNull()
    expect(items()[0].querySelector('.clip-name')).toHaveTextContent('a.mp4')
    expect(screen.getByRole('button', { name: 'Add a.mp4 to timeline' })).toBeInTheDocument()
    expect(rowBox('a.mp4')).toBeInTheDocument()
  })
})

describe('media library batch Remove (#293)', () => {
  const removeSelected = () =>
    within(bar()!).getByRole('button', { name: 'Remove selected clips' })
  const dialog = () => screen.getByRole('dialog')
  const confirm = () => within(dialog()).getByRole('button', { name: 'Remove' })
  const cancel = () => within(dialog()).getByRole('button', { name: 'Cancel' })

  beforeEach(() => {
    probeMock.mockReset()
    URL.revokeObjectURL = vi.fn()
  })

  it('the bar offers Remove, and the confirmation states the batch count and the affected timeline entries', async () => {
    render(<App />)
    await importClips([
      ['a.mp4', 'video'],
      ['b.mp3', 'audio'],
      ['c.png', 'image'],
    ])
    // Two of the three selected clips are on the timeline: the video twice
    // (a sequence entry and an overlay) and the audio once.
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 as overlay' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add b.mp3 to timeline' }))

    await userEvent.click(selectAll())
    await userEvent.click(removeSelected())

    expect(within(dialog()).getByRole('heading')).toHaveTextContent('Remove 3 clips?')
    expect(dialog()).toHaveTextContent('all 3 timeline entries')
  })

  it('cancelling leaves the library, the timeline, and the selection untouched', async () => {
    render(<App />)
    await importClips([
      ['a.mp4', 'video'],
      ['b.mp4', 'video'],
    ])
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await userEvent.click(selectAll())
    await userEvent.click(removeSelected())
    await userEvent.click(cancel())

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('list', { name: 'Imported clips' })).toHaveTextContent('a.mp4')
    expect(screen.getByRole('list', { name: 'Imported clips' })).toHaveTextContent('b.mp4')
    expect(
      screen.getByRole('spinbutton', { name: 'Trim in point of a.mp4 at position 1 in seconds' }),
    ).toBeInTheDocument()
    expect(bar()).toHaveTextContent('2 selected')
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  })

  it('confirming removes every selected clip, everything they made on the timeline, and their object URLs', async () => {
    render(<App />)
    await importClips([
      ['a.mp4', 'video'],
      ['b.mp3', 'audio'],
      ['keep.mp4', 'video'],
    ])
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 as overlay' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add b.mp3 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add keep.mp4 to timeline' }))

    // Everything except keep.mp4.
    await userEvent.click(rowBox('a.mp4'))
    await userEvent.click(rowBox('b.mp3'))
    await userEvent.click(removeSelected())
    await userEvent.click(confirm())

    const library = screen.getByRole('list', { name: 'Imported clips' })
    expect(library).not.toHaveTextContent('a.mp4')
    expect(library).not.toHaveTextContent('b.mp3')
    expect(library).toHaveTextContent('keep.mp4')
    // Every lane the removed clips reached is empty; the survivor stays.
    expect(screen.queryByRole('list', { name: 'Audio tracks' })).toBeNull()
    expect(screen.queryByRole('list', { name: 'Overlay layers' })).toBeNull()
    expect(
      screen.getByRole('spinbutton', { name: 'Trim in point of keep.mp4 at position 1 in seconds' }),
    ).toBeInTheDocument()
    // Both removed clips' memory is released; the survivor's URL is not.
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:a.mp4')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:b.mp3')
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:keep.mp4')
    // The selection is spent and the bar is gone.
    expect(bar()).toBeNull()
    expect(selectAll()).not.toBeChecked()
  })

  it('wording is grammatical for one clip and for clips that are on no timeline', async () => {
    render(<App />)
    await importClips([
      ['a.mp4', 'video'],
      ['b.mp4', 'video'],
    ])

    await userEvent.click(rowBox('a.mp4'))
    await userEvent.click(removeSelected())
    expect(within(dialog()).getByRole('heading')).toHaveTextContent('Remove 1 clip?')
    // Nothing was added to the timeline, so nothing else goes with it. The
    // body counts clips, so a one-clip batch reads like a single removal.
    expect(dialog()).toHaveTextContent('The clip will be removed from the media library.')
    await userEvent.click(cancel())

    // Cancelling keeps the selection, so a.mp4 is deselected before the
    // next case, which is again a batch of exactly one — this time with a
    // timeline entry behind it.
    await userEvent.click(rowBox('a.mp4'))
    await userEvent.click(screen.getByRole('button', { name: 'Add b.mp4 to timeline' }))
    await userEvent.click(rowBox('b.mp4'))
    await userEvent.click(removeSelected())
    expect(within(dialog()).getByRole('heading')).toHaveTextContent('Remove 1 clip?')
    expect(dialog()).toHaveTextContent('the 1 timeline entry created from this clip.')
  })

  it('single-row Remove keeps its own wording and removes only that clip', async () => {
    render(<App />)
    await importClips([
      ['a.mp4', 'video'],
      ['b.mp4', 'video'],
    ])
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await userEvent.click(selectAll())

    await userEvent.click(screen.getByRole('button', { name: 'Remove a.mp4 from library' }))
    expect(within(dialog()).getByRole('heading')).toHaveTextContent('Remove a.mp4?')
    expect(dialog()).toHaveTextContent('created from this clip.')
    await userEvent.click(confirm())

    expect(screen.getByRole('list', { name: 'Imported clips' })).toHaveTextContent('b.mp4')
    expect(screen.getByRole('list', { name: 'Imported clips' })).not.toHaveTextContent('a.mp4')
    // The batch path did not run: the still-listed clip stays selected.
    expect(bar()).toHaveTextContent('1 selected')
  })

  it('a batch removal that touches the timeline clears the undo history', async () => {
    render(<App />)
    await importClips([['a.mp4', 'video']])
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    expect(screen.getByRole('button', { name: 'Undo last timeline edit' })).toBeEnabled()

    await userEvent.click(selectAll())
    await userEvent.click(removeSelected())
    await userEvent.click(confirm())

    // Undo must not resurrect an entry whose clip's URL has been revoked.
    expect(screen.getByRole('button', { name: 'Undo last timeline edit' })).toBeDisabled()
    expect(screen.queryByRole('list', { name: 'Sequence' })).toBeNull()
  })
})
