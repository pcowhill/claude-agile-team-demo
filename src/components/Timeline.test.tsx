import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { probeVideoFile } from '../lib/probeVideo'

vi.mock('../lib/probeVideo', () => ({
  probeVideoFile: vi.fn(),
}))

const probeMock = vi.mocked(probeVideoFile)

/** Imports a clip through the picker with a mocked probe result. */
async function importClip(name: string, duration: number) {
  probeMock.mockResolvedValueOnce({ duration, url: `blob:${name}` })
  await userEvent.upload(
    screen.getByTestId('clip-file-input'),
    new File(['x'], name, { type: 'video/mp4' }),
  )
  await screen.findAllByText(name)
}

const timelineEntries = () =>
  within(screen.getByRole('list', { name: 'Timeline entries' })).getAllByRole('listitem')

const totalDuration = () => screen.getByTestId('timeline-total-duration')

describe('timeline', () => {
  it('adds library clips to the timeline and shows the total duration', async () => {
    render(<App />)
    await importClip('first.mp4', 10)
    await importClip('second.mp4', 65)

    await userEvent.click(screen.getByRole('button', { name: 'Add first.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add second.mp4 to timeline' }))

    const entries = timelineEntries()
    expect(entries).toHaveLength(2)
    expect(entries[0]).toHaveTextContent('first.mp4')
    expect(entries[1]).toHaveTextContent('second.mp4')
    expect(totalDuration()).toHaveTextContent('1:15')
  })

  it('adds the same clip twice as independent entries', async () => {
    render(<App />)
    await importClip('loop.mp4', 4)

    const addButton = screen.getByRole('button', { name: 'Add loop.mp4 to timeline' })
    await userEvent.click(addButton)
    await userEvent.click(addButton)

    expect(timelineEntries()).toHaveLength(2)
    expect(totalDuration()).toHaveTextContent('0:08')
  })

  it('reorders entries with the move buttons and disables them at the edges', async () => {
    render(<App />)
    await importClip('a.mp4', 1)
    await importClip('b.mp4', 2)

    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add b.mp4 to timeline' }))

    expect(screen.getByRole('button', { name: 'Move entry 1 up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move entry 2 down' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Move entry 2 up' }))

    const entries = timelineEntries()
    expect(entries[0]).toHaveTextContent('b.mp4')
    expect(entries[1]).toHaveTextContent('a.mp4')
  })

  it('removes an entry without touching the media library, updating the total', async () => {
    render(<App />)
    await importClip('keep.mp4', 30)

    await userEvent.click(screen.getByRole('button', { name: 'Add keep.mp4 to timeline' }))
    expect(totalDuration()).toHaveTextContent('0:30')

    await userEvent.click(screen.getByRole('button', { name: 'Remove entry 1' }))

    expect(screen.queryByRole('list', { name: 'Timeline entries' })).not.toBeInTheDocument()
    expect(totalDuration()).toHaveTextContent('0:00')
    // The clip is still in the library, ready to be added again.
    expect(
      within(screen.getByRole('list', { name: 'Imported clips' })).getByText('keep.mp4'),
    ).toBeInTheDocument()
  })
})
