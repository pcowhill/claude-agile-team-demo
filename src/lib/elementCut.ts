/**
 * Cut… on a video overlay and an audio track (#828, the customer's request
 * on #731): the part of the element between *Cut from* and *Cut to* is
 * removed, and the later part closes up behind the earlier. The sequence
 * entry's Cut… (#827) is Cut out marked range over sequence time, ripple
 * included; an overlay or a track is placed independently (#102, #145), so
 * cutting one moves **nothing else**.
 *
 * - **The head** keeps the id, *Starts at* and In; its Out is *Cut from*.
 * - **The tail** takes `newId`; its In is *Cut to*, and it starts where the
 *   head's window ends: the head's start plus its output length, which for
 *   an overlay with speed segments or pauses (#700) is remapped time. So
 *   the element plays on without a gap, shorter by the removed part's
 *   output length.
 * - **Every setting is copied to both**, by the spread, as Split… copies
 *   them (#826): a setting added later is copied without being named.
 * - **Fades stay on the outer edges**: the head keeps the fade-in, the tail
 *   the fade-out. The reducer's normalization clamps a fade longer than its
 *   part, as a retrim would.
 * - **An overlay's effects** are cut exactly as the sequence entry's Cut…
 *   cuts them, which is Cut out marked range's rule (#823): the clamps
 *   become output instants through the overlay's own speed segments and
 *   pauses, and `splitRemapsAtOutput` cuts there. So a pause on *Cut from*'s
 *   instant goes with the removed part, and one on *Cut to*'s instant stays,
 *   since the frame it holds is kept. A speed segment across a clamp is cut
 *   there. A zoom is split by `splitZoomAt` at each clamp; one whose ramp
 *   contains a clamp has no exact form there, so it is kept whole on the
 *   head's side, as the razor keeps it. Redactions and spotlights are in the
 *   clip's own source seconds, so both parts keep every one; those outside
 *   a part's trim never show.
 *
 * Refused (null) on the Cut window's own rule (`cutClampsRefusal`): a clamp
 * on In or Out, which is a trim, or the clamps inverted or equal. An image
 * overlay has no source to cut, so it is never cut.
 */
import type { AudioTrack } from './timeline'
import type { VideoOverlay } from './videoOverlay'
import { isImageOverlay, overlayOutputDuration } from './videoOverlay'
import { cutClampsRefusal } from './cutWindow'
import type { CutClamps } from './cutWindow'
import { outputTimeAtSource } from './remap'
import { splitRemapsAtOutput, splitZoomAt } from './ripple'

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

/** A track with the part between the clamps removed, or null where it cannot cut. */
export function cutAudioTrack(
  track: AudioTrack,
  clamps: CutClamps,
  newId: string,
): [AudioTrack, AudioTrack] | null {
  if (!Number.isFinite(clamps.from) || !Number.isFinite(clamps.to)) return null
  if (cutClampsRefusal(track, clamps) !== null) return null
  const head = without({ ...track, outPoint: clamps.from }, 'fadeOut')
  const tail = without(
    {
      ...track,
      id: newId,
      inPoint: clamps.to,
      offset: track.offset + (clamps.from - track.inPoint),
    },
    'fadeIn',
  )
  return [head, tail]
}

/** A video overlay with the part between the clamps removed, or null where it cannot cut. */
export function cutVideoOverlay(
  overlay: VideoOverlay,
  clamps: CutClamps,
  newId: string,
): [VideoOverlay, VideoOverlay] | null {
  if (isImageOverlay(overlay)) return null
  if (!Number.isFinite(clamps.from) || !Number.isFinite(clamps.to)) return null
  if (cutClampsRefusal(overlay, clamps) !== null) return null
  // Effect windows are seconds into the trimmed range: the clamps in that space.
  const trimmedLength = overlay.outPoint - overlay.inPoint
  const from = clamps.from - overlay.inPoint
  const to = clamps.to - overlay.inPoint
  const remaps = overlay.remaps ?? []
  // The clamps as output instants, as the entry's Cut… maps them (#827):
  // a paused instant is first shown where its plateau begins.
  const headRemaps =
    remaps.length === 0
      ? []
      : splitRemapsAtOutput(trimmedLength, remaps, outputTimeAtSource(trimmedLength, remaps, from))
          .before
  const tailRemaps =
    remaps.length === 0
      ? []
      : splitRemapsAtOutput(trimmedLength, remaps, outputTimeAtSource(trimmedLength, remaps, to)).after
  const zooms = overlay.zooms ?? []
  let head: VideoOverlay = without({ ...overlay, outPoint: clamps.from }, 'fadeOut')
  head = withList(head, 'remaps', headRemaps)
  head = withList(
    head,
    'zooms',
    zooms.flatMap((zoom) => {
      const { before } = splitZoomAt(zoom, from)
      return before === null ? [] : [before]
    }),
  )
  let tail: VideoOverlay = without(
    {
      ...overlay,
      id: newId,
      inPoint: clamps.to,
      offset: overlay.offset + overlayOutputDuration(head),
    },
    'fadeIn',
  )
  tail = withList(tail, 'remaps', tailRemaps)
  tail = withList(
    tail,
    'zooms',
    zooms.flatMap((zoom) => {
      const { after } = splitZoomAt(zoom, to)
      return after === null ? [] : [after]
    }),
  )
  return [head, tail]
}
