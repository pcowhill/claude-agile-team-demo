import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { SettingsControl } from './SettingsControl'
import { probeMediaFile } from '../lib/probeMedia'
import { DEFAULT_SETTINGS, SETTINGS_KEY, loadSettings } from '../lib/settings'
import { deserializeProject } from '../lib/projectFile'
import type { SavePort } from '../lib/saveProject'

vi.mock('../lib/probeMedia', () => ({
  probeMediaFile: vi.fn(),
}))

const probeMock = vi.mocked(probeMediaFile)

/** A store that records what was written, like the other preference tests'. */
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

const settingsButton = () => screen.getByRole('button', { name: 'Settings' })
const settingsDialog = () => screen.getByRole('dialog', { name: 'Settings' })

const openSettings = async () => {
  await userEvent.click(settingsButton())
  return settingsDialog()
}

const choose = async (label: string, value: string) => {
  await userEvent.selectOptions(within(settingsDialog()).getByLabelText(label), value)
}

const closeSettings = async () => {
  await userEvent.click(within(settingsDialog()).getByRole('button', { name: 'Close' }))
}

/** Imports one clip through the mocked probe and waits for its library row. */
const importClip = async (name: string, kind: 'video' | 'image', duration = 4) => {
  probeMock.mockResolvedValueOnce({
    duration,
    url: `blob:${name}`,
    kind,
    ...(kind === 'image' ? { width: 100, height: 100 } : {}),
  })
  await userEvent.upload(
    screen.getByTestId('clip-file-input'),
    new File(['content'], name, { type: kind === 'image' ? 'image/png' : 'video/mp4' }),
  )
  await screen.findByRole('button', { name: `Add ${name} to timeline` })
}

const addToTimeline = async (name: string) => {
  await userEvent.click(screen.getByRole('button', { name: `Add ${name} to timeline` }))
}

const durationField = (position: string) =>
  screen.getByRole('spinbutton', { name: `Duration of ${position} in seconds` })

const pressOnWindow = (key: string, init: Partial<KeyboardEventInit> = {}) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true, ...init }))
  })

describe('settings dialog (#286)', () => {
  it('opens from the header gear and shows every preference at its current value', async () => {
    render(<App layoutStorage={fakeStorage()} />)

    const dialog = await openSettings()
    expect(within(dialog).getByLabelText('Playhead nudge (← / →)')).toHaveValue('0.1')
    expect(within(dialog).getByLabelText('Playhead jump (Shift + ← / →)')).toHaveValue('1')
    expect(within(dialog).getByLabelText('New still or slate duration')).toHaveValue('5')
    expect(within(dialog).getByLabelText('When a previous session is found')).toHaveValue('ask')
    // Exactly the values the product used before it had settings, read from
    // an empty store — the "a fresh visitor sees today's behaviour" promise,
    // observed through the UI rather than only in the module's own tests.
    expect(within(dialog).getByLabelText('Default export format')).toHaveValue(
      DEFAULT_SETTINGS.exportFormat,
    )
  })

  it('dismisses with Escape and with a click outside, like the other dialogs', async () => {
    render(<App layoutStorage={fakeStorage()} />)

    await openSettings()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument()

    const dialog = await openSettings()
    // Focus is inside the dialog, so a keyboard user is not left behind on
    // the page while a modal is up.
    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus()
    await userEvent.click(document.querySelector('.dialog-overlay') as HTMLElement)
    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument()
  })

  it('offers the formats this browser can record, and keeps a stored one it cannot', async () => {
    // Rendered directly, because the format list comes from a MediaRecorder
    // probe jsdom cannot answer: with the probe injected the row behaves as
    // it does in a browser.
    const onChange = vi.fn()
    const { unmount } = render(
      <SettingsControl
        settings={DEFAULT_SETTINGS}
        onChange={onChange}
        isTypeSupported={() => true}
      />,
    )
    await userEvent.click(settingsButton())
    const formatSelect = within(settingsDialog()).getByLabelText('Default export format')
    // The core video formats (#114). Audio-only needs Web Audio, which jsdom
    // does not have, so it is legitimately absent here.
    expect(
      Array.from(formatSelect.querySelectorAll('option')).map((option) => option.textContent),
    ).toEqual(['WebM', 'MP4'])

    await userEvent.selectOptions(formatSelect, 'mp4')
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, exportFormat: 'mp4' })
    unmount()

    // A format the browser cannot record — or whose plugin is off — must
    // still show as the setting's value. Silently displaying some other
    // format's row would make the dialog misreport the very thing it exists
    // to show.
    render(
      <SettingsControl
        settings={{ ...DEFAULT_SETTINGS, exportFormat: 'gif' }}
        onChange={onChange}
        isTypeSupported={() => false}
      />,
    )
    await userEvent.click(settingsButton())
    const offline = within(settingsDialog()).getByLabelText('Default export format')
    expect(offline).toHaveValue('gif')
    expect(offline).toHaveTextContent('gif (not available in this browser)')
  })
})

describe('settings take effect without a reload (#286)', () => {
  it('a chosen playhead nudge steps the transport, and the cheat sheet says so', async () => {
    render(<App layoutStorage={fakeStorage()} />)
    await importClip('a.mp4', 'video')
    await addToTimeline('a.mp4')

    const slider = () => screen.getByRole('slider', { name: 'Seek within sequence' })
    pressOnWindow('ArrowRight')
    expect(slider()).toHaveValue('0.1')

    await openSettings()
    await choose('Playhead nudge (← / →)', '0.25')
    await choose('Playhead jump (Shift + ← / →)', '2')
    await closeSettings()

    // No reload between the choice and the effect.
    pressOnWindow('ArrowRight')
    expect(slider()).toHaveValue('0.35')
    pressOnWindow('ArrowRight', { shiftKey: true })
    expect(slider()).toHaveValue('2.35')

    // The cheat sheet documents the keys, so it has to follow the setting —
    // otherwise the app ships help text that contradicts the app.
    pressOnWindow('?', { shiftKey: true })
    const sheet = screen.getByRole('dialog', { name: 'Keyboard shortcuts' })
    expect(sheet).toHaveTextContent('Step the playhead 0.25 s back / forward')
    expect(sheet).toHaveTextContent('Step the playhead 2 s back / forward')
  })

  it('a chosen still duration applies to the next still and slate, not to earlier ones', async () => {
    render(<App layoutStorage={fakeStorage()} />)
    await importClip('c.png', 'image', 0)
    await addToTimeline('c.png')
    expect(durationField('c.png at position 1')).toHaveValue(5)

    await openSettings()
    await choose('New still or slate duration', '10')
    await closeSettings()

    await addToTimeline('c.png')
    await userEvent.click(screen.getByRole('button', { name: 'Add color slate to timeline' }))

    // A still overlay layer is a still too (#294): `videoOverlay.ts` pins its
    // default to the sequence still's, so the setting has to reach it — a
    // still showing for 10 s beside a still *layer* showing for 5 would
    // contradict that rule.
    await userEvent.click(screen.getByRole('button', { name: 'Add c.png as overlay' }))

    // The new still, the new slate and the new overlay all take the chosen
    // duration…
    expect(durationField('c.png at position 2')).toHaveValue(10)
    expect(durationField('Color slate at position 3')).toHaveValue(10)
    expect(durationField('overlay c.png at position 1')).toHaveValue(10)
    // …and the one that was already on the timeline keeps its own, which is
    // what "applies to newly added items only" has to mean.
    expect(durationField('c.png at position 1')).toHaveValue(5)
  })
})

describe('settings persistence (#286)', () => {
  it('remembers the choices per browser, under their own key', async () => {
    const storage = fakeStorage()
    const { unmount } = render(<App layoutStorage={storage} />)

    await openSettings()
    await choose('New still or slate duration', '3')
    await choose('When a previous session is found', 'never')
    await closeSettings()

    // Written through immediately, not on unmount: a crash or a closed tab
    // must not lose the choice.
    expect(loadSettings(storage)).toEqual({
      ...DEFAULT_SETTINGS,
      stillDurationSeconds: 3,
      sessionRestore: 'never',
    })

    // A fresh mount is a page load: the stored values come back.
    unmount()
    render(<App layoutStorage={storage} />)
    const dialog = await openSettings()
    expect(within(dialog).getByLabelText('New still or slate duration')).toHaveValue('3')
    expect(within(dialog).getByLabelText('When a previous session is found')).toHaveValue('never')
  })

  it('keeps the settings out of the saved project, in the browser store instead', async () => {
    // The autosave snapshot's structure record is exactly the bytes
    // `serializeProject` produces (lib/autosave.ts), so asserting on a saved
    // file covers the snapshot too — the same argument #311's own test made.
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
    await importClip('a.mp4', 'video')
    await addToTimeline('a.mp4')
    await openSettings()
    await choose('Playhead nudge (← / →)', '0.5')
    await closeSettings()

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
      expect(serialized).not.toContain(SETTINGS_KEY)
      expect(serialized).not.toContain('stepSeconds')
    }
    // Discriminating: the choice was made and did persist — to the
    // per-browser store, under its own key, and nowhere near the project.
    expect(loadSettings(storage).stepSeconds).toBe(0.5)
  })
})
