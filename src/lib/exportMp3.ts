import type { ExportAudioSink } from './exportVideo'

/**
 * MP3 audio-only export (#269, from customer feedback #264): the mixed
 * soundtrack encoded to MP3 entirely client-side. No browser's MediaRecorder
 * emits MP3, so this cannot ride the recording pipeline the way `audio-webm`
 * (#245) does; instead an {@link ExportAudioSink} taps the same Web Audio
 * mix graph as raw PCM while the export's replay loop runs, and the samples
 * are encoded afterwards with a pure-JS LAME port. Same mix, different
 * encoder — parity with the WebM path is by construction, not by a second
 * mix.
 *
 * The encoder (`@breezystack/lamejs`, LGPL-3.0 — see ADR 0004) is loaded
 * lazily inside `finish()`, so it becomes its own chunk and the entry bundle
 * never carries it: a visitor pays for the encoder when an MP3 export runs,
 * not on page load.
 */

/**
 * Encoding bitrate. 192 kbps CBR: comfortably transparent for mixed
 * speech/music at MP3's efficiency, and still ~24 KB per second of audio.
 * (The WebM path records Opus at the browser's default, typically 128 kbps —
 * a more efficient codec, so the MP3 needs the higher number to keep up.)
 */
export const MP3_KBPS = 192

export const MP3_MIME_TYPE = 'audio/mpeg'

/**
 * The tap's ScriptProcessor buffer, in frames. The deprecated-but-universal
 * ScriptProcessorNode rather than an AudioWorklet: the worklet needs a
 * module script served from a URL, which complicates the build and the
 * tests for no audible benefit at export time (the page is not interactive
 * while an export runs, so the processor's main-thread latency cost is
 * irrelevant). 4096 frames ≈ 85 ms at 48 kHz — small enough that `stop()`'s
 * wait for the last buffer is imperceptible.
 */
const TAP_BUFFER_FRAMES = 4096

/** MP3 is stereo; a mono mix up-mixes into both channels in the graph. */
const CHANNELS = 2

/** How `stop()` gives up waiting for one more buffer (a context that was
 * closed early, or a graph that never ran) rather than hanging the export. */
const STOP_FLUSH_TIMEOUT_MS = 250

/** The encoder's granule size: LAME consumes samples 1152 frames at a time. */
const ENCODER_BLOCK_FRAMES = 1152

/** The shape of the lazily imported encoder module (see ADR 0004). */
export interface Mp3EncoderModule {
  Mp3Encoder: new (
    channels: number,
    sampleRate: number,
    kbps: number,
  ) => {
    encodeBuffer(left: Int16Array, right?: Int16Array): Uint8Array
    flush(): Uint8Array
  }
}

const defaultLoadEncoder = async (): Promise<Mp3EncoderModule> =>
  await import('@breezystack/lamejs')

/**
 * One channel of Float32 samples in [-1, 1] as 16-bit PCM, the encoder's
 * input format. Clamped first: the mix bus can exceed full scale when
 * several sources play at once, and integer wraparound turns a loud moment
 * into a full-volume crackle.
 */
export function floatTo16BitPcm(samples: Float32Array): Int16Array {
  const pcm = new Int16Array(samples.length)
  for (let index = 0; index < samples.length; index++) {
    const sample = Math.max(-1, Math.min(1, samples[index]))
    pcm[index] = Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff)
  }
  return pcm
}

/** One contiguous Float32Array from the tap's per-callback chunks. */
function concatChunks(chunks: readonly Float32Array[]): Float32Array {
  let length = 0
  for (const chunk of chunks) length += chunk.length
  const joined = new Float32Array(length)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.length
  }
  return joined
}

/**
 * Encodes captured stereo PCM to MP3 frames. Exported for the unit tests,
 * which run the real encoder against a known tone; the sink below is the
 * production caller.
 */
export async function encodeMp3(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  loadEncoder: () => Promise<Mp3EncoderModule> = defaultLoadEncoder,
): Promise<Blob> {
  let encoderModule: Mp3EncoderModule
  try {
    encoderModule = await loadEncoder()
  } catch {
    // The dynamic chunk failed to load (offline, or a deploy mid-visit):
    // surface a clear error for the export modal rather than a broken file.
    throw new Error('The MP3 encoder failed to load. Check the connection and try again.')
  }
  const encoder = new encoderModule.Mp3Encoder(CHANNELS, sampleRate, MP3_KBPS)
  const leftPcm = floatTo16BitPcm(left)
  const rightPcm = floatTo16BitPcm(right)
  const parts: Uint8Array<ArrayBuffer>[] = []
  const push = (bytes: Uint8Array) => {
    // lamejs actually returns Int8Array views despite its typings; the
    // underlying bytes are right, so re-view them unsigned. The copy into a
    // fresh buffer is what satisfies BlobPart's ArrayBuffer requirement.
    if (bytes.length > 0) {
      parts.push(new Uint8Array(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length)))
    }
  }
  for (let offset = 0; offset < leftPcm.length; offset += ENCODER_BLOCK_FRAMES) {
    push(
      encoder.encodeBuffer(
        leftPcm.subarray(offset, offset + ENCODER_BLOCK_FRAMES),
        rightPcm.subarray(offset, offset + ENCODER_BLOCK_FRAMES),
      ),
    )
  }
  push(encoder.flush())
  return new Blob(parts, { type: MP3_MIME_TYPE })
}

/**
 * The audio sink an MP3 export hands the pipeline (#269): `attach` taps the
 * mix through a ScriptProcessor that accumulates every buffer, `stop` waits
 * out the buffer still in flight and detaches, and `finish` encodes what was
 * heard. The processor's *output* is zeroed each callback: it must connect
 * onward to `context.destination` to be pulled by the graph, and writing
 * silence there is what keeps the export inaudible — the invariant
 * `createAudioCapture` documents.
 */
export function createMp3AudioSink(
  loadEncoder: () => Promise<Mp3EncoderModule> = defaultLoadEncoder,
): ExportAudioSink {
  const captured: Float32Array[][] = [[], []]
  let sampleRate: number | null = null
  let processor: ScriptProcessorNode | null = null
  let mix: AudioNode | null = null
  /** Resolved by the next onaudioprocess after stop() asks for one. */
  let onNextBuffer: (() => void) | null = null

  return {
    attach: (context, mixNode) => {
      sampleRate = context.sampleRate
      mix = mixNode
      processor = context.createScriptProcessor(TAP_BUFFER_FRAMES, CHANNELS, CHANNELS)
      processor.onaudioprocess = (event) => {
        for (let channel = 0; channel < CHANNELS; channel++) {
          // Copied: the browser reuses the buffer across callbacks.
          captured[channel].push(new Float32Array(event.inputBuffer.getChannelData(channel)))
          event.outputBuffer.getChannelData(channel).fill(0)
        }
        if (onNextBuffer !== null) {
          const settle = onNextBuffer
          onNextBuffer = null
          settle()
        }
      }
      mixNode.connect(processor)
      processor.connect(context.destination)
    },
    stop: async () => {
      const tap = processor
      if (tap === null) return
      // The last ≤ one buffer of real audio is still queued on the audio
      // thread when the replay loop ends; wait for it (or time out — a
      // context torn down early delivers nothing more).
      await new Promise<void>((resolve) => {
        let settled = false
        const settle = () => {
          if (!settled) {
            settled = true
            resolve()
          }
        }
        onNextBuffer = settle
        setTimeout(settle, STOP_FLUSH_TIMEOUT_MS)
      })
      onNextBuffer = null
      tap.onaudioprocess = null
      try {
        mix?.disconnect(tap)
        tap.disconnect()
      } catch {
        // A context that already closed tore the graph down itself.
      }
      processor = null
    },
    finish: async () => {
      if (sampleRate === null || captured[0].length === 0) {
        // Reaching here means the graph never delivered a buffer — a wedged
        // context, not a quiet mix (silence still yields buffers of zeros).
        throw new Error('No audio was captured for the MP3 export.')
      }
      return encodeMp3(concatChunks(captured[0]), concatChunks(captured[1]), sampleRate, loadEncoder)
    },
  }
}
