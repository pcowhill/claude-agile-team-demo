import { MIN_KEPT_FRACTION } from './crop'
import type { Crop } from './crop'
import { textCanvasFont } from './exportVideo'
import type { Orientation } from './orientation'
import { sequenceTimeAt } from './playback'
import { MAX_TEXT_SIZE, MIN_TEXT_SIZE, TEXT_LINE_HEIGHT } from './textOverlay'
import type { TextOverlay } from './textOverlay'
import { totalDuration, videoOverlaysOf, zoomsOf, zoomWindowDuration } from './timeline'
import type { TimelineEntry, TimelineState, ZoomSpec } from './timeline'
import type { VideoOverlay } from './videoOverlay'
import { zoomRampFraction, zoomStateAt } from './zoom'

/**
 * Geometry for the visual editors (#413, from the graphic-tools design #402
 * / #396): the pure rules that turn a pointer gesture on a picture of the
 * frame into the numbers the reducer already takes. Nothing here touches
 * state; the component (`FrameEditor`) measures pointers and draws handles,
 * this module says what the drag means.
 *
 * Coordinates are **frame fractions** throughout — x and y in [0, 1] across
 * the output frame — so nothing depends on how large the editor happens to
 * draw the frame.
 */

/** A rectangle on the frame, as fractions of its width and height. */
export interface FrameRect {
  x: number
  y: number
  width: number
  height: number
}

export type Corner = 'nw' | 'ne' | 'sw' | 'se'

/**
 * A single edge of a rectangle (#422): the handles of a model where one
 * dimension changes and the other is left exactly as it was. A zoom's region
 * is aspect-locked, so it offers corners only and never sees one of these.
 */
export type Edge = 'n' | 'e' | 's' | 'w'

/** Any resize handle: a corner (both axes at once) or an edge (one). */
export type RectHandle = Corner | Edge

/**
 * What a pointer did to a rectangle, relative to the rectangle at the start
 * of the gesture: a move by an offset, or a handle dragged to a point.
 * `altKey` and `shiftKey` are the raw modifiers rather than an
 * interpretation of them — the component reports what the pointer did, and
 * each handle model decides what they mean for it (#421: the zoom's model
 * bypasses snapping with Alt; #422: the free rectangle locks its aspect
 * with Shift).
 */
export type RectGesture =
  | { kind: 'move'; dx: number; dy: number; altKey?: boolean; shiftKey?: boolean }
  | {
      kind: 'corner'
      corner: Corner
      x: number
      y: number
      altKey?: boolean
      shiftKey?: boolean
    }
  | { kind: 'edge'; edge: Edge; x: number; y: number; altKey?: boolean; shiftKey?: boolean }

/**
 * What one key press means for the rectangle (#421). Separate from
 * `RectGesture` because a pointer cannot express a scale step and a key
 * cannot express a corner: the two input languages differ, and collapsing
 * them would leave each handle model with cases it can never receive.
 */
export type RectKeyStep =
  | { kind: 'move'; dx: number; dy: number }
  | { kind: 'scale'; delta: number }

/**
 * The editor never proposes a scale the reducer would reject (`scale > 1`,
 * `isValidZoomSpec`), so a corner dragged out to the frame lands on this
 * floor instead of on a rejected no-op — the drag is clamped before it is
 * dispatched, as #402's design asked. The ceiling matches the row's number
 * field (`max={10}`).
 */
export const MIN_EDITOR_ZOOM_SCALE = 1.05
export const MAX_EDITOR_ZOOM_SCALE = 10

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)
const round = (value: number, decimals: number) => {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/**
 * The centre the reducer would keep for this scale (`clampZoom`): the zoomed
 * region extends 1 / (2·scale) from its centre on each axis, so the centre
 * stays that far inside the frame.
 */
function clampedCenter(scale: number, centerX: number, centerY: number) {
  const half = 1 / (2 * scale)
  return {
    centerX: round(clamp(centerX, half, 1 - half), 3),
    centerY: round(clamp(centerY, half, 1 - half), 3),
  }
}

/**
 * The region a zoom shows, on the unzoomed frame. Both dimensions are
 * 1 / scale of the frame's, so the rectangle has the frame's aspect by
 * construction — a zoom cannot distort (#63).
 */
export function zoomRect(zoom: Pick<ZoomSpec, 'scale' | 'centerX' | 'centerY'>): FrameRect {
  const size = 1 / zoom.scale
  return {
    x: zoom.centerX - size / 2,
    y: zoom.centerY - size / 2,
    width: size,
    height: size,
  }
}

/** The inverse of `zoomRect`, for a rectangle the editor has moved or resized. */
export function zoomFromRect(rect: FrameRect): Pick<ZoomSpec, 'scale' | 'centerX' | 'centerY'> {
  const scale = clamp(round(1 / rect.width, 2), MIN_EDITOR_ZOOM_SCALE, MAX_EDITOR_ZOOM_SCALE)
  return { scale, ...clampedCenter(scale, rect.x + rect.width / 2, rect.y + rect.height / 2) }
}

/** The zoom moved by a fraction of the frame, its region kept inside it. */
export function movedZoom(zoom: ZoomSpec, dx: number, dy: number): ZoomSpec {
  return { ...zoom, ...clampedCenter(zoom.scale, zoom.centerX + dx, zoom.centerY + dy) }
}

/**
 * The zoom resized from a corner dragged to `pointer`, about its centre: the
 * region's half-size becomes the pointer's larger distance from the centre
 * (the aspect is locked, so one distance decides both), and the scale is
 * clamped to the editor's range. Centre-fixed rather than opposite-corner
 * fixed because the centre is what the other handle model (moving) edits,
 * so the two gestures never fight; the centre is then re-clamped in case
 * the smaller scale no longer fits where it sits.
 */
export function resizedZoom(zoom: ZoomSpec, pointer: { x: number; y: number }): ZoomSpec {
  const half = Math.max(Math.abs(pointer.x - zoom.centerX), Math.abs(pointer.y - zoom.centerY))
  const scale = clamp(
    round(1 / (2 * Math.max(half, 1e-6)), 2),
    MIN_EDITOR_ZOOM_SCALE,
    MAX_EDITOR_ZOOM_SCALE,
  )
  return { ...zoom, scale, ...clampedCenter(scale, zoom.centerX, zoom.centerY) }
}

/**
 * Where a dragged centre is pulled to (#421): the frame centre and the two
 * thirds, on each axis independently — the alignments a viewer notices, and
 * the ones the rule-of-thirds framing a zoom is usually reaching for.
 */
export const ZOOM_SNAP_TARGETS: readonly number[] = [1 / 3, 0.5, 2 / 3]

/**
 * How near the centre must come, as a fraction of the frame. Two percent is
 * about 9 px on the editor's frame, which is 28 rem wide at most — close
 * enough that a deliberate placement a few pixels off a guide is left
 * alone, wide enough that reaching a guide does not take precision. Alt
 * bypasses it entirely.
 */
export const ZOOM_SNAP_TOLERANCE = 0.02

/**
 * The nearest snap target within tolerance, or null. The reach is widened
 * by a float's worth so that a centre exactly `ZOOM_SNAP_TOLERANCE` away
 * snaps: `0.5 + 0.02` is 0.020000000000000018 from 0.5 in binary floating
 * point, and a tolerance that silently excludes its own boundary is a
 * tolerance nobody can reason about.
 */
function snapTarget(value: number): number | null {
  let best: number | null = null
  let bestDistance = ZOOM_SNAP_TOLERANCE + 1e-9
  for (const target of ZOOM_SNAP_TARGETS) {
    const distance = Math.abs(value - target)
    // `<=` never fires before `<` for a nearer target, so ties keep the
    // first listed — the thirds and the centre are 1/6 apart, so this is
    // theoretical, but it makes the function total rather than order-shy.
    if (distance <= bestDistance) {
      best = target
      bestDistance = distance
    }
  }
  return best
}

/**
 * The zoom with its centre pulled onto any guide it came near (#421), then
 * re-clamped: a guide the region cannot reach at this scale (1/3 is outside
 * the allowed range once the region is wider than two thirds of the frame)
 * is snapped to and then clamped straight back off, which is why
 * `zoomGuides` below reads the *result* rather than trusting the intent.
 */
export function snappedZoom(zoom: ZoomSpec): ZoomSpec {
  const centerX = snapTarget(zoom.centerX) ?? zoom.centerX
  const centerY = snapTarget(zoom.centerY) ?? zoom.centerY
  return { ...zoom, ...clampedCenter(zoom.scale, centerX, centerY) }
}

/**
 * Which guides the centre is sitting on — what the editor draws while a
 * drag is in progress. Read from the centre itself rather than remembered
 * from the snap that produced it, so a guide can never be drawn where the
 * region is not (see `snappedZoom`), and a centre typed into the row's
 * fields lights the same guide a dragged one does.
 */
export function zoomGuides(zoom: Pick<ZoomSpec, 'centerX' | 'centerY'>): {
  x: number | null
  y: number | null
} {
  const onTarget = (value: number) =>
    ZOOM_SNAP_TARGETS.find((target) => round(target, 3) === round(value, 3)) ?? null
  return { x: onTarget(zoom.centerX), y: onTarget(zoom.centerY) }
}

/**
 * The zoom after a gesture that began with the zoom at `start`. A move
 * snaps unless Alt bypasses it (#421, the convention #391 set for the
 * playhead); a corner drag does not, because it holds the centre fixed by
 * construction — snapping there would only fire on the re-clamp a shrinking
 * region forces, which is not something the user aimed at.
 */
export function zoomAfterGesture(start: ZoomSpec, gesture: RectGesture): ZoomSpec {
  // Every resize is one gesture for a zoom, whichever handle was pulled: its
  // region is aspect-locked and centre-fixed, so a corner and an edge would
  // do the same thing. The component offers a zoom only corners (#422's
  // `handles`), so `edge` does not arrive today — but `resizedZoom` is total
  // over both rather than leaving a case for a later editor to trip over.
  if (gesture.kind !== 'move') return resizedZoom(start, gesture)
  const moved = movedZoom(start, gesture.dx, gesture.dy)
  return gesture.altKey === true ? moved : snappedZoom(moved)
}

/** How far one arrow key moves the centre, as a fraction of the frame (#421). */
export const ZOOM_NUDGE = 0.01
/** …and with Shift held. */
export const ZOOM_NUDGE_LARGE = 0.05
/** How much one `+` / `−` press changes the magnification (#421). */
export const ZOOM_SCALE_STEP = 0.1

/**
 * What a key press means for the region, or null for keys the editor does
 * not take — so the component can leave those to the browser rather than
 * swallowing every key that reaches a focused rectangle.
 *
 * `+` arrives as `'+'` on a shifted `=` and as `'Add'`/`'+'` on a numeric
 * keypad; `=` is accepted unshifted for the same reason browsers do, and
 * both `-` and `_` decrease. Snapping does not apply: a nudge is already a
 * deliberate 1 % step, and pulling it onto a guide would make the step size
 * a lie.
 */
export function rectKeyStep(event: {
  key: string
  shiftKey?: boolean
}): RectKeyStep | null {
  const step = event.shiftKey === true ? ZOOM_NUDGE_LARGE : ZOOM_NUDGE
  switch (event.key) {
    case 'ArrowLeft':
      return { kind: 'move', dx: -step, dy: 0 }
    case 'ArrowRight':
      return { kind: 'move', dx: step, dy: 0 }
    case 'ArrowUp':
      return { kind: 'move', dx: 0, dy: -step }
    case 'ArrowDown':
      return { kind: 'move', dx: 0, dy: step }
    case '+':
    case '=':
    case 'Add':
      return { kind: 'scale', delta: ZOOM_SCALE_STEP }
    case '-':
    case '_':
    case 'Subtract':
      return { kind: 'scale', delta: -ZOOM_SCALE_STEP }
    default:
      return null
  }
}

/**
 * The zoom with its magnification stepped by `delta`, clamped to the range a
 * drag is clamped to — the reducer rejects `scale <= 1`, so a key press must
 * not be able to propose one — and its centre re-clamped, because a region
 * that just grew may no longer fit where it sits.
 */
export function scaledZoom(zoom: ZoomSpec, delta: number): ZoomSpec {
  const scale = clamp(
    round(zoom.scale + delta, 2),
    MIN_EDITOR_ZOOM_SCALE,
    MAX_EDITOR_ZOOM_SCALE,
  )
  return { ...zoom, scale, ...clampedCenter(scale, zoom.centerX, zoom.centerY) }
}

/** The zoom after one key press, from the same starting spec a drag uses. */
export function zoomAfterKeyStep(start: ZoomSpec, step: RectKeyStep): ZoomSpec {
  return step.kind === 'move'
    ? movedZoom(start, step.dx, step.dy)
    : scaledZoom(start, step.delta)
}

/** Seconds into the entry where the zoom holds at full — the still the editor shows (#402 D2-a). */
export function zoomHoldMidpoint(zoom: ZoomSpec): number {
  return zoom.start + zoom.rampIn + zoom.hold / 2
}

/**
 * The sequence time of an instant of the zoom on `entries[entryIndex]` — the
 * instant `snapshotTimelineFrame` renders for the editor. `entryOffset` is
 * seconds into the entry's trimmed range, the clock `zoom.start` and
 * `zoomHoldMidpoint` are already in; source time is the entry's in-point
 * plus that (the convention `zoomAt` reads), mapped through the remap-aware
 * sequence clock. Defaults to the hold midpoint, which is where the editor
 * opens (#413) and where its scrub slider starts (#421).
 */
export function zoomEditorSequenceTime(
  state: TimelineState,
  entryIndex: number,
  zoom: ZoomSpec,
  entryOffset: number = zoomHoldMidpoint(zoom),
): number {
  const entry = state.entries[entryIndex]
  return sequenceTimeAt(state, entryIndex, entry.inPoint + entryOffset)
}

/**
 * The span the scrub slider covers (#421): the zoom's whole envelope, in
 * seconds into the entry — from where it begins to where it has finished
 * ramping out, so scrubbing shows the motion from identity to identity.
 */
export function zoomEnvelope(zoom: ZoomSpec): { start: number; end: number } {
  return { start: zoom.start, end: zoom.start + zoomWindowDuration(zoom) }
}

/**
 * How finely the scrub slider steps, in seconds (#421). Coarse enough that
 * one envelope asks for a bounded number of stills — the default 2 s window
 * is 40 stops — and fine enough that a half-second ramp has ten of them.
 */
export const ZOOM_SCRUB_STEP = 0.05

/**
 * The region the zoom occupies at `entryOffset` seconds into the entry
 * (#421): the full region across the hold, a partial one part-way through a
 * ramp, and the whole frame at either end. Built on `zoomStateAt`, which is
 * the same easing the preview and the export run, so the rectangle cannot
 * disagree with what playing the zoom would show.
 */
export function zoomRectAt(zoom: ZoomSpec, entryOffset: number): FrameRect {
  return zoomRect(zoomStateAt(zoom, entryOffset - zoom.start))
}

/**
 * Whether the zoom is at full magnification at `entryOffset` — true across
 * the hold, false anywhere in a ramp. The editor's handles only appear here:
 * the drawn rectangle is the zoom's region *at that instant*, and a drag on
 * a part-way region has no single stored spec it could mean, so rather than
 * invent one the editor shows the motion read-only and hands the handles
 * back at the hold (#421; #402's design edits the full zoom).
 */
export function zoomIsFullAt(zoom: ZoomSpec, entryOffset: number): boolean {
  return zoomRampFraction(zoom, entryOffset - zoom.start) === 1
}

/**
 * ── The free rectangle (#422, from #402's design D4) ──────────────────────
 *
 * An overlay's placement is a rectangle in frame fractions with no aspect
 * lock (`src/lib/videoOverlay.ts`), so it needs a different handle model
 * from the zoom's: it moves, and it resizes from a corner (both axes) or an
 * edge (one), each holding the *opposite* edge fixed rather than the centre.
 * That is the difference the two models exist to express — a zoom edits one
 * region whose shape is forced, an overlay edits a box.
 *
 * The functions below are deliberately free of overlay vocabulary so #423's
 * crop and #424's text block can reuse them: they speak of a `FrameRect` and
 * the `RectBounds` it must stay inside.
 */

/**
 * Every handle a free rectangle offers (#422): the four corners, which move
 * both axes, and the four edges, which move one. Exported as the set rather
 * than assembled at each call site so the editors and their tests agree
 * about what "a free rectangle" means.
 */
export const FREE_RECT_HANDLES: readonly RectHandle[] = [
  'nw',
  'ne',
  'sw',
  'se',
  'n',
  'e',
  's',
  'w',
]

/** The size range a free rectangle is held inside, as fractions of the frame. */
export interface RectBounds {
  /** Smallest allowed width and height — an overlay's `MIN_OVERLAY_SIZE`. */
  minSize: number
  /** Largest allowed width and height. */
  maxSize: number
  /**
   * How many decimals the rectangle is stored to; absent means
   * `RECT_DECIMALS`. Precision belongs here with the size range for the
   * reason `RECT_DECIMALS` gives: it is a property of what the rectangle
   * *is*, not of the gesture that moved it, and every function that clamps
   * one already takes these bounds. A placement is kept to a hundredth
   * because its number field shows a fraction; a crop's field shows a
   * **percent** of the same fraction (#423), so it can express two digits
   * more — which is what lets the crop editor offer a coarse whole-percent
   * snap and an Alt-held fine mode without either putting a value in the
   * model that its own mirror cannot hold.
   */
  decimals?: number
}

/**
 * The rectangle a placement occupies. Trivial, and named so the editors read
 * the same way the zoom's `zoomRect` does rather than inlining field picks.
 */
export function overlayRect(
  placement: Pick<VideoOverlay, 'x' | 'y' | 'width' | 'height'>,
): FrameRect {
  const { x, y, width, height } = placement
  return { x, y, width, height }
}

/**
 * How precisely a placement is stored: to a hundredth of the frame, which is
 * exactly what the row's number fields can express (`formatSeconds` in
 * `Timeline.tsx` shows at most two decimals) and exactly one arrow-key nudge
 * (`ZOOM_NUDGE`).
 *
 * This matters rather than being a detail. The drag and the four number
 * fields are two halves of one control — the issue's "the fields mirror the
 * drag live" — so a drag that stored a third decimal would put a value in
 * the model that its own mirror cannot hold, and the next commit from that
 * field would silently rewrite it. Two decimals makes the two exactly
 * interchangeable.
 */
const RECT_DECIMALS = 2

/**
 * The most a stored placement can differ from the value that produced it —
 * half of `RECT_DECIMALS`'s last digit, widened by a float's worth for the
 * reason `ZOOM_SNAP_TOLERANCE` is.
 *
 * It exists because a rectangle whose size is an odd number of hundredths
 * cannot have its centre on an alignment exactly: a 0.35-wide box centred on
 * 0.5 needs `x = 0.325`, which stores as 0.33 and leaves the centre at
 * 0.505. Snapping to the frame's own borders *is* exact (0 and 1 are
 * representable at any precision); snapping a centre is exact only to this,
 * so a guide is drawn when the centre is this close and not only when it is
 * equal — otherwise a snap the user can see would light no guide at all.
 */
const RECT_EPSILON = 0.5 * 10 ** -RECT_DECIMALS + 1e-9

/**
 * The rectangle the reducer would keep: size into its bounds first, then
 * position into what the size leaves — the order `clampVideoOverlay` uses,
 * so the editor never proposes a placement the model would move underneath
 * it. Rounded at the same time, and the position is clamped *against the
 * rounded size*, so rounding cannot push a flush rectangle a hair off the
 * frame and make the reducer clamp it back.
 */
export function clampedRect(rect: FrameRect, bounds: RectBounds): FrameRect {
  const decimals = bounds.decimals ?? RECT_DECIMALS
  const width = round(clamp(rect.width, bounds.minSize, bounds.maxSize), decimals)
  const height = round(clamp(rect.height, bounds.minSize, bounds.maxSize), decimals)
  return {
    x: round(clamp(rect.x, 0, 1 - width), decimals),
    y: round(clamp(rect.y, 0, 1 - height), decimals),
    width,
    height,
  }
}

/** The rectangle moved by a fraction of the frame, kept fully on it. */
export function movedRect(
  start: FrameRect,
  dx: number,
  dy: number,
  bounds: RectBounds,
): FrameRect {
  return clampedRect({ ...start, x: start.x + dx, y: start.y + dy }, bounds)
}

/**
 * The rectangle after a handle was dragged to `pointer`, with the opposite
 * edge held fixed — the conventional free-rectangle resize, and the reason
 * an edge drag can change one dimension and leave the other untouched
 * (which centre-fixed resizing cannot express).
 *
 * `lockRatio` is a width ÷ height in *frame fractions*; when given, the
 * dragged corner keeps it. **Width drives**, deliberately: "whichever axis
 * moved further" makes a slow diagonal drag flip between axes mid-gesture.
 * Where the ratio and the frame genuinely conflict the frame wins — a
 * rectangle off the frame is not a placement — but the fit below shrinks
 * about the fixed corner first, so that only happens for a ratio no size in
 * `bounds` can satisfy.
 */
export function resizedRect(
  start: FrameRect,
  handle: RectHandle,
  pointer: { x: number; y: number },
  bounds: RectBounds,
  lockRatio?: number,
): FrameRect {
  const pullsWest = handle.includes('w')
  const pullsEast = handle.includes('e')
  const pullsNorth = handle.includes('n')
  const pullsSouth = handle.includes('s')

  // The edge the drag does not move; the new size is measured from it.
  const anchorX = pullsWest ? start.x + start.width : start.x
  const anchorY = pullsNorth ? start.y + start.height : start.y
  // How much frame there is between that edge and the border it grows toward.
  const roomX = pullsWest ? anchorX : 1 - anchorX
  const roomY = pullsNorth ? anchorY : 1 - anchorY

  const sizeFrom = (
    pulls: boolean,
    anchor: number,
    towardsOrigin: boolean,
    reach: number,
    room: number,
    fallback: number,
  ) => {
    if (!pulls) return fallback
    const raw = towardsOrigin ? anchor - reach : reach - anchor
    return clamp(raw, bounds.minSize, Math.min(bounds.maxSize, room))
  }

  let width = sizeFrom(
    pullsWest || pullsEast,
    anchorX,
    pullsWest,
    pointer.x,
    roomX,
    start.width,
  )
  let height = sizeFrom(
    pullsNorth || pullsSouth,
    anchorY,
    pullsNorth,
    pointer.y,
    roomY,
    start.height,
  )

  // A non-finite ratio is unreachable — `clampedRect` and the reducer both
  // hold a height at `minSize`, so no caller can divide by zero — but the
  // guard costs a clause and an Infinity here would silently collapse the
  // other axis to the floor rather than failing.
  if (
    lockRatio !== undefined &&
    Number.isFinite(lockRatio) &&
    lockRatio > 0 &&
    (pullsWest || pullsEast)
  ) {
    // The largest ratio-preserving width that fits both axes' room, then the
    // height it forces. `Math.max` against `minSize` keeps a cap smaller than
    // the floor from proposing a negative size; `clampedRect` is the backstop
    // for the case where no size satisfies both.
    const cap = Math.min(bounds.maxSize, roomX, Math.min(bounds.maxSize, roomY) * lockRatio)
    width = clamp(width, bounds.minSize, Math.max(bounds.minSize, cap))
    height = width / lockRatio
  }

  return clampedRect(
    {
      x: pullsWest ? anchorX - width : anchorX,
      y: pullsNorth ? anchorY - height : anchorY,
      width,
      height,
    },
    bounds,
  )
}

/**
 * The alignments a moved rectangle's *centre* is pulled onto, beside the
 * frame's own borders — deliberately
 * the zoom's own targets (`ZOOM_SNAP_TARGETS`), so the two editors agree
 * about where the interesting places in a frame are, and one list changes
 * both.
 */
export const RECT_SNAP_CENTRES: readonly number[] = ZOOM_SNAP_TARGETS

/**
 * How far one axis of a moved rectangle should be nudged to land on the
 * nearest alignment within `ZOOM_SNAP_TOLERANCE`, or 0 when nothing is near.
 * Three kinds of alignment compete on equal terms — the near edge flush to
 * the frame, the far edge flush to it, and the centre on a third or the
 * middle — and the nearest wins, so a small rectangle in a corner snaps to
 * the corner rather than being dragged to the centre line.
 *
 * The reach is widened by a float's worth for the reason `snapTarget` above
 * is: a tolerance that excludes its own boundary is one nobody can reason
 * about. Strict `<` keeps the first-listed alignment on an exact tie.
 */
function rectSnapOffset(low: number, size: number): number {
  const high = low + size
  const centre = low + size / 2
  let best = 0
  let bestDistance = ZOOM_SNAP_TOLERANCE + 1e-9
  const consider = (delta: number) => {
    const distance = Math.abs(delta)
    if (distance < bestDistance) {
      best = delta
      bestDistance = distance
    }
  }
  // The frame's own two borders — not a tunable list: 0 and 1 are what
  // "flush to the frame" means. An overlay is more often parked in a corner
  // than placed in the middle, and flush is a value nobody hits by hand.
  consider(0 - low)
  consider(1 - high)
  for (const target of RECT_SNAP_CENTRES) consider(target - centre)
  return best
}

/** The rectangle with each axis pulled onto any alignment it came near. */
export function snappedRect(rect: FrameRect, bounds: RectBounds): FrameRect {
  return clampedRect(
    {
      ...rect,
      x: rect.x + rectSnapOffset(rect.x, rect.width),
      y: rect.y + rectSnapOffset(rect.y, rect.height),
    },
    bounds,
  )
}

/**
 * Which alignments the rectangle is sitting on — what the editor draws while
 * a drag is in progress. Read from the rectangle itself rather than
 * remembered from the snap that produced it, exactly as `zoomGuides` is and
 * for the same reason: a rectangle the clamp moved back must not still show
 * the guide it was aimed at, and a placement *typed* into the row's fields
 * lights the same guide a dragged one does.
 *
 * An edge flush to the frame wins over a centre alignment, since a
 * full-frame rectangle satisfies both and the flush edge is the one the
 * drag was reaching for.
 */
export function rectGuides(rect: FrameRect): { x: number | null; y: number | null } {
  // Compared to within the precision a placement is *stored* at, not exactly
  // (see `RECT_EPSILON`): a centre snapped onto a third stores 0.33 and onto
  // the middle can store 0.505, and an equality test would drop the guide
  // the snap just earned. Each alignment still has exactly one storable
  // value this close to it, so no guide is ever drawn for a near miss.
  const on = (a: number, b: number) => Math.abs(a - b) <= RECT_EPSILON
  const axis = (low: number, size: number): number | null => {
    if (on(low, 0)) return 0
    if (on(low + size, 1)) return 1
    const centre = low + size / 2
    return RECT_SNAP_CENTRES.find((target) => on(target, centre)) ?? null
  }
  return { x: axis(rect.x, rect.width), y: axis(rect.y, rect.height) }
}

/**
 * The rectangle after a pointer gesture. A move snaps unless Alt bypasses it
 * (#391's convention, as the zoom's model follows). A resize does not snap:
 * dragging a handle past the border already lands it flush, because the
 * clamp is the frame — so a snap there would only fight the clamp.
 *
 * Shift locks the aspect on a **corner** drag only. On an edge drag it is
 * ignored on purpose: an edge handle's whole meaning is "change this one
 * dimension", and a modifier that made it change both would contradict the
 * handle the user chose.
 */
export function rectAfterGesture(
  start: FrameRect,
  gesture: RectGesture,
  bounds: RectBounds,
  lockRatio?: number,
): FrameRect {
  if (gesture.kind === 'move') {
    const moved = movedRect(start, gesture.dx, gesture.dy, bounds)
    return gesture.altKey === true ? moved : snappedRect(moved, bounds)
  }
  if (gesture.kind === 'edge') {
    return resizedRect(start, gesture.edge, gesture, bounds)
  }
  const locked = gesture.shiftKey === true ? lockRatio : undefined
  return resizedRect(start, gesture.corner, gesture, bounds, locked)
}

/**
 * How much one `+` / `−` press changes a free rectangle's width, as a
 * fraction of the frame (#422). Additive rather than the zoom's
 * multiplicative magnification, so `+` and `−` are exact inverses and a
 * press is the same size wherever the rectangle already is.
 */
export const RECT_SIZE_STEP = 0.02

/**
 * The rectangle after one key press: an arrow nudges it by the same fraction
 * the zoom's does, and `+` / `−` grow or shrink it **about its centre**,
 * keeping the proportions it currently has — the sign of the zoom's scale
 * step, not its magnitude (see `RECT_SIZE_STEP`). Growing an overlay on `+`
 * is the opposite of what `+` does to a zoom's region, and is the right way
 * round in both cases: the key makes the thing being edited bigger.
 */
export function rectAfterKeyStep(
  start: FrameRect,
  step: RectKeyStep,
  bounds: RectBounds,
): FrameRect {
  if (step.kind === 'move') return movedRect(start, step.dx, step.dy, bounds)
  const width = start.width + (step.delta > 0 ? RECT_SIZE_STEP : -RECT_SIZE_STEP)
  const height = start.height === 0 ? 0 : width * (start.height / start.width)
  return clampedRect(
    {
      x: start.x + (start.width - width) / 2,
      y: start.y + (start.height - height) / 2,
      width,
      height,
    },
    bounds,
  )
}

/**
 * The sequence time the overlay editor draws (#422): the middle of the
 * overlay's own window, so the still shows the frame the overlay is actually
 * over rather than whatever is at the sequence's start. Clamped into the
 * sequence, because an overlay's window may run past the end (the
 * allowed-tail rule, `videoOverlay.ts`) and there is no frame out there.
 */
export function overlayEditorSequenceTime(
  state: TimelineState,
  overlay: Pick<VideoOverlay, 'offset' | 'inPoint' | 'outPoint'>,
): number {
  const middle = overlay.offset + (overlay.outPoint - overlay.inPoint) / 2
  return clamp(middle, 0, Math.max(0, totalDuration(state)))
}

/**
 * The timeline with one overlay left out, for the editor's snapshot: the
 * rectangle is drawn on the frame *without* this overlay, so it shows where
 * the overlay will sit rather than covering the picture it is being placed
 * against. Same reference when the id is unknown — `withoutZoom`'s rule.
 */
export function withoutOverlay(state: TimelineState, overlayId: string): TimelineState {
  const overlays = videoOverlaysOf(state)
  if (!overlays.some((overlay) => overlay.id === overlayId)) return state
  return { ...state, videoOverlays: overlays.filter((overlay) => overlay.id !== overlayId) }
}

/**
 * The timeline with one zoom left out, for the editor's snapshot: the
 * rectangle is drawn on the *unzoomed* source, so it shows what the zoom
 * will fill. Same reference when the id is unknown.
 */
export function withoutZoom(state: TimelineState, zoomId: string): TimelineState {
  const zooms = zoomsOf(state)
  if (!zooms.some((zoom) => zoom.id === zoomId)) return state
  return { ...state, zooms: zooms.filter((zoom) => zoom.id !== zoomId) }
}

/**
 * ── Crop: the kept region as a rectangle (#423, from #402's design D4) ────
 *
 * Crop (#255) is four fractions trimmed from the edges of a source, and the
 * region it keeps is a rectangle — so the same pointer language works, with
 * `resizedRect`'s opposite-edge-fixed model doing exactly what dragging a
 * crop edge means. Two things are the crop's own, and both come from crop
 * living in a different space from everything else the editors touch.
 *
 * **The picture is the element's own source, not the composed frame.** A
 * placement is already a fraction of the output frame, so #422's rectangle
 * could sit straight on a composed still. A crop is a fraction of the
 * *source*, and the source lands somewhere inside the frame that the model
 * cannot compute: an entry letterboxes into it (`fitRect`, #176) and an
 * overlay letterboxes inside its own placement rectangle
 * (`overlayDestRect`, #145) — both need the source's pixel dimensions, and
 * neither a `TimelineEntry` nor a `VideoOverlay` carries them (the wall #422
 * hit when it wanted the clip's aspect for Shift). So `cropSourceTimeline`
 * builds a one-element timeline instead: that element alone, uncropped, with
 * no canvas preset. `canvasFrameSize` then derives the frame from that one
 * source, the picture fills it edge to edge, and a crop fraction *is* a
 * frame fraction with no mapping at all.
 *
 * **Crop is in source space, before orientation** (`crop.ts`'s "order of
 * operations is meaning"), while the picture shown is oriented. So the
 * displayed left edge is not always the stored `left`: on a clip rotated a
 * quarter turn it is the stored `bottom`. `sourceCropEdge` is that
 * permutation, and it is the whole of the difference — every other function
 * below works on the displayed rectangle.
 */

/**
 * What the crop editor can edit: a video/image sequence entry, or a video/
 * image overlay. The two carry the same source description under the same
 * names — id, clip, window, url, and the colour and orientation applied to
 * the picture — so one shape serves both rather than a union the geometry
 * would have to keep discriminating. A slate is excluded by its own rule
 * rather than by this type: it carries no crop at all (#255).
 */
export type CropSubject = Pick<
  TimelineEntry,
  | 'id'
  | 'clipId'
  | 'name'
  | 'duration'
  | 'url'
  | 'inPoint'
  | 'outPoint'
  | 'kind'
  | 'colorAdjustments'
  | 'orientation'
  | 'crop'
>

/** The four edges a crop trims, named as `Crop`'s own fields. */
export const CROP_EDGES = ['left', 'right', 'top', 'bottom'] as const
export type CropEdge = (typeof CROP_EDGES)[number]

const OPPOSITE_EDGE: Record<CropEdge, CropEdge> = {
  left: 'right',
  right: 'left',
  top: 'bottom',
  bottom: 'top',
}

/**
 * Which post-flip source edge each DISPLAYED edge is, per quarter turn.
 * Rotation is clockwise, so the source's left edge comes up at the top at
 * 90°: read each row as "the displayed edge on the left is really this one".
 */
const UNROTATED_EDGE: Record<number, Record<CropEdge, CropEdge>> = {
  0: { left: 'left', right: 'right', top: 'top', bottom: 'bottom' },
  90: { top: 'left', right: 'top', bottom: 'right', left: 'bottom' },
  180: { left: 'right', right: 'left', top: 'bottom', bottom: 'top' },
  270: { bottom: 'left', right: 'bottom', top: 'right', left: 'top' },
}

/**
 * The stored crop edge that a given edge of the *displayed* picture trims.
 *
 * Orientation composes flips first, then the rotation (`orientation.ts`), so
 * this undoes them in the opposite order: rotate the displayed edge back
 * into post-flip source space, then undo the flip that axis carries. A flip
 * is its own inverse, which is why one table serves both directions.
 *
 * The permutation is a bijection over the four edges, so reading a crop
 * through it and writing one back through it are exact inverses — which is
 * what `cropRect` and `cropFromRect` rely on.
 */
export function sourceCropEdge(displayed: CropEdge, orientation?: Orientation): CropEdge {
  const unrotated = UNROTATED_EDGE[orientation?.rotation ?? 0][displayed]
  const flipped =
    unrotated === 'left' || unrotated === 'right'
      ? orientation?.flipH === true
      : orientation?.flipV === true
  return flipped ? OPPOSITE_EDGE[unrotated] : unrotated
}

/**
 * How precisely a crop is stored, and the two modes the editor offers.
 *
 * The row's field holds a **percent** and shows two decimals of it
 * (`formatSeconds` in `Timeline.tsx`), so the fraction behind it can carry
 * four — two more than a placement's (`RECT_DECIMALS`). That gap is what
 * makes the issue's "snapping to whole percent values with Alt bypass" a
 * real snap rather than a restatement of the storage precision: a drag lands
 * on a whole percent, and Alt gives every digit the field can show. Both are
 * values the four number fields can express exactly, so the drag and its
 * mirror still cannot disagree (#422's rule).
 */
export const CROP_DECIMALS = 2
export const CROP_FINE_DECIMALS = 4

/**
 * The range a kept region is held inside: never smaller than the reducer's
 * own floor on either axis (`MIN_KEPT_FRACTION`, which `normalizeCrop`
 * scales an over-deep pair of edges back to), never larger than the whole
 * source. Clamping to it before dispatch means the reducer never moves the
 * rectangle underneath the drag.
 */
export const CROP_BOUNDS: RectBounds = {
  minSize: MIN_KEPT_FRACTION,
  maxSize: 1,
  decimals: CROP_DECIMALS,
}

/** The same range at the precision Alt asks for. */
export const CROP_FINE_BOUNDS: RectBounds = { ...CROP_BOUNDS, decimals: CROP_FINE_DECIMALS }

/**
 * The handles a crop offers: the four edges, one per stored value, which is
 * what the issue asks for and what makes a gesture legible — each drag moves
 * exactly one of the four numbers below it. Corners are deliberately not
 * offered: a corner is two edges at once, and nothing about a crop needs the
 * two to move together (`cropAfterGesture` still handles one, for the reason
 * `zoomAfterGesture` handles an edge).
 */
export const CROP_HANDLES: readonly RectHandle[] = ['n', 'e', 's', 'w']

/**
 * The kept region as a rectangle on the **displayed** (oriented) picture.
 * An absent crop is the whole source.
 */
export function cropRect(crop: Crop | undefined, orientation?: Orientation): FrameRect {
  const trimmed = (displayed: CropEdge) => crop?.[sourceCropEdge(displayed, orientation)] ?? 0
  const x = trimmed('left')
  const y = trimmed('top')
  // The sizes are complements of two stored edges, and a complement of two
  // clean decimals is not clean in binary floating point (1 − 0.1 − 0.2 is
  // 0.7000000000000001) — so they are rounded for the reason `cropFromRect`
  // rounds its own, and the two are exact inverses because both do.
  return {
    x,
    y,
    width: round(1 - x - trimmed('right'), CROP_FINE_DECIMALS),
    height: round(1 - y - trimmed('bottom'), CROP_FINE_DECIMALS),
  }
}

/**
 * The crop a displayed rectangle means, back in the source's own space —
 * `cropRect`'s inverse, and the shape `entry-crop-set` /
 * `video-overlay-crop-set` take. All four edges are always given, as the
 * row's own fields do: the reducer normalizes, dropping the zeroes, so a
 * crop is never stored two ways.
 *
 * Every edge is rounded to `CROP_FINE_DECIMALS`, whichever mode produced the
 * rectangle. Two of them are complements — `1 − x − width` — and a
 * complement of two clean decimals is not clean in binary floating point
 * (1 − 0.33 − 0.35 is 0.32000000000000006), so without this the model would
 * carry noise the field cannot show and `cropsEqual` would call a re-commit
 * of the same crop an edit. Rounding at the finer of the two precisions
 * leaves a whole-percent value untouched.
 */
export function cropFromRect(rect: FrameRect, orientation?: Orientation): Crop {
  const displayed: Record<CropEdge, number> = {
    left: rect.x,
    right: 1 - rect.x - rect.width,
    top: rect.y,
    bottom: 1 - rect.y - rect.height,
  }
  const crop: Crop = {}
  for (const edge of CROP_EDGES) {
    crop[sourceCropEdge(edge, orientation)] = round(
      clamp(displayed[edge], 0, 1),
      CROP_FINE_DECIMALS,
    )
  }
  return crop
}

/**
 * The kept region after one edge was dragged with Shift held: the opposite
 * edge is trimmed by the same amount, so the region grows or shrinks about
 * its own centre and stays where it was aimed.
 *
 * The cap is what keeps the symmetry honest. Without it a region whose
 * centre is off-centre could be asked for a size that runs off the frame,
 * and `clampedRect` would slide it back — leaving the two edges trimmed by
 * different amounts, which is the one thing this gesture promises not to do.
 */
export function symmetricResizedRect(
  start: FrameRect,
  edge: Edge,
  pointer: { x: number; y: number },
  bounds: RectBounds,
): FrameRect {
  const horizontal = edge === 'e' || edge === 'w'
  const low = horizontal ? start.x : start.y
  const centre = low + (horizontal ? start.width : start.height) / 2
  const room = 2 * Math.min(centre, 1 - centre)
  // Signed, deliberately not a distance: an edge dragged *past* the centre
  // has asked for a region with nothing left in it, so the half-size goes
  // negative and the floor below catches it. `Math.abs` would instead have
  // the handle bounce off the centre and start growing the region again,
  // with the dragged edge now on the far side of the one it began on — which
  // is what the first version of this did, and what its test now pins.
  const reach = horizontal ? pointer.x : pointer.y
  const half = edge === 'w' || edge === 'n' ? centre - reach : reach - centre
  const size = clamp(
    2 * half,
    bounds.minSize,
    Math.max(bounds.minSize, Math.min(bounds.maxSize, room)),
  )
  return clampedRect(
    horizontal
      ? { ...start, x: centre - size / 2, width: size }
      : { ...start, y: centre - size / 2, height: size },
    bounds,
  )
}

/**
 * The kept region after a pointer gesture. Alt drops the whole-percent snap
 * — this editor's Alt, and #391's convention that Alt means "give me what I
 * am pointing at" rather than what the tool would tidy it to.
 *
 * Shift makes an edge drag symmetric, which is the issue's own wording and
 * the reason Shift does not mean here what it means in the placement editor
 * (#422, where it locks an aspect): the two editors take the modifier the
 * gesture each offers has a use for, and Alt is spoken for in both.
 *
 * A move pans the kept region without resizing it, and deliberately does not
 * snap onto the frame's alignments the way a placement's does: those are
 * where an overlay is *put*, while a crop is a window on a source, and there
 * is nothing interesting about its centre sitting on a third.
 */
export function cropAfterGesture(start: FrameRect, gesture: RectGesture): FrameRect {
  const bounds = gesture.altKey === true ? CROP_FINE_BOUNDS : CROP_BOUNDS
  if (gesture.kind === 'move') return movedRect(start, gesture.dx, gesture.dy, bounds)
  // A corner cannot arrive through `CROP_HANDLES`, but the model is total
  // over one rather than leaving a case for a later editor to trip over —
  // `zoomAfterGesture`'s rule, and it costs a branch.
  if (gesture.kind === 'corner') return resizedRect(start, gesture.corner, gesture, bounds)
  return gesture.shiftKey === true
    ? symmetricResizedRect(start, gesture.edge, gesture, bounds)
    : resizedRect(start, gesture.edge, gesture, bounds)
}

/**
 * What the crop editor draws: the element alone, **uncropped**, on no canvas
 * preset — so `canvasFrameSize` derives the output frame from this one
 * source's own oriented dimensions and the picture fills it edge to edge.
 * That is what makes a crop fraction a frame fraction (see this section's
 * header), and it is why the still is not the composed frame: the source's
 * place inside that frame is not computable from the model.
 *
 * Everything that would change the picture without being part of the source
 * is left out — other entries, overlays, text, transitions, and the zooms
 * and remaps that live on the state rather than on the element. Colour and
 * orientation come along, because they are the element's own treatment of
 * the very picture being trimmed.
 *
 * An overlay is described as an entry here rather than as an overlay: an
 * overlay drawn as an overlay lands in its placement rectangle, a fraction
 * of a fraction of the frame, which is precisely the geometry this view
 * exists to avoid. Its fields are the entry's fields under different names
 * (`videoOverlay.ts` says so), so nothing is invented.
 */
export function cropSourceTimeline(subject: CropSubject): TimelineState {
  return {
    entries: [
      {
        id: subject.id,
        clipId: subject.clipId,
        name: subject.name,
        duration: subject.duration,
        url: subject.url,
        inPoint: subject.inPoint,
        outPoint: subject.outPoint,
        ...(subject.kind === undefined ? {} : { kind: subject.kind }),
        ...(subject.colorAdjustments === undefined
          ? {}
          : { colorAdjustments: subject.colorAdjustments }),
        ...(subject.orientation === undefined ? {} : { orientation: subject.orientation }),
      },
    ],
    transitions: [],
  }
}

/**
 * The instant the crop editor draws: the middle of the element's own window,
 * measured in the one-element timeline above — where sequence time 0 is the
 * element's `inPoint`, so the middle is half the window's length. A still's
 * window is `[0, duration]`, so this is its midpoint too.
 */
export function cropEditorSequenceTime(subject: Pick<CropSubject, 'inPoint' | 'outPoint'>): number {
  return Math.max(0, (subject.outPoint - subject.inPoint) / 2)
}

/**
 * The still's cache key. The element's id alone would be enough for the crop
 * itself — the picture has it bypassed, so committing one cannot change it —
 * but **orientation** is drawn, and it also decides which stored edge each
 * displayed edge is (`sourceCropEdge`). A rotation applied with the editor
 * open must therefore re-render, or the handles would trim edges the picture
 * no longer shows on that side.
 */
export function cropFrameKey(subject: CropSubject): string {
  const orientation = subject.orientation
  return [
    subject.id,
    orientation?.rotation ?? 0,
    orientation?.flipH === true ? 'H' : '',
    orientation?.flipV === true ? 'V' : '',
  ].join('#')
}

/**
 * ── Text: the rendered block as a rectangle (#424, from #402's design D4) ──
 *
 * A text overlay is placed by a **centre and a type size** (`x`, `y` as
 * frame fractions, `size` as a fraction of the frame height — `textOverlay.ts`),
 * not by a box. The box the editor draws is *derived*: its height is the
 * line count times the line height, and its width is a property of the
 * rendered text — how wide the widest line comes out under the overlay's
 * font, which nothing in the model stores and only a measurement can say.
 * So this model has a third input beside the placement and the gesture: a
 * `TextBlockShape`, measured once per content/font/frame with the same
 * canvas font string the export draws with (`textCanvasFont`), so the box
 * the handles sit on is the box the still shows.
 *
 * Two things follow from the block being *derived* rather than stored:
 *
 * - Both dimensions scale with `size` and the aspect is fixed by the
 *   content, so the one resize gesture is the zoom's — a corner dragged
 *   about the centre, the pointer's larger distance deciding (`resizedZoom`)
 *   — and the issue's single corner handle is the whole of the resize
 *   vocabulary. Edges would have nothing to do.
 * - The functions below take and return a `TextPlacement`, not a
 *   `FrameRect`: a gesture changes the fields it changes and passes the
 *   others through verbatim, so a move cannot rewrite a typed `size` to the
 *   editor's precision. The component converts to a rectangle to draw and
 *   back only through these, never by reading a centre off a box.
 */

/** The fields the text editor edits — the position part of a `TextOverlaySpec`. */
export type TextPlacement = Pick<TextOverlay, 'x' | 'y' | 'size'>

/**
 * What the rendered block's rectangle depends on beside the placement: the
 * measurement, reduced to two numbers that are independent of `x`, `y` and
 * `size`. Text scales linearly with its type size, so the width is stored
 * *per unit of size* and any placement's box is a multiplication away.
 */
export interface TextBlockShape {
  /** Lines in the content — explicit newlines only; there is no wrapping (#139). */
  lines: number
  /** The widest line's width as a fraction of the frame, per unit of `size`. */
  widthPerSize: number
}

/**
 * The shape of one overlay's block, measured at a frame size. `measure` is
 * a canvas `measureText` over a font string (`textMeasure.ts`); the frame
 * is the output frame the still was composed at, so the measurement is made
 * at the px size the text is actually drawn at rather than scaled from some
 * other size — the two differ by hinting at small sizes, and the still is
 * what the box has to agree with.
 */
export function textBlockShape(
  text: Pick<TextOverlay, 'content' | 'font' | 'size' | 'bold' | 'italic'>,
  frame: { width: number; height: number },
  measure: (font: string, line: string) => number,
): TextBlockShape {
  const lines = text.content.split('\n')
  if (text.size <= 0 || frame.width <= 0 || frame.height <= 0) {
    return { lines: lines.length, widthPerSize: 0 }
  }
  const font = textCanvasFont(text, frame.height)
  const widest = Math.max(0, ...lines.map((line) => measure(font, line)))
  return { lines: lines.length, widthPerSize: widest / frame.width / text.size }
}

/** The block's width and height, as frame fractions, for a size. */
function textBlockExtent(size: number, shape: TextBlockShape) {
  return { width: size * shape.widthPerSize, height: size * shape.lines * TEXT_LINE_HEIGHT }
}

/**
 * The rectangle a placement's block occupies: `textDraw`'s geometry read the
 * other way — the block of n lines is centred on (`x`, `y`), n line heights
 * tall, and as wide as its widest line.
 */
export function textBlockRect(placement: TextPlacement, shape: TextBlockShape): FrameRect {
  const { width, height } = textBlockExtent(placement.size, shape)
  return { x: placement.x - width / 2, y: placement.y - height / 2, width, height }
}

/**
 * `textBlockRect`'s inverse, unrounded — the centre and the size a rectangle
 * of this shape means. For the component's readout and tests; the gestures
 * below never go through it, since they hold the placement itself.
 */
export function textFromBlockRect(rect: FrameRect, shape: TextBlockShape): TextPlacement {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
    size: rect.height / (shape.lines * TEXT_LINE_HEIGHT),
  }
}

/**
 * How much one `+` / `−` press changes the type size (#424): the row's own
 * field step, so a press is one click of its spinner — and one undo step,
 * like every other editor's key.
 */
export const TEXT_SIZE_STEP = 0.01

/**
 * A stored-precision value inside a range. Rounding a value that was just
 * clamped to a bound can push it back over — a centre clamped to a half-
 * extent of 0.133 rounds to 0.13, three thousandths outside — so a rounded
 * result that lands past a bound steps one storable unit back inside. Where
 * the range is narrower than a unit there is nothing inside to step to, and
 * the nearer bound's rounding stands.
 */
function roundedInside(value: number, low: number, high: number, decimals: number): number {
  const unit = 10 ** -decimals
  const rounded = round(clamp(value, low, high), decimals)
  if (rounded < low - 1e-9 && rounded + unit <= high + 1e-9) return round(rounded + unit, decimals)
  if (rounded > high + 1e-9 && rounded - unit >= low - 1e-9) return round(rounded - unit, decimals)
  return rounded
}

/**
 * A centre that keeps a block of `extent` on the frame along one axis, at
 * the stored precision. A block that does not fit at all — a title wider
 * than the frame — is held by the reducer's own rule instead (the centre
 * within the frame, `clampTextOverlay`), since there is no inside to keep
 * it in and a user sliding an over-wide title should not be fought.
 */
function clampedTextCentre(value: number, extent: number): number {
  const half = extent / 2
  return extent <= 1
    ? roundedInside(value, half, 1 - half, RECT_DECIMALS)
    : round(clamp(value, 0, 1), RECT_DECIMALS)
}

/**
 * The largest size whose block still fits about a fixed centre — what a
 * corner drag or a `+` press may grow to. Floored to the stored precision
 * so the rounded size fits too; never below the model's own floor, which
 * wins over the frame when the two conflict (a block at `MIN_TEXT_SIZE`
 * always fits somewhere, and the centre clamp then moves it there).
 */
function maxTextSizeAt(placement: TextPlacement, shape: TextBlockShape): number {
  const roomX = 2 * Math.min(placement.x, 1 - placement.x)
  const roomY = 2 * Math.min(placement.y, 1 - placement.y)
  const byWidth = shape.widthPerSize > 0 ? roomX / shape.widthPerSize : Infinity
  const byHeight = roomY / (shape.lines * TEXT_LINE_HEIGHT)
  const cap = Math.floor(Math.min(byWidth, byHeight, MAX_TEXT_SIZE) * 10 ** RECT_DECIMALS) / 10 ** RECT_DECIMALS
  return Math.max(MIN_TEXT_SIZE, cap)
}

/**
 * The block moved by a fraction of the frame, its centre rounded to what the
 * row's fields can show (`RECT_DECIMALS` — a text centre is the same kind of
 * value in the same kind of field as a placement's edge) and kept on the
 * frame; the size passes through untouched.
 */
export function movedTextBlock(
  start: TextPlacement,
  dx: number,
  dy: number,
  shape: TextBlockShape,
): TextPlacement {
  const { width, height } = textBlockExtent(start.size, shape)
  return {
    ...start,
    x: clampedTextCentre(start.x + dx, width),
    y: clampedTextCentre(start.y + dy, height),
  }
}

/**
 * The block with each axis pulled onto any alignment it came near — the
 * free rectangle's own rule (`rectSnapOffset`): its edges flush to the
 * frame's borders, or its centre onto the centre and thirds, whichever is
 * nearest. Read off the block's box so a wide title snaps flush by its edge
 * exactly as a placement does.
 */
export function snappedTextBlock(placement: TextPlacement, shape: TextBlockShape): TextPlacement {
  const rect = textBlockRect(placement, shape)
  return movedTextBlock(
    placement,
    rectSnapOffset(rect.x, rect.width),
    rectSnapOffset(rect.y, rect.height),
    shape,
  )
}

/**
 * The block resized from its corner dragged to `pointer`, about its centre:
 * the zoom's gesture (`resizedZoom`), for the zoom's reason — the aspect is
 * fixed, so one distance decides both dimensions, and the pointer's larger
 * distance from the centre relative to the block's half-extent is the scale
 * factor. Capped so the block stays on the frame about the centre it has,
 * and clamped to the model's size range; the centre passes through.
 */
export function resizedTextBlock(
  start: TextPlacement,
  pointer: { x: number; y: number },
  shape: TextBlockShape,
): TextPlacement {
  const { width, height } = textBlockExtent(start.size, shape)
  const byX = width > 0 ? Math.abs(pointer.x - start.x) / (width / 2) : 0
  const byY = height > 0 ? Math.abs(pointer.y - start.y) / (height / 2) : 0
  const factor = Math.max(byX, byY)
  return {
    ...start,
    size: clamp(
      round(start.size * factor, RECT_DECIMALS),
      MIN_TEXT_SIZE,
      maxTextSizeAt(start, shape),
    ),
  }
}

/**
 * The placement after a pointer gesture. A move snaps unless Alt bypasses
 * it (#391's convention, as every editor here follows); a corner drag does
 * not, because it holds the centre fixed by construction — the zoom's
 * reasoning, unchanged. An edge cannot arrive (`TEXT_HANDLES` offers none),
 * but the model is total over one rather than leaving a case for a later
 * editor to trip over: for an aspect-locked, centre-fixed block an edge and
 * a corner would mean the same thing, so they do.
 */
export function textAfterGesture(
  start: TextPlacement,
  gesture: RectGesture,
  shape: TextBlockShape,
): TextPlacement {
  if (gesture.kind !== 'move') return resizedTextBlock(start, gesture, shape)
  const moved = movedTextBlock(start, gesture.dx, gesture.dy, shape)
  return gesture.altKey === true ? moved : snappedTextBlock(moved, shape)
}

/**
 * The placement after one key press: an arrow nudges the centre by the
 * shared step, unsnapped (a nudge is a deliberate 1 %); `+` / `−` step the
 * type size by the field's own step, capped like a drag.
 */
export function textAfterKeyStep(
  start: TextPlacement,
  step: RectKeyStep,
  shape: TextBlockShape,
): TextPlacement {
  if (step.kind === 'move') return movedTextBlock(start, step.dx, step.dy, shape)
  const size = start.size + (step.delta > 0 ? TEXT_SIZE_STEP : -TEXT_SIZE_STEP)
  return {
    ...start,
    size: clamp(round(size, RECT_DECIMALS), MIN_TEXT_SIZE, maxTextSizeAt(start, shape)),
  }
}

/**
 * The handles a text block offers: one corner (#424, "one corner handle for
 * size"). Resizing is about the centre with the aspect fixed, so every
 * corner would do the same thing and one says so; the bottom-right is the
 * one a reader's eye ends a line at. No edges: with both dimensions driven
 * by one size there is no "change this one dimension" for an edge to mean.
 */
export const TEXT_HANDLES: readonly RectHandle[] = ['se']

/**
 * The sequence time the text editor draws (#424): the middle of the
 * overlay's own window, so the still shows the frame the text is actually
 * over — the overlay editor's rule — clamped into the sequence, because a
 * text window may run past the end (`textOverlay.ts`'s allowed tail) and
 * there is no frame out there.
 */
export function textEditorSequenceTime(
  state: TimelineState,
  text: Pick<TextOverlay, 'offset' | 'duration'>,
): number {
  return clamp(text.offset + text.duration / 2, 0, Math.max(0, totalDuration(state)))
}

/**
 * The still's cache key. Unlike the other editors, this one draws the effect
 * it edits — the text is what is being placed, and nothing is bypassed — so
 * a committed drag *does* change the picture, and the key carries every
 * field the draw reads: the placement and the type as well as the identity.
 * A move re-renders the still with the text in its new place, which is what
 * lets the box be checked against the picture rather than trusted.
 */
export function textFrameKey(text: TextOverlay): string {
  return [
    text.id,
    text.x,
    text.y,
    text.size,
    text.font,
    text.color,
    text.bold ? 'b' : '',
    text.italic ? 'i' : '',
    text.offset,
    text.duration,
    text.fadeIn ?? 0,
    text.fadeOut ?? 0,
    text.content,
  ].join('#')
}
