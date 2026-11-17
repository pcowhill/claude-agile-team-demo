/**
 * Gives a WebM that has no seek index (Cues) one, so Firefox can seek it
 * (#584).
 *
 * Firefox seeks a cue-less WebM by jumping to the cluster that holds the
 * target time. A MediaRecorder recording can have one keyframe, at 0, and a
 * new cluster every second or so (the customer's Firefox 160 on Windows wrote
 * exactly that). In that file, every cluster after the first holds no
 * keyframe, and a seek into one finds nothing to decode from: the element
 * fires `ended` and stands at the duration. Play from anywhere past the first
 * cluster "jumps straight to the end". Measured on the customer's file and on
 * a synthetic one (#584): adding a SeekHead and one CuePoint per video
 * keyframe, and nothing else, makes Firefox play forward from every position,
 * and Chromium is unchanged.
 *
 * What this deliberately does **not** touch:
 * - The Info `Duration`. Writing a known duration made Chromium land every
 *   seek at 0 on the same single-keyframe file (#584's table).
 * - The clusters. They are carried over byte for byte, so the frames cannot
 *   change; only the bytes before the first cluster and the Cues appended at
 *   the end of the segment are new.
 *
 * Anything this does not fully understand returns `null`, and the caller
 * plays the file exactly as it came: a non-WebM, a WebM that already has
 * Cues, a truncated element, an unknown-size element other than a Cluster,
 * no video track, no keyframe.
 */

const ID = {
  EBML: 0x1a45dfa3,
  DocType: 0x4282,
  Segment: 0x18538067,
  SeekHead: 0x114d9b74,
  Seek: 0x4dbb,
  SeekID: 0x53ab,
  SeekPosition: 0x53ac,
  Info: 0x1549a966,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackType: 0x83,
  Cluster: 0x1f43b675,
  Timecode: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
  ReferenceBlock: 0xfb,
  Cues: 0x1c53bb6b,
  CuePoint: 0xbb,
  CueTime: 0xb3,
  CueTrackPositions: 0xb7,
  CueTrack: 0xf7,
  CueClusterPosition: 0xf1,
  Void: 0xec,
  Chapters: 0x1043a770,
  Tags: 0x1254c367,
  Attachments: 0x1941a469,
} as const

/** Segment children: an unknown-size Cluster ends where one of these starts. */
const LEVEL1 = new Set<number>([
  ID.SeekHead,
  ID.Info,
  ID.Tracks,
  ID.Cluster,
  ID.Cues,
  ID.Chapters,
  ID.Tags,
  ID.Attachments,
])

const VIDEO_TRACK_TYPE = 1

/** The bytes of an 8-byte "unknown size" field. */
const UNKNOWN_SIZE_8 = Uint8Array.of(0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff)

interface Header {
  id: number
  /** Offset of the element's data. */
  data: number
  /** Data length; null for an unknown size. */
  size: number | null
}

/** Reads an element header at `pos`, or null if it is malformed or cut off. */
function readHeader(bytes: Uint8Array, pos: number): Header | null {
  if (pos >= bytes.length) return null
  const first = bytes[pos]
  let idLength = 1
  while (idLength <= 4 && (first & (0x80 >> (idLength - 1))) === 0) idLength++
  if (idLength > 4 || pos + idLength > bytes.length) return null
  let id = 0
  for (let k = 0; k < idLength; k++) id = id * 256 + bytes[pos + k]

  const sizePos = pos + idLength
  if (sizePos >= bytes.length) return null
  const lead = bytes[sizePos]
  let sizeLength = 1
  while (sizeLength <= 8 && (lead & (0x80 >> (sizeLength - 1))) === 0) sizeLength++
  if (sizeLength > 8 || sizePos + sizeLength > bytes.length) return null
  let size = lead & (0xff >> sizeLength)
  let allOnes = size === 0xff >> sizeLength
  for (let k = 1; k < sizeLength; k++) {
    const byte = bytes[sizePos + k]
    if (byte !== 0xff) allOnes = false
    size = size * 256 + byte
  }
  return { id, data: sizePos + sizeLength, size: allOnes ? null : size }
}

function readUint(bytes: Uint8Array, start: number, length: number): number {
  let value = 0
  for (let k = 0; k < length; k++) value = value * 256 + bytes[start + k]
  return value
}

/** EBML variable-length integer `value`, in the fewest bytes, or `width` bytes. */
function vint(value: number, width?: number): Uint8Array {
  let length = width ?? 1
  if (width === undefined) while (value >= 2 ** (7 * length) - 1) length++
  const out = new Uint8Array(length)
  let rest = value
  for (let k = length - 1; k >= 0; k--) {
    out[k] = rest % 256
    rest = Math.floor(rest / 256)
  }
  out[0] |= 0x80 >> (length - 1)
  return out
}

function idBytes(id: number): Uint8Array {
  const out: number[] = []
  for (let rest = id; rest > 0; rest = Math.floor(rest / 256)) out.unshift(rest % 256)
  return Uint8Array.from(out)
}

function uintBytes(value: number, width?: number): Uint8Array {
  const out: number[] = []
  for (let rest = value; rest > 0; rest = Math.floor(rest / 256)) out.unshift(rest % 256)
  if (out.length === 0) out.push(0)
  while (width !== undefined && out.length < width) out.unshift(0)
  return Uint8Array.from(out)
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

function element(id: number, ...payload: Uint8Array[]): Uint8Array {
  const body = concat(payload)
  return concat([idBytes(id), vint(body.length), body])
}

/** The children of a known-size master element, or null if any is malformed. */
function children(bytes: Uint8Array, start: number, end: number): Header[] | null {
  const out: Header[] = []
  for (let pos = start; pos < end; ) {
    const header = readHeader(bytes, pos)
    if (header === null || header.size === null || header.data + header.size > end) return null
    out.push(header)
    pos = header.data + header.size
  }
  return out
}

function docTypeIsWebm(bytes: Uint8Array, header: Header): boolean {
  if (header.size === null) return false
  const fields = children(bytes, header.data, header.data + header.size)
  const docType = fields?.find((field) => field.id === ID.DocType)
  if (docType === undefined || docType.size === null) return false
  const text = String.fromCharCode(...bytes.subarray(docType.data, docType.data + docType.size))
  return text.replace(/\0+$/, '') === 'webm'
}

function videoTrackNumbers(bytes: Uint8Array, tracks: Header): Set<number> | null {
  if (tracks.size === null) return null
  const entries = children(bytes, tracks.data, tracks.data + tracks.size)
  if (entries === null) return null
  const numbers = new Set<number>()
  for (const entry of entries) {
    if (entry.id !== ID.TrackEntry || entry.size === null) continue
    const fields = children(bytes, entry.data, entry.data + entry.size)
    if (fields === null) return null
    const field = (id: number) => fields.find((f) => f.id === id)
    const number = field(ID.TrackNumber)
    const type = field(ID.TrackType)
    if (number?.size == null || type?.size == null) continue
    if (readUint(bytes, type.data, type.size) === VIDEO_TRACK_TYPE) {
      numbers.add(readUint(bytes, number.data, number.size))
    }
  }
  return numbers
}

/**
 * A block's track number and its timecode relative to its cluster. The block
 * header is a track-number vint, then a signed 16-bit timecode, then flags.
 */
function blockHeader(
  bytes: Uint8Array,
  data: number,
  size: number,
): { track: number; relative: number; flags: number } | null {
  const lead = bytes[data]
  let length = 1
  while (length <= 8 && (lead & (0x80 >> (length - 1))) === 0) length++
  if (length > 8 || length + 3 > size) return null
  const track = readUint(bytes, data, length) - (0x80 >> (length - 1)) * 2 ** (8 * (length - 1))
  const raw = bytes[data + length] * 256 + bytes[data + length + 1]
  const relative = raw >= 0x8000 ? raw - 0x10000 : raw
  return { track, relative, flags: bytes[data + length + 2] }
}

interface Level1 {
  id: number
  /** Offset of the element's first byte. */
  start: number
  /** Offset one past its last byte. */
  end: number
}

interface CueEntry {
  time: number
  track: number
  /** Offset of the cluster's first byte in the source file. */
  clusterStart: number
}

/**
 * How to rebuild `bytes` with Cues: the new bytes before the first cluster
 * (`head`), the source range carried over unchanged (`bodyStart`..`bodyEnd`,
 * the clusters and anything after them in the segment), the new Cues
 * (`tail`), and then the source's bytes from `bodyEnd` on. Null when the file
 * should be played as it is (see the module comment).
 */
export interface WebmCuesPlan {
  head: Uint8Array
  bodyStart: number
  bodyEnd: number
  tail: Uint8Array
}

export function planWebmCues(bytes: Uint8Array): WebmCuesPlan | null {
  const ebml = readHeader(bytes, 0)
  if (ebml === null || ebml.id !== ID.EBML || !docTypeIsWebm(bytes, ebml)) return null
  if (ebml.size === null) return null

  const segmentStart = ebml.data + ebml.size
  const segment = readHeader(bytes, segmentStart)
  if (segment === null || segment.id !== ID.Segment) return null
  const segmentEnd = segment.size === null ? bytes.length : segment.data + segment.size
  if (segmentEnd > bytes.length) return null

  const level1: Level1[] = []
  const cues: CueEntry[] = []
  let videoTracks: Set<number> | null = null

  for (let pos = segment.data; pos < segmentEnd; ) {
    const header = readHeader(bytes, pos)
    if (header === null) return null
    if (header.id === ID.Cues) return null // already seekable
    let end: number
    if (header.id === ID.Cluster) {
      const scanned = scanCluster(bytes, header, segmentEnd, pos, videoTracks, cues)
      if (scanned === null) return null
      end = scanned
    } else {
      if (header.size === null) return null
      end = header.data + header.size
      if (end > segmentEnd) return null
      if (header.id === ID.Tracks) videoTracks = videoTrackNumbers(bytes, header)
    }
    level1.push({ id: header.id, start: pos, end })
    pos = end
  }

  if (videoTracks === null || videoTracks.size === 0 || cues.length === 0) return null
  const firstCluster = level1.findIndex((el) => el.id === ID.Cluster)
  if (firstCluster < 0) return null

  // Before the first cluster: everything but the old SeekHead and padding.
  const kept = level1
    .slice(0, firstCluster)
    .filter((el) => el.id !== ID.SeekHead && el.id !== ID.Void)
  const keptBytes = concat(kept.map((el) => bytes.subarray(el.start, el.end)))
  const bodyStart = level1[firstCluster].start
  const after = level1.slice(firstCluster).filter((el) => el.id !== ID.Cluster && el.id !== ID.Void)

  // Every SeekPosition is written as 8 bytes, so the SeekHead's length is
  // known before any position is: no fixed point to solve.
  const seekEntry = (id: number, position: number) =>
    element(ID.Seek, element(ID.SeekID, idBytes(id)), element(ID.SeekPosition, uintBytes(position, 8)))
  const entryCount = kept.length + after.length + 1
  const seekHeadLength = element(
    ID.SeekHead,
    ...Array.from({ length: entryCount }, () => seekEntry(ID.Cues, 0)),
  ).length

  // Positions are relative to the segment's data, in the new layout.
  const bodyAt = seekHeadLength + keptBytes.length
  const moved = (sourceOffset: number) => bodyAt + (sourceOffset - bodyStart)
  const entries: Uint8Array[] = []
  let at = seekHeadLength
  for (const el of kept) {
    entries.push(seekEntry(el.id, at))
    at += el.end - el.start
  }
  for (const el of after) entries.push(seekEntry(el.id, moved(el.start)))
  const cuesAt = moved(segmentEnd)
  entries.push(seekEntry(ID.Cues, cuesAt))
  const seekHead = element(ID.SeekHead, ...entries)

  const tail = element(
    ID.Cues,
    ...cues.map((cue) =>
      element(
        ID.CuePoint,
        element(ID.CueTime, uintBytes(cue.time)),
        element(
          ID.CueTrackPositions,
          element(ID.CueTrack, uintBytes(cue.track)),
          element(ID.CueClusterPosition, uintBytes(moved(cue.clusterStart))),
        ),
      ),
    ),
  )

  const segmentPayload = cuesAt + tail.length
  const head = concat([
    bytes.subarray(0, segmentStart),
    idBytes(ID.Segment),
    segment.size === null ? UNKNOWN_SIZE_8 : vint(segmentPayload, 8),
    seekHead,
    keptBytes,
  ])
  return { head, bodyStart, bodyEnd: segmentEnd, tail }
}

/**
 * Walks one cluster, appending a cue for each video keyframe in it. Returns
 * the offset one past the cluster, or null if it cannot be read.
 */
function scanCluster(
  bytes: Uint8Array,
  cluster: Header,
  segmentEnd: number,
  clusterStart: number,
  videoTracks: Set<number> | null,
  cues: CueEntry[],
): number | null {
  const limit = cluster.size === null ? segmentEnd : cluster.data + cluster.size
  if (limit > segmentEnd) return null
  let timecode: number | null = null
  let pos = cluster.data
  while (pos < limit) {
    const header = readHeader(bytes, pos)
    if (header === null) return null
    // An unknown-size cluster ends where the next segment child begins.
    if (cluster.size === null && LEVEL1.has(header.id)) break
    if (header.size === null) return null
    const end = header.data + header.size
    if (end > limit) return null
    if (header.id === ID.Timecode) timecode = readUint(bytes, header.data, header.size)
    let block: { data: number; size: number; keyframe: (flags: number) => boolean } | null = null
    if (header.id === ID.SimpleBlock) {
      block = { data: header.data, size: header.size, keyframe: (flags) => (flags & 0x80) !== 0 }
    } else if (header.id === ID.BlockGroup) {
      const fields = children(bytes, header.data, end)
      if (fields === null) return null
      const inner = fields.find((f) => f.id === ID.Block)
      const referenced = fields.some((f) => f.id === ID.ReferenceBlock)
      if (inner !== undefined && inner.size !== null) {
        block = { data: inner.data, size: inner.size, keyframe: () => !referenced }
      }
    }
    if (block !== null && videoTracks !== null) {
      const parsed = blockHeader(bytes, block.data, block.size)
      if (parsed === null) return null
      if (videoTracks.has(parsed.track) && block.keyframe(parsed.flags)) {
        if (timecode === null) return null
        cues.push({ time: Math.max(0, timecode + parsed.relative), track: parsed.track, clusterStart })
      }
    }
    pos = end
  }
  return pos
}

/** `bytes` with Cues added, as a Blob of `type`; the bytes unchanged when no plan applies. */
export function webmBlobWithCues(bytes: Uint8Array, type: string): Blob {
  const plan = planWebmCues(bytes)
  if (plan === null) return new Blob([bytes as BlobPart], { type })
  return new Blob(
    [
      plan.head as BlobPart,
      bytes.subarray(plan.bodyStart, plan.bodyEnd) as BlobPart,
      plan.tail as BlobPart,
      bytes.subarray(plan.bodyEnd) as BlobPart,
    ],
    { type },
  )
}

/**
 * `file`, or a Blob of it with Cues added (#584). Only a file named or typed
 * as WebM, and starting with the EBML magic, is read in full, so other media
 * costs one 4-byte read at most.
 */
export async function withWebmCues(file: File): Promise<Blob> {
  const looksWebm = /webm/i.test(file.type) || /\.webm$/i.test(file.name)
  if (!looksWebm || typeof file.arrayBuffer !== 'function') return file
  const magic = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  if (readUint(magic, 0, magic.length) !== ID.EBML) return file
  const bytes = new Uint8Array(await file.arrayBuffer())
  const plan = planWebmCues(bytes)
  if (plan === null) return file
  // The clusters come from the file itself, not from the copy just read.
  return new Blob(
    [
      plan.head as BlobPart,
      file.slice(plan.bodyStart, plan.bodyEnd),
      plan.tail as BlobPart,
      file.slice(plan.bodyEnd),
    ],
    { type: file.type },
  )
}
