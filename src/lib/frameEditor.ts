import { sequenceTimeAt } from './playback'
import { totalDuration, videoOverlaysOf, zoomsOf, zoomWindowDuration } from './timeline'
import type { TimelineState, ZoomSpec } from './timeline'
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
  const width = round(clamp(rect.width, bounds.minSize, bounds.maxSize), RECT_DECIMALS)
  const height = round(clamp(rect.height, bounds.minSize, bounds.maxSize), RECT_DECIMALS)
  return {
    x: round(clamp(rect.x, 0, 1 - width), RECT_DECIMALS),
    y: round(clamp(rect.y, 0, 1 - height), RECT_DECIMALS),
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
