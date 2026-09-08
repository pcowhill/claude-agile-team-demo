import { sequenceTimeAt } from './playback'
import { zoomsOf, zoomWindowDuration } from './timeline'
import type { TimelineState, ZoomSpec } from './timeline'
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
 * What a pointer did to a rectangle, relative to the rectangle at the start
 * of the gesture: a move by an offset, or a corner dragged to a point.
 * `altKey` is the raw modifier rather than an interpretation of it — the
 * component reports what the pointer did, and each handle model decides
 * what Alt means for it (#421: the zoom's model bypasses snapping).
 */
export type RectGesture =
  | { kind: 'move'; dx: number; dy: number; altKey?: boolean }
  | { kind: 'corner'; corner: Corner; x: number; y: number; altKey?: boolean }

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
  if (gesture.kind === 'corner') return resizedZoom(start, gesture)
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
 * The timeline with one zoom left out, for the editor's snapshot: the
 * rectangle is drawn on the *unzoomed* source, so it shows what the zoom
 * will fill. Same reference when the id is unknown.
 */
export function withoutZoom(state: TimelineState, zoomId: string): TimelineState {
  const zooms = zoomsOf(state)
  if (!zooms.some((zoom) => zoom.id === zoomId)) return state
  return { ...state, zooms: zooms.filter((zoom) => zoom.id !== zoomId) }
}
