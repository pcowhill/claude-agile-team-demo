import { describe, expect, it } from 'vitest'
import { bytesSource, formatFrameRate, formatSampleRate, NOT_STATED, readContainerInfo } from './containerInfo'
import type { ByteSource } from './containerInfo'

/**
 * #805: what a file's container headers state. Each container is built here
 * byte by byte, from its specification, so each case says exactly what the
 * file states. The real fixtures, against what ffprobe reads from them, are
 * `e2e/clip-properties.spec.ts`'s.
 */

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}
const ascii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0))
const be = (value: number, width: number) => {
  const out = new Uint8Array(width)
  for (let k = width - 1, rest = value; k >= 0; k--, rest = Math.floor(rest / 256)) out[k] = rest % 256
  return out
}
const le = (value: number, width: number) => be(value, width).reverse()

// --- EBML (WebM / Matroska) -------------------------------------------------

/** An EBML element: its ID's own bytes, an 8-byte size, the payload. */
const el = (id: number, ...payload: Uint8Array[]) => {
  const body = concat(...payload)
  const idBytes: number[] = []
  for (let rest = id; rest > 0; rest = Math.floor(rest / 256)) idBytes.unshift(rest % 256)
  const size = be(body.length, 8)
  size[0] |= 0x01
  return concat(Uint8Array.from(idBytes), size, body)
}
const UNKNOWN_SIZE = Uint8Array.of(0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff)
const f64 = (value: number) => {
  const out = new Uint8Array(8)
  new DataView(out.buffer).setFloat64(0, value)
  return out
}
const f32 = (value: number) => {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setFloat32(0, value)
  return out
}

const ebmlHeader = (docType: string) => el(0x1a45dfa3, el(0x4286, be(1, 1)), el(0x4282, ascii(docType)))
const videoTrack = (codec: string, defaultDuration?: number) =>
  el(
    0xae,
    el(0xd7, be(1, 1)),
    el(0x83, be(1, 1)),
    el(0x86, ascii(codec)),
    ...(defaultDuration === undefined ? [] : [el(0x23e383, be(defaultDuration, 4))]),
    el(0xe0, el(0xb0, be(320, 2)), el(0xba, be(180, 2))),
  )
const audioTrack = (codec: string, frequency?: Uint8Array) =>
  el(
    0xae,
    el(0xd7, be(2, 1)),
    el(0x83, be(2, 1)),
    el(0x86, ascii(codec)),
    el(0xe1, ...(frequency === undefined ? [] : [el(0xb5, frequency)]), el(0x9f, be(1, 1))),
  )
const info = el(0x1549a966, el(0x2ad7b1, be(1_000_000, 3)))
const cluster = (bytes: number) => el(0x1f43b675, el(0xe7, be(0, 1)), el(0xa3, new Uint8Array(bytes)))

function webm(docType: string, tracks: Uint8Array[], options: { unknownSegment?: boolean; before?: Uint8Array[] } = {}) {
  const children = concat(info, ...(options.before ?? []), el(0x1654ae6b, ...tracks), cluster(64))
  const segment = options.unknownSegment
    ? concat(Uint8Array.of(0x18, 0x53, 0x80, 0x67), UNKNOWN_SIZE, children)
    : el(0x18538067, children)
  return concat(ebmlHeader(docType), segment)
}

// --- ISO BMFF (MP4 / MOV) ---------------------------------------------------

const box = (type: string, ...payload: Uint8Array[]) => {
  const body = concat(...payload)
  return concat(be(body.length + 8, 4), ascii(type), body)
}
const fullBox = (type: string, ...payload: Uint8Array[]) => box(type, be(0, 4), ...payload)

const mdhd = (timescale: number) => fullBox('mdhd', be(0, 4), be(0, 4), be(timescale, 4), be(0, 4), be(0, 4))
const hdlr = (handler: string) => fullBox('hdlr', be(0, 4), ascii(handler), new Uint8Array(12), Uint8Array.of(0))
const stts = (runs: [count: number, delta: number][]) =>
  fullBox('stts', be(runs.length, 4), ...runs.flatMap(([count, delta]) => [be(count, 4), be(delta, 4)]))
const stsd = (entry: Uint8Array) => fullBox('stsd', be(1, 4), entry)
const trak = (handler: string, timescale: number, entry: Uint8Array, timing?: Uint8Array) =>
  box(
    'trak',
    box('mdia', mdhd(timescale), hdlr(handler), box('minf', box('stbl', stsd(entry), ...(timing ? [timing] : [])))),
  )
/** A visual sample entry: SampleEntry, then 70 bytes of fixed fields this reader skips. */
const visualEntry = (type: string) => box(type, new Uint8Array(6), be(1, 2), new Uint8Array(70))
/** An audio sample entry (version 0): the rate in 16.16 at its 24th data byte. */
const audioEntry = (type: string, rate: number, ...children: Uint8Array[]) =>
  box(
    type,
    new Uint8Array(6),
    be(1, 2),
    new Uint8Array(8),
    be(2, 2),
    be(16, 2),
    be(0, 2),
    be(0, 2),
    be(rate * 65536, 4),
    ...children,
  )
/** An esds whose DecoderConfigDescriptor names `objectType` (0x40 AAC, 0x6b MP3). */
const esds = (objectType: number) =>
  fullBox(
    'esds',
    Uint8Array.of(0x03, 0x80, 0x80, 0x80, 0x19, 0x00, 0x01, 0x00),
    Uint8Array.of(0x04, 0x80, 0x80, 0x80, 0x11, objectType, 0x15),
    new Uint8Array(15),
  )
const ftyp = (brand: string) => box('ftyp', ascii(brand), be(0x200, 4), ascii(brand), ascii('iso2'))

// --- WAV and MP3 ------------------------------------------------------------

function wav(format: number, rate: number, extensibleSubformat?: number) {
  const extra =
    extensibleSubformat === undefined
      ? new Uint8Array(0)
      : concat(le(22, 2), le(16, 2), le(0x4, 4), le(extensibleSubformat, 2), new Uint8Array(14))
  const fmt = concat(le(format, 2), le(1, 2), le(rate, 4), le(rate * 2, 4), le(2, 2), le(16, 2), extra)
  const list = concat(ascii('LIST'), le(5, 4), ascii('INFOx'), Uint8Array.of(0))
  const body = concat(ascii('WAVE'), list, ascii('fmt '), le(fmt.length, 4), fmt, ascii('data'), le(4, 4), new Uint8Array(4))
  return concat(ascii('RIFF'), le(body.length, 4), body)
}

/** An ID3v2.4 tag of `size` bytes of padding, then MPEG frames. */
function mp3(frameHeader: number[], tagSize = 300) {
  const synchsafe = Uint8Array.of((tagSize >> 21) & 0x7f, (tagSize >> 14) & 0x7f, (tagSize >> 7) & 0x7f, tagSize & 0x7f)
  const tag = concat(ascii('ID3'), Uint8Array.of(4, 0, 0), synchsafe, new Uint8Array(tagSize))
  return concat(tag, Uint8Array.from(frameHeader), new Uint8Array(413))
}

/** A source that counts the bytes it hands out. */
function counted(bytes: Uint8Array): ByteSource & { readBytes: () => number } {
  let total = 0
  const inner = bytesSource(bytes)
  return {
    size: inner.size,
    read: async (offset, length) => {
      const out = await inner.read(offset, length)
      total += out.length
      return out
    },
    readBytes: () => total,
  }
}

const read = (bytes: Uint8Array) => readContainerInfo(bytesSource(bytes))

describe('WebM and Matroska headers (#805)', () => {
  it('reads the codecs, the DefaultDuration frame rate and the sampling frequency', async () => {
    const file = webm('webm', [videoTrack('V_VP8', 33_333_333), audioTrack('A_OPUS', f64(48000))])
    const result = await read(file)
    expect(result.container).toBe('WebM')
    expect(result.video?.codec).toBe('VP8')
    expect(formatFrameRate(result.video!.frameRate)).toBe('30 fps')
    expect(result.audio).toEqual({ codec: 'Opus', sampleRate: 48000 })
  })

  it('names a Matroska file, reads a 4-byte frequency, and an NTSC DefaultDuration', async () => {
    const file = webm('matroska', [videoTrack('V_MPEG4/ISO/AVC', 33_366_667), audioTrack('A_AAC/MPEG4/LC', f32(44100))])
    const result = await read(file)
    expect(result.container).toBe('Matroska')
    expect(result.video?.codec).toBe('H.264')
    expect(formatFrameRate(result.video!.frameRate)).toBe('29.97 fps')
    expect(result.audio).toEqual({ codec: 'AAC', sampleRate: 44100 })
  })

  it('says not stated for a recording with no DefaultDuration or frequency, in an unknown-size Segment', async () => {
    // A MediaRecorder's live WebM: the Segment's size is unknown, and the
    // video track gives no DefaultDuration.
    const file = webm('webm', [videoTrack('V_VP9'), audioTrack('A_OPUS')], {
      unknownSegment: true,
      before: [el(0xec, new Uint8Array(40))],
    })
    const result = await read(file)
    expect(result.video).toEqual({ codec: 'VP9', frameRate: { kind: 'not-stated' } })
    expect(formatFrameRate(result.video!.frameRate)).toBe(NOT_STATED)
    expect(result.audio).toEqual({ codec: 'Opus', sampleRate: null })
    expect(formatSampleRate(result.audio!.sampleRate)).toBe(NOT_STATED)
  })

  it('reports no audio for a silent video, and an unlisted codec by its ID', async () => {
    const result = await read(webm('webm', [videoTrack('V_SOMETHING', 40_000_000)]))
    expect(result.video?.codec).toBe('V_SOMETHING')
    expect(formatFrameRate(result.video!.frameRate)).toBe('25 fps')
    expect(result.audio).toBeNull()
  })

  it('rejects a file cut off inside its Tracks', async () => {
    const file = webm('webm', [videoTrack('V_VP8', 33_333_333), audioTrack('A_OPUS', f64(48000))])
    const tracksAt = file.findIndex((_, k) => file[k] === 0x16 && file[k + 1] === 0x54 && file[k + 2] === 0xae)
    await expect(read(file.slice(0, tracksAt + 20))).rejects.toThrow(/headers could not be read/)
  })
})

describe('MP4 and MOV headers (#805)', () => {
  const video = trak('vide', 30000, visualEntry('avc1'), stts([[30, 1001]]))
  const sound = trak('soun', 44100, audioEntry('mp4a', 44100, esds(0x40)), stts([[44, 1024]]))

  it('reads the codecs, the stts frame rate and the sample entry rate', async () => {
    const result = await read(concat(ftyp('isom'), box('moov', video, sound), box('mdat', new Uint8Array(64))))
    expect(result.container).toBe('MP4')
    expect(result.video?.codec).toBe('H.264')
    expect(formatFrameRate(result.video!.frameRate)).toBe('29.97 fps')
    expect(result.audio).toEqual({ codec: 'AAC', sampleRate: 44100 })
  })

  it('finds a moov after a large mdat by reading only box headers', async () => {
    const mdat = box('mdat', new Uint8Array(4_000_000))
    const moov = box('moov', video, sound)
    const source = counted(concat(ftyp('qt  '), mdat, moov))
    const result = await readContainerInfo(source)
    expect(result.container).toBe('QuickTime (MOV)')
    expect(formatFrameRate(result.video!.frameRate)).toBe('29.97 fps')
    // The ftyp's and mdat's headers, and the moov: nothing of the media.
    expect(source.readBytes()).toBeLessThan(moov.length + 64)
  })

  it('reports a variable rate with its average, and a fragmented file’s as not stated', async () => {
    const variable = trak('vide', 90000, visualEntry('vp09'), stts([[10, 3000], [10, 3100]]))
    const varied = await read(concat(ftyp('isom'), box('moov', variable)))
    expect(varied.video?.codec).toBe('VP9')
    expect(varied.video?.frameRate).toEqual({ kind: 'variable', average: (20 * 90000) / (10 * 3000 + 10 * 3100) })
    expect(formatFrameRate(varied.video!.frameRate)).toBe('Variable (29.51 fps on average)')
    expect(varied.audio).toBeNull()

    // A browser's MediaRecorder MP4 is fragmented: stts is empty.
    const fragmented = trak('vide', 1000, visualEntry('av01'), stts([]))
    const opus = trak('soun', 48000, audioEntry('Opus', 48000))
    const result = await read(concat(ftyp('iso5'), box('moov', fragmented, opus)))
    expect(result.video).toEqual({ codec: 'AV1', frameRate: { kind: 'not-stated' } })
    expect(result.audio).toEqual({ codec: 'Opus', sampleRate: 48000 })
  })

  it('names MP3 inside mp4a by its object type', async () => {
    const mp3Track = trak('soun', 48000, audioEntry('mp4a', 48000, esds(0x6b)))
    expect((await read(concat(ftyp('isom'), box('moov', mp3Track)))).audio?.codec).toBe('MP3')
  })

  it('rejects a moov cut off by the end of the file', async () => {
    const file = concat(ftyp('isom'), box('moov', video, sound))
    await expect(read(file.slice(0, file.length - 30))).rejects.toThrow(/headers could not be read/)
  })
})

describe('WAV headers (#805)', () => {
  it('reads PCM at 44,100 Hz past a chunk before fmt', async () => {
    const result = await read(wav(1, 44100))
    expect(result).toEqual({ container: 'WAV', video: null, audio: { codec: 'PCM', sampleRate: 44100 } })
    expect(formatSampleRate(result.audio!.sampleRate)).toBe('44,100 Hz')
  })

  it('reads the real format of WAVE_FORMAT_EXTENSIBLE', async () => {
    const result = await read(wav(0xfffe, 96000, 3))
    expect(result.audio).toEqual({ codec: 'PCM (floating point)', sampleRate: 96000 })
  })
})

describe('MP3 headers (#805)', () => {
  it('reads an MPEG-1 Layer III frame after an ID3v2 tag', async () => {
    // FF FB: MPEG-1, Layer III, no CRC. 90: 128 kbit/s, 44.1 kHz.
    const result = await read(mp3([0xff, 0xfb, 0x90, 0x64]))
    expect(result).toEqual({ container: 'MP3', video: null, audio: { codec: 'MP3', sampleRate: 44100 } })
  })

  it('reads an MPEG-2 frame’s rate', async () => {
    // FF F3: MPEG-2, Layer III. 80: 64 kbit/s, rate index 0, which is
    // 22.05 kHz for MPEG-2; 88 would be index 2, 16 kHz.
    expect((await read(mp3([0xff, 0xf3, 0x80, 0xc4]))).audio).toEqual({ codec: 'MP3', sampleRate: 22050 })
    expect((await read(mp3([0xff, 0xf3, 0x88, 0xc4]))).audio).toEqual({ codec: 'MP3', sampleRate: 16000 })
  })
})

describe('unreadable files (#805)', () => {
  it('rejects a container this editor does not read', async () => {
    await expect(read(concat(ascii('OggS'), new Uint8Array(60)))).rejects.toThrow(/not a container/)
    await expect(read(new Uint8Array(0))).rejects.toThrow(/not a container/)
  })

  it('rejects an ID3 tag with no frame after it', async () => {
    await expect(read(mp3([0, 0, 0, 0]))).rejects.toThrow(/no MPEG audio frame/)
  })
})
