import { pngCrc32 } from './apngMux'

/**
 * A store-only ZIP writer (#865): the files go in uncompressed, method 0.
 * It is for the PNG image sequence, whose frames are already compressed,
 * so deflating them again would cost time and save almost nothing.
 *
 * The layout is PKWARE's APPNOTE.TXT (section 4.3):
 * - for each file, a local file header (4.3.7) followed by its bytes;
 * - the central directory, one header per file (4.3.12);
 * - the end of central directory record (4.3.16).
 *
 * No ZIP64 and no data descriptors. Every size and CRC is known before a
 * header is written, because a frame is encoded before it is added.
 * Without ZIP64 an archive holds at most 65,535 files and 4 GiB in all.
 * `zipStoreLimitError` names the limit an archive would exceed, so the
 * caller can refuse it with a message rather than write a corrupt file.
 *
 * The bytes are not copied. Each file is passed in as a Blob and placed in
 * the output Blob between its headers, so a browser that pages large Blobs
 * to disk can keep doing so for the archive.
 */

/** One file to store: its name in the archive, its bytes, and their CRC-32. */
export interface ZipStoreEntry {
  /** ASCII path inside the archive, `/`-separated. */
  name: string
  data: Blob
  /** CRC-32 of `data` (`zipCrc32`), computed when the bytes were in hand. */
  crc32: number
}

/** The most files an archive without ZIP64 can hold (a 16-bit count). */
export const ZIP_MAX_ENTRIES = 0xffff

/** The most bytes an archive without ZIP64 can hold (32-bit offsets and sizes). */
export const ZIP_MAX_BYTES = 0xffffffff

/**
 * CRC-32 as ZIP stores it (APPNOTE 4.4.7). It is the same polynomial
 * (0xEDB88320, reflected) and the same pre- and post-inversion that PNG
 * uses for its chunks, so it is `apngMux.ts`'s function.
 */
export const zipCrc32 = pngCrc32

const LOCAL_HEADER = 30
const CENTRAL_HEADER = 46
const END_RECORD = 22

/**
 * The time and date fields of a ZIP header, in MS-DOS format: local time,
 * two-second resolution, years from 1980. A date before 1980 is written as
 * 1980-01-01 00:00, the earliest a DOS date can say.
 */
export function dosDateTime(date: Date): { time: number; date: number } {
  if (date.getFullYear() < 1980) return { time: 0, date: (1 << 5) | 1 }
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

/** The archive's total size for files of these name lengths and sizes. */
export function zipStoreSize(entries: readonly { name: string; size: number }[]): number {
  return entries.reduce(
    (sum, { name, size }) => sum + LOCAL_HEADER + CENTRAL_HEADER + 2 * name.length + size,
    END_RECORD,
  )
}

/**
 * Why an archive of these files cannot be written without ZIP64, or null
 * when it can. The message says what to change.
 */
export function zipStoreLimitError(entries: readonly { name: string; size: number }[]): string | null {
  if (entries.length > ZIP_MAX_ENTRIES) {
    return `A ZIP holds at most ${ZIP_MAX_ENTRIES.toLocaleString('en-US')} files, and this export has ${entries.length.toLocaleString('en-US')} frames. Export a shorter range or a lower frame rate.`
  }
  if (zipStoreSize(entries) > ZIP_MAX_BYTES) {
    return 'A ZIP holds at most 4 GB, and these frames are larger. Export a shorter range, a lower frame rate or a smaller frame size.'
  }
  return null
}

function asciiName(name: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(name.length)
  for (let index = 0; index < name.length; index += 1) {
    const code = name.charCodeAt(index)
    if (code > 0x7e || code < 0x20) throw new Error(`A ZIP entry name must be printable ASCII: ${name}`)
    bytes[index] = code
  }
  return bytes
}

/**
 * Builds a store-only archive of `entries`, in order. `modified` is the
 * time written into every header (default: now). Throws with
 * `zipStoreLimitError`'s message when the archive would need ZIP64.
 */
export function zipStore(entries: readonly ZipStoreEntry[], modified: Date = new Date()): Blob {
  const sized = entries.map((entry) => ({ name: entry.name, size: entry.data.size }))
  const limit = zipStoreLimitError(sized)
  if (limit !== null) throw new Error(limit)
  const { time, date } = dosDateTime(modified)
  const parts: BlobPart[] = []
  const central: Uint8Array<ArrayBuffer>[] = []
  let offset = 0
  for (const entry of entries) {
    const name = asciiName(entry.name)
    const size = entry.data.size

    const local = new Uint8Array(LOCAL_HEADER + name.length)
    const l = new DataView(local.buffer)
    l.setUint32(0, 0x04034b50, true) // local file header signature
    l.setUint16(4, 10, true) // version needed to extract: 1.0, stored
    l.setUint16(6, 0, true) // general purpose flags: none
    l.setUint16(8, 0, true) // compression method: stored
    l.setUint16(10, time, true)
    l.setUint16(12, date, true)
    l.setUint32(14, entry.crc32 >>> 0, true)
    l.setUint32(18, size, true) // compressed size
    l.setUint32(22, size, true) // uncompressed size
    l.setUint16(26, name.length, true)
    l.setUint16(28, 0, true) // extra field length
    local.set(name, LOCAL_HEADER)
    parts.push(local, entry.data)

    const header = new Uint8Array(CENTRAL_HEADER + name.length)
    const c = new DataView(header.buffer)
    c.setUint32(0, 0x02014b50, true) // central directory header signature
    c.setUint16(4, 20, true) // version made by: 2.0, MS-DOS attribute layout
    c.setUint16(6, 10, true) // version needed to extract
    c.setUint16(8, 0, true)
    c.setUint16(10, 0, true)
    c.setUint16(12, time, true)
    c.setUint16(14, date, true)
    c.setUint32(16, entry.crc32 >>> 0, true)
    c.setUint32(20, size, true)
    c.setUint32(24, size, true)
    c.setUint16(28, name.length, true)
    c.setUint16(30, 0, true) // extra field length
    c.setUint16(32, 0, true) // file comment length
    c.setUint16(34, 0, true) // disk number start
    c.setUint16(36, 0, true) // internal attributes
    c.setUint32(38, 0, true) // external attributes
    c.setUint32(42, offset, true) // offset of the local header
    header.set(name, CENTRAL_HEADER)
    central.push(header)

    offset += local.length + size
  }
  const centralSize = central.reduce((sum, header) => sum + header.length, 0)
  const end = new Uint8Array(END_RECORD)
  const e = new DataView(end.buffer)
  e.setUint32(0, 0x06054b50, true) // end of central directory signature
  e.setUint16(4, 0, true) // this disk
  e.setUint16(6, 0, true) // disk with the central directory
  e.setUint16(8, entries.length, true) // entries on this disk
  e.setUint16(10, entries.length, true) // entries in all
  e.setUint32(12, centralSize, true)
  e.setUint32(16, offset, true) // offset of the central directory
  e.setUint16(20, 0, true) // comment length
  return new Blob([...parts, ...central, end], { type: 'application/zip' })
}
