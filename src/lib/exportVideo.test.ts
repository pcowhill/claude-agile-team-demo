import { describe, expect, it } from 'vitest'
import {
  createAudioCapture,
  EXPORT_MIME_CANDIDATES,
  EXPORT_MIME_CANDIDATES_WITH_AUDIO,
  fitRect,
  pickExportMimeType,
  transitionOverlayDraw,
} from './exportVideo'

// The export pipeline itself (playback capture + MediaRecorder) cannot run
// in jsdom; it is covered by e2e/export.spec.ts. These tests cover the pure
// pieces the pipeline is built from.

describe('pickExportMimeType', () => {
  it('returns the first supported candidate in preference order', () => {
    expect(pickExportMimeType(() => true)).toBe(EXPORT_MIME_CANDIDATES[0])
    expect(pickExportMimeType((type) => !type.includes('vp9'))).toBe('video/webm;codecs=vp8')
    expect(pickExportMimeType((type) => type === 'video/webm')).toBe('video/webm')
  })

  it('returns null when nothing is supported', () => {
    expect(pickExportMimeType(() => false)).toBeNull()
  })
})

describe('EXPORT_MIME_CANDIDATES_WITH_AUDIO', () => {
  it('names an audio codec on every candidate that names a video codec', () => {
    // A codecs= list that mentions only video makes browsers drop the audio
    // track, which is exactly the bug this constant exists to avoid.
    for (const type of EXPORT_MIME_CANDIDATES_WITH_AUDIO) {
      if (type.includes('codecs=')) expect(type).toContain('opus')
    }
  })

  it('keeps the video-only preference order (vp9 before vp8)', () => {
    const videoCodecs = EXPORT_MIME_CANDIDATES_WITH_AUDIO.join(' ')
    expect(videoCodecs.indexOf('vp9')).toBeLessThan(videoCodecs.indexOf('vp8'))
  })
})

/** Minimal stand-in for the Web Audio graph, which jsdom does not implement. */
function fakeAudioContext(state: AudioContextState = 'running') {
  const track = { kind: 'audio', stopped: false, stop() { this.stopped = true } }
  const streamDestination = { stream: { getAudioTracks: () => [track] } }
  const connectedTo: unknown[] = []
  const sourcedElements: unknown[] = []
  const context = {
    state,
    closed: false,
    resumeCount: 0,
    /** The speakers. Connecting here would play the export out loud. */
    destination: { name: 'speakers' },
    createMediaElementSource: (element: unknown) => {
      sourcedElements.push(element)
      return {
        connect: (target: unknown) => connectedTo.push(target),
      }
    },
    createMediaStreamDestination: () => streamDestination,
    resume: async () => {
      context.resumeCount++
      context.state = 'running'
    },
    close: async () => {
      context.closed = true
    },
  }
  return { context, track, streamDestination, connectedTo, sourcedElements }
}

const asAudioContext = (context: unknown) => context as AudioContext

describe('createAudioCapture', () => {
  it('feeds the element into a stream destination and returns its track', async () => {
    const fake = fakeAudioContext()
    const capture = await createAudioCapture(
      [document.createElement('video')],
      () => asAudioContext(fake.context),
    )
    expect(capture?.track).toBe(fake.track)
    expect(fake.connectedTo).toEqual([fake.streamDestination])
  })

  it('mixes every element into the one destination (transition overlaps record both)', async () => {
    const fake = fakeAudioContext()
    const videos = [document.createElement('video'), document.createElement('video')]
    const capture = await createAudioCapture(videos, () => asAudioContext(fake.context))
    expect(capture?.track).toBe(fake.track)
    expect(fake.sourcedElements).toEqual(videos)
    // Both sources reach the same destination — one mixed recorded track.
    expect(fake.connectedTo).toEqual([fake.streamDestination, fake.streamDestination])
  })

  it('never connects the graph to the speakers', async () => {
    // Otherwise exporting a 30 s sequence plays all 30 s out loud.
    const fake = fakeAudioContext()
    await createAudioCapture([document.createElement('video')], () => asAudioContext(fake.context))
    expect(fake.connectedTo).not.toContain(fake.context.destination)
  })

  it('resumes a suspended context, which would otherwise record silence', async () => {
    const fake = fakeAudioContext('suspended')
    const capture = await createAudioCapture(
      [document.createElement('video')],
      () => asAudioContext(fake.context),
    )
    expect(fake.context.resumeCount).toBe(1)
    expect(fake.context.state).toBe('running')
    expect(capture).not.toBeNull()
  })

  it('disposing stops the track and closes the context', async () => {
    const fake = fakeAudioContext()
    const capture = await createAudioCapture(
      [document.createElement('video')],
      () => asAudioContext(fake.context),
    )
    await capture?.dispose()
    expect(fake.track.stopped).toBe(true)
    expect(fake.context.closed).toBe(true)
  })

  it('falls back to null when Web Audio is unavailable', async () => {
    // The caller reads null as "export video only" rather than as a failure.
    await expect(
      createAudioCapture([document.createElement('video')], () => null),
    ).resolves.toBeNull()
  })

  it('falls back to null and closes the context when an element is refused', async () => {
    // An element can be attached to only one MediaElementAudioSourceNode.
    const fake = fakeAudioContext()
    fake.context.createMediaElementSource = () => {
      throw new Error('already connected')
    }
    await expect(
      createAudioCapture([document.createElement('video')], () => asAudioContext(fake.context)),
    ).resolves.toBeNull()
    expect(fake.context.closed).toBe(true)
  })

  it('falls back to null when the destination yields no audio track', async () => {
    const fake = fakeAudioContext()
    fake.context.createMediaStreamDestination = () => ({ stream: { getAudioTracks: () => [] } })
    await expect(
      createAudioCapture([document.createElement('video')], () => asAudioContext(fake.context)),
    ).resolves.toBeNull()
    expect(fake.context.closed).toBe(true)
  })
})

describe('transitionOverlayDraw', () => {
  it('crossfade fades the incoming frame in with no displacement', () => {
    expect(transitionOverlayDraw('crossfade', 0)).toEqual({ alpha: 0, offsetYFraction: 0 })
    expect(transitionOverlayDraw('crossfade', 0.25)).toEqual({ alpha: 0.25, offsetYFraction: 0 })
    expect(transitionOverlayDraw('crossfade', 1)).toEqual({ alpha: 1, offsetYFraction: 0 })
  })

  it('slide-from-above moves the opaque incoming frame down from fully above', () => {
    // Matches the preview's translateY((progress - 1) * 100%).
    expect(transitionOverlayDraw('slide-from-above', 0)).toEqual({
      alpha: 1,
      offsetYFraction: -1,
    })
    expect(transitionOverlayDraw('slide-from-above', 0.5)).toEqual({
      alpha: 1,
      offsetYFraction: -0.5,
    })
    expect(transitionOverlayDraw('slide-from-above', 1)).toEqual({ alpha: 1, offsetYFraction: 0 })
  })
})

describe('fitRect', () => {
  it('fills the target when aspect ratios match', () => {
    expect(fitRect(320, 180, 640, 360)).toEqual({ x: 0, y: 0, width: 640, height: 360 })
  })

  it('letterboxes a wider source (bars above and below)', () => {
    expect(fitRect(200, 50, 100, 100)).toEqual({ x: 0, y: 37.5, width: 100, height: 25 })
  })

  it('pillarboxes a taller source (bars at the sides)', () => {
    expect(fitRect(50, 200, 100, 100)).toEqual({ x: 37.5, y: 0, width: 25, height: 100 })
  })

  it('never upscales asymmetrically: output keeps the source aspect ratio', () => {
    const rect = fitRect(320, 180, 1000, 1000)
    expect(rect.width / rect.height).toBeCloseTo(320 / 180, 10)
  })

  it('falls back to the full target for degenerate source dimensions', () => {
    expect(fitRect(0, 0, 640, 360)).toEqual({ x: 0, y: 0, width: 640, height: 360 })
  })
})
