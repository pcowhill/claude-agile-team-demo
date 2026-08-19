import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { deserializeProject } from './lib/projectFile'
import type { SaveDestination, SavePort } from './lib/saveProject'

describe('App shell', () => {
  it('renders the application title', () => {
    render(<App />)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Browser Video Editor' }),
    ).toBeInTheDocument()
  })

  it('renders the three editor regions the MVP will fill in', () => {
    render(<App />)
    expect(screen.getByRole('region', { name: 'Media library' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Preview' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Timeline' })).toBeInTheDocument()
  })
})

describe('unsaved-changes tracking (#76)', () => {
  function stubPort() {
    const writes: Uint8Array<ArrayBuffer>[] = []
    const destination: SaveDestination = {
      name: 'project.bvep',
      write: (bytes: Uint8Array<ArrayBuffer>) => {
        writes.push(bytes)
        return Promise.resolve()
      },
    }
    const port: SavePort = {
      kind: 'file-system-access',
      pickDestination: vi.fn(() => Promise.resolve({ kind: 'picked' as const, destination })),
    }
    return { port, writes }
  }

  const probeVideo = (file: File) =>
    Promise.resolve({ duration: 5, url: `blob:probe/${file.name}` })

  it('starts clean, dirties on edits, and clears on each save', async () => {
    const { port, writes } = stubPort()
    const user = userEvent.setup()
    render(<App probeVideo={probeVideo} savePort={port} />)

    // A fresh, empty session shows no unsaved-changes indicator.
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()

    // The first change — importing a clip — raises it.
    await user.upload(
      screen.getByTestId('clip-file-input'),
      new File(['x'], 'clip.webm', { type: 'video/webm' }),
    )
    await screen.findByRole('button', { name: 'Add clip.webm to timeline' })
    expect(screen.getByRole('button', { name: 'Save (unsaved changes)' })).toBeInTheDocument()

    // Further edits keep it raised.
    await user.click(screen.getByRole('button', { name: 'Add clip.webm to timeline' }))
    expect(screen.getByRole('button', { name: 'Save (unsaved changes)' })).toBeInTheDocument()

    // A successful save clears it, and the saved file carries the state.
    await user.click(screen.getByRole('button', { name: 'Save (unsaved changes)' }))
    await screen.findByText('Saved as project.bvep')
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(writes).toHaveLength(1)
    const saved = await deserializeProject(writes[0])
    expect(saved.ok).toBe(true)
    if (saved.ok) {
      expect(saved.project.clips.map((clip) => clip.name)).toEqual(['clip.webm'])
      expect(saved.project.timeline.entries).toHaveLength(1)
    }

    // The next edit raises it again; the next save clears it again.
    await user.click(screen.getByRole('button', { name: 'Add clip.webm to timeline' }))
    expect(screen.getByRole('button', { name: 'Save (unsaved changes)' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save (unsaved changes)' }))
    await waitFor(() => expect(writes).toHaveLength(2))
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('Ctrl+S mid-edit saves the committed state and leaves the field alone', async () => {
    const { port, writes } = stubPort()
    const user = userEvent.setup()
    render(<App probeVideo={probeVideo} savePort={port} />)

    await user.upload(
      screen.getByTestId('clip-file-input'),
      new File(['x'], 'clip.webm', { type: 'video/webm' }),
    )
    await user.click(await screen.findByRole('button', { name: 'Add clip.webm to timeline' }))

    // Start editing a trim field but do not commit (no blur, no Enter).
    const inField = screen.getByRole('spinbutton', {
      name: 'Trim in point of clip.webm at position 1 in seconds',
    })
    await user.clear(inField)
    await user.type(inField, '3')

    const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true })
    let defaultPrevented = false
    act(() => {
      defaultPrevented = !window.dispatchEvent(event)
    })
    expect(defaultPrevented).toBe(true)

    await waitFor(() => expect(writes).toHaveLength(1))
    // The in-progress edit is untouched, and only committed state was saved.
    expect(inField).toHaveValue(3)
    const saved = await deserializeProject(writes[0])
    expect(saved.ok).toBe(true)
    if (saved.ok) expect(saved.project.timeline.entries[0].inPoint).toBe(0)
  })
})
