import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectControls } from './ProjectControls'
import type { MediaLibraryState } from '../lib/mediaLibrary'
import { deserializeProject } from '../lib/projectFile'
import type { SaveDestination, SavePort } from '../lib/saveProject'
import type { TimelineState } from '../lib/timeline'

const library: MediaLibraryState = {
  clips: [{ id: 'c1', name: 'holiday.mp4', duration: 10, url: 'blob:c1' }],
  failures: [],
}
const timeline: TimelineState = {
  entries: [
    { id: 'e1', clipId: 'c1', name: 'holiday.mp4', duration: 10, url: 'blob:c1', inPoint: 1, outPoint: 8 },
  ],
  transitions: [],
  zooms: [],
}

/** A port whose picker always yields one recording destination. */
function stubPort(name = 'picked.bvep') {
  const writes: Uint8Array<ArrayBuffer>[] = []
  const destination: SaveDestination = {
    name,
    write: vi.fn((bytes: Uint8Array<ArrayBuffer>) => {
      writes.push(bytes)
      return Promise.resolve()
    }),
  }
  const pickDestination = vi.fn(() => Promise.resolve({ kind: 'picked' as const, destination }))
  const port: SavePort = { kind: 'file-system-access', pickDestination }
  return { port, pickDestination, destination, writes }
}

describe('ProjectControls saving', () => {
  it('Save without a destination asks once, then saves silently, and the file round-trips', async () => {
    const { port, pickDestination, writes } = stubPort()
    const onSaved = vi.fn()
    const user = userEvent.setup()
    render(
      <ProjectControls library={library} timeline={timeline} dirty onSaved={onSaved} port={port} />,
    )

    await user.click(screen.getByRole('button', { name: /^Save(?! As)/ }))
    await screen.findByText('Saved as picked.bvep')
    expect(pickDestination).toHaveBeenCalledExactlyOnceWith('project.bvep')
    expect(onSaved).toHaveBeenCalledExactlyOnceWith({ clips: library.clips, timeline })

    // What was written is a real project file carrying the current state.
    expect(writes).toHaveLength(1)
    const result = await deserializeProject(writes[0])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.clips).toEqual([{ id: 'c1', name: 'holiday.mp4', duration: 10 }])
      expect(result.project.timeline.entries[0]).toMatchObject({ inPoint: 1, outPoint: 8 })
    }

    // A second Save re-uses the destination without asking again.
    await user.click(screen.getByRole('button', { name: /^Save(?! As)/ }))
    await waitFor(() => expect(writes).toHaveLength(2))
    expect(pickDestination).toHaveBeenCalledOnce()
  })

  it('Save As… asks again even with an established destination', async () => {
    const { port, pickDestination, writes } = stubPort()
    const user = userEvent.setup()
    render(
      <ProjectControls library={library} timeline={timeline} dirty onSaved={vi.fn()} port={port} />,
    )

    await user.click(screen.getByRole('button', { name: 'Save As…' }))
    await waitFor(() => expect(writes).toHaveLength(1))
    await user.click(screen.getByRole('button', { name: 'Save As…' }))
    await waitFor(() => expect(writes).toHaveLength(2))
    expect(pickDestination).toHaveBeenCalledTimes(2)
    // The established name is re-suggested the second time.
    expect(pickDestination).toHaveBeenLastCalledWith('picked.bvep')
  })

  it('a canceled picker saves nothing and reports nothing', async () => {
    const pickDestination = vi.fn(() => Promise.resolve({ kind: 'canceled' as const }))
    const port: SavePort = { kind: 'file-system-access', pickDestination }
    const onSaved = vi.fn()
    const user = userEvent.setup()
    render(
      <ProjectControls library={library} timeline={timeline} dirty onSaved={onSaved} port={port} />,
    )

    await user.click(screen.getByRole('button', { name: /^Save(?! As)/ }))
    await waitFor(() => expect(pickDestination).toHaveBeenCalledOnce())
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(/^Saved as/)).not.toBeInTheDocument()
  })

  it('a failing write surfaces as an alert and keeps the state unsaved', async () => {
    const destination: SaveDestination = {
      name: 'full.bvep',
      write: () => Promise.reject(new Error('disk full')),
    }
    const port: SavePort = {
      kind: 'file-system-access',
      pickDestination: () => Promise.resolve({ kind: 'picked', destination }),
    }
    const onSaved = vi.fn()
    const user = userEvent.setup()
    render(
      <ProjectControls library={library} timeline={timeline} dirty onSaved={onSaved} port={port} />,
    )

    await user.click(screen.getByRole('button', { name: /^Save(?! As)/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save: disk full')
    expect(onSaved).not.toHaveBeenCalled()
  })
})

describe('the unsaved-changes indicator', () => {
  it('is part of the Save button and readable by name, not color-only', () => {
    const { port } = stubPort()
    const { rerender } = render(
      <ProjectControls library={library} timeline={timeline} dirty={false} onSaved={vi.fn()} port={port} />,
    )
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()

    rerender(
      <ProjectControls library={library} timeline={timeline} dirty onSaved={vi.fn()} port={port} />,
    )
    expect(screen.getByRole('button', { name: 'Save (unsaved changes)' })).toBeInTheDocument()
  })
})

describe('the keyboard shortcut', () => {
  const pressSave = (init: KeyboardEventInit) => {
    const event = new KeyboardEvent('keydown', { key: 's', cancelable: true, ...init })
    let defaultPrevented = false
    act(() => {
      defaultPrevented = !window.dispatchEvent(event)
    })
    return defaultPrevented
  }

  it.each([{ ctrlKey: true }, { metaKey: true }])(
    'saves and suppresses the browser dialog on %o + S',
    async (modifier) => {
      const { port, writes } = stubPort()
      render(
        <ProjectControls library={library} timeline={timeline} dirty onSaved={vi.fn()} port={port} />,
      )
      expect(pressSave(modifier)).toBe(true)
      await waitFor(() => expect(writes).toHaveLength(1))
    },
  )

  it('ignores a plain S and modified combinations that are not Save', () => {
    const { port, pickDestination } = stubPort()
    render(
      <ProjectControls library={library} timeline={timeline} dirty onSaved={vi.fn()} port={port} />,
    )
    expect(pressSave({})).toBe(false)
    expect(pressSave({ ctrlKey: true, shiftKey: true })).toBe(false)
    expect(pressSave({ ctrlKey: true, altKey: true })).toBe(false)
    expect(pickDestination).not.toHaveBeenCalled()
  })
})

describe('New Project and Open Project (#77)', () => {
  /** Gzips a JSON document into project-file-shaped bytes. */
  async function gzipJson(document: unknown): Promise<Uint8Array<ArrayBuffer>> {
    const stream = new CompressionStream('gzip')
    const writer = stream.writable.getWriter()
    void writer.write(new TextEncoder().encode(JSON.stringify(document)))
    void writer.close()
    const chunks: Uint8Array[] = []
    const reader = stream.readable.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
    let offset = 0
    for (const chunk of chunks) {
      out.set(chunk, offset)
      offset += chunk.length
    }
    return out
  }

  const uploadProjectFile = async (
    user: ReturnType<typeof userEvent.setup>,
    bytes: Uint8Array,
    name = 'trip.bvep',
  ) => {
    await user.upload(
      screen.getByTestId('project-file-input'),
      new File([bytes as unknown as BlobPart], name, { type: 'application/gzip' }),
    )
  }

  it('New Project with unsaved changes asks first, and cancelling keeps everything', async () => {
    const { port } = stubPort()
    const onProjectReplaced = vi.fn()
    const user = userEvent.setup()
    render(
      <ProjectControls
        library={library}
        timeline={timeline}
        dirty
        onSaved={vi.fn()}
        onProjectReplaced={onProjectReplaced}
        port={port}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'New Project' }))
    const dialog = screen.getByRole('dialog', { name: 'Discard unsaved changes?' })
    expect(dialog).toHaveTextContent('Starting a new project will discard your unsaved changes.')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onProjectReplaced).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('confirming New Project resets to the empty startup state', async () => {
    const { port } = stubPort()
    const onProjectReplaced = vi.fn()
    const user = userEvent.setup()
    render(
      <ProjectControls
        library={library}
        timeline={timeline}
        dirty
        onSaved={vi.fn()}
        onProjectReplaced={onProjectReplaced}
        port={port}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'New Project' }))
    await user.click(screen.getByRole('button', { name: 'Discard and start new' }))
    expect(onProjectReplaced).toHaveBeenCalledOnce()
    const replaced = onProjectReplaced.mock.calls[0][0]
    expect(replaced.clips).toHaveLength(0)
    expect(replaced.timeline.entries).toHaveLength(0)
  })

  it('New Project with a clean state resets without asking', async () => {
    const { port } = stubPort()
    const onProjectReplaced = vi.fn()
    const user = userEvent.setup()
    render(
      <ProjectControls
        library={library}
        timeline={timeline}
        dirty={false}
        onSaved={vi.fn()}
        onProjectReplaced={onProjectReplaced}
        port={port}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'New Project' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onProjectReplaced).toHaveBeenCalledOnce()
  })

  it('Open Project with unsaved changes asks first, and cancelling opens nothing', async () => {
    const { port } = stubPort()
    const onProjectReplaced = vi.fn()
    const user = userEvent.setup()
    render(
      <ProjectControls
        library={library}
        timeline={timeline}
        dirty
        onSaved={vi.fn()}
        onProjectReplaced={onProjectReplaced}
        port={port}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Open Project…' }))
    const dialog = screen.getByRole('dialog', { name: 'Discard unsaved changes?' })
    expect(dialog).toHaveTextContent('Opening a project will discard your unsaved changes.')
    expect(screen.getByRole('button', { name: 'Discard and open' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onProjectReplaced).not.toHaveBeenCalled()
  })

  it('a corrupt file reports the reason and leaves the current project untouched', async () => {
    const { port } = stubPort()
    const onProjectReplaced = vi.fn()
    const user = userEvent.setup()
    render(
      <ProjectControls
        library={library}
        timeline={timeline}
        dirty={false}
        onSaved={vi.fn()}
        onProjectReplaced={onProjectReplaced}
        port={port}
      />,
    )
    await uploadProjectFile(user, new TextEncoder().encode('not gzip at all'))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not open: not a project file (the data is not valid gzip)',
    )
    expect(onProjectReplaced).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('a newer-version file reports the descriptive schema error', async () => {
    const { port } = stubPort()
    const onProjectReplaced = vi.fn()
    const user = userEvent.setup()
    render(
      <ProjectControls
        library={library}
        timeline={timeline}
        dirty={false}
        onSaved={vi.fn()}
        onProjectReplaced={onProjectReplaced}
        port={port}
      />,
    )
    await uploadProjectFile(
      user,
      await gzipJson({
        format: 'browser-video-editor-project',
        schemaVersion: 99,
        clips: [],
        timeline: { entries: [], transitions: [], zooms: [] },
      }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'saved by a newer version of the editor',
    )
    expect(onProjectReplaced).not.toHaveBeenCalled()
  })

  it('opening a valid file runs the re-link dialog and replaces the project', async () => {
    const { port } = stubPort()
    const onProjectReplaced = vi.fn()
    const probeVideo = vi.fn((file: File) =>
      Promise.resolve({ duration: 10, url: `blob:probe/${file.name}` }),
    )
    URL.revokeObjectURL = vi.fn()
    const user = userEvent.setup()
    render(
      <ProjectControls
        library={library}
        timeline={timeline}
        dirty={false}
        onSaved={vi.fn()}
        onProjectReplaced={onProjectReplaced}
        port={port}
        probeVideo={probeVideo}
      />,
    )

    const { serializeProject } = await import('../lib/projectFile')
    await uploadProjectFile(user, await serializeProject(library, timeline))

    await screen.findByRole('dialog', { name: 'Open trip.bvep' })
    await user.upload(
      screen.getByTestId('relink-file-input'),
      new File(['x'], 'holiday.mp4', { type: 'video/mp4' }),
    )
    const open = screen.getByRole('button', { name: 'Open project' })
    await waitFor(() => expect(open).toBeEnabled())
    await user.click(open)

    expect(onProjectReplaced).toHaveBeenCalledOnce()
    const replaced = onProjectReplaced.mock.calls[0][0]
    expect(replaced.clips).toEqual([
      { id: 'c1', name: 'holiday.mp4', duration: 10, url: 'blob:probe/holiday.mp4' },
    ])
    expect(replaced.timeline.entries[0]).toMatchObject({
      clipId: 'c1',
      url: 'blob:probe/holiday.mp4',
      inPoint: 1,
      outPoint: 8,
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opening a project with no clips applies immediately, without the re-link step', async () => {
    const { port } = stubPort()
    const onProjectReplaced = vi.fn()
    const user = userEvent.setup()
    render(
      <ProjectControls
        library={{ clips: [], failures: [] }}
        timeline={{ entries: [] }}
        dirty={false}
        onSaved={vi.fn()}
        onProjectReplaced={onProjectReplaced}
        port={port}
      />,
    )
    const { serializeProject } = await import('../lib/projectFile')
    await uploadProjectFile(
      user,
      await serializeProject({ clips: [], failures: [] }, { entries: [] }),
    )
    await waitFor(() => expect(onProjectReplaced).toHaveBeenCalledOnce())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onProjectReplaced.mock.calls[0][0].clips).toHaveLength(0)
  })

  it('replacing the project resets the save destination and status text', async () => {
    const { port, pickDestination, writes } = stubPort()
    const user = userEvent.setup()
    render(
      <ProjectControls
        library={library}
        timeline={timeline}
        dirty
        onSaved={vi.fn()}
        onProjectReplaced={vi.fn()}
        port={port}
      />,
    )

    // Establish a destination, then start a new project.
    await user.click(screen.getByRole('button', { name: 'Save As…' }))
    await screen.findByText('Saved as picked.bvep')
    await user.click(screen.getByRole('button', { name: 'New Project' }))
    await user.click(screen.getByRole('button', { name: 'Discard and start new' }))

    // The old project's status is gone, and the next Save asks again.
    expect(screen.queryByText('Saved as picked.bvep')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Save(?! As)/ }))
    await waitFor(() => expect(writes).toHaveLength(2))
    expect(pickDestination).toHaveBeenCalledTimes(2)
  })
})
