import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { DEFAULT_DUCK_LEVEL } from '../lib/gain'
import { probeMediaFile } from '../lib/probeMedia'
import { deserializeProject } from '../lib/projectFile'
import type { SavePort } from '../lib/saveProject'
import { chooseClipAction, clipMenuItem, queryClipMenuItem } from '../test/clipMenu'
import {
  ADD_PAUSE,
  ADD_SPEED,
  ADD_ZOOM,
  COPY_SETTINGS,
  DUPLICATE,
  PASTE_SETTINGS,
  RENAME,
  chooseEffect,
  chooseRowAction,
  closeEffectMenu,
  closeRowMenu,
  effectItem,
  effectMenuItems,
  effectMenuTrigger,
  queryEffectMenuTrigger,
  queryRowMenuTrigger,
  queryEffectItem,
  queryRowAction,
  rowMenuItems,
  rowMenuTrigger,
} from '../test/timelineRowMenu'
import {
  ADD_SLATE,
  ADD_TEXT,
  IMPORT_SUBTITLES,
  chooseFromAddMenu,
  closeAddMenu,
  openAddMenu,
  openSubtitleStyle,
  querySubtitleStyleToggle,
  subtitleStyleToggle,
} from '../test/timelineMenu'

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
      expect(await effectItem('logo.png at position 2', ADD_ZOOM)).toBeEnabled()
    })
  })

  describe('color slates (#143)', () => {
    it('adds a red 5-second slate from the timeline itself — no import involved', async () => {
      render(<App />)
      await chooseFromAddMenu(ADD_SLATE)

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
      await chooseFromAddMenu(ADD_SLATE)

      const color = screen.getByLabelText('Color of Color slate at position 1')
      // userEvent has no color-picker interaction; fireEvent's change is what
      // the input emits after a pick.
      fireEvent.change(color, { target: { value: '#00cc66' } })
      expect(color).toHaveValue('#00cc66')
    })

    it('edits the duration and carries transitions like any still', async () => {
      render(<App />)
      await importClip('a.mp4', 10)
      await chooseFromAddMenu(ADD_SLATE)
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

      await chooseEffect('a.mp4 at position 1', ADD_ZOOM)

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
      // The item stays enabled: an entry can carry several zooms (#129).
      expect(await effectItem('a.mp4 at position 1', ADD_ZOOM)).toBeEnabled()
    })

    it('adds a second zoom into the free space after the first (#129)', async () => {
      render(<App />)
      await importClip('a.mp4', 10)
      await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))

      await chooseEffect('a.mp4 at position 1', ADD_ZOOM)
      await chooseEffect('a.mp4 at position 1', ADD_ZOOM)

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

    it('disables the Zoom item when the zoom windows fill the trimmed entry (#129)', async () => {
      render(<App />)
      await importClip('a.mp4', 2)
      await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))

      await chooseEffect('a.mp4 at position 1', ADD_ZOOM)
      // The default window [0, 2] covers the whole 2s clip. The disabled
      // state that sat on + Zoom sits on the item now (#419).
      expect(await effectItem('a.mp4 at position 1', ADD_ZOOM)).toBeDisabled()
    })

    it('edits a parameter, and shows the clamp when a value cannot fit', async () => {
      render(<App />)
      await importClip('a.mp4', 10)
      await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
      await chooseEffect('a.mp4 at position 1', ADD_ZOOM)

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
      await chooseEffect('a.mp4 at position 1', ADD_ZOOM)
      await chooseEffect('a.mp4 at position 1', ADD_ZOOM)

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
      await chooseEffect('a.mp4 at position 1', ADD_ZOOM)

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
      await chooseEffect('a.mp4 at position 1', ADD_ZOOM)

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
      await chooseEffect('a.mp4 at position 1', ADD_ZOOM)

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
      await chooseEffect('a.mp4 at position 1', ADD_ZOOM)
      await chooseEffect('a.mp4 at position 1', ADD_ZOOM)

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
      // With both zooms gone the whole entry is free again.
      expect(await effectItem('a.mp4 at position 1', ADD_ZOOM)).toBeEnabled()
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

      await chooseEffect('a.mp4 at position 1', ADD_SPEED)

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

      await chooseEffect('a.mp4 at position 1', ADD_SPEED)
      await chooseEffect('a.mp4 at position 1', ADD_PAUSE)

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
      await chooseEffect('a.mp4 at position 1', ADD_SPEED)

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
      await chooseEffect('a.mp4 at position 1', ADD_SPEED)

      const factor = screen.getByRole('spinbutton', {
        name: 'Speed segment 1 factor of a.mp4 at position 1',
      })
      await userEvent.clear(factor)
      await userEvent.type(factor, '0')
      await userEvent.tab()
      expect(factor).toHaveValue(0.5)
    })

    it('disables the Speed segment item when segments cover the range; Pause once the end is held', async () => {
      await addEntry(2)
      const entry = 'a.mp4 at position 1'

      await chooseEffect(entry, ADD_SPEED)
      // The default segment [0, 2] covers the whole 2s clip. Both readings
      // come off the items now (#419), where they sat on the buttons.
      expect(await effectItem(entry, ADD_SPEED)).toBeDisabled()
      expect(await effectItem(entry, ADD_PAUSE)).toBeEnabled()
      await closeEffectMenu(entry)
      // With every instant covered, the pause lands at the very end.
      await chooseEffect(entry, ADD_PAUSE)
      expect(
        screen.getByRole('spinbutton', { name: 'Pause 1 position of a.mp4 at position 1 in seconds' }),
      ).toHaveValue(2)
      // Segments cover every instant and the end already holds a pause:
      // there is nowhere left to place another (#153).
      expect(await effectItem(entry, ADD_PAUSE)).toBeDisabled()
    })

    it('places a second default pause on a distinct instant (#153)', async () => {
      await addEntry()
      await chooseEffect('a.mp4 at position 1', ADD_PAUSE)
      await chooseEffect('a.mp4 at position 1', ADD_PAUSE)
      // The first pause holds instant 0; a second Pause must not stack
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
      await chooseEffect('a.mp4 at position 1', ADD_PAUSE)
      const at = screen.getByRole('spinbutton', {
        name: 'Pause 1 position of a.mp4 at position 1 in seconds',
      })
      await userEvent.clear(at)
      await userEvent.type(at, '4')
      await userEvent.tab()
      await chooseEffect('a.mp4 at position 1', ADD_PAUSE)
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

    it('offers no remap items on stills — + Effect ▾ carries Zoom alone', async () => {
      render(<App />)
      await chooseFromAddMenu(ADD_SLATE)
      const slate = 'Color slate at position 1'
      // A still's one duration is its timing (#138): the two items are
      // absent, as their buttons were, rather than permanently disabled.
      expect(await queryEffectItem(slate, ADD_SPEED)).toBeNull()
      expect(await queryEffectItem(slate, ADD_PAUSE)).toBeNull()
      expect(await effectMenuItems(slate)).toEqual([ADD_ZOOM])
    })

    it('re-clamps effects when a trim shrinks the entry under them', async () => {
      await addEntry()
      await chooseEffect('a.mp4 at position 1', ADD_SPEED)
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

    await chooseClipAction('music.mp3', 'Remove')
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
    await chooseFromAddMenu(ADD_TEXT)

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
    await chooseFromAddMenu(ADD_TEXT)
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
    await chooseFromAddMenu(ADD_TEXT)

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
    await chooseFromAddMenu(ADD_TEXT)

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
    await chooseFromAddMenu(ADD_TEXT)
    await chooseFromAddMenu(ADD_TEXT)
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
    await chooseFromAddMenu(ADD_TEXT)

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
    await chooseClipAction('cam.mp4', 'Add as overlay')

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
    expect(await clipMenuItem('cam.mp4', 'Add as overlay')).toBeInTheDocument()
    expect(await clipMenuItem('logo.png', 'Add as overlay')).toBeInTheDocument()
    expect(await queryClipMenuItem('song.mp3', 'Add as overlay')).not.toBeInTheDocument()
  })

  it('edits window, trim, rectangle, and gain — clamping visibly like other fields', async () => {
    render(<App />)
    await importClip('cam.mp4', 8)
    await chooseClipAction('cam.mp4', 'Add as overlay')

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
    // Twice, each through its own opening of ⋯: selecting closes the panel
    // and unmounts the item, so one element cannot be clicked twice (#416).
    await chooseClipAction('cam.mp4', 'Add as overlay')
    await chooseClipAction('cam.mp4', 'Add as overlay')
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
    await chooseClipAction('cam.mp4', 'Add as overlay')

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
    await chooseClipAction('cam.mp4', 'Add as overlay')

    await chooseClipAction('cam.mp4', 'Remove')
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

    await chooseFromAddMenu(ADD_SLATE)
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
    await chooseFromAddMenu(ADD_SLATE)
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
    await chooseFromAddMenu(ADD_TEXT)
    expect(redoButton()).toBeDisabled()
  })

  it('undoes with Ctrl+Z and redoes with Ctrl+Shift+Z and Ctrl+Y', async () => {
    render(<App />)
    await chooseFromAddMenu(ADD_SLATE)

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
    await chooseFromAddMenu(ADD_SLATE)
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

    await chooseClipAction('a.mp4', 'Remove')
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
    await chooseFromAddMenu(ADD_SLATE)
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
    await chooseFromAddMenu(ADD_TEXT)

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
    await chooseFromAddMenu(ADD_SLATE)
    expect(
      screen.queryByRole('spinbutton', { name: /Brightness of Color slate/ }),
    ).not.toBeInTheDocument()
  })

  it('adjusts a video overlay and filters its preview element', async () => {
    render(<App />)
    await importClip('base.mp4', 10)
    await importClip('cam.mp4', 8)
    await userEvent.click(screen.getByRole('button', { name: 'Add base.mp4 to timeline' }))
    await chooseClipAction('cam.mp4', 'Add as overlay')

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
    await chooseFromAddMenu(ADD_SLATE)

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
    await chooseClipAction('a.mp4', 'Add as overlay')

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
    await chooseFromAddMenu(ADD_SLATE)
    expect(
      screen.queryByRole('button', { name: /Rotate Color slate at position 1/ }),
    ).not.toBeInTheDocument()
  })

  it('orients an overlay row and undoes like any timeline edit (#189)', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await importClip('cam.mp4', 8)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await chooseClipAction('cam.mp4', 'Add as overlay')

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
    await chooseFromAddMenu(ADD_SLATE)
    expect(
      screen.queryByRole('spinbutton', { name: /Crop left of Color slate/ }),
    ).not.toBeInTheDocument()
  })

  it('crops an overlay row independently of the base entry', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await importClip('cam.mp4', 8)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await chooseClipAction('cam.mp4', 'Add as overlay')

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
    await chooseFromAddMenu(ADD_TEXT)
    await importSrt(TWO_CUES)
    await screen.findByRole('textbox', { name: 'Content of text overlay at position 3' })

    // The style fields sit behind the disclosure since #418; the import
    // above opened it, and this says so rather than relying on it.
    await openSubtitleStyle()
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
    // …then restyles the default font and color, behind the #418 disclosure.
    await openSubtitleStyle()
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
    // Customizing *before* any subtitles exist is no longer reachable: #418
    // renders the style disclosure only where it has cues to restyle, which
    // is the one thing #250's surface traded away for the header line. The
    // claim this test is named for is untouched — a customized default
    // styles later imports — and is now made across two imports, so it also
    // covers the cues already on the timeline, which the old shape did not.
    await importSrt('1\n00:00:01,000 --> 00:00:02,000\nStyled on arrival\n')
    await screen.findByRole('textbox', { name: 'Content of text overlay at position 1' })
    await openSubtitleStyle()
    const reset = screen.getByRole('button', { name: 'Reset default subtitle style' })
    expect(reset).toBeDisabled()

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Default subtitle font' }), 'serif')
    expect(reset).toBeEnabled()
    // The cue already imported follows the new default…
    expect(screen.getByRole('combobox', { name: 'Font of text overlay at position 1' })).toHaveValue('serif')

    // …and so does one imported after it.
    await importSrt('1\n00:00:05,000 --> 00:00:06,000\nStyled on arrival too\n', 'more.srt')
    expect(
      await screen.findByRole('combobox', { name: 'Font of text overlay at position 2' }),
    ).toHaveValue('serif')

    await userEvent.click(reset)
    expect(reset).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Font of text overlay at position 1' })).toHaveValue('sans')
    expect(screen.getByRole('combobox', { name: 'Font of text overlay at position 2' })).toHaveValue('sans')
    expect(screen.getByRole('combobox', { name: 'Default subtitle font' })).toHaveValue('sans')
  })

  it('the style disclosure appears only with cues, opens on import, and toggles (#418)', async () => {
    render(<App />)
    // Nothing to restyle: the disclosure is not rendered at all, so neither
    // is the eight-control row it used to keep permanently on screen.
    expect(querySubtitleStyleToggle()).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Default subtitle font' })).toBeNull()

    // A hand-made text overlay is a cue to restyle, so the disclosure
    // appears — collapsed, because nothing has been imported yet.
    await chooseFromAddMenu(ADD_TEXT)
    expect(subtitleStyleToggle()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('combobox', { name: 'Default subtitle font' })).toBeNull()

    // Clicking opens it and clicking again closes it.
    await userEvent.click(subtitleStyleToggle())
    expect(subtitleStyleToggle()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('combobox', { name: 'Default subtitle font' })).toBeInTheDocument()
    await userEvent.click(subtitleStyleToggle())
    expect(subtitleStyleToggle()).toHaveAttribute('aria-expanded', 'false')

    // An import opens it: the cues that just arrived are the reason to look.
    await importSrt(TWO_CUES)
    await screen.findByRole('textbox', { name: 'Content of text overlay at position 3' })
    expect(subtitleStyleToggle()).toHaveAttribute('aria-expanded', 'true')

    // Every import opens it, including one after the user closed it — the
    // simpler of the two rules #418 allows, chosen deliberately: it needs no
    // memory of what the user did earlier, and re-opening after an import
    // the user asked for is not a surprise.
    await userEvent.click(subtitleStyleToggle())
    expect(subtitleStyleToggle()).toHaveAttribute('aria-expanded', 'false')
    await importSrt('1\n00:00:07,000 --> 00:00:08,000\nThird import\n', 'again.srt')
    await screen.findByRole('textbox', { name: 'Content of text overlay at position 4' })
    expect(subtitleStyleToggle()).toHaveAttribute('aria-expanded', 'true')
  })

  it('a failed import leaves no disclosure to open (#418)', async () => {
    render(<App />)
    // The open state is set by the picker, but the disclosure renders on
    // cues existing — so a file with none leaves nothing on screen rather
    // than an empty style row.
    await importSrt('this is prose, not subtitles')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No subtitle cues found in "captions.srt".',
    )
    expect(querySubtitleStyleToggle()).toBeNull()
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
    await chooseFromAddMenu(ADD_SLATE)
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
    await chooseClipAction('cam.mp4', 'Add as overlay')
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
    await chooseClipAction('v.mp4', 'Add as overlay')
    await chooseFromAddMenu(ADD_TEXT)

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
    await chooseFromAddMenu(ADD_TEXT)

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
    await chooseClipAction('a.mp4', 'Add as overlay')
    await chooseFromAddMenu(ADD_TEXT)
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
    await chooseClipAction('m.mp3', 'Remove')
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

    await chooseRowAction('a.mp4 at position 1', DUPLICATE)

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

    await chooseRowAction('audio track m.mp3 at position 1', DUPLICATE)

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
    await chooseClipAction('cam.mp4', 'Add as overlay')

    await chooseRowAction('overlay cam.mp4 at position 1', DUPLICATE)

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
    await chooseFromAddMenu(ADD_TEXT)

    await chooseRowAction('text overlay at position 1', DUPLICATE)

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
    await chooseClipAction('logo.png', 'Add as overlay')
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
    await chooseFromAddMenu(ADD_SLATE)
    await userEvent.click(screen.getByRole('button', { name: 'Add m.mp3 to timeline' }))
    await chooseClipAction('a.mp4', 'Add as overlay')
    await chooseFromAddMenu(ADD_TEXT)

    const holders = [
      'a.mp4 at position 1',
      'audio track m.mp3 at position 1',
      'overlay a.mp4 at position 1',
      'text overlay at position 1',
    ]
    for (const position of holders) {
      expect(await queryRowAction(position, COPY_SETTINGS)).toBeInTheDocument()
      await closeRowMenu(position)
      // With nothing copied there is no Paste item anywhere.
      expect(await queryRowAction(position, PASTE_SETTINGS)).toBeNull()
      await closeRowMenu(position)
    }
    // A slate holds no settings group: neither item is in its ⋯, which
    // still opens for the actions it does have.
    expect(await rowMenuItems('Color slate at position 2')).toEqual([DUPLICATE, RENAME])
    await closeRowMenu('Color slate at position 2')

    await chooseRowAction('a.mp4 at position 1', COPY_SETTINGS)
    expect(await queryRowAction('text overlay at position 1', PASTE_SETTINGS)).toBeInTheDocument()
    await closeRowMenu('text overlay at position 1')
    expect(await queryRowAction('Color slate at position 2', PASTE_SETTINGS)).toBeNull()
    await closeRowMenu('Color slate at position 2')
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

    await chooseRowAction('a.mp4 at position 1', COPY_SETTINGS)
    await chooseRowAction('b.mp4 at position 2', PASTE_SETTINGS)

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
    await chooseClipAction('a.mp4', 'Add as overlay')

    await chooseRowAction('a.mp4 at position 1', COPY_SETTINGS)
    await chooseRowAction('overlay a.mp4 at position 1', PASTE_SETTINGS)
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
    await chooseFromAddMenu(ADD_TEXT)

    await chooseRowAction('a.mp4 at position 1', COPY_SETTINGS)
    await chooseRowAction('text overlay at position 1', PASTE_SETTINGS)
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
    await chooseFromAddMenu(ADD_TEXT)
    await chooseFromAddMenu(ADD_TEXT)

    // Style the first title distinctively.
    await userEvent.click(screen.getByRole('checkbox', { name: 'Bold text overlay at position 1' }))
    const color = screen.getByLabelText('Color of text overlay at position 1')
    fireEvent.change(color, { target: { value: '#ffcc00' } })

    await chooseRowAction('text overlay at position 1', COPY_SETTINGS)
    await chooseRowAction('text overlay at position 2', PASTE_SETTINGS)
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

describe("a section's Expand all unfolds the section too (#360)", () => {
  const trimIn = (position: string) =>
    screen.queryByRole('spinbutton', { name: `Trim in point of ${position} in seconds` })
  const list = (name: string) => screen.queryByRole('list', { name })
  const fold = (title: string) => screen.getByRole('button', { name: `Collapse ${title} section` })
  const unfold = (title: string) => screen.getByRole('button', { name: `Expand ${title} section` })

  const addTwoClips = async () => {
    await importClip('a.mp4', 10)
    await importClip('b.mp4', 6)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add b.mp4 to timeline' }))
  }

  it('on a folded section, unfolds it and expands its elements — the click visibly acts', async () => {
    render(<App />)
    await addTwoClips()
    await userEvent.click(screen.getByRole('button', { name: 'Collapse a.mp4 at position 1' }))
    await userEvent.click(fold('Sequence'))
    expect(list('Sequence')).toBeNull()

    // The customer's report (#354): this click used to appear to do nothing.
    await userEvent.click(screen.getByRole('button', { name: 'Expand all Sequence elements' }))
    expect(list('Sequence')).toBeInTheDocument()
    expect(fold('Sequence')).toHaveAttribute('aria-expanded', 'true')
    expect(trimIn('a.mp4 at position 1')).toBeInTheDocument()
    expect(trimIn('b.mp4 at position 2')).toBeInTheDocument()
  })

  it('on an unfolded section, behaves exactly as before — elements expand, nothing else changes', async () => {
    render(<App />)
    await addTwoClips()
    await userEvent.click(screen.getByRole('button', { name: 'Collapse a.mp4 at position 1' }))

    await userEvent.click(screen.getByRole('button', { name: 'Expand all Sequence elements' }))
    expect(fold('Sequence')).toHaveAttribute('aria-expanded', 'true')
    expect(trimIn('a.mp4 at position 1')).toBeInTheDocument()
    expect(trimIn('b.mp4 at position 2')).toBeInTheDocument()
  })

  it('Collapse all keeps folding nothing — the customer asked for the asymmetry', async () => {
    render(<App />)
    await addTwoClips()

    // Unfolded before: Collapse all collapses elements, never the section.
    await userEvent.click(screen.getByRole('button', { name: 'Collapse all Sequence elements' }))
    expect(fold('Sequence')).toHaveAttribute('aria-expanded', 'true')
    expect(list('Sequence')).toBeInTheDocument()
    expect(trimIn('a.mp4 at position 1')).toBeNull()

    // Folded before: it stays folded — only the element states change.
    await userEvent.click(fold('Sequence'))
    await userEvent.click(screen.getByRole('button', { name: 'Collapse all Sequence elements' }))
    expect(unfold('Sequence')).toHaveAttribute('aria-expanded', 'false')
    expect(list('Sequence')).toBeNull()
  })

  it('unfolds only its own section — a fold on another lane is untouched', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await importAudioClip('m.mp3', 8)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add m.mp3 to timeline' }))
    await userEvent.click(fold('Sequence'))
    await userEvent.click(fold('Audio'))

    await userEvent.click(screen.getByRole('button', { name: 'Expand all Sequence elements' }))
    expect(list('Sequence')).toBeInTheDocument()
    expect(unfold('Audio')).toHaveAttribute('aria-expanded', 'false')
    expect(list('Audio tracks')).toBeNull()
  })
})

describe('rename timeline elements (#405)', () => {
  const importImage = async (name: string) => {
    probeMock.mockResolvedValueOnce({ duration: 0, url: `blob:${name}`, kind: 'image', width: 64, height: 32 })
    await userEvent.upload(
      screen.getByTestId('clip-file-input'),
      new File(['content'], name, { type: 'image/png' }),
      { applyAccept: false },
    )
    await screen.findByText(name)
  }
  const field = (position: string) =>
    screen.getByRole('textbox', { name: `New name for ${position}` })

  it('renames a sequence entry through the ⋯ menu and Enter; every label and the preview readout follow, as one undo step', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    expect(screen.getByTestId('preview-now-playing')).toHaveTextContent('Clip 1 of 1: a.mp4')

    await chooseRowAction('a.mp4 at position 1', RENAME)
    const input = field('a.mp4 at position 1')
    // Opens with the current name, selected, so typing replaces it.
    expect(input).toHaveValue('a.mp4')
    expect(input).toHaveFocus()
    await userEvent.keyboard('Intro{Enter}')

    expect(sequenceNames()).toEqual(['Intro'])
    expect(screen.queryByRole('textbox', { name: /New name for/ })).not.toBeInTheDocument()
    // The ⋯ is named for the row, so its own name follows the rename too.
    expect(rowMenuTrigger('Intro at position 1')).toBeInTheDocument()
    expect(
      screen.getByRole('spinbutton', { name: 'Trim out point of Intro at position 1 in seconds' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Intro at position 1 from timeline' })).toBeInTheDocument()
    expect(screen.getByTestId('preview-now-playing')).toHaveTextContent('Clip 1 of 1: Intro')
    // The library clip keeps its own name.
    expect(screen.getByRole('button', { name: 'Add a.mp4 to timeline' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Undo last timeline edit' }))
    expect(sequenceNames()).toEqual(['a.mp4'])
    await userEvent.click(screen.getByRole('button', { name: 'Redo timeline edit' }))
    expect(sequenceNames()).toEqual(['Intro'])
  })

  it('renames a slate by double-clicking its name and clicking away', async () => {
    render(<App />)
    await chooseFromAddMenu(ADD_SLATE)
    fireEvent.doubleClick(within(sequence()).getByText('Color slate'))
    const input = field('Color slate at position 1')
    await userEvent.clear(input)
    await userEvent.type(input, 'Title card')
    fireEvent.blur(input)
    expect(sequenceNames()).toEqual(['Title card'])
    expect(
      screen.getByRole('button', { name: 'Collapse Title card at position 1' }),
    ).toBeInTheDocument()
  })

  it('Escape cancels a rename of an audio track; an empty name reverts', async () => {
    render(<App />)
    await importAudioClip('m.mp3', 8)
    await userEvent.click(screen.getByRole('button', { name: 'Add m.mp3 to timeline' }))
    const trackName = () =>
      within(screen.getByRole('list', { name: 'Audio tracks' }))
        .getAllByRole('listitem')
        .map((item) => item.querySelector('.clip-name')?.textContent)

    await chooseRowAction('audio track m.mp3 at position 1', RENAME)
    await userEvent.keyboard('Bed{Escape}')
    expect(trackName()).toEqual(['m.mp3'])
    expect(screen.queryByRole('textbox', { name: /New name for/ })).not.toBeInTheDocument()

    await chooseRowAction('audio track m.mp3 at position 1', RENAME)
    await userEvent.keyboard('   {Enter}')
    expect(trackName()).toEqual(['m.mp3'])
    // Neither attempt was an edit: nothing to undo beyond the add itself.
    await userEvent.click(screen.getByRole('button', { name: 'Undo last timeline edit' }))
    expect(screen.queryByRole('list', { name: 'Audio tracks' })).not.toBeInTheDocument()
  })

  it('renames a video overlay and an image overlay', async () => {
    render(<App />)
    await importClip('cam.mp4', 6)
    await importImage('logo.png')
    await chooseClipAction('cam.mp4', 'Add as overlay')
    await chooseClipAction('logo.png', 'Add as overlay')

    await chooseRowAction('overlay cam.mp4 at position 1', RENAME)
    await userEvent.keyboard('Face{Enter}')
    await chooseRowAction('overlay logo.png at position 2', RENAME)
    await userEvent.keyboard('Logo{Enter}')

    const overlayNames = within(screen.getByRole('list', { name: 'Overlay layers' }))
      .getAllByRole('listitem')
      .map((item) => item.querySelector('.clip-name')?.textContent)
    expect(overlayNames).toEqual(['Face', 'Logo'])
    expect(
      screen.getByRole('spinbutton', { name: 'Start time of overlay Face at position 1 in seconds' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('spinbutton', { name: 'Start time of overlay Logo at position 2 in seconds' }),
    ).toBeInTheDocument()
  })

  it('offers no rename item on a text overlay', async () => {
    render(<App />)
    await importClip('a.mp4', 30)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await chooseFromAddMenu(ADD_TEXT)
    // That row shows the overlay's content rather than a name, so there is
    // nothing to rename — as before #419, when it carried no ✎ either.
    expect(await queryRowAction('text overlay at position 1', RENAME)).toBeNull()
    await closeRowMenu('text overlay at position 1')
    expect(await queryRowAction('a.mp4 at position 1', RENAME)).toBeInTheDocument()
    await closeRowMenu('a.mp4 at position 1')
  })
})

// The canvas aspect (#273) moved here from the page header in #415: it
// describes the sequence, so it belongs beside it. These replace the two
// ProjectControls tests that owned the control before, asserting the same
// properties through <App/> — where the select is controlled by
// timeline.canvasPreset, so a value that sticks is the reducer's answer and
// not the DOM's.
describe('the canvas aspect sits in the timeline header (#415)', () => {
  const canvas = () => screen.getByRole('combobox', { name: 'Canvas aspect' }) as HTMLSelectElement

  it('offers Auto and every preset, and each choice reaches the project state', async () => {
    render(<App />)
    expect(canvas().value).toBe('')
    expect(Array.from(canvas().options).map((option) => option.value)).toEqual([
      '',
      '16:9',
      '9:16',
      '1:1',
      '4:5',
    ])

    await userEvent.selectOptions(canvas(), '9:16')
    expect(canvas().value).toBe('9:16')

    // Auto is the absent preset (#273): choosing it clears the key rather
    // than storing an 'auto' identifier, and the control shows it as ''.
    await userEvent.selectOptions(canvas(), '')
    expect(canvas().value).toBe('')
  })

  it('is inside the timeline panel, and there is exactly one of it', async () => {
    render(<App />)
    const timeline = screen.getByRole('region', { name: 'Timeline' })
    expect(within(timeline).getByRole('combobox', { name: 'Canvas aspect' })).toBe(canvas())
    // The page header no longer carries its own copy (#415).
    expect(screen.getAllByRole('combobox', { name: 'Canvas aspect' })).toHaveLength(1)
  })
})

/**
 * The header's Add ▾ menu (#418, from the approved redesign #401 option T1 /
 * feedback #395). What each item does is covered by the suites that used to
 * click the buttons and now go through `chooseFromAddMenu` — the slate tests
 * above, the text-overlay tests, the subtitle-import tests. What is left to
 * assert here is the menu itself: its shape, that the three items are the
 * only way in, that the fold-all pair survived losing its words, and that
 * the whole thing works from the keyboard.
 *
 * Placed before the file's last `describe` per `development.md`, so
 * concurrent PRs do not all conflict at the file's tail.
 */
describe("the timeline header's Add ▾ menu (#418)", () => {
  it('offers exactly the three former buttons, which are gone from the header', async () => {
    render(<App />)

    // The buttons the menu replaced are not in the header any more — the
    // point of the change, and the thing a regression would quietly undo.
    for (const name of [
      'Add color slate to timeline',
      'Add text overlay to timeline',
      'Import subtitles from an SRT file',
    ]) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }

    const menu = await openAddMenu()
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      ADD_SLATE,
      ADD_TEXT,
      IMPORT_SUBTITLES,
    ])
    // No separators: all three add something, and none is destructive.
    expect(within(menu).queryAllByRole('separator')).toHaveLength(0)
    await closeAddMenu()
  })

  it('keeps Undo, Redo and the fold-all pair out of the menu, with their names intact', async () => {
    render(<App />)
    // ▲ ▼ lost their words to option T1's compactness, not their meaning:
    // the accessible names are what every existing collapse test uses, so
    // those tests were not touched by this PR at all.
    const collapse = screen.getByRole('button', { name: 'Collapse all timeline elements' })
    const expand = screen.getByRole('button', { name: 'Expand all timeline elements' })
    expect(collapse).toHaveTextContent('▲')
    expect(expand).toHaveTextContent('▼')
    // A glyph-only control needs its meaning on hover too (#417's ⇥ ⇤ rule).
    expect(collapse).toHaveAttribute('title', 'Collapse all timeline elements')
    expect(expand).toHaveAttribute('title', 'Expand all timeline elements')

    const menu = await openAddMenu()
    for (const name of ['Undo', 'Redo', 'Collapse', 'Expand']) {
      expect(within(menu).queryByRole('menuitem', { name: new RegExp(name) })).toBeNull()
    }
    await closeAddMenu()
    expect(screen.getByRole('button', { name: 'Undo last timeline edit' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Redo timeline edit' })).toBeInTheDocument()
  })

  it('adds a slate by keyboard alone, from the trigger', async () => {
    render(<App />)
    expect(screen.queryByRole('list', { name: 'Sequence' })).toBeNull()

    // ArrowDown opens on the first item, Enter selects it — the menu-button
    // contract #412 implements, exercised without the mouse.
    screen.getByRole('button', { name: 'Add' }).focus()
    await userEvent.keyboard('{ArrowDown}')
    const menu = screen.getByRole('menu', { name: 'Add menu' })
    expect(within(menu).getByRole('menuitem', { name: ADD_SLATE })).toHaveFocus()
    await userEvent.keyboard('{Enter}')

    expect(
      within(screen.getByRole('list', { name: 'Sequence' })).getAllByRole('listitem'),
    ).toHaveLength(1)
    // Selection closes the panel and hands focus back to the trigger.
    expect(screen.queryByRole('menu', { name: 'Add menu' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Add' })).toHaveFocus()
  })

  it('reaches the text overlay item by arrowing past the first', async () => {
    render(<App />)
    screen.getByRole('button', { name: 'Add' }).focus()
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}')

    expect(
      within(screen.getByRole('list', { name: 'Text overlays' })).getAllByRole('listitem'),
    ).toHaveLength(1)
    // And nothing landed in the sequence — the item that ran is the one the
    // arrow was on, not the one the menu opened on.
    expect(screen.queryByRole('list', { name: 'Sequence' })).toBeNull()
  })

  it('opens the subtitle picker rather than importing anything itself', async () => {
    render(<App />)
    const input = screen.getByTestId('subtitle-file-input') as HTMLInputElement
    const clicked = vi.fn()
    input.addEventListener('click', clicked)

    await chooseFromAddMenu(IMPORT_SUBTITLES)

    // The item's whole job is clicking the hidden input the button clicked;
    // the import itself is the input's change handler, covered above.
    expect(clicked).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('list', { name: 'Text overlays' })).toBeNull()
  })
})

/**
 * A timeline row's ⋯ menu and an expanded entry's + Effect ▾ (#419, from the
 * approved redesign #401 / feedback #395). What each item *does* is covered
 * by the suites that used to click the buttons and now go through
 * `chooseRowAction` / `chooseEffect` — duplicate (#314), copy and paste
 * settings (#315), rename (#405), zooms (#129) and time remapping (#141).
 * What is left to assert here is the menus themselves: their per-row shape,
 * that the moved buttons are gone, that ▾ ↑ ↓ ✕ stayed, and that both work
 * from the keyboard.
 *
 * Placed before the file's last `describe` per `development.md`, so
 * concurrent PRs do not all conflict at the file's tail.
 */
describe("a timeline row's ⋯ menu and + Effect ▾ (#419)", () => {
  /** One row of every kind, plus a slate — which holds no settings group. */
  const everyRowKind = async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await importAudioClip('m.mp3', 8)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await chooseFromAddMenu(ADD_SLATE)
    await userEvent.click(screen.getByRole('button', { name: 'Add m.mp3 to timeline' }))
    await chooseClipAction('a.mp4', 'Add as overlay')
    await chooseFromAddMenu(ADD_TEXT)
  }

  it('offers each row kind exactly the items its buttons were, and none where it had none', async () => {
    await everyRowKind()

    // Every row that held a settings group offers the same four, in the
    // same order — Paste only once something is copied, so not yet.
    for (const position of [
      'a.mp4 at position 1',
      'audio track m.mp3 at position 1',
      'overlay a.mp4 at position 1',
    ]) {
      expect(await rowMenuItems(position)).toEqual([DUPLICATE, COPY_SETTINGS, RENAME])
      await closeRowMenu(position)
    }
    // A text overlay's row shows its content rather than a name: no Rename.
    expect(await rowMenuItems('text overlay at position 1')).toEqual([DUPLICATE, COPY_SETTINGS])
    await closeRowMenu('text overlay at position 1')
    // A slate holds no settings group at all (#315).
    expect(await rowMenuItems('Color slate at position 2')).toEqual([DUPLICATE, RENAME])
    await closeRowMenu('Color slate at position 2')

    // Copying puts Paste on every row that can hold it, between Copy and
    // Rename — the order the two buttons sat in.
    await chooseRowAction('a.mp4 at position 1', COPY_SETTINGS)
    expect(await rowMenuItems('a.mp4 at position 1')).toEqual([
      DUPLICATE,
      COPY_SETTINGS,
      PASTE_SETTINGS,
      RENAME,
    ])
    await closeRowMenu('a.mp4 at position 1')
  })

  it('leaves ▾ ↑ ↓ ✕ on the row, and the moved buttons nowhere', async () => {
    await everyRowKind()

    // The four that stayed keep the accessible names their tests use, which
    // is why the collapse, reorder and remove suites are untouched by #419.
    for (const name of [
      'Collapse a.mp4 at position 1',
      'Move a.mp4 at position 1 up',
      'Move a.mp4 at position 1 down',
      'Remove a.mp4 at position 1 from timeline',
    ]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    // ↑ ↓ are the sequence's own ordering: an audio track never had them.
    expect(
      screen.queryByRole('button', { name: 'Move audio track m.mp3 at position 1 up' }),
    ).toBeNull()

    // The buttons the menus replaced are gone from every row.
    for (const pattern of [
      /^Duplicate /,
      /^Copy settings of /,
      /^Paste settings onto /,
      /^Rename /,
      /^Add zoom to /,
      /^Add speed segment to /,
      /^Add pause to /,
    ]) {
      expect(screen.queryByRole('button', { name: pattern })).toBeNull()
    }
  })

  it('duplicates a row by keyboard alone, from the ⋯ trigger', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    expect(sequenceNames()).toEqual(['a.mp4'])

    // ArrowDown opens on the first item, Enter selects it — the menu-button
    // contract #412 implements, exercised without the mouse.
    rowMenuTrigger('a.mp4 at position 1').focus()
    await userEvent.keyboard('{ArrowDown}')
    const menu = screen.getByRole('menu', { name: 'More actions for a.mp4 at position 1' })
    expect(within(menu).getByRole('menuitem', { name: DUPLICATE })).toHaveFocus()
    await userEvent.keyboard('{Enter}')

    expect(sequenceNames()).toEqual(['a.mp4', 'a.mp4'])
    // Selection closes the panel and hands focus back to the trigger.
    expect(screen.queryByRole('menu', { name: 'More actions for a.mp4 at position 1' })).toBeNull()
    expect(rowMenuTrigger('a.mp4 at position 1')).toHaveFocus()
  })

  it('offers Zoom · Speed segment · Pause under one + Effect ▾, and adds a zoom by keyboard', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))

    expect(await effectMenuItems('a.mp4 at position 1')).toEqual([ADD_ZOOM, ADD_SPEED, ADD_PAUSE])
    await closeEffectMenu('a.mp4 at position 1')

    effectMenuTrigger('a.mp4 at position 1').focus()
    await userEvent.keyboard('{ArrowDown}')
    const menu = screen.getByRole('menu', { name: '+ Effect on a.mp4 at position 1' })
    expect(within(menu).getByRole('menuitem', { name: ADD_ZOOM })).toHaveFocus()
    await userEvent.keyboard('{Enter}')

    expect(
      screen.getByRole('spinbutton', { name: 'Zoom 1 scale of a.mp4 at position 1' }),
    ).toHaveValue(2)
    expect(effectMenuTrigger('a.mp4 at position 1')).toHaveFocus()
  })

  it('is not offered on a collapsed row, whose fields are hidden with it', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    expect(queryEffectMenuTrigger('a.mp4 at position 1')).toBeInTheDocument()

    // + Effect ▾ sits with the fields it adds to, so collapsing (#299)
    // takes it too — exactly as it took + Zoom, + Speed and + Pause. The
    // row's own ⋯ stays: its actions are about the row, not its contents.
    await userEvent.click(screen.getByRole('button', { name: 'Collapse a.mp4 at position 1' }))
    expect(queryEffectMenuTrigger('a.mp4 at position 1')).toBeNull()
    expect(queryRowMenuTrigger('a.mp4 at position 1')).toBeInTheDocument()
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
    await chooseClipAction('logo.png', 'Add as overlay')

    await chooseRowAction('a.mp4 at position 1', COPY_SETTINGS)
    await chooseRowAction('overlay logo.png at position 1', PASTE_SETTINGS)
    // A still is soundless: no Audio checkbox, and no Background fill either
    // (no overlay of either kind holds one).
    expect(groupsInDialog()).toEqual(['Color', 'Orientation', 'Crop'])
  })

  it('a video overlay target still offers Audio — the control for the fix', async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await chooseClipAction('a.mp4', 'Add as overlay')

    await chooseRowAction('a.mp4 at position 1', COPY_SETTINGS)
    await chooseRowAction('overlay a.mp4 at position 1', PASTE_SETTINGS)
    expect(groupsInDialog()).toEqual(['Color', 'Orientation', 'Crop', 'Audio'])
  })

  it("copying a still overlay and pasting onto a clip cannot touch the clip's audio", async () => {
    render(<App />)
    await importClip('a.mp4', 10)
    await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
    await importImage('logo.png')
    await chooseClipAction('logo.png', 'Add as overlay')

    // Dial the clip's volume down, so a reset would be visible.
    const volume = screen.getByRole('spinbutton', { name: 'Volume of a.mp4 at position 1 (0 to 1)' })
    fireEvent.change(volume, { target: { value: '0.25' } })
    fireEvent.blur(volume)

    await chooseRowAction('overlay logo.png at position 1', COPY_SETTINGS)
    await chooseRowAction('a.mp4 at position 1', PASTE_SETTINGS)
    // The checklist a still offers a clip: no Audio to leave checked.
    expect(groupsInDialog()).toEqual(['Color', 'Orientation', 'Crop'])
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Apply' }))

    expect(
      screen.getByRole('spinbutton', { name: 'Volume of a.mp4 at position 1 (0 to 1)' }),
    ).toHaveValue(0.25)
  })
})
