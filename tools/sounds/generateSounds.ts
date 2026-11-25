/**
 * Regenerates the Sound library plugin's files (#861, #869):
 *
 *   node tools/sounds/generateSounds.ts
 *
 * Renders every effect recipe in `recipes.ts` and every music bed in
 * `music.ts`, encodes each as Opus in WebM with FFmpeg (libopus: effects at
 * 64 kb/s mono, music at 64 kb/s stereo), measures each file's duration
 * with ffprobe, and writes `manifest.json` beside the files. FFmpeg and
 * ffprobe must be on the PATH. Nothing here runs in the app or in CI; the
 * outputs are committed.
 *
 * The output is meant to be byte-for-byte repeatable: the noise is seeded,
 * and FFmpeg is asked for bit-exact output with no metadata, so a rerun
 * that changes a file means a recipe or a track changed.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { masterMusic, MUSIC } from './music.ts'
import { finish, PEAK, RECIPES, wavBytes } from './recipes.ts'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../src/plugins/soundLibrary/sounds')
const LICENCE = 'CC0-1.0'
const SOURCE = 'Synthesised by tools/sounds/recipes.ts (the team\'s own work)'
const MUSIC_SOURCE = 'Composed and synthesised by tools/sounds/music.ts (the team\'s own work)'
/** Opus bitrates: an effect is short and mono; a bed is stereo music. */
const EFFECT_BITRATE = '64k'
const MUSIC_BITRATE = '64k'

/** Encodes `wav` as Opus WebM into the plugin's folder, and returns its probed duration in seconds. */
function encode(wav: string, file: string, bitrate: string, channels: number): number {
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', wav,
    '-c:a', 'libopus', '-b:a', bitrate, '-ac', String(channels),
    '-map_metadata', '-1',
    '-fflags', '+bitexact', '-flags:a', '+bitexact',
    join(OUT_DIR, file),
  ])
  const probed = execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(OUT_DIR, file),
  ]).toString()
  return Math.round(Number.parseFloat(probed) * 1000) / 1000
}

const scratch = mkdtempSync(join(tmpdir(), 'sounds-'))
try {
  const effects = RECIPES.map((recipe) => {
    const wav = join(scratch, `${recipe.id}.wav`)
    writeFileSync(wav, wavBytes(finish(recipe.render(), recipe.level)))
    const file = `${recipe.id}.webm`
    return {
      id: recipe.id,
      name: recipe.name,
      category: recipe.category,
      file,
      duration: encode(wav, file, EFFECT_BITRATE, 1),
      licence: LICENCE,
      source: `${SOURCE}, recipe "${recipe.id}"`,
    }
  })
  const music = MUSIC.map((track) => {
    const wav = join(scratch, `${track.id}.wav`)
    const mastered = masterMusic(track.render(), PEAK)
    writeFileSync(wav, wavBytes([mastered.left, mastered.right]))
    const file = `${track.id}.webm`
    return {
      id: track.id,
      name: track.name,
      category: 'Music',
      mood: track.mood,
      file,
      duration: encode(wav, file, MUSIC_BITRATE, 2),
      licence: LICENCE,
      source: `${MUSIC_SOURCE}, track "${track.id}"`,
    }
  })
  const sounds = [...effects, ...music]
  writeFileSync(join(OUT_DIR, 'manifest.json'), `${JSON.stringify({ sounds }, null, 2)}\n`)
  let total = 0
  for (const sound of sounds) {
    const bytes = statSync(join(OUT_DIR, sound.file)).size
    total += bytes
    console.log(`${sound.file}\t${sound.duration} s\t${bytes} B`)
  }
  console.log(`total\t${total} B`)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
