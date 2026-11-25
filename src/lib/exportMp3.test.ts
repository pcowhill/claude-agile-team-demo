import { describe, expect, it, vi } from 'vitest'
import { MP3_KBPS } from './mp3Bitrate'
import {
  MP3_MIME_TYPE,
  createMp3AudioSink,
  encodeMp3,
  floatTo16BitPcm,
  windowFramesIn,
} from './exportMp3'
import type { Mp3EncoderModule } from './exportMp3'

/**
 * The encoder itself runs here for real: lamejs is pure JS, so the unit
 * tests exercise the actual MP3 framing rather than a mock of it — the
 * bytes asserted below are the bytes a browser export produces.
 */
const realEncoder = (): Promise<Mp3EncoderModule> => import('@breezystack/lamejs')

/** A 440 Hz second of stereo float samples at `rate`. */
function tone(rate: number, seconds = 1): { left: Float32Array; right: Float32Array } {
  const length = Math.round(rate * seconds)
  const left = new Float32Array(length)
  const right = new Float32Array(length)
  for (let index = 0; index < length; index++) {
    const sample = Math.sin((2 * Math.PI * 440 * index) / rate) * 0.5
    left[index] = sample
    right[index] = sample
  }
  return { left, right }
}

/** True at an MPEG audio frame sync: 11 set bits across two bytes. */
const isFrameSync = (bytes: Uint8Array, at: number) =>
  bytes[at] === 0xff && (bytes[at + 1] & 0xe0) === 0xe0

describe('floatTo16BitPcm (#269)', () => {
  it('scales [-1, 1] floats onto the full signed 16-bit range', () => {
    const pcm = floatTo16BitPcm(new Float32Array([0, 1, -1, 0.5]))
    expect(pcm[0]).toBe(0)
    expect(pcm[1]).toBe(0x7fff)
    expect(pcm[2]).toBe(-0x8000)
    expect(pcm[3]).toBe(Math.round(0.5 * 0x7fff))
  })

  it('clamps out-of-range samples instead of wrapping them into crackle', () => {
    // The mix bus can exceed full scale when several sources play at once.
    const pcm = floatTo16BitPcm(new Float32Array([1.7, -2.3]))
    expect(pcm[0]).toBe(0x7fff)
    expect(pcm[1]).toBe(-0x8000)
  })
})

describe('encodeMp3 (#269)', () => {
  it('produces an MPEG audio stream: sync pattern at byte 0, plausible CBR size', async () => {
    const { left, right } = tone(48000)
    const blob = await encodeMp3(left, right, 48000, realEncoder)
    expect(blob.type).toBe(MP3_MIME_TYPE)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    expect(isFrameSync(bytes, 0)).toBe(true)
    // One second at MP3_KBPS CBR is KBPS/8 kilobytes, give or take a frame.
    const expected = (MP3_KBPS / 8) * 1000
    expect(bytes.length).toBeGreaterThan(expected * 0.9)
    expect(bytes.length).toBeLessThan(expected * 1.2)
  })

  it('frames align: every frame header in the first kilobyte carries the sync', async () => {
    // MPEG-1 Layer III at 192 kbps / 48 kHz has a fixed 576-byte frame, so
    // the sync pattern must recur exactly there — a stronger claim than one
    // lucky 0xff at byte 0, and what a demuxer actually walks.
    const { left, right } = tone(48000)
    const blob = await encodeMp3(left, right, 48000, realEncoder)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const frameBytes = (144 * MP3_KBPS * 1000) / 48000
    expect(isFrameSync(bytes, frameBytes)).toBe(true)
    expect(isFrameSync(bytes, frameBytes * 2)).toBe(true)
  })

  it('reports an encoder that failed to load as a clear error, not a broken file', async () => {
    const { left, right } = tone(8000, 0.1)
    await expect(
      encodeMp3(left, right, 8000, () => Promise.reject(new Error('chunk fetch failed'))),
    ).rejects.toThrow(/MP3 encoder failed to load/)
  })
})

/** A fake Web Audio graph rich enough for the sink: jsdom has none. */
function fakeTapContext(sampleRate = 48000) {
  const connections: { from: string; to: string; output?: number; input?: number }[] = []
  /** A named fake node that records its connections and disconnection. */
  const node = <T extends object>(name: string, extra: T) => ({
    name,
    disconnected: false,
    connect(target: { name: string }, output?: number, input?: number) {
      connections.push({ from: name, to: target.name, ...(output === undefined ? {} : { output, input }) })
    },
    disconnect() {
      this.disconnected = true
    },
    ...extra,
  })
  let processor: (ReturnType<typeof node> & {
    onaudioprocess: ((event: unknown) => void) | null
    inputs: number
  }) | null = null
  let marker: (ReturnType<typeof node> & { offset: { value: number }; started: boolean; stopped: boolean }) | null = null
  const created: ReturnType<typeof node>[] = []
  const context = {
    sampleRate,
    destination: { name: 'speakers' },
    createGain: () => {
      const gain = node('stereo', { channelCount: 0, channelCountMode: '', channelInterpretation: '' })
      created.push(gain)
      return gain
    },
    createChannelSplitter: (_outputs: number) => {
      const split = node('split', {})
      created.push(split)
      return split
    },
    createChannelMerger: (_inputs: number) => {
      const merge = node('merge', {})
      created.push(merge)
      return merge
    },
    createConstantSource: () => {
      marker = node('marker', {
        offset: { value: 0 },
        started: false,
        stopped: false,
        start() {
          this.started = true
        },
        stop() {
          this.stopped = true
        },
      })
      created.push(marker)
      return marker
    },
    createScriptProcessor: (_size: number, inputs: number, _outputs: number) => {
      processor = node('processor', { onaudioprocess: null, inputs })
      created.push(processor)
      return processor
    },
  }
  const mix = {
    name: 'mix',
    connect: (target: { name: string }) => connections.push({ from: 'mix', to: target.name }),
    disconnect: () => {},
  }
  /**
   * Delivers one audio buffer through the tap, as the audio thread would.
   * `markerFrom` is the frame the marker channel is raised from: the buffer
   * the window begins in, or 0 for every buffer after it. Omitted, the
   * marker is silent throughout, as in every buffer before `begin`.
   */
  const deliver = (left: Float32Array, right: Float32Array, markerFrom?: number) => {
    const raised = new Float32Array(left.length)
    if (markerFrom !== undefined) raised.fill(1, markerFrom)
    const outLeft = new Float32Array(left.length).fill(0.123)
    const outRight = new Float32Array(right.length).fill(0.123)
    processor?.onaudioprocess?.({
      inputBuffer: { getChannelData: (channel: number) => [left, right, raised][channel] },
      outputBuffer: { getChannelData: (channel: number) => (channel === 0 ? outLeft : outRight) },
    })
    return { outLeft, outRight }
  }
  return {
    context: context as unknown as AudioContext,
    mix: mix as unknown as AudioNode,
    connections,
    created,
    deliver,
    get processor() {
      return processor
    },
    get marker() {
      return marker
    },
  }
}

/** A buffer of `length` frames counting up from `first`, so kept frames say which they were. */
const ramp = (first: number, length: number) =>
  Float32Array.from({ length }, (_, index) => (first + index) / 10000)

/** An encoder that records the left channel it is given, in [-1, 1], and emits nothing. */
function recordingEncoder() {
  const heard: number[] = []
  const load = (): Promise<Mp3EncoderModule> =>
    Promise.resolve({
      Mp3Encoder: class {
        encodeBuffer(left: Int16Array) {
          for (const sample of left) heard.push(sample / 0x7fff)
          return new Uint8Array(0)
        }
        flush() {
          return new Uint8Array(0)
        }
      },
    })
  return { heard, load }
}

describe('windowFramesIn (#908)', () => {
  const raisedFrom = (from: number, length = 8) => {
    const marker = new Float32Array(length)
    marker.fill(1, from)
    return marker
  }

  it('keeps nothing from a buffer before the window: the marker is silent throughout', () => {
    expect(windowFramesIn(new Float32Array(8), null, 100)).toBeNull()
  })

  it('keeps the tail of the buffer the window begins in, from the marker\'s first raised frame', () => {
    expect(windowFramesIn(raisedFrom(5), null, 100)).toEqual({ from: 5, to: 8 })
  })

  it('keeps only the head of the buffer the window ends in', () => {
    // 97 of 100 kept already: 3 more, whatever the buffer holds.
    expect(windowFramesIn(raisedFrom(0), 97, 100)).toEqual({ from: 0, to: 3 })
  })

  it('keeps a window that begins and ends inside one buffer exactly', () => {
    expect(windowFramesIn(raisedFrom(2), null, 3)).toEqual({ from: 2, to: 5 })
  })

  it('keeps nothing from a buffer after the window: it is complete', () => {
    expect(windowFramesIn(raisedFrom(0), 100, 100)).toBeNull()
  })

  it('keeps the whole of a buffer inside the window', () => {
    expect(windowFramesIn(raisedFrom(0), 10, 100)).toEqual({ from: 0, to: 8 })
  })
})

describe('createMp3AudioSink (#269)', () => {
  it('taps the mix and a marker into a script processor, and keeps the audible path silent', async () => {
    const fake = fakeTapContext()
    const sink = createMp3AudioSink(realEncoder)
    sink.attach(fake.context, fake.mix)
    // The mix, as stereo, is channels 0 and 1 of the processor's input and
    // the marker is channel 2 (#908). The processor connects onward so the
    // graph pulls it, but writes silence there (asserted below), which is
    // what keeps the export inaudible.
    expect(fake.connections).toEqual([
      { from: 'mix', to: 'stereo' },
      { from: 'stereo', to: 'split' },
      { from: 'split', to: 'merge', output: 0, input: 0 },
      { from: 'split', to: 'merge', output: 1, input: 1 },
      { from: 'marker', to: 'merge', output: 0, input: 2 },
      { from: 'merge', to: 'processor' },
      { from: 'processor', to: 'speakers' },
    ])
    expect(fake.processor?.inputs).toBe(3)
    const { outLeft, outRight } = fake.deliver(new Float32Array(8).fill(0.9), new Float32Array(8), 0)
    expect([...outLeft]).toEqual(new Array(8).fill(0))
    expect([...outRight]).toEqual(new Array(8).fill(0))
  })

  it('raises the marker at begin, not before (#908)', () => {
    const fake = fakeTapContext()
    const sink = createMp3AudioSink(realEncoder)
    sink.attach(fake.context, fake.mix)
    expect(fake.marker?.offset.value).toBe(1)
    expect(fake.marker?.started).toBe(false)
    sink.begin(1)
    expect(fake.marker?.started).toBe(true)
  })

  it('encodes the window: nothing heard before it begins, and exactly its length (#908)', async () => {
    const fake = fakeTapContext(8000)
    const encoder = recordingEncoder()
    const sink = createMp3AudioSink(encoder.load)
    sink.attach(fake.context, fake.mix)
    // Before begin, and after it while the marker has not yet reached the
    // tap: the graph was running, and none of it is the window.
    fake.deliver(new Float32Array(4096).fill(0.5), new Float32Array(4096).fill(0.5))
    sink.begin(0.5)
    fake.deliver(new Float32Array(4096).fill(0.5), new Float32Array(4096).fill(0.5))
    // The window: 4000 frames at 8 kHz, from frame 1000 of this buffer.
    fake.deliver(ramp(0, 4096), ramp(0, 4096), 1000)
    fake.deliver(ramp(4096, 4096), ramp(4096, 4096), 0)
    // After the window: never kept.
    fake.deliver(new Float32Array(4096).fill(0.5), new Float32Array(4096).fill(0.5), 0)
    await sink.stop()
    await sink.finish()
    expect(encoder.heard).toHaveLength(4000)
    // Frame 1000 of the buffer the window began in is the file's first
    // sample, and frame 999 of the next is its last.
    expect(encoder.heard[0]).toBeCloseTo(0.1, 3)
    expect(encoder.heard[3999]).toBeCloseTo(0.4999, 3)
  })

  it('encodes the window as a real MPEG audio stream of its length', async () => {
    const fake = fakeTapContext(48000)
    const sink = createMp3AudioSink(realEncoder)
    sink.attach(fake.context, fake.mix)
    sink.begin(0.5)
    const { left, right } = tone(48000, 0.6)
    fake.deliver(left, right, 0)
    await sink.stop()
    const blob = await sink.finish()
    const bytes = new Uint8Array(await blob.arrayBuffer())
    expect(isFrameSync(bytes, 0)).toBe(true)
    // Half a second at the CBR rate: the window's length was encoded, not
    // the 0.6 s the graph delivered.
    const expected = (MP3_KBPS / 8) * 1000 * 0.5
    expect(bytes.length).toBeGreaterThan(expected * 0.9)
    expect(bytes.length).toBeLessThan(expected * 1.1)
  })

  it('stop waits until the whole window has arrived, then detaches the tap', async () => {
    vi.useFakeTimers()
    try {
      const fake = fakeTapContext(8000)
      const sink = createMp3AudioSink(realEncoder)
      sink.attach(fake.context, fake.mix)
      const tap = fake.processor
      sink.begin(1)
      fake.deliver(new Float32Array(4096), new Float32Array(4096), 0)
      let stopped = false
      const stopping = sink.stop().then(() => {
        stopped = true
      })
      // Not yet: 4096 of the window's 8000 frames have arrived.
      await vi.advanceTimersByTimeAsync(100)
      expect(stopped).toBe(false)
      // The audio thread delivers the rest; stop resolves on it.
      fake.deliver(new Float32Array(4096), new Float32Array(4096), 0)
      await stopping
      expect(tap?.disconnected).toBe(true)
      expect(tap?.onaudioprocess).toBeNull()
      expect(fake.marker?.stopped).toBe(true)
      expect(fake.created.every((created) => created.disconnected)).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stop times out rather than hanging when the graph delivers nothing more, and the tail is silence', async () => {
    vi.useFakeTimers()
    try {
      const fake = fakeTapContext(8000)
      const encoder = recordingEncoder()
      const sink = createMp3AudioSink(encoder.load)
      sink.attach(fake.context, fake.mix)
      sink.begin(1)
      fake.deliver(new Float32Array(4096).fill(0.5), new Float32Array(4096).fill(0.5), 0)
      const stopping = sink.stop()
      await vi.advanceTimersByTimeAsync(1600)
      await expect(stopping).resolves.toBeUndefined()
      await sink.finish()
      // The file is still the window's length: what arrived, then silence.
      expect(encoder.heard).toHaveLength(8000)
      expect(encoder.heard[4095]).toBeCloseTo(0.5, 3)
      expect(encoder.heard[4096]).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stop before begin does not wait: an aborted export has no window', async () => {
    vi.useFakeTimers()
    try {
      const fake = fakeTapContext()
      const sink = createMp3AudioSink(realEncoder)
      sink.attach(fake.context, fake.mix)
      let stopped = false
      const stopping = sink.stop().then(() => {
        stopped = true
      })
      await Promise.resolve()
      await Promise.resolve()
      expect(stopped).toBe(true)
      await stopping
    } finally {
      vi.useRealTimers()
    }
  })

  it('stop before attach is a safe no-op — the abort path reaches it', async () => {
    const sink = createMp3AudioSink(realEncoder)
    await expect(sink.stop()).resolves.toBeUndefined()
  })

  it('finish with the window never heard reports a wedged graph rather than emitting an empty file', async () => {
    const fake = fakeTapContext()
    const sink = createMp3AudioSink(realEncoder)
    sink.attach(fake.context, fake.mix)
    sink.begin(1)
    // Buffers arrive, but the marker never reaches the tap.
    fake.deliver(new Float32Array(8), new Float32Array(8))
    await expect(sink.finish()).rejects.toThrow(/No audio was captured/)
  })
})
