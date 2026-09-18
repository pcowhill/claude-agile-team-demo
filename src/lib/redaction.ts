/**
 * Per-element redaction regions (#492): rectangles that hide part of a
 * clip's picture for a window of its own source time — blurred, pixelated,
 * or filled with a solid colour. The product records the customer's screen
 * (#225, #388), and a real recording almost always shows something the
 * viewer should not see; the alternatives before this were re-recording,
 * cropping the region away with whatever sits beside it (#255), or covering
 * it with an opaque overlay that is neither shaped to the source nor timed.
 *
 * This module is the shared rule (#66 pattern): `redactionRects` maps one
 * stored region to the source-pixel rectangle to sample and the destination
 * rectangle to paint for BOTH renderers, and `drawRedactions` is the single
 * canvas implementation the export (`exportVideo.ts`), the frame snapshot
 * (`frameSnapshot.ts`) and the GIF plugin all render through — so what
 * plays is what exports, and a redaction can never be dropped by one
 * surface while another shows it.
 *
 * **The rectangle lives in the source's own frame, before orientation
 * (#232) and crop (#255)** — the crop editor's convention (#423). A region
 * names the pixels of the recording it hides, so rotating, flipping,
 * cropping or trimming the clip afterwards keeps the mask on the thing it
 * was placed over instead of sliding off it. The canvas transform that
 * orients the picture is the same one the mask is drawn inside, so
 * orientation costs this module nothing: `redactionRects` handles crop, and
 * rotation composes for free.
 *
 * **The time window lives in the element's own source seconds**, like the
 * In and Out fields, for the same reason: trimming an element must not move
 * the mask off the moment it hides.
 *
 * **No fade edges.** #489 floated them and #492 dropped them deliberately:
 * a mask that fades in reveals what it hides while it fades, which is the
 * one thing a redaction must never do.
 */

import type { Crop } from './crop'
import { cropSourceRect } from './crop'

/**
 * How a region hides what is under it.
 *
 * `pixelate` is the default for a new region (`DEFAULT_REDACTION_STYLE`),
 * on the suggestion's own reasoning: a coarse pixelate cannot be reversed,
 * while a soft blur over small text can be partly reversed. Both are
 * reversible *choices* — the user can switch a region's style freely; it is
 * the blurred output that is partly recoverable, not the setting.
 */
export type RedactionStyle = 'blur' | 'pixelate' | 'solid'

/**
 * One stored region. Unlike `crop` or `orientation`, a region has no
 * identity value — it exists or it does not — so every field is required
 * and the "absent behaves as identity" rule applies one level up: the
 * element's `redactions` key is absent when no region exists, which is what
 * keeps redaction-free project files byte-identical (#492).
 */
export interface RedactionRegion {
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
  style: RedactionStyle
  /**
   * Blur radius in **source** pixels, present exactly when `style` is
   * 'blur'. Source pixels rather than output pixels so the strength means
   * the same thing whatever the region is scaled to on the way to the
   * frame — `drawRedactions` scales it to the destination itself.
   */
  strength?: number
  /**
   * Pixelate block size in **source** pixels, present exactly when `style`
   * is 'pixelate'. Anchoring the grid in source space is what keeps a
   * pixelated region looking identical in the preview and in a 4K export.
   */
  blockSize?: number
  /**
   * Fill colour as lowercase `#rrggbb`, present exactly when `style` is
   * 'solid'. Defaults to black (`DEFAULT_REDACTION_COLOR`) — the customer
   * asked for "a full color redacting (defaulting to black)" (#489).
   */
  color?: string
}

/**
 * The smallest fraction of either axis a region may cover. A region smaller
 * than this hides nothing legible and is almost always a mis-drag; the
 * clamping idiom is crop's `MIN_KEPT_FRACTION`. Shared with spotlight
 * regions (#532) through `normalizeRegionBox` below.
 */
export const MIN_REGION_FRACTION = 0.01

/** A new region's style, per #492 — see `RedactionStyle`. */
export const DEFAULT_REDACTION_STYLE: RedactionStyle = 'pixelate'

/** A new blur region's radius, in source pixels. */
export const DEFAULT_BLUR_STRENGTH = 12

/**
 * A new pixelate region's block size, in source pixels — coarse enough to
 * destroy body text in a 720p screen recording, where a line of text is
 * around 15 px tall.
 */
export const DEFAULT_PIXELATE_BLOCK = 16

/** A new solid region's colour: black, per the customer's #489 comment. */
export const DEFAULT_REDACTION_COLOR = '#000000'

/** The largest blur radius or block size a region may store, in source pixels. */
export const MAX_REDACTION_STRENGTH = 400

/**
 * The shortest window a stored region may have. A region whose end is
 * dragged back past its start collapses to this rather than to nothing, so
 * it stays visible and editable instead of vanishing from the picture while
 * still listed in the fields. Shared with spotlight regions (#532) through
 * `normalizeRegionBox` below.
 */
export const MIN_WINDOW_SECONDS = 0.01

/**
 * Where a freshly added region starts: a centred rectangle big enough to
 * see and grab, small enough that it is obviously meant to be moved. The
 * visual editor (#493) drags from exactly this.
 */
export const DEFAULT_REGION_RECT = { left: 0.35, top: 0.4, width: 0.3, height: 0.2 }

/** Lowercase `#rrggbb`, the stored colour form shared with slates (#143). */
const HEX_COLOR = /^#[0-9a-f]{6}$/

/**
 * Slack for the pixelate block count: a region's source rectangle comes out
 * of a fraction multiplication, so a rectangle meant to be exactly one
 * block wide measures 64.00000000000003 px. Far smaller than any block a
 * user can ask for, and far larger than the dust it absorbs.
 */
const BLOCK_EPSILON = 1e-6

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/** A plain rectangle. Structurally `FitRect`, without the import cycle. */
export interface RedactionRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The fields every per-element region carries: an identity, a rectangle in
 * source fractions, and a window in source seconds. Redaction regions
 * (#492) and spotlight regions (#532) differ in what they *do* with that
 * box and in nothing else about it, so the three functions below are the
 * one place those rules live — the alternative is two copies that agree
 * until somebody fixes only one of them.
 */
export interface RegionBox {
  id: string
  left: number
  top: number
  width: number
  height: number
  start: number
  end: number
}

/**
 * Whether a region's box is acceptable as **stored** input: inside the
 * source frame, with real extent, and a window that is ordered and
 * non-empty. The strict half of the split the module comment describes.
 */
export function isValidRegionBox(region: RegionBox): boolean {
  if (typeof region.id !== 'string' || region.id === '') return false
  const fractions = [region.left, region.top, region.width, region.height]
  if (!fractions.every((value) => typeof value === 'number' && Number.isFinite(value))) return false
  if (region.left < 0 || region.top < 0) return false
  if (region.width <= 0 || region.height <= 0) return false
  if (region.left + region.width > 1 || region.top + region.height > 1) return false
  if (typeof region.start !== 'number' || !Number.isFinite(region.start)) return false
  if (typeof region.end !== 'number' || !Number.isFinite(region.end)) return false
  return region.start >= 0 && region.end > region.start
}

/**
 * Whether a region's box is acceptable as **editing** input: an id and
 * seven finite numbers. Ranges are not rejected — they clamp in
 * `normalizeRegionBox`, because a dragged handle or a typed percent
 * routinely overshoots and snapping back is the established behaviour of
 * every other adjustment.
 */
export function isAcceptableRegionBox(region: RegionBox): boolean {
  if (typeof region.id !== 'string' || region.id === '') return false
  const numbers = [region.left, region.top, region.width, region.height, region.start, region.end]
  return numbers.every((value) => typeof value === 'number' && Number.isFinite(value))
}

/**
 * The canonical stored box: clamped inside the source frame at no less than
 * `MIN_REGION_FRACTION` on each axis, and the window ordered and at least
 * `MIN_WINDOW_SECONDS` long — an inverted or empty window would do nothing,
 * and the floor keeps a region that exists visible for at least an instant
 * rather than silently vanishing from the picture while still listed in the
 * fields.
 */
export function normalizeRegionBox(region: RegionBox): RegionBox {
  const width = clamp(region.width, MIN_REGION_FRACTION, 1)
  const height = clamp(region.height, MIN_REGION_FRACTION, 1)
  const left = clamp(region.left, 0, 1 - width)
  const top = clamp(region.top, 0, 1 - height)
  const start = Math.max(0, region.start)
  const end = Math.max(region.end, start + MIN_WINDOW_SECONDS)
  return { id: region.id, left, top, width, height, start, end }
}

/**
 * Whether a region is acceptable as **stored** input — the strict check the
 * project-file path refuses by (#492), as distinct from the reducer's
 * clamping (`normalizeRedactionRegion`). A file is someone else's data and
 * a silently clamped redaction is a redaction that may no longer cover what
 * it was drawn over, so a malformed one is refused rather than repaired;
 * the editing path clamps instead, like every other adjustment.
 */
export function isValidRedactionRegion(region: RedactionRegion): boolean {
  if (!isValidRegionBox(region)) return false
  if (region.style !== 'blur' && region.style !== 'pixelate' && region.style !== 'solid') {
    return false
  }
  if (region.style === 'blur') {
    if (typeof region.strength !== 'number' || !Number.isFinite(region.strength)) return false
    if (region.strength < 0 || region.strength > MAX_REDACTION_STRENGTH) return false
  } else if (region.strength !== undefined) return false
  if (region.style === 'pixelate') {
    if (typeof region.blockSize !== 'number' || !Number.isFinite(region.blockSize)) return false
    if (region.blockSize < 1 || region.blockSize > MAX_REDACTION_STRENGTH) return false
  } else if (region.blockSize !== undefined) return false
  if (region.style === 'solid') {
    if (typeof region.color !== 'string' || !HEX_COLOR.test(region.color)) return false
  } else if (region.color !== undefined) return false
  return true
}

/** Whether every region is valid and no two share an id (#492's file rule). */
export function areValidRedactions(regions: readonly RedactionRegion[]): boolean {
  if (!regions.every(isValidRedactionRegion)) return false
  return new Set(regions.map((region) => region.id)).size === regions.length
}

/**
 * Whether a region is acceptable as **editing** input — the loose check the
 * reducer uses, exactly as `isValidCrop` is loose where `asCrop` is strict.
 * Ranges are not rejected here; they clamp (`normalizeRedactionRegion`),
 * because a dragged handle or a typed percent routinely overshoots and
 * snapping back is the established behaviour of every other adjustment. A
 * *file* is someone else's data and gets the strict check instead, since a
 * region that silently moved on open would no longer cover what it hides.
 */
export function isAcceptableRedactionInput(region: RedactionRegion): boolean {
  if (!isAcceptableRegionBox(region)) return false
  if (region.style !== 'blur' && region.style !== 'pixelate' && region.style !== 'solid') {
    return false
  }
  for (const value of [region.strength, region.blockSize]) {
    if (value !== undefined && !(typeof value === 'number' && Number.isFinite(value))) return false
  }
  return region.color === undefined || typeof region.color === 'string'
}

/** The editing-path counterpart of `areValidRedactions`: loose, ids unique. */
export function areAcceptableRedactionInputs(regions: readonly RedactionRegion[]): boolean {
  if (!regions.every(isAcceptableRedactionInput)) return false
  return new Set(regions.map((region) => region.id)).size === regions.length
}

/**
 * The canonical stored form of one region: the rectangle clamped inside the
 * source frame at no less than `MIN_REGION_FRACTION` on each axis, the
 * window ordered and non-empty, and exactly the one style parameter the
 * style uses — so the same visible result is never stored two ways, and
 * switching a region's style cannot leave a stale radius behind to
 * reappear later.
 */
export function normalizeRedactionRegion(region: RedactionRegion): RedactionRegion {
  const base = { ...normalizeRegionBox(region), style: region.style }
  switch (region.style) {
    case 'blur':
      return {
        ...base,
        strength: clamp(region.strength ?? DEFAULT_BLUR_STRENGTH, 0, MAX_REDACTION_STRENGTH),
      }
    case 'pixelate':
      return {
        ...base,
        blockSize: clamp(region.blockSize ?? DEFAULT_PIXELATE_BLOCK, 1, MAX_REDACTION_STRENGTH),
      }
    case 'solid': {
      const color = region.color ?? ''
      return { ...base, color: HEX_COLOR.test(color) ? color : DEFAULT_REDACTION_COLOR }
    }
  }
}

/**
 * The canonical stored list: every region normalized, order preserved (it
 * is paint order, and overlapping regions are explicitly allowed). An empty
 * list is `undefined` — the caller stores no `redactions` key at all, which
 * is what keeps redaction-free project files byte-identical (#492).
 */
export function normalizeRedactions(
  regions: readonly RedactionRegion[] | undefined,
): RedactionRegion[] | undefined {
  if (regions === undefined || regions.length === 0) return undefined
  return regions.map(normalizeRedactionRegion)
}

/** Structural equality over stored (normalized) region lists. */
export function redactionsEqual(
  a: readonly RedactionRegion[] | undefined,
  b: readonly RedactionRegion[] | undefined,
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
      region.style === other.style &&
      region.strength === other.strength &&
      region.blockSize === other.blockSize &&
      region.color === other.color
    )
  })
}

/**
 * The regions covering a given moment of the element's own source, in paint
 * order. The window is half-open at the end (`start <= t < end`) so two
 * regions that abut at a second never both paint on the boundary frame.
 */
export function activeRedactions(
  regions: readonly RedactionRegion[] | undefined,
  sourceTime: number,
): RedactionRegion[] {
  if (regions === undefined || regions.length === 0) return []
  return regions.filter((region) => sourceTime >= region.start && sourceTime < region.end)
}

/** Whether any region in the list blurs — the canvas-`filter` condition (#492). */
export function hasBlurRedaction(regions: readonly RedactionRegion[] | undefined): boolean {
  return (regions ?? []).some((region) => region.style === 'blur')
}

/**
 * One region's geometry for a layer being drawn: `source` is the rectangle
 * of source pixels the region covers, and `dest` is where those pixels land
 * in the space `drawLayerSource` paints into — the caller's `drawRect`,
 * which is already inside the orientation transform, so a rotated or
 * flipped layer needs nothing extra here.
 *
 * Crop is what this has to reconcile: the layer draws only its kept source
 * rectangle (`cropSourceRect`) stretched across `drawRect`, so a region is
 * placed relative to the *kept* rectangle and clipped to it. A region lying
 * entirely in cropped-away source returns `undefined` — nothing to paint —
 * and one straddling the crop edge is trimmed to the part still on screen,
 * which is the honest reading of "hide these source pixels" when some of
 * them are no longer shown.
 */
export function redactionRects(
  // Only the rectangle is read, so this takes just the rectangle: spotlight
  // regions (#532) are placed in the same space against the same crop and
  // reuse this rather than carrying a second copy of the reconciliation.
  region: Pick<RedactionRegion, 'left' | 'top' | 'width' | 'height'>,
  crop: Crop | undefined,
  sourceWidth: number,
  sourceHeight: number,
  drawRect: RedactionRect,
): { source: RedactionRect; dest: RedactionRect } | undefined {
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) return undefined
  const kept = cropSourceRect(crop, { width: sourceWidth, height: sourceHeight })
  if (!(kept.width > 0) || !(kept.height > 0)) return undefined
  // The region in source pixels, then clipped to the kept rectangle.
  const x0 = Math.max(region.left * sourceWidth, kept.x)
  const y0 = Math.max(region.top * sourceHeight, kept.y)
  const x1 = Math.min((region.left + region.width) * sourceWidth, kept.x + kept.width)
  const y1 = Math.min((region.top + region.height) * sourceHeight, kept.y + kept.height)
  if (!(x1 > x0) || !(y1 > y0)) return undefined
  // Fractions of the kept rectangle map straight onto the destination box,
  // because that box is exactly where the kept rectangle is drawn.
  const u0 = (x0 - kept.x) / kept.width
  const v0 = (y0 - kept.y) / kept.height
  const u1 = (x1 - kept.x) / kept.width
  const v1 = (y1 - kept.y) / kept.height
  return {
    source: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
    dest: {
      x: drawRect.x + u0 * drawRect.width,
      y: drawRect.y + v0 * drawRect.height,
      width: (u1 - u0) * drawRect.width,
      height: (v1 - v0) * drawRect.height,
    },
  }
}

/** What `drawRedactions` needs to paint one layer's regions. */
export interface DrawRedactionsOptions {
  context: CanvasRenderingContext2D
  /** The layer's source pixels — re-sampled for blur and pixelate. */
  source: CanvasImageSource
  regions: readonly RedactionRegion[] | undefined
  /** The moment of the element's own source this frame shows. */
  sourceTime: number
  crop: Crop | undefined
  sourceWidth: number
  sourceHeight: number
  /** Where the layer's picture was just drawn — `drawLayerSource`'s rect. */
  drawRect: RedactionRect
  /** Injected for tests, as the export's own buffers are (#492). */
  createCanvas?: () => HTMLCanvasElement
  /**
   * Whether the context can blur. Blur regions are skipped when it cannot —
   * the export and the frame snapshot refuse such a timeline up front
   * (`exportVideo.ts`, `frameSnapshot.ts`) rather than letting a frame slip
   * out unredacted, so reaching a skip here means a caller the refusal does
   * not guard; drawing the region unblurred would be the silent failure the
   * refusal exists to prevent, so it is filled solid instead.
   */
  blurSupported?: boolean
}

/**
 * Paints every region covering this frame, over a layer's already-drawn
 * picture, inside whatever transform the caller has established.
 *
 * - **solid** fills the destination rectangle.
 * - **pixelate** redraws the region's own source pixels through a buffer
 *   sized in whole blocks, with smoothing off, so the grid is anchored in
 *   source space and looks the same at every output resolution.
 * - **blur** redraws the region's own source pixels through the context's
 *   `filter`, clipped to the destination rectangle so the blur cannot bleed
 *   past the region's edge and smear what it was meant to leave alone. The
 *   radius is given in source pixels and scaled to the destination here.
 *
 * Every style re-draws from the *source* rather than reading the canvas
 * back, which is what makes this correct under a rotation, a flip, a zoom
 * or a transition: the pixels sampled are the ones the region names, no
 * matter what the surrounding transform is doing.
 */
export function drawRedactions(options: DrawRedactionsOptions): void {
  const {
    context,
    source,
    regions,
    sourceTime,
    crop,
    sourceWidth,
    sourceHeight,
    drawRect,
    blurSupported = true,
  } = options
  const active = activeRedactions(regions, sourceTime)
  if (active.length === 0) return
  const createCanvas = options.createCanvas ?? (() => document.createElement('canvas'))
  let buffer: { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } | null = null
  for (const region of active) {
    const rects = redactionRects(region, crop, sourceWidth, sourceHeight, drawRect)
    if (rects === undefined) continue
    const { source: src, dest } = rects
    if (!(Math.abs(dest.width) > 0) || !(Math.abs(dest.height) > 0)) continue
    if (region.style === 'solid' || (region.style === 'blur' && !blurSupported)) {
      const previousFilter = context.filter
      context.save()
      try {
        // A filter left set by the layer's colour adjustments would tint
        // the mask; a redaction is not part of the picture being graded.
        context.filter = 'none'
        context.fillStyle = region.style === 'solid' ? (region.color ?? DEFAULT_REDACTION_COLOR) : DEFAULT_REDACTION_COLOR
        context.fillRect(dest.x, dest.y, dest.width, dest.height)
      } finally {
        context.restore()
        context.filter = previousFilter
      }
      continue
    }
    if (region.style === 'pixelate') {
      const blockSize = Math.max(1, region.blockSize ?? DEFAULT_PIXELATE_BLOCK)
      // The block count is a ceiling with a hair of slack, because the
      // source rectangle is computed from fractions and lands on
      // 64.00000000000003 rather than 64 — a bare ceiling then yields one
      // extra sliver block, which is visible: a region exactly N blocks
      // wide would be pixelated on an N+1 grid, and where the source
      // changes colour at a block boundary the sliver reads as a seam.
      const blocks = (extent: number) => Math.max(1, Math.ceil(extent / blockSize - BLOCK_EPSILON))
      const columns = blocks(src.width)
      const rows = blocks(src.height)
      if (buffer === null) buffer = makeBuffer(createCanvas)
      if (buffer === null) continue
      const { canvas, context: bufferContext } = buffer
      if (canvas.width !== columns) canvas.width = columns
      if (canvas.height !== rows) canvas.height = rows
      bufferContext.filter = 'none'
      bufferContext.imageSmoothingEnabled = true
      bufferContext.clearRect(0, 0, columns, rows)
      // One buffer pixel per block: the downscale averages each block, and
      // the un-smoothed upscale paints it back as a flat square.
      bufferContext.drawImage(source, src.x, src.y, src.width, src.height, 0, 0, columns, rows)
      const previousFilter = context.filter
      const previousSmoothing = context.imageSmoothingEnabled
      context.save()
      try {
        context.filter = 'none'
        context.imageSmoothingEnabled = false
        context.drawImage(canvas, 0, 0, columns, rows, dest.x, dest.y, dest.width, dest.height)
      } finally {
        context.restore()
        context.filter = previousFilter
        context.imageSmoothingEnabled = previousSmoothing
      }
      continue
    }
    // blur
    const radius = Math.max(0, region.strength ?? DEFAULT_BLUR_STRENGTH)
    // The radius is in source pixels; the region is scaled by
    // dest.width / src.width on its way to the frame, so the drawn radius
    // scales with it — a 12 px blur means the same amount of hiding
    // whatever the export's resolution is.
    const scale = src.width > 0 ? Math.abs(dest.width) / src.width : 1
    const drawnRadius = radius * scale
    const previousFilter = context.filter
    context.save()
    try {
      context.beginPath()
      context.rect(dest.x, dest.y, dest.width, dest.height)
      context.clip()
      context.filter = drawnRadius > 0 ? `blur(${drawnRadius}px)` : 'none'
      // Sampling a margin of source around the region keeps the blur from
      // pulling in the canvas's transparent edge at the rectangle's border,
      // which would otherwise fade the mask out exactly where it matters.
      const margin = Math.min(radius * 2, src.width, src.height)
      const sx = Math.max(0, src.x - margin)
      const sy = Math.max(0, src.y - margin)
      const sw = Math.min(sourceWidth - sx, src.width + margin * 2)
      const sh = Math.min(sourceHeight - sy, src.height + margin * 2)
      const scaleX = src.width > 0 ? dest.width / src.width : 1
      const scaleY = src.height > 0 ? dest.height / src.height : 1
      context.drawImage(
        source,
        sx,
        sy,
        sw,
        sh,
        dest.x + (sx - src.x) * scaleX,
        dest.y + (sy - src.y) * scaleY,
        sw * scaleX,
        sh * scaleY,
      )
    } finally {
      context.restore()
      context.filter = previousFilter
    }
  }
}

function makeBuffer(
  createCanvas: () => HTMLCanvasElement,
): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } | null {
  const canvas = createCanvas()
  const context = canvas.getContext('2d')
  if (context === null) return null
  return { canvas, context }
}
