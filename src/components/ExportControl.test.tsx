import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportControl } from './ExportControl'
import type { DoExport } from './ExportControl'
import { ExportCanceledError } from '../lib/exportVideo'
import { exportFormats } from '../lib/exportFormats'
import { FALLBACK_FRAME, presetFrame } from '../lib/frameSize'
import { slateEntry } from '../lib/timeline'
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
    const doExport = vi.fn<DoExport>()
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
    const doExport: DoExport = (_timeline, options) => {
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
    const doExport: DoExport = (_timeline, options) =>
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
    const doExport: DoExport = (_timeline, options) => {
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
    const doExport: DoExport = () =>
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
    const doExport: DoExport = () => Promise.reject(new Error('boom'))
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
    const doExport: DoExport = (_timeline, options) => {
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

  it('the automatic size reflects the project canvas preset, still sending no override (#274)', async () => {
    // The default probe (automaticExportFrame) applies the preset to the
    // same shared rule the export uses; a slate-only timeline probes no
    // media in jsdom, so the shown values are the fallback frame reshaped
    // to 9:16. Auto stays "no frame override" — the export derives the
    // preset frame itself, rather than the modal baking it into a one-off
    // override.
    let requested: { frame?: unknown } = { frame: 'unset' }
    const doExport: DoExport = (_timeline, options) => {
      requested = { frame: options.frame }
      return Promise.resolve(new Blob(['x'], { type: 'video/webm' }))
    }
    const preset = presetFrame(FALLBACK_FRAME, '9:16')
    const user = userEvent.setup()
    render(
      <ExportControl
        timeline={{ entries: [slateEntry('s1')], canvasPreset: '9:16' }}
        doExport={doExport}
      />,
    )
    await user.click(openButton())

    expect(sizeSelect()).toHaveValue('auto')
    await waitFor(() => expect(widthField()).toHaveValue(preset.width))
    expect(heightField()).toHaveValue(preset.height)

    await user.click(exportButton())
    await screen.findByTestId('export-download')
    expect(requested.frame).toBeUndefined()
  })

  it('Auto sends no frame override, keeping the automatic export path', async () => {
    let requested: { frame?: unknown; frameRate?: number } = { frame: 'unset' }
    const doExport: DoExport = (_timeline, options) => {
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

describe('format notes (#198)', () => {
  it('shows the selected format\'s note and nothing for formats without one', async () => {
    const user = userEvent.setup()
    exportFormats.register({
      id: 'noted',
      label: 'Noted format',
      extension: 'noted',
      candidates: [],
      candidatesWithAudio: [],
      isSupported: () => true,
      note: 'Noted exports are capped for the test.',
      encode: () => Promise.resolve(new Blob()),
    })
    try {
      render(<ExportControl timeline={timeline} isTypeSupported={recordsEverything} />)
      await user.click(openButton())
      // WebM is the default selection and carries no note.
      expect(screen.queryByText('Noted exports are capped for the test.')).not.toBeInTheDocument()
      await user.click(screen.getByRole('radio', { name: 'Noted format' }))
      expect(screen.getByText('Noted exports are capped for the test.')).toBeInTheDocument()
      await user.click(screen.getByRole('radio', { name: 'WebM' }))
      expect(screen.queryByText('Noted exports are capped for the test.')).not.toBeInTheDocument()
    } finally {
      exportFormats.unregister('noted')
    }
  })
})

describe('audio-only export format (#245)', () => {
  // The audio format's support probe needs Web Audio; jsdom has none, so
  // tests that offer the format stub the constructor (the URL stub in
  // beforeEach shows unstubAllGlobals cleans these up per test).
  const withWebAudio = () => vi.stubGlobal('AudioContext', class {})

  it('is not offered without Web Audio, whatever MediaRecorder reports', async () => {
    const user = userEvent.setup()
    render(<ExportControl timeline={timeline} isTypeSupported={() => true} />)
    await user.click(openButton())
    expect(screen.queryByRole('radio', { name: 'Audio only (WebM/Opus)' })).not.toBeInTheDocument()
    // MP3 (#269) needs the same mix capture, so it is withheld alike.
    expect(screen.queryByRole('radio', { name: 'Audio only (MP3)' })).not.toBeInTheDocument()
  })

  it('hides the video-only output settings while selected, and restores them after', async () => {
    withWebAudio()
    const user = userEvent.setup()
    render(<ExportControl timeline={timeline} isTypeSupported={() => true} />)
    await user.click(openButton())

    // The video default shows the output settings.
    expect(screen.getByRole('spinbutton', { name: 'Export width in pixels' })).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Audio only (WebM/Opus)' }))
    expect(
      screen.queryByRole('spinbutton', { name: 'Export width in pixels' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('spinbutton', { name: 'Export height in pixels' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('spinbutton', { name: 'Export frame rate in frames per second' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Export size preset' })).not.toBeInTheDocument()
    // The format states its shape right where it is chosen.
    expect(
      screen.getByText('Saves just the mixed soundtrack — the file has no video track.'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'WebM' }))
    expect(screen.getByRole('spinbutton', { name: 'Export width in pixels' })).toBeInTheDocument()
  })

  it('exports with no frame or frame-rate overrides', async () => {
    withWebAudio()
    const calls: { format: string; frame?: unknown; frameRate?: unknown }[] = []
    const doExport: DoExport = (_timeline, options) => {
      calls.push({ format: options.format, frame: options.frame, frameRate: options.frameRate })
      return Promise.resolve(new Blob(['x']))
    }
    const user = userEvent.setup()
    render(<ExportControl timeline={timeline} doExport={doExport} isTypeSupported={() => true} />)
    await user.click(openButton())
    await user.click(screen.getByRole('radio', { name: 'Audio only (WebM/Opus)' }))
    await user.click(exportButton())

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(calls).toEqual([{ format: 'audio-webm', frame: undefined, frameRate: undefined }])
  })

  it('invalid video-settings drafts neither gate nor reach an audio-only export', async () => {
    withWebAudio()
    const calls: string[] = []
    const doExport: DoExport = (_timeline, options) => {
      calls.push(options.format)
      return Promise.resolve(new Blob(['x']))
    }
    const user = userEvent.setup()
    render(<ExportControl timeline={timeline} doExport={doExport} isTypeSupported={() => true} />)
    await user.click(openButton())

    // Make the video settings invalid: the video export button locks.
    const width = screen.getByRole('spinbutton', { name: 'Export width in pixels' })
    await user.clear(width)
    await user.type(width, '0')
    expect(exportButton()).toBeDisabled()

    // The audio-only format does not consume them, so it stays exportable.
    await user.click(screen.getByRole('radio', { name: 'Audio only (WebM/Opus)' }))
    expect(exportButton()).toBeEnabled()
    await user.click(exportButton())
    await waitFor(() => expect(calls).toEqual(['audio-webm']))
  })
})

describe('MP3 export format (#269)', () => {
  const withWebAudio = () => vi.stubGlobal('AudioContext', class {})

  it('is offered wherever Web Audio exists, even when no audio MIME is recordable', async () => {
    // The picker-visible difference from the WebM audio format: MP3 encodes
    // its own audio, so MediaRecorder's audio support is irrelevant to it.
    withWebAudio()
    const user = userEvent.setup()
    render(
      <ExportControl timeline={timeline} isTypeSupported={(type) => type.startsWith('video/')} />,
    )
    await user.click(openButton())
    expect(screen.queryByRole('radio', { name: 'Audio only (WebM/Opus)' })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Audio only (MP3)' })).toBeInTheDocument()
  })

  it('exports through the registry as audio-mp3, with no video overrides', async () => {
    withWebAudio()
    const calls: { format: string; frame?: unknown; frameRate?: unknown }[] = []
    const doExport: DoExport = (_timeline, options) => {
      calls.push({ format: options.format, frame: options.frame, frameRate: options.frameRate })
      return Promise.resolve(new Blob(['x']))
    }
    const user = userEvent.setup()
    render(<ExportControl timeline={timeline} doExport={doExport} isTypeSupported={() => true} />)
    await user.click(openButton())
    await user.click(screen.getByRole('radio', { name: 'Audio only (MP3)' }))
    // The audioOnly contract (#245) applies to this format too.
    expect(
      screen.queryByRole('spinbutton', { name: 'Export width in pixels' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText('Saves just the mixed soundtrack as an MP3 file — the file has no video track.'),
    ).toBeInTheDocument()
    await user.click(exportButton())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(calls).toEqual([{ format: 'audio-mp3', frame: undefined, frameRate: undefined }])
  })
})

describe('default export format setting (#286)', () => {
  const formatRadio = (label: string) => screen.getByRole('radio', { name: label })

  it('opens preselected on the configured format', async () => {
    const user = userEvent.setup()
    render(
      <ExportControl timeline={timeline} defaultFormat="mp4" isTypeSupported={recordsEverything} />,
    )

    await user.click(openButton())
    expect(formatRadio('MP4')).toBeChecked()
    expect(formatRadio('WebM')).not.toBeChecked()
  })

  it('falls back to WebM when the configured format is not recordable here', async () => {
    // The setting is a preference, not a promise: which formats exist is a
    // property of the running browser (#114) and of the enabled plugins
    // (#197). A stored id that is not on offer must not be exported.
    const user = userEvent.setup()
    render(
      <ExportControl timeline={timeline} defaultFormat="mp4" isTypeSupported={recordsWebmOnly} />,
    )

    await user.click(openButton())
    expect(formatRadio('WebM')).toBeChecked()
    expect(screen.queryByRole('radio', { name: 'MP4' })).not.toBeInTheDocument()
  })

  it('treats the format as a one-export choice, like the other output settings', async () => {
    // Deliberate change from before there was a setting, and the same rule
    // #169 already set for the size fields: an override picked for one
    // export does not quietly become the next one's format. The setting is
    // what the modal opens on, every time.
    const user = userEvent.setup()
    render(
      <ExportControl timeline={timeline} defaultFormat="webm" isTypeSupported={recordsEverything} />,
    )

    await user.click(openButton())
    await user.click(formatRadio('MP4'))
    expect(formatRadio('MP4')).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await user.click(openButton())
    expect(formatRadio('WebM')).toBeChecked()
  })
})

describe('format-note layout structure (#268)', () => {
  // jsdom computes no layout, so the geometry itself (the note below the
  // radio rows, everything inside the dialog) is evidenced by
  // e2e/export-modal-layout.spec.ts; these pin the structure that layout
  // relies on — the note is the format fieldset's own last element, after
  // every radio option, carrying the class the full-width flex rule targets.
  const withWebAudio = () => vi.stubGlobal('AudioContext', class {})

  it('renders the selected format note after every option, as the fieldset tail', async () => {
    withWebAudio()
    const user = userEvent.setup()
    render(<ExportControl timeline={timeline} isTypeSupported={() => true} />)
    await user.click(openButton())
    await user.click(screen.getByRole('radio', { name: 'Audio only (WebM/Opus)' }))

    const note = screen.getByText(
      'Saves just the mixed soundtrack — the file has no video track.',
    )
    expect(note).toHaveClass('export-format-note')
    const fieldset = note.closest('fieldset')
    expect(fieldset).not.toBeNull()
    expect(fieldset!.lastElementChild).toBe(note)
    const radios = screen.getAllByRole('radio')
    expect(radios.length).toBeGreaterThan(1)
    for (const radio of radios) {
      expect(note.compareDocumentPosition(radio) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    }
  })
})
