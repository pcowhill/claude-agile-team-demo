import { describe, expect, it, vi } from 'vitest'
import { frameFileName, snapshotTimelineFrame } from './frameSnapshot'
import { ExportUnsupportedError } from './exportVideo'
import type { TimelineEntry, TimelineState } from './timeline'

// The snapshot (#237) composes through the export's factored frame composer
// (createFrameComposer — its draw behavior is pinned by exportVideo.test.ts
// and the export e2e specs). These tests cover the snapshot's own job: the
// refusal rules, and cueing the right sources to the right source times
// before drawing — with fake elements, since jsdom decodes nothing.

const entry = (overrides: Partial<TimelineEntry> & { id: string }): TimelineEntry => ({
  clipId: `clip-${overrides.id}`,
  name: `${overrides.id}.webm`,
  duration: 10,
  url: `blob:${overrides.id}`,
  inPoint: 0,
  outPoint: 10,
  ...overrides,
})

/** A <video> stand-in: src load and seeks settle on a microtask. */
class FakeVideo {
  listeners = new Map<string, Set<() => void>>()
  readyState = 0
  videoWidth = 320
  videoHeight = 180
  muted = false
  playsInline = false
  preload = ''
  loaded = false
  private urlValue = ''
  private timeValue = 0
  /** Every currentTime assignment, for asserting the cue target. */
  seeks: number[] = []
  /** Every src assignment — release clears `src`, so assert against these. */
  urls: string[] = []

  addEventListener(name: string, listener: () => void) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set())
    this.listeners.get(name)!.add(listener)
  }
  removeEventListener(name: string, listener: () => void) {
    this.listeners.get(name)?.delete(listener)
  }
  private dispatch(name: string) {
    for (const listener of [...(this.listeners.get(name) ?? [])]) listener()
  }
  get src() {
    return this.urlValue
  }
  set src(url: string) {
    this.urlValue = url
    this.urls.push(url)
    queueMicrotask(() => {
      this.readyState = 2
      this.dispatch('loadedmetadata')
    })
  }
  get currentTime() {
    return this.timeValue
  }
  set currentTime(time: number) {
    this.timeValue = time
    this.seeks.push(time)
    queueMicrotask(() => this.dispatch('seeked'))
  }
  removeAttribute() {
    this.urlValue = ''
  }
  load() {
    this.loaded = true
  }
}

/** A 2D context stand-in recording draws; `filter` behaves like a browser's. */
/** An <img> stand-in: the load event settles on a microtask, like FakeVideo. */
class FakeImage {
  listeners = new Map<string, Set<() => void>>()
  naturalWidth = 160
  naturalHeight = 90
  urls: string[] = []
  private urlValue = ''

  addEventListener(name: string, listener: () => void) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set())
    this.listeners.get(name)!.add(listener)
  }
  removeEventListener(name: string, listener: () => void) {
    this.listeners.get(name)?.delete(listener)
  }
  get src() {
    return this.urlValue
  }
  set src(url: string) {
    this.urlValue = url
    this.urls.push(url)
    queueMicrotask(() => {
      for (const listener of [...(this.listeners.get('load') ?? [])]) listener()
    })
  }
}

function fakeContext(filterSupported: boolean) {
  const draws: { source: unknown; args: number[] }[] = []
  const fills: { style: string; args: number[] }[] = []
  let filterValue = 'none'
  let fillStyleValue = ''
  const context = {
    get fillStyle() {
      return fillStyleValue
    },
    set fillStyle(value: string) {
      fillStyleValue = value
    },
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    textAlign: '',
    textBaseline: '',
    font: '',
    get filter() {
      return filterValue
    },
    set filter(value: string) {
      filterValue = filterSupported || value === 'none' ? value : 'none'
    },
    fillRect: (...args: number[]) => {
      fills.push({ style: fillStyleValue, args })
    },
    fillText: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    beginPath: () => {},
    rect: () => {},
    ellipse: () => {},
    clip: () => {},
    drawImage: (source: unknown, ...args: number[]) => {
      draws.push({ source, args })
    },
  }
  return { context: context as unknown as CanvasRenderingContext2D, draws, fills }
}

function fakeCanvas(filterSupported = true) {
  const { context, draws, fills } = fakeContext(filterSupported)
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    toBlob: (callback: (blob: Blob | null) => void, type: string) => {
      callback(new Blob(['png-bytes'], { type }))
    },
  }
  return { canvas: canvas as unknown as HTMLCanvasElement, draws, fills }
}

function snapshotOptions(filterSupported = true) {
  const videos: FakeVideo[] = []
  const images: FakeImage[] = []
  const { canvas, draws, fills } = fakeCanvas(filterSupported)
  return {
    videos,
    images,
    draws,
    fills,
    options: {
      frame: { width: 320, height: 180 },
      createCanvas: () => canvas,
      createVideo: () => {
        const video = new FakeVideo()
        videos.push(video)
        return video as unknown as HTMLVideoElement
      },
      createImage: () => {
        const image = new FakeImage()
        images.push(image)
        return image as unknown as HTMLImageElement
      },
    },
  }
}

describe('frameFileName (#237)', () => {
  it('derives the name from the sequence time, clamped at zero', () => {
    expect(frameFileName(7.254)).toBe('sequence-frame-7.25s.png')
    expect(frameFileName(0)).toBe('sequence-frame-0.00s.png')
    expect(frameFileName(-1)).toBe('sequence-frame-0.00s.png')
  })
})

describe('snapshotTimelineFrame (#237)', () => {
  it('refuses an empty timeline', async () => {
    await expect(snapshotTimelineFrame({ entries: [] }, 0)).rejects.toThrow(
      'The timeline is empty',
    )
  })

  it('refuses a color-adjusted timeline when canvas filters are unsupported', async () => {
    const { options } = snapshotOptions(false)
    const timeline: TimelineState = {
      entries: [entry({ id: 'a', colorAdjustments: { brightness: 1.5 } })],
    }
    await expect(snapshotTimelineFrame(timeline, 1, options)).rejects.toThrow(
      ExportUnsupportedError,
    )
    await expect(snapshotTimelineFrame(timeline, 1, options)).rejects.toThrow(
      /color adjustments/,
    )
  })

  it('cues the entry to the located source time and draws it as a PNG', async () => {
    const { options, videos, draws } = snapshotOptions()
    // Trimmed entry: sequence 1.5s into it falls at source 2 + 1.5 = 3.5s.
    const timeline: TimelineState = { entries: [entry({ id: 'a', inPoint: 2, outPoint: 6 })] }
    const blob = await snapshotTimelineFrame(timeline, 1.5, options)

    expect(blob.type).toBe('image/png')
    expect(videos).toHaveLength(1)
    expect(videos[0].urls).toEqual(['blob:a'])
    expect(videos[0].seeks).toEqual([3.5])
    expect(draws).toHaveLength(1)
    expect(draws[0].source).toBe(videos[0])
    // Released after the draw — the elements are the snapshot's own.
    expect(videos[0].loaded).toBe(true)
  })

  it('inside a transition overlap cues and draws both layers', async () => {
    const { options, videos, draws } = snapshotOptions()
    const timeline: TimelineState = {
      entries: [entry({ id: 'a', outPoint: 4 }), entry({ id: 'b', inPoint: 1, outPoint: 5 })],
      transitions: [{ beforeId: 'a', afterId: 'b', type: 'crossfade', duration: 2 }],
    }
    // Entry a spans output [0, 4); the overlap opens at 2. Sequence 3 is 1s
    // into the overlap: a at source 3, b at source 1 + 1 = 2.
    await snapshotTimelineFrame(timeline, 3, options)

    expect(videos).toHaveLength(2)
    expect(videos[0].seeks).toEqual([3])
    expect(videos[1].urls).toEqual(['blob:b'])
    expect(videos[1].seeks).toEqual([2])
    expect(draws).toHaveLength(2)
    expect(draws[0].source).toBe(videos[0])
    expect(draws[1].source).toBe(videos[1])
  })

  it('cues active video overlays to their sequence-anchored source times', async () => {
    const { options, videos, draws } = snapshotOptions()
    const timeline: TimelineState = {
      entries: [entry({ id: 'a', outPoint: 10 })],
      videoOverlays: [
        {
          id: 'ov',
          clipId: 'clip-ov',
          name: 'ov.webm',
          duration: 8,
          url: 'blob:ov',
          offset: 2,
          inPoint: 1,
          outPoint: 5,
          x: 0.1,
          y: 0.1,
          width: 0.4,
          height: 0.4,
        },
      ],
    }
    // Sequence 3 is 1s into the overlay's window: source 1 + 1 = 2.
    await snapshotTimelineFrame(timeline, 3, options)

    const overlayElement = videos.find((video) => video.urls.includes('blob:ov'))
    expect(overlayElement?.seeks).toEqual([2])
    // Base layer, then the overlay — drawn twice, because the composer also
    // copies each overlay's picture into its last-frame stand-in (#319) and
    // this fake hands every canvas the same recording context.
    expect(draws).toHaveLength(3)
    expect(draws[0].source).not.toBe(overlayElement)
    expect(draws[1].source).toBe(overlayElement)
    expect(draws[2].source).toBe(overlayElement)
  })

  it('draws a cropped entry through the kept source rectangle (#256)', async () => {
    const { options, draws } = snapshotOptions()
    const timeline: TimelineState = { entries: [entry({ id: 'a', crop: { left: 0.5 } })] }
    await snapshotTimelineFrame(timeline, 1, options)

    // The composer consumes the shared crop rule (#255): the 320×180 fake
    // source presents its kept 160×180 region to the fit (pillarboxed in the
    // 320×180 frame) and the drawImage call carries the kept rect as its
    // source rectangle — the snapshot renders crop exactly as an export
    // frame does.
    expect(draws).toHaveLength(1)
    expect(draws[0].args).toEqual([160, 0, 160, 180, 80, 0, 160, 180])
  })

  it('renders an entry background fill under the fitted media (#260)', async () => {
    const { options, draws, fills } = snapshotOptions()
    // The cropped 160×180 region pillarboxes in the forced 320×180 frame —
    // bars for the fill to paint.
    const timeline: TimelineState = {
      entries: [
        entry({ id: 'a', crop: { left: 0.5 }, backgroundFill: { kind: 'color', color: '#cc0000' } }),
      ],
    }
    await snapshotTimelineFrame(timeline, 1, options)

    // The snapshot composes through the shared composer (#260): the stage's
    // black, then the backdrop over the full frame, then the media above it.
    expect(fills.map((fill) => fill.style)).toEqual(['#000', '#cc0000'])
    expect(fills[1].args).toEqual([0, 0, 320, 180])
    expect(draws).toHaveLength(1)
  })

  it('waits for the sought frame to be PRESENTED before drawing (#276)', async () => {
    // A <video> exposing requestVideoFrameCallback: `seeked` alone no longer
    // releases the draw — presentation does. Callbacks are collected and
    // fired manually so the ordering is pinned, not assumed.
    class PresentingFakeVideo extends FakeVideo {
      frameCallbacks: (() => void)[] = []
      requestVideoFrameCallback(callback: () => void) {
        this.frameCallbacks.push(callback)
      }
      presentFrame() {
        const callbacks = [...this.frameCallbacks]
        this.frameCallbacks = []
        for (const callback of callbacks) callback()
      }
    }
    const videos: PresentingFakeVideo[] = []
    const { canvas, draws } = fakeCanvas()
    const options = {
      frame: { width: 320, height: 180 },
      createCanvas: () => canvas,
      createVideo: () => {
        const video = new PresentingFakeVideo()
        videos.push(video)
        return video as unknown as HTMLVideoElement
      },
    }
    const timeline: TimelineState = { entries: [entry({ id: 'a', inPoint: 2, outPoint: 6 })] }
    let settled = false
    const pending = snapshotTimelineFrame(timeline, 1.5, options).then((blob) => {
      settled = true
      return blob
    })
    // Load and seek settle on microtasks; drain them. The snapshot must
    // still be waiting — `seeked` has fired but no frame was presented.
    for (let i = 0; i < 20; i++) await Promise.resolve()
    expect(videos[0].seeks).toEqual([3.5])
    expect(draws).toHaveLength(0)
    expect(settled).toBe(false)
    videos[0].presentFrame()
    const blob = await pending
    expect(blob.type).toBe('image/png')
    expect(draws).toHaveLength(1)
  })

  it('a browser that never presents a detached frame falls back after the bounded wait (#276)', async () => {
    // requestVideoFrameCallback exists but never fires: the snapshot must
    // degrade to the pre-#276 behavior after the bound, never hang.
    vi.useFakeTimers()
    try {
      class SilentRvfcFakeVideo extends FakeVideo {
        requestVideoFrameCallback() {}
      }
      const { canvas, draws } = fakeCanvas()
      const options = {
        frame: { width: 320, height: 180 },
        createCanvas: () => canvas,
        createVideo: () => new SilentRvfcFakeVideo() as unknown as HTMLVideoElement,
      }
      const timeline: TimelineState = { entries: [entry({ id: 'a', inPoint: 2, outPoint: 6 })] }
      const pending = snapshotTimelineFrame(timeline, 1.5, options)
      await vi.advanceTimersByTimeAsync(300)
      const blob = await pending
      expect(blob.type).toBe('image/png')
      expect(draws).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('skips the seek when the entry starts at the element position and waits for data', async () => {
    const { options, videos } = snapshotOptions()
    const timeline: TimelineState = { entries: [entry({ id: 'a' })] }
    await snapshotTimelineFrame(timeline, 0, options)
    // Source time 0 equals the fresh element's clock: cued without a seek.
    expect(videos[0].seeks).toEqual([])
  })
})

describe('snapshotTimelineFrame with still overlay layers (#295)', () => {
  const stillOverlay = {
    id: 'logo',
    kind: 'image' as const,
    clipId: 'clip-logo',
    name: 'logo.png',
    duration: 5,
    url: 'blob:logo',
    offset: 2,
    inPoint: 0,
    outPoint: 5,
    x: 0.6,
    y: 0.6,
    width: 0.3,
    height: 0.3,
  }

  it('decodes the still and draws it above the base, creating no <video> for it', async () => {
    const { options, videos, images, draws } = snapshotOptions()
    const timeline: TimelineState = {
      entries: [entry({ id: 'a', outPoint: 10 })],
      videoOverlays: [stillOverlay],
    }
    // Sequence 4 is inside the overlay's window [2, 7).
    await snapshotTimelineFrame(timeline, 4, options)

    // The still loaded through an <img>...
    const logoImage = images.find((image) => image.urls.includes('blob:logo'))
    expect(logoImage).toBeDefined()
    // ...and never through a <video>: handing an image URL to a <video>
    // would hang the snapshot on a source that can never load.
    expect(videos.some((video) => video.urls.includes('blob:logo'))).toBe(false)

    // Base layer first, then the still above it. Unlike a video overlay
    // (#319) a still needs no stand-in copy, so it is drawn exactly once.
    expect(draws).toHaveLength(2)
    expect(draws[0].source).not.toBe(logoImage)
    expect(draws[1].source).toBe(logoImage)
  })

  it('omits the still outside its window', async () => {
    const { options, images, draws } = snapshotOptions()
    const timeline: TimelineState = {
      entries: [entry({ id: 'a', outPoint: 10 })],
      videoOverlays: [stillOverlay],
    }
    // Sequence 1 is before the window opens at 2.
    await snapshotTimelineFrame(timeline, 1, options)
    expect(draws).toHaveLength(1)
    // Not even decoded: an inactive layer is not a source this frame needs.
    expect(images.some((image) => image.urls.includes('blob:logo'))).toBe(false)
  })
})
