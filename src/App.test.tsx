import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { deserializeProject } from './lib/projectFile'
import type { SaveDestination, SavePort } from './lib/saveProject'
import { chooseFromFileMenu } from './test/fileMenu'
import { openPicture } from './test/pictureDisclosure'
import {
  COPY_SETTINGS,
  DUPLICATE,
  PASTE_SETTINGS,
  chooseRowAction,
} from './test/timelineRowMenu'

/** Confirms the first-save mode dialog (#98), choosing references-only —
 * these tests exercise dirty tracking and open/re-link, not embedding, and
 * jsdom cannot fetch the object URLs an embedded save reads. */
async function saveAsReferences(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await screen.findByRole('dialog', { name: 'Save project' })
  await user.click(within(dialog).getByRole('radio', { name: 'Store references only' }))
  await user.click(within(dialog).getByRole('button', { name: 'Save…' }))
}

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

  const probeMedia = (file: File) =>
    Promise.resolve({ duration: 5, url: `blob:probe/${file.name}`, kind: 'video' as const })

  it('starts clean, dirties on edits, and clears on each save', async () => {
    const { port, writes } = stubPort()
    const user = userEvent.setup()
    render(<App probeMedia={probeMedia} savePort={port} />)

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
    // The first save asks what the file carries (#98).
    await user.click(screen.getByRole('button', { name: 'Save (unsaved changes)' }))
    await saveAsReferences(user)
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

    // Duplicating a row is an ordinary edit (#314): it dirties the project,
    // and the copy is in the next save.
    await chooseRowAction('clip.webm at position 1', DUPLICATE, user)
    expect(screen.getByRole('button', { name: 'Save (unsaved changes)' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save (unsaved changes)' }))
    await waitFor(() => expect(writes).toHaveLength(3))
    const withDuplicate = await deserializeProject(writes[2])
    expect(withDuplicate.ok).toBe(true)
    if (withDuplicate.ok) {
      expect(withDuplicate.project.timeline.entries).toHaveLength(3)
    }

    // Copy settings (#315) is session state, not an edit: the project stays
    // clean. The paste is an ordinary edit: it dirties, and the pasted
    // settings — never the clipboard itself — are in the next save.
    // The grade below sits behind the row's Picture disclosure since #420;
    // reaching it takes one more click and dirties nothing by itself.
    await openPicture('clip.webm at position 1', user)
    const saturation = screen.getByRole('spinbutton', {
      name: 'Saturation of clip.webm at position 1 (percent)',
    })
    fireEvent.change(saturation, { target: { value: '0' } })
    fireEvent.blur(saturation)
    await user.click(screen.getByRole('button', { name: 'Save (unsaved changes)' }))
    await waitFor(() => expect(writes).toHaveLength(4))

    await chooseRowAction('clip.webm at position 1', COPY_SETTINGS, user)
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()

    await chooseRowAction('clip.webm at position 2', PASTE_SETTINGS, user)
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Apply' }))
    expect(screen.getByRole('button', { name: 'Save (unsaved changes)' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save (unsaved changes)' }))
    await waitFor(() => expect(writes).toHaveLength(5))
    const withPaste = await deserializeProject(writes[4])
    expect(withPaste.ok).toBe(true)
    if (withPaste.ok) {
      expect(withPaste.project.timeline.entries[1].colorAdjustments).toEqual({ saturation: 0 })
    }
    // The clipboard never reaches a saved file: the bytes carry no trace of
    // the copied-settings session state.
    expect(new TextDecoder().decode(writes[4])).not.toMatch(/clipboard|copiedSettings/i)
  })

  it('Ctrl+S mid-edit saves the committed state and leaves the field alone', async () => {
    const { port, writes } = stubPort()
    const user = userEvent.setup()
    render(<App probeMedia={probeMedia} savePort={port} />)

    await user.upload(
      screen.getByTestId('clip-file-input'),
      new File(['x'], 'clip.webm', { type: 'video/webm' }),
    )
    await user.click(await screen.findByRole('button', { name: 'Add clip.webm to timeline' }))

    // Establish mode and destination first — a first save would surface the
    // mode dialog (#98), and clicking it would blur (commit) the mid-edit
    // field this test needs to stay uncommitted.
    await user.click(screen.getByRole('button', { name: 'Save (unsaved changes)' }))
    await saveAsReferences(user)
    await waitFor(() => expect(writes).toHaveLength(1))

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

    await waitFor(() => expect(writes).toHaveLength(2))
    // The in-progress edit is untouched, and only committed state was saved.
    expect(inField).toHaveValue(3)
    const saved = await deserializeProject(writes[1])
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

  const probeMedia = (file: File) =>
    Promise.resolve({ duration: 5, url: `blob:probe/${file.name}`, kind: 'video' as const })

  it('New Project discards the current state after confirmation and starts clean', async () => {
    const revokeSpy = vi.fn()
    URL.revokeObjectURL = revokeSpy
    const { port } = stubPort()
    const user = userEvent.setup()
    render(<App probeMedia={probeMedia} savePort={port} />)

    await user.upload(
      screen.getByTestId('clip-file-input'),
      new File(['x'], 'clip.webm', { type: 'video/webm' }),
    )
    await user.click(await screen.findByRole('button', { name: 'Add clip.webm to timeline' }))
    expect(screen.getByRole('button', { name: 'Save (unsaved changes)' })).toBeInTheDocument()

    await chooseFromFileMenu('New Project', user)
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
    render(<App probeMedia={probeMedia} savePort={port} />)

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
    await chooseFromFileMenu('Save As…', user)
    await saveAsReferences(user)
    await waitFor(() => expect(writes).toHaveLength(1))
    await chooseFromFileMenu('New Project', user)
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

describe('chapter markers through the app (#487)', () => {
  it('a marker is an edit: it dirties the project, one undo step removes it, redo restores it', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /^Add$/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Color slate' }))
    expect(screen.getByRole('button', { name: 'Save (unsaved changes)' })).toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', cancelable: true }))
    })
    const field = await screen.findByRole('textbox', { name: /^Name of chapter marker at 0:00/ })
    await user.clear(field)
    await user.type(field, 'Start{Enter}')
    expect(screen.getByRole('button', { name: 'Chapter marker Start at 0:00' })).toBeInTheDocument()

    // Two edits (add, rename): undo twice empties the ticks; redo brings both back.
    const undo = screen.getByRole('button', { name: /^Undo/ })
    await user.click(undo)
    expect(screen.getByRole('button', { name: 'Chapter marker Chapter 1 at 0:00' })).toBeInTheDocument()
    await user.click(undo)
    expect(screen.queryByTestId('preview-marker')).toBeNull()
    const redo = screen.getByRole('button', { name: /^Redo/ })
    await user.click(redo)
    await user.click(redo)
    expect(screen.getByRole('button', { name: 'Chapter marker Start at 0:00' })).toBeInTheDocument()
  })
})

describe('undo and redo wait behind a modal dialog (#559)', () => {
  const chord = (key: string, shiftKey = false) =>
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key, ctrlKey: true, shiftKey, cancelable: true }),
      )
    })

  it('Ctrl+Z and Ctrl+Shift+Z do nothing while a dialog is open, and work again once it closes', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /^Add$/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Color slate' }))
    const slate = () => screen.queryByRole('list', { name: 'Sequence' })
    expect(slate()).not.toBeNull()

    // The removal confirmation (#178) is a modal like the export dialog —
    // role="dialog" with aria-modal — and the one that opens in jsdom
    // without media. Under it, the undo chord leaves the edit standing:
    // undo would have emptied the sequence.
    await user.click(
      screen.getByRole('button', { name: 'Remove Color slate at position 1 from timeline' }),
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    chord('z')
    expect(slate()).not.toBeNull()
    expect(screen.getByRole('dialog')).toBe(dialog)

    // Closed, the same chord undoes the add, and the redo chord restores it.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    chord('z')
    expect(slate()).toBeNull()
    chord('z', true)
    expect(slate()).not.toBeNull()
  })

  it('redo through Ctrl+Y waits behind a dialog too', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /^Add$/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Color slate' }))
    // Undo the add through the toolbar, so there is a step to redo, then
    // open a dialog over the empty timeline: the cheat sheet, the one
    // modal that needs no row. Ctrl+Y under it restores nothing.
    await user.click(screen.getByRole('button', { name: /^Undo/ }))
    expect(screen.queryByRole('list', { name: 'Sequence' })).toBeNull()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', cancelable: true }))
    })
    const sheet = await screen.findByRole('dialog', { name: /shortcuts/i })
    expect(sheet).toHaveAttribute('aria-modal', 'true')
    chord('y')
    expect(screen.queryByRole('list', { name: 'Sequence' })).toBeNull()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    chord('y')
    expect(screen.getByRole('list', { name: 'Sequence' })).toBeInTheDocument()
  })
})

describe('Q and W trim at the playhead through the app (#710)', () => {
  const probeMedia = (file: File) =>
    Promise.resolve({ duration: 5, url: `blob:probe/${file.name}`, kind: 'video' as const })
  const press = (key: string, init: Partial<KeyboardEventInit> = {}) =>
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true, ...init }))
    })
  const field = (edge: 'in' | 'out') =>
    screen.getByRole('spinbutton', { name: `Trim ${edge} point of clip.webm at position 1 in seconds` })

  async function oneClip(user: ReturnType<typeof userEvent.setup>) {
    render(<App probeMedia={probeMedia} />)
    await user.upload(screen.getByTestId('clip-file-input'), new File(['x'], 'clip.webm', { type: 'video/webm' }))
    await user.click(await screen.findByRole('button', { name: 'Add clip.webm to timeline' }))
    expect(field('in')).toHaveValue(0)
    expect(field('out')).toHaveValue(5)
  }

  it('Q, 1 s in, starts the entry on that frame and leaves it 1 s shorter; one Undo restores it', async () => {
    const user = userEvent.setup()
    await oneClip(user)
    // Shift + → is the 1 s step.
    press('ArrowRight', { shiftKey: true })
    press('q')
    expect(field('in')).toHaveValue(1)
    expect(field('out')).toHaveValue(5)
    expect(screen.getByText('plays 4s of 5s')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Undo/ }))
    expect(field('in')).toHaveValue(0)
    expect(field('out')).toHaveValue(5)
  })

  it('W, 1 s before the end, ends the entry on that frame; one Undo restores it', async () => {
    const user = userEvent.setup()
    await oneClip(user)
    press('End')
    press('ArrowLeft', { shiftKey: true })
    press('w')
    expect(field('in')).toHaveValue(0)
    expect(field('out')).toHaveValue(4)
    expect(screen.getByText('plays 4s of 5s')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Undo/ }))
    expect(field('out')).toHaveValue(5)
  })
})

describe('Q lands the playhead on the trimmed entry’s new start (#754)', () => {
  const probeMedia = (file: File) =>
    Promise.resolve({ duration: 5, url: `blob:probe/${file.name}`, kind: 'video' as const })
  const press = (key: string, init: Partial<KeyboardEventInit> = {}) =>
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true, ...init }))
    })
  const playhead = () => Number(screen.getByRole('slider', { name: 'Seek within sequence' }).getAttribute('value'))
  const inOf = (name: string, position: number) =>
    screen.getByRole('spinbutton', { name: `Trim in point of ${name} at position ${position} in seconds` })

  async function clips(user: ReturnType<typeof userEvent.setup>, names: string[]) {
    render(<App probeMedia={probeMedia} />)
    for (const name of names) {
      await user.upload(screen.getByTestId('clip-file-input'), new File(['x'], name, { type: 'video/webm' }))
      await user.click(await screen.findByRole('button', { name: `Add ${name} to timeline` }))
    }
  }

  it('Q 2 s into the first entry trims In to 2 and moves the playhead to 0; Undo leaves it there', async () => {
    const user = userEvent.setup()
    await clips(user, ['clip.webm'])
    press('ArrowRight', { shiftKey: true })
    press('ArrowRight', { shiftKey: true })
    expect(playhead()).toBe(2)
    press('q')
    expect(inOf('clip.webm', 1)).toHaveValue(2)
    // The entry now starts on the frame that was showing, and so does the
    // playhead: sequence 0 is source 2.
    expect(playhead()).toBe(0)
    // Undo restores the trim and, as any undo, leaves the playhead alone.
    await user.click(screen.getByRole('button', { name: /^Undo/ }))
    expect(inOf('clip.webm', 1)).toHaveValue(0)
    expect(playhead()).toBe(0)
  })

  it('Q 1 s into a second entry lands on that entry’s start, after the first', async () => {
    const user = userEvent.setup()
    await clips(user, ['a.webm', 'b.webm'])
    // 6 s: 1 s into b.webm, which starts at 5 s.
    for (let i = 0; i < 6; i++) press('ArrowRight', { shiftKey: true })
    expect(playhead()).toBe(6)
    press('q')
    expect(inOf('b.webm', 2)).toHaveValue(1)
    expect(inOf('a.webm', 1)).toHaveValue(0)
    expect(playhead()).toBe(5)
  })

  it('W leaves the playhead where it was: already on the entry’s new end', async () => {
    const user = userEvent.setup()
    await clips(user, ['a.webm', 'b.webm'])
    for (let i = 0; i < 3; i++) press('ArrowRight', { shiftKey: true })
    press('w')
    expect(screen.getByRole('spinbutton', { name: 'Trim out point of a.webm at position 1 in seconds' })).toHaveValue(3)
    expect(playhead()).toBe(3)
  })

  it('an edit after a Q that did nothing does not move the playhead', async () => {
    const user = userEvent.setup()
    await clips(user, ['clip.webm'])
    // At 0 the entry's own edge: Q is inert, so nothing waits to land.
    press('q')
    expect(inOf('clip.webm', 1)).toHaveValue(0)
    press('ArrowRight', { shiftKey: true })
    press('ArrowRight', { shiftKey: true })
    // An ordinary edit through the row's field: the playhead stays at 2.
    await user.clear(screen.getByRole('spinbutton', { name: 'Trim out point of clip.webm at position 1 in seconds' }))
    await user.type(screen.getByRole('spinbutton', { name: 'Trim out point of clip.webm at position 1 in seconds' }), '4.5{Enter}')
    expect(playhead()).toBe(2)
  })
})

describe('a placeholder row while a file imports (#798)', () => {
  type Probed = { duration: number; url: string; kind: 'video' }

  /** A probe whose results the test settles by hand, one per file name. */
  function heldProbe() {
    const pending = new Map<string, { resolve: (value: Probed) => void; reject: (error: Error) => void }>()
    const started: string[] = []
    const probeMedia = vi.fn(
      (file: File) =>
        new Promise<Probed>((resolve, reject) => {
          started.push(file.name)
          pending.set(file.name, { resolve, reject })
        }),
    )
    const resolve = (name: string) =>
      act(async () => {
        pending.get(name)!.resolve({ duration: 5, url: `blob:probe/${name}`, kind: 'video' })
      })
    const reject = (name: string, reason: string) =>
      act(async () => {
        pending.get(name)!.reject(new Error(reason))
      })
    return { probeMedia, started, resolve, reject }
  }

  const upload = (user: ReturnType<typeof userEvent.setup>, names: string[]) =>
    user.upload(
      screen.getByTestId('clip-file-input'),
      names.map((name) => new File(['x'], name, { type: 'video/webm' })),
    )
  const importingList = () => screen.queryByRole('list', { name: 'Importing clips' })
  const clipNames = () =>
    within(screen.getByRole('list', { name: 'Imported clips' }))
      .getAllByRole('listitem')
      .map((item) => item.querySelector('.clip-name')?.textContent)

  it('shows the row, bar and Cancel while the probe is pending, then the clip in its place', async () => {
    const user = userEvent.setup()
    const probe = heldProbe()
    render(<App probeMedia={probe.probeMedia} />)
    await upload(user, ['long.webm'])
    const row = within(importingList()!).getByRole('listitem')
    expect(row).toHaveTextContent('Importing long.webm…')
    expect(within(row).getByRole('progressbar', { name: 'Importing long.webm' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Cancel importing long.webm' })).toBeInTheDocument()
    // The empty library's hint would contradict the row beside it.
    expect(screen.queryByText(/No clips yet/)).toBeNull()
    expect(screen.queryByRole('list', { name: 'Imported clips' })).toBeNull()

    await probe.resolve('long.webm')
    expect(importingList()).toBeNull()
    expect(clipNames()).toEqual(['long.webm'])
    expect(screen.getByRole('button', { name: 'Add long.webm to timeline' })).toBeInTheDocument()
  })

  it('a failed probe removes the row and lists the file with its reason', async () => {
    const user = userEvent.setup()
    const probe = heldProbe()
    render(<App probeMedia={probe.probeMedia} />)
    await upload(user, ['broken.webm'])
    expect(importingList()).not.toBeNull()
    await probe.reject('broken.webm', '"broken.webm" is not a video this browser can decode.')
    expect(importingList()).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent(
      '"broken.webm" is not a video this browser can decode.',
    )
    expect(screen.queryByRole('list', { name: 'Imported clips' })).toBeNull()
  })

  it('Cancel removes the row at once; the late result is discarded and its URL revoked', async () => {
    const user = userEvent.setup()
    const probe = heldProbe()
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    try {
      render(<App probeMedia={probe.probeMedia} />)
      await upload(user, ['long.webm'])
      // A placeholder is not project content: the project stays clean.
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Cancel importing long.webm' }))
      expect(importingList()).toBeNull()
      // The library is empty again, and says so.
      expect(screen.getByText(/No clips yet/)).toBeInTheDocument()

      await probe.resolve('long.webm')
      expect(screen.queryByRole('list', { name: 'Imported clips' })).toBeNull()
      expect(screen.queryByRole('alert')).toBeNull()
      expect(revoke).toHaveBeenCalledWith('blob:probe/long.webm')
      // Nothing was added, so nothing is unsaved.
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    } finally {
      revoke.mockRestore()
    }
  })

  it('a cancelled file whose probe later fails lists nothing', async () => {
    const user = userEvent.setup()
    const probe = heldProbe()
    render(<App probeMedia={probe.probeMedia} />)
    await upload(user, ['long.webm'])
    await user.click(screen.getByRole('button', { name: 'Cancel importing long.webm' }))
    await probe.reject('long.webm', 'Timed out reading media metadata from "long.webm".')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(importingList()).toBeNull()
  })

  it('several files show a row each at once; cancelling one still waiting skips it and the rest land in order', async () => {
    const user = userEvent.setup()
    const probe = heldProbe()
    render(<App probeMedia={probe.probeMedia} />)
    await upload(user, ['a.webm', 'b.webm', 'c.webm'])
    expect(
      within(importingList()!)
        .getAllByRole('listitem')
        .map((item) => item.querySelector('.import-name')?.textContent),
    ).toEqual(['Importing a.webm…', 'Importing b.webm…', 'Importing c.webm…'])
    // Sequential: only the first file is being read.
    expect(probe.started).toEqual(['a.webm'])

    await user.click(screen.getByRole('button', { name: 'Cancel importing b.webm' }))
    expect(within(importingList()!).getAllByRole('listitem')).toHaveLength(2)

    await probe.resolve('a.webm')
    // b.webm is skipped without ever being read; c.webm is read next.
    expect(probe.started).toEqual(['a.webm', 'c.webm'])
    expect(clipNames()).toEqual(['a.webm'])
    expect(within(importingList()!).getByRole('listitem')).toHaveTextContent('Importing c.webm…')

    await probe.resolve('c.webm')
    expect(importingList()).toBeNull()
    expect(clipNames()).toEqual(['a.webm', 'c.webm'])
  })
})

describe('preview layout (#128, #667)', () => {
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

  const chooseLayout = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
    await user.click(screen.getByRole('button', { name: 'Preview view' }))
    await user.click(screen.getByRole('menuitemradio', { name }))
  }

  it('each View ▾ choice applies and is remembered across mounts (#667)', async () => {
    const storage = fakeStorage()
    const user = userEvent.setup()
    const { container, unmount } = render(<App layoutStorage={storage} />)

    const main = container.querySelector('main')
    expect(main).toHaveAttribute('class', 'app-main')

    await chooseLayout(user, 'Expanded')
    expect(main).toHaveClass('app-main-preview-expanded')

    // A fresh mount (a page load) restores the remembered choice.
    unmount()
    const remounted = render(<App layoutStorage={storage} />)
    expect(remounted.container.querySelector('main')).toHaveClass('app-main-preview-expanded')

    await chooseLayout(user, 'Fit to width')
    expect(remounted.container.querySelector('main')).toHaveClass('app-main-preview-fit')
    expect(remounted.container.querySelector('main')).not.toHaveClass('app-main-preview-expanded')
    remounted.unmount()
    const third = render(<App layoutStorage={storage} />)
    expect(third.container.querySelector('main')).toHaveClass('app-main-preview-fit')

    await chooseLayout(user, 'Default')
    expect(third.container.querySelector('main')).toHaveAttribute('class', 'app-main')
    third.unmount()
    const fourth = render(<App layoutStorage={storage} />)
    expect(fourth.container.querySelector('main')).toHaveAttribute('class', 'app-main')
  })

  it("a browser that chose Expand before View ▾ existed still loads expanded (#667)", () => {
    const { container } = render(
      <App layoutStorage={fakeStorage({ 'browser-video-editor.preview-expanded': '1' })} />,
    )
    expect(container.querySelector('main')).toHaveClass('app-main-preview-expanded')
  })
})
