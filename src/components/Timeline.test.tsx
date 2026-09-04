import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { DEFAULT_DUCK_LEVEL } from '../lib/gain'
import { probeMediaFile } from '../lib/probeMedia'
import { deserializeProject } from '../lib/projectFile'
import type { SavePort } from '../lib/saveProject'

vi.mock('../lib/probeMedia', () => ({
  probeMediaFile: vi.fn(),
}))

// jsdom has no Web Audio or blob fetch, so the peaks decode is mocked
// (resolved peaks make the waveform render, #191/#230); everything else in
// the module — windowing, path building — is the real code.
vi.mock('../lib/audioPeaks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/audioPeaks')>()
  return {
    ...actual,
    peaksForClip: vi.fn(() => Promise.resolve(new Float32Array([0.2, 0.8, 0.5, 0.3]))),
  }
})

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
    // Track runs 5..20 against the 10s video sequence — the lane scale is
    // the sequence duration (#180), so the silent tail past 10s is clamped:
    // left 50%, width 50% (was: lane stretched to the track's end).
    const bar = screen.getByTestId('audio-track-bar-0')
    expect(bar.style.left).toBe('50%')
    expect(bar.style.width).toBe('50%')
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

  it('toggles ducking on an audio track and edits its level (#241)', async () => {
    render(<App />)
    await importAudioClip('voice.wav', 20)
    await userEvent.click(screen.getByRole('button', { name: 'Add voice.wav to timeline' }))

    const position = 'audio track voice.wav at position 1'
    const levelField = () =>
      screen.queryByRole('spinbutton', { name: `Duck level of ${position} (0 to 1)` })
    const duck = screen.getByRole('checkbox', {
      name: `Duck other audio while ${position} plays`,
    })
    // Off by default, and the level field only exists while ducking is on.
    expect(duck).not.toBeChecked()
    expect(levelField()).toBeNull()

    await userEvent.click(duck)
    expect(duck).toBeChecked()
    // A plain toggle-on stores no level: the field shows the shared default.
    expect(levelField()).toHaveValue(DEFAULT_DUCK_LEVEL)

    const level = levelField()!
    await userEvent.clear(level)
    await userEvent.type(level, '0.5')
    await userEvent.tab()
    expect(level).toHaveValue(0.5)

    // Toggling off hides the field and restores the absent-as-default shape;
    // re-enabling starts from the default again rather than the old level.
    await userEvent.click(duck)
    expect(duck).not.toBeChecked()
    expect(levelField()).toBeNull()
    await userEvent.click(duck)
    expect(levelField()).toHaveValue(DEFAULT_DUCK_LEVEL)
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

    const lane = screen.getByRole('list', { name: 'Overlay layers' })
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

  it('offers the overlay button for clips with a picture, never for audio', async () => {
    // Video since #145, images since #294 — audio has no picture to layer.
    render(<App />)
    await importClip('cam.mp4', 8)
    await importAudioClip('song.mp3', 20)
    probeMock.mockResolvedValueOnce({
      duration: 0, url: 'blob:logo.png', kind: 'image', width: 640, height: 480,
    })
    await userEvent.upload(
      screen.getByTestId('clip-file-input'),
      new File(['content'], 'logo.png', { type: 'image/png' }),
    )
    await screen.findByText('logo.png')
    expect(screen.getByRole('button', { name: 'Add cam.mp4 as overlay' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add logo.png as overlay' })).toBeInTheDocument()
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
      within(screen.getByRole('list', { name: 'Overlay layers' })).getAllByRole('listitem'),
    ).toHaveLength(2)

    await userEvent.click(
      screen.getByRole('button', { name: 'Remove overlay cam.mp4 at position 1 from timeline' }),
    )
    await confirmRemoval()
    await userEvent.click(
      screen.getByRole('button', { name: 'Remove overlay cam.mp4 at position 1 from timeline' }),
    )
    await confirmRemoval()
    expect(screen.queryByRole('list', { name: 'Overlay layers' })).not.toBeInTheDocument()
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

    expect(screen.queryByRole('list', { name: 'Overlay layers' })).not.toBeInTheDocument()
    expect(sequenceNames()).toEqual(['base.mp4'])
  })
})

describe('undo/redo (#189)', () => {
  const undoButton = () => screen.getByRole('button', { name: 'Undo last timeline edit' })
  const redoButton = () => screen.getByRole('button', { name: 'Redo timeline edit' })

  it('undoes and redoes an edit via the toolbar buttons, enabling them only when usable', async () => {
    render(<App />)
    expect(undoButton()).toBeDisabled()
    expect(redoButton()).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Add color slate to timeline' }))
    expect(sequenceNames()).toEqual(['Color slate'])
    expect(undoButton()).toBeEnabled()
    expect(redoButton()).toBeDisabled()

    await userEvent.click(undoButton())
    expect(screen.queryByRole('list', { name: 'Sequence' })).not.toBeInTheDocument()
    expect(undoButton()).toBeDisabled()
    expect(redoButton()).toBeEnabled()

    await userEvent.click(redoButton())
    expect(sequenceNames()).toEqual(['Color slate'])
    expect(redoButton()).toBeDisabled()
  })

  it('treats one committed field edit as one undo step, and a new edit clears redo', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Add color slate to timeline' }))
    const duration = screen.getByRole('spinbutton', {
      name: 'Duration of Color slate at position 1 in seconds',
    })
    // Typing "12" is two keystrokes but commits on blur as a single action —
    // one undo returns straight to the pre-edit value.
    await userEvent.clear(duration)
    await userEvent.type(duration, '12')
    await userEvent.tab()
    expect(duration).toHaveValue(12)

    await userEvent.click(undoButton())
    expect(
      screen.getByRole('spinbutton', { name: 'Duration of Color slate at position 1 in seconds' }),
    ).toHaveValue(5)
    expect(redoButton()).toBeEnabled()

    // Diverging after the undo abandons the redo line.
    await userEvent.click(screen.getByRole('button', { name: 'Add text overlay to timeline' }))
    expect(redoButton()).toBeDisabled()
  })

  it('undoes with Ctrl+Z and redoes with Ctrl+Shift+Z and Ctrl+Y', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Add color slate to timeline' }))

    await userEvent.keyboard('{Control>}z{/Control}')
    expect(screen.queryByRole('list', { name: 'Sequence' })).not.toBeInTheDocument()

    await userEvent.keyboard('{Control>}{Shift>}z{/Shift}{/Control}')
    expect(sequenceNames()).toEqual(['Color slate'])

    await userEvent.keyboard('{Control>}z{/Control}')
    await userEvent.keyboard('{Control>}y{/Control}')
    expect(sequenceNames()).toEqual(['Color slate'])
  })

  it('leaves Ctrl+Z to the browser while a text-editing field has focus', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Add color slate to timeline' }))
    const duration = screen.getByRole('spinbutton', {
      name: 'Duration of Color slate at position 1 in seconds',
    })
    await userEvent.click(duration)
    await userEvent.keyboard('{Control>}z{/Control}')
    // The shortcut stayed native text undo: the timeline edit survives.
    expect(sequenceNames()).toEqual(['Color slate'])
  })

  it('clears the history when a used library clip is removed, so undo cannot resurrect it', async () => {
    render(<App />)
    await importClip('a.mp4', 30)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    expect(undoButton()).toBeEnabled()

    await userEvent.click(screen.getByRole('button', { name: 'Remove a.mp4 from library' }))
    await confirmRemoval()
    expect(screen.queryByRole('list', { name: 'Sequence' })).not.toBeInTheDocument()
    // The removed clip's states are unreachable — its object URL is revoked.
    expect(undoButton()).toBeDisabled()
    expect(redoButton()).toBeDisabled()
  })
})

describe('coverage bars and the sequence-scaled lane (#180)', () => {
  it('sequence entries render bars over their output intervals, per-kind colored', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    probeMock.mockResolvedValueOnce({
      duration: 0,
      url: 'blob:logo.png',
      kind: 'image',
      width: 64,
      height: 64,
    })
    await userEvent.upload(
      screen.getByTestId('clip-file-input'),
      new File(['content'], 'logo.png', { type: 'image/png' }),
    )
    await screen.findByText('logo.png')
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add logo.png to timeline' }))

    // 10s video then the 5s image still: span 15.
    const videoBar = screen.getByTestId('timeline-entry-bar-0')
    expect(videoBar.style.left).toBe('0%')
    expect(videoBar.style.width).toBe(`${(10 / 15) * 100}%`)
    expect(videoBar.className).toContain('timeline-entry-bar-video')
    const imageBar = screen.getByTestId('timeline-entry-bar-1')
    expect(imageBar.style.left).toBe(`${(10 / 15) * 100}%`)
    expect(imageBar.style.width).toBe(`${(5 / 15) * 100}%`)
    expect(imageBar.className).toContain('timeline-entry-bar-image')
  })

  it("a slate's bar uses the slate's own color as its swatch", async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Add color slate to timeline' }))
    const bar = screen.getByTestId('timeline-entry-bar-0')
    expect(bar.className).toContain('timeline-entry-bar-slate')
    // The default slate color (#143).
    expect(bar.style.background).toBe('rgb(255, 0, 0)')
    expect(bar.style.left).toBe('0%')
    expect(bar.style.width).toBe('100%')
  })

  it('a transition overlaps the neighbors: the later bar starts earlier by its duration', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await userEvent.click(
      screen.getByRole('button', { name: 'Add transition between position 1 and 2' }),
    )
    // 10 + 10 − 1 = 19s span; the second entry starts at 9.
    const second = screen.getByTestId('timeline-entry-bar-1')
    expect(second.style.left).toBe(`${(9 / 19) * 100}%`)
    expect(second.style.width).toBe(`${(10 / 19) * 100}%`)
  })

  it('text overlays render bars in their own color, clamped to the sequence end', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add text overlay to timeline' }))

    const start = screen.getByRole('spinbutton', {
      name: 'Start time of text overlay at position 1 in seconds',
    })
    await userEvent.clear(start)
    await userEvent.type(start, '8')
    await userEvent.tab()
    const duration = screen.getByRole('spinbutton', {
      name: 'Duration of text overlay at position 1 in seconds',
    })
    await userEvent.clear(duration)
    await userEvent.type(duration, '6')
    await userEvent.tab()

    // Window 8..14 against the 10s sequence: clamped to 8..10.
    const bar = screen.getByTestId('text-overlay-bar-0')
    expect(bar.className).toContain('text-overlay-bar')
    expect(bar.style.left).toBe('80%')
    expect(bar.style.width).toBe(`${(2 / 10) * 100}%`)
  })

  it("the customer's example: two 3-minute songs over a 4-minute video (#170)", async () => {
    render(<App />)
    await importClip('video.mp4', 240)
    await importAudioClip('song.mp3', 180)
    await userEvent.click(screen.getByRole('button', { name: 'Add video.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add song.mp3 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add song.mp3 to timeline' }))

    const secondStart = screen.getByRole('spinbutton', {
      name: 'Start time of audio track song.mp3 at position 2 in seconds',
    })
    await userEvent.clear(secondStart)
    await userEvent.type(secondStart, '180')
    await userEvent.tab()

    // First song covers the first 3/4; the second, starting at 3:00, is
    // clamped to the final 1/4 of the 4-minute video.
    const first = screen.getByTestId('audio-track-bar-0')
    expect(first.style.left).toBe('0%')
    expect(first.style.width).toBe('75%')
    const second = screen.getByTestId('audio-track-bar-1')
    expect(second.style.left).toBe('75%')
    expect(second.style.width).toBe('25%')
  })

  it('an item entirely past the sequence end renders a zero-width bar', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await importAudioClip('music.mp3', 5)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add music.mp3 to timeline' }))

    const start = screen.getByRole('spinbutton', {
      name: 'Start time of audio track music.mp3 at position 1 in seconds',
    })
    await userEvent.clear(start)
    await userEvent.type(start, '12')
    await userEvent.tab()
    expect(start).toHaveValue(12)

    const bar = screen.getByTestId('audio-track-bar-0')
    expect(bar.style.width).toBe('0%')
    // The 2px visibility minimum must not resurrect an item that never plays.
    expect(bar.style.minWidth).toBe('0px')
  })

  it('with no sequence entries nothing plays: every bar is empty, rows stay intact', async () => {
    render(<App />)
    await importAudioClip('music.mp3', 30)
    await userEvent.click(screen.getByRole('button', { name: 'Add music.mp3 to timeline' }))

    const bar = screen.getByTestId('audio-track-bar-0')
    expect(bar.style.width).toBe('0%')
    // The track's row and controls are unaffected.
    expect(
      screen.getByRole('spinbutton', {
        name: 'Trim out point of audio track music.mp3 at position 1 in seconds',
      }),
    ).toHaveValue(30)
  })
})

describe('color adjustments (#192)', () => {
  const brightnessField = (position: string) =>
    screen.getByRole('spinbutton', { name: `Brightness of ${position} (percent)` })
  const commitField = async (field: HTMLElement, value: string) => {
    await userEvent.clear(field)
    await userEvent.type(field, value)
    await userEvent.tab()
  }

  it('shows the color row at identity for a video entry and applies edits to the preview', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))

    const position = 'a.mp4 at position 1'
    const brightness = brightnessField(position)
    expect(brightness).toHaveValue(100)
    // Identity means nothing to reset, and no filter on the preview element.
    expect(screen.getByRole('button', { name: `Reset color of ${position}` })).toBeDisabled()
    expect(screen.getByTestId('preview-video').style.filter).toBe('')

    await commitField(brightness, '150')
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: `Look of ${position}` }),
      'sepia',
    )
    expect(brightness).toHaveValue(150)
    // The preview element carries the shared filter string (#66 pattern).
    expect(screen.getByTestId('preview-video').style.filter).toBe('brightness(150%) sepia(100%)')
    expect(screen.getByRole('button', { name: `Reset color of ${position}` })).toBeEnabled()
  })

  it('clamps out-of-range dials visibly, like other fields', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))

    const brightness = brightnessField('a.mp4 at position 1')
    await commitField(brightness, '400')
    expect(brightness).toHaveValue(200)
    expect(screen.getByTestId('preview-video').style.filter).toBe('brightness(200%)')
  })

  it('reset returns every dial and the look to identity', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))

    const position = 'a.mp4 at position 1'
    await commitField(brightnessField(position), '80')
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: `Look of ${position}` }),
      'grayscale',
    )
    await userEvent.click(screen.getByRole('button', { name: `Reset color of ${position}` }))

    expect(brightnessField(position)).toHaveValue(100)
    expect(screen.getByRole('combobox', { name: `Look of ${position}` })).toHaveValue('none')
    expect(screen.getByRole('button', { name: `Reset color of ${position}` })).toBeDisabled()
    expect(screen.getByTestId('preview-video').style.filter).toBe('')
  })

  it('offers no color row for a slate — its color is set directly (#143)', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Add color slate to timeline' }))
    expect(
      screen.queryByRole('spinbutton', { name: /Brightness of Color slate/ }),
    ).not.toBeInTheDocument()
  })

  it('adjusts a video overlay and filters its preview element', async () => {
    render(<App />)
    await importClip('base.mp4', 10)
    await importClip('cam.mp4', 8)
    await userEvent.click(screen.getByRole('button', { name: 'Add base.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add cam.mp4 as overlay' }))

    const position = 'overlay cam.mp4 at position 1'
    const saturation = screen.getByRole('spinbutton', { name: `Saturation of ${position} (percent)` })
    await commitField(saturation, '0')
    expect(saturation).toHaveValue(0)
    expect(screen.getByTestId('preview-overlay-0').style.filter).toBe('saturate(0%)')

    await userEvent.click(screen.getByRole('button', { name: `Reset color of ${position}` }))
    expect(screen.getByTestId('preview-overlay-0').style.filter).toBe('')
  })

  it('color edits participate in undo/redo like any timeline edit (#189)', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))

    const position = 'a.mp4 at position 1'
    await commitField(brightnessField(position), '150')
    expect(brightnessField(position)).toHaveValue(150)

    await userEvent.click(screen.getByRole('button', { name: 'Undo last timeline edit' }))
    expect(brightnessField(position)).toHaveValue(100)
    await userEvent.click(screen.getByRole('button', { name: 'Redo timeline edit' }))
    expect(brightnessField(position)).toHaveValue(150)
  })
})

describe('entry and overlay waveforms (#230)', () => {
  it('draws the audio amplitude in a video entry bar, but not for a slate', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add color slate to timeline' }))

    const waveform = await screen.findByTestId('timeline-entry-waveform-0')
    expect(screen.getByTestId('timeline-entry-bar-0')).toContainElement(waveform)
    expect(waveform.querySelector('path')?.getAttribute('d')).toMatch(/^M0 1L.*Z$/)
    // The slate is soundless: its bar stays a plain swatch.
    expect(screen.queryByTestId('timeline-entry-waveform-1')).not.toBeInTheDocument()
  })

  it('windows the waveform to the entry trim, like an audio track', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    const outField = screen.getByRole('spinbutton', {
      name: 'Trim out point of a.mp4 at position 1 in seconds',
    })
    await userEvent.clear(outField)
    await userEvent.type(outField, '5')
    fireEvent.blur(outField)

    // Two of the four mocked peak buckets survive the [0, 5] window of 10s.
    const waveform = await screen.findByTestId('timeline-entry-waveform-0')
    expect(waveform.getAttribute('viewBox')).toBe('0 0 2 2')
  })

  it('draws the audio amplitude in an overlay bar', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 as overlay' }))

    const waveform = await screen.findByTestId('video-overlay-waveform-0')
    expect(screen.getByTestId('video-overlay-bar-0')).toContainElement(waveform)
  })
})

describe('orientation (#232)', () => {
  const rotateButton = (position: string, degrees: number) =>
    screen.getByRole('button', {
      name: `Rotate ${position} 90 degrees clockwise (currently ${degrees} degrees)`,
    })

  it('shows the orientation row at identity and applies edits to the preview', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))

    const position = 'a.mp4 at position 1'
    // Identity: nothing to reset, no transform on the preview media element.
    expect(screen.getByRole('button', { name: `Reset orientation of ${position}` })).toBeDisabled()
    expect((screen.getByTestId('preview-video') as HTMLElement).style.transform).toBe('')

    await userEvent.click(rotateButton(position, 0))
    await userEvent.click(screen.getByRole('checkbox', { name: `Flip ${position} horizontally` }))
    // The preview media element carries the shared transform rule (#66
    // pattern): quarter turn = swapped box, centred, rotated; flip rides it.
    expect((screen.getByTestId('preview-video') as HTMLElement).style.transform).toBe(
      'translate(-50%, -50%) rotate(90deg) scale(-1, 1)',
    )
    expect(rotateButton(position, 90)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `Reset orientation of ${position}` })).toBeEnabled()
  })

  it('the rotate button cycles the quarter turns back to 0', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))

    const position = 'a.mp4 at position 1'
    await userEvent.click(rotateButton(position, 0))
    await userEvent.click(rotateButton(position, 90))
    await userEvent.click(rotateButton(position, 180))
    expect((screen.getByTestId('preview-video') as HTMLElement).style.transform).toBe(
      'translate(-50%, -50%) rotate(270deg)',
    )
    await userEvent.click(rotateButton(position, 270))
    // Back to identity — stored as no key, so reset has nothing to do.
    expect((screen.getByTestId('preview-video') as HTMLElement).style.transform).toBe('')
    expect(screen.getByRole('button', { name: `Reset orientation of ${position}` })).toBeDisabled()
  })

  it('reset returns the rotation and flips to identity', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))

    const position = 'a.mp4 at position 1'
    await userEvent.click(rotateButton(position, 0))
    await userEvent.click(screen.getByRole('checkbox', { name: `Flip ${position} vertically` }))
    await userEvent.click(screen.getByRole('button', { name: `Reset orientation of ${position}` }))
    expect((screen.getByTestId('preview-video') as HTMLElement).style.transform).toBe('')
    expect(screen.getByRole('checkbox', { name: `Flip ${position} vertically` })).not.toBeChecked()
    expect(rotateButton(position, 0)).toBeInTheDocument()
  })

  it('offers no orientation row for a slate', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Add color slate to timeline' }))
    expect(
      screen.queryByRole('button', { name: /Rotate Color slate at position 1/ }),
    ).not.toBeInTheDocument()
  })

  it('orients an overlay row and undoes like any timeline edit (#189)', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await importClip('cam.mp4', 8)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add cam.mp4 as overlay' }))

    const position = 'overlay cam.mp4 at position 1'
    await userEvent.click(rotateButton(position, 0))
    await userEvent.click(rotateButton(position, 90))
    expect((screen.getByTestId('preview-overlay-0') as HTMLElement).style.transform).toBe(
      'rotate(180deg)',
    )
    // Undoable like every timeline edit: one step back to the quarter turn.
    await userEvent.click(screen.getByRole('button', { name: 'Undo last timeline edit' }))
    expect(rotateButton(position, 90)).toBeInTheDocument()
  })
})

describe('subtitle import (#249)', () => {
  const srtFile = (content: string, name = 'captions.srt') =>
    new File([content], name, { type: 'application/x-subrip' })

  const importSrt = async (content: string, name?: string) => {
    await userEvent.upload(screen.getByTestId('subtitle-file-input'), srtFile(content, name))
  }

  const textList = () => screen.getByRole('list', { name: 'Text overlays' })

  it('imports each cue as a text overlay, timed and marked, in one undoable edit', async () => {
    render(<App />)
    await importSrt(
      '1\n00:00:01,000 --> 00:00:02,500\nHello there\n\n2\n00:00:03,000 --> 00:00:04,000\n<i>Second</i> cue\n',
    )

    // Both cues landed as ordinary overlays: content editable in the text
    // lane, timing from the cue, markup stripped.
    const items = within(await screen.findByRole('list', { name: 'Text overlays' })).getAllByRole(
      'listitem',
    )
    expect(items).toHaveLength(2)
    expect(
      screen.getByRole('textbox', { name: 'Content of text overlay at position 1' }),
    ).toHaveValue('Hello there')
    expect(
      screen.getByRole('textbox', { name: 'Content of text overlay at position 2' }),
    ).toHaveValue('Second cue')
    expect(
      screen.getByRole('spinbutton', { name: 'Start time of text overlay at position 1 in seconds' }),
    ).toHaveValue(1)
    expect(
      screen.getByRole('spinbutton', { name: 'Duration of text overlay at position 1 in seconds' }),
    ).toHaveValue(1.5)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    // The whole import is one edit: a single undo removes every cue.
    await userEvent.click(screen.getByRole('button', { name: 'Undo last timeline edit' }))
    expect(screen.queryByRole('list', { name: 'Text overlays' })).not.toBeInTheDocument()
  })

  it('reports a file with no usable cues in the failure list, adding nothing', async () => {
    render(<App />)
    await importSrt('this is not an srt file at all', 'notes.srt')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No subtitle cues found in "notes.srt".',
    )
    expect(screen.queryByRole('list', { name: 'Text overlays' })).not.toBeInTheDocument()
  })

  it('imports the good cues and reports the skipped blocks', async () => {
    render(<App />)
    await importSrt(
      '1\n00:00:01,000 --> 00:00:02,000\nGood cue\n\n2\nno timing here\n\n3\n00:00:05,000 --> 00:00:04,000\ninverted\n',
    )

    expect(
      within(await screen.findByRole('list', { name: 'Text overlays' })).getAllByRole('listitem'),
    ).toHaveLength(1)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Imported 1 subtitle from "captions.srt"')
    expect(alert).toHaveTextContent('skipped 2 cue blocks')
    expect(alert).toHaveTextContent('block 2 has no timing line')
    expect(alert).toHaveTextContent('block 3 ends at or before its start')
  })

  it('keeps the subtitle marker across an individual edit and a save round-trip', async () => {
    // The marker (#249) is what the default-subtitle-style work (#250) will
    // target: editing one overlay's content must not strip it. Provenance
    // is asserted through persistence (the UI shows no marker), so the
    // fixture saves and the written file is deserialized.
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
    render(<App savePort={port} />)
    await importSrt('1\n00:00:01,000 --> 00:00:02,000\nBefore edit\n')
    const content = await screen.findByRole('textbox', {
      name: 'Content of text overlay at position 1',
    })
    await userEvent.clear(content)
    await userEvent.type(content, 'After edit')
    fireEvent.blur(content)
    expect(textList()).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Save (unsaved changes)' }))
    const dialog = await screen.findByRole('dialog', { name: 'Save project' })
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Store references only' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save…' }))
    await screen.findByText('Saved as project.bvep')

    expect(writes).toHaveLength(1)
    const saved = await deserializeProject(writes[0])
    expect(saved.ok).toBe(true)
    if (saved.ok) {
      expect(saved.project.timeline.texts).toHaveLength(1)
      expect(saved.project.timeline.texts?.[0]).toMatchObject({
        content: 'After edit',
        subtitle: true,
      })
    }
  })
})

describe('crop (#255)', () => {
  const cropField = (edge: string, position: string) =>
    screen.getByRole('spinbutton', { name: `Crop ${edge} of ${position} (percent)` })
  const commitField = async (field: HTMLElement, value: string) => {
    await userEvent.clear(field)
    await userEvent.type(field, value)
    await userEvent.tab()
  }

  it('shows the crop row at identity and stores committed edges', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))

    const position = 'a.mp4 at position 1'
    // Identity: all edges zero, nothing to reset.
    expect(cropField('left', position)).toHaveValue(0)
    expect(screen.getByRole('button', { name: `Reset crop of ${position}` })).toBeDisabled()

    await commitField(cropField('left', position), '25')
    await commitField(cropField('top', position), '10')
    expect(cropField('left', position)).toHaveValue(25)
    expect(cropField('top', position)).toHaveValue(10)
    expect(screen.getByRole('button', { name: `Reset crop of ${position}` })).toBeEnabled()
  })

  it('an over-deep pair snaps back to the clamped stored state — the clamp is visible', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))

    const position = 'a.mp4 at position 1'
    await commitField(cropField('left', position), '60')
    await commitField(cropField('right', position), '50')
    // The reducer keeps at least 10% of the axis; the fields show the
    // proportionally scaled stored values, not the typed ones.
    const left = Number((cropField('left', position) as HTMLInputElement).value)
    const right = Number((cropField('right', position) as HTMLInputElement).value)
    expect(left + right).toBeCloseTo(90, 1)
    expect(left / right).toBeCloseTo(60 / 50, 2)
  })

  it('reset returns every edge to zero, and undo steps the edit back (#189)', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))

    const position = 'a.mp4 at position 1'
    await commitField(cropField('bottom', position), '30')
    await userEvent.click(screen.getByRole('button', { name: `Reset crop of ${position}` }))
    expect(cropField('bottom', position)).toHaveValue(0)
    expect(screen.getByRole('button', { name: `Reset crop of ${position}` })).toBeDisabled()
    // Undoable like every timeline edit: one step back to the cropped state.
    await userEvent.click(screen.getByRole('button', { name: 'Undo last timeline edit' }))
    expect(cropField('bottom', position)).toHaveValue(30)
  })

  it('offers no crop row for a slate', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Add color slate to timeline' }))
    expect(
      screen.queryByRole('spinbutton', { name: /Crop left of Color slate/ }),
    ).not.toBeInTheDocument()
  })

  it('crops an overlay row independently of the base entry', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await importClip('cam.mp4', 8)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add cam.mp4 as overlay' }))

    const overlayPosition = 'overlay cam.mp4 at position 1'
    await commitField(cropField('top', overlayPosition), '15')
    expect(cropField('top', overlayPosition)).toHaveValue(15)
    // The base entry's crop row is untouched.
    expect(cropField('top', 'a.mp4 at position 1')).toHaveValue(0)
  })
})

describe('default subtitle style (#250)', () => {
  const srtFile = (content: string, name = 'captions.srt') =>
    new File([content], name, { type: 'application/x-subrip' })
  const importSrt = async (content: string, name?: string) => {
    await userEvent.upload(screen.getByTestId('subtitle-file-input'), srtFile(content, name))
  }
  const TWO_CUES =
    '1\n00:00:01,000 --> 00:00:02,000\nFirst cue\n\n2\n00:00:03,000 --> 00:00:04,000\nSecond cue\n'

  it('editing the default restyles every imported subtitle at once, not hand-made text, undoably', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Add text overlay to timeline' }))
    await importSrt(TWO_CUES)
    await screen.findByRole('textbox', { name: 'Content of text overlay at position 3' })

    fireEvent.change(screen.getByLabelText('Default subtitle color'), {
      target: { value: '#ffff00' },
    })

    // The hand-made title (position 1) keeps its color; both cues follow.
    expect(screen.getByLabelText('Color of text overlay at position 1')).toHaveValue('#ffffff')
    expect(screen.getByLabelText('Color of text overlay at position 2')).toHaveValue('#ffff00')
    expect(screen.getByLabelText('Color of text overlay at position 3')).toHaveValue('#ffff00')

    // One undo returns both cues to the previous style (#189).
    await userEvent.click(screen.getByRole('button', { name: 'Undo last timeline edit' }))
    expect(screen.getByLabelText('Color of text overlay at position 2')).toHaveValue('#ffffff')
    expect(screen.getByLabelText('Color of text overlay at position 3')).toHaveValue('#ffffff')
  })

  it('an individually restyled cue keeps its value when the default changes later', async () => {
    render(<App />)
    await importSrt(TWO_CUES)
    await screen.findByRole('textbox', { name: 'Content of text overlay at position 1' })

    // The user pins cue 1's color by editing it directly…
    fireEvent.change(screen.getByLabelText('Color of text overlay at position 1'), {
      target: { value: '#ff0000' },
    })
    // …then restyles the default font and color.
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Default subtitle font' }), 'serif')
    fireEvent.change(screen.getByLabelText('Default subtitle color'), {
      target: { value: '#ffff00' },
    })

    // The pinned color survives; the unpinned font still follows; cue 2
    // follows entirely.
    expect(screen.getByLabelText('Color of text overlay at position 1')).toHaveValue('#ff0000')
    expect(screen.getByRole('combobox', { name: 'Font of text overlay at position 1' })).toHaveValue('serif')
    expect(screen.getByLabelText('Color of text overlay at position 2')).toHaveValue('#ffff00')
    expect(screen.getByRole('combobox', { name: 'Font of text overlay at position 2' })).toHaveValue('serif')
  })

  it('a customized default styles later imports, and Reset returns everything to the standard', async () => {
    render(<App />)
    const reset = screen.getByRole('button', { name: 'Reset default subtitle style' })
    expect(reset).toBeDisabled()

    // Customize before any subtitles exist — the next import takes it.
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Default subtitle font' }), 'serif')
    expect(reset).toBeEnabled()
    await importSrt('1\n00:00:01,000 --> 00:00:02,000\nStyled on arrival\n')
    expect(
      await screen.findByRole('combobox', { name: 'Font of text overlay at position 1' }),
    ).toHaveValue('serif')

    await userEvent.click(reset)
    expect(reset).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Font of text overlay at position 1' })).toHaveValue('sans')
    expect(screen.getByRole('combobox', { name: 'Default subtitle font' })).toHaveValue('sans')
  })
})

describe('background fill (#259)', () => {
  const fillSelect = (position: string) =>
    screen.getByRole('combobox', { name: `Background fill of ${position}` })
  const fillColor = (position: string) =>
    screen.getByLabelText(`Background fill color of ${position}`) as HTMLInputElement

  it('defaults to None, stores Blur, and undo steps the edit back (#189)', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))

    const position = 'a.mp4 at position 1'
    expect(fillSelect(position)).toHaveValue('none')
    await userEvent.selectOptions(fillSelect(position), 'blur')
    expect(fillSelect(position)).toHaveValue('blur')
    await userEvent.click(screen.getByRole('button', { name: 'Undo last timeline edit' }))
    expect(fillSelect(position)).toHaveValue('none')
  })

  it('Color shows the color input, commits edits, and None hides it again', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))

    const position = 'a.mp4 at position 1'
    expect(screen.queryByLabelText(`Background fill color of ${position}`)).not.toBeInTheDocument()
    await userEvent.selectOptions(fillSelect(position), 'color')
    // Picking Color commits the default color immediately.
    expect(fillColor(position).value).toBe('#000000')
    fireEvent.change(fillColor(position), { target: { value: '#2244aa' } })
    expect(fillColor(position).value).toBe('#2244aa')
    await userEvent.selectOptions(fillSelect(position), 'none')
    expect(screen.queryByLabelText(`Background fill color of ${position}`)).not.toBeInTheDocument()
  })

  it('offers no background-fill row for a slate', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Add color slate to timeline' }))
    expect(
      screen.queryByRole('combobox', { name: /Background fill of Color slate/ }),
    ).not.toBeInTheDocument()
  })

  it('fills an image entry independently of other rows', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await importClip('b.mp4', 8)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add b.mp4 to timeline' }))

    await userEvent.selectOptions(fillSelect('a.mp4 at position 1'), 'blur')
    expect(fillSelect('a.mp4 at position 1')).toHaveValue('blur')
    expect(fillSelect('b.mp4 at position 2')).toHaveValue('none')
  })
})

describe('overlay shape mask (#266)', () => {
  const maskSelect = (position: string) =>
    screen.getByRole('combobox', { name: `Shape mask of ${position}` })
  const radiusField = (position: string) =>
    screen.getByRole('spinbutton', { name: `Corner radius of ${position} (percent)` })
  const addOverlay = async () => {
    render(<App />)
    await importClip('cam.mp4', 8)
    await userEvent.click(screen.getByRole('button', { name: 'Add cam.mp4 as overlay' }))
    return 'overlay cam.mp4 at position 1'
  }

  it('defaults to Rectangle, stores Ellipse, and undo steps the edit back (#189)', async () => {
    const position = await addOverlay()
    expect(maskSelect(position)).toHaveValue('rectangle')
    await userEvent.selectOptions(maskSelect(position), 'ellipse')
    expect(maskSelect(position)).toHaveValue('ellipse')
    await userEvent.click(screen.getByRole('button', { name: 'Undo last timeline edit' }))
    expect(maskSelect(position)).toHaveValue('rectangle')
  })

  it('Rounded shows the radius amount, commits edits, and Rectangle hides it again', async () => {
    const position = await addOverlay()
    expect(
      screen.queryByRole('spinbutton', { name: `Corner radius of ${position} (percent)` }),
    ).not.toBeInTheDocument()
    await userEvent.selectOptions(maskSelect(position), 'rounded')
    // Picking Rounded commits the default radius immediately.
    expect(radiusField(position)).toHaveValue(15)
    const field = radiusField(position)
    await userEvent.clear(field)
    await userEvent.type(field, '30')
    await userEvent.tab()
    expect(radiusField(position)).toHaveValue(30)
    await userEvent.selectOptions(maskSelect(position), 'rectangle')
    expect(
      screen.queryByRole('spinbutton', { name: `Corner radius of ${position} (percent)` }),
    ).not.toBeInTheDocument()
  })

  it('a radius edited to zero resets the mask to the rectangle', async () => {
    const position = await addOverlay()
    await userEvent.selectOptions(maskSelect(position), 'rounded')
    const field = radiusField(position)
    await userEvent.clear(field)
    await userEvent.type(field, '0')
    await userEvent.tab()
    // Zero rounds nothing — the reducer normalizes it to no mask at all.
    expect(maskSelect(position)).toHaveValue('rectangle')
  })

  it('offers no shape-mask control on sequence entry rows', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    expect(
      screen.queryByRole('combobox', { name: /Shape mask of a\.mp4/ }),
    ).not.toBeInTheDocument()
  })
})

describe('collapsible timeline elements (#299)', () => {
  const toggle = (position: string, state: 'Collapse' | 'Expand') =>
    screen.getByRole('button', { name: `${state} ${position}` })
  const trimIn = (position: string) =>
    screen.queryByRole('spinbutton', { name: `Trim in point of ${position} in seconds` })
  const startTime = (position: string) =>
    screen.queryByRole('spinbutton', { name: `Start time of ${position} in seconds` })

  it('titles the main section "Sequence" like the other lanes', async () => {
    render(<App />)
    expect(screen.queryByRole('heading', { name: 'Sequence' })).toBeNull()
    await importClip('a.mp4', 10)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    expect(screen.getByRole('heading', { level: 3, name: 'Sequence' })).toBeInTheDocument()
  })

  it('collapses a sequence entry to its strip and main line, keeping the bar geometry, and expands it back', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    const position = 'a.mp4 at position 1'
    const barStyle = () => screen.getByTestId('timeline-entry-bar-0').getAttribute('style')
    const expandedStyle = barStyle()

    expect(toggle(position, 'Collapse')).toHaveAttribute('aria-expanded', 'true')
    expect(trimIn(position)).toBeInTheDocument()
    await userEvent.click(toggle(position, 'Collapse'))

    // Controls gone; the strip, name, and remove button remain.
    expect(trimIn(position)).toBeNull()
    expect(screen.queryByRole('spinbutton', { name: `Volume of ${position} (0 to 1)` })).toBeNull()
    expect(screen.getByTestId('timeline-entry-bar-0')).toBeInTheDocument()
    expect(barStyle()).toBe(expandedStyle)
    expect(sequenceNames()).toEqual(['a.mp4'])
    expect(
      screen.getByRole('button', { name: `Remove ${position} from timeline` }),
    ).toBeInTheDocument()
    expect(toggle(position, 'Expand')).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(toggle(position, 'Expand'))
    expect(trimIn(position)).toBeInTheDocument()
  })

  it('collapsing is not an edit: no undo step, and the one real edit still undoes', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await userEvent.click(toggle('a.mp4 at position 1', 'Collapse'))
    // One undo removes the add — collapsing pushed nothing in between.
    await userEvent.click(screen.getByRole('button', { name: 'Undo last timeline edit' }))
    expect(screen.queryByRole('list', { name: 'Sequence' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Undo last timeline edit' })).toBeDisabled()
  })

  it('collapses audio tracks, overlays, and text overlays too', async () => {
    render(<App />)
    await importClip('v.mp4', 10)
    await importAudioClip('m.mp3', 8)
    await userEvent.click(screen.getByRole('button', { name: 'Add m.mp3 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add v.mp4 as overlay' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add text overlay to timeline' }))

    const audio = 'audio track m.mp3 at position 1'
    const overlay = 'overlay v.mp4 at position 1'
    const text = 'text overlay at position 1'
    expect(startTime(audio)).toBeInTheDocument()
    expect(startTime(overlay)).toBeInTheDocument()
    expect(startTime(text)).toBeInTheDocument()

    await userEvent.click(toggle(audio, 'Collapse'))
    await userEvent.click(toggle(overlay, 'Collapse'))
    await userEvent.click(toggle(text, 'Collapse'))
    expect(startTime(audio)).toBeNull()
    expect(startTime(overlay)).toBeNull()
    expect(startTime(text)).toBeNull()
    // Main lines survive: the audio name, the overlay name, the text content.
    expect(screen.getByRole('list', { name: 'Audio tracks' })).toHaveTextContent('m.mp3')
    expect(screen.getByRole('list', { name: 'Overlay layers' })).toHaveTextContent('v.mp4')
    // A collapsed text overlay shows its content on one line instead of the editor.
    expect(screen.queryByRole('textbox', { name: `Content of ${text}` })).toBeNull()
    expect(screen.getByRole('list', { name: 'Text overlays' })).toHaveTextContent('Title')
    // Coverage strips stay.
    expect(screen.getByTestId('audio-track-bar-0')).toBeInTheDocument()
    expect(screen.getByTestId('text-overlay-bar-0')).toBeInTheDocument()

    await userEvent.click(toggle(overlay, 'Expand'))
    expect(startTime(overlay)).toBeInTheDocument()
  })

  it('Collapse all and Expand all act on every lane at once', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await importAudioClip('m.mp3', 8)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add m.mp3 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add text overlay to timeline' }))

    await userEvent.click(screen.getByRole('button', { name: 'Collapse all timeline elements' }))
    expect(trimIn('a.mp4 at position 1')).toBeNull()
    expect(startTime('audio track m.mp3 at position 1')).toBeNull()
    expect(startTime('text overlay at position 1')).toBeNull()
    // Since #300 the timeline-wide Collapse all also folds every rendered
    // section, so what remains is one folded heading per populated lane.
    expect(
      screen.getAllByRole('button', { name: /^Expand (Sequence|Audio|Text) section$/ }),
    ).toHaveLength(3)

    await userEvent.click(screen.getByRole('button', { name: 'Expand all timeline elements' }))
    expect(trimIn('a.mp4 at position 1')).toBeInTheDocument()
    expect(startTime('audio track m.mp3 at position 1')).toBeInTheDocument()
    expect(startTime('text overlay at position 1')).toBeInTheDocument()
  })

  it('an element removed while collapsed comes back expanded via undo', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    const position = 'a.mp4 at position 1'
    await userEvent.click(toggle(position, 'Collapse'))
    await userEvent.click(screen.getByRole('button', { name: `Remove ${position} from timeline` }))
    await confirmRemoval()
    expect(screen.queryByRole('list', { name: 'Sequence' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Undo last timeline edit' }))
    expect(toggle(position, 'Collapse')).toHaveAttribute('aria-expanded', 'true')
    expect(trimIn(position)).toBeInTheDocument()
  })
})

describe('section-level collapse (#300)', () => {
  const trimIn = (position: string) =>
    screen.queryByRole('spinbutton', { name: `Trim in point of ${position} in seconds` })
  const startTime = (position: string) =>
    screen.queryByRole('spinbutton', { name: `Start time of ${position} in seconds` })
  const list = (name: string) => screen.queryByRole('list', { name })
  const fold = (title: string) => screen.getByRole('button', { name: `Collapse ${title} section` })
  const unfold = (title: string) => screen.getByRole('button', { name: `Expand ${title} section` })

  /** One element in every lane: a clip, an audio track, an overlay, a text. */
  const populateEveryLane = async () => {
    await importClip('a.mp4', 10)
    await importAudioClip('m.mp3', 8)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add m.mp3 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 as overlay' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add text overlay to timeline' }))
  }

  it('every rendered section heading offers fold/unfold and its own Collapse all / Expand all', async () => {
    render(<App />)
    await populateEveryLane()

    for (const title of ['Sequence', 'Audio', 'Overlays', 'Text']) {
      expect(screen.getByRole('heading', { level: 3, name: title })).toBeInTheDocument()
      expect(fold(title)).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByRole('button', { name: `Collapse all ${title} elements` })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: `Expand all ${title} elements` })).toBeInTheDocument()
    }
  })

  it('folding hides the section list and unfolding restores each element as it was', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await importClip('b.mp4', 6)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add b.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Collapse a.mp4 at position 1' }))
    expect(trimIn('a.mp4 at position 1')).toBeNull()
    expect(trimIn('b.mp4 at position 2')).toBeInTheDocument()

    await userEvent.click(fold('Sequence'))
    // The list is gone; the heading and its toggle remain.
    expect(list('Sequence')).toBeNull()
    expect(screen.getByRole('heading', { level: 3, name: 'Sequence' })).toBeInTheDocument()
    expect(unfold('Sequence')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('timeline-entry-bar-0')).toBeNull()

    await userEvent.click(unfold('Sequence'))
    expect(sequenceNames()).toEqual(['a.mp4', 'b.mp4'])
    // The one collapsed element is still collapsed, the other still expanded.
    expect(trimIn('a.mp4 at position 1')).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Expand a.mp4 at position 1' }),
    ).toHaveAttribute('aria-expanded', 'false')
    expect(trimIn('b.mp4 at position 2')).toBeInTheDocument()
  })

  it("a section's Collapse all / Expand all touch only that section's elements", async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await importAudioClip('m.mp3', 8)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add m.mp3 to timeline' }))
    const clip = 'a.mp4 at position 1'
    const audio = 'audio track m.mp3 at position 1'

    await userEvent.click(screen.getByRole('button', { name: 'Collapse all Sequence elements' }))
    expect(trimIn(clip)).toBeNull()
    expect(startTime(audio)).toBeInTheDocument()
    // Neither section folded — only elements were collapsed.
    expect(list('Sequence')).toBeInTheDocument()
    expect(fold('Sequence')).toHaveAttribute('aria-expanded', 'true')

    await userEvent.click(screen.getByRole('button', { name: 'Collapse all Audio elements' }))
    expect(startTime(audio)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Expand all Sequence elements' }))
    expect(trimIn(clip)).toBeInTheDocument()
    expect(startTime(audio)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Expand all Audio elements' }))
    expect(startTime(audio)).toBeInTheDocument()
  })

  it('timeline-wide Collapse all folds every section and collapses every element; Expand all restores everything', async () => {
    render(<App />)
    await populateEveryLane()

    await userEvent.click(screen.getByRole('button', { name: 'Collapse all timeline elements' }))
    for (const name of ['Sequence', 'Audio tracks', 'Overlay layers', 'Text overlays']) {
      expect(list(name)).toBeNull()
    }
    for (const title of ['Sequence', 'Audio', 'Overlays', 'Text']) {
      expect(screen.getByRole('heading', { level: 3, name: title })).toBeInTheDocument()
      expect(unfold(title)).toHaveAttribute('aria-expanded', 'false')
    }
    // Unfolding one section shows its elements collapsed, not expanded.
    await userEvent.click(unfold('Audio'))
    expect(list('Audio tracks')).toBeInTheDocument()
    expect(startTime('audio track m.mp3 at position 1')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Expand all timeline elements' }))
    for (const name of ['Sequence', 'Audio tracks', 'Overlay layers', 'Text overlays']) {
      expect(list(name)).toBeInTheDocument()
    }
    expect(trimIn('a.mp4 at position 1')).toBeInTheDocument()
    expect(startTime('audio track m.mp3 at position 1')).toBeInTheDocument()
    expect(startTime('overlay a.mp4 at position 1')).toBeInTheDocument()
    expect(startTime('text overlay at position 1')).toBeInTheDocument()
    expect(fold('Text')).toHaveAttribute('aria-expanded', 'true')
  })

  it('folding and per-section collapsing are not edits: one Undo still removes the add', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Collapse all Sequence elements' }))
    await userEvent.click(fold('Sequence'))
    await userEvent.click(unfold('Sequence'))
    await userEvent.click(screen.getByRole('button', { name: 'Undo last timeline edit' }))
    expect(list('Sequence')).toBeNull()
    expect(screen.getByRole('button', { name: 'Undo last timeline edit' })).toBeDisabled()
  })

  it('a lane created after timeline-wide Collapse all arrives unfolded, showing what was just added', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    // No audio lane exists yet, so Collapse all has no Audio section to fold.
    expect(screen.queryByRole('heading', { level: 3, name: 'Audio' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Collapse all timeline elements' }))
    expect(unfold('Sequence')).toHaveAttribute('aria-expanded', 'false')

    // The user now adds their first audio track: it must be visible, not
    // hidden behind a fold left over from a section that did not exist.
    await importAudioClip('m.mp3', 8)
    await userEvent.click(screen.getByRole('button', { name: 'Add m.mp3 to timeline' }))
    expect(list('Audio tracks')).toBeInTheDocument()
    expect(fold('Audio')).toHaveAttribute('aria-expanded', 'true')
    expect(startTime('audio track m.mp3 at position 1')).toBeInTheDocument()
    // The Sequence fold, applied to a section that was rendered, is untouched.
    expect(unfold('Sequence')).toHaveAttribute('aria-expanded', 'false')
  })

  it('a section that disappears while folded comes back unfolded', async () => {
    render(<App />)
    await importAudioClip('m.mp3', 8)
    await userEvent.click(screen.getByRole('button', { name: 'Add m.mp3 to timeline' }))
    await userEvent.click(fold('Audio'))
    expect(list('Audio tracks')).toBeNull()

    // The folded row's own Remove is not rendered; removing the clip from
    // the library cascades to the track and empties the lane.
    await userEvent.click(screen.getByRole('button', { name: 'Remove m.mp3 from library' }))
    await confirmRemoval()
    expect(screen.queryByRole('heading', { level: 3, name: 'Audio' })).toBeNull()

    await importAudioClip('m.mp3', 8)
    await userEvent.click(screen.getByRole('button', { name: 'Add m.mp3 to timeline' }))
    expect(list('Audio tracks')).toBeInTheDocument()
    expect(fold('Audio')).toHaveAttribute('aria-expanded', 'true')
  })
})

describe('duplicate a timeline element (#314)', () => {
  it('duplicates a sequence entry right after the original, carrying its trim, as one undo step', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await importClip('b.mp4', 20)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add b.mp4 to timeline' }))
    const outField = screen.getByRole('spinbutton', {
      name: 'Trim out point of a.mp4 at position 1 in seconds',
    })
    fireEvent.change(outField, { target: { value: '5' } })
    fireEvent.blur(outField)

    await userEvent.click(
      screen.getByRole('button', { name: 'Duplicate a.mp4 at position 1' }),
    )

    // The copy sits immediately after the original, its settings carried —
    // the trimmed out point shows on the row at position 2.
    expect(sequenceNames()).toEqual(['a.mp4', 'a.mp4', 'b.mp4'])
    expect(
      screen.getByRole('spinbutton', { name: 'Trim out point of a.mp4 at position 2 in seconds' }),
    ).toHaveValue(5)

    // One Undo removes the duplicate and leaves the original untouched.
    await userEvent.click(screen.getByRole('button', { name: 'Undo last timeline edit' }))
    expect(sequenceNames()).toEqual(['a.mp4', 'b.mp4'])
    expect(
      screen.getByRole('spinbutton', { name: 'Trim out point of a.mp4 at position 1 in seconds' }),
    ).toHaveValue(5)
    // Redo restores it.
    await userEvent.click(screen.getByRole('button', { name: 'Redo timeline edit' }))
    expect(sequenceNames()).toEqual(['a.mp4', 'a.mp4', 'b.mp4'])
  })

  it('duplicates an audio track onto the lane starting where the original ends', async () => {
    render(<App />)
    await importAudioClip('m.mp3', 8)
    await userEvent.click(screen.getByRole('button', { name: 'Add m.mp3 to timeline' }))

    await userEvent.click(
      screen.getByRole('button', { name: 'Duplicate audio track m.mp3 at position 1' }),
    )

    const tracks = within(screen.getByRole('list', { name: 'Audio tracks' })).getAllByRole(
      'listitem',
    )
    expect(tracks).toHaveLength(2)
    expect(
      screen.getByRole('spinbutton', {
        name: 'Start time of audio track m.mp3 at position 2 in seconds',
      }),
    ).toHaveValue(8)
  })

  it('duplicates a video overlay onto the lane starting where the original ends', async () => {
    render(<App />)
    await importClip('cam.mp4', 6)
    await userEvent.click(screen.getByRole('button', { name: 'Add cam.mp4 as overlay' }))

    await userEvent.click(
      screen.getByRole('button', { name: 'Duplicate overlay cam.mp4 at position 1' }),
    )

    expect(
      screen.getByRole('spinbutton', {
        name: 'Start time of overlay cam.mp4 at position 2 in seconds',
      }),
    ).toHaveValue(6)
  })

  it('duplicates a text overlay onto the lane starting where the original ends', async () => {
    render(<App />)
    await importClip('a.mp4', 30)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await userEvent.click(
      screen.getByRole('button', { name: 'Add text overlay to timeline' }),
    )

    await userEvent.click(
      screen.getByRole('button', { name: 'Duplicate text overlay at position 1' }),
    )

    // The default text runs 0–3 s, so the copy starts at 3.
    expect(
      screen.getByRole('spinbutton', {
        name: 'Start time of text overlay at position 2 in seconds',
      }),
    ).toHaveValue(3)
  })
})

describe('image overlay layers (#294)', () => {
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

  const addLogoOverlay = async () => {
    await importImage('logo.png')
    await userEvent.click(screen.getByRole('button', { name: 'Add logo.png as overlay' }))
  }

  const position = 'overlay logo.png at position 1'

  it('offers Overlay for an image clip, and adds it with the default placement', async () => {
    render(<App />)
    await addLogoOverlay()

    const lane = screen.getByRole('list', { name: 'Overlay layers' })
    expect(within(lane).getAllByRole('listitem')).toHaveLength(1)
    // The same corner rectangle a video overlay gets — a still is placed
    // like any other layer.
    expect(
      screen.getByRole('spinbutton', { name: `Left edge of ${position} (fraction of frame width)` }),
    ).toHaveValue(0.62)
    expect(
      screen.getByRole('spinbutton', { name: `Width of ${position} (fraction of frame width)` }),
    ).toHaveValue(0.35)
    // Its window is offset + length, starting at the sequence start for the
    // still default — never a trim of a source it does not have.
    expect(
      screen.getByRole('spinbutton', { name: `Start time of ${position} in seconds` }),
    ).toHaveValue(0)
    expect(
      screen.getByRole('spinbutton', { name: `Duration of ${position} in seconds` }),
    ).toHaveValue(5)
    expect(screen.getByText('shows 5s')).toBeInTheDocument()
    // The row shows the image itself, as a still entry's row does.
    expect(screen.getByTestId('video-overlay-thumbnail-0')).toHaveAttribute('src', 'blob:logo.png')
  })

  it('shows no trim and no audio controls — a still has neither', async () => {
    render(<App />)
    await addLogoOverlay()
    for (const name of [
      `Trim in point of ${position} in seconds`,
      `Trim out point of ${position} in seconds`,
      `Volume of ${position} (0 to 1)`,
      `Audio fade-in of ${position} in seconds`,
      `Audio fade-out of ${position} in seconds`,
    ]) {
      expect(screen.queryByRole('spinbutton', { name })).not.toBeInTheDocument()
    }
    // Absent, not disabled: there is nothing to control.
    expect(screen.queryByRole('checkbox', { name: `Mute ${position}` })).not.toBeInTheDocument()
    // And no amplitude visual for a silent layer.
    expect(screen.queryByTestId('video-overlay-waveform-0')).not.toBeInTheDocument()
  })

  it('edits the window and rectangle, committing through the reducer', async () => {
    render(<App />)
    await addLogoOverlay()

    const commit = async (name: string, value: string) => {
      const field = screen.getByRole('spinbutton', { name })
      await userEvent.clear(field)
      await userEvent.type(field, value)
      await userEvent.tab()
    }
    await commit(`Start time of ${position} in seconds`, '3')
    await commit(`Duration of ${position} in seconds`, '8')
    await commit(`Left edge of ${position} (fraction of frame width)`, '0.1')

    expect(
      screen.getByRole('spinbutton', { name: `Start time of ${position} in seconds` }),
    ).toHaveValue(3)
    expect(
      screen.getByRole('spinbutton', { name: `Duration of ${position} in seconds` }),
    ).toHaveValue(8)
    expect(
      screen.getByRole('spinbutton', { name: `Left edge of ${position} (fraction of frame width)` }),
    ).toHaveValue(0.1)
    expect(screen.getByText('shows 8s')).toBeInTheDocument()
  })

  it('carries the picture treatments, one undo step each', async () => {
    render(<App />)
    await addLogoOverlay()

    // A treatment edit commits through the reducer exactly as on a video
    // overlay — the controls are the shared ones.
    const saturation = () =>
      screen.getByRole('spinbutton', { name: `Saturation of ${position} (percent)` })
    await userEvent.clear(saturation())
    await userEvent.type(saturation(), '140')
    await userEvent.tab()
    expect(saturation()).toHaveValue(140)
    // A crop edit too, so more than one treatment is pinned as reaching the
    // still through the shared overlay actions.
    const cropTop = () =>
      screen.getByRole('spinbutton', { name: `Crop top of ${position} (percent)` })
    await userEvent.clear(cropTop())
    await userEvent.type(cropTop(), '10')
    await userEvent.tab()
    expect(cropTop()).toHaveValue(10)

    await userEvent.click(screen.getByRole('button', { name: 'Undo last timeline edit' }))
    expect(cropTop()).toHaveValue(0)
    expect(saturation()).toHaveValue(140)
    await userEvent.click(screen.getByRole('button', { name: 'Redo timeline edit' }))
    expect(cropTop()).toHaveValue(10)
  })

  it('adding and removing the overlay are single history steps', async () => {
    render(<App />)
    await addLogoOverlay()
    expect(screen.getByRole('list', { name: 'Overlay layers' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: `Remove ${position} from timeline` }))
    await confirmRemoval()
    expect(screen.queryByRole('list', { name: 'Overlay layers' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Undo last timeline edit' }))
    expect(screen.getByRole('list', { name: 'Overlay layers' })).toBeInTheDocument()
    // One more undo takes the add itself back.
    await userEvent.click(screen.getByRole('button', { name: 'Undo last timeline edit' }))
    expect(screen.queryByRole('list', { name: 'Overlay layers' })).not.toBeInTheDocument()
  })
})

describe('copy and paste settings (#315)', () => {
  it('offers Copy on rows holding a group — never on a slate — and Paste only once something is copied', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await importAudioClip('m.mp3', 8)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add color slate to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add m.mp3 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 as overlay' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add text overlay to timeline' }))

    expect(
      screen.getByRole('button', { name: 'Copy settings of a.mp4 at position 1' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Copy settings of audio track m.mp3 at position 1' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Copy settings of overlay a.mp4 at position 1' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Copy settings of text overlay at position 1' }),
    ).toBeInTheDocument()
    // A slate holds no settings group: neither control renders on its row.
    expect(
      screen.queryByRole('button', { name: 'Copy settings of Color slate at position 2' }),
    ).not.toBeInTheDocument()

    // With nothing copied there is no Paste control anywhere.
    expect(screen.queryByRole('button', { name: /^Paste settings onto/ })).not.toBeInTheDocument()

    await userEvent.click(
      screen.getByRole('button', { name: 'Copy settings of a.mp4 at position 1' }),
    )
    expect(
      screen.getByRole('button', { name: 'Paste settings onto text overlay at position 1' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Paste settings onto Color slate at position 2' }),
    ).not.toBeInTheDocument()
  })

  it('clip→clip: applies the checked groups only, as one undo step', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await importClip('b.mp4', 20)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add b.mp4 to timeline' }))

    // A distinctive grade and crop on the source.
    const saturation = screen.getByRole('spinbutton', {
      name: 'Saturation of a.mp4 at position 1 (percent)',
    })
    fireEvent.change(saturation, { target: { value: '0' } })
    fireEvent.blur(saturation)
    const cropTop = screen.getByRole('spinbutton', {
      name: 'Crop top of a.mp4 at position 1 (percent)',
    })
    fireEvent.change(cropTop, { target: { value: '20' } })
    fireEvent.blur(cropTop)

    await userEvent.click(
      screen.getByRole('button', { name: 'Copy settings of a.mp4 at position 1' }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Paste settings onto b.mp4 at position 2' }),
    )

    // The checklist offers the full clip↔clip surface, everything checked.
    const dialog = screen.getByRole('dialog')
    expect(
      within(dialog)
        .getAllByRole('checkbox')
        .map((box) => box.closest('label')?.textContent),
    ).toEqual(['Color', 'Orientation', 'Crop', 'Background fill', 'Audio'])
    expect(within(dialog).getAllByRole('checkbox').every((box) => (box as HTMLInputElement).checked)).toBe(
      true,
    )

    // Apply the color but not the crop.
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Crop' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }))

    expect(
      screen.getByRole('spinbutton', { name: 'Saturation of b.mp4 at position 2 (percent)' }),
    ).toHaveValue(0)
    expect(
      screen.getByRole('spinbutton', { name: 'Crop top of b.mp4 at position 2 (percent)' }),
    ).toHaveValue(0)
    // The source is untouched.
    expect(
      screen.getByRole('spinbutton', { name: 'Crop top of a.mp4 at position 1 (percent)' }),
    ).toHaveValue(20)

    // One Undo reverts the whole paste; Redo re-applies it.
    await userEvent.click(screen.getByRole('button', { name: 'Undo last timeline edit' }))
    expect(
      screen.getByRole('spinbutton', { name: 'Saturation of b.mp4 at position 2 (percent)' }),
    ).toHaveValue(100)
    await userEvent.click(screen.getByRole('button', { name: 'Redo timeline edit' }))
    expect(
      screen.getByRole('spinbutton', { name: 'Saturation of b.mp4 at position 2 (percent)' }),
    ).toHaveValue(0)
  })

  it('clip→overlay: the checklist offers the shared groups, without Background fill', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 as overlay' }))

    await userEvent.click(
      screen.getByRole('button', { name: 'Copy settings of a.mp4 at position 1' }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Paste settings onto overlay a.mp4 at position 1' }),
    )
    expect(
      within(screen.getByRole('dialog'))
        .getAllByRole('checkbox')
        .map((box) => box.closest('label')?.textContent),
    ).toEqual(['Color', 'Orientation', 'Crop', 'Audio'])
  })

  it('clip→text: no compatible group — the dialog says so instead of a checklist', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add text overlay to timeline' }))

    await userEvent.click(
      screen.getByRole('button', { name: 'Copy settings of a.mp4 at position 1' }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Paste settings onto text overlay at position 1' }),
    )
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryAllByRole('checkbox')).toHaveLength(0)
    expect(within(dialog).getByText('None of the copied settings apply to this element.'))
      .toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('text→text: the style carries over, the target keeps its content and window', async () => {
    render(<App />)
    await importClip('a.mp4', 30)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add text overlay to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add text overlay to timeline' }))

    // Style the first title distinctively.
    await userEvent.click(screen.getByRole('checkbox', { name: 'Bold text overlay at position 1' }))
    const color = screen.getByLabelText('Color of text overlay at position 1')
    fireEvent.change(color, { target: { value: '#ffcc00' } })

    await userEvent.click(
      screen.getByRole('button', { name: 'Copy settings of text overlay at position 1' }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Paste settings onto text overlay at position 2' }),
    )
    const dialog = screen.getByRole('dialog')
    expect(
      within(dialog)
        .getAllByRole('checkbox')
        .map((box) => box.closest('label')?.textContent),
    ).toEqual(['Text style'])
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }))

    expect(
      screen.getByRole('checkbox', { name: 'Bold text overlay at position 2' }),
    ).toBeChecked()
    expect(screen.getByLabelText('Color of text overlay at position 2')).toHaveValue('#ffcc00')
    // The window is untouched: both titles still start at 0.
    expect(
      screen.getByRole('spinbutton', { name: 'Start time of text overlay at position 2 in seconds' }),
    ).toHaveValue(0)
  })
})

describe('a still overlay offers no Audio group in the paste checklist (#332)', () => {
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

  const groupsInDialog = () =>
    within(screen.getByRole('dialog'))
      .getAllByRole('checkbox')
      .map((box) => box.closest('label')?.textContent)

  it('pasting a clip onto a still overlay offers Color / Orientation / Crop only', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await importImage('logo.png')
    await userEvent.click(screen.getByRole('button', { name: 'Add logo.png as overlay' }))

    await userEvent.click(
      screen.getByRole('button', { name: 'Copy settings of a.mp4 at position 1' }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Paste settings onto overlay logo.png at position 1' }),
    )
    // A still is soundless: no Audio checkbox, and no Background fill either
    // (no overlay of either kind holds one).
    expect(groupsInDialog()).toEqual(['Color', 'Orientation', 'Crop'])
  })

  it('a video overlay target still offers Audio — the control for the fix', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 as overlay' }))

    await userEvent.click(
      screen.getByRole('button', { name: 'Copy settings of a.mp4 at position 1' }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Paste settings onto overlay a.mp4 at position 1' }),
    )
    expect(groupsInDialog()).toEqual(['Color', 'Orientation', 'Crop', 'Audio'])
  })

  it("copying a still overlay and pasting onto a clip cannot touch the clip's audio", async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await importImage('logo.png')
    await userEvent.click(screen.getByRole('button', { name: 'Add logo.png as overlay' }))

    // Dial the clip's volume down, so a reset would be visible.
    const volume = screen.getByRole('spinbutton', { name: 'Volume of a.mp4 at position 1 (0 to 1)' })
    fireEvent.change(volume, { target: { value: '0.25' } })
    fireEvent.blur(volume)

    await userEvent.click(
      screen.getByRole('button', { name: 'Copy settings of overlay logo.png at position 1' }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Paste settings onto a.mp4 at position 1' }),
    )
    // The checklist a still offers a clip: no Audio to leave checked.
    expect(groupsInDialog()).toEqual(['Color', 'Orientation', 'Crop'])
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Apply' }))

    expect(
      screen.getByRole('spinbutton', { name: 'Volume of a.mp4 at position 1 (0 to 1)' }),
    ).toHaveValue(0.25)
  })
})
