import { readHeader } from './webmCues'
import type { Header } from './webmCues'

/**
 * What a media file's container headers state about it (#805, from the
 * customer's #800): the container, each track's codec, a video's frame rate
 * and a sound's sample rate. No browser API reports these (#805 says why),
 * so they are read from the file's own bytes.
 *
 * **Header reads only.** The file is read in small ranges: element and box
 * headers to step over the media, then the one metadata element that holds
 * the tracks (a WebM's Tracks, an MP4's moov, a WAV's fmt chunk, an MP3's
 * first frame header). No frame is decoded or demuxed, so a large file's
 * dialog does not stall on it.
 *
 * **Stated, never estimated.** A value is reported only when the file states
 * it. A WebM's frame rate is its video track's DefaultDuration, which a
 * MediaRecorder recording usually leaves out; such a file reports
 * `not-stated` rather than a rate inferred from block timestamps, which could
 * look authoritative while being wrong (#805's triage decision).
 *
 * Formats read: WebM/Matroska, MP4/MOV, WAV and MP3. Anything else, and any
 * file whose headers are cut off or malformed, rejects, and the dialog shows
 * Unknown.
 */

/** A video's frame rate, as the file states it. */
export type FrameRate =
  | { kind: 'constant'; fps: number }
  /** An MP4 whose sample durations differ: their average. */
  | { kind: 'variable'; average: number }
  | { kind: 'not-stated' }

export interface VideoTrackInfo {
  codec: string
  frameRate: FrameRate
}

export interface AudioTrackInfo {
  codec: string
  /** Hz; null when the file does not state it. */
  sampleRate: number | null
}

export interface ContainerInfo {
  /** WebM, Matroska, MP4, QuickTime (MOV), WAV or MP3. */
  container: string
  /** The first video track, or null when the file has none. */
  video: VideoTrackInfo | null
  /** The first audio track, or null when the file has none. */
  audio: AudioTrackInfo | null
}

/** A file read in ranges: a Blob in the app, bytes in tests. */
export interface ByteSource {
  size: number
  /** Up to `length` bytes from `offset`; fewer at the end of the file. */
  read: (offset: number, length: number) => Promise<Uint8Array>
}

export function blobSource(blob: Blob): ByteSource {
  return {
    size: blob.size,
    read: async (offset, length) => new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer()),
  }
}

export function bytesSource(bytes: Uint8Array): ByteSource {
  return { size: bytes.length, read: async (offset, length) => bytes.slice(offset, offset + length) }
}

/**
 * The largest metadata element read whole (a WebM's Tracks, an MP4's moov).
 * An hour of 60 fps MP4 has a moov of a few MB; anything past this is not a
 * header worth reading in a dialog.
 */
const MAX_METADATA_BYTES = 32 * 1024 * 1024
/** How many top-level elements or boxes are stepped over looking for it. */
const MAX_STEPS = 4096

class UnreadableHeaders extends Error {
  constructor(why: string) {
    super(`The file's headers could not be read: ${why}`)
  }
}

/** Reads what the container states, or rejects when it is not a container read here. */
export async function readContainerInfo(source: ByteSource): Promise<ContainerInfo> {
  const head = await source.read(0, 12)
  const text = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to))
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    return readMatroska(source)
  }
  if (head.length >= 8 && ['ftyp', 'moov', 'mdat', 'wide', 'free'].includes(text(4, 8))) {
    return readMp4(source)
  }
  if (head.length >= 12 && text(0, 4) === 'RIFF' && text(8, 12) === 'WAVE') return readWav(source)
  if ((head.length >= 3 && text(0, 3) === 'ID3') || (head.length >= 4 && mp3Frame(head, 0) !== null)) {
    return readMp3(source)
  }
  throw new UnreadableHeaders('not a container this editor reads')
}

// ---------------------------------------------------------------------------
// WebM / Matroska

const EBML = {
  Header: 0x1a45dfa3,
  DocType: 0x4282,
  Segment: 0x18538067,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackType: 0x83,
  CodecID: 0x86,
  DefaultDuration: 0x23e383,
  Audio: 0xe1,
  SamplingFrequency: 0xb5,
} as const

const MATROSKA_VIDEO = 1
const MATROSKA_AUDIO = 2

/** Matroska codec IDs (the Matroska codec registry), in the words a person knows them by. */
const MATROSKA_CODECS: [prefix: string, name: string][] = [
  ['V_VP8', 'VP8'],
  ['V_VP9', 'VP9'],
  ['V_AV1', 'AV1'],
  ['V_MPEG4/ISO/AVC', 'H.264'],
  ['V_MPEGH/ISO/HEVC', 'H.265 (HEVC)'],
  ['V_MPEG4/ISO', 'MPEG-4 Part 2'],
  ['V_THEORA', 'Theora'],
  ['V_PRORES', 'ProRes'],
  ['A_OPUS', 'Opus'],
  ['A_VORBIS', 'Vorbis'],
  ['A_AAC', 'AAC'],
  ['A_MPEG/L3', 'MP3'],
  ['A_MPEG/L2', 'MP2'],
  ['A_FLAC', 'FLAC'],
  ['A_PCM/FLOAT', 'PCM (floating point)'],
  ['A_PCM', 'PCM'],
  ['A_AC3', 'AC-3'],
  ['A_EAC3', 'E-AC-3'],
  ['A_ALAC', 'ALAC'],
]

function matroskaCodec(id: string): string {
  return MATROSKA_CODECS.find(([prefix]) => id.startsWith(prefix))?.[1] ?? id
}

/** An element's header at `offset` in the file, with `data` as a file offset. */
async function ebmlHeaderAt(source: ByteSource, offset: number): Promise<Header> {
  const bytes = await source.read(offset, 12)
  const header = readHeader(bytes, 0)
  if (header === null) throw new UnreadableHeaders('a cut-off element header')
  return { ...header, data: offset + header.data }
}

/** A known-size element's data, read whole. */
async function readWhole(source: ByteSource, header: Header, what: string): Promise<Uint8Array> {
  if (header.size === null) throw new UnreadableHeaders(`${what} has no size`)
  if (header.size > MAX_METADATA_BYTES) throw new UnreadableHeaders(`${what} is too large`)
  const data = await source.read(header.data, header.size)
  if (data.length < header.size) throw new UnreadableHeaders(`${what} is cut off`)
  return data
}

/** The children of `bytes[start, end)`, every one of known size and inside it. */
function ebmlChildren(bytes: Uint8Array, start = 0, end = bytes.length): Header[] {
  const out: Header[] = []
  for (let pos = start; pos < end; ) {
    const header = readHeader(bytes, pos)
    if (header === null || header.size === null || header.data + header.size > end) {
      throw new UnreadableHeaders('a malformed element')
    }
    out.push(header)
    pos = header.data + header.size
  }
  return out
}

function ebmlUint(bytes: Uint8Array, header: Header): number {
  let value = 0
  for (let k = 0; k < (header.size ?? 0); k++) value = value * 256 + bytes[header.data + k]
  return value
}

function ebmlString(bytes: Uint8Array, header: Header): string {
  return String.fromCharCode(...bytes.subarray(header.data, header.data + (header.size ?? 0))).replace(/\0+$/, '')
}

function ebmlFloat(bytes: Uint8Array, header: Header): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset + header.data, header.size ?? 0)
  if (header.size === 4) return view.getFloat32(0)
  if (header.size === 8) return view.getFloat64(0)
  return null
}

async function readMatroska(source: ByteSource): Promise<ContainerInfo> {
  const ebml = await ebmlHeaderAt(source, 0)
  const ebmlData = await readWhole(source, ebml, 'the EBML header')
  const docType = ebmlChildren(ebmlData).find((field) => field.id === EBML.DocType)
  const container = docType !== undefined && ebmlString(ebmlData, docType) === 'webm' ? 'WebM' : 'Matroska'

  const segment = await ebmlHeaderAt(source, ebml.data + (ebml.size ?? 0))
  if (segment.id !== EBML.Segment) throw new UnreadableHeaders('no Segment')
  // A live recording's Segment has an unknown size: it runs to the file's end.
  const end = segment.size === null ? source.size : Math.min(source.size, segment.data + segment.size)
  let pos = segment.data
  for (let step = 0; pos < end && step < MAX_STEPS; step++) {
    const child = await ebmlHeaderAt(source, pos)
    if (child.id === EBML.Tracks) return { container, ...matroskaTracks(await readWhole(source, child, 'Tracks')) }
    // An unknown-size child (a live recording's Cluster) cannot be stepped
    // over without reading its blocks, and Tracks comes before it.
    if (child.size === null) break
    pos = child.data + child.size
  }
  throw new UnreadableHeaders('no Tracks before the media')
}

function matroskaTracks(bytes: Uint8Array): Pick<ContainerInfo, 'video' | 'audio'> {
  let video: VideoTrackInfo | null = null
  let audio: AudioTrackInfo | null = null
  for (const entry of ebmlChildren(bytes)) {
    if (entry.id !== EBML.TrackEntry) continue
    const fields = ebmlChildren(bytes, entry.data, entry.data + (entry.size ?? 0))
    const field = (id: number) => fields.find((f) => f.id === id)
    const type = field(EBML.TrackType)
    const codecId = field(EBML.CodecID)
    if (type === undefined || codecId === undefined) continue
    const codec = matroskaCodec(ebmlString(bytes, codecId))
    const kind = ebmlUint(bytes, type)
    if (kind === MATROSKA_VIDEO && video === null) {
      // DefaultDuration: nanoseconds per frame, when the file states it.
      const perFrame = field(EBML.DefaultDuration)
      const ns = perFrame === undefined ? 0 : ebmlUint(bytes, perFrame)
      video = { codec, frameRate: ns > 0 ? { kind: 'constant', fps: 1e9 / ns } : { kind: 'not-stated' } }
    }
    if (kind === MATROSKA_AUDIO && audio === null) {
      const settings = field(EBML.Audio)
      const frequency =
        settings === undefined
          ? undefined
          : ebmlChildren(bytes, settings.data, settings.data + (settings.size ?? 0)).find(
              (f) => f.id === EBML.SamplingFrequency,
            )
      const rate = frequency === undefined ? null : ebmlFloat(bytes, frequency)
      // Matroska defaults an absent SamplingFrequency to 8 kHz; a default
      // is not a statement, so it is reported as not stated.
      audio = { codec, sampleRate: rate !== null && rate > 0 ? rate : null }
    }
  }
  return { video, audio }
}

// ---------------------------------------------------------------------------
// MP4 / MOV (ISO base media file format, and QuickTime before it)

interface Box {
  type: string
  /** Offset of the box's first byte. */
  start: number
  /** Offset of its data, past the header. */
  data: number
  /** Offset one past its last byte. */
  end: number
}

function fourcc(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(...bytes.subarray(at, at + 4))
}

function u32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) >>> 0) + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3]
}

function u16(bytes: Uint8Array, at: number): number {
  return (bytes[at] << 8) + bytes[at + 1]
}

/** A box header in `bytes` at `at`, its size resolved; null if cut off. */
function boxAt(bytes: Uint8Array, at: number, limit: number): Box | null {
  if (at + 8 > bytes.length) return null
  let size = u32(bytes, at)
  const type = fourcc(bytes, at + 4)
  let data = at + 8
  if (size === 1) {
    if (at + 16 > bytes.length) return null
    size = u32(bytes, at + 8) * 2 ** 32 + u32(bytes, at + 12)
    data = at + 16
  } else if (size === 0) {
    size = limit - at
  }
  if (size < data - at) return null
  return { type, start: at, data, end: at + size }
}

/** The boxes inside `bytes[start, end)`; throws if one runs past the end. */
function mp4Children(bytes: Uint8Array, start: number, end: number): Box[] {
  const out: Box[] = []
  for (let pos = start; pos + 8 <= end; ) {
    const box = boxAt(bytes, pos, end)
    if (box === null || box.end > end) throw new UnreadableHeaders('a malformed box')
    out.push(box)
    pos = box.end
  }
  return out
}

function child(bytes: Uint8Array, parent: Box | undefined, type: string): Box | undefined {
  return parent === undefined ? undefined : mp4Children(bytes, parent.data, parent.end).find((b) => b.type === type)
}

const MP4_VIDEO_CODECS: Record<string, string> = {
  avc1: 'H.264',
  avc3: 'H.264',
  hvc1: 'H.265 (HEVC)',
  hev1: 'H.265 (HEVC)',
  vp08: 'VP8',
  vp09: 'VP9',
  av01: 'AV1',
  mp4v: 'MPEG-4 Part 2',
  apch: 'ProRes',
  apcn: 'ProRes',
  apcs: 'ProRes',
  apco: 'ProRes',
  ap4h: 'ProRes',
  jpeg: 'Motion JPEG',
  mjpa: 'Motion JPEG',
}

const MP4_AUDIO_CODECS: Record<string, string> = {
  Opus: 'Opus',
  fLaC: 'FLAC',
  alac: 'ALAC',
  'ac-3': 'AC-3',
  'ec-3': 'E-AC-3',
  '.mp3': 'MP3',
  sowt: 'PCM',
  twos: 'PCM',
  lpcm: 'PCM',
  in24: 'PCM',
  in32: 'PCM',
  'raw ': 'PCM',
  fl32: 'PCM (floating point)',
  fl64: 'PCM (floating point)',
  ulaw: 'μ-law',
  alaw: 'A-law',
}

async function readMp4(source: ByteSource): Promise<ContainerInfo> {
  let container = 'QuickTime (MOV)'
  let pos = 0
  for (let step = 0; pos + 8 <= source.size && step < MAX_STEPS; step++) {
    const header = await source.read(pos, 16)
    const box = boxAt(header, 0, source.size - pos)
    if (box === null) break
    if (box.type === 'ftyp') {
      // The major brand: 'qt  ' is a QuickTime movie, anything else ISO MP4.
      container = header.length >= 12 && fourcc(header, 8) === 'qt  ' ? 'QuickTime (MOV)' : 'MP4'
    }
    if (box.type === 'moov') {
      const size = box.end - box.start
      if (size > MAX_METADATA_BYTES) throw new UnreadableHeaders('moov is too large')
      const moov = await source.read(pos, size)
      if (moov.length < size) throw new UnreadableHeaders('moov is cut off')
      return { container, ...mp4Tracks(moov) }
    }
    pos += box.end - box.start
  }
  throw new UnreadableHeaders('no moov')
}

function mp4Tracks(moov: Uint8Array): Pick<ContainerInfo, 'video' | 'audio'> {
  let video: VideoTrackInfo | null = null
  let audio: AudioTrackInfo | null = null
  const root = boxAt(moov, 0, moov.length)!
  for (const trak of mp4Children(moov, root.data, root.end)) {
    if (trak.type !== 'trak') continue
    const mdia = child(moov, trak, 'mdia')
    const hdlr = child(moov, mdia, 'hdlr')
    const mdhd = child(moov, mdia, 'mdhd')
    const stbl = child(moov, child(moov, mdia, 'minf'), 'stbl')
    const stsd = child(moov, stbl, 'stsd')
    if (hdlr === undefined || mdhd === undefined || stsd === undefined) continue
    // hdlr: version/flags, pre_defined, then the handler type.
    const handler = fourcc(moov, hdlr.data + 8)
    // mdhd: version/flags, then times of 4 bytes (version 0) or 8 (version 1), then the timescale.
    const timescale = u32(moov, mdhd.data + (moov[mdhd.data] === 1 ? 20 : 12))
    // stsd: version/flags, entry count, then the sample entries as boxes.
    const entry = mp4Children(moov, stsd.data + 8, stsd.end)[0]
    if (entry === undefined) continue
    if (handler === 'vide' && video === null) {
      video = {
        codec: MP4_VIDEO_CODECS[entry.type] ?? entry.type.trim(),
        frameRate: mp4FrameRate(moov, child(moov, stbl, 'stts'), timescale),
      }
    }
    if (handler === 'soun' && audio === null) {
      audio = { codec: mp4AudioCodec(moov, entry), sampleRate: mp4SampleRate(moov, entry, timescale) }
    }
  }
  return { video, audio }
}

/**
 * The frame rate stts states: each entry is a run of samples sharing one
 * duration, in the track's timescale. One duration throughout is a constant
 * rate; several are a variable one, reported with their average. A
 * fragmented MP4 (a browser's MediaRecorder output) keeps its timing in the
 * fragments and leaves stts empty: not stated here.
 */
function mp4FrameRate(moov: Uint8Array, stts: Box | undefined, timescale: number): FrameRate {
  if (stts === undefined || timescale <= 0) return { kind: 'not-stated' }
  const count = u32(moov, stts.data + 4)
  if (stts.data + 8 + count * 8 > stts.end) throw new UnreadableHeaders('stts is cut off')
  let samples = 0
  let duration = 0
  const deltas = new Set<number>()
  for (let k = 0; k < count; k++) {
    const run = u32(moov, stts.data + 8 + k * 8)
    const delta = u32(moov, stts.data + 12 + k * 8)
    if (run === 0) continue
    samples += run
    duration += run * delta
    deltas.add(delta)
  }
  if (samples === 0 || duration === 0) return { kind: 'not-stated' }
  if (deltas.size === 1) return { kind: 'constant', fps: timescale / [...deltas][0] }
  return { kind: 'variable', average: (samples * timescale) / duration }
}

/**
 * An audio sample entry's codec. 'mp4a' covers several MPEG audio codecs;
 * its esds names which, by the object type in its DecoderConfigDescriptor.
 */
function mp4AudioCodec(moov: Uint8Array, entry: Box): string {
  if (entry.type !== 'mp4a') return MP4_AUDIO_CODECS[entry.type] ?? entry.type.trim()
  const objectType = esdsObjectType(moov, entry)
  if (objectType === 0x69 || objectType === 0x6b) return 'MP3'
  if (objectType === 0xa5) return 'AC-3'
  if (objectType === 0xad) return 'Opus'
  return 'AAC'
}

function esdsObjectType(moov: Uint8Array, entry: Box): number | null {
  // The esds sits after the audio sample entry's fixed fields (28 bytes past
  // its header for version 0); search the entry's children for it.
  for (const offset of [entry.data + 28, entry.data + 44, entry.data + 64]) {
    try {
      const esds = mp4Children(moov, offset, entry.end).find((box) => box.type === 'esds')
      if (esds === undefined) continue
      // version/flags, then an ES_Descriptor (tag 3): ES_ID, flags, then a
      // DecoderConfigDescriptor (tag 4) whose first byte is the object type.
      let at = esds.data + 4
      const descriptor = (tag: number) => {
        if (moov[at] !== tag) return false
        at++
        for (let k = 0; k < 4 && moov[at] & 0x80; k++) at++
        at++
        return true
      }
      if (!descriptor(3)) return null
      const flags = moov[at + 2]
      at += 3
      if (flags & 0x80) at += 2
      if (flags & 0x40) at += 1 + moov[at]
      if (flags & 0x20) at += 2
      if (!descriptor(4)) return null
      return moov[at]
    } catch {
      continue
    }
  }
  return null
}

/**
 * The sample rate an audio sample entry states. Past its 8-byte SampleEntry
 * fields: version, revision, vendor, channels, sample size, two more 16-bit
 * fields, then the rate in 16.16 fixed point. A QuickTime version 2 entry
 * holds it as a 64-bit float further on instead. A rate too high for 16.16
 * (over 65,535 Hz) is written as 0 there, and the track's timescale is then
 * the rate.
 */
function mp4SampleRate(moov: Uint8Array, entry: Box, timescale: number): number | null {
  if (entry.data + 28 > entry.end) return null
  const version = u16(moov, entry.data + 8)
  if (version === 2 && entry.data + 40 <= entry.end) {
    const rate = new DataView(moov.buffer, moov.byteOffset + entry.data + 32, 8).getFloat64(0)
    return rate > 0 ? rate : null
  }
  const rate = u16(moov, entry.data + 24)
  if (rate > 0) return rate
  return timescale > 0 ? timescale : null
}

// ---------------------------------------------------------------------------
// WAV

const WAV_FORMATS: Record<number, string> = {
  0x0001: 'PCM',
  0x0003: 'PCM (floating point)',
  0x0006: 'A-law',
  0x0007: 'μ-law',
  0x0002: 'ADPCM',
  0x0011: 'ADPCM',
  0x0055: 'MP3',
}
const WAVE_FORMAT_EXTENSIBLE = 0xfffe

async function readWav(source: ByteSource): Promise<ContainerInfo> {
  let pos = 12
  for (let step = 0; pos + 8 <= source.size && step < MAX_STEPS; step++) {
    const header = await source.read(pos, 8)
    if (header.length < 8) break
    const id = fourcc(header, 0)
    const size = header[4] + (header[5] << 8) + (header[6] << 16) + ((header[7] << 24) >>> 0)
    if (id === 'fmt ') {
      const fmt = await source.read(pos + 8, Math.min(size, 40))
      if (fmt.length < 16) throw new UnreadableHeaders('fmt is cut off')
      const le16 = (at: number) => fmt[at] + (fmt[at + 1] << 8)
      let format = le16(0)
      // WAVE_FORMAT_EXTENSIBLE names the real format in its SubFormat GUID,
      // whose first two bytes are the format code.
      if (format === WAVE_FORMAT_EXTENSIBLE && fmt.length >= 26) format = le16(24)
      const rate = fmt[4] + (fmt[5] << 8) + (fmt[6] << 16) + ((fmt[7] << 24) >>> 0)
      const codec = WAV_FORMATS[format] ?? `Format 0x${format.toString(16).padStart(4, '0')}`
      return { container: 'WAV', video: null, audio: { codec, sampleRate: rate > 0 ? rate : null } }
    }
    // Chunks are padded to an even length.
    pos += 8 + size + (size % 2)
  }
  throw new UnreadableHeaders('no fmt chunk')
}

// ---------------------------------------------------------------------------
// MP3

const MPEG_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000], // MPEG-1
  2: [22050, 24000, 16000], // MPEG-2
  0: [11025, 12000, 8000], // MPEG-2.5
}

/** An MPEG audio frame header at `at`: its layer and sample rate, or null if there is none. */
function mp3Frame(bytes: Uint8Array, at: number): { layer: number; sampleRate: number } | null {
  if (at + 4 > bytes.length) return null
  if (bytes[at] !== 0xff || (bytes[at + 1] & 0xe0) !== 0xe0) return null
  const version = (bytes[at + 1] >> 3) & 0x3
  const layerBits = (bytes[at + 1] >> 1) & 0x3
  const bitrate = bytes[at + 2] >> 4
  const rateIndex = (bytes[at + 2] >> 2) & 0x3
  if (version === 1 || layerBits === 0 || bitrate === 0xf || rateIndex === 3) return null
  return { layer: 4 - layerBits, sampleRate: MPEG_RATES[version][rateIndex] }
}

async function readMp3(source: ByteSource): Promise<ContainerInfo> {
  let start = 0
  const id3 = await source.read(0, 10)
  if (id3.length === 10 && fourcc(id3, 0).startsWith('ID3')) {
    // An ID3v2 tag: a synchsafe size (7 bits a byte) after a 10-byte
    // header, and a 10-byte footer when flagged.
    const size = (id3[6] << 21) | (id3[7] << 14) | (id3[8] << 7) | id3[9]
    start = 10 + size + (id3[5] & 0x10 ? 10 : 0)
  }
  // The first frame follows the tag; some writers pad between them, so a
  // short stretch is searched.
  const window = await source.read(start, 4096)
  for (let at = 0; at + 4 <= window.length; at++) {
    const frame = mp3Frame(window, at)
    if (frame === null) continue
    return {
      container: 'MP3',
      video: null,
      audio: { codec: `MP${frame.layer === 3 ? 3 : frame.layer}`, sampleRate: frame.sampleRate },
    }
  }
  throw new UnreadableHeaders('no MPEG audio frame')
}

// ---------------------------------------------------------------------------
// Words

/** A rate to at most two decimals, trailing zeros dropped: 30, 29.97, 23.98. */
function rate(value: number): string {
  return String(Number(value.toFixed(2)))
}

/** "30 fps", "29.97 fps", "Variable (about 29.5 fps)", or "Not stated in the file". */
export function formatFrameRate(frameRate: FrameRate): string {
  if (frameRate.kind === 'constant') return `${rate(frameRate.fps)} fps`
  if (frameRate.kind === 'variable') return `Variable (${rate(frameRate.average)} fps on average)`
  return NOT_STATED
}

/** "48,000 Hz", or "Not stated in the file". */
export function formatSampleRate(sampleRate: number | null): string {
  if (sampleRate === null) return NOT_STATED
  return `${Math.round(sampleRate).toLocaleString('en-US')} Hz`
}

export const NOT_STATED = 'Not stated in the file'

/** The container info of the blob behind a clip's object URL. */
export async function readClipContainer(url: string): Promise<ContainerInfo> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`The clip's media could not be read (${response.status}).`)
  return readContainerInfo(blobSource(await response.blob()))
}
