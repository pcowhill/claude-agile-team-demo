import { describe, expect, it } from 'vitest'
import {
  activeTextDraws,
  activeVideoOverlays,
  advanceRemapReplay,
  AUDIO_DRIFT_EPSILON,
  canvasSupportsColorFilter,
  createAudioCapture,
  drawLayerSource,
  EXPORT_AUDIO_MIME_CANDIDATES,
  EXPORT_MIME_CANDIDATES,
  EXPORT_MIME_CANDIDATES_WITH_AUDIO,
  EXPORT_MP4_MIME_CANDIDATES,
  EXPORT_MP4_MIME_CANDIDATES_WITH_AUDIO,
  fitRect,
  initialRemapReplay,
  OUT_POINT_EPSILON,
  ExportUnsupportedError,
  overlayDestRect,
  pickExportMimeType,
  recorderStream,
  syncOverlayReplay,
  syncTrackReplay,
  textDraw,
  timelineHasColorAdjustments,
  withLayerColorFilter,
  withLayerOrientation,
  zoomRect,
} from './exportVideo'
import type { RemapReplayState, TrackReplayElement } from './exportVideo'
import type { AudioTrack, RemapEffect, TextOverlay, VideoOverlay } from './timeline'
import {
  audioTrackGainAt,
  duckFactorAt,
  duckWindows,
  trackDuckFactorAt,
  videoOverlayGainAt,
} from './gain'
import type { TimelineState } from './timeline'
import { sourceTimeAtOutput } from './remap'
import { TEXT_LINE_HEIGHT, textFontStack } from './textOverlay'

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

describe('EXPORT_AUDIO_MIME_CANDIDATES (#245)', () => {
  it('stays inside the audio WebM container, Opus first', () => {
    expect(EXPORT_AUDIO_MIME_CANDIDATES[0]).toBe('audio/webm;codecs=opus')
    for (const type of EXPORT_AUDIO_MIME_CANDIDATES) {
      expect(type.startsWith('audio/webm')).toBe(true)
    }
  })
})

describe('recorderStream (#245)', () => {
  const track = { kind: 'audio' } as unknown as MediaStreamTrack

  it('an audio-only export records the mixed audio track alone — no canvas capture', () => {
    let captured = false
    const created: MediaStreamTrack[][] = []
    const stream = {} as MediaStream
    const result = recorderStream(
      true,
      () => {
        captured = true
        return {} as MediaStream
      },
      track,
      (tracks) => {
        created.push(tracks)
        return stream
      },
    )
    expect(result).toBe(stream)
    expect(created).toEqual([[track]])
    expect(captured).toBe(false)
  })

  it('an audio-only export without captured audio is refused, never silently empty', () => {
    expect(() =>
      recorderStream(true, () => ({}) as MediaStream, null, () => ({}) as MediaStream),
    ).toThrow(ExportUnsupportedError)
  })

  it('a video export records the canvas stream, adding the audio track when captured', () => {
    const added: MediaStreamTrack[] = []
    const canvasStream = { addTrack: (added_: MediaStreamTrack) => added.push(added_) }
    const result = recorderStream(false, () => canvasStream as unknown as MediaStream, track)
    expect(result).toBe(canvasStream)
    expect(added).toEqual([track])
  })

  it('a video export without audio capture records the canvas stream alone', () => {
    const added: MediaStreamTrack[] = []
    const canvasStream = { addTrack: (added_: MediaStreamTrack) => added.push(added_) }
    const result = recorderStream(false, () => canvasStream as unknown as MediaStream, null)
    expect(result).toBe(canvasStream)
    expect(added).toEqual([])
  })
})

describe('MP4 candidates (#114)', () => {
  it('prefers H.264 and falls back to the bare container type', () => {
    expect(pickExportMimeType(() => true, EXPORT_MP4_MIME_CANDIDATES_WITH_AUDIO)).toBe(
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    )
    // A Chromium build without proprietary codecs supports only the bare
    // type — the export must still produce an MP4 there, not fail.
    expect(
      pickExportMimeType((type) => type === 'video/mp4', EXPORT_MP4_MIME_CANDIDATES_WITH_AUDIO),
    ).toBe('video/mp4')
    expect(pickExportMimeType(() => false, EXPORT_MP4_MIME_CANDIDATES)).toBeNull()
  })

  it('names an audio codec on every with-audio candidate that names a video codec', () => {
    // Same trap as the WebM list: a codecs= list naming only video makes
    // browsers drop the audio track.
    for (const type of EXPORT_MP4_MIME_CANDIDATES_WITH_AUDIO) {
      if (type.includes('codecs=')) expect(type).toMatch(/mp4a|opus/)
    }
  })

  it('every candidate stays inside the MP4 container', () => {
    // The format the user picked is a promise about the file they get.
    for (const type of [...EXPORT_MP4_MIME_CANDIDATES, ...EXPORT_MP4_MIME_CANDIDATES_WITH_AUDIO]) {
      expect(type.startsWith('video/mp4')).toBe(true)
    }
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

  it('mixes audio track elements alongside the video replays (#105)', async () => {
    const fake = fakeAudioContext()
    const elements = [document.createElement('video'), document.createElement('audio')]
    const capture = await createAudioCapture(elements, () => asAudioContext(fake.context))
    expect(capture?.track).toBe(fake.track)
    expect(fake.sourcedElements).toEqual(elements)
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

/** A track replay element the sync can drive, recording what happened to it. */
function fakeTrackElement(overrides: Partial<TrackReplayElement> = {}) {
  const element = {
    volume: 1,
    currentTime: 0,
    paused: true,
    playCalls: 0,
    pauseCalls: 0,
    play() {
      element.playCalls++
      element.paused = false
      return Promise.resolve()
    },
    pause() {
      element.pauseCalls++
      element.paused = true
    },
    ...overrides,
  }
  return element
}

// Window [5, 17): offset 5, source [10, 22), trimmed length 12.
const exportTrack = (overrides: Partial<AudioTrack> = {}): AudioTrack => ({
  id: 't1',
  clipId: 'music-1',
  name: 'music.mp3',
  duration: 30,
  url: 'blob:music',
  offset: 5,
  inPoint: 10,
  outPoint: 22,
  ...overrides,
})

describe('syncTrackReplay (#105)', () => {
  it('sets the element volume to the shared gain function at the position', () => {
    // The same numbers gain.test.ts pins for audioTrackGainAt — the export
    // element must carry exactly what that single source of truth computes.
    const track = exportTrack({ volume: 0.5, fadeIn: 2 })
    for (const sequenceTime of [5, 6, 7, 11, 16.5]) {
      const element = fakeTrackElement({ paused: false, currentTime: sequenceTime + 5 })
      syncTrackReplay(track, element, sequenceTime)
      expect(element.volume).toBe(audioTrackGainAt(track, sequenceTime))
    }
  })

  it('starts a paused element at the mapped source time when the window opens', () => {
    const element = fakeTrackElement()
    syncTrackReplay(exportTrack(), element, 6)
    expect(element.playCalls).toBe(1)
    expect(element.paused).toBe(false)
    // Sequence 6 is 1 s into the window; the source starts at inPoint 10.
    expect(element.currentTime).toBe(11)
  })

  it('leaves a playing element on its own clock within the drift tolerance', () => {
    const element = fakeTrackElement({ paused: false, currentTime: 11 + AUDIO_DRIFT_EPSILON / 2 })
    syncTrackReplay(exportTrack(), element, 6)
    expect(element.playCalls).toBe(0)
    expect(element.currentTime).toBe(11 + AUDIO_DRIFT_EPSILON / 2)
  })

  it('snaps a drifted playing element back to the export clock', () => {
    const element = fakeTrackElement({ paused: false, currentTime: 13 })
    syncTrackReplay(exportTrack(), element, 6)
    expect(element.currentTime).toBe(11)
  })

  it('pauses the element when the clock leaves the window, silenced', () => {
    const element = fakeTrackElement({ paused: false, currentTime: 21.9 })
    syncTrackReplay(exportTrack(), element, 17)
    expect(element.pauseCalls).toBe(1)
    expect(element.paused).toBe(true)
    expect(element.volume).toBe(0)
  })

  it('holds a not-yet-started track paused and cued at its in-point', () => {
    const element = fakeTrackElement({ currentTime: 3 })
    syncTrackReplay(exportTrack(), element, 1)
    expect(element.playCalls).toBe(0)
    expect(element.paused).toBe(true)
    expect(element.currentTime).toBe(10)
    expect(element.volume).toBe(0)
  })

  it('renders a fade as a ramp across successive clock positions', () => {
    const track = exportTrack({ fadeIn: 2, fadeOut: 2 })
    const element = fakeTrackElement()
    const volumes: number[] = []
    for (const sequenceTime of [5, 6, 7, 15, 16]) {
      syncTrackReplay(track, element, sequenceTime)
      volumes.push(element.volume)
    }
    expect(volumes).toEqual([0, 0.5, 1, 1, 0.5])
    expect(element.playCalls).toBe(1)
  })

  it('multiplies the passed duck factor into the recorded volume (#241)', () => {
    // The export loop passes trackDuckFactorAt per frame; the recorded
    // element must carry gain × duck — the same product the preview sets —
    // so the two mixes duck identically.
    const music = exportTrack({ volume: 0.5 })
    const element = fakeTrackElement({ paused: false, currentTime: 11 })
    syncTrackReplay(music, element, 6, 0.25)
    expect(element.volume).toBe(0.5 * 0.25)
    // The default factor is 1 — no ducking, the pre-#241 behavior exactly.
    syncTrackReplay(music, element, 6)
    expect(element.volume).toBe(0.5)
  })

  it('the export duck curve is the shared rule, duck-enabled tracks exempt (#241)', () => {
    // Pin the exact per-frame product the export loop computes against the
    // shared rule the preview multiplies with — identical by construction,
    // sampled here across the window edges and inside it.
    const voice = exportTrack({ id: 'voice', duck: true, duckLevel: 0.4, offset: 6, inPoint: 0, outPoint: 6 })
    const music = exportTrack({ id: 'music' })
    const state: TimelineState = { entries: [], transitions: [], zooms: [], audioTracks: [voice, music] }
    const windows = duckWindows(state)
    for (const sequenceTime of [5.5, 5.875, 6, 9, 12, 12.125, 12.25, 13]) {
      const element = fakeTrackElement({ paused: false, currentTime: sequenceTime + 5 })
      syncTrackReplay(music, element, sequenceTime, trackDuckFactorAt(music, windows, sequenceTime))
      expect(element.volume).toBe(
        audioTrackGainAt(music, sequenceTime) * trackDuckFactorAt(music, windows, sequenceTime),
      )
      const voiceElement = fakeTrackElement({ paused: false, currentTime: sequenceTime })
      syncTrackReplay(voice, voiceElement, sequenceTime, trackDuckFactorAt(voice, windows, sequenceTime))
      // The ducking voice itself is never ducked.
      expect(voiceElement.volume).toBe(audioTrackGainAt(voice, sequenceTime))
    }
  })
})

// Time-remap replay schedule (#144): the pure driver the export loop feeds
// its element clock into every frame. The mapping maths itself is pinned in
// remap.test.ts; these pin the schedule — what the element is told to do,
// and which output time each frame represents, across segment boundaries
// and pause plateaus.
const speedEffect = (start: number, end: number, factor: number): RemapEffect => ({
  id: `s${start}`,
  entryId: 'e1',
  kind: 'speed',
  start,
  end,
  factor,
})
const pauseEffect = (at: number, hold: number, id = `p${at}`): RemapEffect => ({
  id,
  entryId: 'e1',
  kind: 'pause',
  at,
  hold,
})
const DT = 1 / 30

describe('initialRemapReplay (#144)', () => {
  it('starts an effect-free entry playing from the top at rate 1', () => {
    expect(initialRemapReplay(10, [], 0)).toEqual({
      state: { hold: null, lastRelSource: 0 },
      relSource: 0,
      rate: 1,
    })
  })

  it('starts inside a segment at its factor (a transition handover landing)', () => {
    const start = initialRemapReplay(10, [speedEffect(0, 4, 0.5)], 3)
    expect(start.relSource).toBeCloseTo(1.5, 10)
    expect(start.rate).toBe(0.5)
    expect(start.state.hold).toBeNull()
  })

  it('starts inside a pause plateau frozen, with the remaining hold pending', () => {
    // Plateau [1, 3] (pause at source 1 holding 2): landing 1.5 output
    // seconds in leaves 1.5 s of hold.
    const start = initialRemapReplay(10, [pauseEffect(1, 2)], 1.5)
    expect(start.relSource).toBe(1)
    expect(start.rate).toBe(0)
    expect(start.state).toEqual({
      hold: { at: 1, outputEnd: 3, outputNow: 1.5 },
      lastRelSource: 1,
    })
  })

  it('starts an entry that opens on a pause frozen on its first frame', () => {
    const start = initialRemapReplay(10, [pauseEffect(0, 2)], 0)
    expect(start.state.hold).toEqual({ at: 0, outputEnd: 2, outputNow: 0 })
    expect(start.relSource).toBe(0)
  })
})

describe('advanceRemapReplay (#144)', () => {
  it('is the identity for an entry without effects', () => {
    const frame = advanceRemapReplay(10, [], { hold: null, lastRelSource: 0 }, 3.2, false, DT)
    expect(frame.outputInto).toBe(3.2)
    expect(frame.action).toEqual({ kind: 'play', rate: 1 })
    const done = advanceRemapReplay(10, [], frame.state, 10 - OUT_POINT_EPSILON / 2, false, DT)
    expect(done.action).toEqual({ kind: 'finished' })
  })

  it('drives the segment factor as the rate and stretches the output', () => {
    const effects = [speedEffect(2, 4, 0.5)]
    // Source 3 is mid-segment: output 2 + (3−2)/0.5 = 4, at half speed.
    let frame = advanceRemapReplay(10, effects, { hold: null, lastRelSource: 0 }, 3, false, DT)
    expect(frame.action).toEqual({ kind: 'play', rate: 0.5 })
    expect(frame.outputInto).toBeCloseTo(4, 10)
    // Source 5 has left the segment: back to rate 1, output 6 + 1 = 7.
    frame = advanceRemapReplay(10, effects, frame.state, 5, false, DT)
    expect(frame.action).toEqual({ kind: 'play', rate: 1 })
    expect(frame.outputInto).toBeCloseTo(7, 10)
  })

  it('freezes on a crossed pause instant and advances the hold on wall time', () => {
    const effects = [pauseEffect(6, 3)]
    // The element clock crossed source 6 between frames: freeze on 6 exactly,
    // snapping the output position to the plateau's start.
    let frame = advanceRemapReplay(10, effects, { hold: null, lastRelSource: 5.9 }, 6.01, false, DT)
    expect(frame.action).toEqual({ kind: 'freeze', relSource: 6 })
    expect(frame.outputInto).toBe(6)
    // Wall time advances the output position while the element stays frozen.
    frame = advanceRemapReplay(10, effects, frame.state, 6, false, 1)
    expect(frame.action).toEqual({ kind: 'freeze', relSource: 6 })
    expect(frame.outputInto).toBe(7)
    frame = advanceRemapReplay(10, effects, frame.state, 6, false, 1)
    expect(frame.outputInto).toBe(8)
    // The plateau ends: resume playing from the instant at the ambient rate,
    // with the output position landing exactly on the plateau's end.
    frame = advanceRemapReplay(10, effects, frame.state, 6, false, 1.5)
    expect(frame.action).toEqual({ kind: 'resume', rate: 1 })
    expect(frame.outputInto).toBe(9)
    // Play continues, mapped past the plateau; the pause does not re-trigger.
    frame = advanceRemapReplay(10, effects, frame.state, 6.2, false, DT)
    expect(frame.action).toEqual({ kind: 'play', rate: 1 })
    expect(frame.outputInto).toBeCloseTo(9.2, 10)
  })

  it('resumes at the factor in force at the frozen instant', () => {
    // A pause at the start of a 2× segment: the hold ends into the segment.
    const effects = [pauseEffect(2, 1), speedEffect(2, 4, 2)]
    let frame = advanceRemapReplay(10, effects, { hold: null, lastRelSource: 1.9 }, 2.01, false, DT)
    expect(frame.action).toEqual({ kind: 'freeze', relSource: 2 })
    frame = advanceRemapReplay(10, effects, frame.state, 2, false, 1.2)
    expect(frame.action).toEqual({ kind: 'resume', rate: 2 })
  })

  it('holds an end-of-entry pause after the source is consumed, then finishes', () => {
    const effects = [pauseEffect(10, 2)]
    // The element clock stops just short of the out-point: the pause is
    // reached through the source being consumed.
    let frame = advanceRemapReplay(
      10,
      effects,
      { hold: null, lastRelSource: 9.9 },
      10 - OUT_POINT_EPSILON / 2,
      false,
      DT,
    )
    expect(frame.action).toEqual({ kind: 'freeze', relSource: 10 })
    expect(frame.outputInto).toBe(10)
    frame = advanceRemapReplay(10, effects, frame.state, 10, false, 1)
    expect(frame.action).toEqual({ kind: 'freeze', relSource: 10 })
    // The hold ends with nothing left to play: the entry is finished.
    frame = advanceRemapReplay(10, effects, frame.state, 10, false, 1.2)
    expect(frame.action).toEqual({ kind: 'finished' })
    expect(frame.outputInto).toBe(12)
  })

  it('chains two pauses at one instant into their combined hold', () => {
    // The model counts both holds (#153); the export must render them
    // back-to-back rather than skipping the second.
    const effects = [pauseEffect(0, 1, 'p1'), pauseEffect(0, 1, 'p2')]
    let state: RemapReplayState = initialRemapReplay(4, effects, 0).state
    expect(state.hold).toEqual({ at: 0, outputEnd: 1, outputNow: 0 })
    // The first plateau ends — and the second begins immediately, still
    // frozen on the same instant, output continuing without a jump.
    let frame = advanceRemapReplay(4, effects, state, 0, false, 1.2)
    expect(frame.action).toEqual({ kind: 'freeze', relSource: 0 })
    expect(frame.outputInto).toBe(1)
    expect(frame.state.hold).toEqual({ at: 0, outputEnd: 2, outputNow: 1 })
    // The second plateau ends into normal playback.
    frame = advanceRemapReplay(4, effects, frame.state, 0, false, 1.1)
    expect(frame.action).toEqual({ kind: 'resume', rate: 1 })
    expect(frame.outputInto).toBe(2)
  })

  it('finishes without resuming when the element has ended', () => {
    const frame = advanceRemapReplay(10, [], { hold: null, lastRelSource: 7 }, 7.5, true, DT)
    expect(frame.action).toEqual({ kind: 'finished' })
  })

  it('replays a whole schedule with every frame on the mapped source time', () => {
    // Trimmed 4 s: [0,2]@0.5 → output [0,4]; 1:1 [2,3] → [4,5]; pause at 3
    // for 1 → plateau [5,6]; 1:1 [3,4] → [6,7]. Simulate a perfect element
    // (clock advances at exactly the driven rate) and check every frame's
    // (output, source) pair against the mapping — the output-frame →
    // source-time schedule across segment boundaries and plateaus.
    const effects = [speedEffect(0, 2, 0.5), pauseEffect(3, 1)]
    const trimmed = 4
    const start = initialRemapReplay(trimmed, effects, 0)
    let state = start.state
    let rel = start.relSource
    let rate = start.rate
    let playing = state.hold === null
    let finished = false
    const samples: { output: number; source: number }[] = []
    for (let i = 0; i < 1000 && !finished; i++) {
      if (playing) rel += rate * DT
      const frame = advanceRemapReplay(trimmed, effects, state, rel, false, DT)
      state = frame.state
      if (frame.action.kind === 'finished') {
        finished = true
        break
      }
      if (frame.action.kind === 'freeze') {
        playing = false
        rel = frame.action.relSource
      } else {
        playing = true
        rate = frame.action.rate
      }
      samples.push({ output: frame.outputInto, source: rel })
    }
    expect(finished).toBe(true)
    // ~7 s of remapped output at 30 fps.
    expect(samples.length).toBeGreaterThan(6.5 * 30)
    for (const sample of samples) {
      expect(sample.source).toBeCloseTo(sourceTimeAtOutput(trimmed, effects, sample.output), 8)
    }
    // The published output advances monotonically — the sequence clock (and
    // with it the audio-track sync) never jumps backwards.
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i].output).toBeGreaterThanOrEqual(samples[i - 1].output)
    }
  })
})

// The per-layer transition alphas live in transitionRender.ts (shared with
// the preview) and are tested in transitionRender.test.ts.

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

describe('zoomRect', () => {
  // The visible region — the frame divided by scale, centred on the zoom's
  // centre — must land exactly on the frame edges (#65): here a 2× zoom into
  // (0.25, 0.5) of a 640×360 frame has visible region (0, 90, 320, 180).
  it('maps the visible region onto the full frame', () => {
    const zoom = { scale: 2, centerX: 0.25, centerY: 0.5 }
    expect(zoomRect({ x: 0, y: 90, width: 320, height: 180 }, zoom, 640, 360)).toEqual({
      x: 0,
      y: 0,
      width: 640,
      height: 360,
    })
  })

  it('is the identity at scale 1 centred mid-frame', () => {
    const rect = { x: 80, y: 45, width: 480, height: 270 }
    expect(zoomRect(rect, { scale: 1, centerX: 0.5, centerY: 0.5 }, 640, 360)).toEqual(rect)
  })

  it('scales both axes by the same factor, preserving the aspect ratio', () => {
    for (const scale of [1.5, 2, 3.25]) {
      const rect = zoomRect(
        { x: 40, y: 30, width: 320, height: 180 },
        { scale, centerX: 0.4, centerY: 0.6 },
        640,
        360,
      )
      expect(rect.width).toBeCloseTo(320 * scale, 10)
      expect(rect.height).toBeCloseTo(180 * scale, 10)
      expect(rect.width / rect.height).toBeCloseTo(320 / 180, 10)
    }
  })

  // The reducer clamps the centre so the visible region stays inside the
  // frame; under any such centre the mapped frame covers the whole frame, so
  // no area beyond a frame edge is ever pulled into view.
  it('maps the full frame to a superset of the frame for any clamped centre', () => {
    for (const scale of [1.5, 2, 4]) {
      const half = 1 / (2 * scale)
      for (const centerX of [half, 0.5, 1 - half]) {
        for (const centerY of [half, 0.5, 1 - half]) {
          const frame = zoomRect(
            { x: 0, y: 0, width: 640, height: 360 },
            { scale, centerX, centerY },
            640,
            360,
          )
          // Sub-picopixel float noise at the exact clamp bound is invisible
          // on a canvas; assert coverage within a billionth of a pixel.
          expect(frame.x).toBeLessThanOrEqual(1e-9)
          expect(frame.y).toBeLessThanOrEqual(1e-9)
          expect(frame.x + frame.width).toBeGreaterThanOrEqual(640 - 1e-9)
          expect(frame.y + frame.height).toBeGreaterThanOrEqual(360 - 1e-9)
        }
      }
    }
  })
})

// The export-side rendering of text overlays (#142). The canvas draw itself
// runs only in a real browser (e2e/export-text.spec.ts); these tests pin the
// per-frame draw decisions — which overlays are active at a sequence time,
// and the position, font string, and size each resolves to for a given
// canvas resolution.
describe('textDraw (#142)', () => {
  const overlay: TextOverlay = {
    id: 't1',
    content: 'Title',
    offset: 2,
    duration: 3,
    x: 0.25,
    y: 0.75,
    font: 'sans',
    size: 0.1,
    color: '#00ff88',
    bold: false,
    italic: false,
  }

  it('resolves size against the frame height only, matching the preview', () => {
    // 0.1 of a 360-high frame is 36px — the width must play no part, exactly
    // as the preview's cqh sizing ignores the stage width.
    expect(textDraw(overlay, 640, 360, 3).font).toBe('400 36px Arial, Helvetica, sans-serif')
    expect(textDraw(overlay, 9999, 360, 3).font).toBe('400 36px Arial, Helvetica, sans-serif')
  })

  it('spells style and weight into the font string', () => {
    const stack = textFontStack('sans')
    expect(textDraw({ ...overlay, bold: true }, 640, 360, 3).font).toBe(`700 36px ${stack}`)
    expect(textDraw({ ...overlay, italic: true }, 640, 360, 3).font).toBe(`italic 400 36px ${stack}`)
    expect(textDraw({ ...overlay, bold: true, italic: true }, 640, 360, 3).font).toBe(
      `italic 700 36px ${stack}`,
    )
  })

  it('uses the curated stack for every font id — the same stacks the preview uses', () => {
    for (const font of ['sans', 'serif', 'mono', 'display'] as const) {
      expect(textDraw({ ...overlay, font }, 640, 360, 3).font).toContain(textFontStack(font))
    }
  })

  it('centres a single line on the fractional position in pixels', () => {
    const draw = textDraw(overlay, 640, 360, 3)
    expect(draw.x).toBe(0.25 * 640)
    expect(draw.firstLineY).toBe(0.75 * 360)
    expect(draw.lines).toEqual(['Title'])
    expect(draw.color).toBe('#00ff88')
  })

  it('splits multi-line content on newlines and centres the block vertically', () => {
    const draw = textDraw({ ...overlay, content: 'a\nb\nc', y: 0.5 }, 640, 360, 3)
    expect(draw.lines).toEqual(['a', 'b', 'c'])
    // 36px type, line step 1.2 × 36 = 43.2px; three lines centre the middle
    // line on y, so the first line sits one full step above it.
    expect(draw.lineHeight).toBeCloseTo(36 * TEXT_LINE_HEIGHT, 10)
    expect(draw.firstLineY).toBeCloseTo(180 - 43.2, 10)
    // The last line's centre mirrors the first about the block centre.
    expect(draw.firstLineY + 2 * draw.lineHeight).toBeCloseTo(180 + 43.2, 10)
  })

  it('is resolution-independent: doubling the frame doubles every pixel value', () => {
    const base = textDraw({ ...overlay, content: 'a\nb' }, 640, 360, 3)
    const doubled = textDraw({ ...overlay, content: 'a\nb' }, 1280, 720, 3)
    expect(doubled.x).toBeCloseTo(base.x * 2, 10)
    expect(doubled.firstLineY).toBeCloseTo(base.firstLineY * 2, 10)
    expect(doubled.lineHeight).toBeCloseTo(base.lineHeight * 2, 10)
    expect(doubled.font).toBe(base.font.replace('36px', '72px'))
  })

  it('carries the fade envelope at the instant as the draw opacity (#177)', () => {
    // The overlay covers [2, 5); a 2s fade-in puts opacity at 0.5 one second
    // in — the very value the preview would set as CSS opacity there.
    const fading = { ...overlay, fadeIn: 2 }
    expect(textDraw(fading, 640, 360, 3).opacity).toBeCloseTo(0.5, 10)
    expect(textDraw(fading, 640, 360, 4.5).opacity).toBe(1)
    expect(textDraw(overlay, 640, 360, 3).opacity).toBe(1)
  })
})

describe('activeTextDraws (#142)', () => {
  const overlay = (id: string, offset: number, duration: number): TextOverlay => ({
    id,
    content: id,
    offset,
    duration,
    x: 0.5,
    y: 0.5,
    font: 'sans',
    size: 0.1,
    color: '#ffffff',
    bold: false,
    italic: false,
  })
  const entries = [
    {
      id: 'e1',
      clipId: 'c1',
      name: 'clip.webm',
      duration: 10,
      url: 'blob:clip',
      inPoint: 0,
      outPoint: 10,
    },
  ]

  it('selects exactly the overlays whose half-open window covers the time', () => {
    const timeline = { entries, texts: [overlay('early', 0, 2), overlay('late', 5, 3)] }
    expect(activeTextDraws(timeline, 1, 640, 360).map((draw) => draw.lines)).toEqual([['early']])
    // At an overlay's end instant it has just disappeared (half-open, #139).
    expect(activeTextDraws(timeline, 2, 640, 360)).toEqual([])
    expect(activeTextDraws(timeline, 5, 640, 360).map((draw) => draw.lines)).toEqual([['late']])
    expect(activeTextDraws(timeline, 9, 640, 360)).toEqual([])
  })

  it('keeps add order for simultaneous overlays — the stacking order', () => {
    const timeline = { entries, texts: [overlay('under', 0, 10), overlay('over', 0, 10)] }
    expect(activeTextDraws(timeline, 5, 640, 360).map((draw) => draw.lines)).toEqual([
      ['under'],
      ['over'],
    ])
  })

  it('is empty for a text-free timeline, pre-#139 states included', () => {
    expect(activeTextDraws({ entries }, 1, 640, 360)).toEqual([])
  })
})

// The export-side compositing of overlay video layers (#146). The canvas
// drawImage itself runs only in a real browser (e2e/export-overlay.spec.ts);
// these tests pin the per-frame decisions — which overlays cover a sequence
// time, the destination rectangle each resolves to for a given canvas size,
// and how each replay element is driven along the export clock.

// Window [2, 8): offset 2, trim [1, 7) of a 10 s clip.
const exportOverlay = (overrides: Partial<VideoOverlay> = {}): VideoOverlay => ({
  id: 'v1',
  clipId: 'cam-1',
  name: 'cam.webm',
  duration: 10,
  url: 'blob:cam',
  offset: 2,
  inPoint: 1,
  outPoint: 7,
  x: 0.62,
  y: 0.62,
  width: 0.35,
  height: 0.35,
  ...overrides,
})

describe('overlayDestRect (#146)', () => {
  it('fills the placement rectangle when the clip aspect matches it', () => {
    // A 0.35 × 0.35 rect of a 16:9 frame is itself 16:9, so a 16:9 clip
    // fills it exactly — the same fractions the preview's stage resolves.
    const dest = overlayDestRect(exportOverlay(), 320, 180, 640, 360)
    expect(dest).toEqual({ x: 0.62 * 640, y: 0.62 * 360, width: 0.35 * 640, height: 0.35 * 360 })
  })

  it('letterboxes a wider clip within the rectangle, gutters split evenly', () => {
    const overlay = exportOverlay({ x: 0, y: 0, width: 0.5, height: 0.5 })
    // Rect 320×180; a 32:9 source scales to 320×90, centred vertically.
    const dest = overlayDestRect(overlay, 320, 90, 640, 360)
    expect(dest).toEqual({ x: 0, y: 45, width: 320, height: 90 })
  })

  it('pillarboxes a taller clip within the rectangle', () => {
    const overlay = exportOverlay({ x: 0.5, y: 0, width: 0.5, height: 0.5 })
    // Rect 320×180 at left edge 320; a 9:16 source scales to 101.25×180.
    const dest = overlayDestRect(overlay, 90, 160, 640, 360)
    expect(dest.height).toBe(180)
    expect(dest.width).toBeCloseTo(101.25, 10)
    expect(dest.x).toBeCloseTo(320 + (320 - 101.25) / 2, 10)
    expect(dest.y).toBe(0)
  })

  it('is resolution-independent: doubling the frame doubles every pixel value', () => {
    const base = overlayDestRect(exportOverlay(), 320, 90, 640, 360)
    const doubled = overlayDestRect(exportOverlay(), 320, 90, 1280, 720)
    expect(doubled.x).toBeCloseTo(base.x * 2, 10)
    expect(doubled.y).toBeCloseTo(base.y * 2, 10)
    expect(doubled.width).toBeCloseTo(base.width * 2, 10)
    expect(doubled.height).toBeCloseTo(base.height * 2, 10)
  })

  it('fills the whole rectangle for a source with no dimensions yet', () => {
    // fitRect's degenerate rule: no intrinsic size, no letterboxing to do.
    const overlay = exportOverlay({ x: 0.1, y: 0.2, width: 0.5, height: 0.25 })
    const dest = overlayDestRect(overlay, 0, 0, 640, 360)
    expect(dest).toEqual({ x: 64, y: 72, width: 320, height: 90 })
  })
})

describe('activeVideoOverlays (#146)', () => {
  const entries = [
    {
      id: 'e1',
      clipId: 'c1',
      name: 'clip.webm',
      duration: 10,
      url: 'blob:clip',
      inPoint: 0,
      outPoint: 10,
    },
  ]

  it('selects exactly the overlays whose half-open window covers the time', () => {
    const timeline = { entries, videoOverlays: [exportOverlay()] }
    expect(activeVideoOverlays(timeline, 1.9)).toEqual([])
    expect(activeVideoOverlays(timeline, 2).map((overlay) => overlay.id)).toEqual(['v1'])
    expect(activeVideoOverlays(timeline, 7.9).map((overlay) => overlay.id)).toEqual(['v1'])
    // At the window's end instant the overlay has just disappeared —
    // half-open, the audio-track rule (#102) applied structurally.
    expect(activeVideoOverlays(timeline, 8)).toEqual([])
  })

  it('keeps add order for simultaneous overlays — the stacking order', () => {
    const under = exportOverlay({ id: 'under' })
    const over = exportOverlay({ id: 'over' })
    const timeline = { entries, videoOverlays: [under, over] }
    expect(activeVideoOverlays(timeline, 4)).toEqual([under, over])
  })

  it('is empty for an overlay-free timeline, pre-#145 states included', () => {
    expect(activeVideoOverlays({ entries }, 4)).toEqual([])
  })
})

describe('syncOverlayReplay (#146)', () => {
  it('sets the element volume to the overlay gain — volume × mute × fades', () => {
    const element = fakeTrackElement({ paused: false, currentTime: 3 })
    syncOverlayReplay(exportOverlay({ volume: 0.4 }), element, 4)
    expect(element.volume).toBe(0.4)
    // Mute wins over everything (#104), exactly as the preview mixes it.
    syncOverlayReplay(exportOverlay({ volume: 0.4, muted: true }), element, 4)
    expect(element.volume).toBe(0)
    // The fade envelope (#220) rides the same call: window [2, 8), fadeIn 4
    // puts sequence 4 halfway up the ramp.
    syncOverlayReplay(exportOverlay({ volume: 0.4, fadeIn: 4 }), element, 4)
    expect(element.volume).toBe(0.2)
  })

  it('multiplies the passed duck factor into the overlay volume (#241)', () => {
    const element = fakeTrackElement({ paused: false, currentTime: 3 })
    const overlay = exportOverlay({ volume: 0.4 })
    syncOverlayReplay(overlay, element, 4, 0.25)
    expect(element.volume).toBeCloseTo(0.4 * 0.25, 10)
    // The factor the loop passes is the shared rule's — same as the preview.
    expect(element.volume).toBeCloseTo(
      videoOverlayGainAt(overlay, 4) * duckFactorAt([{ start: 0, end: 10, level: 0.25 }], 4),
      10,
    )
  })

  it('starts a paused element at the mapped source time when the window opens', () => {
    const element = fakeTrackElement()
    syncOverlayReplay(exportOverlay(), element, 3)
    expect(element.playCalls).toBe(1)
    expect(element.paused).toBe(false)
    // Sequence 3 is 1 s into the window; the source starts at inPoint 1.
    expect(element.currentTime).toBe(2)
  })

  it('leaves a playing element on its own clock within the drift tolerance', () => {
    const element = fakeTrackElement({ paused: false, currentTime: 2 + AUDIO_DRIFT_EPSILON / 2 })
    syncOverlayReplay(exportOverlay(), element, 3)
    expect(element.playCalls).toBe(0)
    expect(element.currentTime).toBe(2 + AUDIO_DRIFT_EPSILON / 2)
  })

  it('snaps a drifted playing element back to the export clock', () => {
    const element = fakeTrackElement({ paused: false, currentTime: 4 })
    syncOverlayReplay(exportOverlay(), element, 3)
    expect(element.currentTime).toBe(2)
  })

  it('holds a not-yet-started overlay paused and cued at its in-point', () => {
    const element = fakeTrackElement({ currentTime: 5 })
    syncOverlayReplay(exportOverlay(), element, 1)
    expect(element.playCalls).toBe(0)
    expect(element.paused).toBe(true)
    expect(element.currentTime).toBe(1)
  })

  it('pauses the element at its out-point when the clock leaves the window', () => {
    const element = fakeTrackElement({ paused: false, currentTime: 5 })
    syncOverlayReplay(exportOverlay(), element, 9)
    expect(element.pauseCalls).toBe(1)
    expect(element.paused).toBe(true)
    // Re-cued to the out-point: 5 is beyond the drift tolerance of 7. (An
    // element that stopped within the tolerance keeps its own clock, as a
    // playing one does.)
    expect(element.currentTime).toBe(7)
  })
})

// Per-clip color adjustments in the export (#195). The actual filtered
// pixels can only render in a real browser (e2e/export-color.spec.ts);
// these tests pin the pure decisions — when adjustments require canvas
// filter support, how support is probed, and that the draw path sets the
// shared canonical string around exactly the adjusted layer's draw.

describe('timelineHasColorAdjustments (#195)', () => {
  const entry = (colorAdjustments?: { brightness?: number; look?: 'grayscale' | 'sepia' }) => ({
    id: 'e1',
    clipId: 'c1',
    name: 'clip.webm',
    duration: 10,
    url: 'blob:clip',
    inPoint: 0,
    outPoint: 10,
    ...(colorAdjustments === undefined ? {} : { colorAdjustments }),
  })

  it('is false for an adjustment-free timeline, pre-#192 states included', () => {
    expect(timelineHasColorAdjustments({ entries: [entry()] })).toBe(false)
    expect(
      timelineHasColorAdjustments({ entries: [entry()], videoOverlays: [exportOverlay()] }),
    ).toBe(false)
  })

  it('is true when a sequence entry carries adjustments', () => {
    expect(timelineHasColorAdjustments({ entries: [entry(), entry({ brightness: 150 })] })).toBe(
      true,
    )
  })

  it('is true when only a video overlay carries adjustments', () => {
    expect(
      timelineHasColorAdjustments({
        entries: [entry()],
        videoOverlays: [exportOverlay({ colorAdjustments: { look: 'sepia' } })],
      }),
    ).toBe(true)
  })
})

/** A fake 2D context whose `filter` records every assignment. */
function fakeFilterContext(initial = 'none') {
  let value = initial
  const sets: string[] = []
  const context = {} as CanvasRenderingContext2D
  Object.defineProperty(context, 'filter', {
    get: () => value,
    set: (next: string) => {
      sets.push(next)
      value = next
    },
  })
  return { context, sets }
}

describe('canvasSupportsColorFilter (#195)', () => {
  it('is true when a set filter sticks, and restores the prior value', () => {
    const { context } = fakeFilterContext('sepia(100%)')
    expect(canvasSupportsColorFilter(context)).toBe(true)
    expect(context.filter).toBe('sepia(100%)')
  })

  it('is false when the context has no filter property (unsupported browser)', () => {
    expect(canvasSupportsColorFilter({} as CanvasRenderingContext2D)).toBe(false)
  })

  it('is false when assignments do not stick', () => {
    const context = {} as CanvasRenderingContext2D
    Object.defineProperty(context, 'filter', { get: () => 'none', set: () => {} })
    expect(canvasSupportsColorFilter(context)).toBe(false)
  })
})

describe('withLayerColorFilter (#195)', () => {
  it('sets the canonical shared string during the draw and resets after', () => {
    const { context, sets } = fakeFilterContext()
    let during = ''
    withLayerColorFilter(context, { brightness: 150, look: 'grayscale' }, () => {
      during = context.filter
    })
    // The same string the preview sets as CSS filter (#192): one rule.
    expect(during).toBe('brightness(150%) grayscale(100%)')
    expect(context.filter).toBe('none')
    expect(sets).toEqual(['brightness(150%) grayscale(100%)', 'none'])
  })

  it('leaves the context completely untouched for an unadjusted layer', () => {
    const { context, sets } = fakeFilterContext()
    let ran = false
    withLayerColorFilter(context, undefined, () => {
      ran = true
    })
    expect(ran).toBe(true)
    // Never assigned, not even 'none' — an unadjusted layer draws exactly
    // as before #195, filter-capable browser or not.
    expect(sets).toEqual([])
  })

  it('resets the filter even when the draw throws', () => {
    const { context } = fakeFilterContext()
    expect(() =>
      withLayerColorFilter(context, { look: 'sepia' }, () => {
        throw new Error('draw failed')
      }),
    ).toThrow('draw failed')
    expect(context.filter).toBe('none')
  })
})

// Per-clip orientation in the export (#233). The rotated pixels can only
// render in a real browser (e2e/export-orientation.spec.ts); these tests
// pin the pure decision — how the shared rule (#232) maps to the canvas
// transform around exactly the oriented layer's draw, in the fixed
// flip-then-rotate order, with the identity path byte-identical.

/** A fake 2D context recording every transform call, in order. */
function fakeTransformContext() {
  const calls: string[] = []
  const context = {
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    translate: (x: number, y: number) => calls.push(`translate(${x}, ${y})`),
    rotate: (angle: number) => calls.push(`rotate(${(angle * 180) / Math.PI})`),
    scale: (x: number, y: number) => calls.push(`scale(${x}, ${y})`),
  } as unknown as CanvasRenderingContext2D
  return { context, calls }
}

describe('withLayerOrientation (#233)', () => {
  const dest = { x: 40, y: 20, width: 160, height: 90 }

  it('passes the destination through untouched for an unoriented layer', () => {
    const { context, calls } = fakeTransformContext()
    let received: unknown = null
    withLayerOrientation(context, undefined, dest, (rect) => {
      received = rect
    })
    // The exact object, and not a single context call — an unoriented
    // layer's draw is byte-for-byte the pre-#233 one.
    expect(received).toBe(dest)
    expect(calls).toEqual([])
  })

  it('mirrors a flip about the destination centre, no rotation', () => {
    const { context, calls } = fakeTransformContext()
    let received: unknown = null
    withLayerOrientation(context, { flipH: true }, dest, (rect) => {
      received = rect
      calls.push('draw')
    })
    expect(calls).toEqual(['save', 'translate(120, 65)', 'scale(-1, 1)', 'draw', 'restore'])
    expect(received).toEqual({ x: -80, y: -45, width: 160, height: 90 })
  })

  it('maps flipV to the vertical axis', () => {
    const { context, calls } = fakeTransformContext()
    withLayerOrientation(context, { flipV: true }, dest, () => {})
    expect(calls).toEqual(['save', 'translate(120, 65)', 'scale(1, -1)', 'restore'])
  })

  it('rotates 180° in place: same box, no scale call', () => {
    const { context, calls } = fakeTransformContext()
    let received: unknown = null
    withLayerOrientation(context, { rotation: 180 }, dest, (rect) => {
      received = rect
    })
    expect(calls).toEqual(['save', 'translate(120, 65)', 'rotate(180)', 'restore'])
    expect(received).toEqual({ x: -80, y: -45, width: 160, height: 90 })
  })

  it('draws a quarter turn into the transposed box (the preview swapped media box)', () => {
    const { context, calls } = fakeTransformContext()
    let received: unknown = null
    withLayerOrientation(context, { rotation: 90 }, dest, (rect) => {
      received = rect
    })
    expect(calls).toEqual(['save', 'translate(120, 65)', 'rotate(90)', 'restore'])
    // The unrotated source paints into height × width, centred; the
    // rotation carries it onto dest exactly (the two letterbox ratios are
    // the same two numbers — orientation.ts).
    expect(received).toEqual({ x: -45, y: -80, width: 90, height: 160 })
  })

  it('composes rotation after flips — the shared rule fixed order', () => {
    const { context, calls } = fakeTransformContext()
    let received: unknown = null
    withLayerOrientation(context, { rotation: 270, flipH: true, flipV: true }, dest, (rect) => {
      received = rect
    })
    // Canvas transforms map drawn content through the calls right-to-left:
    // scale (the source own axes) first, then rotate — exactly the CSS
    // `rotate() scale()` order the preview sets (#232).
    expect(calls).toEqual([
      'save',
      'translate(120, 65)',
      'rotate(270)',
      'scale(-1, -1)',
      'restore',
    ])
    expect(received).toEqual({ x: -45, y: -80, width: 90, height: 160 })
  })

  it('restores the context even when the draw throws', () => {
    const { context, calls } = fakeTransformContext()
    expect(() =>
      withLayerOrientation(context, { rotation: 90 }, dest, () => {
        throw new Error('draw failed')
      }),
    ).toThrow('draw failed')
    expect(calls[calls.length - 1]).toBe('restore')
  })
})

// Per-clip crop in the export (#256). The cropped pixels can only render in
// a real browser (e2e/export-crop.spec.ts); these tests pin the pure
// decision — the kept source rectangle (`cropSourceRect`, the shared #255
// rule) becoming the drawImage source rect, with the crop-free path
// byte-identical to the pre-#256 draw.

/** A fake 2D context recording drawImage calls (and transforms, composed). */
function fakeDrawContext() {
  const draws: number[][] = []
  const calls: string[] = []
  const context = {
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    translate: (x: number, y: number) => calls.push(`translate(${x}, ${y})`),
    rotate: (angle: number) => calls.push(`rotate(${(angle * 180) / Math.PI})`),
    scale: (x: number, y: number) => calls.push(`scale(${x}, ${y})`),
    drawImage: (_source: unknown, ...args: number[]) => {
      draws.push(args)
      calls.push('draw')
    },
  } as unknown as CanvasRenderingContext2D
  return { context, draws, calls }
}

describe('drawLayerSource (#256)', () => {
  const source = {} as CanvasImageSource
  const drawRect = { x: 40, y: 20, width: 160, height: 90 }

  it('a crop-free layer keeps the 5-argument draw — byte-for-byte the pre-#256 call', () => {
    const { context, draws } = fakeDrawContext()
    drawLayerSource(context, source, undefined, 320, 180, drawRect)
    expect(draws).toEqual([[40, 20, 160, 90]])
  })

  it('a single cropped edge maps to the kept source rectangle', () => {
    const { context, draws } = fakeDrawContext()
    drawLayerSource(context, source, { left: 0.25 }, 320, 180, drawRect)
    // Left quarter trimmed from a 320×180 source: the draw starts 80px in
    // and spans the remaining 240px, into the whole destination box.
    expect(draws).toEqual([[80, 0, 240, 180, 40, 20, 160, 90]])
  })

  it('a vertical edge maps to the vertical axis', () => {
    const { context, draws } = fakeDrawContext()
    drawLayerSource(context, source, { top: 0.5 }, 320, 180, drawRect)
    expect(draws).toEqual([[0, 90, 320, 90, 40, 20, 160, 90]])
  })

  it('combined edges intersect into one kept rectangle', () => {
    const { context, draws } = fakeDrawContext()
    drawLayerSource(
      context,
      source,
      { left: 0.1, right: 0.2, top: 0.25, bottom: 0.25 },
      320,
      180,
      drawRect,
    )
    expect(draws).toEqual([[32, 45, 224, 90, 40, 20, 160, 90]])
  })

  it('composes with orientation: the kept rect draws into the transposed box (#255 order)', () => {
    const { context, draws, calls } = fakeDrawContext()
    withLayerOrientation(context, { rotation: 90 }, drawRect, (rect) => {
      drawLayerSource(context, source, { left: 0.5 }, 320, 180, rect)
    })
    // Crop selects the source content (the right half, in source pixels);
    // the quarter turn then rotates that kept region — the draw box is the
    // transposed one withLayerOrientation supplies, the source rect the
    // crop's, independent of the rotation.
    expect(calls).toEqual(['save', 'translate(120, 65)', 'rotate(90)', 'draw', 'restore'])
    expect(draws).toEqual([[160, 0, 160, 180, -45, -80, 90, 160]])
  })
})
