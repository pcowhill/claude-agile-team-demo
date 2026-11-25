import manifest from './sounds/manifest.json'

/**
 * The Sound library's set (#861), and its music beds (#869): the manifest that `tools/sounds/
 * generateSounds.ts` writes, joined to each file's URL. This module is part
 * of the plugin's lazy chunk, so enabling the plugin downloads the manifest
 * and the URLs, **never the sounds**. Each file is a separate static asset,
 * fetched only when it is previewed or added.
 *
 * `?url&no-inline` keeps every file an asset: Vite would otherwise inline a
 * file under its 4 kB limit into the chunk as a data URL, and Click and
 * Double click are under it.
 */
const URLS = import.meta.glob<string>('./sounds/*.webm', {
  eager: true,
  query: '?url&no-inline',
  import: 'default',
})

export interface LibrarySound {
  id: string
  /** What the dialog lists, and the library clip's name before its extension. */
  name: string
  category: string
  /** A music bed's mood, one word (#869), such as "Calm". Effects have none. */
  mood?: string
  /** Seconds, as ffprobe measured the encoded file. */
  duration: number
  /** An SPDX id; every file is `CC0-1.0`. */
  licence: string
  source: string
  /** The file's URL. Nothing fetches it until preview or Add. */
  url: string
}

/** Every sound with a file, in manifest order (grouped by category). */
export const SOUNDS: readonly LibrarySound[] = manifest.sounds.flatMap((sound) => {
  const url = URLS[`./sounds/${sound.file}`]
  if (url === undefined) return []
  const { file: _file, ...rest } = sound
  return [{ ...rest, url }]
})

/** The file name an added sound is imported under: its name, as an Opus WebM. */
export const soundFileName = (sound: Pick<LibrarySound, 'name'>) => `${sound.name}.webm`

/**
 * A sound's length for the list: tenths of a second for an effect, which
 * is never more than a few seconds, and minutes and seconds for a music
 * bed (#869), rounded to the nearest second.
 */
export function formatSoundLength(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)} s`
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}
