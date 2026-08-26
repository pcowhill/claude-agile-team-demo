import type { LibraryClip } from './mediaLibrary'

/** Display name for the audio clip extracted from `sourceName` (#154). */
export function extractedAudioName(sourceName: string): string {
  return `${sourceName} (audio)`
}

async function defaultFetchBlob(url: string): Promise<Blob> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`The clip's media could not be read (${response.status}).`)
  return await response.blob()
}

/**
 * Creates the audio-kind library clip that extracts a video clip's audio
 * (#154): the same imported bytes under a **fresh** object URL, so the two
 * clips' lifetimes are independent — removing the source video revokes only
 * the source's URL (App.tsx) and the extracted clip keeps playing. No
 * transcoding is involved: everywhere this app touches sound (preview #103,
 * export #105) audio plays through media elements, and an element pointed at
 * a video container plays its audio track. `extractedFrom` records the
 * source *filename* so a references-only project can re-link this clip from
 * the original video file (openProject.ts) — the extracted clip has no file
 * of its own on disk.
 *
 * `fetchBlob` is injectable for tests: jsdom cannot fetch blob: URLs.
 */
export async function extractAudioClip(
  source: LibraryClip,
  id: string,
  fetchBlob: (url: string) => Promise<Blob> = defaultFetchBlob,
): Promise<LibraryClip> {
  const blob = await fetchBlob(source.url)
  return {
    id,
    name: extractedAudioName(source.name),
    duration: source.duration,
    url: URL.createObjectURL(blob),
    kind: 'audio',
    extractedFrom: source.name,
  }
}
