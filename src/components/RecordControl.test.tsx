import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { RecordControl } from './RecordControl'
import { probeMediaFile } from '../lib/probeMedia'
import { SETTINGS_KEY } from '../lib/settings'
import {
  isRecordingSupported,
  isScreenCameraRecordingSupported,
  isScreenRecordingSupported,
  startMicrophoneRecording,
  startScreenCameraRecording,
  startScreenRecording,
  startWebcamRecording,
} from '../lib/recording'
import type { RecordingSession, ScreenCameraRecordingSession } from '../lib/recording'

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
  startWebcamRecording: vi.fn(),
  isScreenCameraRecordingSupported: vi.fn(() => true),
  startScreenCameraRecording: vi.fn(),
}))

const probeMock = vi.mocked(probeMediaFile)
const startMock = vi.mocked(startMicrophoneRecording)
const supportedMock = vi.mocked(isRecordingSupported)
const startScreenMock = vi.mocked(startScreenRecording)
const screenSupportedMock = vi.mocked(isScreenRecordingSupported)
const startWebcamMock = vi.mocked(startWebcamRecording)
const startScreenCameraMock = vi.mocked(startScreenCameraRecording)
const screenCameraSupportedMock = vi.mocked(isScreenCameraRecordingSupported)

const fakeSession = (
  mimeType = 'audio/webm;codecs=opus',
  fileType = 'audio/webm',
  canPause = true,
): RecordingSession => ({
  mimeType,
  stream: {} as MediaStream,
  canPause,
  begin: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  stop: vi.fn(async (fileName: string) => new File(['aud'], fileName, { type: fileType })),
  cancel: vi.fn(),
})

beforeEach(() => {
  vi.clearAllMocks()
  supportedMock.mockReturnValue(true)
  screenSupportedMock.mockReturnValue(true)
  screenCameraSupportedMock.mockReturnValue(true)
  // The countdown (#514) is on by default and is its own describe below;
  // everything else here is about the take itself, so the store the app
  // reads its settings from turns it off — the way a user who never wants
  // it would.
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ countdownSeconds: 0 }))
})

afterEach(() => {
  localStorage.clear()
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
    // The dialog asked for a deferred start and began the take itself —
    // at once, with the countdown off (#514).
    expect(startMock).toHaveBeenCalledWith(undefined, { deferStart: true })
    expect(session.begin).toHaveBeenCalledTimes(1)

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

describe('screen + camera recording (#388)', () => {
  const screenStream = { screen: true } as unknown as MediaStream
  const cameraStream = { camera: true } as unknown as MediaStream
  const pairSession = (): ScreenCameraRecordingSession => ({
    screenMimeType: 'video/webm;codecs=vp9,opus',
    cameraMimeType: 'video/webm;codecs=vp9,opus',
    screenStream,
    cameraStream,
    canPause: true,
    begin: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(async (screenFileName: string, cameraFileName: string) => ({
      screen: new File(['scr'], screenFileName, { type: 'video/webm' }),
      camera: new File(['cam'], cameraFileName, { type: 'video/webm' }),
    })),
    cancel: vi.fn(),
  })
  /** Probes each recorded file as a video clip of the given duration. */
  const probeAsVideo = (durations: Record<string, number> = {}) =>
    probeMock.mockImplementation(async (file: File) => ({
      duration: durations[file.name] ?? 2,
      url: `blob:${file.name}`,
      kind: 'video' as const,
    }))

  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  })

  it('records both, shows both previews with the routing note, and places the arrival', async () => {
    const session = pairSession()
    startScreenCameraMock.mockResolvedValue(session)
    probeAsVideo()
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: 'Record' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Screen + camera' }))

    const dialog = await screen.findByRole('dialog', { name: 'Recording screen + camera' })
    // Both live previews, wired to their own streams, muted (no feedback).
    const screenPreview = screen.getByTestId('record-preview') as HTMLVideoElement
    const cameraPreview = screen.getByTestId('record-preview-camera') as HTMLVideoElement
    expect(screenPreview.srcObject).toBe(screenStream)
    expect(cameraPreview.srcObject).toBe(cameraStream)
    expect(screenPreview.muted).toBe(true)
    expect(cameraPreview.muted).toBe(true)
    // The fixed audio routing is stated, not configurable (#388).
    expect(dialog).toHaveTextContent('The microphone records with the camera clip')

    await userEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
    expect(session.stop).toHaveBeenCalledWith('Screen recording 1.webm', 'Webcam recording 1.webm')

    // Both captures are ordinary library clips…
    const list = await screen.findByRole('list', { name: 'Imported clips' })
    expect(list).toHaveTextContent('Screen recording 1.webm')
    expect(list).toHaveTextContent('Webcam recording 1.webm')
    // …and they arrived placed: the screen on the sequence, the camera as an
    // overlay layer (#388).
    expect(
      await screen.findByRole('spinbutton', {
        name: 'Trim out point of Screen recording 1.webm at position 1 in seconds',
      }),
    ).toBeInTheDocument()
    const overlays = screen.getByRole('list', { name: 'Overlay layers' })
    expect(overlays).toHaveTextContent('Webcam recording 1.webm')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('one undo removes the placed pair together and keeps both clips in the library', async () => {
    const session = pairSession()
    startScreenCameraMock.mockResolvedValue(session)
    probeAsVideo()
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: 'Record' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Screen + camera' }))
    await screen.findByRole('dialog', { name: 'Recording screen + camera' })
    await userEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
    await screen.findByRole('list', { name: 'Overlay layers' })

    await userEvent.click(screen.getByRole('button', { name: 'Undo last timeline edit' }))

    // The arrival was one action (#388): entry and overlay gone together…
    expect(screen.queryByRole('list', { name: 'Overlay layers' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('spinbutton', {
        name: 'Trim out point of Screen recording 1.webm at position 1 in seconds',
      }),
    ).not.toBeInTheDocument()
    // …while the library keeps both captures — the take is a deliverable of
    // its own, like every recording.
    const list = screen.getByRole('list', { name: 'Imported clips' })
    expect(list).toHaveTextContent('Screen recording 1.webm')
    expect(list).toHaveTextContent('Webcam recording 1.webm')
  })

  it("the browser's own stop-sharing concludes the paired take exactly like Stop", async () => {
    const session = pairSession()
    let shareEnded: () => void = () => {}
    startScreenCameraMock.mockImplementation(async (onShareEnded) => {
      shareEnded = onShareEnded
      return session
    })
    probeAsVideo()
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: 'Record' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Screen + camera' }))
    await screen.findByRole('dialog', { name: 'Recording screen + camera' })

    shareEnded()
    const list = await screen.findByRole('list', { name: 'Imported clips' })
    expect(session.stop).toHaveBeenCalledWith('Screen recording 1.webm', 'Webcam recording 1.webm')
    expect(list).toHaveTextContent('Webcam recording 1.webm')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('cancel discards both captures without touching the library', async () => {
    const session = pairSession()
    startScreenCameraMock.mockResolvedValue(session)
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: 'Record' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Screen + camera' }))
    await screen.findByRole('dialog', { name: 'Recording screen + camera' })
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(session.cancel).toHaveBeenCalled()
    expect(session.stop).not.toHaveBeenCalled()
    expect(probeMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('list', { name: 'Imported clips' })).not.toBeInTheDocument()
  })

  it('a denied prompt lands in the failure list, with nothing recorded', async () => {
    startScreenCameraMock.mockRejectedValue(new Error('Permission denied'))
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: 'Record' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Screen + camera' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Screen + camera recording failed: Permission denied')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('a capture whose probe fails costs only itself: the other clip lands, nothing is placed', async () => {
    const session = pairSession()
    startScreenCameraMock.mockResolvedValue(session)
    probeMock.mockImplementation(async (file: File) => {
      if (file.name.startsWith('Webcam')) throw new Error('Could not read this file as media.')
      return { duration: 2, url: `blob:${file.name}`, kind: 'video' as const }
    })
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: 'Record' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Screen + camera' }))
    await screen.findByRole('dialog', { name: 'Recording screen + camera' })
    await userEvent.click(screen.getByRole('button', { name: 'Stop recording' }))

    // The screen take is not discarded over its partner's import failure…
    const list = await screen.findByRole('list', { name: 'Imported clips' })
    expect(list).toHaveTextContent('Screen recording 1.webm')
    expect(list).not.toHaveTextContent('Webcam recording 1.webm')
    // …the camera's failure lists like any failed import, and no half-pair
    // reaches the timeline.
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not read this file as media.')
    expect(screen.queryByRole('list', { name: 'Overlay layers' })).not.toBeInTheDocument()
  })

  it('is offered only where both underlying sources are supported', async () => {
    screenCameraSupportedMock.mockReturnValue(false)
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Record' }))
    expect(screen.getByRole('menuitem', { name: 'Screen' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Screen + camera' })).not.toBeInTheDocument()
  })
})

describe('countdown, Pause / Resume and Space (#514)', () => {
  const openMicrophone = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Record' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Microphone' }))
    return screen.findByRole('dialog', { name: 'Recording voice-over' })
  }
  const elapsed = () => screen.getByTestId('record-elapsed')
  const pauseButton = () => screen.getByRole('button', { name: 'Pause recording' })
  const resumeButton = () => screen.getByRole('button', { name: 'Resume recording' })
  /** Moves the faked clock and lets the intervals it fires commit. */
  const advance = async (ms: number) => {
    await act(async () => {
      vi.advanceTimersByTime(ms)
    })
  }

  beforeEach(() => {
    // The default store: countdown on, 3 s.
    localStorage.clear()
    // Faked timers that also move with real time, so the async helpers
    // (userEvent, findBy) still resolve while the countdown and the
    // readout are driven deterministically by `advance`.
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('counts 3 · 2 · 1 in a live region, with no readout, and then begins the take', async () => {
    const session = fakeSession()
    startMock.mockResolvedValue(session)
    render(<App />)
    const dialog = await openMicrophone()

    // The sources are granted and the recorder exists, but nothing runs yet.
    expect(session.begin).not.toHaveBeenCalled()
    const status = within(dialog).getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'assertive')
    expect(status).toHaveTextContent('Starting in 3')
    expect(screen.queryByTestId('record-elapsed')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stop recording' })).not.toBeInTheDocument()
    // Start now is focused, so Enter or Space skips the count.
    expect(screen.getByRole('button', { name: 'Start now' })).toHaveFocus()

    await advance(1000)
    expect(status).toHaveTextContent('Starting in 2')
    expect(session.begin).not.toHaveBeenCalled()
    await advance(1000)
    expect(status).toHaveTextContent('Starting in 1')
    await advance(1000)
    expect(session.begin).toHaveBeenCalledTimes(1)
    expect(dialog).toHaveTextContent('Recording')
    expect(elapsed()).toHaveTextContent('0:00')
    expect(screen.queryByRole('button', { name: 'Start now' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stop recording' })).toBeInTheDocument()
    // Once recording, the readout counts from the take's start, not the dialog's.
    await advance(2000)
    expect(elapsed()).toHaveTextContent('0:02')
  })

  it('Start now skips the rest of the countdown', async () => {
    const session = fakeSession()
    startMock.mockResolvedValue(session)
    render(<App />)
    const dialog = await openMicrophone()
    await advance(1000)
    expect(within(dialog).getByRole('status')).toHaveTextContent('Starting in 2')

    fireEvent.click(screen.getByRole('button', { name: 'Start now' }))
    expect(session.begin).toHaveBeenCalledTimes(1)
    expect(dialog).toHaveTextContent('Recording')
    // The interval died with the phase: no later tick can start a second take.
    await advance(3000)
    expect(session.begin).toHaveBeenCalledTimes(1)
  })

  it('Cancel during the countdown releases everything and records nothing', async () => {
    const session = fakeSession()
    startMock.mockResolvedValue(session)
    render(<App />)
    await openMicrophone()
    await advance(1000)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(session.cancel).toHaveBeenCalledTimes(1)
    expect(session.begin).not.toHaveBeenCalled()
    expect(session.stop).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await advance(3000)
    expect(session.begin).not.toHaveBeenCalled()
    expect(probeMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it("the browser's stop-sharing during a screen countdown concludes it as a cancel", async () => {
    const session = fakeSession('video/webm;codecs=vp9,opus', 'video/webm')
    let shareEnded: () => void = () => {}
    startScreenMock.mockImplementation(async (onShareEnded) => {
      shareEnded = onShareEnded
      return session
    })
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Record' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Screen' }))
    await screen.findByRole('dialog', { name: 'Recording screen' })
    expect(startScreenMock).toHaveBeenCalledWith(expect.any(Function), undefined, {
      deferStart: true,
    })

    act(() => shareEnded())
    expect(session.cancel).toHaveBeenCalledTimes(1)
    expect(session.stop).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Pause and Resume reach the session once each, and the readout shows recorded time, not wall time', async () => {
    const session = fakeSession()
    startMock.mockResolvedValue(session)
    probeMock.mockResolvedValue({ duration: 3, url: 'blob:rec', kind: 'audio' })
    render(<App />)
    const dialog = await openMicrophone()
    fireEvent.click(screen.getByRole('button', { name: 'Start now' }))
    // Pause takes the focus once the take runs, so Space lands in the dialog.
    expect(pauseButton()).toHaveFocus()

    // Record 2 s.
    await advance(2000)
    expect(elapsed()).toHaveTextContent('0:02')

    // Pause 5 s: the recorder pauses once, the readout stands, the dot stops.
    fireEvent.click(pauseButton())
    expect(session.pause).toHaveBeenCalledTimes(1)
    expect(dialog).toHaveTextContent('Paused')
    expect(dialog.querySelector('.record-indicator-paused')).not.toBeNull()
    await advance(5000)
    expect(elapsed()).toHaveTextContent('0:02')
    expect(resumeButton()).toBeInTheDocument()

    // Resume 1 s: 3 s recorded, not the 8 s on the wall.
    fireEvent.click(resumeButton())
    expect(session.resume).toHaveBeenCalledTimes(1)
    expect(dialog).toHaveTextContent('Recording')
    await advance(1000)
    expect(elapsed()).toHaveTextContent('0:03')

    // Stop while paused still delivers the clip through the import path.
    fireEvent.click(pauseButton())
    expect(session.pause).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
    expect(session.stop).toHaveBeenCalledWith('Voice-over 1.webm')
    const list = await screen.findByRole('list', { name: 'Imported clips' })
    expect(list).toHaveTextContent('Voice-over 1.webm')
  })

  it('Space toggles Pause / Resume in the dialog and never fires a focused Stop or Cancel', async () => {
    const session = fakeSession()
    startMock.mockResolvedValue(session)
    render(<App />)
    const dialog = await openMicrophone()
    fireEvent.click(screen.getByRole('button', { name: 'Start now' }))

    // From the Pause button itself: one toggle, not two.
    fireEvent.keyDown(pauseButton(), { key: ' ' })
    fireEvent.keyUp(resumeButton(), { key: ' ' })
    expect(session.pause).toHaveBeenCalledTimes(1)
    expect(session.resume).not.toHaveBeenCalled()
    expect(dialog).toHaveTextContent('Paused')

    // From a focused Stop: Space resumes rather than stopping.
    const stop = screen.getByRole('button', { name: 'Stop recording' })
    stop.focus()
    fireEvent.keyDown(stop, { key: ' ' })
    fireEvent.keyUp(stop, { key: ' ' })
    expect(session.resume).toHaveBeenCalledTimes(1)
    expect(session.stop).not.toHaveBeenCalled()
    expect(dialog).toHaveTextContent('Recording')

    // A held key repeats the key-down; only the first press toggles.
    fireEvent.keyDown(dialog, { key: ' ', repeat: true })
    expect(session.pause).toHaveBeenCalledTimes(1)

    // And the transport underneath stayed inert: no preview started playing.
    expect(screen.queryByRole('button', { name: 'Pause preview' })).not.toBeInTheDocument()
  })

  it('offers no Pause where the recorder cannot pause, and Space does nothing', async () => {
    const session = fakeSession('audio/webm;codecs=opus', 'audio/webm', false)
    startMock.mockResolvedValue(session)
    render(<App />)
    const dialog = await openMicrophone()
    fireEvent.click(screen.getByRole('button', { name: 'Start now' }))
    expect(screen.queryByRole('button', { name: 'Pause recording' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stop recording' })).toBeInTheDocument()
    fireEvent.keyDown(dialog, { key: ' ' })
    expect(session.pause).not.toHaveBeenCalled()
    expect(dialog).toHaveTextContent('Recording')
  })

  it('a paired take pauses and resumes both recorders through the one button', async () => {
    const session: ScreenCameraRecordingSession = {
      screenMimeType: 'video/webm;codecs=vp9,opus',
      cameraMimeType: 'video/webm;codecs=vp9,opus',
      screenStream: {} as MediaStream,
      cameraStream: {} as MediaStream,
      canPause: true,
      begin: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(async (screenFileName: string, cameraFileName: string) => ({
        screen: new File(['scr'], screenFileName, { type: 'video/webm' }),
        camera: new File(['cam'], cameraFileName, { type: 'video/webm' }),
      })),
      cancel: vi.fn(),
    }
    startScreenCameraMock.mockResolvedValue(session)
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Record' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Screen + camera' }))
    await screen.findByRole('dialog', { name: 'Recording screen + camera' })
    fireEvent.click(screen.getByRole('button', { name: 'Start now' }))
    expect(session.begin).toHaveBeenCalledTimes(1)
    fireEvent.click(pauseButton())
    fireEvent.click(resumeButton())
    expect(session.pause).toHaveBeenCalledTimes(1)
    expect(session.resume).toHaveBeenCalledTimes(1)
  })

  it('the Settings switch turns the countdown off, and the dialog then records at once', async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ countdownSeconds: 0 }))
    const session = fakeSession()
    startMock.mockResolvedValue(session)
    render(<App />)
    const dialog = await openMicrophone()
    expect(session.begin).toHaveBeenCalledTimes(1)
    expect(dialog).toHaveTextContent('Recording')
    expect(within(dialog).queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start now' })).not.toBeInTheDocument()
  })
})

describe('webcam recording (#226)', () => {
  const webcamSession = () => fakeSession('video/webm;codecs=vp9,opus', 'video/webm')

  beforeEach(() => {
    // The dialog's self-view preview plays the capture stream; jsdom's media
    // elements need the established play stub (the PreviewPlayer idiom).
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  })

  it('rides the microphone feature detection: no getUserMedia, no Webcam item', async () => {
    supportedMock.mockReturnValue(false)
    render(
      <RecordControl existingNames={[]} onRecorded={() => {}} onFailed={() => {}} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Record' }))
    expect(screen.queryByRole('menuitem', { name: 'Webcam' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Screen' })).toBeInTheDocument()
  })

  it('records the webcam through the source menu and lands the capture as a video clip', async () => {
    const session = webcamSession()
    startWebcamMock.mockResolvedValue(session)
    probeMock.mockResolvedValue({ duration: 3, url: 'blob:cam', kind: 'video' })
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: 'Record' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Webcam' }))

    // The webcam dialog carries a live self-view of the capture, muted so
    // the microphone's own audio never feeds back.
    const dialog = await screen.findByRole('dialog', { name: 'Recording webcam' })
    expect(dialog).toHaveTextContent('Recording')
    const preview = screen.getByTestId('record-preview') as HTMLVideoElement
    expect(preview.muted).toBe(true)
    expect(preview.srcObject).toBe(session.stream)

    await userEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
    expect(session.stop).toHaveBeenCalledWith('Webcam recording 1.webm')

    // The capture went through the ordinary import path: probed and listed
    // as a normal video clip — timeline, overlays, export, no special-casing.
    const list = await screen.findByRole('list', { name: 'Imported clips' })
    expect(list).toHaveTextContent('Webcam recording 1.webm')
    expect(
      screen.getByRole('button', { name: 'Add Webcam recording 1.webm to timeline' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('cancel discards the webcam capture without touching the library', async () => {
    const session = webcamSession()
    startWebcamMock.mockResolvedValue(session)
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: 'Record' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Webcam' }))
    await screen.findByRole('dialog', { name: 'Recording webcam' })
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(session.cancel).toHaveBeenCalled()
    expect(session.stop).not.toHaveBeenCalled()
    expect(probeMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('list', { name: 'Imported clips' })).not.toBeInTheDocument()
  })

  it('a denied camera lands in the dismissible failure list, like a failed import', async () => {
    startWebcamMock.mockRejectedValue(new Error('Permission denied'))
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: 'Record' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Webcam' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Webcam recording failed: Permission denied')
  })

  it('numbers webcam recordings independently of the other sources', async () => {
    const session = webcamSession()
    startWebcamMock.mockResolvedValue(session)
    probeMock.mockResolvedValue({ duration: 1, url: 'blob:v1', kind: 'video' })
    render(<App />)

    await userEvent.upload(
      screen.getByTestId('clip-file-input'),
      new File(['a'], 'Webcam recording 4.webm', { type: 'video/webm' }),
    )
    await screen.findByRole('list', { name: 'Imported clips' })

    await userEvent.click(screen.getByRole('button', { name: 'Record' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Webcam' }))
    await screen.findByRole('dialog', { name: 'Recording webcam' })
    await userEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
    expect(session.stop).toHaveBeenCalledWith('Webcam recording 5.webm')
  })
})
