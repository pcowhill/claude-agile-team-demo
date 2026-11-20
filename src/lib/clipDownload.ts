import { clipFileName } from './mediaLibrary'
import type { LibraryClip } from './mediaLibrary'

/**
 * Download (#803, from the customer's #800): a library clip saved on its
 * own, as a file, through the browser's ordinary download.
 *
 * What is saved is the clip's file unchanged — the blob behind its object
 * URL is the imported, recorded or captured file, and trims, crops and
 * effects live on the timeline, not the clip. The one exception is an
 * extracted audio clip (#154), whose URL holds the *source video's* bytes:
 * saved as they are, the customer would get a video under an audio name, so
 * it saves as a WAV of its decoded sound instead.
 */

/** A file extension at the end of a name, dot included: ".mp4" in "holiday.mp4". */
function extensionOf(name: string): string {
  const match = /(\.[A-Za-z0-9]{1,8})$/.exec(name)
  // A leading dot alone (".hidden") is a name, not an extension.
  return match !== null && match.index > 0 ? match[1] : ''
}

/**
 * The suggested filename for a clip's download. The display name, so the
 * file is called what the library calls it; when a rename (#404) left the
 * name without the original file's extension, that extension is appended so
 * the file still opens as what it is. A name already ending in it is left
 * alone. An extracted audio clip saves as a WAV, so it ends in ".wav".
 */
export function clipDownloadName(clip: Pick<LibraryClip, 'name' | 'fileName' | 'extractedFrom'>): string {
  const wanted = clip.extractedFrom !== undefined ? '.wav' : extensionOf(clipFileName(clip))
  if (wanted === '' || clip.name.toLowerCase().endsWith(wanted.toLowerCase())) return clip.name
  return `${clip.name}${wanted}`
}

/** The decoded sound a WAV is written from: the parts of an `AudioBuffer` it reads. */
export interface PcmSource {
  numberOfChannels: number
  sampleRate: number
  length: number
  getChannelData: (channel: number) => Float32Array
}

/**
 * A 16-bit PCM WAV of `audio`, channels interleaved. Samples are clipped to
 * [-1, 1] before scaling, so a decoded overshoot cannot wrap round.
 */
export function encodeWav(audio: PcmSource): Blob {
  const channels = Math.max(1, audio.numberOfChannels)
  const blockAlign = channels * 2
  const dataLength = audio.length * blockAlign
  const bytes = new ArrayBuffer(44 + dataLength)
  const view = new DataView(bytes)
  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index++) view.setUint8(offset + index, text.charCodeAt(index))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // PCM format
  view.setUint16(22, channels, true)
  view.setUint32(24, audio.sampleRate, true)
  view.setUint32(28, audio.sampleRate * blockAlign, true) // byte rate
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true) // bits per sample
  ascii(36, 'data')
  view.setUint32(40, dataLength, true)
  const data = Array.from({ length: channels }, (_, channel) =>
    audio.getChannelData(Math.min(channel, audio.numberOfChannels - 1)),
  )
  let offset = 44
  for (let frame = 0; frame < audio.length; frame++) {
    for (const samples of data) {
      const sample = Math.max(-1, Math.min(1, samples[frame]))
      view.setInt16(offset, Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff), true)
      offset += 2
    }
  }
  return new Blob([bytes], { type: 'audio/wav' })
}

/** Decodes a clip's media to its sound, at the file's own sample rate where the browser allows. */
async function defaultDecode(url: string): Promise<PcmSource> {
  if (typeof OfflineAudioContext === 'undefined') {
    throw new Error('This browser cannot decode audio, so the extracted audio cannot be saved.')
  }
  const response = await fetch(url)
  if (!response.ok) throw new Error(`The clip's media could not be read (${response.status}).`)
  const encoded = await response.arrayBuffer()
  // As audioPeaks.ts: an OfflineAudioContext decodes without an audible
  // context or autoplay gating. Its sample rate is the one decoding
  // resamples to, so 48 kHz, the common rate of recorded and video audio.
  const context = new OfflineAudioContext(1, 1, 48000)
  try {
    return await context.decodeAudioData(encoded)
  } catch {
    throw new Error('The video has no sound this browser can decode, so there is no audio to save.')
  }
}

/** Saves `href` under `fileName` through a hidden anchor, as the export and Save frame do. */
function defaultSave(href: string, fileName: string) {
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

export interface DownloadDeps {
  decode?: (url: string) => Promise<PcmSource>
  save?: (href: string, fileName: string) => void
}

/**
 * Downloads a clip (#803). An ordinary clip saves straight from its own
 * object URL, so the bytes are the file's, with nothing read or copied. An
 * extracted audio clip is decoded and saved as a WAV from a URL of its own,
 * released once the browser has had time to start the download.
 *
 * Rejects with a reader-facing message when an extracted clip's sound
 * cannot be decoded. `decode` and `save` are injectable for tests: jsdom
 * has neither Web Audio nor downloads.
 */
export async function downloadClip(
  clip: Pick<LibraryClip, 'name' | 'fileName' | 'extractedFrom' | 'url'>,
  { decode = defaultDecode, save = defaultSave }: DownloadDeps = {},
): Promise<void> {
  const fileName = clipDownloadName(clip)
  if (clip.extractedFrom === undefined) {
    save(clip.url, fileName)
    return
  }
  const wav = encodeWav(await decode(clip.url))
  const url = URL.createObjectURL(wav)
  save(url, fileName)
  // Revoking straight after the click can cancel the download in some
  // browsers; a minute is long past the point where it has started.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
