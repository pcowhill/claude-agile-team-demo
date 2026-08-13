import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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
    expect(screen.getByText(/audio is not included yet/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Export video' }))
    expect(screen.getByRole('button', { name: 'Export video' })).toBeDisabled()
    expect(screen.getByRole('progressbar', { name: 'Export progress' })).toBeInTheDocument()

    reportProgress!(0.5)
    await waitFor(() => expect(screen.getByTestId('export-progress-text')).toHaveTextContent('50%'))

    finish!(new Blob(['x'.repeat(2000)], { type: 'video/webm' }))
    const link = await screen.findByTestId('export-download')
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
