import type { ExportAudioSink } from './exportVideo'
// The bitrate lives in its own module so the guide can state it without
// importing this lazily loaded one (#503); the reasoning is there too.
import { MP3_KBPS } from './mp3Bitrate'

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

export const MP3_MIME_TYPE = 'audio/mpeg'

/**
 * The tap's ScriptProcessor buffer, in frames. The deprecated-but-universal
 * ScriptProcessorNode rather than an AudioWorklet: the worklet needs a
 * module script served from a URL, which complicates the build and the
 * tests for no audible benefit at export time (the page is not interactive
 * while an export runs, so the processor's main-thread latency cost is
 * irrelevant). 4096 frames ≈ 85 ms at 48 kHz — small enough that `stop()`'s
 * wait for the window's tail is imperceptible.
 */
const TAP_BUFFER_FRAMES = 4096

/** MP3 is stereo; a mono mix up-mixes into both channels in the graph. */
const CHANNELS = 2

/** How long `stop()` waits for the rest of the window (a context that was
 * closed early, or a graph that never ran) before giving up rather than
 * hanging the export. The tap's input trails the graph by a few buffers
 * (about 190 ms in Chromium at 44.1 kHz, #908), so this leaves room for
 * several times that. */
const STOP_FLUSH_TIMEOUT_MS = 1500

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
 * Which frames of one tap buffer belong to the exported window (#908), as
 * `[from, to)` indices into the buffer, or null for none. `marker` is the
 * buffer's marker channel: silent until the window begins, then 1 for good,
 * so its first raised sample is the window's first frame. `kept` is how many
 * window frames earlier buffers already gave, or null while the window has
 * not begun; `windowFrames` is the window's whole length. A buffer before
 * the window gives nothing, the one it begins in gives its tail, and the one
 * it ends in gives only its head: what is kept is the window, exactly.
 */
export function windowFramesIn(
  marker: Float32Array,
  kept: number | null,
  windowFrames: number,
): { from: number; to: number } | null {
  let from = 0
  let already = kept
  if (already === null) {
    from = marker.findIndex((sample) => sample > 0.5)
    if (from === -1) return null
    already = 0
  }
  const to = Math.min(marker.length, from + Math.max(0, windowFrames - already))
  return to > from ? { from, to } : null
}

/**
 * The audio sink an MP3 export hands the pipeline (#269): `attach` taps the
 * mix through a ScriptProcessor, `begin` marks the window's start, `stop`
 * waits until the whole window has arrived and detaches, and `finish`
 * encodes the window. The processor's *output* is zeroed each callback: it
 * must connect onward to `context.destination` to be pulled by the graph,
 * and writing silence there is what keeps the export inaudible — the
 * invariant `createAudioCapture` documents.
 *
 * **Where the window starts (#908).** The graph runs from `attach`, while
 * the pipeline still waits for the context and loads and cues its sources,
 * and those buffers are not the window: keeping them opened every export on
 * 0.1–0.15 s of silence. Nor can the main thread say which captured sample
 * is "now", because a ScriptProcessor hands its input over buffers late, by
 * an amount each browser sets (2 × 4096 + 128 frames in Chromium, measured
 * on #908). So the graph says it: the processor takes a third channel, a
 * marker that `begin` switches on, and the first frame the marker is raised
 * on is the window's first frame. The marker rides the same render quanta
 * as the mix, so the match is exact whatever the browser's delay, and from
 * there the sink keeps exactly the window's length (`windowFramesIn`).
 */
export function createMp3AudioSink(
  loadEncoder: () => Promise<Mp3EncoderModule> = defaultLoadEncoder,
): ExportAudioSink {
  const captured: Float32Array[][] = [[], []]
  let sampleRate: number | null = null
  let graph: AudioContext | null = null
  let processor: ScriptProcessorNode | null = null
  let marker: ConstantSourceNode | null = null
  /** Every node `attach` made, disconnected by `stop`. */
  let nodes: AudioNode[] = []
  let mix: AudioNode | null = null
  /** The window's length in frames, once `begin` has said it. */
  let windowFrames: number | null = null
  /** Window frames kept so far, or null before the marker has been heard. */
  let kept: number | null = null
  /** Resolved once the whole window has been kept. */
  let onWindowComplete: (() => void) | null = null
  const complete = () => windowFrames !== null && kept !== null && kept >= windowFrames

  return {
    attach: (context, mixNode) => {
      graph = context
      sampleRate = context.sampleRate
      mix = mixNode
      // The mix as stereo, split so the marker can join it as channel 2. MP3
      // is stereo, so a mono mix up-mixes into both channels, as before.
      const stereo = context.createGain()
      stereo.channelCount = CHANNELS
      stereo.channelCountMode = 'explicit'
      stereo.channelInterpretation = 'speakers'
      const split = context.createChannelSplitter(CHANNELS)
      const merge = context.createChannelMerger(CHANNELS + 1)
      const raised = context.createConstantSource()
      raised.offset.value = 1
      processor = context.createScriptProcessor(TAP_BUFFER_FRAMES, CHANNELS + 1, CHANNELS)
      processor.onaudioprocess = (event) => {
        for (let channel = 0; channel < CHANNELS; channel++) {
          event.outputBuffer.getChannelData(channel).fill(0)
        }
        if (windowFrames === null || complete()) return
        const slice = windowFramesIn(event.inputBuffer.getChannelData(CHANNELS), kept, windowFrames)
        if (slice === null) return
        for (let channel = 0; channel < CHANNELS; channel++) {
          // Copied: the browser reuses the buffer across callbacks.
          captured[channel].push(event.inputBuffer.getChannelData(channel).slice(slice.from, slice.to))
        }
        kept = (kept ?? 0) + (slice.to - slice.from)
        if (complete() && onWindowComplete !== null) {
          const settle = onWindowComplete
          onWindowComplete = null
          settle()
        }
      }
      mixNode.connect(stereo)
      stereo.connect(split)
      for (let channel = 0; channel < CHANNELS; channel++) split.connect(merge, channel, channel)
      raised.connect(merge, 0, CHANNELS)
      merge.connect(processor)
      processor.connect(context.destination)
      marker = raised
      nodes = [stereo, split, merge, raised, processor]
    },
    begin: (seconds) => {
      if (graph === null || marker === null || windowFrames !== null) return
      windowFrames = Math.max(0, Math.round(seconds * graph.sampleRate))
      // As soon as the graph can: the next render quantum is the window's first.
      marker.start()
    },
    stop: async () => {
      const tap = processor
      if (tap === null) return
      // The window's tail is still queued on the audio thread when the replay
      // loop ends, a few buffers behind it: wait for the last of it, or time
      // out (a context torn down early delivers nothing more). Before `begin`
      // (an aborted export) there is no window to wait for.
      if (windowFrames !== null && !complete()) {
        await new Promise<void>((resolve) => {
          let settled = false
          const settle = () => {
            if (!settled) {
              settled = true
              resolve()
            }
          }
          onWindowComplete = settle
          setTimeout(settle, STOP_FLUSH_TIMEOUT_MS)
        })
      }
      onWindowComplete = null
      tap.onaudioprocess = null
      try {
        marker?.stop()
      } catch {
        // Never started (an aborted export), or already stopped.
      }
      try {
        mix?.disconnect(nodes[0])
        for (const node of nodes) node.disconnect()
      } catch {
        // A context that already closed tore the graph down itself.
      }
      processor = null
    },
    finish: async () => {
      if (sampleRate === null || windowFrames === null || kept === null || captured[0].length === 0) {
        // Reaching here means the graph never delivered the window's start —
        // a wedged context, not a quiet mix (silence still yields buffers of
        // zeros).
        throw new Error('No audio was captured for the MP3 export.')
      }
      // A tail the graph never delivered (stop timed out) is silence: the
      // file is the window's length either way.
      if (kept < windowFrames) {
        for (let channel = 0; channel < CHANNELS; channel++) {
          captured[channel].push(new Float32Array(windowFrames - kept))
        }
      }
      return encodeMp3(concatChunks(captured[0]), concatChunks(captured[1]), sampleRate, loadEncoder)
    },
  }
}
