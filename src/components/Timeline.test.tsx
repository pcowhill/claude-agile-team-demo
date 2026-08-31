import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { probeMediaFile } from '../lib/probeMedia'

vi.mock('../lib/probeMedia', () => ({
  probeMediaFile: vi.fn(),
}))

const probeMock = vi.mocked(probeMediaFile)

const importClip = async (name: string, duration: number) => {
  probeMock.mockResolvedValueOnce({ duration, url: `blob:${name}`, kind: 'video' })
  await userEvent.upload(
    screen.getByTestId('clip-file-input'),
    new File(['content'], name, { type: 'video/mp4' }),
  )
  await screen.findByText(name)
}

const importAudioClip = async (name: string, duration: number) => {
  probeMock.mockResolvedValueOnce({ duration, url: `blob:${name}`, kind: 'audio' })
  await userEvent.upload(
    screen.getByTestId('clip-file-input'),
    new File(['content'], name, { type: 'audio/mpeg' }),
  )
  await screen.findByText(name)
}

const sequence = () => screen.getByRole('list', { name: 'Sequence' })
const sequenceNames = () =>
  within(sequence())
    .getAllByRole('listitem')
    .map((item) => item.querySelector('.clip-name')?.textContent)

/** Confirms the removal dialog that timeline item removals open (#178). */
const confirmRemoval = async () => {
  await userEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }),
  )
}

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

  describe('still entries (#140)', () => {
    const importImage = async (name: string) => {
      probeMock.mockResolvedValueOnce({
        duration: 0,
        url: `blob:${name}`,
        kind: 'image',
        width: 640,
        height: 480,
      })
      await userEvent.upload(
        screen.getByTestId('clip-file-input'),
        new File(['content'], name, { type: 'image/png' }),
      )
      await screen.findByText(name)
    }

    it('shows a still as one duration field — no trim, no volume, no mute', async () => {
      render(<App />)
      await importImage('logo.png')
      await userEvent.click(screen.getByRole('button', { name: 'Add logo.png to timeline' }))

      expect(
        screen.getByRole('spinbutton', { name: 'Duration of logo.png at position 1 in seconds' }),
      ).toHaveValue(5)
      expect(screen.getByTestId('timeline-total')).toHaveTextContent('0:05')
      expect(
        screen.queryByRole('spinbutton', {
          name: 'Trim in point of logo.png at position 1 in seconds',
        }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('spinbutton', { name: 'Volume of logo.png at position 1 (0 to 1)' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('checkbox', { name: 'Mute logo.png at position 1' }),
      ).not.toBeInTheDocument()
    })

    it('edits the duration; the entry length and the total follow', async () => {
      render(<App />)
      await importImage('logo.png')
      await userEvent.click(screen.getByRole('button', { name: 'Add logo.png to timeline' }))

      const duration = screen.getByRole('spinbutton', {
        name: 'Duration of logo.png at position 1 in seconds',
      })
      await userEvent.clear(duration)
      await userEvent.type(duration, '2.5')
      await userEvent.tab()

      expect(duration).toHaveValue(2.5)
      // formatDuration rounds to whole seconds: 2.5 displays as 0:03.
      expect(screen.getByTestId('timeline-total')).toHaveTextContent('0:03')
    })

    it('rejects a non-positive duration and snaps the field back', async () => {
      render(<App />)
      await importImage('logo.png')
      await userEvent.click(screen.getByRole('button', { name: 'Add logo.png to timeline' }))

      const duration = screen.getByRole('spinbutton', {
        name: 'Duration of logo.png at position 1 in seconds',
      })
      await userEvent.clear(duration)
      await userEvent.type(duration, '0')
      await userEvent.tab()

      expect(duration).toHaveValue(5)
      expect(screen.getByTestId('timeline-total')).toHaveTextContent('0:05')
    })

    it('offers transitions and zooms on a still like any entry', async () => {
      render(<App />)
      await importClip('a.mp4', 10)
      await importImage('logo.png')
      await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
      await userEvent.click(screen.getByRole('button', { name: 'Add logo.png to timeline' }))

      // A crossfade into the still: the total shrinks by the 1s overlap.
      await userEvent.click(
        screen.getByRole('button', { name: 'Add transition between position 1 and 2' }),
      )
      expect(screen.getByTestId('timeline-total')).toHaveTextContent('0:14')
      // Zooming into a still is supported (#140) — the same control as video.
      expect(
        screen.getByRole('button', { name: 'Add zoom to logo.png at position 2' }),
      ).toBeEnabled()
    })
  })

  describe('color slates (#143)', () => {
    it('adds a red 5-second slate from the timeline itself — no import involved', async () => {
      render(<App />)
      await userEvent.click(screen.getByRole('button', { name: 'Add color slate to timeline' }))

      expect(sequenceNames()).toEqual(['Color slate'])
      expect(screen.getByTestId('timeline-total')).toHaveTextContent('0:05')
      const color = screen.getByLabelText('Color of Color slate at position 1')
      expect(color).toHaveValue('#ff0000')
      expect(
        screen.getByRole('spinbutton', {
          name: 'Duration of Color slate at position 1 in seconds',
        }),
      ).toHaveValue(5)
      // A slate is a still: no trim, no volume, no mute.
      expect(
        screen.queryByRole('spinbutton', {
          name: 'Trim in point of Color slate at position 1 in seconds',
        }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('spinbutton', {
          name: 'Volume of Color slate at position 1 (0 to 1)',
        }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('checkbox', { name: 'Mute Color slate at position 1' }),
      ).not.toBeInTheDocument()
    })

    it('edits the color through the picker', async () => {
      render(<App />)
      await userEvent.click(screen.getByRole('button', { name: 'Add color slate to timeline' }))

      const color = screen.getByLabelText('Color of Color slate at position 1')
      // userEvent has no color-picker interaction; fireEvent's change is what
      // the input emits after a pick.
      fireEvent.change(color, { target: { value: '#00cc66' } })
      expect(color).toHaveValue('#00cc66')
    })

    it('edits the duration and carries transitions like any still', async () => {
      render(<App />)
      await importClip('a.mp4', 10)
      await userEvent.click(screen.getByRole('button', { name: 'Add color slate to timeline' }))
      await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))

      const duration = screen.getByRole('spinbutton', {
        name: 'Duration of Color slate at position 1 in seconds',
      })
      await userEvent.clear(duration)
      await userEvent.type(duration, '2')
      await userEvent.tab()
      expect(duration).toHaveValue(2)
      // 2s slate + 10s video, then a 1s crossfade between them.
      expect(screen.getByTestId('timeline-total')).toHaveTextContent('0:12')
      await userEvent.click(
        screen.getByRole('button', { name: 'Add transition between position 1 and 2' }),
      )
      expect(screen.getByTestId('timeline-total')).toHaveTextContent('0:11')
    })
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

      const typeSelect = screen.getByRole('combobox', {
        name: 'Transition type between position 1 and 2',
      })
      expect(typeSelect).toHaveValue('crossfade')
      // Every effect is offered, each with a plain-language label (#62, #181).
      expect(
        Array.from(typeSelect.querySelectorAll('option'), (option) => option.textContent),
      ).toEqual([
        'Crossfade',
        'Slide from above',
        'Slide from below',
        'Slide from left',
        'Slide from right',
        'Wipe from left',
        'Wipe from right',
        'Wipe from above',
        'Wipe from below',
        'Push from left',
        'Push from right',
        'Push from above',
        'Push from below',
        'Fade through black',
        'Fade through white',
        'Iris open',
        'Iris close',
        'Cross-zoom',
      ])
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

  describe('zoom effects (#63, #129)', () => {
    it('adds the default zoom to an entry and shows its editable parameters', async () => {
      render(<App />)
      await importClip('a.mp4', 10)
      await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))

      await userEvent.click(screen.getByRole('button', { name: 'Add zoom to a.mp4 at position 1' }))

      expect(
        screen.getByRole('spinbutton', { name: 'Zoom 1 start of a.mp4 at position 1 in seconds' }),
      ).toHaveValue(0)
      expect(
        screen.getByRole('spinbutton', { name: 'Zoom 1 ramp-in of a.mp4 at position 1 in seconds' }),
      ).toHaveValue(0.5)
      expect(
        screen.getByRole('spinbutton', { name: 'Zoom 1 hold of a.mp4 at position 1 in seconds' }),
      ).toHaveValue(1)
      expect(
        screen.getByRole('spinbutton', { name: 'Zoom 1 ramp-out of a.mp4 at position 1 in seconds' }),
      ).toHaveValue(0.5)
      expect(
        screen.getByRole('spinbutton', { name: 'Zoom 1 scale of a.mp4 at position 1' }),
      ).toHaveValue(2)
      expect(
        screen.getByRole('spinbutton', { name: 'Zoom 1 centre X of a.mp4 at position 1 (0 to 1)' }),
      ).toHaveValue(0.5)
      // The add button stays: an entry can carry several zooms (#129).
      expect(
        screen.getByRole('button', { name: 'Add zoom to a.mp4 at position 1' }),
      ).toBeEnabled()
    })

    it('adds a second zoom into the free space after the first (#129)', async () => {
      render(<App />)
      await importClip('a.mp4', 10)
      await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))

      const addButton = screen.getByRole('button', { name: 'Add zoom to a.mp4 at position 1' })
      await userEvent.click(addButton)
      await userEvent.click(addButton)

      // The first zoom's default window spans [0, 2]; the second lands at 2.
      expect(
        screen.getByRole('spinbutton', { name: 'Zoom 1 start of a.mp4 at position 1 in seconds' }),
      ).toHaveValue(0)
      expect(
        screen.getByRole('spinbutton', { name: 'Zoom 2 start of a.mp4 at position 1 in seconds' }),
      ).toHaveValue(2)
      expect(
        screen.getByRole('spinbutton', { name: 'Zoom 2 hold of a.mp4 at position 1 in seconds' }),
      ).toHaveValue(1)
    })

    it('disables the add button when the zoom windows fill the trimmed entry (#129)', async () => {
      render(<App />)
      await importClip('a.mp4', 2)
      await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))

      const addButton = screen.getByRole('button', { name: 'Add zoom to a.mp4 at position 1' })
      await userEvent.click(addButton)
      // The default window [0, 2] covers the whole 2s clip.
      expect(addButton).toBeDisabled()
    })

    it('edits a parameter, and shows the clamp when a value cannot fit', async () => {
      render(<App />)
      await importClip('a.mp4', 10)
      await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
      await userEvent.click(screen.getByRole('button', { name: 'Add zoom to a.mp4 at position 1' }))

      const hold = screen.getByRole('spinbutton', {
        name: 'Zoom 1 hold of a.mp4 at position 1 in seconds',
      })
      await userEvent.clear(hold)
      await userEvent.type(hold, '3')
      await userEvent.tab()
      expect(hold).toHaveValue(3)

      // A hold longer than the clip fits only partially: with start 0 and
      // ramp-in 0.5 on a 10s entry, 99 clamps to 9.5 — and the ramp-out
      // that no longer fits clamps to 0. The clamp is visible in the fields.
      await userEvent.clear(hold)
      await userEvent.type(hold, '99')
      await userEvent.tab()
      expect(hold).toHaveValue(9.5)
      expect(
        screen.getByRole('spinbutton', { name: 'Zoom 1 ramp-out of a.mp4 at position 1 in seconds' }),
      ).toHaveValue(0)
    })

    it('edits one zoom without touching the other (#129)', async () => {
      render(<App />)
      await importClip('a.mp4', 10)
      await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
      const addButton = screen.getByRole('button', { name: 'Add zoom to a.mp4 at position 1' })
      await userEvent.click(addButton)
      await userEvent.click(addButton)

      const firstScale = screen.getByRole('spinbutton', {
        name: 'Zoom 1 scale of a.mp4 at position 1',
      })
      await userEvent.clear(firstScale)
      await userEvent.type(firstScale, '4')
      await userEvent.tab()

      expect(firstScale).toHaveValue(4)
      expect(
        screen.getByRole('spinbutton', { name: 'Zoom 2 scale of a.mp4 at position 1' }),
      ).toHaveValue(2)
      expect(
        screen.getByRole('spinbutton', { name: 'Zoom 2 start of a.mp4 at position 1 in seconds' }),
      ).toHaveValue(2)
    })

    it('clamps an off-frame centre against the scale, visibly', async () => {
      render(<App />)
      await importClip('a.mp4', 10)
      await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
      await userEvent.click(screen.getByRole('button', { name: 'Add zoom to a.mp4 at position 1' }))

      const centreX = screen.getByRole('spinbutton', {
        name: 'Zoom 1 centre X of a.mp4 at position 1 (0 to 1)',
      })
      // At the default scale 2 the centre can reach no further than 0.75.
      await userEvent.clear(centreX)
      await userEvent.type(centreX, '0.95')
      await userEvent.tab()
      expect(centreX).toHaveValue(0.75)
    })

    it('rejects a scale of 1 or less, snapping the field back', async () => {
      render(<App />)
      await importClip('a.mp4', 10)
      await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
      await userEvent.click(screen.getByRole('button', { name: 'Add zoom to a.mp4 at position 1' }))

      const scale = screen.getByRole('spinbutton', { name: 'Zoom 1 scale of a.mp4 at position 1' })
      await userEvent.clear(scale)
      await userEvent.type(scale, '1')
      await userEvent.tab()
      expect(scale).toHaveValue(2)
    })

    it('re-clamps the zoom when a trim shrinks the entry under it', async () => {
      render(<App />)
      await importClip('a.mp4', 10)
      await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
      await userEvent.click(screen.getByRole('button', { name: 'Add zoom to a.mp4 at position 1' }))

      const outField = screen.getByRole('spinbutton', {
        name: 'Trim out point of a.mp4 at position 1 in seconds',
      })
      await userEvent.clear(outField)
      await userEvent.type(outField, '0.75')
      await userEvent.tab()

      // 0.75s playable: ramp-in keeps 0.5, hold clamps from 1 to 0.25,
      // ramp-out clamps to 0 — clamped, not dropped.
      expect(
        screen.getByRole('spinbutton', { name: 'Zoom 1 ramp-in of a.mp4 at position 1 in seconds' }),
      ).toHaveValue(0.5)
      expect(
        screen.getByRole('spinbutton', { name: 'Zoom 1 hold of a.mp4 at position 1 in seconds' }),
      ).toHaveValue(0.25)
      expect(
        screen.getByRole('spinbutton', { name: 'Zoom 1 ramp-out of a.mp4 at position 1 in seconds' }),
      ).toHaveValue(0)
    })

    it('removes one zoom, keeping the other and renumbering it (#129)', async () => {
      render(<App />)
      await importClip('a.mp4', 10)
      await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
      const addButton = screen.getByRole('button', { name: 'Add zoom to a.mp4 at position 1' })
      await userEvent.click(addButton)
      await userEvent.click(addButton)

      await userEvent.click(
        screen.getByRole('button', { name: 'Remove zoom 1 from a.mp4 at position 1' }),
      )

      // The surviving zoom (formerly Zoom 2, at start 2) is now Zoom 1.
      expect(
        screen.getByRole('spinbutton', { name: 'Zoom 1 start of a.mp4 at position 1 in seconds' }),
      ).toHaveValue(2)
      expect(
        screen.queryByRole('spinbutton', { name: 'Zoom 2 scale of a.mp4 at position 1' }),
      ).not.toBeInTheDocument()

      await userEvent.click(
        screen.getByRole('button', { name: 'Remove zoom 1 from a.mp4 at position 1' }),
      )
      expect(
        screen.queryByRole('spinbutton', { name: 'Zoom 1 scale of a.mp4 at position 1' }),
      ).not.toBeInTheDocument()
      expect(addButton).toBeEnabled()
    })
  })

  describe('time-remap effects (#141)', () => {
    const addEntry = async (duration = 10) => {
      render(<App />)
      await importClip('a.mp4', duration)
      await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    }

    it('adds the default speed segment and shows its editable parameters', async () => {
      await addEntry()

      await userEvent.click(
        screen.getByRole('button', { name: 'Add speed segment to a.mp4 at position 1' }),
      )

      expect(
        screen.getByRole('spinbutton', {
          name: 'Speed segment 1 start of a.mp4 at position 1 in seconds',
        }),
      ).toHaveValue(0)
      expect(
        screen.getByRole('spinbutton', {
          name: 'Speed segment 1 end of a.mp4 at position 1 in seconds',
        }),
      ).toHaveValue(2)
      expect(
        screen.getByRole('spinbutton', { name: 'Speed segment 1 factor of a.mp4 at position 1' }),
      ).toHaveValue(0.5)
      // A 2s span at 0.5× plays for 4s: 10 − 2 + 4 = 12s remapped, and the
      // sequence total follows.
      expect(screen.getByText(/12s remapped/)).toBeInTheDocument()
      expect(screen.getByTestId('timeline-total')).toHaveTextContent('0:12')
    })

    it('adds the default pause into free space and totals its hold', async () => {
      await addEntry()

      await userEvent.click(
        screen.getByRole('button', { name: 'Add speed segment to a.mp4 at position 1' }),
      )
      await userEvent.click(screen.getByRole('button', { name: 'Add pause to a.mp4 at position 1' }))

      // The segment occupies [0, 2]; the pause lands where the free space starts.
      expect(
        screen.getByRole('spinbutton', { name: 'Pause 1 position of a.mp4 at position 1 in seconds' }),
      ).toHaveValue(2)
      expect(
        screen.getByRole('spinbutton', { name: 'Pause 1 hold of a.mp4 at position 1 in seconds' }),
      ).toHaveValue(1)
      // 12s from the slowed segment plus the 1s hold.
      expect(screen.getByText(/13s remapped/)).toBeInTheDocument()
      expect(screen.getByTestId('timeline-total')).toHaveTextContent('0:13')
    })

    it('edits a parameter, and shows the clamp when a value cannot fit', async () => {
      await addEntry()
      await userEvent.click(
        screen.getByRole('button', { name: 'Add speed segment to a.mp4 at position 1' }),
      )

      const factor = screen.getByRole('spinbutton', {
        name: 'Speed segment 1 factor of a.mp4 at position 1',
      })
      await userEvent.clear(factor)
      await userEvent.type(factor, '2')
      await userEvent.tab()
      expect(factor).toHaveValue(2)
      // A 2s span at 2× plays for 1s: 10 − 2 + 1 = 9s remapped.
      expect(screen.getByText(/9s remapped/)).toBeInTheDocument()

      // An end past the trimmed range clamps back to it, visibly.
      const end = screen.getByRole('spinbutton', {
        name: 'Speed segment 1 end of a.mp4 at position 1 in seconds',
      })
      await userEvent.clear(end)
      await userEvent.type(end, '99')
      await userEvent.tab()
      expect(end).toHaveValue(10)
    })

    it('rejects an invalid factor, snapping the field back', async () => {
      await addEntry()
      await userEvent.click(
        screen.getByRole('button', { name: 'Add speed segment to a.mp4 at position 1' }),
      )

      const factor = screen.getByRole('spinbutton', {
        name: 'Speed segment 1 factor of a.mp4 at position 1',
      })
      await userEvent.clear(factor)
      await userEvent.type(factor, '0')
      await userEvent.tab()
      expect(factor).toHaveValue(0.5)
    })

    it('disables the speed add when segments cover the range; the pause add once the end is held', async () => {
      await addEntry(2)

      const addSpeed = screen.getByRole('button', {
        name: 'Add speed segment to a.mp4 at position 1',
      })
      const addPause = screen.getByRole('button', { name: 'Add pause to a.mp4 at position 1' })
      await userEvent.click(addSpeed)
      // The default segment [0, 2] covers the whole 2s clip.
      expect(addSpeed).toBeDisabled()
      expect(addPause).toBeEnabled()
      // With every instant covered, the pause lands at the very end.
      await userEvent.click(addPause)
      expect(
        screen.getByRole('spinbutton', { name: 'Pause 1 position of a.mp4 at position 1 in seconds' }),
      ).toHaveValue(2)
      // Segments cover every instant and the end already holds a pause:
      // there is nowhere left to place another (#153).
      expect(addPause).toBeDisabled()
    })

    it('places a second default pause on a distinct instant (#153)', async () => {
      await addEntry()
      const addPause = screen.getByRole('button', { name: 'Add pause to a.mp4 at position 1' })
      await userEvent.click(addPause)
      await userEvent.click(addPause)
      // The first pause holds instant 0; a second "+ Pause" must not stack
      // onto the same instant — it lands mid-gap instead.
      expect(
        screen.getByRole('spinbutton', { name: 'Pause 1 position of a.mp4 at position 1 in seconds' }),
      ).toHaveValue(0)
      expect(
        screen.getByRole('spinbutton', { name: 'Pause 2 position of a.mp4 at position 1 in seconds' }),
      ).toHaveValue(5)
      // Both holds count in the remapped total.
      expect(screen.getByText(/12s remapped/)).toBeInTheDocument()
      expect(screen.getByTestId('timeline-total')).toHaveTextContent('0:12')
    })

    it('removes an effect, renumbering the rest of its kind', async () => {
      await addEntry()
      const addPause = screen.getByRole('button', { name: 'Add pause to a.mp4 at position 1' })
      await userEvent.click(addPause)
      const at = screen.getByRole('spinbutton', {
        name: 'Pause 1 position of a.mp4 at position 1 in seconds',
      })
      await userEvent.clear(at)
      await userEvent.type(at, '4')
      await userEvent.tab()
      await userEvent.click(addPause)
      // The new pause lands in the free gap before the first (window order).
      expect(
        screen.getByRole('spinbutton', { name: 'Pause 1 position of a.mp4 at position 1 in seconds' }),
      ).toHaveValue(0)
      expect(
        screen.getByRole('spinbutton', { name: 'Pause 2 position of a.mp4 at position 1 in seconds' }),
      ).toHaveValue(4)

      await userEvent.click(
        screen.getByRole('button', { name: 'Remove pause 1 from a.mp4 at position 1' }),
      )
      expect(
        screen.getByRole('spinbutton', { name: 'Pause 1 position of a.mp4 at position 1 in seconds' }),
      ).toHaveValue(4)
      expect(
        screen.queryByRole('spinbutton', {
          name: 'Pause 2 position of a.mp4 at position 1 in seconds',
        }),
      ).not.toBeInTheDocument()
    })

    it('offers no remap controls on stills', async () => {
      render(<App />)
      await userEvent.click(screen.getByRole('button', { name: 'Add color slate to timeline' }))
      expect(
        screen.queryByRole('button', { name: /Add speed segment to/ }),
      ).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Add pause to/ })).not.toBeInTheDocument()
    })

    it('re-clamps effects when a trim shrinks the entry under them', async () => {
      await addEntry()
      await userEvent.click(
        screen.getByRole('button', { name: 'Add speed segment to a.mp4 at position 1' }),
      )
      // Widen the end first: a start edit past the current end would make an
      // invalid (empty) intermediate range and be rejected.
      const end = screen.getByRole('spinbutton', {
        name: 'Speed segment 1 end of a.mp4 at position 1 in seconds',
      })
      await userEvent.clear(end)
      await userEvent.type(end, '9')
      await userEvent.tab()
      const start = screen.getByRole('spinbutton', {
        name: 'Speed segment 1 start of a.mp4 at position 1 in seconds',
      })
      await userEvent.clear(start)
      await userEvent.type(start, '6')
      await userEvent.tab()

      const out = screen.getByRole('spinbutton', {
        name: 'Trim out point of a.mp4 at position 1 in seconds',
      })
      await userEvent.clear(out)
      await userEvent.type(out, '8')
      await userEvent.tab()

      // The segment re-clamps into the shrunk 8s range: [6, 8].
      expect(start).toHaveValue(6)
      expect(end).toHaveValue(8)
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
    // Removal confirms first (#178); the dialog names the item.
    expect(screen.getByRole('dialog')).toHaveTextContent('Remove a.mp4 at position 1?')
    await confirmRemoval()

    expect(sequenceNames()).toEqual(['b.mp4'])
    expect(screen.getByTestId('timeline-total')).toHaveTextContent('0:15')
    // Still in the library, so it can be re-added.
    const library = screen.getByRole('list', { name: 'Imported clips' })
    expect(library).toHaveTextContent('a.mp4')
  })

  it('cancelling or escaping the removal dialog keeps the item (#178)', async () => {
    render(<App />)
    await importClip('a.mp4', 30)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    const removeButton = screen.getByRole('button', {
      name: 'Remove a.mp4 at position 1 from timeline',
    })

    // Cancel keeps the entry and closes the dialog.
    await userEvent.click(removeButton)
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(sequenceNames()).toEqual(['a.mp4'])

    // Escape cancels from anywhere, same result.
    await userEvent.click(removeButton)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(sequenceNames()).toEqual(['a.mp4'])
  })
})

describe('audio lane (#102)', () => {
  const lane = () => screen.getByRole('list', { name: 'Audio tracks' })

  it('adds overlapping audio tracks — twice from one clip and once from another', async () => {
    render(<App />)
    await importAudioClip('music.mp3', 30)
    await importAudioClip('fx.wav', 6)

    const addMusic = screen.getByRole('button', { name: 'Add music.mp3 to timeline' })
    await userEvent.click(addMusic)
    await userEvent.click(addMusic)
    await userEvent.click(screen.getByRole('button', { name: 'Add fx.wav to timeline' }))

    const items = within(lane()).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    // All three start at 0 — fully overlapping ranges are legal (#100).
    expect(
      screen.getByRole('spinbutton', {
        name: 'Start time of audio track music.mp3 at position 1 in seconds',
      }),
    ).toHaveValue(0)
    expect(
      screen.getByRole('spinbutton', {
        name: 'Start time of audio track music.mp3 at position 2 in seconds',
      }),
    ).toHaveValue(0)
    // The video sequence is untouched by any of it.
    expect(screen.queryByRole('list', { name: 'Sequence' })).not.toBeInTheDocument()
    expect(screen.getByTestId('timeline-total')).toHaveTextContent('0:00')
  })

  it('edits start time and trim from the lane; the bar tracks offset and length', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await importAudioClip('music.mp3', 30)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add music.mp3 to timeline' }))

    const startField = screen.getByRole('spinbutton', {
      name: 'Start time of audio track music.mp3 at position 1 in seconds',
    })
    const inField = screen.getByRole('spinbutton', {
      name: 'Trim in point of audio track music.mp3 at position 1 in seconds',
    })
    const outField = screen.getByRole('spinbutton', {
      name: 'Trim out point of audio track music.mp3 at position 1 in seconds',
    })

    await userEvent.clear(startField)
    await userEvent.type(startField, '5')
    await userEvent.tab()
    await userEvent.clear(inField)
    await userEvent.type(inField, '10')
    await userEvent.tab()
    await userEvent.clear(outField)
    await userEvent.type(outField, '25')
    await userEvent.tab()

    expect(startField).toHaveValue(5)
    expect(inField).toHaveValue(10)
    expect(outField).toHaveValue(25)
    expect(screen.getByText('plays 15s of 30s')).toBeInTheDocument()
    // Track runs 5..20 on a lane spanning to 20 (past the 10s video — the
    // silent tail renders instead of clipping): left 25%, width 75%.
    const bar = screen.getByTestId('audio-track-bar-0')
    expect(bar.style.left).toBe('25%')
    expect(bar.style.width).toBe('75%')
    // The video total is unchanged by audio (silent tail is #103's concern).
    expect(screen.getByTestId('timeline-total')).toHaveTextContent('0:10')
  })

  it('rejects an inverted trim range and snaps the fields back', async () => {
    render(<App />)
    await importAudioClip('music.mp3', 30)
    await userEvent.click(screen.getByRole('button', { name: 'Add music.mp3 to timeline' }))

    const inField = screen.getByRole('spinbutton', {
      name: 'Trim in point of audio track music.mp3 at position 1 in seconds',
    })
    await userEvent.clear(inField)
    await userEvent.type(inField, '45')
    await userEvent.tab()

    expect(inField).toHaveValue(0)
    expect(screen.getByText('plays 30s of 30s')).toBeInTheDocument()
  })

  it('removes a single track from the lane', async () => {
    render(<App />)
    await importAudioClip('music.mp3', 30)
    const add = screen.getByRole('button', { name: 'Add music.mp3 to timeline' })
    await userEvent.click(add)
    await userEvent.click(add)

    await userEvent.click(
      screen.getByRole('button', {
        name: 'Remove audio track music.mp3 at position 1 from timeline',
      }),
    )
    await confirmRemoval()
    expect(within(lane()).getAllByRole('listitem')).toHaveLength(1)
  })

  it('removing the library clip removes its tracks after the confirm dialog', async () => {
    URL.revokeObjectURL = vi.fn()
    render(<App />)
    await importAudioClip('music.mp3', 30)
    const add = screen.getByRole('button', { name: 'Add music.mp3 to timeline' })
    await userEvent.click(add)
    await userEvent.click(add)

    await userEvent.click(screen.getByRole('button', { name: 'Remove music.mp3 from library' }))
    const dialog = screen.getByRole('dialog')
    // Both audio tracks count as timeline uses in the warning.
    expect(dialog).toHaveTextContent('all 2 timeline entries')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))

    expect(screen.queryByRole('list', { name: 'Audio tracks' })).not.toBeInTheDocument()
    expect(screen.queryByText('music.mp3')).not.toBeInTheDocument()
  })
})

describe('gain controls (#104)', () => {
  it('starts a video entry at full volume, unmuted, and commits edits', async () => {
    render(<App />)
    await importClip('a.mp4', 30)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))

    const volume = screen.getByRole('spinbutton', {
      name: 'Volume of a.mp4 at position 1 (0 to 1)',
    })
    const mute = screen.getByRole('checkbox', { name: 'Mute a.mp4 at position 1' })
    expect(volume).toHaveValue(1)
    expect(mute).not.toBeChecked()

    await userEvent.clear(volume)
    await userEvent.type(volume, '0.4')
    await userEvent.tab()
    expect(volume).toHaveValue(0.4)

    await userEvent.click(mute)
    expect(mute).toBeChecked()
    await userEvent.click(mute)
    expect(mute).not.toBeChecked()
  })

  it('clamps an out-of-range entry volume and snaps the field to the stored value', async () => {
    render(<App />)
    await importClip('a.mp4', 30)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))

    const volume = screen.getByRole('spinbutton', {
      name: 'Volume of a.mp4 at position 1 (0 to 1)',
    })
    await userEvent.clear(volume)
    await userEvent.type(volume, '5')
    await userEvent.tab()
    // Clamped to the 0..1 range; full volume is the default, so the field
    // snaps back to 1.
    expect(volume).toHaveValue(1)
  })

  it('starts an audio track at full volume with no fades, and clamps fades to the trim', async () => {
    render(<App />)
    await importAudioClip('tone.wav', 20)
    await userEvent.click(screen.getByRole('button', { name: 'Add tone.wav to timeline' }))

    const position = 'audio track tone.wav at position 1'
    const volume = screen.getByRole('spinbutton', { name: `Volume of ${position} (0 to 1)` })
    const fadeIn = screen.getByRole('spinbutton', { name: `Fade-in of ${position} in seconds` })
    const fadeOut = screen.getByRole('spinbutton', { name: `Fade-out of ${position} in seconds` })
    expect(volume).toHaveValue(1)
    expect(fadeIn).toHaveValue(0)
    expect(fadeOut).toHaveValue(0)

    await userEvent.clear(volume)
    await userEvent.type(volume, '0.6')
    await userEvent.tab()
    expect(volume).toHaveValue(0.6)

    await userEvent.clear(fadeIn)
    await userEvent.type(fadeIn, '2')
    await userEvent.tab()
    expect(fadeIn).toHaveValue(2)

    // 99s of fade-out cannot fit the 20s track with 2s already fading in:
    // it clamps to the 18s that remain, visibly.
    await userEvent.clear(fadeOut)
    await userEvent.type(fadeOut, '99')
    await userEvent.tab()
    expect(fadeOut).toHaveValue(18)
  })
})

describe('text overlays (#139)', () => {
  it('adds a default overlay, lists it in the text lane, and shows its controls', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Add text overlay to timeline' }))

    const lane = screen.getByRole('list', { name: 'Text overlays' })
    expect(within(lane).getAllByRole('listitem')).toHaveLength(1)
    const content = screen.getByRole('textbox', { name: 'Content of text overlay at position 1' })
    expect(content).toHaveValue('Title')
    expect(
      screen.getByRole('spinbutton', { name: 'Start time of text overlay at position 1 in seconds' }),
    ).toHaveValue(0)
    expect(
      screen.getByRole('spinbutton', { name: 'Duration of text overlay at position 1 in seconds' }),
    ).toHaveValue(3)
    expect(
      screen.getByRole('combobox', { name: 'Font of text overlay at position 1' }),
    ).toHaveValue('sans')
    expect(
      screen.getByRole('checkbox', { name: 'Bold text overlay at position 1' }),
    ).not.toBeChecked()
  })

  it('edits content on blur, rejecting an empty commit visibly', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Add text overlay to timeline' }))
    const content = screen.getByRole('textbox', { name: 'Content of text overlay at position 1' })

    await userEvent.clear(content)
    await userEvent.type(content, 'Chapter one{enter}subtitle')
    await userEvent.tab()
    // Enter inserts a newline (multi-line content), never commits.
    expect(content).toHaveValue('Chapter one\nsubtitle')

    // An empty draft is rejected by the reducer; the field snaps back.
    await userEvent.clear(content)
    await userEvent.tab()
    expect(content).toHaveValue('Chapter one\nsubtitle')
  })

  it('edits timing, position, styling — and clamps visibly like other fields', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Add text overlay to timeline' }))

    const offset = screen.getByRole('spinbutton', {
      name: 'Start time of text overlay at position 1 in seconds',
    })
    await userEvent.clear(offset)
    await userEvent.type(offset, '2.5')
    await userEvent.tab()
    expect(offset).toHaveValue(2.5)

    const x = screen.getByRole('spinbutton', { name: 'Centre X of text overlay at position 1 (0 to 1)' })
    await userEvent.clear(x)
    await userEvent.type(x, '7')
    await userEvent.tab()
    // Clamped into the frame, visibly.
    expect(x).toHaveValue(1)

    const font = screen.getByRole('combobox', { name: 'Font of text overlay at position 1' })
    await userEvent.selectOptions(font, 'serif')
    expect(font).toHaveValue('serif')

    const bold = screen.getByRole('checkbox', { name: 'Bold text overlay at position 1' })
    await userEvent.click(bold)
    expect(bold).toBeChecked()

    const color = screen.getByLabelText('Color of text overlay at position 1')
    fireEvent.change(color, { target: { value: '#00ff00' } })
    expect(color).toHaveValue('#00ff00')
  })

  it('edits fades, clamping the pair into the duration visibly (#177)', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Add text overlay to timeline' }))

    // Default duration 3s: a 1s fade-in commits as typed.
    const fadeIn = screen.getByRole('spinbutton', {
      name: 'Fade-in of text overlay at position 1 in seconds',
    })
    await userEvent.clear(fadeIn)
    await userEvent.type(fadeIn, '1')
    await userEvent.tab()
    expect(fadeIn).toHaveValue(1)

    // A 5s fade-out exceeds what the 3s window leaves after the fade-in;
    // the reducer's clamp (fadeOut absorbs the shortfall) shows visibly.
    const fadeOut = screen.getByRole('spinbutton', {
      name: 'Fade-out of text overlay at position 1 in seconds',
    })
    await userEvent.clear(fadeOut)
    await userEvent.type(fadeOut, '5')
    await userEvent.tab()
    expect(fadeOut).toHaveValue(2)
  })

  it('removes an overlay; the lane disappears with the last one', async () => {
    render(<App />)
    const add = screen.getByRole('button', { name: 'Add text overlay to timeline' })
    await userEvent.click(add)
    await userEvent.click(add)
    expect(within(screen.getByRole('list', { name: 'Text overlays' })).getAllByRole('listitem')).toHaveLength(2)

    await userEvent.click(
      screen.getByRole('button', { name: 'Remove text overlay at position 1 from timeline' }),
    )
    await confirmRemoval()
    expect(within(screen.getByRole('list', { name: 'Text overlays' })).getAllByRole('listitem')).toHaveLength(1)
    await userEvent.click(
      screen.getByRole('button', { name: 'Remove text overlay at position 1 from timeline' }),
    )
    await confirmRemoval()
    expect(screen.queryByRole('list', { name: 'Text overlays' })).not.toBeInTheDocument()
  })

  it('overlays are independent of the sequence: video edits never retime them', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add text overlay to timeline' }))

    const offset = screen.getByRole('spinbutton', {
      name: 'Start time of text overlay at position 1 in seconds',
    })
    await userEvent.clear(offset)
    await userEvent.type(offset, '8')
    await userEvent.tab()

    // Trim the sequence to 2s — shorter than the overlay's start. The
    // overlay keeps its absolute timing (#102's anchoring decision).
    const out = screen.getByRole('spinbutton', {
      name: 'Trim out point of a.mp4 at position 1 in seconds',
    })
    await userEvent.clear(out)
    await userEvent.type(out, '2')
    await userEvent.tab()
    expect(offset).toHaveValue(8)
  })
})

describe('overlay video layers (#145)', () => {
  it('adds a video clip as an overlay via the library, listing it in the Overlays lane', async () => {
    render(<App />)
    await importClip('cam.mp4', 8)
    await userEvent.click(screen.getByRole('button', { name: 'Add cam.mp4 as overlay' }))

    const lane = screen.getByRole('list', { name: 'Overlay video layers' })
    expect(within(lane).getAllByRole('listitem')).toHaveLength(1)
    // The default: whole clip from sequence start, in the bottom-right corner.
    expect(
      screen.getByRole('spinbutton', {
        name: 'Start time of overlay cam.mp4 at position 1 in seconds',
      }),
    ).toHaveValue(0)
    expect(
      screen.getByRole('spinbutton', {
        name: 'Trim out point of overlay cam.mp4 at position 1 in seconds',
      }),
    ).toHaveValue(8)
    expect(
      screen.getByRole('spinbutton', {
        name: 'Left edge of overlay cam.mp4 at position 1 (fraction of frame width)',
      }),
    ).toHaveValue(0.62)
    expect(
      screen.getByRole('spinbutton', {
        name: 'Width of overlay cam.mp4 at position 1 (fraction of frame width)',
      }),
    ).toHaveValue(0.35)
    expect(
      screen.getByRole('checkbox', { name: 'Mute overlay cam.mp4 at position 1' }),
    ).not.toBeChecked()
  })

  it('offers the overlay button for video clips only', async () => {
    render(<App />)
    await importClip('cam.mp4', 8)
    await importAudioClip('song.mp3', 20)
    expect(screen.getByRole('button', { name: 'Add cam.mp4 as overlay' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add song.mp3 as overlay' })).not.toBeInTheDocument()
  })

  it('edits window, trim, rectangle, and gain — clamping visibly like other fields', async () => {
    render(<App />)
    await importClip('cam.mp4', 8)
    await userEvent.click(screen.getByRole('button', { name: 'Add cam.mp4 as overlay' }))

    const offset = screen.getByRole('spinbutton', {
      name: 'Start time of overlay cam.mp4 at position 1 in seconds',
    })
    await userEvent.clear(offset)
    await userEvent.type(offset, '2.5')
    await userEvent.tab()
    expect(offset).toHaveValue(2.5)

    const inPoint = screen.getByRole('spinbutton', {
      name: 'Trim in point of overlay cam.mp4 at position 1 in seconds',
    })
    await userEvent.clear(inPoint)
    await userEvent.type(inPoint, '1')
    await userEvent.tab()
    expect(inPoint).toHaveValue(1)

    // The rectangle never leaves the frame: x clamps to 1 − width, visibly.
    const x = screen.getByRole('spinbutton', {
      name: 'Left edge of overlay cam.mp4 at position 1 (fraction of frame width)',
    })
    await userEvent.clear(x)
    await userEvent.type(x, '0.9')
    await userEvent.tab()
    expect(x).toHaveValue(0.65)

    const volume = screen.getByRole('spinbutton', {
      name: 'Volume of overlay cam.mp4 at position 1 (0 to 1)',
    })
    await userEvent.clear(volume)
    await userEvent.type(volume, '0.4')
    await userEvent.tab()
    expect(volume).toHaveValue(0.4)

    const mute = screen.getByRole('checkbox', { name: 'Mute overlay cam.mp4 at position 1' })
    await userEvent.click(mute)
    expect(mute).toBeChecked()
  })

  it('removes an overlay; the lane disappears with the last one', async () => {
    render(<App />)
    await importClip('cam.mp4', 8)
    const add = screen.getByRole('button', { name: 'Add cam.mp4 as overlay' })
    await userEvent.click(add)
    await userEvent.click(add)
    expect(
      within(screen.getByRole('list', { name: 'Overlay video layers' })).getAllByRole('listitem'),
    ).toHaveLength(2)

    await userEvent.click(
      screen.getByRole('button', { name: 'Remove overlay cam.mp4 at position 1 from timeline' }),
    )
    await confirmRemoval()
    await userEvent.click(
      screen.getByRole('button', { name: 'Remove overlay cam.mp4 at position 1 from timeline' }),
    )
    await confirmRemoval()
    expect(screen.queryByRole('list', { name: 'Overlay video layers' })).not.toBeInTheDocument()
  })

  it('overlays are independent of the sequence: video edits never retime them', async () => {
    render(<App />)
    await importClip('base.mp4', 10)
    await importClip('cam.mp4', 8)
    await userEvent.click(screen.getByRole('button', { name: 'Add base.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add cam.mp4 as overlay' }))

    const offset = screen.getByRole('spinbutton', {
      name: 'Start time of overlay cam.mp4 at position 1 in seconds',
    })
    await userEvent.clear(offset)
    await userEvent.type(offset, '6')
    await userEvent.tab()

    // Shortening the sequence beneath the overlay's window leaves it be —
    // the allowed-tail decision (#102): it simply never shows.
    const out = screen.getByRole('spinbutton', {
      name: 'Trim out point of base.mp4 at position 1 in seconds',
    })
    await userEvent.clear(out)
    await userEvent.type(out, '2')
    await userEvent.tab()
    expect(offset).toHaveValue(6)
  })

  it('removing the source clip from the library removes its overlays', async () => {
    render(<App />)
    await importClip('base.mp4', 10)
    await importClip('cam.mp4', 8)
    await userEvent.click(screen.getByRole('button', { name: 'Add base.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add cam.mp4 as overlay' }))

    await userEvent.click(screen.getByRole('button', { name: 'Remove cam.mp4 from library' }))
    // The confirm dialog counts the overlay as timeline use of the clip.
    expect(screen.getByText(/removes the 1 timeline entry/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))

    expect(screen.queryByRole('list', { name: 'Overlay video layers' })).not.toBeInTheDocument()
    expect(sequenceNames()).toEqual(['base.mp4'])
  })
})
