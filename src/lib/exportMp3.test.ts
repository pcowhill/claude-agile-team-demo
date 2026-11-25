import { afterEach, describe, expect, it, vi } from 'vitest'
import { MP3_KBPS } from './mp3Bitrate'
import {
  MP3_MIME_TYPE,
  PCM_TAP_PROCESSOR,
  PCM_TAP_WORKLET_SOURCE,
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
    port: { onmessage: ((event: { data: Float32Array[] }) => void) | null; closed: boolean; close(): void }
    options: AudioWorkletNodeOptions
    processorName: string
  }) | null = null
  let marker: (ReturnType<typeof node> & { offset: { value: number }; started: boolean; stopped: boolean }) | null = null
  /** The module sources the context was asked to load, read back from their Blobs. */
  const modules: Promise<string>[] = []
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
    audioWorklet: {
      addModule: async (url: string) => {
        modules.push(blobs.get(url)!.text())
      },
    },
  }
  // jsdom has no Blob URLs and no AudioWorkletNode: the sink's module goes
  // through the first, and its node is made by the second.
  const blobs = new Map<string, Blob>()
  vi.stubGlobal('URL', Object.assign(class extends URL {}, {
    createObjectURL: (blob: Blob) => {
      const url = `blob:fake/${blobs.size}`
      blobs.set(url, blob)
      return url
    },
    revokeObjectURL: () => {},
  }))
  vi.stubGlobal(
    'AudioWorkletNode',
    class {
      constructor(_context: unknown, processorName: string, options: AudioWorkletNodeOptions) {
        processor = node('processor', {
          port: {
            onmessage: null,
            closed: false,
            close() {
              this.closed = true
            },
          },
          options,
          processorName,
        })
        created.push(processor)
        return processor
      }
    },
  )
  const mix = {
    name: 'mix',
    connect: (target: { name: string }) => connections.push({ from: 'mix', to: target.name }),
    disconnect: () => {},
  }
  /**
   * Delivers one quantum through the tap, as the worklet posts it: the
   * mix's left and right, then the marker channel. `markerFrom` is the frame
   * the marker is raised from: the quantum the window begins in, or 0 for
   * every quantum after it. Omitted, the marker is silent throughout, as in
   * every quantum before `begin`.
   */
  const deliver = (left: Float32Array, right: Float32Array, markerFrom?: number) => {
    const raised = new Float32Array(left.length)
    if (markerFrom !== undefined) raised.fill(1, markerFrom)
    processor?.port.onmessage?.({ data: [left, right, raised] })
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
    modules,
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

describe('the PCM tap worklet (#926)', () => {
  /** The processor class the source registers, run with a port that records what it posts. */
  function loadProcessor() {
    let registered: { name: string; processor: new () => { port: unknown; process: (...args: unknown[]) => boolean } } | null =
      null
    const posted: { data: Float32Array[]; transfer: ArrayBuffer[] }[] = []
    class AudioWorkletProcessor {
      port = { postMessage: (data: Float32Array[], transfer: ArrayBuffer[]) => posted.push({ data, transfer }) }
    }
    new Function('registerProcessor', 'AudioWorkletProcessor', PCM_TAP_WORKLET_SOURCE)(
      (name: string, processor: never) => {
        registered = { name, processor }
      },
      AudioWorkletProcessor,
    )
    const { name, processor } = registered!
    return { name, instance: new processor(), posted }
  }

  it('registers under the name the sink makes its node with', () => {
    expect(loadProcessor().name).toBe(PCM_TAP_PROCESSOR)
  })

  it('posts every quantum\'s three channels as copies, transferred, keeps running, and outputs silence', () => {
    const { instance, posted } = loadProcessor()
    const input = [ramp(0, 128), ramp(1000, 128), new Float32Array(128).fill(1)]
    const output = [new Float32Array(128)]
    expect(instance.process([input], [output], {})).toBe(true)
    expect(posted).toHaveLength(1)
    const [quantum] = posted
    expect(quantum.data.map((channel) => [...channel])).toEqual(input.map((channel) => [...channel]))
    // Copies, not the audio thread's own buffers, which it reuses.
    for (let channel = 0; channel < 3; channel++) expect(quantum.data[channel]).not.toBe(input[channel])
    expect(quantum.transfer).toEqual(quantum.data.map((channel) => channel.buffer))
    expect([...output[0]]).toEqual(new Array(128).fill(0))
  })

  it('posts a quantum of silence for an input with no active connection, so the window keeps counting', () => {
    const { instance, posted } = loadProcessor()
    expect(instance.process([[]], [[new Float32Array(128)]], {})).toBe(true)
    expect(posted[0].data.map((channel) => channel.length)).toEqual([128, 128, 128])
    expect(posted[0].data.every((channel) => channel.every((sample) => sample === 0))).toBe(true)
  })
})

describe('createMp3AudioSink (#269)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('taps the mix and a marker into an AudioWorklet, loaded first, that takes its three channels as they are (#926)', async () => {
    const fake = fakeTapContext()
    const sink = createMp3AudioSink(realEncoder)
    await sink.attach(fake.context, fake.mix)
    expect(await Promise.all(fake.modules)).toEqual([PCM_TAP_WORKLET_SOURCE])
    // The mix, as stereo, is channels 0 and 1 of the processor's input and
    // the marker is channel 2 (#908). The processor connects onward so the
    // graph pulls it, but writes silence there (the worklet's own test
    // below), which is what keeps the export inaudible.
    expect(fake.connections).toEqual([
      { from: 'mix', to: 'stereo' },
      { from: 'stereo', to: 'split' },
      { from: 'split', to: 'merge', output: 0, input: 0 },
      { from: 'split', to: 'merge', output: 1, input: 1 },
      { from: 'marker', to: 'merge', output: 0, input: 2 },
      { from: 'merge', to: 'processor' },
      { from: 'processor', to: 'speakers' },
    ])
    expect(fake.processor?.processorName).toBe(PCM_TAP_PROCESSOR)
    // Discrete and explicit: three channels in, never up- or down-mixed, so
    // the marker stays out of the mix's channels.
    expect(fake.processor?.options).toMatchObject({
      numberOfInputs: 1,
      channelCount: 3,
      channelCountMode: 'explicit',
      channelInterpretation: 'discrete',
    })
  })

  it('raises the marker at begin, not before (#908)', async () => {
    const fake = fakeTapContext()
    const sink = createMp3AudioSink(realEncoder)
    await sink.attach(fake.context, fake.mix)
    expect(fake.marker?.offset.value).toBe(1)
    expect(fake.marker?.started).toBe(false)
    sink.begin(1)
    expect(fake.marker?.started).toBe(true)
  })

  it('encodes the window: nothing heard before it begins, and exactly its length (#908)', async () => {
    const fake = fakeTapContext(8000)
    const encoder = recordingEncoder()
    const sink = createMp3AudioSink(encoder.load)
    await sink.attach(fake.context, fake.mix)
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
    await sink.attach(fake.context, fake.mix)
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
      await sink.attach(fake.context, fake.mix)
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
      expect(tap?.port.onmessage).toBeNull()
      expect(tap?.port.closed).toBe(true)
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
      await sink.attach(fake.context, fake.mix)
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
      await sink.attach(fake.context, fake.mix)
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
    await sink.attach(fake.context, fake.mix)
    sink.begin(1)
    // Buffers arrive, but the marker never reaches the tap.
    fake.deliver(new Float32Array(8), new Float32Array(8))
    await expect(sink.finish()).rejects.toThrow(/No audio was captured/)
  })
})
