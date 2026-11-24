/**
 * Regenerates the Sound library plugin's files (#861):
 *
 *   node tools/sounds/generateSounds.ts
 *
 * Renders every recipe in `recipes.ts`, encodes each as Opus in WebM with
 * FFmpeg (libopus, 64 kb/s mono), measures each file's duration with
 * ffprobe, and writes `manifest.json` beside the files. FFmpeg and ffprobe
 * must be on the PATH. Nothing here runs in the app or in CI; the outputs
 * are committed.
 *
 * The output is meant to be byte-for-byte repeatable: the noise is seeded,
 * and FFmpeg is asked for bit-exact output with no metadata, so a rerun
 * that changes a file means a recipe changed.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { finish, RECIPES, wavBytes } from './recipes.ts'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../src/plugins/soundLibrary/sounds')
const LICENCE = 'CC0-1.0'
const SOURCE = 'Synthesised by tools/sounds/recipes.ts (the team\'s own work)'

const scratch = mkdtempSync(join(tmpdir(), 'sounds-'))
try {
  const sounds = RECIPES.map((recipe) => {
    const wav = join(scratch, `${recipe.id}.wav`)
    writeFileSync(wav, wavBytes(finish(recipe.render(), recipe.level)))
    const file = `${recipe.id}.webm`
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', wav,
      '-c:a', 'libopus', '-b:a', '64k', '-ac', '1',
      '-map_metadata', '-1',
      '-fflags', '+bitexact', '-flags:a', '+bitexact',
      join(OUT_DIR, file),
    ])
    const probed = execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(OUT_DIR, file),
    ]).toString()
    const duration = Math.round(Number.parseFloat(probed) * 1000) / 1000
    return {
      id: recipe.id,
      name: recipe.name,
      category: recipe.category,
      file,
      duration,
      licence: LICENCE,
      source: `${SOURCE}, recipe "${recipe.id}"`,
    }
  })
  writeFileSync(join(OUT_DIR, 'manifest.json'), `${JSON.stringify({ sounds }, null, 2)}\n`)
  for (const sound of sounds) console.log(`${sound.file}\t${sound.duration} s`)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
