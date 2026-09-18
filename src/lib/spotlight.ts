/**
 * Per-element spotlight regions (#532, from the customer-approved
 * suggestion #531): a rectangle or an oval on a clip's picture, live for a
 * window of its own source time, which **dims everything outside it** and
 * leaves everything inside untouched.
 *
 * A tutorial narrator says "click the button in the top right" and the
 * picture gives the viewer no help finding it. A zoom (#421) answers that
 * by *removing* the context — you see the button and nothing else — which
 * is often wrong for teaching, because the viewer loses where the button
 * is. This points without taking the frame away.
 *
 * **The shape is `redaction.ts`'s, deliberately.** A region stores the same
 * rectangle in the same space, the same window in the same clock, and goes
 * through the same strict/loose validation pair — so the two features are
 * one thing to learn, and `spotlightRects` is `redactionRects` itself
 * rather than a second copy of the crop reconciliation. Where this differs
 * from redaction it is because the feature differs, and each difference is
 * stated below.
 *
 * **The rectangle lives in the source's own frame, before orientation
 * (#232) and crop (#255)** — the crop editor's convention (#423) — and
 * **the time window lives in the element's own source seconds**, both for
 * the reasons `redaction.ts` gives: trimming, rotating or cropping the
 * element afterwards must keep the region on the thing it was placed over.
 *
 * Four decisions this module makes that the issue left to the
 * implementation:
 *
 * - **Several active regions punch out their union, and the strongest
 *   `dim` applies to the whole outside.** #531 asked for the union — two
 *   spotlights both stay bright rather than the second re-dimming the
 *   first. The outside is then a single area, and dimming one area twice at
 *   two strengths means nothing, so the maximum wins: adding a second,
 *   stronger spotlight never quietly weakens the emphasis the first asked
 *   for.
 * - **The union is drawn as an intersection of complements**, not as one
 *   even-odd path. An even-odd fill of `frame + regionA + regionB` re-dims
 *   exactly where two regions overlap, which is the one case #531 names; a
 *   non-zero fill with reversed winding does the same. Clipping once per
 *   region to "the draw rectangle except this region" intersects to "the
 *   draw rectangle except every region", which is the union rule by
 *   construction — see `drawSpotlights`.
 * - **A region whose source rectangle is entirely cropped away has no
 *   effect at all**, not even its dim. `redactionRects` already returns
 *   `undefined` for that case because there is nothing to paint; here the
 *   alternative would be a picture darkened with nothing lit, which reads
 *   as a bug rather than as a spotlight.
 * - **Spotlights do not paint into the background-fill backdrop (#259).**
 *   A redaction must, or the blurred cover-fit copy behind the picture
 *   would show — softened, but show — exactly what the region in front
 *   hides. A spotlight reveals nothing, and punching its hole into an
 *   overscanned copy of the same picture would put a *second* bright patch
 *   on screen. The preview's backdrop draws no regions either, so the two
 *   surfaces agree.
 *
 * **Redaction draws last.** Every caller runs `drawSpotlights` before
 * `drawRedactions` on the same layer, so a region that must be hidden stays
 * hidden even when a spotlight brightens around it. A privacy feature must
 * not lose to a decorative one (#532).
 */

import type { Crop } from './crop'
import type { RedactionRect } from './redaction'
import {
  isAcceptableRegionBox,
  isValidRegionBox,
  normalizeRegionBox,
  redactionRects,
} from './redaction'

/**
 * How a region's edge is drawn. The oval is **inscribed in the region's own
 * box**, so toggling the shape changes only the drawn edge and never the
 * stored geometry — the customer's own words (#531): the oval has "the same
 * width and height as the selected rectangle", and a square-proportioned
 * region toggled to oval "would effectively be a circle".
 */
export type SpotlightShape = 'rectangle' | 'oval'

/**
 * One stored region. As with `RedactionRegion`, a region has no identity
 * value — it exists or it does not — so every field is required and the
 * "absent behaves as identity" rule applies one level up: the element's
 * `spotlights` key is absent when no region exists, which is what keeps
 * spotlight-free project files byte-identical.
 */
export interface SpotlightRegion {
  /** Stable per region, so the UI and undo can address one of several. */
  id: string
  /** Left edge as a fraction of the source frame's width, in [0, 1). */
  left: number
  /** Top edge as a fraction of the source frame's height, in [0, 1). */
  top: number
  /** Width as a fraction of the source frame's width, in (0, 1]. */
  width: number
  /** Height as a fraction of the source frame's height, in (0, 1]. */
  height: number
  /** Window start, in seconds into the element's own source. */
  start: number
  /** Window end, in seconds into the element's own source; always > start. */
  end: number
  shape: SpotlightShape
  /**
   * How far the outside drops, as a fraction in [0, 1]: 0 leaves the
   * picture alone and 1 takes everything outside the region to black.
   * Stored as a fraction rather than a percent because every other
   * fractional field in the model is one; the row's field shows percent.
   */
  dim: number
}

/** A new region's shape: the rectangle, per #532. */
export const DEFAULT_SPOTLIGHT_SHAPE: SpotlightShape = 'rectangle'

/**
 * A new region's dim. #531 asked for "around 55%": enough that the eye goes
 * straight to the lit area, gentle enough that the context the feature
 * exists to keep is still legible — which is the whole difference from a
 * zoom.
 */
export const DEFAULT_SPOTLIGHT_DIM = 0.55

/** Where a freshly added region starts: redaction's centred rectangle. */
export const DEFAULT_SPOTLIGHT_RECT = { left: 0.35, top: 0.4, width: 0.3, height: 0.2 }

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const isShape = (value: unknown): value is SpotlightShape =>
  value === 'rectangle' || value === 'oval'

/**
 * Whether a region is acceptable as **stored** input — the strict check the
 * project-file path refuses by, as distinct from the reducer's clamping
 * (`normalizeSpotlightRegion`). A file is someone else's data, and the
 * editing path clamps instead, exactly as redaction splits the two.
 */
export function isValidSpotlightRegion(region: SpotlightRegion): boolean {
  // The box rules are redaction's, not a second copy of them — a spotlight
  // and a redaction disagreeing about what rectangle is storable would be a
  // difference nobody intended (`redaction.ts`, `RegionBox`).
  if (!isValidRegionBox(region)) return false
  if (!isShape(region.shape)) return false
  if (typeof region.dim !== 'number' || !Number.isFinite(region.dim)) return false
  return region.dim >= 0 && region.dim <= 1
}

/** Whether every region is valid and no two share an id. */
export function areValidSpotlights(regions: readonly SpotlightRegion[]): boolean {
  if (!regions.every(isValidSpotlightRegion)) return false
  return new Set(regions.map((region) => region.id)).size === regions.length
}

/**
 * Whether a region is acceptable as **editing** input — the loose check the
 * reducer uses. Ranges are not rejected here; they clamp, because a typed
 * percent routinely overshoots and snapping back is the established
 * behaviour of every other adjustment.
 */
export function isAcceptableSpotlightInput(region: SpotlightRegion): boolean {
  if (!isAcceptableRegionBox(region)) return false
  if (typeof region.dim !== 'number' || !Number.isFinite(region.dim)) return false
  return isShape(region.shape)
}

/** The editing-path counterpart of `areValidSpotlights`: loose, ids unique. */
export function areAcceptableSpotlightInputs(regions: readonly SpotlightRegion[]): boolean {
  if (!regions.every(isAcceptableSpotlightInput)) return false
  return new Set(regions.map((region) => region.id)).size === regions.length
}

/**
 * The canonical stored form of one region: redaction's box rules
 * (`normalizeRegionBox`) plus the dim clamped to [0, 1] — so the same
 * visible result is never stored two ways.
 */
export function normalizeSpotlightRegion(region: SpotlightRegion): SpotlightRegion {
  return { ...normalizeRegionBox(region), shape: region.shape, dim: clamp(region.dim, 0, 1) }
}

/**
 * The canonical stored list: every region normalized, order preserved. An
 * empty list is `undefined` — the caller stores no `spotlights` key at all,
 * which is what keeps spotlight-free project files byte-identical.
 *
 * Order is not paint order here the way it is for redaction, because the
 * regions compose into one union whatever their order; it is the order the
 * row lists them in, which the user controls and should not see change.
 */
export function normalizeSpotlights(
  regions: readonly SpotlightRegion[] | undefined,
): SpotlightRegion[] | undefined {
  if (regions === undefined || regions.length === 0) return undefined
  return regions.map(normalizeSpotlightRegion)
}

/** Structural equality over stored (normalized) region lists. */
export function spotlightsEqual(
  a: readonly SpotlightRegion[] | undefined,
  b: readonly SpotlightRegion[] | undefined,
): boolean {
  const left = a ?? []
  const right = b ?? []
  if (left.length !== right.length) return false
  return left.every((region, index) => {
    const other = right[index]
    return (
      other !== undefined &&
      region.id === other.id &&
      region.left === other.left &&
      region.top === other.top &&
      region.width === other.width &&
      region.height === other.height &&
      region.start === other.start &&
      region.end === other.end &&
      region.shape === other.shape &&
      region.dim === other.dim
    )
  })
}

/**
 * The regions covering a given moment of the element's own source. The
 * window is half-open at the end (`start <= t < end`), matching redaction
 * and every other window in the model.
 */
export function activeSpotlights(
  regions: readonly SpotlightRegion[] | undefined,
  sourceTime: number,
): SpotlightRegion[] {
  if (regions === undefined || regions.length === 0) return []
  return regions.filter((region) => sourceTime >= region.start && sourceTime < region.end)
}

/** Whether any region in the list would dim anything — the caller's skip. */
export function hasSpotlight(regions: readonly SpotlightRegion[] | undefined): boolean {
  return (regions ?? []).length > 0
}

/**
 * One region's geometry for a layer being drawn: `redactionRects` unchanged
 * — the same rectangle in the same space reconciled against the same crop,
 * so the two features cannot drift apart on where a region *is*. Exported
 * under this name so callers and tests read in the feature's own terms.
 */
export function spotlightRects(
  region: Pick<SpotlightRegion, 'left' | 'top' | 'width' | 'height'>,
  crop: Crop | undefined,
  sourceWidth: number,
  sourceHeight: number,
  drawRect: RedactionRect,
): { source: RedactionRect; dest: RedactionRect } | undefined {
  return redactionRects(region, crop, sourceWidth, sourceHeight, drawRect)
}

/**
 * Traces one region's lit shape as a subpath of `context`'s current path.
 *
 * The oval is inscribed in the destination rectangle — same centre, half
 * its width and height as the radii — so a square-proportioned region draws
 * a circle, which is the customer's own test case (#531). The radii take
 * `Math.abs` because a mirrored layer (#232) hands this a rectangle with
 * negative extent: `rect` accepts that and normalizes it, `ellipse` throws
 * on a negative radius.
 */
function traceSpotlightShape(
  context: CanvasRenderingContext2D,
  shape: SpotlightShape,
  dest: RedactionRect,
): void {
  if (shape === 'oval') {
    context.ellipse(
      dest.x + dest.width / 2,
      dest.y + dest.height / 2,
      Math.abs(dest.width) / 2,
      Math.abs(dest.height) / 2,
      0,
      0,
      Math.PI * 2,
    )
    return
  }
  context.rect(dest.x, dest.y, dest.width, dest.height)
}

/** What `drawSpotlights` needs to dim around one layer's regions. */
export interface DrawSpotlightsOptions {
  context: CanvasRenderingContext2D
  regions: readonly SpotlightRegion[] | undefined
  /** The moment of the element's own source this frame shows. */
  sourceTime: number
  crop: Crop | undefined
  sourceWidth: number
  sourceHeight: number
  /** Where the layer's picture was just drawn — `drawLayerSource`'s rect. */
  drawRect: RedactionRect
}

/**
 * Dims `drawRect` everywhere outside the regions covering this frame,
 * inside whatever transform the caller has established.
 *
 * The union is built by clipping, once per region, to "everything in the
 * draw rectangle except this region" — an even-odd path of the draw
 * rectangle plus the region's own shape. Canvas clips intersect, so N of
 * those give the draw rectangle minus the *union* of the regions, and two
 * overlapping spotlights therefore both stay bright (#531) rather than the
 * overlap being dimmed twice, which is what a single even-odd path would
 * have done.
 *
 * Nothing is read back from the canvas and nothing is composited out, so
 * this is correct under a rotation, a flip, a zoom or a transition, and
 * correct on the preview's overlay canvas — where the dim lands on
 * transparency and the video shows through the holes — as well as on the
 * export's, where it lands on the picture itself.
 */
export function drawSpotlights(options: DrawSpotlightsOptions): void {
  const { context, regions, sourceTime, crop, sourceWidth, sourceHeight, drawRect } = options
  const active = activeSpotlights(regions, sourceTime)
  if (active.length === 0) return
  const lit: { region: SpotlightRegion; dest: RedactionRect }[] = []
  for (const region of active) {
    const rects = spotlightRects(region, crop, sourceWidth, sourceHeight, drawRect)
    if (rects === undefined) continue
    if (!(Math.abs(rects.dest.width) > 0) || !(Math.abs(rects.dest.height) > 0)) continue
    lit.push({ region, dest: rects.dest })
  }
  // Every region cropped away means nothing to light, and a picture dimmed
  // with nothing lit reads as a bug rather than as a spotlight.
  if (lit.length === 0) return
  const dim = Math.max(...lit.map(({ region }) => region.dim))
  if (!(dim > 0)) return
  const previousFilter = context.filter
  context.save()
  try {
    // A filter left set by the layer's colour adjustments would tint the
    // dim; the dim is not part of the picture being graded — redaction's
    // rule, for the same reason.
    context.filter = 'none'
    for (const { region, dest } of lit) {
      context.beginPath()
      // Each clip's outer rectangle is the draw rectangle, so the first one
      // already bounds the fill below to the layer's own picture.
      context.rect(drawRect.x, drawRect.y, drawRect.width, drawRect.height)
      traceSpotlightShape(context, region.shape, dest)
      context.clip('evenodd')
    }
    context.fillStyle = `rgba(0, 0, 0, ${dim})`
    context.fillRect(drawRect.x, drawRect.y, drawRect.width, drawRect.height)
  } finally {
    context.restore()
    context.filter = previousFilter
  }
}
