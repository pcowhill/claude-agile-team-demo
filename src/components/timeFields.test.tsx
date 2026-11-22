import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { probeMediaFile } from '../lib/probeMedia'
import { chooseFromFileMenu } from '../test/fileMenu'
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

    expect(outField).toHaveValue(seconds === 83 ? '1:23.000' : '1:23.500')
    // The stored value, read through the row's seconds summary.
    expect(screen.getByText(`plays ${seconds}s of 90s`)).toBeInTheDocument()
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
