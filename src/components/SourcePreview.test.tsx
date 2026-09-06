import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { probeMediaFile } from '../lib/probeMedia'

vi.mock('../lib/probeMedia', () => ({
  probeMediaFile: vi.fn(),
}))

const probeMock = vi.mocked(probeMediaFile)

type Kind = 'video' | 'audio' | 'image'

const fileOf = (name: string, kind: Kind) =>
  new File(['content'], name, {
    type: kind === 'video' ? 'video/webm' : kind === 'audio' ? 'audio/wav' : 'image/png',
  })

/** Imports clips through the real input, one probe result per file. */
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

const previewButton = (name: string) => screen.getByRole('button', { name: `Preview ${name}` })
// `hidden: true` so the query still finds the slider while the source
// preview hides it — several assertions below are about exactly that state.
const sequenceSeek = () =>
  screen.getByRole('slider', { name: 'Seek within sequence', hidden: true })
const sourceSeek = () => screen.getByRole('slider', { name: 'Seek within source' })
const pressOnWindow = (key: string, init: Partial<KeyboardEventInit> = {}) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true, ...init }))
  })

/**
 * Source preview (#403, from feedback #397): a library clip alone in the
 * preview panel, entered from the library and left with one action, with
 * the sequence exactly as it was. jsdom plays no media, so playback itself
 * is e2e/source-preview.spec.ts's; the DOM decisions — what is offered,
 * what is hidden, what comes back — are pinned here through <App/>, since
 * the mode is App's wiring between the library and the preview.
 */
describe('source preview (#403)', () => {
  // The same media stubs the transport tests use: play/pause/paused faked
  // and rAF captured, enough to observe play state without playback.
  const pausedState = new WeakMap<HTMLMediaElement, boolean>()
  beforeEach(() => {
    probeMock.mockReset()
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      pausedState.set(this, false)
      return Promise.resolve()
    })
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      pausedState.set(this, true)
    })
    vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      return pausedState.get(this) ?? true
    })
    vi.stubGlobal('requestAnimationFrame', () => 1)
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('offers a Preview action on every row, in both views, only once wired', async () => {
    render(<App />)
    await importClips([['holiday.mp4', 'video'], ['tone.wav', 'audio'], ['logo.png', 'image']])
    for (const name of ['holiday.mp4', 'tone.wav', 'logo.png']) {
      expect(previewButton(name)).toHaveTextContent('▶')
    }
    await userEvent.click(screen.getByRole('button', { name: 'Thumbnail view' }))
    for (const name of ['holiday.mp4', 'tone.wav', 'logo.png']) {
      expect(previewButton(name)).toBeInTheDocument()
    }
    // Nothing is previewed until asked: the panel is the sequence preview.
    expect(screen.queryByTestId('source-preview')).not.toBeInTheDocument()
  })

  it('shows the clip alone with a source transport, hides the sequence transport, and Back restores it unchanged', async () => {
    render(<App />)
    await importClips([['holiday.mp4', 'video']])
    await userEvent.click(screen.getByRole('button', { name: 'Add holiday.mp4 to timeline' }))
    // A playhead position the mode must hand back untouched.
    fireEvent.change(sequenceSeek(), { target: { value: '2' } })
    expect(sequenceSeek()).toHaveValue('2')
    expect(screen.getByTestId('preview-position')).toHaveTextContent('0:02 / 0:07')

    await userEvent.click(previewButton('holiday.mp4'))

    // The source, named with its kind, and its own transport.
    const source = screen.getByTestId('source-preview')
    expect(within(source).getByTestId('source-preview-name')).toHaveTextContent('holiday.mp4')
    expect(within(source).getByText('Video')).toBeInTheDocument()
    expect(within(source).getByTestId('source-video')).toHaveAttribute('src', 'blob:holiday.mp4')
    expect(screen.getByRole('button', { name: 'Play source' })).toBeInTheDocument()
    expect(sourceSeek()).toHaveAttribute('max', '7')
    expect(screen.getByTestId('source-position')).toHaveTextContent('0:00 / 0:07')
    // The sequence transport is hidden, not gone: its elements keep state.
    expect(sequenceSeek()).not.toBeVisible()
    expect(screen.getByTestId('preview-now-playing')).not.toBeVisible()
    expect(screen.getByRole('button', { name: 'Play preview', hidden: true })).not.toBeVisible()
    // Sequence-only actions are not offered on the source.
    expect(within(source).queryByTestId('preview-split')).not.toBeInTheDocument()
    expect(within(source).queryByTestId('preview-mark-in')).not.toBeInTheDocument()

    // Seeking the source moves the source only.
    fireEvent.change(sourceSeek(), { target: { value: '3' } })
    expect(screen.getByTestId('source-position')).toHaveTextContent('0:03 / 0:07')

    await userEvent.click(screen.getByTestId('source-back'))
    expect(screen.queryByTestId('source-preview')).not.toBeInTheDocument()
    expect(sequenceSeek()).toBeVisible()
    expect(sequenceSeek()).toHaveValue('2')
    expect(screen.getByTestId('preview-position')).toHaveTextContent('0:02 / 0:07')
  })

  it('Escape leaves the source preview; Space drives the source, not the sequence', async () => {
    render(<App />)
    await importClips([['holiday.mp4', 'video']])
    await userEvent.click(screen.getByRole('button', { name: 'Add holiday.mp4 to timeline' }))
    await userEvent.click(previewButton('holiday.mp4'))
    // The click leaves focus on the row's button, which claims Space for
    // itself (#203); the keys below are pressed with nothing focused.
    ;(document.activeElement as HTMLElement | null)?.blur()

    pressOnWindow(' ')
    expect(screen.getByRole('button', { name: 'Pause source' })).toBeInTheDocument()
    // The sequence did not start: its Play button (hidden) still says Play.
    expect(screen.getByRole('button', { name: 'Play preview', hidden: true })).toBeInTheDocument()
    pressOnWindow(' ')
    expect(screen.getByRole('button', { name: 'Play source' })).toBeInTheDocument()

    pressOnWindow('Escape')
    expect(screen.queryByTestId('source-preview')).not.toBeInTheDocument()
    expect(sequenceSeek()).toBeVisible()
  })

  it('entering pauses a playing sequence and leaves it paused', async () => {
    render(<App />)
    await importClips([['holiday.mp4', 'video']])
    await userEvent.click(screen.getByRole('button', { name: 'Add holiday.mp4 to timeline' }))
    ;(document.activeElement as HTMLElement | null)?.blur()
    pressOnWindow(' ')
    expect(screen.getByRole('button', { name: 'Pause preview' })).toBeInTheDocument()

    await userEvent.click(previewButton('holiday.mp4'))
    await userEvent.click(screen.getByTestId('source-back'))
    expect(screen.getByRole('button', { name: 'Play preview' })).toBeInTheDocument()
  })

  it('removing the previewed clip exits the source preview', async () => {
    render(<App />)
    await importClips([['holiday.mp4', 'video']])
    await userEvent.click(previewButton('holiday.mp4'))
    expect(screen.getByTestId('source-preview')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Remove holiday.mp4 from library' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }))

    expect(screen.queryByTestId('source-preview')).not.toBeInTheDocument()
    // Back to the sequence preview — here the empty-timeline placeholder.
    expect(screen.getByText(/add clips to the timeline/i)).toBeVisible()
  })

  it('audio previews with its waveform and clock, an image simply shows', async () => {
    render(<App />)
    await importClips([['tone.wav', 'audio'], ['logo.png', 'image']])

    await userEvent.click(previewButton('tone.wav'))
    let source = screen.getByTestId('source-preview')
    expect(within(source).getByText('Audio')).toBeInTheDocument()
    expect(within(source).getByTestId('source-audio')).toHaveAttribute('src', 'blob:tone.wav')
    expect(within(source).getByTestId('source-waveform')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Play source' })).toBeInTheDocument()
    // Audio has no picture to layer (#145): no overlay action, as on the row.
    expect(within(source).queryByTestId('source-add-overlay')).not.toBeInTheDocument()
    expect(within(source).getByTestId('source-add')).toBeInTheDocument()

    // Previewing another clip while one is up switches to it.
    await userEvent.click(previewButton('logo.png'))
    source = screen.getByTestId('source-preview')
    expect(within(source).getByText('Image')).toBeInTheDocument()
    expect(within(source).getByTestId('source-image')).toHaveAttribute('src', 'blob:logo.png')
    // A still has no clock: no transport at all.
    expect(screen.queryByRole('button', { name: 'Play source' })).not.toBeInTheDocument()
    expect(screen.queryByRole('slider', { name: 'Seek within source' })).not.toBeInTheDocument()
    expect(within(source).getByTestId('source-add-overlay')).toBeInTheDocument()
  })

  it('double-clicking the name or the card picture previews the clip', async () => {
    const { container } = render(<App />)
    await importClips([['holiday.mp4', 'video']])
    fireEvent.doubleClick(screen.getByText('holiday.mp4'))
    expect(screen.getByTestId('source-preview')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('source-back'))

    await userEvent.click(screen.getByRole('button', { name: 'Thumbnail view' }))
    fireEvent.doubleClick(container.querySelector('.clip-card-picture')!)
    expect(screen.getByTestId('source-preview')).toBeInTheDocument()
  })

  it('Add to timeline from the source header adds the clip and keeps the source up', async () => {
    render(<App />)
    await importClips([['holiday.mp4', 'video']])
    await userEvent.click(previewButton('holiday.mp4'))
    await userEvent.click(screen.getByTestId('source-add'))
    expect(
      within(screen.getByRole('list', { name: 'Sequence' })).getAllByRole('listitem'),
    ).toHaveLength(1)
    expect(screen.getByTestId('source-preview')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('source-add-overlay'))
    expect(screen.getByTestId('source-preview')).toBeInTheDocument()
  })

  it('the cheat sheet lists Escape for leaving the source preview', async () => {
    render(<App />)
    await importClips([['holiday.mp4', 'video']])
    await userEvent.click(previewButton('holiday.mp4'))
    ;(document.activeElement as HTMLElement | null)?.blur()
    pressOnWindow('?', { shiftKey: true })
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' })
    expect(dialog).toHaveTextContent('Leave the source preview, back to the sequence')
    // Escape closes the sheet (a modal claims it) and leaves the source up.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('source-preview')).toBeInTheDocument()
  })
})
