import { describe, expect, it, vi } from 'vitest'
import {
  MP3_KBPS,
  MP3_MIME_TYPE,
  createMp3AudioSink,
  encodeMp3,
  floatTo16BitPcm,
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
  const connections: { from: string; to: unknown }[] = []
  let processor: {
    onaudioprocess: ((event: unknown) => void) | null
    connect: (target: unknown) => void
    disconnect: () => void
    disconnected: boolean
  } | null = null
  const context = {
    sampleRate,
    destination: { name: 'speakers' },
    createScriptProcessor: (_size: number, _inputs: number, _outputs: number) => {
      processor = {
        onaudioprocess: null,
        disconnected: false,
        connect: (target: unknown) => connections.push({ from: 'processor', to: target }),
        disconnect() {
          this.disconnected = true
        },
      }
      return processor
    },
  }
  const mix = {
    connect: (target: unknown) => connections.push({ from: 'mix', to: target }),
    disconnect: () => {},
  }
  /** Delivers one audio buffer through the tap, as the audio thread would. */
  const deliver = (left: Float32Array, right: Float32Array) => {
    const outLeft = new Float32Array(left.length).fill(0.123)
    const outRight = new Float32Array(right.length).fill(0.123)
    processor?.onaudioprocess?.({
      inputBuffer: { getChannelData: (channel: number) => (channel === 0 ? left : right) },
      outputBuffer: { getChannelData: (channel: number) => (channel === 0 ? outLeft : outRight) },
    })
    return { outLeft, outRight }
  }
  return {
    context: context as unknown as AudioContext,
    mix: mix as unknown as AudioNode,
    connections,
    deliver,
    get processor() {
      return processor
    },
  }
}

describe('createMp3AudioSink (#269)', () => {
  it('taps the mix into a script processor and keeps the audible path silent', async () => {
    const fake = fakeTapContext()
    const sink = createMp3AudioSink(realEncoder)
    sink.attach(fake.context, fake.mix)
    // The mix feeds the processor; the processor connects onward so the
    // graph pulls it — but writes silence there (asserted below), which is
    // what keeps the export inaudible.
    expect(fake.connections).toEqual([
      { from: 'mix', to: fake.processor },
      { from: 'processor', to: (fake.context as unknown as { destination: unknown }).destination },
    ])
    const { outLeft, outRight } = fake.deliver(new Float32Array(8).fill(0.9), new Float32Array(8))
    expect([...outLeft]).toEqual(new Array(8).fill(0))
    expect([...outRight]).toEqual(new Array(8).fill(0))
  })

  it('encodes exactly the samples the graph delivered', async () => {
    const fake = fakeTapContext(48000)
    const sink = createMp3AudioSink(realEncoder)
    sink.attach(fake.context, fake.mix)
    const { left, right } = tone(48000, 0.5)
    fake.deliver(left, right)
    await sink.stop()
    const blob = await sink.finish()
    const bytes = new Uint8Array(await blob.arrayBuffer())
    expect(isFrameSync(bytes, 0)).toBe(true)
    // Half a second at the CBR rate — the duration proves the delivered
    // samples (and only they) were encoded.
    const expected = (MP3_KBPS / 8) * 1000 * 0.5
    expect(bytes.length).toBeGreaterThan(expected * 0.9)
    expect(bytes.length).toBeLessThan(expected * 1.2)
  })

  it('stop waits for the buffer in flight, then detaches the tap', async () => {
    vi.useFakeTimers()
    try {
      const fake = fakeTapContext()
      const sink = createMp3AudioSink(realEncoder)
      sink.attach(fake.context, fake.mix)
      const tap = fake.processor
      let stopped = false
      const stopping = sink.stop().then(() => {
        stopped = true
      })
      // Not yet: the tail buffer has not arrived and the timeout has not run.
      await Promise.resolve()
      expect(stopped).toBe(false)
      // The audio thread delivers one more buffer; stop resolves on it.
      fake.deliver(new Float32Array(4), new Float32Array(4))
      await stopping
      expect(tap?.disconnected).toBe(true)
      expect(tap?.onaudioprocess).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stop times out rather than hanging when the graph delivers nothing more', async () => {
    vi.useFakeTimers()
    try {
      const fake = fakeTapContext()
      const sink = createMp3AudioSink(realEncoder)
      sink.attach(fake.context, fake.mix)
      const stopping = sink.stop()
      await vi.advanceTimersByTimeAsync(300)
      await expect(stopping).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stop before attach is a safe no-op — the abort path reaches it', async () => {
    const sink = createMp3AudioSink(realEncoder)
    await expect(sink.stop()).resolves.toBeUndefined()
  })

  it('finish with nothing captured reports a wedged graph rather than emitting an empty file', async () => {
    const fake = fakeTapContext()
    const sink = createMp3AudioSink(realEncoder)
    sink.attach(fake.context, fake.mix)
    await expect(sink.finish()).rejects.toThrow(/No audio was captured/)
  })
})
