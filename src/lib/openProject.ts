import type { LibraryClip, MediaKind } from './mediaLibrary'
import type { ClipMedia, Project, ProjectClip } from './projectFile'
import { normalizedTimelineState } from './timeline'
import type { TimelineState } from './timeline'

/**
 * Re-linking media when a project is opened (#77). Project files store clip
 * metadata, never the media itself (#75), so opening asks the user to
 * re-select the files and each picked file must be matched to a stored clip
 * before the project can be edited. Matching is by filename AND duration —
 * a file that merely shares the name of a project clip but carries different
 * content would silently break every trim and effect referencing it, so a
 * metadata mismatch is reported instead of accepted. Still images (#137)
 * have no duration, so their content check is pixel dimensions instead.
 */

/**
 * Whether a re-probed duration is close enough to the stored one to be the
 * same media. The same file probed in the same browser reproduces exactly,
 * but a project saved from a different browser may disagree by container
 * rounding — so allow 1% of the stored duration, floored at 100 ms.
 */
export function durationsMatch(stored: number, probed: number): boolean {
  return Math.abs(stored - probed) <= Math.max(0.1, stored * 0.01)
}

export type MatchResult =
  | { kind: 'matched'; clipId: string }
  | { kind: 'no-match'; reason: string }

const seconds = (value: number): string => `${Number(value.toFixed(2))}s`

/** Intrinsic pixel dimensions, as probed from a picked image file (#137). */
export interface ProbedDimensions {
  width: number
  height: number
}

/**
 * Whether a picked image's content plausibly matches a stored image clip
 * (#137): the same file decodes to the same pixel dimensions in every
 * browser, so equality is required — but only when both sides know them
 * (a foreign writer may have omitted the stored ones; then filename and
 * kind are all there is to check).
 */
function imageContentMatches(clip: ProjectClip, probed: ProbedDimensions | undefined): boolean {
  if (clip.width === undefined || clip.height === undefined || probed === undefined) return true
  return clip.width === probed.width && clip.height === probed.height
}

const pixels = (width: number, height: number): string => `${width}×${height} pixels`

/**
 * Matches one picked file against the project's still-unlinked clips.
 * Filename first (several project clips may share a name — the first
 * unlinked one whose content metadata also matches wins), then media kind
 * and the content check — duration for video/audio, pixel dimensions for
 * images (#137, both probe as duration 0 so the duration check is inert
 * for them); each failure mode gets its own human-readable reason.
 */
export function matchFileToClip(
  clips: readonly ProjectClip[],
  linked: ReadonlySet<string>,
  fileName: string,
  probedDuration: number,
  probedKind: MediaKind,
  probedDimensions?: ProbedDimensions,
): MatchResult {
  const sameName = clips.filter((clip) => clip.name === fileName)
  if (sameName.length === 0) {
    return { kind: 'no-match', reason: `"${fileName}" is not one of this project's media files.` }
  }
  const candidates = sameName.filter((clip) => !linked.has(clip.id))
  if (candidates.length === 0) {
    return { kind: 'no-match', reason: `"${fileName}" is already linked.` }
  }
  const match = candidates.find(
    (clip) =>
      clip.kind === probedKind &&
      durationsMatch(clip.duration, probedDuration) &&
      (clip.kind !== 'image' || imageContentMatches(clip, probedDimensions)),
  )
  if (match === undefined) {
    // Name the more surprising mismatch first: a kind clash means the wrong
    // sort of file altogether; duration/dimensions mean likely different
    // content under the same name.
    const kindClash = candidates.every((clip) => clip.kind !== probedKind)
    if (kindClash) {
      const kindArticle =
        probedKind === 'video' ? 'a video' : probedKind === 'audio' ? 'an audio' : 'an image'
      return {
        kind: 'no-match',
        reason: `"${fileName}" is ${kindArticle} file, but this project's clip of that name is ${candidates[0].kind}. It may be a different file.`,
      }
    }
    if (probedKind === 'image') {
      const stored = candidates.find((clip) => clip.kind === 'image') ?? candidates[0]
      const expected =
        stored.width !== undefined && stored.height !== undefined
          ? pixels(stored.width, stored.height)
          : 'different dimensions'
      const actual =
        probedDimensions === undefined
          ? 'unknown dimensions'
          : pixels(probedDimensions.width, probedDimensions.height)
      return {
        kind: 'no-match',
        reason: `"${fileName}" does not match this project's image of the same name: expected ${expected}, but the picked file is ${actual}. It may be a different file.`,
      }
    }
    return {
      kind: 'no-match',
      reason: `"${fileName}" does not match this project's clip of the same name: expected a duration of ${seconds(candidates[0].duration)}, but the picked file is ${seconds(probedDuration)}. It may be a different file.`,
    }
  }
  return { kind: 'matched', clipId: match.id }
}

/** A project restored to live editing state, ready to replace the app's. */
export interface RestoredProject {
  clips: LibraryClip[]
  timeline: TimelineState
}

/**
 * Joins a deserialized project with the re-linked media URLs into the state
 * the app edits. Requires every clip to be linked — callers gate on that —
 * and normalizes the timeline so `timeline-replaced` can store the returned
 * reference as-is. Entry URLs are reconstructed by joining on `clipId`
 * (deserialization already guarantees the join succeeds).
 */
export function restoreProject(project: Project, urls: ReadonlyMap<string, string>): RestoredProject {
  const urlOf = (clipId: string): string => {
    const url = urls.get(clipId)
    if (url === undefined) {
      throw new Error(`cannot restore: clip "${clipId}" has no re-linked media`)
    }
    return url
  }
  return {
    clips: project.clips.map(({ id, name, duration, kind, width, height }) => ({
      id,
      name,
      duration,
      kind,
      url: urlOf(id),
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height }),
    })),
    timeline: normalizedTimelineState(
      // A slate (#143) references no clip and has no media URL — the empty
      // string is its steady-state url, exactly as slateEntry creates it.
      project.timeline.entries.map((entry) => ({
        ...entry,
        url: entry.kind === 'slate' ? '' : urlOf(entry.clipId),
      })),
      project.timeline.transitions,
      project.timeline.zooms,
      project.timeline.audioTracks.map((track) => ({ ...track, url: urlOf(track.clipId) })),
      project.timeline.remaps ?? [],
    ),
  }
}

/**
 * Restores a project whose file embedded its media (#97): every clip's
 * bytes become a Blob-backed object URL, so the project opens fully linked
 * with no re-link step. Deserialization guarantees `media` covers every
 * clip; a gap here is programmer error and throws. The returned URLs are
 * owned by the caller — the app revokes them when the project is replaced,
 * exactly as it does for imported files. `createUrl` is injectable because
 * jsdom has no `URL.createObjectURL`.
 */
export function restoreEmbeddedProject(
  project: Project,
  media: ReadonlyMap<string, ClipMedia>,
  createUrl: (blob: Blob) => string = (blob) => URL.createObjectURL(blob),
): RestoredProject {
  const urls = new Map<string, string>()
  for (const clip of project.clips) {
    const clipMedia = media.get(clip.id)
    if (clipMedia === undefined) {
      throw new Error(`cannot restore: clip "${clip.id}" has no embedded media`)
    }
    urls.set(
      clip.id,
      createUrl(new Blob([clipMedia.bytes as BlobPart], { type: clipMedia.mimeType ?? '' })),
    )
  }
  return restoreProject(project, urls)
}
