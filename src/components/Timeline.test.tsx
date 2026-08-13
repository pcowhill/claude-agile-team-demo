import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { probeVideoFile } from '../lib/probeVideo'

vi.mock('../lib/probeVideo', () => ({
  probeVideoFile: vi.fn(),
}))

const probeMock = vi.mocked(probeVideoFile)

const importClip = async (name: string, duration: number) => {
  probeMock.mockResolvedValueOnce({ duration, url: `blob:${name}` })
  await userEvent.upload(
    screen.getByTestId('clip-file-input'),
    new File(['content'], name, { type: 'video/mp4' }),
  )
  await screen.findByText(name)
}

const sequence = () => screen.getByRole('list', { name: 'Sequence' })
const sequenceNames = () =>
  within(sequence())
    .getAllByRole('listitem')
    .map((item) => item.querySelector('.clip-name')?.textContent)

describe('timeline', () => {
  it('adds a library clip to the timeline, more than once, and totals the duration', async () => {
    render(<App />)
    await importClip('a.mp4', 30)

    const addButton = screen.getByRole('button', { name: 'Add a.mp4 to timeline' })
    await userEvent.click(addButton)
    await userEvent.click(addButton)

    expect(sequenceNames()).toEqual(['a.mp4', 'a.mp4'])
    expect(screen.getByTestId('timeline-total')).toHaveTextContent('1:00')
  })

  it('reorders entries with the move buttons', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await importClip('b.mp4', 20)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add b.mp4 to timeline' }))

    await userEvent.click(screen.getByRole('button', { name: 'Move b.mp4 at position 2 up' }))
    expect(sequenceNames()).toEqual(['b.mp4', 'a.mp4'])

    await userEvent.click(screen.getByRole('button', { name: 'Move b.mp4 at position 1 down' }))
    expect(sequenceNames()).toEqual(['a.mp4', 'b.mp4'])
  })

  it('disables moves that would go past either end', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))

    expect(screen.getByRole('button', { name: 'Move a.mp4 at position 1 up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move a.mp4 at position 1 down' })).toBeDisabled()
  })

  it('starts entries untrimmed, showing in/out and the effective duration', async () => {
    render(<App />)
    await importClip('a.mp4', 30)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))

    expect(
      screen.getByRole('spinbutton', { name: 'Trim in point of a.mp4 at position 1 in seconds' }),
    ).toHaveValue(0)
    expect(
      screen.getByRole('spinbutton', { name: 'Trim out point of a.mp4 at position 1 in seconds' }),
    ).toHaveValue(30)
    expect(screen.getByText('plays 30s of 30s')).toBeInTheDocument()
  })

  it('applies a trim: per-entry effective duration and the total both update', async () => {
    render(<App />)
    await importClip('a.mp4', 30)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))

    const inField = screen.getByRole('spinbutton', {
      name: 'Trim in point of a.mp4 at position 1 in seconds',
    })
    const outField = screen.getByRole('spinbutton', {
      name: 'Trim out point of a.mp4 at position 1 in seconds',
    })
    await userEvent.clear(inField)
    await userEvent.type(inField, '5')
    await userEvent.tab()
    await userEvent.clear(outField)
    await userEvent.type(outField, '17')
    await userEvent.tab()

    expect(inField).toHaveValue(5)
    expect(outField).toHaveValue(17)
    expect(screen.getByText('plays 12s of 30s')).toBeInTheDocument()
    expect(screen.getByTestId('timeline-total')).toHaveTextContent('0:12')
  })

  it('rejects an invalid trim range and snaps the field back', async () => {
    render(<App />)
    await importClip('a.mp4', 30)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))

    const inField = screen.getByRole('spinbutton', {
      name: 'Trim in point of a.mp4 at position 1 in seconds',
    })
    // In point at/after the out point (30) is impossible.
    await userEvent.clear(inField)
    await userEvent.type(inField, '45')
    await userEvent.tab()

    expect(inField).toHaveValue(0)
    expect(screen.getByText('plays 30s of 30s')).toBeInTheDocument()
    expect(screen.getByTestId('timeline-total')).toHaveTextContent('0:30')
  })

  it('trims one duplicate entry without affecting the other', async () => {
    render(<App />)
    await importClip('a.mp4', 20)
    const addButton = screen.getByRole('button', { name: 'Add a.mp4 to timeline' })
    await userEvent.click(addButton)
    await userEvent.click(addButton)

    const firstOut = screen.getByRole('spinbutton', {
      name: 'Trim out point of a.mp4 at position 1 in seconds',
    })
    await userEvent.clear(firstOut)
    await userEvent.type(firstOut, '4')
    await userEvent.tab()

    expect(firstOut).toHaveValue(4)
    expect(
      screen.getByRole('spinbutton', { name: 'Trim out point of a.mp4 at position 2 in seconds' }),
    ).toHaveValue(20)
    expect(screen.getByText('plays 4s of 20s')).toBeInTheDocument()
    expect(screen.getByText('plays 20s of 20s')).toBeInTheDocument()
    // 4s + 20s
    expect(screen.getByTestId('timeline-total')).toHaveTextContent('0:24')
  })

  describe('transitions', () => {
    const addTwoClips = async () => {
      await importClip('a.mp4', 10)
      await importClip('b.mp4', 20)
      await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
      await userEvent.click(screen.getByRole('button', { name: 'Add b.mp4 to timeline' }))
    }

    it('offers a transition only between entries, and adds a 1s crossfade by default', async () => {
      render(<App />)
      await addTwoClips()

      expect(
        screen.getAllByRole('button', { name: /Add transition between/ }),
      ).toHaveLength(1)
      await userEvent.click(
        screen.getByRole('button', { name: 'Add transition between position 1 and 2' }),
      )

      expect(
        screen.getByRole('combobox', { name: 'Transition type between position 1 and 2' }),
      ).toHaveValue('crossfade')
      expect(
        screen.getByRole('spinbutton', {
          name: 'Transition duration between position 1 and 2 in seconds',
        }),
      ).toHaveValue(1)
      // 10 + 20 − 1
      expect(screen.getByTestId('timeline-total')).toHaveTextContent('0:29')
    })

    it('changes the type and duration, clamping to the shorter neighbor', async () => {
      render(<App />)
      await addTwoClips()
      await userEvent.click(
        screen.getByRole('button', { name: 'Add transition between position 1 and 2' }),
      )

      await userEvent.selectOptions(
        screen.getByRole('combobox', { name: 'Transition type between position 1 and 2' }),
        'Slide from above',
      )
      const duration = screen.getByRole('spinbutton', {
        name: 'Transition duration between position 1 and 2 in seconds',
      })
      await userEvent.clear(duration)
      await userEvent.type(duration, '99')
      await userEvent.tab()

      // Clamped to a.mp4's 10s playable duration; total 10 + 20 − 10.
      expect(duration).toHaveValue(10)
      expect(screen.getByTestId('timeline-total')).toHaveTextContent('0:20')
      expect(
        screen.getByRole('combobox', { name: 'Transition type between position 1 and 2' }),
      ).toHaveValue('slide-from-above')
    })

    it('removes the transition, restoring the hard cut and the total', async () => {
      render(<App />)
      await addTwoClips()
      await userEvent.click(
        screen.getByRole('button', { name: 'Add transition between position 1 and 2' }),
      )
      expect(screen.getByTestId('timeline-total')).toHaveTextContent('0:29')

      await userEvent.click(
        screen.getByRole('button', { name: 'Remove transition between position 1 and 2' }),
      )

      expect(screen.getByTestId('timeline-total')).toHaveTextContent('0:30')
      expect(
        screen.getByRole('button', { name: 'Add transition between position 1 and 2' }),
      ).toBeInTheDocument()
    })

    it('drops the transition when its boundary dissolves by reordering', async () => {
      render(<App />)
      await addTwoClips()
      await userEvent.click(
        screen.getByRole('button', { name: 'Add transition between position 1 and 2' }),
      )

      await userEvent.click(screen.getByRole('button', { name: 'Move b.mp4 at position 2 up' }))

      expect(screen.getByTestId('timeline-total')).toHaveTextContent('0:30')
      expect(
        screen.getByRole('button', { name: 'Add transition between position 1 and 2' }),
      ).toBeInTheDocument()
    })

    it('re-clamps the transition when a trim shrinks a neighbor below it', async () => {
      render(<App />)
      await addTwoClips()
      await userEvent.click(
        screen.getByRole('button', { name: 'Add transition between position 1 and 2' }),
      )

      const outField = screen.getByRole('spinbutton', {
        name: 'Trim out point of a.mp4 at position 1 in seconds',
      })
      await userEvent.clear(outField)
      await userEvent.type(outField, '0.5')
      await userEvent.tab()

      expect(
        screen.getByRole('spinbutton', {
          name: 'Transition duration between position 1 and 2 in seconds',
        }),
      ).toHaveValue(0.5)
      // 0.5 + 20 − 0.5
      expect(screen.getByTestId('timeline-total')).toHaveTextContent('0:20')
    })
  })

  it('removes an entry without touching the media library, updating the total', async () => {
    render(<App />)
    await importClip('a.mp4', 30)
    await importClip('b.mp4', 15)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add b.mp4 to timeline' }))
    expect(screen.getByTestId('timeline-total')).toHaveTextContent('0:45')

    await userEvent.click(
      screen.getByRole('button', { name: 'Remove a.mp4 at position 1 from timeline' }),
    )

    expect(sequenceNames()).toEqual(['b.mp4'])
    expect(screen.getByTestId('timeline-total')).toHaveTextContent('0:15')
    // Still in the library, so it can be re-added.
    const library = screen.getByRole('list', { name: 'Imported clips' })
    expect(library).toHaveTextContent('a.mp4')
  })
})
