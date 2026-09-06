import { sequenceTimeAt } from './playback'
import { zoomsOf } from './timeline'
import type { TimelineState, ZoomSpec } from './timeline'

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
 */
export type RectGesture =
  | { kind: 'move'; dx: number; dy: number }
  | { kind: 'corner'; corner: Corner; x: number; y: number }

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

/** The zoom after a gesture that began with the zoom at `start`. */
export function zoomAfterGesture(start: ZoomSpec, gesture: RectGesture): ZoomSpec {
  return gesture.kind === 'move'
    ? movedZoom(start, gesture.dx, gesture.dy)
    : resizedZoom(start, gesture)
}

/** Seconds into the entry where the zoom holds at full — the still the editor shows (#402 D2-a). */
export function zoomHoldMidpoint(zoom: ZoomSpec): number {
  return zoom.start + zoom.rampIn + zoom.hold / 2
}

/**
 * The sequence time of the zoom's hold midpoint on `entries[entryIndex]` —
 * the instant `snapshotTimelineFrame` renders for the editor. Source time is
 * the entry's in-point plus the zoom's offset (the convention `zoomAt`
 * reads), mapped through the remap-aware sequence clock.
 */
export function zoomEditorSequenceTime(
  state: TimelineState,
  entryIndex: number,
  zoom: ZoomSpec,
): number {
  const entry = state.entries[entryIndex]
  return sequenceTimeAt(state, entryIndex, entry.inPoint + zoomHoldMidpoint(zoom))
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
