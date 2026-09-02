import { describe, expect, it, vi } from 'vitest'
import {
  recordingFileExtension,
  startMicrophoneRecording,
  voiceOverName,
} from './recording'
import type { RecorderLike, RecordingDependencies } from './recording'

describe('voiceOverName (#224)', () => {
  it('starts at 1 and always numbers past the highest existing voice-over', () => {
    expect(voiceOverName([], 'webm')).toBe('Voice-over 1.webm')
    expect(voiceOverName(['holiday.mp4', 'song.mp3'], 'webm')).toBe('Voice-over 1.webm')
    expect(voiceOverName(['Voice-over 1.webm', 'Voice-over 3.webm'], 'webm')).toBe(
      'Voice-over 4.webm',
    )
    // Removing an old recording never re-issues its number.
    expect(voiceOverName(['Voice-over 2.webm'], 'ogg')).toBe('Voice-over 3.ogg')
    // A clip that merely contains the words is not a voice-over number.
    expect(voiceOverName(['My Voice-over 7.webm'], 'webm')).toBe('Voice-over 1.webm')
  })
})

describe('recordingFileExtension', () => {
  it('maps capture MIME types to their container extension', () => {
    expect(recordingFileExtension('audio/webm;codecs=opus')).toBe('webm')
    expect(recordingFileExtension('audio/mp4')).toBe('m4a')
    expect(recordingFileExtension('audio/ogg;codecs=opus')).toBe('ogg')
    expect(recordingFileExtension('')).toBe('webm')
  })
})

/** A controllable MediaRecorder + stream pair standing in for the browser. */
function fakeRecordingWorld(options?: {
  supportedTypes?: string[]
  denyMicrophone?: Error
  failConstruction?: Error
}) {
  const stopTrack = vi.fn()
  const stream = {
    getTracks: () => [{ stop: stopTrack }, { stop: stopTrack }],
  } as unknown as MediaStream
  let recorder: (RecorderLike & { started: boolean; requestedMime: string | undefined }) | null =
    null
  const dependencies: RecordingDependencies = {
    getUserMedia: vi.fn((constraints: MediaStreamConstraints) => {
      expect(constraints).toEqual({ audio: true })
      return options?.denyMicrophone
        ? Promise.reject(options.denyMicrophone)
        : Promise.resolve(stream)
    }),
    createRecorder: (_stream, recorderOptions) => {
      if (options?.failConstruction) throw options.failConstruction
      recorder = {
        started: false,
        requestedMime: recorderOptions.mimeType,
        mimeType: recorderOptions.mimeType ?? 'audio/webm',
        ondataavailable: null,
        onstop: null,
        onerror: null,
        start() {
          this.started = true
        },
        stop() {
          queueMicrotask(() => this.onstop?.())
        },
      }
      return recorder
    },
    isTypeSupported: (mimeType) => (options?.supportedTypes ?? ['audio/webm;codecs=opus']).includes(mimeType),
  }
  return {
    dependencies,
    stopTrack,
    recorder: () => {
      if (recorder === null) throw new Error('recorder was never constructed')
      return recorder
    },
  }
}

describe('startMicrophoneRecording', () => {
  it('records delivered chunks into a named File and releases the microphone', async () => {
    const world = fakeRecordingWorld()
    const session = await startMicrophoneRecording(world.dependencies)
    const recorder = world.recorder()
    expect(recorder.started).toBe(true)
    expect(recorder.requestedMime).toBe('audio/webm;codecs=opus')
    expect(session.mimeType).toBe('audio/webm;codecs=opus')

    recorder.ondataavailable?.({ data: new Blob(['aud'], { type: 'audio/webm' }) })
    recorder.ondataavailable?.({ data: new Blob([''], { type: 'audio/webm' }) })
    recorder.ondataavailable?.({ data: new Blob(['io'], { type: 'audio/webm' }) })

    const file = await session.stop('Voice-over 1.webm')
    expect(file.name).toBe('Voice-over 1.webm')
    expect(file.type).toBe('audio/webm;codecs=opus')
    // The empty chunk was skipped; the others concatenated in order.
    expect(await file.text()).toBe('audio')
    expect(world.stopTrack).toHaveBeenCalledTimes(2)
  })

  it('lets the browser pick its default container when no candidate is supported', async () => {
    const world = fakeRecordingWorld({ supportedTypes: [] })
    const session = await startMicrophoneRecording(world.dependencies)
    expect(world.recorder().requestedMime).toBeUndefined()
    // The recorder's own reported type names the session's.
    expect(session.mimeType).toBe('audio/webm')
  })

  it('cancel discards the capture and releases the microphone', async () => {
    const world = fakeRecordingWorld()
    const session = await startMicrophoneRecording(world.dependencies)
    session.cancel()
    await Promise.resolve()
    expect(world.stopTrack).toHaveBeenCalledTimes(2)
    // A concluded session cannot be stopped into a file afterwards.
    await expect(session.stop('Voice-over 1.webm')).rejects.toThrow('already concluded')
  })

  it('propagates a denied microphone exactly like a failed import', async () => {
    const world = fakeRecordingWorld({ denyMicrophone: new Error('Permission denied') })
    await expect(startMicrophoneRecording(world.dependencies)).rejects.toThrow(
      'Permission denied',
    )
    expect(world.stopTrack).not.toHaveBeenCalled()
  })

  it('releases the microphone when the recorder itself cannot start', async () => {
    const world = fakeRecordingWorld({ failConstruction: new Error('NotSupportedError') })
    await expect(startMicrophoneRecording(world.dependencies)).rejects.toThrow('NotSupportedError')
    expect(world.stopTrack).toHaveBeenCalledTimes(2)
  })

  it('surfaces a mid-recording recorder failure at stop, still releasing the microphone', async () => {
    const world = fakeRecordingWorld()
    const session = await startMicrophoneRecording(world.dependencies)
    world.recorder().onerror?.(new Event('error'))
    await expect(session.stop('Voice-over 1.webm')).rejects.toThrow('failed while recording')
    expect(world.stopTrack).toHaveBeenCalledTimes(2)
  })

  it('refuses to record where the platform has no recording APIs', async () => {
    await expect(startMicrophoneRecording(null)).rejects.toThrow('not supported')
  })
})
