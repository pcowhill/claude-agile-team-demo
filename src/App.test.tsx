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

describe('Open and New Project (#77)', () => {
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

  it('New Project discards the current state after confirmation and starts clean', async () => {
    const revokeSpy = vi.fn()
    URL.revokeObjectURL = revokeSpy
    const { port } = stubPort()
    const user = userEvent.setup()
    render(<App probeVideo={probeVideo} savePort={port} />)

    await user.upload(
      screen.getByTestId('clip-file-input'),
      new File(['x'], 'clip.webm', { type: 'video/webm' }),
    )
    await user.click(await screen.findByRole('button', { name: 'Add clip.webm to timeline' }))
    expect(screen.getByRole('button', { name: 'Save (unsaved changes)' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'New Project' }))
    await user.click(screen.getByRole('button', { name: 'Discard and start new' }))

    // Library and timeline are back to the empty startup state, dirty is
    // cleared, and the discarded clip's memory was released.
    expect(screen.getByText(/No clips yet/)).toBeInTheDocument()
    expect(screen.getByText('Add clips to the timeline to preview your edit.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(revokeSpy).toHaveBeenCalledWith('blob:probe/clip.webm')
  })

  it('a saved project reopens through re-linking and starts clean', async () => {
    URL.revokeObjectURL = vi.fn()
    const { port, writes } = stubPort()
    const user = userEvent.setup()
    render(<App probeVideo={probeVideo} savePort={port} />)

    // Build: one clip on the timeline, trimmed to [1, 4].
    await user.upload(
      screen.getByTestId('clip-file-input'),
      new File(['x'], 'clip.webm', { type: 'video/webm' }),
    )
    await user.click(await screen.findByRole('button', { name: 'Add clip.webm to timeline' }))
    const inField = screen.getByRole('spinbutton', {
      name: 'Trim in point of clip.webm at position 1 in seconds',
    })
    await user.clear(inField)
    await user.type(inField, '1')
    await user.tab()
    const outField = screen.getByRole('spinbutton', {
      name: 'Trim out point of clip.webm at position 1 in seconds',
    })
    await user.clear(outField)
    await user.type(outField, '4')
    await user.tab()

    // Save, then wipe with New Project (clean after saving → no guard).
    await user.click(screen.getByRole('button', { name: 'Save As…' }))
    await waitFor(() => expect(writes).toHaveLength(1))
    await user.click(screen.getByRole('button', { name: 'New Project' }))
    expect(screen.getByText(/No clips yet/)).toBeInTheDocument()

    // Open the saved bytes and re-link the media file.
    await user.upload(
      screen.getByTestId('project-file-input'),
      new File([writes[0] as unknown as BlobPart], 'trip.bvep', { type: 'application/gzip' }),
    )
    await screen.findByRole('dialog', { name: 'Open trip.bvep' })
    await user.upload(
      screen.getByTestId('relink-file-input'),
      new File(['x'], 'clip.webm', { type: 'video/webm' }),
    )
    const open = screen.getByRole('button', { name: 'Open project' })
    await waitFor(() => expect(open).toBeEnabled())
    await user.click(open)

    // The editing state is back — library clip, trimmed entry — and clean.
    expect(
      screen.getByRole('button', { name: 'Add clip.webm to timeline' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('spinbutton', {
        name: 'Trim in point of clip.webm at position 1 in seconds',
      }),
    ).toHaveValue(1)
    expect(
      screen.getByRole('spinbutton', {
        name: 'Trim out point of clip.webm at position 1 in seconds',
      }),
    ).toHaveValue(4)
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()

    // The next edit dirties the reopened project again.
    await user.click(screen.getByRole('button', { name: 'Add clip.webm to timeline' }))
    expect(screen.getByRole('button', { name: 'Save (unsaved changes)' })).toBeInTheDocument()
  })
})
