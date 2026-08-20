import type { LibraryClip } from './mediaLibrary'
import type { Project, ProjectClip } from './projectFile'
import { normalizedTimelineState } from './timeline'
import type { TimelineState } from './timeline'

/**
 * Re-linking media when a project is opened (#77). Project files store clip
 * metadata, never the media itself (#75), so opening asks the user to
 * re-select the files and each picked file must be matched to a stored clip
 * before the project can be edited. Matching is by filename AND duration —
 * a file that merely shares the name of a project clip but carries different
 * content would silently break every trim and effect referencing it, so a
 * metadata mismatch is reported instead of accepted.
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

/**
 * Matches one picked file against the project's still-unlinked clips.
 * Filename first (several project clips may share a name — the first
 * unlinked one whose duration also matches wins), then duration; each
 * failure mode gets its own human-readable reason.
 */
export function matchFileToClip(
  clips: readonly ProjectClip[],
  linked: ReadonlySet<string>,
  fileName: string,
  probedDuration: number,
): MatchResult {
  const sameName = clips.filter((clip) => clip.name === fileName)
  if (sameName.length === 0) {
    return { kind: 'no-match', reason: `"${fileName}" is not one of this project's media files.` }
  }
  const candidates = sameName.filter((clip) => !linked.has(clip.id))
  if (candidates.length === 0) {
    return { kind: 'no-match', reason: `"${fileName}" is already linked.` }
  }
  const match = candidates.find((clip) => durationsMatch(clip.duration, probedDuration))
  if (match === undefined) {
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
    clips: project.clips.map(({ id, name, duration }) => ({
      id,
      name,
      duration,
      url: urlOf(id),
    })),
    timeline: normalizedTimelineState(
      project.timeline.entries.map((entry) => ({ ...entry, url: urlOf(entry.clipId) })),
      project.timeline.transitions,
      project.timeline.zooms,
    ),
  }
}
