import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPngSequenceFrameSink, lastTickBefore, pngSequenceFrameName } from './pngSequenceSink'
import { zipCrc32 } from './zipStore'

/**
 * The PNG image sequence sink (#865). jsdom has no canvas encoder, so each
 * canvas the sink creates is a stand-in whose `toBlob` yields a "PNG" whose
 * bytes are the pipeline frame it copied. That makes every file in the
 * archive name the composed frame it came from, which is what the tick
 * rule is about. The e2e spec proves real PNGs in a real browser.
 */

interface FakeCanvas {
  width: number
  height: number
  label: string
  getContext: () => { drawImage: (source: FakeCanvas) => void }
  toBlob: (callback: (blob: Blob | null) => void, type?: string) => void
}

function fakeCanvas(): FakeCanvas {
  const canvas: FakeCanvas = {
    width: 0,
    height: 0,
    label: '',
    getContext: () => ({
      drawImage: (source) => {
        canvas.label = source.label
      },
    }),
    toBlob: (callback, type) => {
      queueMicrotask(() =>
        callback(encoderRefuses ? null : new Blob([canvas.label], { type: type ?? 'image/png' })),
      )
    },
  }
  return canvas
}

const created: FakeCanvas[] = []
/** When set, every stand-in's `toBlob` yields null, as a browser that cannot encode does. */
let encoderRefuses = false

function useFakeCanvases() {
  const real = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag !== 'canvas') return real(tag)
    const canvas = fakeCanvas()
    created.push(canvas)
    return canvas
  }) as typeof document.createElement)
}

afterEach(() => {
  vi.restoreAllMocks()
  created.length = 0
  encoderRefuses = false
})

/** The pipeline's reused canvas, showing frame `label`. */
function pipeline(label: string, width = 64, height = 36): HTMLCanvasElement {
  return { ...fakeCanvas(), width, height, label } as unknown as HTMLCanvasElement
}

/** The archive's files, in order, as [name, bytes as text, stored CRC]. */
async function unzip(blob: Blob): Promise<[string, string, number][]> {
  const file = new Uint8Array(await blob.arrayBuffer())
  const view = new DataView(file.buffer)
  const files: [string, string, number][] = []
  let at = 0
  while (view.getUint32(at, true) === 0x04034b50) {
    const crc = view.getUint32(at + 14, true)
    const size = view.getUint32(at + 18, true)
    const nameLength = view.getUint16(at + 26, true)
    const name = new TextDecoder().decode(file.subarray(at + 30, at + 30 + nameLength))
    const data = file.subarray(at + 30 + nameLength, at + 30 + nameLength + size)
    files.push([name, new TextDecoder().decode(data), crc])
    expect(crc).toBe(zipCrc32(data))
    at += 30 + nameLength + size
  }
  return files
}

describe('PNG image sequence sink (#865)', () => {
  it('names frames in order with five digits', () => {
    expect(pngSequenceFrameName(1)).toBe('frame-00001.png')
    expect(pngSequenceFrameName(900)).toBe('frame-00900.png')
    expect(pngSequenceFrameName(65535)).toBe('frame-65535.png')
  })

  it('writes one PNG per tick of the frame rate, keeping the first frame on or after each', async () => {
    useFakeCanvases()
    const sink = createPngSequenceFrameSink({ frameRate: 10 })
    // A 60 Hz pipeline over 0.3 s at 10 fps: ticks 0, 1, 2.
    for (let index = 0; index < 18; index += 1) sink.frame(pipeline(`f${index}`), index / 60)
    const files = await unzip(await sink.finish())
    expect(files.map(([name, data]) => [name, data])).toEqual([
      ['frame-00001.png', 'f0'],
      ['frame-00002.png', 'f6'],
      ['frame-00003.png', 'f12'],
    ])
    // Only the kept frames were copied and encoded.
    expect(created).toHaveLength(3)
  })

  it('copies at the pipeline canvas size, which is the export Frame size', () => {
    useFakeCanvases()
    const sink = createPngSequenceFrameSink({ frameRate: 30 })
    sink.frame(pipeline('f0', 1920, 1080), 0)
    // Not scaled: the copy is the pipeline canvas's own size.
    expect(created[0]).toMatchObject({ label: 'f0', width: 1920, height: 1080 })
  })

  it('releases each copy once its PNG exists', async () => {
    useFakeCanvases()
    const sink = createPngSequenceFrameSink({ frameRate: 30 })
    sink.frame(pipeline('f0', 1920, 1080), 0)
    await sink.finish()
    expect(created[0]).toMatchObject({ width: 0, height: 0 })
  })

  it('repeats the previous frame for ticks the pipeline skipped, so the count is rate × duration', async () => {
    useFakeCanvases()
    const sink = createPngSequenceFrameSink({ frameRate: 60 })
    // A 60 fps export from a pipeline that composed at about 24 Hz: frames
    // land on ticks 0, 2, 5 and 7, so ticks 1, 3, 4 and 6 hold.
    for (const [label, time] of [
      ['a', 0],
      ['b', 2 / 60 + 0.001],
      ['c', 5 / 60 + 0.001],
      ['d', 7 / 60 + 0.001],
    ] as const) {
      sink.frame(pipeline(label), time)
    }
    const files = await unzip(await sink.finish())
    expect(files.map(([, data]) => data)).toEqual(['a', 'a', 'b', 'b', 'b', 'c', 'c', 'd'])
    expect(files.map(([name]) => name)).toEqual(
      Array.from({ length: 8 }, (_, index) => pngSequenceFrameName(index + 1)),
    )
    // A repeat stores the same PNG again; it encodes nothing new.
    expect(created).toHaveLength(4)
  })

  it('holds the last frame for the ticks left before the window ends (#904 review)', async () => {
    useFakeCanvases()
    // A 2 s export at 120 fps from a 60 Hz pipeline whose last frame lands
    // one refresh early, at 118/60 s: tick 236. Ticks 237 to 239 are still
    // before the end, so they hold it, and the archive has 2 × 120 files.
    const sink = createPngSequenceFrameSink({ frameRate: 120, end: 2 })
    for (let index = 0; index <= 118; index += 1) sink.frame(pipeline(`f${index}`), index / 60)
    const files = await unzip(await sink.finish())
    expect(files).toHaveLength(240)
    expect(files.at(-1)?.[0]).toBe('frame-00240.png')
    expect(files.slice(-4).map(([, data]) => data)).toEqual(['f118', 'f118', 'f118', 'f118'])
    // Holding encodes nothing new.
    expect(created).toHaveLength(119)
  })

  it('ends a range on the last tick before its end, not on the tick at it', async () => {
    useFakeCanvases()
    // A range from 4.0 s to 4.5 s at 10 fps is ticks 40 to 44: five files.
    const sink = createPngSequenceFrameSink({ frameRate: 10, end: 4.5 })
    sink.frame(pipeline('x'), 4.0)
    sink.frame(pipeline('y'), 4.1)
    const files = await unzip(await sink.finish())
    expect(files.map(([, data]) => data)).toEqual(['x', 'y', 'y', 'y', 'y'])
    expect(lastTickBefore(4.5, 10)).toBe(44)
    // A time on a tick by floating point still ends just before it.
    expect(lastTickBefore(0.7, 20)).toBe(13)
    expect(lastTickBefore(2, 120)).toBe(239)
  })

  it('gives no file to a frame the pipeline composes at or past the window end', async () => {
    useFakeCanvases()
    // A range ending at 1.5 s at 30 fps is ticks up to 44. The pipeline
    // composed one more frame, at 1.517 s (tick 45), as measured.
    const sink = createPngSequenceFrameSink({ frameRate: 30, end: 1.5 })
    sink.frame(pipeline('in'), 1.4999)
    sink.frame(pipeline('past'), 1.5167)
    const files = await unzip(await sink.finish())
    expect(files.map(([, data]) => data)).toEqual(['in'])
    // The frame past the end was not even copied.
    expect(created).toHaveLength(1)
  })

  it('refuses an export whose held tail would pass the ZIP file count', async () => {
    useFakeCanvases()
    const sink = createPngSequenceFrameSink({ frameRate: 1, end: 65536 })
    sink.frame(pipeline('first'), 0)
    // Ticks 0 to 65,535 are 65,536 files.
    await expect(sink.finish()).rejects.toThrow(/at most 65,535 files/)
  })

  it('numbers a range export from frame 1, wherever in the sequence the range starts', async () => {
    useFakeCanvases()
    const sink = createPngSequenceFrameSink({ frameRate: 10 })
    sink.frame(pipeline('x'), 4.0)
    sink.frame(pipeline('y'), 4.1)
    const files = await unzip(await sink.finish())
    expect(files.map(([name, data]) => [name, data])).toEqual([
      ['frame-00001.png', 'x'],
      ['frame-00002.png', 'y'],
    ])
  })

  it('refuses an export that produced no frames', async () => {
    await expect(createPngSequenceFrameSink().finish()).rejects.toThrow('no frames')
  })

  it('refuses an export past the ZIP file count rather than writing a corrupt archive', async () => {
    useFakeCanvases()
    const sink = createPngSequenceFrameSink({ frameRate: 1 })
    sink.frame(pipeline('first'), 0)
    // One frame 65,535 ticks later would make 65,536 files.
    sink.frame(pipeline('late'), 65535)
    await expect(sink.finish()).rejects.toThrow(/at most 65,535 files/)
    // The frame past the limit was never encoded.
    expect(created).toHaveLength(1)
  })

  it('reports a browser that does not encode PNG', async () => {
    useFakeCanvases()
    encoderRefuses = true
    const sink = createPngSequenceFrameSink({ frameRate: 10 })
    sink.frame(pipeline('f0'), 0)
    await expect(sink.finish()).rejects.toThrow('did not encode the frame as PNG')
  })
})
