import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportControl } from './ExportControl'
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

// What the injected detector reports drives the offered formats (#114); the
// real default consults MediaRecorder.isTypeSupported, absent in jsdom.
const recordsEverything = () => true
const recordsWebmOnly = (type: string) => type.startsWith('video/webm')

const openButton = () => screen.getByRole('button', { name: 'Export Project…' })
const exportButton = () => screen.getByRole('button', { name: 'Export' })

describe('ExportControl', () => {
  it('disables the toolbar button while the timeline is empty', () => {
    render(<ExportControl timeline={{ entries: [] }} />)
    expect(openButton()).toBeDisabled()
  })

  it('opens the modal, and Cancel closes it without exporting', async () => {
    const doExport = vi.fn<typeof exportTimeline>()
    const user = userEvent.setup()
    render(
      <ExportControl timeline={timeline} doExport={doExport} isTypeSupported={recordsEverything} />,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(openButton())
    expect(screen.getByRole('dialog', { name: 'Export project' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(doExport).not.toHaveBeenCalled()
  })

  it('shows progress while exporting, then downloads and closes the modal', async () => {
    let reportProgress: ((fraction: number) => void) | undefined
    let finish: ((blob: Blob) => void) | undefined
    const doExport: typeof exportTimeline = (_timeline, options = {}) => {
      reportProgress = options.onProgress
      return new Promise((resolve) => {
        finish = resolve
      })
    }
    const user = userEvent.setup()
    render(<ExportControl timeline={timeline} doExport={doExport} />)

    await user.click(openButton())
    await user.click(exportButton())
    expect(exportButton()).toBeDisabled()
    expect(screen.getByRole('progressbar', { name: 'Export progress' })).toBeInTheDocument()

    act(() => reportProgress!(0.5))
    expect(screen.getByTestId('export-progress-text')).toHaveTextContent('50%')

    // Resolve inside act() so the finished render AND its passive effects are
    // flushed before asserting (#47): the download anchor enters the DOM at
    // commit, but the auto-click fires from a useEffect afterwards.
    await act(async () => {
      finish!(new Blob(['x'.repeat(2000)], { type: 'video/webm' }))
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const link = screen.getByTestId('export-download')
    expect(link).toHaveAttribute('href', 'blob:export-result')
    expect(link).toHaveAttribute('download', 'sequence-export.webm')
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce()
  })

  it('cancel mid-export aborts it and closes the modal quietly', async () => {
    const doExport: typeof exportTimeline = (_timeline, options = {}) =>
      new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new ExportCanceledError()))
      })
    const user = userEvent.setup()
    render(<ExportControl timeline={timeline} doExport={doExport} />)

    await user.click(openButton())
    await user.click(exportButton())
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByTestId('export-download')).not.toBeInTheDocument()
    expect(openButton()).toBeEnabled()
  })

  it('offers exactly the formats the browser reports recordable (#114)', async () => {
    const user = userEvent.setup()
    render(<ExportControl timeline={timeline} isTypeSupported={recordsEverything} />)
    await user.click(openButton())
    const radios = screen.getAllByRole('radio')
    expect(radios.map((radio) => radio.closest('label')?.textContent)).toEqual(['WebM', 'MP4'])
    // No behavior change for existing users: WebM stays the default.
    expect(screen.getByRole('radio', { name: 'WebM' })).toBeChecked()
  })

  it('offers only WebM when MP4 is not recordable (#114)', async () => {
    const user = userEvent.setup()
    render(<ExportControl timeline={timeline} isTypeSupported={recordsWebmOnly} />)
    await user.click(openButton())
    expect(screen.queryByRole('radio', { name: 'MP4' })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'WebM' })).toBeChecked()
  })

  it('exports the selected format and names the download after it (#114)', async () => {
    let requestedFormat: string | undefined
    const doExport: typeof exportTimeline = (_timeline, options = {}) => {
      requestedFormat = options.format
      return Promise.resolve(new Blob(['x'], { type: 'video/mp4' }))
    }
    const user = userEvent.setup()
    render(
      <ExportControl timeline={timeline} doExport={doExport} isTypeSupported={recordsEverything} />,
    )

    await user.click(openButton())
    await user.click(screen.getByRole('radio', { name: 'MP4' }))
    await user.click(exportButton())

    const link = await screen.findByTestId('export-download')
    expect(requestedFormat).toBe('mp4')
    expect(link).toHaveAttribute('download', 'sequence-export.mp4')
  })

  it('surfaces failures in the modal, which stays open for a retry', async () => {
    const doExport: typeof exportTimeline = () =>
      Promise.reject(new Error('This browser cannot encode WebM video.'))
    const user = userEvent.setup()
    render(<ExportControl timeline={timeline} doExport={doExport} />)

    await user.click(openButton())
    await user.click(exportButton())
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This browser cannot encode WebM video.',
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(exportButton()).toBeEnabled()
  })

  it('does not carry a stale error into a reopened modal', async () => {
    const doExport: typeof exportTimeline = () => Promise.reject(new Error('boom'))
    const user = userEvent.setup()
    render(<ExportControl timeline={timeline} doExport={doExport} />)

    await user.click(openButton())
    await user.click(exportButton())
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await user.click(openButton())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('output settings (#179)', () => {
  const probeHD = () => Promise.resolve({ width: 1280, height: 720 })
  const widthField = () => screen.getByRole('spinbutton', { name: 'Export width in pixels' })
  const heightField = () => screen.getByRole('spinbutton', { name: 'Export height in pixels' })
  const frameRateField = () =>
    screen.getByRole('spinbutton', { name: 'Export frame rate in frames per second' })
  const sizeSelect = () => screen.getByRole('combobox', { name: 'Export size preset' })

  it('pre-fills the fields with the automatic frame and default frame rate', async () => {
    const user = userEvent.setup()
    render(<ExportControl timeline={timeline} probeFrame={probeHD} />)
    await user.click(openButton())

    expect(sizeSelect()).toHaveValue('auto')
    await waitFor(() => expect(widthField()).toHaveValue(1280))
    expect(heightField()).toHaveValue(720)
    expect(frameRateField()).toHaveValue(30)
  })

  it('presets populate the fields; Auto restores the automatic values', async () => {
    const user = userEvent.setup()
    render(<ExportControl timeline={timeline} probeFrame={probeHD} />)
    await user.click(openButton())
    await waitFor(() => expect(widthField()).toHaveValue(1280))

    await user.selectOptions(sizeSelect(), 'uhd')
    expect(widthField()).toHaveValue(3840)
    expect(heightField()).toHaveValue(2160)

    await user.selectOptions(sizeSelect(), 'auto')
    await waitFor(() => expect(widthField()).toHaveValue(1280))
    expect(heightField()).toHaveValue(720)
  })

  it('editing a field switches the selector to Custom and the export honors the values', async () => {
    let requested: { frame?: { width: number; height: number }; frameRate?: number } = {}
    const doExport: typeof exportTimeline = (_timeline, options = {}) => {
      requested = { frame: options.frame, frameRate: options.frameRate }
      return Promise.resolve(new Blob(['x'], { type: 'video/webm' }))
    }
    const user = userEvent.setup()
    render(<ExportControl timeline={timeline} doExport={doExport} probeFrame={probeHD} />)
    await user.click(openButton())
    await waitFor(() => expect(widthField()).toHaveValue(1280))

    await user.clear(widthField())
    await user.type(widthField(), '640')
    expect(sizeSelect()).toHaveValue('custom')
    await user.clear(heightField())
    await user.type(heightField(), '360')
    await user.clear(frameRateField())
    await user.type(frameRateField(), '24')

    await user.click(exportButton())
    await screen.findByTestId('export-download')
    expect(requested.frame).toEqual({ width: 640, height: 360 })
    expect(requested.frameRate).toBe(24)
  })

  it('Auto sends no frame override, keeping the automatic export path', async () => {
    let requested: { frame?: unknown; frameRate?: number } = { frame: 'unset' }
    const doExport: typeof exportTimeline = (_timeline, options = {}) => {
      requested = { frame: options.frame, frameRate: options.frameRate }
      return Promise.resolve(new Blob(['x'], { type: 'video/webm' }))
    }
    const user = userEvent.setup()
    render(<ExportControl timeline={timeline} doExport={doExport} probeFrame={probeHD} />)
    await user.click(openButton())
    await waitFor(() => expect(widthField()).toHaveValue(1280))

    await user.click(exportButton())
    await screen.findByTestId('export-download')
    expect(requested.frame).toBeUndefined()
    expect(requested.frameRate).toBe(30)
  })

  it('invalid input disables Export and explains the bounds', async () => {
    const user = userEvent.setup()
    render(<ExportControl timeline={timeline} probeFrame={probeHD} />)
    await user.click(openButton())
    await waitFor(() => expect(widthField()).toHaveValue(1280))

    await user.clear(widthField())
    await user.type(widthField(), '0')
    expect(exportButton()).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('whole numbers')

    await user.clear(widthField())
    await user.type(widthField(), '854')
    expect(exportButton()).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await user.clear(frameRateField())
    await user.type(frameRateField(), '-5')
    expect(exportButton()).toBeDisabled()
  })

  it('reopening the modal returns to the automatic settings', async () => {
    const user = userEvent.setup()
    render(<ExportControl timeline={timeline} probeFrame={probeHD} />)
    await user.click(openButton())
    await waitFor(() => expect(widthField()).toHaveValue(1280))
    await user.selectOptions(sizeSelect(), 'web')
    expect(widthField()).toHaveValue(854)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    // One-export-only settings (#169): a fresh open follows the sources again.
    await user.click(openButton())
    expect(sizeSelect()).toHaveValue('auto')
    await waitFor(() => expect(widthField()).toHaveValue(1280))
    expect(frameRateField()).toHaveValue(30)
  })
})
