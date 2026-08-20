import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OpenProjectDialog } from './OpenProjectDialog'
import type { Project } from '../lib/projectFile'

const project: Project = {
  clips: [
    { id: 'a', name: 'first.webm', duration: 5, kind: 'video' },
    { id: 'b', name: 'second.webm', duration: 8, kind: 'video' },
  ],
  timeline: {
    entries: [
      { id: 'e1', clipId: 'a', name: 'first.webm', duration: 5, inPoint: 0, outPoint: 4 },
      { id: 'e2', clipId: 'b', name: 'second.webm', duration: 8, inPoint: 1, outPoint: 8 },
    ],
    transitions: [],
    zooms: [],
    audioTracks: [],
  },
}

/** Probe stub: duration by filename, so tests control match vs. mismatch. */
function stubProbe(durations: Record<string, number>) {
  return vi.fn((file: File) => {
    const duration = durations[file.name]
    return duration === undefined
      ? Promise.reject(new Error(`"${file.name}" is not a video this browser can decode.`))
      : Promise.resolve({
          duration,
          url: `blob:probe/${file.name}`,
          kind: file.type.startsWith('audio/') ? ('audio' as const) : ('video' as const),
        })
  })
}

const pickFiles = async (user: ReturnType<typeof userEvent.setup>, names: string[]) => {
  await user.upload(
    screen.getByTestId('relink-file-input'),
    names.map((name) => new File(['x'], name, { type: 'video/webm' })),
  )
}

const mediaList = () => within(screen.getByRole('list', { name: 'Project media' }))

beforeEach(() => {
  URL.revokeObjectURL = vi.fn()
})

describe('OpenProjectDialog', () => {
  it('lists every project clip as Missing until its media is re-linked', () => {
    render(
      <OpenProjectDialog
        fileName="trip.bvep"
        project={project}
        probeMedia={stubProbe({})}
        onCancel={vi.fn()}
        onOpen={vi.fn()}
      />,
    )
    expect(screen.getByRole('dialog', { name: 'Open trip.bvep' })).toBeInTheDocument()
    const items = mediaList().getAllByRole('listitem')
    expect(items).toHaveLength(2)
    for (const item of items) expect(item).toHaveTextContent('Missing')
    expect(screen.getByRole('button', { name: 'Open project' })).toBeDisabled()
  })

  it('links matching files, keeps mismatches unlinked, and reports them', async () => {
    const user = userEvent.setup()
    render(
      <OpenProjectDialog
        fileName="trip.bvep"
        project={project}
        // first.webm re-probes at its stored duration; second.webm does not.
        probeMedia={stubProbe({ 'first.webm': 5, 'second.webm': 3, 'stranger.webm': 4 })}
        onCancel={vi.fn()}
        onOpen={vi.fn()}
      />,
    )

    await pickFiles(user, ['first.webm', 'second.webm', 'stranger.webm'])

    // The matching file linked; the two problems are reported, not accepted.
    const first = mediaList()
      .getAllByRole('listitem')
      .find((item) => item.textContent?.includes('first.webm'))!
    await waitFor(() => expect(first).toHaveTextContent('Linked'))
    const second = mediaList()
      .getAllByRole('listitem')
      .find((item) => item.textContent?.includes('second.webm'))!
    expect(second).toHaveTextContent('Missing')

    const problems = screen.getByRole('alert')
    expect(problems).toHaveTextContent('expected a duration of 8s, but the picked file is 3s')
    expect(problems).toHaveTextContent('"stranger.webm" is not one of this project\'s media files')

    // The mismatched file's probe URL was released, the linked one kept.
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:probe/second.webm')
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:probe/first.webm')

    // Partially linked is not openable.
    expect(screen.getByRole('button', { name: 'Open project' })).toBeDisabled()
  })

  it('reports a file the probe cannot read', async () => {
    const user = userEvent.setup()
    render(
      <OpenProjectDialog
        fileName="trip.bvep"
        project={project}
        probeMedia={stubProbe({})}
        onCancel={vi.fn()}
        onOpen={vi.fn()}
      />,
    )
    await pickFiles(user, ['first.webm'])
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '"first.webm" is not a video this browser can decode.',
    )
  })

  it('opens with the restored project once every clip is linked', async () => {
    const onOpen = vi.fn()
    const user = userEvent.setup()
    render(
      <OpenProjectDialog
        fileName="trip.bvep"
        project={project}
        probeMedia={stubProbe({ 'first.webm': 5, 'second.webm': 8 })}
        onCancel={vi.fn()}
        onOpen={onOpen}
      />,
    )

    await pickFiles(user, ['first.webm', 'second.webm'])
    const open = screen.getByRole('button', { name: 'Open project' })
    await waitFor(() => expect(open).toBeEnabled())
    await user.click(open)

    expect(onOpen).toHaveBeenCalledOnce()
    const restored = onOpen.mock.calls[0][0]
    expect(restored.clips).toEqual([
      { id: 'a', name: 'first.webm', duration: 5, kind: 'video', url: 'blob:probe/first.webm' },
      { id: 'b', name: 'second.webm', duration: 8, kind: 'video', url: 'blob:probe/second.webm' },
    ])
    expect(restored.timeline.entries).toHaveLength(2)
    expect(restored.timeline.entries[1]).toMatchObject({
      url: 'blob:probe/second.webm',
      inPoint: 1,
      outPoint: 8,
    })
    // Ownership transferred: nothing was revoked on the way out.
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  })

  it('re-links a mixed video + audio project, marking the audio clip (#101)', async () => {
    const mixed: Project = {
      clips: [
        { id: 'v', name: 'holiday.mp4', duration: 10, kind: 'video' },
        { id: 'm', name: 'music.mp3', duration: 185, kind: 'audio' },
      ],
      timeline: {
        entries: [
          { id: 'e1', clipId: 'v', name: 'holiday.mp4', duration: 10, inPoint: 0, outPoint: 10 },
        ],
        transitions: [],
        zooms: [],
        audioTracks: [
          { id: 't1', clipId: 'm', name: 'music.mp3', duration: 185, offset: 3, inPoint: 10, outPoint: 40 },
        ],
      },
    }
    const onOpen = vi.fn()
    const user = userEvent.setup()
    render(
      <OpenProjectDialog
        fileName="trip.bvep"
        project={mixed}
        probeMedia={stubProbe({ 'holiday.mp4': 10, 'music.mp3': 185 })}
        onCancel={vi.fn()}
        onOpen={onOpen}
      />,
    )

    // The audio clip is visibly marked in the re-link list.
    const audioRow = mediaList()
      .getAllByRole('listitem')
      .find((item) => item.textContent?.includes('music.mp3'))
    expect(audioRow).toHaveTextContent('Audio')

    await user.upload(screen.getByTestId('relink-file-input'), [
      new File(['x'], 'holiday.mp4', { type: 'video/mp4' }),
      new File(['x'], 'music.mp3', { type: 'audio/mpeg' }),
    ])
    const open = screen.getByRole('button', { name: 'Open project' })
    await waitFor(() => expect(open).toBeEnabled())
    await user.click(open)

    const restored = onOpen.mock.calls[0][0]
    expect(restored.clips).toEqual([
      { id: 'v', name: 'holiday.mp4', duration: 10, kind: 'video', url: 'blob:probe/holiday.mp4' },
      { id: 'm', name: 'music.mp3', duration: 185, kind: 'audio', url: 'blob:probe/music.mp3' },
    ])
    // The audio track (#102) came back re-linked to the picked file's URL.
    expect(restored.timeline.audioTracks).toEqual([
      {
        id: 't1',
        clipId: 'm',
        name: 'music.mp3',
        duration: 185,
        url: 'blob:probe/music.mp3',
        offset: 3,
        inPoint: 10,
        outPoint: 40,
      },
    ])
  })

  it('cancelling releases every probed URL and opens nothing', async () => {
    const onCancel = vi.fn()
    const onOpen = vi.fn()
    const user = userEvent.setup()
    const { unmount } = render(
      <OpenProjectDialog
        fileName="trip.bvep"
        project={project}
        probeMedia={stubProbe({ 'first.webm': 5 })}
        onCancel={onCancel}
        onOpen={onOpen}
      />,
    )
    await pickFiles(user, ['first.webm'])
    await waitFor(() =>
      expect(
        mediaList()
          .getAllByRole('listitem')
          .find((item) => item.textContent?.includes('first.webm')),
      ).toHaveTextContent('Linked'),
    )

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onOpen).not.toHaveBeenCalled()

    // The parent unmounts the dialog on cancel; that releases the URLs.
    unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:probe/first.webm')
  })

  it('focuses the choose-files action and cancels on Escape', async () => {
    const onCancel = vi.fn()
    const user = userEvent.setup()
    render(
      <OpenProjectDialog
        fileName="trip.bvep"
        project={project}
        probeMedia={stubProbe({})}
        onCancel={onCancel}
        onOpen={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Choose media files…' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
