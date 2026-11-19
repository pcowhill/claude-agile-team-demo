import { describe, expect, it } from 'vitest'
import { computeLevels, windowLevel } from './audioLevels'
import type { ClipLevels } from './audioLevels'
import { levelElements, matchReport, planMatchLevels } from './matchLevels'
import type { LevelElement } from './matchLevels'
import type { TimelineState } from './timeline'

const RATE = 48000

function sine(amplitude: number, seconds: number): Float32Array {
  const samples = new Float32Array(Math.round(seconds * RATE))
  for (let index = 0; index < samples.length; index++) {
    samples[index] = amplitude * Math.sin((2 * Math.PI * 440 * index) / RATE)
  }
  return samples
}

function element(id: string, url: string, overrides: Partial<LevelElement> = {}): LevelElement {
  return { kind: 'audio-track', id, label: id, url, inPoint: 0, outPoint: 2, volume: 1, ...overrides }
}

/** The level an element plays at after the plan: its source level plus its Volume's gain. */
function playedDb(levels: ClipLevels, at: LevelElement, volume: number): number {
  return windowLevel(levels, at.inPoint, at.outPoint)!.levelDb + 20 * Math.log10(volume)
}

// Two sources 12 dB apart: sines at 0.4 and 0.1 (−10.97 and −23.01 dB).
const loud = computeLevels([sine(0.4, 2)], RATE)
const quiet = computeLevels([sine(0.1, 2)], RATE)
const byUrl = (map: Record<string, ClipLevels | null>) => (at: LevelElement) => map[at.url] ?? null

describe('Match levels: the gains (#691)', () => {
  const pair = [element('loud', 'blob:loud'), element('quiet', 'blob:quiet')]
  const levels = byUrl({ 'blob:loud': loud, 'blob:quiet': quiet })

  it('lowers the louder of two sources to a target between them, and holds the quieter at Volume 1', () => {
    const [a, b] = planMatchLevels(pair, levels, -16)
    expect(a.outcome).toBe('matched')
    expect(Math.abs(playedDb(loud, a.element, a.volume) - -16)).toBeLessThan(0.5)
    // The quieter would need more than Volume 1: it is at 1, reported below target.
    expect(b).toMatchObject({ outcome: 'below-target', volume: 1 })
    expect(matchReport([a, b])).toContain('quiet: below the target even at Volume 1')
  })

  it('with the target at or below both, lands them within 0.5 dB of each other and of the target', () => {
    for (const target of [-24, -26, -30]) {
      const [a, b] = planMatchLevels(pair, levels, target)
      expect([a.outcome, b.outcome]).toEqual(['matched', 'matched'])
      const aDb = playedDb(loud, a.element, a.volume)
      const bDb = playedDb(quiet, b.element, b.volume)
      expect(Math.abs(aDb - bDb)).toBeLessThan(0.5)
      expect(Math.abs(aDb - target)).toBeLessThan(0.5)
      // 12 dB apart going in, so their Volumes end 12 dB apart.
      expect(Math.abs(20 * Math.log10(b.volume / a.volume) - 12)).toBeLessThan(0.5)
    }
  })

  it('works from the source, not from the Volume the element had', () => {
    const turnedDown = [element('loud', 'blob:loud', { volume: 0.2 })]
    expect(planMatchLevels(turnedDown, levels, -26)[0].volume).toBe(
      planMatchLevels([element('loud', 'blob:loud')], levels, -26)[0].volume,
    )
  })

  it('measures each element on its own trim of a shared source', () => {
    // One source, loud for 2 s then quiet for 2 s; two elements trim it apart.
    const both = computeLevels([new Float32Array([...sine(0.4, 2), ...sine(0.1, 2)])], RATE)
    const [first, second] = planMatchLevels(
      [element('first', 'blob:both', { outPoint: 2 }), element('second', 'blob:both', { inPoint: 2, outPoint: 4 })],
      byUrl({ 'blob:both': both }),
      -26,
    )
    expect(Math.abs(20 * Math.log10(second.volume / first.volume) - 12)).toBeLessThan(0.5)
  })

  it('leaves an undecodable or silent element as it was, and names it', () => {
    const results = planMatchLevels(
      [element('broken', 'blob:broken', { volume: 0.7 }), element('hush', 'blob:hush', { volume: 0.4 })],
      byUrl({ 'blob:broken': null, 'blob:hush': computeLevels([new Float32Array(RATE)], RATE) }),
      -20,
    )
    expect(results.map((result) => [result.outcome, result.volume])).toEqual([
      ['undecodable', 0.7],
      ['silent', 0.4],
    ])
    const report = matchReport(results)
    expect(report).toContain('Match levels set 0 of 2 elements to the target.')
    expect(report).toContain('broken: its sound could not be read')
    expect(report).toContain('hush: no sound in its trim')
  })
})

describe('Match levels: the clipping guard (#691)', () => {
  // A decoded lossy file can overshoot full scale: a quiet tone with one
  // sample at 2.0, so its level is low and its peak is past 1.
  const spiky = sine(0.05, 2)
  spiky[RATE] = 2
  const spikyLevels = computeLevels([spiky], RATE)

  it('stops short of the Volume at which the window would pass full scale', () => {
    const [result] = planMatchLevels([element('spiky', 'blob:spiky')], byUrl({ 'blob:spiky': spikyLevels }), -16)
    expect(result.outcome).toBe('peak-limited')
    expect(result.volume * 2).toBeLessThanOrEqual(1)
    expect(result.volume).toBeGreaterThan(0.49)
    expect(matchReport([result])).toContain('spiky: stopped short so its peaks do not clip')
  })

  it('never sets any element to a Volume at which its peak exceeds full scale', () => {
    const sources: Record<string, ClipLevels> = {
      'blob:loud': loud,
      'blob:quiet': quiet,
      'blob:spiky': spikyLevels,
      'blob:hot': computeLevels([sine(1, 2)], RATE),
    }
    const elements = Object.keys(sources).map((url) => element(url, url))
    for (const target of [-30, -26, -23, -20, -16, -6, 0]) {
      for (const result of planMatchLevels(elements, byUrl(sources), target)) {
        const { peak } = windowLevel(sources[result.element.url], 0, 2)!
        expect(result.volume * peak, `${result.element.id} at ${target} dB`).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('Match levels: which elements (#691)', () => {
  const entry = (id: string, extra: object = {}) => ({
    id,
    clipId: `clip-${id}`,
    name: id,
    url: `blob:${id}`,
    duration: 5,
    inPoint: 1,
    outPoint: 4,
    ...extra,
  })
  const state = {
    entries: [
      entry('video', { volume: 0.5 }),
      entry('still', { kind: 'image' }),
      entry('slate', { kind: 'slate', color: '#000000' }),
      entry('muted-video', { muted: true }),
    ],
    videoOverlays: [
      { ...entry('overlay'), offset: 0 },
      { ...entry('logo'), offset: 0, kind: 'image' },
      { ...entry('muted-overlay'), offset: 0, muted: true },
    ],
    audioTracks: [{ ...entry('music'), offset: 0 }],
  } as unknown as TimelineState

  it('takes video entries, video overlays and audio tracks; skips stills, slates, image overlays and anything muted', () => {
    expect(levelElements(state).map((each) => [each.kind, each.id])).toEqual([
      ['entry', 'video'],
      ['video-overlay', 'overlay'],
      ['audio-track', 'music'],
    ])
  })

  it("reads each one's trimmed window and current Volume", () => {
    expect(levelElements(state)[0]).toMatchObject({ url: 'blob:video', inPoint: 1, outPoint: 4, volume: 0.5 })
    expect(levelElements(state)[2].volume).toBe(1)
  })
})
