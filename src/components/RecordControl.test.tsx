import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { RecordControl } from './RecordControl'
import { probeMediaFile } from '../lib/probeMedia'
import {
  isRecordingSupported,
  isScreenRecordingSupported,
  startMicrophoneRecording,
  startScreenRecording,
} from '../lib/recording'
import type { RecordingSession } from '../lib/recording'

vi.mock('../lib/probeMedia', () => ({
  probeMediaFile: vi.fn(),
}))

// jsdom has neither getUserMedia/getDisplayMedia nor MediaRecorder: the
// recording module is mocked at the boundary the component injects anyway,
// so these tests cover the whole wiring — menu, dialog, import path, failure
// list — with only the capture itself faked. The capture logic is
// unit-tested in lib/recording.
vi.mock('../lib/recording', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/recording')>()),
  isRecordingSupported: vi.fn(() => true),
  startMicrophoneRecording: vi.fn(),
  isScreenRecordingSupported: vi.fn(() => true),
  startScreenRecording: vi.fn(),
}))

const probeMock = vi.mocked(probeMediaFile)
const startMock = vi.mocked(startMicrophoneRecording)
const supportedMock = vi.mocked(isRecordingSupported)
const startScreenMock = vi.mocked(startScreenRecording)
const screenSupportedMock = vi.mocked(isScreenRecordingSupported)

const fakeSession = (
  mimeType = 'audio/webm;codecs=opus',
  fileType = 'audio/webm',
): RecordingSession => ({
  mimeType,
  stream: {} as MediaStream,
  stop: vi.fn(async (fileName: string) => new File(['aud'], fileName, { type: fileType })),
  cancel: vi.fn(),
})

beforeEach(() => {
  vi.clearAllMocks()
  supportedMock.mockReturnValue(true)
  screenSupportedMock.mockReturnValue(true)
})

describe('voice-over recording (#224)', () => {
  it('renders no Record control where the platform cannot record any source', () => {
    render(
      <RecordControl
        existingNames={[]}
        onRecorded={() => {}}
        onFailed={() => {}}
        supported={false}
        screenSupported={false}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Record' })).not.toBeInTheDocument()
  })

  it('hides only the missing source when the other is available (#225)', async () => {
    render(
      <RecordControl
        existingNames={[]}
        onRecorded={() => {}}
        onFailed={() => {}}
        supported={true}
        screenSupported={false}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Record' }))
    expect(screen.getByRole('menuitem', { name: 'Microphone' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Screen' })).not.toBeInTheDocument()
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

describe('screen recording (#225)', () => {
  const screenSession = () => fakeSession('video/webm;codecs=vp9,opus', 'video/webm')

  beforeEach(() => {
    // The dialog's live preview plays the capture stream; jsdom's media
    // elements need the established play stub (the PreviewPlayer idiom).
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  })

  it('records the screen through the source menu and lands the capture as a video clip', async () => {
    const session = screenSession()
    startScreenMock.mockResolvedValue(session)
    probeMock.mockResolvedValue({ duration: 3, url: 'blob:scr', kind: 'video' })
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: 'Record' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Screen' }))

    // The screen dialog carries a live preview of the capture itself.
    const dialog = await screen.findByRole('dialog', { name: 'Recording screen' })
    expect(dialog).toHaveTextContent('Recording')
    const preview = screen.getByTestId('record-preview') as HTMLVideoElement
    expect(preview.muted).toBe(true)
    expect(preview.srcObject).toBe(session.stream)

    await userEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
    expect(session.stop).toHaveBeenCalledWith('Screen recording 1.webm')

    // The capture went through the ordinary import path: probed and listed
    // as a normal video clip — timeline, overlays, export, no special-casing.
    const list = await screen.findByRole('list', { name: 'Imported clips' })
    expect(list).toHaveTextContent('Screen recording 1.webm')
    expect(
      screen.getByRole('button', { name: 'Add Screen recording 1.webm to timeline' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it("the browser's own stop-sharing ends the recording exactly like Stop", async () => {
    const session = screenSession()
    let shareEnded: () => void = () => {}
    startScreenMock.mockImplementation(async (onShareEnded) => {
      shareEnded = onShareEnded
      return session
    })
    probeMock.mockResolvedValue({ duration: 3, url: 'blob:scr', kind: 'video' })
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: 'Record' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Screen' }))
    await screen.findByRole('dialog', { name: 'Recording screen' })

    shareEnded()
    const list = await screen.findByRole('list', { name: 'Imported clips' })
    expect(session.stop).toHaveBeenCalledWith('Screen recording 1.webm')
    expect(list).toHaveTextContent('Screen recording 1.webm')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('cancel discards the screen capture without touching the library', async () => {
    const session = screenSession()
    startScreenMock.mockResolvedValue(session)
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: 'Record' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Screen' }))
    await screen.findByRole('dialog', { name: 'Recording screen' })
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(session.cancel).toHaveBeenCalled()
    expect(session.stop).not.toHaveBeenCalled()
    expect(probeMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('list', { name: 'Imported clips' })).not.toBeInTheDocument()
  })

  it('a denied or dismissed screen picker lands in the failure list', async () => {
    startScreenMock.mockRejectedValue(new Error('Permission denied'))
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: 'Record' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Screen' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Screen recording failed: Permission denied')
  })

  it('numbers screen recordings independently of voice-overs', async () => {
    const session = screenSession()
    startScreenMock.mockResolvedValue(session)
    probeMock.mockResolvedValue({ duration: 1, url: 'blob:v1', kind: 'video' })
    render(<App />)

    await userEvent.upload(
      screen.getByTestId('clip-file-input'),
      new File(['a'], 'Screen recording 2.webm', { type: 'video/webm' }),
    )
    await screen.findByRole('list', { name: 'Imported clips' })

    await userEvent.click(screen.getByRole('button', { name: 'Record' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Screen' }))
    await screen.findByRole('dialog', { name: 'Recording screen' })
    await userEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
    expect(session.stop).toHaveBeenCalledWith('Screen recording 3.webm')
  })
})
