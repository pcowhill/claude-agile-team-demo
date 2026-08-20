import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectControls } from './ProjectControls'
import type { LibraryClip, MediaLibraryState } from '../lib/mediaLibrary'
import { deserializeProject } from '../lib/projectFile'
import type { ClipMedia } from '../lib/projectFile'
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

/** ASCII bytes without TextEncoder, whose jsdom output fails toEqual against
 * same-realm Uint8Arrays despite identical contents. */
const asciiBytes = (text: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(text, (char) => char.charCodeAt(0))

/** Deterministic clip media, standing in for fetching real object URLs. */
const stubClipMedia = (clip: LibraryClip): Promise<ClipMedia> =>
  Promise.resolve({ bytes: asciiBytes(`media:${clip.id}`), mimeType: 'video/mp4' })

/** Drives the save-mode dialog (#98): optionally switches mode, confirms. */
async function confirmSaveDialog(
  user: ReturnType<typeof userEvent.setup>,
  mode?: 'embed' | 'references',
) {
  const dialog = await screen.findByRole('dialog', { name: 'Save project' })
  if (mode === 'references') {
    await user.click(within(dialog).getByRole('radio', { name: 'Store references only' }))
  } else if (mode === 'embed') {
    await user.click(within(dialog).getByRole('radio', { name: 'Embed media in the project file' }))
  }
  await user.click(within(dialog).getByRole('button', { name: 'Save…' }))
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
  it('first Save surfaces the mode choice defaulting to embed; confirming writes an embedded file', async () => {
    const { port, pickDestination, writes } = stubPort()
    const onSaved = vi.fn()
    const user = userEvent.setup()
    render(
      <ProjectControls
        library={library}
        timeline={timeline}
        dirty
        onSaved={onSaved}
        port={port}
        fetchClipMedia={stubClipMedia}
      />,
    )

    // The first save of a new project asks what the file should carry (#98),
    // with embedding preselected as the default.
    await user.click(screen.getByRole('button', { name: /^Save(?! As)/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Save project' })
    expect(
      within(dialog).getByRole('radio', { name: 'Embed media in the project file' }),
    ).toBeChecked()
    await user.click(within(dialog).getByRole('button', { name: 'Save…' }))

    await screen.findByText('Saved as picked.bvep')
    expect(pickDestination).toHaveBeenCalledExactlyOnceWith('project.bvep')
    expect(onSaved).toHaveBeenCalledExactlyOnceWith({ clips: library.clips, timeline })

    // What was written is a real embedded project file carrying the state.
    expect(writes).toHaveLength(1)
    const result = await deserializeProject(writes[0])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.clips).toEqual([{ id: 'c1', name: 'holiday.mp4', duration: 10 }])
      expect(result.project.timeline.entries[0]).toMatchObject({ inPoint: 1, outPoint: 8 })
      expect(result.media?.get('c1')).toEqual({
        bytes: asciiBytes('media:c1'),
        mimeType: 'video/mp4',
      })
    }

    // A second Save re-uses destination AND mode: no dialog, no picker.
    await user.click(screen.getByRole('button', { name: /^Save(?! As)/ }))
    await waitFor(() => expect(writes).toHaveLength(2))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(pickDestination).toHaveBeenCalledOnce()
  })

  it('choosing references-only writes a references file, and Save reuses the mode silently', async () => {
    const { port, pickDestination, writes } = stubPort()
    const user = userEvent.setup()
    // Deliberately no fetchClipMedia: an accidental embedded save would fail
    // loudly instead of passing this test.
    render(
      <ProjectControls library={library} timeline={timeline} dirty onSaved={vi.fn()} port={port} />,
    )

    await user.click(screen.getByRole('button', { name: /^Save(?! As)/ }))
    await confirmSaveDialog(user, 'references')
    await waitFor(() => expect(writes).toHaveLength(1))
    const result = await deserializeProject(writes[0])
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.media).toBeUndefined()

    await user.click(screen.getByRole('button', { name: /^Save(?! As)/ }))
    await waitFor(() => expect(writes).toHaveLength(2))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(pickDestination).toHaveBeenCalledOnce()
  })

  it('Save As… re-asks destination and mode, preselecting the remembered mode', async () => {
    const { port, pickDestination, writes } = stubPort()
    const user = userEvent.setup()
    render(
      <ProjectControls
        library={library}
        timeline={timeline}
        dirty
        onSaved={vi.fn()}
        port={port}
        fetchClipMedia={stubClipMedia}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Save As…' }))
    await confirmSaveDialog(user, 'references')
    await waitFor(() => expect(writes).toHaveLength(1))

    // The second Save As… preselects the remembered mode; switch to embed.
    await user.click(screen.getByRole('button', { name: 'Save As…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Save project' })
    expect(within(dialog).getByRole('radio', { name: 'Store references only' })).toBeChecked()
    await user.click(
      within(dialog).getByRole('radio', { name: 'Embed media in the project file' }),
    )
    await user.click(within(dialog).getByRole('button', { name: 'Save…' }))
    await waitFor(() => expect(writes).toHaveLength(2))
    expect(pickDestination).toHaveBeenCalledTimes(2)
    // The established name is re-suggested the second time.
    expect(pickDestination).toHaveBeenLastCalledWith('picked.bvep')

    const first = await deserializeProject(writes[0])
    const second = await deserializeProject(writes[1])
    expect(first.ok && second.ok).toBe(true)
    if (first.ok) expect(first.media).toBeUndefined()
    if (second.ok) expect(second.media?.has('c1')).toBe(true)
  })

  it('cancelling the mode dialog saves nothing and asks nothing further', async () => {
    const { port, pickDestination, writes } = stubPort()
    const user = userEvent.setup()
    render(
      <ProjectControls library={library} timeline={timeline} dirty onSaved={vi.fn()} port={port} />,
    )
    await user.click(screen.getByRole('button', { name: 'Save As…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Save project' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(pickDestination).not.toHaveBeenCalled()
    expect(writes).toHaveLength(0)
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
    await confirmSaveDialog(user)
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
    await confirmSaveDialog(user, 'references')
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save: disk full')
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('a clip whose media cannot be read fails an embedded save with its name', async () => {
    const { port } = stubPort()
    const user = userEvent.setup()
    render(
      <ProjectControls
        library={library}
        timeline={timeline}
        dirty
        onSaved={vi.fn()}
        port={port}
        fetchClipMedia={() => Promise.reject(new Error('unreadable'))}
      />,
    )
    await user.click(screen.getByRole('button', { name: /^Save(?! As)/ }))
    await confirmSaveDialog(user)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not save: could not read the media for clip "holiday.mp4" (unreadable)',
    )
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
    'suppresses the browser dialog on %o + S and saves silently once a mode is known',
    async (modifier) => {
      const { port, writes } = stubPort()
      const user = userEvent.setup()
      render(
        <ProjectControls
          library={library}
          timeline={timeline}
          dirty
          onSaved={vi.fn()}
          port={port}
          fetchClipMedia={stubClipMedia}
        />,
      )
      // The shortcut is a Save: on a never-saved project it runs the
      // first-save flow, mode dialog included (#98).
      expect(pressSave(modifier)).toBe(true)
      await confirmSaveDialog(user)
      await waitFor(() => expect(writes).toHaveLength(1))

      // With mode and destination established, the shortcut asks nothing.
      expect(pressSave(modifier)).toBe(true)
      await waitFor(() => expect(writes).toHaveLength(2))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
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
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
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

  it('replacing the project resets the save destination, status text, and mode', async () => {
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

    // Establish a destination and a mode, then start a new project.
    await user.click(screen.getByRole('button', { name: 'Save As…' }))
    await confirmSaveDialog(user, 'references')
    await screen.findByText('Saved as picked.bvep')
    await user.click(screen.getByRole('button', { name: 'New Project' }))
    await user.click(screen.getByRole('button', { name: 'Discard and start new' }))

    // The old project's status is gone, and the next Save is a first save
    // again: the mode dialog reappears defaulting to embed (not the previous
    // project's references choice), and the picker asks again.
    expect(screen.queryByText('Saved as picked.bvep')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Save(?! As)/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Save project' })
    expect(
      within(dialog).getByRole('radio', { name: 'Embed media in the project file' }),
    ).toBeChecked()
    await user.click(within(dialog).getByRole('radio', { name: 'Store references only' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save…' }))
    await waitFor(() => expect(writes).toHaveLength(2))
    expect(pickDestination).toHaveBeenCalledTimes(2)
  })

  describe('embedded project files (#98)', () => {
    const embeddedMedia = new Map<string, ClipMedia>([
      ['c1', { bytes: asciiBytes('embedded-bytes'), mimeType: 'video/mp4' }],
    ])

    it('an embedded file opens with no re-link step and re-saves embedded without asking', async () => {
      const { port, writes } = stubPort()
      const onProjectReplaced = vi.fn()
      const createMediaUrl = vi.fn((_blob: Blob) => 'blob:restored-c1')
      const user = userEvent.setup()
      render(
        <ProjectControls
          library={library}
          timeline={timeline}
          dirty={false}
          onSaved={vi.fn()}
          onProjectReplaced={onProjectReplaced}
          port={port}
          createMediaUrl={createMediaUrl}
          fetchClipMedia={stubClipMedia}
        />,
      )

      const { serializeProject } = await import('../lib/projectFile')
      await uploadProjectFile(user, await serializeProject(library, timeline, embeddedMedia))

      // The project replaced immediately, fully linked — no re-link dialog.
      await waitFor(() => expect(onProjectReplaced).toHaveBeenCalledOnce())
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      const replaced = onProjectReplaced.mock.calls[0][0]
      expect(replaced.clips).toEqual([
        { id: 'c1', name: 'holiday.mp4', duration: 10, url: 'blob:restored-c1' },
      ])
      expect(replaced.timeline.entries[0]).toMatchObject({ url: 'blob:restored-c1' })
      // The URL was minted from the embedded bytes.
      const blob = createMediaUrl.mock.calls[0][0]
      expect(new Uint8Array(await blob.arrayBuffer())).toEqual(asciiBytes('embedded-bytes'))

      // Save re-writes embedded without asking about the mode (#98).
      await user.click(screen.getByRole('button', { name: /^Save(?! As)/ }))
      await waitFor(() => expect(writes).toHaveLength(1))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      const saved = await deserializeProject(writes[0])
      expect(saved.ok).toBe(true)
      if (saved.ok) expect(saved.media?.has('c1')).toBe(true)
    })

    it('a references file opened through re-linking re-saves references-only without asking', async () => {
      const { port, writes } = stubPort()
      const onProjectReplaced = vi.fn()
      const probeVideo = vi.fn((file: File) =>
        Promise.resolve({ duration: 10, url: `blob:probe/${file.name}` }),
      )
      URL.revokeObjectURL = vi.fn()
      const user = userEvent.setup()
      // Deliberately no fetchClipMedia: an accidental embedded save would
      // fail loudly instead of passing this test.
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

      // Save writes a references file without surfacing the mode dialog.
      await user.click(screen.getByRole('button', { name: /^Save(?! As)/ }))
      await waitFor(() => expect(writes).toHaveLength(1))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      const saved = await deserializeProject(writes[0])
      expect(saved.ok).toBe(true)
      if (saved.ok) expect(saved.media).toBeUndefined()
    })
  })
})
