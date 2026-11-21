/**
 * Split… on a video overlay and an audio track (#826, the customer's request
 * on #731): one element becomes two at a source instant, each playing
 * exactly where the original did. The rule `entry-split` (#190) applies to a
 * sequence entry, carried to the two kinds placed in sequence time by their
 * own `offset`, which `entry-split` has no way to set.
 *
 * - **The first part** keeps the id, *Starts at* and In; its Out is the
 *   split point.
 * - **The second part** takes `newId`; its In is the split point, and it
 *   starts where the first part's window ends: the original's start plus
 *   the first part's output length, which for an overlay with speed
 *   segments or pauses (#700) is remapped time.
 * - **Every setting is copied to both**: volume, mute, duck and duck level
 *   on a track; placement, colour, orientation, crop, mask, border, shadow,
 *   volume and mute on an overlay. The spread carries them, as Duplicate's
 *   does (#314), so a setting added later is copied without being named.
 * - **Fades stay on the outer edges.** The first part keeps the fade-in and
 *   the second the fade-out, so the join plays on as the original did. A
 *   fade that runs across the split point cannot be divided (a fade always
 *   ramps from silence), so it is clamped to its own part by the reducer's
 *   normalization, as a retrim would clamp it, and ramps faster.
 * - **An overlay's effects** follow `entry-split`'s rules exactly: a speed
 *   segment containing the point becomes two with the same factor, a pause
 *   at the point stays with the first part, and a zoom moves or splits by
 *   `splitZoomAt` (one whose ramp contains the point stays whole with the
 *   first part, the razor's fallback). Redactions and spotlights are in the
 *   clip's own source seconds, so both parts keep every one; those outside
 *   a part's trim never show.
 *
 * An image overlay has no source to cut, so it is never split.
 */
import type { AudioTrack } from './timeline'
import type { OverlayRemap, VideoOverlay } from './videoOverlay'
import { isImageOverlay, overlayOutputDuration } from './videoOverlay'
import { splitZoomAt } from './ripple'

/**
 * Whether a track or overlay can split at `atSourceTime`: strictly inside
 * its trim, as `isSplittablePoint` is for an entry. On In or Out one part
 * would be empty, so there is nothing to split.
 */
export function canSplitElementAt(
  element: Pick<AudioTrack, 'inPoint' | 'outPoint'>,
  atSourceTime: number,
): boolean {
  return (
    Number.isFinite(atSourceTime) &&
    atSourceTime > element.inPoint &&
    atSourceTime < element.outPoint
  )
}

/** The element without the given optional key: zero is stored as no key. */
function without<T extends object>(element: T, key: keyof T): T {
  const next = { ...element }
  delete next[key]
  return next
}

/** An optional list, as no key at all when it came out empty. */
function withList<T extends object, K extends keyof T>(element: T, key: K, list: T[K] | undefined): T {
  const next = without(element, key)
  if (list === undefined || (Array.isArray(list) && list.length === 0)) return next
  return { ...next, [key]: list }
}

/** A track split in two at `atSourceTime`, or null where it cannot split. */
export function splitAudioTrack(
  track: AudioTrack,
  atSourceTime: number,
  newId: string,
): [AudioTrack, AudioTrack] | null {
  if (!canSplitElementAt(track, atSourceTime)) return null
  const firstLength = atSourceTime - track.inPoint
  const first = without({ ...track, outPoint: atSourceTime }, 'fadeOut')
  const second = without(
    { ...track, id: newId, inPoint: atSourceTime, offset: track.offset + firstLength },
    'fadeIn',
  )
  return [first, second]
}

/**
 * An overlay's speed segments and pauses split at `at` seconds into its
 * trimmed range, by `entry-split`'s remap rule. The second part's are
 * relative to `at`. Ids are unique within an overlay, so each part keeps
 * the original's.
 */
function splitOverlayRemaps(
  remaps: readonly OverlayRemap[],
  at: number,
): { before: OverlayRemap[]; after: OverlayRemap[] } {
  const before: OverlayRemap[] = []
  const after: OverlayRemap[] = []
  for (const remap of remaps) {
    if (remap.kind === 'pause') {
      if (remap.at <= at) before.push(remap)
      else after.push({ ...remap, at: remap.at - at })
      continue
    }
    if (remap.end <= at) before.push(remap)
    else if (remap.start >= at) after.push({ ...remap, start: remap.start - at, end: remap.end - at })
    else {
      before.push({ ...remap, end: at })
      after.push({ ...remap, start: 0, end: remap.end - at })
    }
  }
  return { before, after }
}

/** A video overlay split in two at `atSourceTime`, or null where it cannot split. */
export function splitVideoOverlay(
  overlay: VideoOverlay,
  atSourceTime: number,
  newId: string,
): [VideoOverlay, VideoOverlay] | null {
  if (isImageOverlay(overlay)) return null
  if (!canSplitElementAt(overlay, atSourceTime)) return null
  // Effect windows are seconds into the trimmed range: the cut in that space.
  const at = atSourceTime - overlay.inPoint
  const remaps =
    overlay.remaps === undefined ? undefined : splitOverlayRemaps(overlay.remaps, at)
  const zooms = overlay.zooms?.map((zoom) => splitZoomAt(zoom, at))
  let first: VideoOverlay = without({ ...overlay, outPoint: atSourceTime }, 'fadeOut')
  first = withList(first, 'remaps', remaps?.before)
  first = withList(
    first,
    'zooms',
    zooms?.flatMap(({ before }) => (before === null ? [] : [before])),
  )
  let second: VideoOverlay = without(
    {
      ...overlay,
      id: newId,
      inPoint: atSourceTime,
      offset: overlay.offset + overlayOutputDuration(first),
    },
    'fadeIn',
  )
  second = withList(second, 'remaps', remaps?.after)
  second = withList(
    second,
    'zooms',
    zooms?.flatMap(({ after }) => (after === null ? [] : [after])),
  )
  return [first, second]
}
