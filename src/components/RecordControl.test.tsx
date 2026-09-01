import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { RecordControl } from './RecordControl'
import { probeMediaFile } from '../lib/probeMedia'
import { isRecordingSupported, startMicrophoneRecording } from '../lib/recording'
import type { RecordingSession } from '../lib/recording'

vi.mock('../lib/probeMedia', () => ({
  probeMediaFile: vi.fn(),
}))

// jsdom has neither getUserMedia nor MediaRecorder: the recording module is
// mocked at the boundary the component injects anyway, so these tests cover
// the whole wiring — menu, dialog, import path, failure list — with only the
// capture itself faked. The capture logic is unit-tested in lib/recording.
vi.mock('../lib/recording', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/recording')>()),
  isRecordingSupported: vi.fn(() => true),
  startMicrophoneRecording: vi.fn(),
}))

const probeMock = vi.mocked(probeMediaFile)
const startMock = vi.mocked(startMicrophoneRecording)
const supportedMock = vi.mocked(isRecordingSupported)

const fakeSession = () => {
  const session: RecordingSession = {
    mimeType: 'audio/webm;codecs=opus',
    stop: vi.fn(async (fileName: string) => new File(['aud'], fileName, { type: 'audio/webm' })),
    cancel: vi.fn(),
  }
  return session
}

beforeEach(() => {
  vi.clearAllMocks()
  supportedMock.mockReturnValue(true)
})

describe('voice-over recording (#224)', () => {
  it('renders no Record control where the platform cannot record', () => {
    render(
      <RecordControl existingNames={[]} onRecorded={() => {}} onFailed={() => {}} supported={false} />,
    )
    expect(screen.queryByRole('button', { name: 'Record' })).not.toBeInTheDocument()
  })

  it('records through the source menu and lands the capture in the library as audio', async () => {
    const session = fakeSession()
    startMock.mockResolvedValue(session)
    probeMock.mockResolvedValue({ duration: 2.5, url: 'blob:rec', kind: 'audio' })
    render(<App />)

    // The Record control offers the Microphone source in a menu — the
    // surface screen (#225) and webcam (#226) extend.
    await userEvent.click(screen.getByRole('button', { name: 'Record' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Microphone' }))

    // The recording dialog: modal (transport keys go inert via the shared
    // dialog rule), a recording indicator, an elapsed readout.
    const dialog = await screen.findByRole('dialog', { name: 'Recording voice-over' })
    expect(dialog).toHaveTextContent('Recording')
    expect(screen.getByTestId('record-elapsed')).toHaveTextContent('0:00')

    await userEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
    expect(session.stop).toHaveBeenCalledWith('Voice-over 1.webm')

    // The capture went through the ordinary import path: probed and listed
    // as a normal audio clip, placeable like any imported audio file.
    const list = await screen.findByRole('list', { name: 'Imported clips' })
    expect(list).toHaveTextContent('Voice-over 1.webm')
    expect(list).toHaveTextContent('Audio')
    expect(list).toHaveTextContent('0:03')
    expect(
      screen.getByRole('button', { name: 'Add Voice-over 1.webm to timeline' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('numbers the next voice-over past the clips already in the library', async () => {
    const session = fakeSession()
    startMock.mockResolvedValue(session)
    probeMock.mockResolvedValue({ duration: 1, url: 'blob:v1', kind: 'audio' })
    render(<App />)

    // Import an existing recording (e.g. restored from a project file).
    await userEvent.upload(
      screen.getByTestId('clip-file-input'),
      new File(['a'], 'Voice-over 3.webm', { type: 'audio/webm' }),
    )
    await screen.findByRole('list', { name: 'Imported clips' })

    await userEvent.click(screen.getByRole('button', { name: 'Record' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Microphone' }))
    await screen.findByRole('dialog', { name: 'Recording voice-over' })
    await userEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
    expect(session.stop).toHaveBeenCalledWith('Voice-over 4.webm')
  })

  it('cancel discards the capture without touching the library', async () => {
    const session = fakeSession()
    startMock.mockResolvedValue(session)
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: 'Record' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Microphone' }))
    await screen.findByRole('dialog', { name: 'Recording voice-over' })
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(session.cancel).toHaveBeenCalled()
    expect(session.stop).not.toHaveBeenCalled()
    expect(probeMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Imported clips' })).not.toBeInTheDocument()
  })

  it('a denied microphone lands in the dismissible failure list, like a failed import', async () => {
    startMock.mockRejectedValue(new Error('Permission denied'))
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: 'Record' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Microphone' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Microphone recording failed: Permission denied')
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
