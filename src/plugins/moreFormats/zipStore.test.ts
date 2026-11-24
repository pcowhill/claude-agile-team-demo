import { describe, expect, it } from 'vitest'
import { dosDateTime, ZIP_MAX_BYTES, ZIP_MAX_ENTRIES, zipCrc32, zipStore, zipStoreLimitError, zipStoreSize } from './zipStore'

/**
 * The store-only ZIP writer (#865). The archive is read back by a reader
 * written here from APPNOTE.TXT, not from the writer: it starts at the end
 * of central directory record, walks the central directory, follows each
 * entry's offset to its local header, and checks that the two headers
 * agree. The CRCs are checked against the published check value, not only
 * against the writer's own function.
 */

const encoder = new TextEncoder()

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

interface ReadEntry {
  name: string
  method: number
  crc32: number
  data: Uint8Array
  time: number
  date: number
}

/** A test-only ZIP reader: the end record, the central directory, then each local header. */
function readZip(file: Uint8Array): ReadEntry[] {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
  const end = file.length - 22
  expect(view.getUint32(end, true), 'end of central directory signature').toBe(0x06054b50)
  const count = view.getUint16(end + 10, true)
  expect(view.getUint16(end + 8, true)).toBe(count)
  const centralSize = view.getUint32(end + 12, true)
  const centralOffset = view.getUint32(end + 16, true)
  expect(centralOffset + centralSize, 'the central directory ends at the end record').toBe(end)
  const latin1 = (from: number, length: number) =>
    String.fromCharCode(...file.subarray(from, from + length))
  const entries: ReadEntry[] = []
  let at = centralOffset
  for (let index = 0; index < count; index += 1) {
    expect(view.getUint32(at, true), 'central header signature').toBe(0x02014b50)
    const method = view.getUint16(at + 10, true)
    const time = view.getUint16(at + 12, true)
    const date = view.getUint16(at + 14, true)
    const crc32 = view.getUint32(at + 16, true)
    const compressed = view.getUint32(at + 20, true)
    const size = view.getUint32(at + 24, true)
    const nameLength = view.getUint16(at + 28, true)
    const extra = view.getUint16(at + 30, true)
    const comment = view.getUint16(at + 32, true)
    const local = view.getUint32(at + 42, true)
    const name = latin1(at + 46, nameLength)
    expect(compressed).toBe(size)

    expect(view.getUint32(local, true), 'local header signature').toBe(0x04034b50)
    expect(view.getUint16(local + 8, true)).toBe(method)
    expect(view.getUint32(local + 14, true)).toBe(crc32)
    expect(view.getUint32(local + 18, true)).toBe(size)
    expect(view.getUint32(local + 22, true)).toBe(size)
    const localName = view.getUint16(local + 26, true)
    const localExtra = view.getUint16(local + 28, true)
    expect(latin1(local + 30, localName)).toBe(name)
    const dataAt = local + 30 + localName + localExtra
    entries.push({ name, method, crc32, data: file.subarray(dataAt, dataAt + size), time, date })
    at += 46 + nameLength + extra + comment
  }
  expect(at).toBe(end)
  return entries
}

describe('store-only ZIP writer (#865)', () => {
  it('computes CRC-32 as ZIP stores it: the published check value', () => {
    // The CRC-32 check value for the nine ASCII digits, as catalogued for
    // CRC-32/ISO-HDLC (the ZIP and PNG CRC), and the empty input's.
    expect(zipCrc32(encoder.encode('123456789'))).toBe(0xcbf43926)
    expect(zipCrc32(new Uint8Array(0))).toBe(0)
    expect(zipCrc32(encoder.encode('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339)
  })

  it('writes files that an independent reader reads back with the same names, bytes and CRCs', async () => {
    const files = [
      { name: 'frame-00001.png', data: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]) },
      { name: 'frame-00002.png', data: encoder.encode('a second file, longer than the first') },
      { name: 'empty.txt', data: new Uint8Array(0) },
    ]
    const archive = zipStore(
      files.map(({ name, data }) => ({ name, data: new Blob([data]), crc32: zipCrc32(data) })),
      new Date(2026, 10, 24, 21, 30, 15),
    )
    expect(archive.type).toBe('application/zip')
    const bytes = await bytesOf(archive)
    expect(bytes.length).toBe(zipStoreSize(files.map(({ name, data }) => ({ name, size: data.length }))))
    const read = readZip(bytes)
    expect(read.map((entry) => entry.name)).toEqual(files.map((file) => file.name))
    for (const [index, entry] of read.entries()) {
      expect(entry.method, 'stored, not deflated').toBe(0)
      expect([...entry.data]).toEqual([...files[index].data])
      // The stored CRC is the one recomputed from the bytes read back.
      expect(entry.crc32).toBe(zipCrc32(entry.data))
      // 2026-11-24 21:30:14 in DOS form (two-second resolution).
      expect(entry.date).toBe(((2026 - 1980) << 9) | (11 << 5) | 24)
      expect(entry.time).toBe((21 << 11) | (30 << 5) | 7)
    }
  })

  it('writes an empty archive as the bare end record', async () => {
    const bytes = await bytesOf(zipStore([]))
    expect(bytes.length).toBe(22)
    expect(readZip(bytes)).toEqual([])
  })

  it('clamps a date before 1980 to the earliest DOS date', () => {
    expect(dosDateTime(new Date(1970, 0, 1))).toEqual({ time: 0, date: (1 << 5) | 1 })
  })

  it('refuses a name a ZIP reader could misread', () => {
    expect(() => zipStore([{ name: 'frame-é.png', data: new Blob([]), crc32: 0 }])).toThrow(/printable ASCII/)
  })

  it('names the limit an archive without ZIP64 would exceed', () => {
    const frame = { name: 'frame-00001.png', size: 1000 }
    expect(zipStoreLimitError([frame])).toBeNull()
    expect(zipStoreLimitError(Array.from({ length: ZIP_MAX_ENTRIES }, () => frame))).toBeNull()
    expect(zipStoreLimitError(Array.from({ length: ZIP_MAX_ENTRIES + 1 }, () => frame))).toMatch(
      /at most 65,535 files, and this export has 65,536 frames/,
    )
    // Headers count toward the 4 GiB too: a file that alone fits does not
    // fit once its two headers and the end record are added.
    expect(zipStoreLimitError([{ name: 'big.png', size: ZIP_MAX_BYTES - 200 }])).toBeNull()
    expect(zipStoreLimitError([{ name: 'big.png', size: ZIP_MAX_BYTES - 100 }])).toMatch(/at most 4 GB/)
  })
})
