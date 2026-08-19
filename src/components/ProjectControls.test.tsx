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
