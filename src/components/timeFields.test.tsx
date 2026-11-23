import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { probeMediaFile } from '../lib/probeMedia'
import { chooseClipAction } from '../test/clipMenu'
import { chooseFromFileMenu } from '../test/fileMenu'
import { ADD_SPEED, chooseEffect } from '../test/timelineRowMenu'
import { DEFAULT_SETTINGS, SETTINGS_KEY } from '../lib/settings'
import type { TimeFormat } from '../lib/timeFormat'
import { TimeFormatContext } from './timeFormatContext'
import { TrimField } from './TrimDialog'

/**
 * The Time fields setting (#848, from #847): seconds boxes show and take
 * `m:ss.mmm` when it is on minutes and seconds. Rendered through the whole
 * app for the timeline's fields, so the setting reaches them the way it
 * does for a user — from the stored preference, through the provider.
 */

vi.mock('../lib/probeMedia', () => ({
  probeMediaFile: vi.fn(),
}))

// jsdom has no Web Audio: an audio track's waveform decode is mocked, as in
// Timeline.test.tsx, so the row renders without a rejected decode.
vi.mock('../lib/audioPeaks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/audioPeaks')>()
  return {
    ...actual,
    peaksForClip: vi.fn(() => Promise.resolve(new Float32Array([0.2, 0.8, 0.5, 0.3]))),
    levelsForClip: vi.fn(() => Promise.resolve(null)),
  }
})

const probeMock = vi.mocked(probeMediaFile)

const storeTimeFormat = (timeFormat: TimeFormat) =>
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, timeFormat }))

/** One 90 s clip on the timeline, so an out point reads over a minute. */
const addClip = async () => {
  probeMock.mockResolvedValueOnce({ duration: 90, url: 'blob:a.mp4', kind: 'video' })
  await userEvent.upload(
    screen.getByTestId('clip-file-input'),
    new File(['content'], 'a.mp4', { type: 'video/mp4' }),
  )
  await screen.findByText('a.mp4')
  await userEvent.click(screen.getByRole('button', { name: 'Add a.mp4 to timeline' }))
}

const IN = 'Trim in point of a.mp4 at position 1 in seconds'
const OUT = 'Trim out point of a.mp4 at position 1 in seconds'

describe('Time fields: minutes and seconds on the timeline (#848)', () => {
  it('shows the stored times as m:ss.mmm in text boxes, without the s unit', async () => {
    storeTimeFormat('minutes')
    render(<App />)
    await addClip()

    const inField = screen.getByRole('textbox', { name: IN })
    const outField = screen.getByRole('textbox', { name: OUT })
    expect(inField).toHaveValue('0:00.000')
    expect(outField).toHaveValue('1:30.000')
    // The colon says what the number is; the drawn unit is gone.
    expect(outField.parentElement?.querySelector('.timeline-unit')).toBeNull()
  })

  it.each([
    ['1:23.5', 83.5],
    ['1:23.500', 83.5],
    ['1:23', 83],
    ['83.5', 83.5],
  ])('commits %j as %s s', async (typed, seconds) => {
    storeTimeFormat('minutes')
    render(<App />)
    await addClip()

    const outField = screen.getByRole('textbox', { name: OUT })
    await userEvent.clear(outField)
    await userEvent.type(outField, `${typed}{Enter}`)

    const shown = seconds === 83 ? '1:23.000' : '1:23.500'
    expect(outField).toHaveValue(shown)
    // The stored value, read through the row's summary, which follows the
    // setting too (#849).
    expect(screen.getByText(`plays ${shown} of 1:30.000`)).toBeInTheDocument()
  })

  it.each(['1:75', 'abc', ''])('commits nothing for %j and shows the stored value again', async (typed) => {
    storeTimeFormat('minutes')
    render(<App />)
    await addClip()

    const outField = screen.getByRole('textbox', { name: OUT })
    await userEvent.clear(outField)
    if (typed !== '') await userEvent.type(outField, typed)
    await userEvent.tab()

    expect(outField).toHaveValue('1:30.000')
  })

  it('steps by the field step with ↑ and ↓, committing at once', async () => {
    storeTimeFormat('minutes')
    render(<App />)
    await addClip()

    const inField = screen.getByRole('textbox', { name: IN })
    await userEvent.click(inField)
    await userEvent.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}')
    expect(inField).toHaveValue('0:00.300')
    await userEvent.keyboard('{ArrowDown}')
    expect(inField).toHaveValue('0:00.200')
    // Committed, not a draft: leaving the box keeps it.
    await userEvent.tab()
    expect(inField).toHaveValue('0:00.200')
  })

  it('switches between the two formats with no reload', async () => {
    render(<App />)
    await addClip()
    expect(screen.getByRole('spinbutton', { name: OUT })).toHaveValue(90)

    await chooseFromFileMenu('Settings…')
    const select = screen.getByRole('combobox', { name: 'Time fields' })
    expect(select).toHaveValue('seconds')
    await userEvent.selectOptions(select, 'minutes')
    expect(screen.getByRole('textbox', { name: OUT })).toHaveValue('1:30.000')
    await userEvent.selectOptions(select, 'seconds')
    expect(screen.getByRole('spinbutton', { name: OUT })).toHaveValue(90)
  })
})

describe('Time fields: the rows\' seconds summaries follow the setting (#849)', () => {
  const importMedia = async (name: string, kind: 'video' | 'audio' | 'image', duration: number) => {
    probeMock.mockResolvedValueOnce(
      kind === 'image'
        ? { duration: 0, url: `blob:${name}`, kind, width: 640, height: 480 }
        : { duration, url: `blob:${name}`, kind },
    )
    const type = kind === 'image' ? 'image/png' : kind === 'audio' ? 'audio/mpeg' : 'video/mp4'
    await userEvent.upload(screen.getByTestId('clip-file-input'), new File(['content'], name, { type }))
    await screen.findByText(name)
  }

  it('reads a sequence entry\'s plays, of and remapped in m:ss.mmm, with no s', async () => {
    storeTimeFormat('minutes')
    render(<App />)
    await addClip()

    const outField = screen.getByRole('textbox', { name: OUT })
    await userEvent.clear(outField)
    await userEvent.type(outField, '1:23.5{Enter}')
    expect(screen.getByText('plays 1:23.500 of 1:30.000')).toBeInTheDocument()

    // A 2 s span at 0.5× plays for 4 s: 83.5 − 2 + 4 = 85.5 s in the sequence.
    await chooseEffect('a.mp4 at position 1', ADD_SPEED)
    expect(screen.getByText('plays 1:23.500 of 1:30.000 — 1:25.500 remapped')).toBeInTheDocument()
  })

  it('reads an audio track\'s plays and of in m:ss.mmm', async () => {
    storeTimeFormat('minutes')
    render(<App />)
    await importMedia('music.mp3', 'audio', 75.25)
    await userEvent.click(screen.getByRole('button', { name: 'Add music.mp3 to timeline' }))

    expect(screen.getByText('plays 1:15.250 of 1:15.250')).toBeInTheDocument()
  })

  it('reads a video overlay\'s plays, of and remapped, and an image overlay\'s shows, in m:ss.mmm', async () => {
    storeTimeFormat('minutes')
    render(<App />)
    await importMedia('cam.mp4', 'video', 10)
    await chooseClipAction('cam.mp4', 'Add as overlay')
    await chooseEffect('overlay cam.mp4 at position 1', ADD_SPEED)
    // A 2 s span at 0.5× shows for 4 s: 10 − 2 + 4 = 12 s on screen.
    expect(screen.getByText('plays 0:10.000 of 0:10.000 — 0:12.000 remapped')).toBeInTheDocument()

    await importMedia('logo.png', 'image', 0)
    await chooseClipAction('logo.png', 'Add as overlay')
    expect(screen.getByText('shows 0:05.000')).toBeInTheDocument()
  })

  it('switches back to today\'s seconds text with no reload', async () => {
    storeTimeFormat('minutes')
    render(<App />)
    await addClip()
    expect(screen.getByText('plays 1:30.000 of 1:30.000')).toBeInTheDocument()

    await chooseFromFileMenu('Settings…')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Time fields' }), 'seconds')
    expect(screen.getByText('plays 90s of 90s')).toBeInTheDocument()
  })
})

describe('Time fields: a finer stored value survives a minutes box untouched (#848)', () => {
  const renderField = (value: number) => {
    const onCommit = vi.fn()
    render(
      <TimeFormatContext value="minutes">
        <TrimField label="In" value={value} max={100} onCommit={onCommit} />
      </TimeFormatContext>,
    )
    return { onCommit, field: screen.getByRole('textbox', { name: 'In' }) }
  }

  it('commits nothing on a focus and blur', async () => {
    const { onCommit, field } = renderField(12.3456)
    expect(field).toHaveValue('0:12.346')
    await userEvent.click(field)
    await userEvent.tab()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('commits nothing for retyping the text it shows', async () => {
    const { onCommit, field } = renderField(12.3456)
    await userEvent.clear(field)
    await userEvent.type(field, '0:12.346{Enter}')
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('commits a typed change, and steps with the arrows, in the Trim window field', async () => {
    const { onCommit, field } = renderField(12.3456)
    await userEvent.clear(field)
    await userEvent.type(field, '1:05.25{Enter}')
    expect(onCommit).toHaveBeenLastCalledWith(65.25)
    fireEvent.keyDown(field, { key: 'ArrowUp' })
    expect(onCommit).toHaveBeenLastCalledWith(12.446)
  })

  it('is a seconds number box with no provider, as before', () => {
    render(<TrimField label="In" value={12.5} max={100} onCommit={vi.fn()} />)
    expect(screen.getByRole('spinbutton', { name: 'In' })).toHaveValue(12.5)
  })
})
