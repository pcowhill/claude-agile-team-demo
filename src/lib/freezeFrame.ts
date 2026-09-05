import type { SourceDimensions } from './frameSize'
import type { LibraryClip } from './mediaLibrary'
import { formatDuration } from './mediaLibrary'
import { locateInSequence, splitTargetAt } from './playback'
import type { TimelineState } from './timeline'

/**
 * Freeze frame (#379): hold the composed frame under the playhead as a still
 * on the timeline. The capture itself is Save frame's (#237) — the same
 * `snapshotTimelineFrame` composition through the export's draw path — but
 * the PNG stays in the app as a library image clip (#137) and lands on the
 * timeline as a still entry, instead of downloading. This module holds the
 * pure pieces: the clip the capture becomes, and the placement rule that
 * resolves a playhead position to where the still goes. The one-action
 * timeline change is `frame-frozen` (timeline.ts); the capture wiring lives
 * in PreviewPlayer/App.
 */

/**
 * How long a frozen frame holds by default, in seconds — the figure the
 * customer approved with the feature (#316/#379). Deliberately not the #286
 * still-duration setting: that setting is "how long an imported image
 * shows", while a freeze is a beat inside continuous motion, and 2 s is the
 * approved beat. Editable afterwards like any still (`still-duration-set`).
 */
export const FREEZE_STILL_DURATION = 2

/**
 * Display name for a frozen frame's library clip, from the sequence time it
 * was taken at — the approved example is `Freeze 0:12.png` (#316). Names are
 * labels, not identities: two freezes in the same second share a name the
 * way two imports of one file would, and each keeps its own id and media.
 */
export function freezeClipName(sequenceTime: number): string {
  return `Freeze ${formatDuration(Math.max(0, sequenceTime))}.png`
}

/**
 * The library clip a captured frame becomes: an ordinary image clip (#137)
 * holding the PNG under a fresh object URL, exactly as `extractAudioClip`
 * (#154) derives a clip from media already in the app. `frame` is the
 * dimensions the snapshot was composed at (the export's own output frame),
 * which is what an import would have probed from the PNG. The clip has no
 * file on disk — like a recording, it travels through embedded saves (#98),
 * whose bytes come straight from this URL.
 */
export function freezeFrameClip(
  blob: Blob,
  sequenceTime: number,
  id: string,
  frame: SourceDimensions,
): LibraryClip {
  return {
    id,
    name: freezeClipName(sequenceTime),
    duration: 0,
    url: URL.createObjectURL(blob),
    kind: 'image',
    width: frame.width,
    height: frame.height,
  }
}

/** The two placements offered in the UI (#316): the emphasis beat, and the end card. */
export type FreezePlacementMode = 'split' | 'append'

/**
 * Where a freeze's still goes, resolved from the playhead — the placement
 * half of the `frame-frozen` action (timeline.ts adds the split's fresh
 * entry id, which is the dispatcher's to supply like every id).
 */
export type FreezeTarget =
  | { kind: 'split'; entryId: string; atSourceTime: number }
  | { kind: 'before'; entryId: string }
  | { kind: 'after'; entryId: string }

/**
 * Resolves a playhead position and a placement mode to the freeze's target,
 * or null when there is nothing to freeze (an empty timeline — the exact
 * positions `snapshotTimelineFrame` has no frame for).
 *
 * 'append' is always "after the entry under the playhead": the end-card
 * placement, holding the frame after the current clip without cutting it.
 *
 * 'split' cuts where the razor would (`splitTargetAt`) and holds between
 * the halves. Where the razor cannot cut, the freeze still works, holding
 * the captured frame at the nearest boundary instead of refusing:
 *
 * - at an entry's first instant (a hard-cut boundary resolves here, and so
 *   does a pause plateau holding the first frame): the still goes *before*
 *   the entry — the frame shown is the entry's first, so hold-then-play is
 *   the order the preview shows;
 * - inside a transition overlap, or at the sequence's very end (the last
 *   entry's final instant): the still goes *after* the entry under the
 *   playhead. Mid-overlap that separates the two clips, so the transition
 *   on that boundary is dropped by normalization — the same rule every
 *   insert path follows (see `element-duplicated`); the frozen blend then
 *   stands where the dissolve was.
 */
export function freezeTargetAt(
  timeline: TimelineState,
  sequenceTime: number,
  mode: FreezePlacementMode,
): FreezeTarget | null {
  const location = locateInSequence(timeline, sequenceTime)
  if (location === null) return null
  if (mode === 'append') return { kind: 'after', entryId: location.entry.id }
  const split = splitTargetAt(timeline, sequenceTime)
  if (split !== null) {
    return { kind: 'split', entryId: split.entryId, atSourceTime: split.atSourceTime }
  }
  return location.transition === undefined && location.sourceTime <= location.entry.inPoint
    ? { kind: 'before', entryId: location.entry.id }
    : { kind: 'after', entryId: location.entry.id }
}
