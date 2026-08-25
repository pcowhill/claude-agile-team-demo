import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportPanel } from './ExportPanel'
import { ExportCanceledError, exportTimeline } from '../lib/exportVideo'
import type { TimelineState } from '../lib/timeline'

const timeline: TimelineState = {
  entries: [
    {
      id: 'e1',
      clipId: 'c1',
      name: 'first.webm',
      duration: 10,
      url: 'blob:first',
      inPoint: 0,
      outPoint: 10,
    },
  ],
}

// jsdom implements neither object URLs nor anchor navigation; the real
// media pipeline is covered by e2e/export.spec.ts.
beforeEach(() => {
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:export-result'),
    revokeObjectURL: vi.fn(),
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ExportPanel', () => {
  it('disables exporting while the timeline is empty', () => {
    render(<ExportPanel timeline={{ entries: [] }} />)
    expect(screen.getByRole('button', { name: 'Export video' })).toBeDisabled()
    expect(screen.getByText(/add clips to the timeline/i)).toBeInTheDocument()
  })

  it('shows progress while exporting, then a download link that auto-clicks', async () => {
    let reportProgress: ((fraction: number) => void) | undefined
    let finish: ((blob: Blob) => void) | undefined
    const doExport: typeof exportTimeline = (_timeline, options = {}) => {
      reportProgress = options.onProgress
      return new Promise((resolve) => {
        finish = resolve
      })
    }
    const user = userEvent.setup()
    render(<ExportPanel timeline={timeline} doExport={doExport} />)
    expect(screen.queryByText(/audio is not included/i)).not.toBeInTheDocument()
    expect(screen.getByText(/audio exports at the preview’s levels/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Export video' }))
    expect(screen.getByRole('button', { name: 'Export video' })).toBeDisabled()
    expect(screen.getByRole('progressbar', { name: 'Export progress' })).toBeInTheDocument()

    act(() => reportProgress!(0.5))
    expect(screen.getByTestId('export-progress-text')).toHaveTextContent('50%')

    // Resolve inside act() so the 'done' render AND its passive effects are
    // flushed before asserting (#47): the download link enters the DOM at
    // commit, but the auto-click fires from a useEffect afterwards. findBy*
    // only waits for the DOM, so asserting the click after it was a race.
    await act(async () => {
      finish!(new Blob(['x'.repeat(2000)], { type: 'video/webm' }))
    })
    const link = screen.getByTestId('export-download')
    expect(link).toHaveAttribute('href', 'blob:export-result')
    expect(link).toHaveAttribute('download', 'sequence-export.webm')
    expect(link).toHaveTextContent('2 kB')
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Export video' })).toBeEnabled()
  })

  it('cancel aborts the export and returns quietly to idle', async () => {
    const doExport: typeof exportTimeline = (_timeline, options = {}) =>
      new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new ExportCanceledError()))
      })
    const user = userEvent.setup()
    render(<ExportPanel timeline={timeline} doExport={doExport} />)

    await user.click(screen.getByRole('button', { name: 'Export video' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Export video' })).toBeEnabled(),
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByTestId('export-download')).not.toBeInTheDocument()
  })

  // What the injected detector reports drives the picker (#114); the real
  // default consults MediaRecorder.isTypeSupported, absent in jsdom.
  const recordsEverything = () => true
  const recordsWebmOnly = (type: string) => type.startsWith('video/webm')

  it('offers exactly the formats the browser reports recordable (#114)', () => {
    render(<ExportPanel timeline={timeline} isTypeSupported={recordsEverything} />)
    const picker = screen.getByRole('combobox', { name: 'Format' })
    const options = within(picker).getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual(['WebM', 'MP4'])
    // No behavior change for existing users: WebM stays the default.
    expect(picker).toHaveValue('webm')
  })

  it('hides the picker when only one format is supported (#114)', () => {
    render(<ExportPanel timeline={timeline} isTypeSupported={recordsWebmOnly} />)
    expect(screen.queryByRole('combobox', { name: 'Format' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export video' })).toBeEnabled()
  })

  it('exports the selected format and names the download after it (#114)', async () => {
    let requestedFormat: string | undefined
    const doExport: typeof exportTimeline = (_timeline, options = {}) => {
      requestedFormat = options.format
      return Promise.resolve(new Blob(['x'], { type: 'video/mp4' }))
    }
    const user = userEvent.setup()
    render(
      <ExportPanel timeline={timeline} doExport={doExport} isTypeSupported={recordsEverything} />,
    )

    await user.selectOptions(screen.getByRole('combobox', { name: 'Format' }), 'mp4')
    await user.click(screen.getByRole('button', { name: 'Export video' }))

    const link = await screen.findByTestId('export-download')
    expect(requestedFormat).toBe('mp4')
    expect(link).toHaveAttribute('download', 'sequence-export.mp4')
    expect(link).toHaveTextContent('sequence-export.mp4')
  })

  it('defaults the export to WebM with the .webm filename (#114)', async () => {
    let requestedFormat: string | undefined
    const doExport: typeof exportTimeline = (_timeline, options = {}) => {
      requestedFormat = options.format
      return Promise.resolve(new Blob(['x'], { type: 'video/webm' }))
    }
    const user = userEvent.setup()
    render(
      <ExportPanel timeline={timeline} doExport={doExport} isTypeSupported={recordsEverything} />,
    )

    await user.click(screen.getByRole('button', { name: 'Export video' }))

    const link = await screen.findByTestId('export-download')
    expect(requestedFormat).toBe('webm')
    expect(link).toHaveAttribute('download', 'sequence-export.webm')
  })

  it('surfaces failures as a visible error message', async () => {
    const doExport: typeof exportTimeline = () =>
      Promise.reject(new Error('This browser cannot encode WebM video.'))
    const user = userEvent.setup()
    render(<ExportPanel timeline={timeline} doExport={doExport} />)

    await user.click(screen.getByRole('button', { name: 'Export video' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This browser cannot encode WebM video.',
    )
    expect(screen.getByRole('button', { name: 'Export video' })).toBeEnabled()
  })
})
