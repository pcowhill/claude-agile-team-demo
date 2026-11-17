import { describe, expect, it } from 'vitest'
import cuelessClustersBase64 from './fixtures/cueless-clusters.webm.base64?raw'
import { planWebmCues, webmBlobWithCues, withWebmCues } from './webmCues'

/**
 * src/lib/fixtures/cueless-clusters.webm.base64: 6 s of ffmpeg testsrc,
 * VP8 with one keyframe, 1 s clusters, no Cues, made with
 * `ffmpeg -f lavfi -i testsrc=size=192x108:rate=30 -t 6 -c:v libvpx -g 1000
 * -keyint_min 1000 -b:v 80k -cluster_time_limit 1000 -live 1 -fflags +bitexact`.
 * Firefox jumps to the end of it from 1.5 s (#584). e2e/webm-cues.spec.ts
 * plays the same bytes.
 */
const fixtureBytes = () => Uint8Array.from(atob(cuelessClustersBase64.replace(/\s+/g, '')), (c) => c.charCodeAt(0))

// Builds WebMs out of EBML elements, so each test states the structure it is
// about. IDs and the element layout follow the Matroska spec.

function vint(value: number, width?: number): number[] {
  let length = width ?? 1
  if (width === undefined) while (value >= 2 ** (7 * length) - 1) length++
  const out: number[] = []
  let rest = value
  for (let k = 0; k < length; k++) {
    out.unshift(rest % 256)
    rest = Math.floor(rest / 256)
  }
  out[0] |= 0x80 >> (length - 1)
  return out
}

function idOf(id: number): number[] {
  const out: number[] = []
  for (let rest = id; rest > 0; rest = Math.floor(rest / 256)) out.unshift(rest % 256)
  return out
}

function uint(value: number): number[] {
  const out: number[] = []
  for (let rest = value; rest > 0; rest = Math.floor(rest / 256)) out.unshift(rest % 256)
  return out.length === 0 ? [0] : out
}

const el = (id: number, ...payload: number[][]): number[] => {
  const body = payload.flat()
  return [...idOf(id), ...vint(body.length), ...body]
}
/** An element whose size field says "unknown" (all ones, 8 bytes). */
const unsized = (id: number, ...payload: number[][]): number[] => [
  ...idOf(id),
  0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
  ...payload.flat(),
]

const ebmlHeader = (docType = 'webm') =>
  el(0x1a45dfa3, el(0x4282, [...docType].map((c) => c.charCodeAt(0))))
const info = (duration = [0, 0, 0, 0, 0, 0, 0, 0]) =>
  el(0x1549a966, el(0x2ad7b1, uint(1_000_000)), el(0x4489, duration))
const track = (number: number, type: number) =>
  el(0xae, el(0xd7, uint(number)), el(0x83, uint(type)))
const tracks = (...entries: number[][]) => el(0x1654ae6b, ...entries)
/** A SimpleBlock on `trackNumber` at `relative` ms, keyframe or not. */
const block = (trackNumber: number, relative: number, keyframe: boolean, payload = [1, 2, 3]) =>
  el(0xa3, vint(trackNumber), [(relative >> 8) & 0xff, relative & 0xff], [keyframe ? 0x80 : 0], payload)
const timecode = (ms: number) => el(0xe7, uint(ms))

const VIDEO = 1
const AUDIO = 2

/** A Firefox-recording-shaped file: unknown sizes, no Cues, keyframe at 0 only. */
function recordingShaped(clusterCount = 3): Uint8Array {
  const clusters: number[][] = []
  for (let k = 0; k < clusterCount; k++) {
    clusters.push(
      unsized(0x1f43b675, timecode(k * 1000), block(1, 0, k === 0), block(1, 500, false)),
    )
  }
  return Uint8Array.from([
    ...ebmlHeader(),
    ...unsized(0x18538067, el(0x114d9b74), info(), tracks(track(1, VIDEO)), ...clusters),
  ])
}

function applied(bytes: Uint8Array): Uint8Array {
  const plan = planWebmCues(bytes)
  if (plan === null) throw new Error('expected a plan')
  const out = new Uint8Array(
    plan.head.length + (plan.bodyEnd - plan.bodyStart) + plan.tail.length + (bytes.length - plan.bodyEnd),
  )
  out.set(plan.head, 0)
  out.set(bytes.subarray(plan.bodyStart, plan.bodyEnd), plan.head.length)
  out.set(plan.tail, plan.head.length + plan.bodyEnd - plan.bodyStart)
  out.set(bytes.subarray(plan.bodyEnd), plan.head.length + plan.bodyEnd - plan.bodyStart + plan.tail.length)
  return out
}

// A minimal reader for the output: enough to follow the SeekHead and Cues.
interface Read {
  id: number
  data: number
  size: number | null
}
function read(bytes: Uint8Array, pos: number): Read {
  // Bounded, so a wrong offset fails the test instead of hanging it.
  if (pos < 0 || pos >= bytes.length) throw new Error(`no element at ${pos}`)
  let idLength = 1
  while (idLength <= 4 && (bytes[pos] & (0x80 >> (idLength - 1))) === 0) idLength++
  if (idLength > 4) throw new Error(`no element ID at ${pos}`)
  let id = 0
  for (let k = 0; k < idLength; k++) id = id * 256 + bytes[pos + k]
  const s = pos + idLength
  let sizeLength = 1
  while (sizeLength <= 8 && (bytes[s] & (0x80 >> (sizeLength - 1))) === 0) sizeLength++
  if (sizeLength > 8) throw new Error(`no element size at ${s}`)
  let size = bytes[s] & (0xff >> sizeLength)
  let ones = size === 0xff >> sizeLength
  for (let k = 1; k < sizeLength; k++) {
    if (bytes[s + k] !== 0xff) ones = false
    size = size * 256 + bytes[s + k]
  }
  return { id, data: s + sizeLength, size: ones ? null : size }
}
function kids(bytes: Uint8Array, r: Read): Read[] {
  const out: Read[] = []
  for (let p = r.data; p < r.data + (r.size ?? 0); ) {
    const k = read(bytes, p)
    if (k.size === null) throw new Error(`unknown size inside a master at ${p}`)
    out.push(k)
    p = k.data + k.size
  }
  return out
}
const num = (bytes: Uint8Array, r: Read) =>
  [...bytes.subarray(r.data, r.data + (r.size ?? 0))].reduce((a, b) => a * 256 + b, 0)

/** Segment data offset, its SeekHead's map of ID → absolute offset, and the cues. */
function inspect(bytes: Uint8Array) {
  const header = read(bytes, 0)
  const segmentAt = header.data + (header.size ?? 0)
  const segment = read(bytes, segmentAt)
  const seekHead = read(bytes, segment.data)
  expect(seekHead.id).toBe(0x114d9b74)
  const seeks = new Map<number, number>()
  for (const seek of kids(bytes, seekHead)) {
    const [idField, posField] = kids(bytes, seek)
    seeks.set(num(bytes, idField), segment.data + num(bytes, posField))
  }
  const cuesAt = seeks.get(0x1c53bb6b)
  if (cuesAt === undefined) throw new Error('no Cues entry in the SeekHead')
  const cues = read(bytes, cuesAt)
  const points = kids(bytes, cues).map((point) => {
    const [time, positions] = kids(bytes, point)
    const [trackField, clusterField] = kids(bytes, positions)
    return {
      time: num(bytes, time),
      track: num(bytes, trackField),
      cluster: segment.data + num(bytes, clusterField),
    }
  })
  return { segment, seeks, cues, points }
}

describe('planWebmCues (#584)', () => {
  it('indexes the only keyframe of a recording whose later clusters hold none', () => {
    const source = recordingShaped(3)
    const out = applied(source)
    const { seeks, cues, points } = inspect(out)

    expect(cues.id).toBe(0x1c53bb6b)
    expect(points).toHaveLength(1)
    expect(points[0].time).toBe(0)
    expect(points[0].track).toBe(1)
    // The cue lands on a Cluster, and it is the first one.
    expect(read(out, points[0].cluster).id).toBe(0x1f43b675)
    // Info and Tracks are still reachable through the new SeekHead.
    expect(read(out, seeks.get(0x1549a966)!).id).toBe(0x1549a966)
    expect(read(out, seeks.get(0x1654ae6b)!).id).toBe(0x1654ae6b)
  })

  it('carries every cluster over byte for byte and leaves Duration as it was', () => {
    const source = recordingShaped(4)
    const plan = planWebmCues(source)!
    const out = applied(source)
    const clusters = source.subarray(plan.bodyStart, plan.bodyEnd)
    // The clusters appear, unchanged, right after the new head.
    expect(out.subarray(plan.head.length, plan.head.length + clusters.length)).toEqual(clusters)
    // Duration 0.0 stays 0.0: a known Duration made Chromium land every
    // seek at 0 on these files (#584).
    const durationAt = (bytes: Uint8Array) => {
      const at = bytes.findIndex((b, i) => b === 0x44 && bytes[i + 1] === 0x89)
      return [...bytes.subarray(at + 3, at + 11)]
    }
    expect(durationAt(out)).toEqual(durationAt(source))
  })

  it('adds one cue per video keyframe, at its cluster time plus its block offset', () => {
    const source = Uint8Array.from([
      ...ebmlHeader(),
      ...unsized(
        0x18538067,
        info(),
        tracks(track(1, AUDIO), track(2, VIDEO)),
        unsized(0x1f43b675, timecode(0), block(2, 0, true), block(1, 0, true)),
        unsized(0x1f43b675, timecode(1000), block(1, 0, true), block(2, 40, false)),
        unsized(0x1f43b675, timecode(2000), block(2, 120, true), block(1, 10, true)),
      ),
    ])
    const out = applied(source)
    const { points } = inspect(out)
    // The audio blocks are keyframes too, but Firefox's trouble is with video.
    expect(points.map((p) => [p.time, p.track])).toEqual([
      [0, 2],
      [2120, 2],
    ])
    expect(points.every((p) => read(out, p.cluster).id === 0x1f43b675)).toBe(true)
    expect(points[0].cluster).toBeLessThan(points[1].cluster)
  })

  it('reads a BlockGroup as a keyframe only when it references no other block', () => {
    const groupBlock = (relative: number, reference: boolean) =>
      el(
        0xa0,
        el(0xa1, vint(1), [(relative >> 8) & 0xff, relative & 0xff], [0], [9, 9]),
        ...(reference ? [el(0xfb, [0xff, 0xdf])] : []),
      )
    const source = Uint8Array.from([
      ...ebmlHeader(),
      ...unsized(
        0x18538067,
        info(),
        tracks(track(1, VIDEO)),
        unsized(0x1f43b675, timecode(0), groupBlock(0, false), groupBlock(33, true)),
        unsized(0x1f43b675, timecode(1000), groupBlock(0, true), groupBlock(500, false)),
      ),
    ])
    expect(inspect(applied(source)).points.map((p) => p.time)).toEqual([0, 1500])
  })

  it('gives a known-size Segment its new size, so the Cues fall inside it', () => {
    const body = [info(), tracks(track(1, VIDEO)), el(0x1f43b675, timecode(0), block(1, 0, true))].flat()
    const source = Uint8Array.from([...ebmlHeader(), ...el(0x18538067, body)])
    const out = applied(source)
    const { segment, cues } = inspect(out)
    expect(segment.size).not.toBeNull()
    expect(segment.data + segment.size!).toBe(out.length)
    expect(cues.data + cues.size!).toBe(out.length)
  })

  it('keeps an element after the clusters reachable at its new offset', () => {
    const tags = el(0x1254c367, el(0x7373, [1]))
    const source = Uint8Array.from([
      ...ebmlHeader(),
      ...unsized(
        0x18538067,
        info(),
        tracks(track(1, VIDEO)),
        unsized(0x1f43b675, timecode(0), block(1, 0, true)),
        unsized(0x1f43b675, timecode(1000), block(1, 0, false)),
        tags,
      ),
    ])
    const out = applied(source)
    const { seeks } = inspect(out)
    expect(read(out, seeks.get(0x1254c367)!).id).toBe(0x1254c367)
  })

  it.each([
    ['already has Cues', () => {
      const cues = el(0x1c53bb6b, el(0xbb, el(0xb3, [0]), el(0xb7, el(0xf7, [1]), el(0xf1, [0]))))
      return Uint8Array.from([
        ...ebmlHeader(),
        ...unsized(0x18538067, info(), tracks(track(1, VIDEO)), cues, unsized(0x1f43b675, timecode(0), block(1, 0, true))),
      ])
    }],
    ['is Matroska, not WebM', () => {
      const webm = recordingShaped()
      const mkv = ebmlHeader('matroska')
      return Uint8Array.from([...mkv, ...webm.subarray(ebmlHeader().length)])
    }],
    ['is not EBML at all', () => Uint8Array.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70])],
    ['has no video track', () =>
      Uint8Array.from([
        ...ebmlHeader(),
        ...unsized(0x18538067, info(), tracks(track(1, AUDIO)), unsized(0x1f43b675, timecode(0), block(1, 0, true))),
      ])],
    ['has no keyframe', () =>
      Uint8Array.from([
        ...ebmlHeader(),
        ...unsized(0x18538067, info(), tracks(track(1, VIDEO)), unsized(0x1f43b675, timecode(0), block(1, 0, false))),
      ])],
    ['ends inside a block (a cut-off recording)', () => recordingShaped(2).subarray(0, -2)],
    ['is empty', () => new Uint8Array()],
  ])('leaves a file alone that %s', (_label, make) => {
    expect(planWebmCues(make())).toBeNull()
  })

  it('needs nothing the second time', () => {
    expect(planWebmCues(applied(recordingShaped(3)))).toBeNull()
  })

  it('indexes the committed ffmpeg fixture the e2e spec plays', () => {
    const source = fixtureBytes()
    const out = applied(source)
    const { points } = inspect(out)
    expect(points).toHaveLength(1)
    expect(points[0].time).toBe(0)
    expect(read(out, points[0].cluster).id).toBe(0x1f43b675)
    expect(planWebmCues(out)).toBeNull()
  })
})

describe('webmBlobWithCues and withWebmCues (#584)', () => {
  const blobBytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer())

  it('gives the same bytes from memory and from a file', async () => {
    const source = recordingShaped(3)
    const fromBytes = await blobBytes(webmBlobWithCues(source, 'video/webm'))
    const file = new File([source as BlobPart], 'Screen recording 1.webm', { type: 'video/webm' })
    const fromFile = await withWebmCues(file)
    expect(fromFile).not.toBe(file)
    expect(fromFile.type).toBe('video/webm')
    expect(await blobBytes(fromFile)).toEqual(fromBytes)
    expect(fromBytes).toEqual(applied(source))
  })

  it('passes bytes that need nothing through unchanged', async () => {
    const mp4ish = Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70])
    expect(await blobBytes(webmBlobWithCues(mp4ish, 'video/mp4'))).toEqual(mp4ish)
  })

  it('returns the file itself when it is not a WebM, without reading it', async () => {
    const file = new File([recordingShaped(3) as BlobPart], 'clip.mp4', { type: 'video/mp4' })
    expect(await withWebmCues(file)).toBe(file)
  })

  it('returns the file itself when a WebM needs no index', async () => {
    const file = new File(['not ebml'], 'clip.webm', { type: 'video/webm' })
    expect(await withWebmCues(file)).toBe(file)
  })
})
