import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { finish, PEAK, RECIPES, SAMPLE_RATE, seededRandom, wavBytes } from './recipes.ts'

const SOUNDS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../src/plugins/soundLibrary/sounds')

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

  it('the committed manifest lists every recipe, each with its file, a licence and a source', () => {
    const manifest = JSON.parse(readFileSync(join(SOUNDS_DIR, 'manifest.json'), 'utf8')) as {
      sounds: { id: string; name: string; category: string; file: string; duration: number; licence: string; source: string }[]
    }
    expect(manifest.sounds.map((sound) => sound.id)).toEqual(RECIPES.map((recipe) => recipe.id))
    for (const sound of manifest.sounds) {
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
