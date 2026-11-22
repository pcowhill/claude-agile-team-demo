/**
 * Overlay Moves (#834, from the customer's approval of #829): an overlay,
 * video or image, glides from where it is to a new placement during the
 * video and stays there, without being split into two overlays that jump.
 *
 * A Move is a **start**, a **glide** length, and a **destination**
 * rectangle in the units of the overlay's own placement (fractions of the
 * frame). Before the first Move the overlay sits at its own placement; during
 * a glide it is eased between the placement it had and the Move's
 * destination; from the glide's end it holds the destination until the
 * next Move.
 *
 * **Time base.** `start` is seconds since the overlay **appears**, its
 * on-screen time measured from `offset`, not its source clock. Speed
 * segments and pauses (#700) change which source frame shows; they do not
 * change when the box moves, because placement belongs to the frame. (Zooms
 * differ: they magnify the picture, so they stay on the overlay's own clock,
 * #699.) The window a Move must lie in is therefore the overlay's on-screen
 * length, `overlayOutputDuration`.
 *
 * **Curve.** One symmetric ease-in-out, `smoothstep`, with no per-Move
 * picker: halfway through the glide in time is exactly halfway in position.
 */
import type { VideoOverlay } from './videoOverlay'
import { MAX_OVERLAY_SIZE, MIN_OVERLAY_SIZE, overlayOutputDuration } from './videoOverlay'

/** A placement rectangle in frame fractions, as an overlay's own `x`/`y`/`width`/`height`. */
export interface OverlayRect {
  x: number
  y: number
  width: number
  height: number
}

/** What a Move is, without its handle: when, how long, and where to. */
export interface OverlayMoveSpec extends OverlayRect {
  /** Seconds since the overlay appears (its on-screen time) that the glide begins. ≥ 0. */
  start: number
  /** How long the glide takes, in seconds. ≥ 0; 0 is a jump. */
  glide: number
}

/** One Move on an overlay (#834): a spec plus its handle. */
export interface OverlayMove extends OverlayMoveSpec {
  /** Unique within its overlay — what update and remove act on. */
  id: string
}

/** How long a Move added from + Effect ▾ glides, in seconds, when there is room. */
export const DEFAULT_MOVE_GLIDE = 1

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/**
 * A rectangle clamped exactly as an overlay's own placement is
 * (`clampVideoOverlay`): size first into its bounds, then position into what
 * the size leaves, so it lies wholly on the frame.
 */
export function clampOverlayRect(rect: OverlayRect): OverlayRect {
  const width = clamp(rect.width, MIN_OVERLAY_SIZE, MAX_OVERLAY_SIZE)
  const height = clamp(rect.height, MIN_OVERLAY_SIZE, MAX_OVERLAY_SIZE)
  return { x: clamp(rect.x, 0, 1 - width), y: clamp(rect.y, 0, 1 - height), width, height }
}

/** Whether a Move's fields are finite numbers: ranges clamp, they are not refused. */
export function isValidMoveSpec(spec: OverlayMoveSpec): boolean {
  return (
    Number.isFinite(spec.start) &&
    Number.isFinite(spec.glide) &&
    Number.isFinite(spec.x) &&
    Number.isFinite(spec.y) &&
    Number.isFinite(spec.width) &&
    Number.isFinite(spec.height)
  )
}

/** Whether two Moves' specs are the same (ids aside). */
export function moveSpecsEqual(a: OverlayMoveSpec, b: OverlayMoveSpec): boolean {
  return (
    a.start === b.start &&
    a.glide === b.glide &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height
  )
}

/**
 * An overlay's Moves normalized against its on-screen window of `length`
 * seconds: sorted by start (ties keep their stored order), each starting at
 * or after the previous one's glide ends, every glide inside `[0, length]`,
 * and every destination clamped as a placement is. The earlier Move wins an
 * overlap, and what no longer fits collapses against the window's end rather
 * than being dropped — the sweep zooms and remaps use (#129, #138).
 */
export function sweptMoves<T extends OverlayMove>(moves: readonly T[], length: number): T[] {
  const sorted = [...moves].sort((a, b) => a.start - b.start)
  const end = Math.max(0, length)
  let cursor = 0
  return sorted.map((move) => {
    const start = clamp(move.start, cursor, end)
    const glide = clamp(move.glide, 0, end - start)
    cursor = start + glide
    const rect = clampOverlayRect(move)
    if (
      start === move.start &&
      glide === move.glide &&
      rect.x === move.x &&
      rect.y === move.y &&
      rect.width === move.width &&
      rect.height === move.height
    ) {
      return move
    }
    return { ...move, start, glide, ...rect }
  })
}

/**
 * The overlay with its Moves normalized against its (already clamped)
 * on-screen window. The same object when nothing moved — including an
 * overlay with no Moves — so Move-free states keep every reference and
 * every saved byte.
 */
export function withOverlayMovesClamped(overlay: VideoOverlay): VideoOverlay {
  if (overlay.moves === undefined) return overlay
  if (overlay.moves.length === 0) {
    const next = { ...overlay }
    delete next.moves
    return next
  }
  const swept = sweptMoves(overlay.moves, overlayOutputDuration(overlay))
  const unchanged =
    swept.length === overlay.moves.length && swept.every((move, index) => move === overlay.moves?.[index])
  return unchanged ? overlay : { ...overlay, moves: swept }
}

/** The ease-in-out every glide follows: symmetric, so the midpoint is exactly halfway. */
export function moveEase(u: number): number {
  const t = clamp(u, 0, 1)
  return t * t * (3 - 2 * t)
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f

/**
 * Where the overlay is placed `t` seconds after it appears (#834): its own
 * placement before the first Move, an eased interpolation during a glide,
 * and the destination from a glide's end until the next Move. Moves must be
 * normalized (sorted, disjoint), as any published state's are. With no Moves
 * it is the overlay's own placement, read from the same four fields.
 */
export function overlayRectAt(
  overlay: OverlayRect & { moves?: readonly OverlayMove[] },
  t: number,
): OverlayRect {
  let from: OverlayRect = { x: overlay.x, y: overlay.y, width: overlay.width, height: overlay.height }
  for (const move of overlay.moves ?? []) {
    if (t < move.start) break
    const to: OverlayRect = { x: move.x, y: move.y, width: move.width, height: move.height }
    if (move.glide > 0 && t < move.start + move.glide) {
      const f = moveEase((t - move.start) / move.glide)
      return {
        x: lerp(from.x, to.x, f),
        y: lerp(from.y, to.y, f),
        width: lerp(from.width, to.width, f),
        height: lerp(from.height, to.height, f),
      }
    }
    from = to
  }
  return from
}

/**
 * The overlay as it is drawn at `sequenceTime`: its placement replaced by
 * `overlayRectAt` at its on-screen time. The same object for an overlay
 * with no Moves, so every Move-free draw is unchanged. Preview and export
 * both draw through this, so the two place a moving overlay identically.
 */
export function overlayPlacedAt<T extends Pick<VideoOverlay, 'offset' | 'x' | 'y' | 'width' | 'height' | 'moves'>>(
  overlay: T,
  sequenceTime: number,
): T {
  if (overlay.moves === undefined || overlay.moves.length === 0) return overlay
  return { ...overlay, ...overlayRectAt(overlay, sequenceTime - overlay.offset) }
}

/**
 * What + Effect ▾ › Move adds (#834): a glide of `DEFAULT_MOVE_GLIDE` (or
 * what room is left) starting where the overlay's last Move ends, whose
 * destination is the placement the overlay already has then — so adding one
 * changes nothing until it is edited. Null when the window has no room left.
 */
export function defaultMoveFor(
  overlay: Pick<VideoOverlay, 'x' | 'y' | 'width' | 'height' | 'moves' | 'inPoint' | 'outPoint' | 'remaps'>,
): OverlayMoveSpec | null {
  const length = overlayOutputDuration(overlay)
  const moves = overlay.moves ?? []
  const last = moves[moves.length - 1]
  const start = last === undefined ? 0 : last.start + last.glide
  const glide = Math.min(DEFAULT_MOVE_GLIDE, length - start)
  if (!(glide > 0)) return null
  return { start, glide, ...overlayRectAt(overlay, start) }
}

/**
 * An overlay's Moves divided at on-screen time `u` (#834), for every edit
 * that rebuilds an overlay as parts (Split…, Cut…, the ripple's shortening):
 *
 * - **`before`**: the Moves that end by `u`, unchanged. A Move whose glide
 *   contains `u` is cut there: it glides for `u − start` to the placement
 *   the overlay had at `u`.
 * - **`after`**, relative to `u`: the Moves that start at or after it,
 *   shifted earlier by `u`, and the rest of a cut glide from 0 to its own
 *   destination. **`afterRect`** is the placement at `u`: the later part's
 *   own `x`/`y`/`width`/`height`, so it starts exactly where the overlay was.
 *
 * Both parts pass through the same placements at the cut and reach the same
 * destinations. Inside a cut glide each part eases over its own length, so
 * the path between is the same line but not the same timing: a single
 * ease-in-out has no exact form for part of one, as a zoom's ramp has none
 * (`splitZoomAt`). Ids are unique within an overlay, so both parts keep
 * the original's.
 */
export function splitMovesAt<T extends OverlayMove>(
  overlay: Pick<VideoOverlay, 'x' | 'y' | 'width' | 'height'> & { moves?: readonly T[] },
  u: number,
): { before: T[]; after: T[]; afterRect: OverlayRect } {
  const before: T[] = []
  const after: T[] = []
  const moves = overlay.moves ?? []
  const atCut = overlayRectAt({ ...overlay, moves }, u)
  for (const move of moves) {
    const end = move.start + move.glide
    if (end <= u && move.start < u) before.push(move)
    else if (move.start >= u) after.push({ ...move, start: move.start - u })
    else {
      before.push({ ...move, glide: u - move.start, ...atCut })
      after.push({ ...move, start: 0, glide: end - u })
    }
  }
  return { before, after, afterRect: atCut }
}

/**
 * Which placement the Overlay visual editor edits (#835): the overlay's
 * own, or one Move's destination. `index` is the Move's place in the
 * normalized (time-ordered) list, so `index + 1` is the number its row shows.
 */
export type EditablePlacement = { kind: 'own' } | { kind: 'move'; index: number; id: string }

/**
 * The placement that holds at on-screen time `t` (#835), the one a drag in
 * the Overlay visual editor changes there: the overlay's own before its
 * first Move starts, and Move *k*'s destination from Move *k*'s start until
 * Move *k+1*'s, its glide included. Inside a glide that is where the
 * overlay is going, not where it is, since the destination is what a Move
 * stores. Moves must be normalized (sorted), as any published state's are;
 * of two Moves starting together the later one holds, since the earlier
 * one's span is empty.
 */
export function editablePlacementAt(
  overlay: { moves?: readonly OverlayMove[] },
  t: number,
): EditablePlacement {
  let editable: EditablePlacement = { kind: 'own' }
  for (const [index, move] of (overlay.moves ?? []).entries()) {
    if (t < move.start) break
    editable = { kind: 'move', index, id: move.id }
  }
  return editable
}

/** The rectangle an editable placement stores: the overlay's own, or that Move's destination. */
export function editablePlacementRect(
  overlay: OverlayRect & { moves?: readonly OverlayMove[] },
  editable: EditablePlacement,
): OverlayRect {
  const move = editable.kind === 'move' ? overlay.moves?.[editable.index] : undefined
  const source = move ?? overlay
  return { x: source.x, y: source.y, width: source.width, height: source.height }
}

/** The Overlay visual editor's "Editing: …" line for a placement (#835), in #829's words. */
export function editablePlacementLabel(editable: EditablePlacement): string {
  return editable.kind === 'own' ? 'Editing: starting placement' : `Editing: after Move ${editable.index + 1}`
}
