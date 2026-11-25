import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { masterMusic, MUSIC, MUSIC_RMS_DB } from './music.ts'
import type { Stereo } from './music.ts'
import { finish, PEAK, RECIPES, SAMPLE_RATE, seededRandom, wavBytes } from './recipes.ts'

const SOUNDS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../src/plugins/soundLibrary/sounds')

/** Each bed rendered once, on first use: a render takes a few seconds. */
const rendered = new Map<string, Stereo>()
const renderOnce = (track: (typeof MUSIC)[number]) => {
  let mix = rendered.get(track.id)
  if (mix === undefined) {
    mix = track.render()
    rendered.set(track.id, mix)
  }
  return mix
}

const dbfs = (energy: number, count: number) => 10 * Math.log10(energy / count)

/** Every music test renders all six beds, so each gets room. */
const SLOW = { timeout: 120_000 }

describe('music beds (#869)', () => {
  it('has five to eight beds, each its own id and mood, 1 to 3 minutes of stereo', SLOW, () => {
    expect(MUSIC.length).toBeGreaterThanOrEqual(5)
    expect(MUSIC.length).toBeLessThanOrEqual(8)
    const ids = [...RECIPES, ...MUSIC].map((sound) => sound.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(MUSIC.map((track) => track.mood)).size).toBe(MUSIC.length)
    for (const track of MUSIC) {
      const { left, right } = renderOnce(track)
      expect(left.length, track.id).toBe(right.length)
      expect(left.length / SAMPLE_RATE, track.id).toBeGreaterThanOrEqual(60)
      expect(left.length / SAMPLE_RATE, track.id).toBeLessThanOrEqual(180)
      expect(left.every(Number.isFinite) && right.every(Number.isFinite), `${track.id} has a non-finite sample`).toBe(true)
    }
  })

  it('renders the same samples every time: every variation is seeded', SLOW, () => {
    for (const track of MUSIC) {
      const again = track.render()
      const first = renderOnce(track)
      // Compared sample by sample: a deep toEqual over millions of
      // elements takes minutes.
      let differing = 0
      for (let index = 0; index < first.left.length; index++) {
        if (again.left[index] !== first.left[index] || again.right[index] !== first.right[index]) differing++
      }
      expect(again.left.length, track.id).toBe(first.left.length)
      expect(differing, `${track.id}: samples that differ`).toBe(0)
    }
  })

  it('masters every bed to one loudness, under the peak, silent at both ends', SLOW, () => {
    for (const track of MUSIC) {
      const { left, right } = masterMusic(renderOnce(track), PEAK)
      let energy = 0
      let peak = 0
      for (const side of [left, right]) {
        for (const sample of side) {
          energy += sample * sample
          peak = Math.max(peak, Math.abs(sample))
        }
      }
      // The limiter only lowers samples above its knee, so the RMS can sit
      // a little under the target, never over it.
      const rms = dbfs(energy, 2 * left.length)
      expect(rms, track.id).toBeLessThanOrEqual(MUSIC_RMS_DB + 0.01)
      expect(rms, track.id).toBeGreaterThan(MUSIC_RMS_DB - 1)
      expect(peak, track.id).toBeLessThanOrEqual(PEAK)
      for (const side of [left, right]) {
        expect(Math.abs(side[0]), track.id).toBeLessThan(1e-6)
        expect(Math.abs(side[side.length - 1]), track.id).toBeLessThan(1e-6)
      }
    }
  })

  it('never drops out: every 2-second stretch between the opening and the fade carries sound', SLOW, () => {
    const window = 2 * SAMPLE_RATE
    for (const track of MUSIC) {
      const { left, right } = masterMusic(renderOnce(track), PEAK)
      // From 2 s in to 8 s before the end, which is the final fade.
      for (let start = window; start + window <= left.length - 8 * SAMPLE_RATE; start += window) {
        let energy = 0
        for (let index = start; index < start + window; index++) energy += left[index] ** 2 + right[index] ** 2
        const level = dbfs(energy, 2 * window)
        expect(level, `${track.id} at ${start / SAMPLE_RATE} s: ${level.toFixed(1)} dBFS`).toBeGreaterThan(-34)
      }
    }
  })

  it('is stereo: the two channels differ', SLOW, () => {
    for (const track of MUSIC) {
      const { left, right } = renderOnce(track)
      let cross = 0
      let leftEnergy = 0
      let rightEnergy = 0
      for (let index = 0; index < left.length; index++) {
        cross += left[index] * right[index]
        leftEnergy += left[index] ** 2
        rightEnergy += right[index] ** 2
      }
      expect(cross / Math.sqrt(leftEnergy * rightEnergy), track.id).toBeLessThan(0.995)
    }
  })

  it('writes a 16-bit stereo WAV with the channels interleaved', () => {
    const bytes = wavBytes([new Float32Array([1, 0]), new Float32Array([-1, 0.5])])
    const view = new DataView(bytes.buffer)
    expect(view.getUint16(22, true)).toBe(2)
    expect(view.getUint32(28, true)).toBe(SAMPLE_RATE * 4)
    expect(view.getUint16(32, true)).toBe(4)
    expect(view.getUint32(40, true)).toBe(8)
    expect([0, 2, 4, 6].map((offset) => view.getInt16(44 + offset, true))).toEqual([32767, -32767, 0, 16384])
  })
})

describe('sound recipes (#861)', () => {
  it('covers the kinds the issue names, with unique ids, each under 3 s', () => {
    const ids = RECIPES.map((recipe) => recipe.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const kind of ['whoosh', 'click', 'pop', 'ding', 'typing', 'notification', 'swoosh-out']) {
      expect(ids).toContain(kind)
    }
    expect(RECIPES.length).toBeGreaterThanOrEqual(10)
    expect(RECIPES.length).toBeLessThanOrEqual(15)
    for (const recipe of RECIPES) {
      const samples = recipe.render()
      expect(samples.length / SAMPLE_RATE, recipe.id).toBeLessThan(3)
      expect(samples.every(Number.isFinite), `${recipe.id} has a non-finite sample`).toBe(true)
    }
  })

  it('renders the same samples every time: the noise is seeded', () => {
    for (const recipe of RECIPES) {
      expect(recipe.render(), recipe.id).toEqual(recipe.render())
    }
    const a = seededRandom(3)
    const b = seededRandom(3)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it('normalises each sound to its peak, never silent, and fades both ends to zero', () => {
    for (const recipe of RECIPES) {
      const done = finish(recipe.render(), recipe.level)
      const peak = done.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0)
      // At the target, or a little under it where the peak falls inside the
      // 2 ms fade-in (Pop's does: its attack is 1 ms).
      const target = PEAK * (recipe.level ?? 1)
      expect(peak, recipe.id).toBeLessThanOrEqual(target + 1e-6)
      expect(peak, recipe.id).toBeGreaterThan(target * 0.95)
      expect(Math.abs(done[0])).toBe(0)
      expect(Math.abs(done[done.length - 1])).toBe(0)
    }
  })

  it('writes a 16-bit mono WAV header the encoder reads', () => {
    const bytes = wavBytes(new Float32Array([0, 1, -1]))
    const view = new DataView(bytes.buffer)
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF')
    expect(view.getUint32(24, true)).toBe(SAMPLE_RATE)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(40, true)).toBe(6)
    expect(view.getInt16(46, true)).toBe(32767)
    expect(view.getInt16(48, true)).toBe(-32767)
  })

  it('the committed manifest lists every recipe, then every bed, each with its file, a licence and a source', SLOW, () => {
    const manifest = JSON.parse(readFileSync(join(SOUNDS_DIR, 'manifest.json'), 'utf8')) as {
      sounds: { id: string; name: string; category: string; mood?: string; file: string; duration: number; licence: string; source: string }[]
    }
    expect(manifest.sounds.map((sound) => sound.id)).toEqual([...RECIPES, ...MUSIC].map((sound) => sound.id))
    for (const track of MUSIC) {
      const sound = manifest.sounds.find((candidate) => candidate.id === track.id)!
      expect(sound.name).toBe(track.name)
      expect(sound.category).toBe('Music')
      expect(sound.mood).toBe(track.mood)
      expect(existsSync(join(SOUNDS_DIR, sound.file)), sound.file).toBe(true)
      expect(sound.licence).toBe('CC0-1.0')
      expect(sound.source).toContain(`track "${sound.id}"`)
      expect(Math.abs(sound.duration - renderOnce(track).left.length / SAMPLE_RATE), sound.id).toBeLessThan(0.02)
    }
    for (const sound of manifest.sounds.filter((candidate) => candidate.category !== 'Music')) {
      const recipe = RECIPES.find((candidate) => candidate.id === sound.id)!
      expect(sound.name).toBe(recipe.name)
      expect(sound.category).toBe(recipe.category)
      expect(existsSync(join(SOUNDS_DIR, sound.file)), sound.file).toBe(true)
      expect(sound.licence).toBe('CC0-1.0')
      expect(sound.source).toContain(`recipe "${sound.id}"`)
      // The encoded length is the rendered length, give or take Opus framing.
      expect(Math.abs(sound.duration - recipe.render().length / SAMPLE_RATE), sound.id).toBeLessThan(0.02)
    }
  })
})
