/**
 * Picture effects (#862): a stylised change to an entry's picture over a
 * stretch of its time, such as a vignette or a blur, as pure data. This
 * module owns the effect types, their validation and clamping, and the
 * picture-effect registry that plugins contribute definitions to;
 * ownership, actions and normalization against the timeline live in
 * `timeline.ts`, exactly as they do for zooms (#63/#129) and remaps (#138).
 *
 * A window's `start` and `end` are **seconds into the entry's trimmed
 * range** (0 is the entry's in-point), matching `ZoomSpec.start`: like a
 * zoom, an effect keeps its offset when the entry is retrimmed, and
 * normalization re-clamps it into the new range. Unlike zooms, windows on
 * one entry may overlap: a blur and a vignette at once is a valid stack.
 *
 * Each definition carries one rule, `look`, that turns its parameters into
 * a `PictureLook`: filter functions for the picture and layers drawn over
 * it, every size a fraction of the frame. Both renderers consume that one
 * rule (#66): the preview maps it to CSS (`PreviewPlayer`), the export to
 * the canvas (`exportVideo.ts`), and `pictureLook.ts` resolves an entry's
 * looks at an instant, with the ease, for both.
 */

/** What an effect's edit fields set: its window and its parameter values. */
export interface PictureEffectSpec {
  /** Seconds into the entry's trimmed range where the effect begins. */
  start: number
  /** Seconds into the entry's trimmed range where it ends. start < end on input. */
  end: number
  /**
   * The effect's parameter values by key, e.g. `{ strength: 0.6 }`. Every
   * value is finite. Which keys an effect has, and their ranges, are its
   * definition's (`pictureEffectParamsFor`); the model checks structure only.
   */
  params: Readonly<Record<string, number>>
}

/** A picture effect owned by one timeline entry. An entry may carry several. */
export interface PictureEffect extends PictureEffectSpec {
  /** Unique per effect: the handle update and remove act on. */
  id: string
  entryId: string
  /**
   * The registry id of the effect's definition, e.g. 'vignette'. Recorded
   * in project files, so it is never reused for a different effect. An id
   * no definition is registered for stays in the project and renders as
   * nothing, as a disabled plugin's transition does.
   */
  type: string
}

/**
 * Whether a spec is acceptable input at all: a finite, non-empty window
 * and finite parameter values under non-empty keys. Rejected rather than
 * clamped, like an invalid zoom or remap spec.
 */
export function isValidPictureEffectSpec(spec: PictureEffectSpec): boolean {
  return (
    Number.isFinite(spec.start) &&
    Number.isFinite(spec.end) &&
    spec.start < spec.end &&
    typeof spec.params === 'object' &&
    spec.params !== null &&
    Object.entries(spec.params).every(([key, value]) => key !== '' && Number.isFinite(value))
  )
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/**
 * Clamps an effect's window into its entry's trimmed length: the start into
 * [0, length], the end into [start, length]. A window that no longer fits
 * collapses against the end rather than being dropped, as a zoom's does on
 * a retrim. The same object when nothing moved, so a no-op normalization
 * keeps every reference.
 */
export function clampPictureEffect<T extends PictureEffectSpec>(effect: T, trimmedLength: number): T {
  const length = Math.max(0, trimmedLength)
  const start = clamp(effect.start, 0, length)
  const end = clamp(effect.end, start, length)
  return start === effect.start && end === effect.end ? effect : { ...effect, start, end }
}

/** Whether two parameter records hold the same keys with the same values. */
function paramsEqual(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && a[key] === b[key])
}

/** Whether two specs are the same window with the same parameter values. */
export function pictureEffectSpecsEqual(a: PictureEffectSpec, b: PictureEffectSpec): boolean {
  return a.start === b.start && a.end === b.end && paramsEqual(a.params, b.params)
}

/** Whether two effects are the same in every field. */
export function pictureEffectsEqual(a: PictureEffect, b: PictureEffect): boolean {
  return a.id === b.id && a.entryId === b.entryId && a.type === b.type && pictureEffectSpecsEqual(a, b)
}

/** One parameter a picture effect's definition declares: an edit field's range and default. */
export interface PictureEffectParam {
  /** The key in `PictureEffectSpec.params`, e.g. 'strength'. */
  key: string
  /** The field's label, sentence case, e.g. 'Strength'. */
  label: string
  min: number
  max: number
  /** The value a new effect starts with. Within [min, max]. */
  default: number
  /** A unit the field shows after its value, e.g. 'px'. None for a plain number. */
  unit?: string
}

/**
 * A filter function a look applies to the entry's picture, its source
 * pixels only: the preview sets it on the media element's CSS `filter`, the
 * export on the canvas `filter` around the source draw, after the entry's
 * colour adjustments in both. Redactions and spotlights stay sharp, since
 * they sit beside the media element in the preview.
 *
 * - `blur`: a Gaussian blur whose `radius` is a **fraction of the frame
 *   width**, not px, so a preview frame and a 1080p export blur alike.
 * - `sepia` (#870): CSS's `sepia(amount)`, `amount` in [0, 1], 0 the
 *   picture unchanged and 1 fully toned.
 * - `brightness` (#870): CSS's `brightness(amount)`, a multiplier, 1 the
 *   picture unchanged.
 *
 * Sepia and brightness are pointwise colour matrices, defined alike for
 * CSS and the canvas `filter` (Filter Effects), and have no size, so
 * neither depends on the frame's width or a zoom's scale as a blur does.
 */
export type PictureFilter =
  | { kind: 'blur'; radius: number }
  | { kind: 'sepia'; amount: number }
  | { kind: 'brightness'; amount: number }

/**
 * A layer a look draws over the entry's picture as framed: over the whole
 * frame-shaped card, after the entry's zoom and before its transition, so
 * it stays on the frame's edges while a zoom moves inside it and travels
 * with the card through a push or cross-zoom.
 *
 * - `vignette`: black, transparent out to `inner` and reaching alpha
 *   `strength` at the frame's corners, along an ellipse of the frame's own
 *   aspect (`vignetteStops` gives both renderers the same stops).
 *
 * - `grain` (#870): a generated texture, monochrome noise in square cells
 *   `cell` of the frame width across, each cell lightening or darkening
 *   the picture by up to `amount` (an alpha in [0, 1]). `seed` picks the
 *   pattern, and a look sets it from `textureStep`, so the pattern is a
 *   pure function of the entry's time. `grainTile` turns it into pixels,
 *   the one tile both renderers stretch over the card (#66).
 *
 * - `scratches` (#870, Old film): a generated texture of thin, light,
 *   vertical lines the full height of the frame, a few at most and often
 *   none, at places and brightnesses `seed` picks; `amount` is the
 *   brightest scratch's alpha in [0, 1]. `scratchesTile` gives its pixels.
 *
 * - `dust` (#870, Old film): a generated texture of a few small specks,
 *   most dark and some light, at places `seed` picks; `amount` is the
 *   strongest speck's alpha in [0, 1]. `dustTile` gives its pixels.
 *
 * A look composes its layers in order, so grain over a vignette is one more
 * entry in the list, not a new mechanism.
 */
export type PictureLayer =
  | { kind: 'vignette'; strength: number; inner: number }
  | { kind: 'grain'; amount: number; cell: number; seed: number }
  | { kind: 'scratches'; amount: number; seed: number }
  | { kind: 'dust'; amount: number; seed: number }

/** The layer kinds that are generated textures, drawn from a `TextureTile`. */
export type TextureLayer = Extract<PictureLayer, { kind: 'grain' | 'scratches' | 'dust' }>

/**
 * How many distinct patterns a generated texture shows per second of its
 * entry's clock (#870): film's 24 frames a second. A texture never changes
 * between two steps, so a preview frame and an exported frame at the same
 * time draw the same pattern however their frame rates differ.
 */
export const PICTURE_TEXTURE_RATE = 24

/**
 * The texture step at `time`, seconds on the entry's source clock: what a
 * look passes as a generated layer's `seed`. The small lead keeps a time
 * that lies on a step boundary, such as 0.5 s, from flooring to the step
 * before it through float error.
 */
export function textureStep(time: number): number {
  return Math.floor(Math.max(0, time) * PICTURE_TEXTURE_RATE + 1e-6)
}

/** A generated layer's pixels: `width` × `height` RGBA, not premultiplied, as `ImageData` holds them. */
export interface TextureTile {
  width: number
  height: number
  data: Uint8ClampedArray
}

/**
 * A hash of three integers to [0, 1): the texture's only source of
 * randomness, so a pattern depends on its seed and the cell alone and is
 * identical on every call, in every renderer and browser.
 */
export function textureHash(seed: number, x: number, y: number): number {
  return textureBits(seed, x, y) / 4294967296
}

/** `textureHash`'s 32 bits, as an unsigned integer. */
function textureBits(seed: number, x: number, y: number): number {
  let hash = Math.imul(seed | 0, 0x27d4eb2d) ^ Math.imul(x | 0, 0x165667b1) ^ Math.imul(y | 0, 0x9e3779b1)
  hash = Math.imul(hash ^ (hash >>> 15), 0x85ebca6b)
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35)
  return (hash ^ (hash >>> 16)) >>> 0
}

/** Whether this platform stores a 32-bit integer's low byte first, as typed-array views follow. */
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1

/**
 * The most cells a grain tile has across, whatever its cell size: bounds
 * the cost of a step's tile, about 11 ms at this width in Node, where 1920
 * took about 44 ms and held a 1080p preview to 10 frames a second (#870).
 */
const MAX_GRAIN_COLUMNS = 960

/**
 * A grain layer's tile for a frame of `aspect` (width over height): one
 * pixel per cell, `round(1 / cell)` across and as many down as the aspect
 * gives, which the renderer stretches over the frame-shaped card. Each
 * cell's value is the sum of two uniforms less one, the two 16-bit halves
 * of one `textureHash`: a triangular spread in
 * [−1, 1] that clusters near 0 as real grain does: a positive value is
 * white at alpha `value × amount`, a negative one black at `−value ×
 * amount`. So the grain lightens and darkens about evenly, and its mean
 * effect on the picture is close to none.
 */
export function grainTile(layer: Extract<PictureLayer, { kind: 'grain' }>, aspect: number): TextureTile {
  const width = Math.max(1, Math.min(MAX_GRAIN_COLUMNS, Math.round(1 / Math.max(layer.cell, 1e-6))))
  const height = Math.max(1, Math.round(width / (aspect > 0 && Number.isFinite(aspect) ? aspect : 16 / 9)))
  const amount = clamp(layer.amount, 0, 1) * 255
  const data = new Uint8ClampedArray(width * height * 4)
  // Written a pixel at a time through a 32-bit view, in the platform's
  // byte order, so each pixel lands as R, G, B, A bytes either way.
  const pixels = new Uint32Array(data.buffer)
  const white = LITTLE_ENDIAN ? 0x00ffffff : 0xffffff00
  for (let y = 0, index = 0; y < height; y++) {
    for (let x = 0; x < width; x++, index++) {
      // One hash, split into two 16-bit uniforms: half the work of two.
      const hash = textureBits(layer.seed, x, y)
      const value = ((hash & 0xffff) + (hash >>> 16)) / 65536 - 1
      const alpha = Math.round(Math.abs(value) * amount)
      pixels[index] = LITTLE_ENDIAN ? (alpha << 24) | (value > 0 ? white : 0) : (value > 0 ? white : 0) | alpha
    }
  }
  return { width, height, data }
}

/**
 * How many columns a scratches tile has across: a scratch is one column,
 * 2 px of a 1080p frame. The tile is short, `SCRATCH_ROWS` down, because a
 * scratch only varies slowly along its length; the renderer stretches it.
 */
export const SCRATCH_COLUMNS = 960
/** How many rows a scratches tile has down: a scratch's brightness changes every 40 px of a 1080p frame. */
export const SCRATCH_ROWS = 27
/** How many scratches a step can show at most. Each appears with `SCRATCH_CHANCE`, so most steps show none or one. */
export const MAX_SCRATCHES = 3
/** The chance that each of a step's `MAX_SCRATCHES` candidates shows. */
export const SCRATCH_CHANCE = 0.3

/**
 * A scratches layer's tile for a frame of `aspect`: `SCRATCH_COLUMNS` ×
 * `SCRATCH_ROWS`, transparent but for up to `MAX_SCRATCHES` white columns.
 * Each candidate scratch shows when its hash falls under `SCRATCH_CHANCE`;
 * its column and its peak alpha (half to all of `amount`) come from further
 * hashes, and its alpha along its length wavers between 40 % and 100 % of
 * that peak, row by row. Every hash takes the layer's `seed` with cells no
 * grain tile reaches (negative x), so the scratches are independent of the
 * grain at the same step. `aspect` is unused: a scratch spans the frame's
 * height whatever its shape. It is taken so every texture tile has one
 * signature.
 */
export function scratchesTile(layer: Extract<PictureLayer, { kind: 'scratches' }>, _aspect: number): TextureTile {
  const width = SCRATCH_COLUMNS
  const height = SCRATCH_ROWS
  const data = new Uint8ClampedArray(width * height * 4)
  const amount = clamp(layer.amount, 0, 1)
  if (amount === 0) return { width, height, data }
  for (let scratch = 0; scratch < MAX_SCRATCHES; scratch++) {
    const x = -100 - scratch
    if (textureHash(layer.seed, x, -1) >= SCRATCH_CHANCE) continue
    const column = Math.min(width - 1, Math.floor(textureHash(layer.seed, x, -2) * width))
    const peak = amount * (0.5 + 0.5 * textureHash(layer.seed, x, -3))
    for (let row = 0; row < height; row++) {
      const index = (row * width + column) * 4
      const alpha = Math.round(peak * (0.4 + 0.6 * textureHash(layer.seed, x, row)) * 255)
      // Two scratches on one column keep the brighter.
      if (alpha <= data[index + 3]) continue
      data[index] = 255
      data[index + 1] = 255
      data[index + 2] = 255
      data[index + 3] = alpha
    }
  }
  return { width, height, data }
}

/** How many columns a dust tile has across: a speck is one cell, 4 px of a 1080p frame, softened by the stretch. */
export const DUST_COLUMNS = 480
/** How many specks a step can show at most. The count is uniform from none to this. */
export const MAX_DUST = 6
/** The share of specks that are light rather than dark. */
export const DUST_LIGHT_SHARE = 0.25

/**
 * A dust layer's tile for a frame of `aspect`: `DUST_COLUMNS` across and as
 * many rows as the aspect gives, transparent but for none to `MAX_DUST`
 * specks. Each speck's cell, shade (black, or white for `DUST_LIGHT_SHARE`
 * of them) and alpha (60 % to 100 % of `amount`) come from hashes of the
 * layer's `seed` at cells no grain tile reaches, so the dust is independent
 * of the grain and the scratches.
 */
export function dustTile(layer: Extract<PictureLayer, { kind: 'dust' }>, aspect: number): TextureTile {
  const width = DUST_COLUMNS
  const height = Math.max(1, Math.round(width / (aspect > 0 && Number.isFinite(aspect) ? aspect : 16 / 9)))
  const data = new Uint8ClampedArray(width * height * 4)
  const amount = clamp(layer.amount, 0, 1)
  if (amount === 0) return { width, height, data }
  const count = Math.min(MAX_DUST, Math.floor(textureHash(layer.seed, -200, -1) * (MAX_DUST + 1)))
  for (let speck = 0; speck < count; speck++) {
    const x = -201 - speck
    const column = Math.min(width - 1, Math.floor(textureHash(layer.seed, x, -1) * width))
    const row = Math.min(height - 1, Math.floor(textureHash(layer.seed, x, -2) * height))
    const shade = textureHash(layer.seed, x, -3) < DUST_LIGHT_SHARE ? 255 : 0
    const alpha = Math.round(amount * (0.6 + 0.4 * textureHash(layer.seed, x, -4)) * 255)
    const index = (row * width + column) * 4
    data[index] = shade
    data[index + 1] = shade
    data[index + 2] = shade
    data[index + 3] = alpha
  }
  return { width, height, data }
}

/** A texture layer's tile for a frame of `aspect`, whichever kind it is: what both renderers stretch over the card. */
export function textureTile(layer: TextureLayer, aspect: number): TextureTile {
  switch (layer.kind) {
    case 'grain':
      return grainTile(layer, aspect)
    case 'scratches':
      return scratchesTile(layer, aspect)
    case 'dust':
      return dustTile(layer, aspect)
  }
}

/**
 * A key that changes exactly when a texture layer's tile does, for a
 * renderer that keeps the last tile it drew.
 */
export function textureTileKey(layer: TextureLayer, aspect: number): string {
  return layer.kind === 'grain'
    ? `grain:${layer.seed}:${layer.amount}:${layer.cell}:${aspect}`
    : `${layer.kind}:${layer.seed}:${layer.amount}:${aspect}`
}

/** What an entry's effects do to its picture at one instant. */
export interface PictureLook {
  filters: readonly PictureFilter[]
  layers: readonly PictureLayer[]
}

/** The look of no effect: an entry without one draws exactly as before. */
export const NO_PICTURE_LOOK: PictureLook = { filters: [], layers: [] }

/** One colour stop of a vignette: black at `alpha`, `offset` along the radius (0 centre, 1 corner). */
export interface VignetteStop {
  offset: number
  alpha: number
}

/** How many stops approximate the vignette's smooth falloff. */
const VIGNETTE_STEPS = 6

/**
 * A vignette's gradient stops, the one curve both renderers draw (#66):
 * transparent out to `inner`, then a smoothstep to `strength` at the
 * corner, sampled at even steps because neither a CSS gradient nor a
 * canvas gradient eases between two stops by itself.
 */
export function vignetteStops(layer: Extract<PictureLayer, { kind: 'vignette' }>): VignetteStop[] {
  const inner = clamp(layer.inner, 0, 1)
  const strength = clamp(layer.strength, 0, 1)
  const stops: VignetteStop[] = [{ offset: inner, alpha: 0 }]
  for (let step = 1; step <= VIGNETTE_STEPS; step++) {
    const t = step / VIGNETTE_STEPS
    stops.push({ offset: inner + (1 - inner) * t, alpha: strength * t * t * (3 - 2 * t) })
  }
  return stops
}

/**
 * One registered picture effect (#862). **This interface is a contract
 * plugins depend on** (ADR 0003), like `TransitionDefinition`: change it
 * deliberately, with every registration updated in the same change. It
 * carries an id, a menu name, the parameter declarations, and the rule
 * both renderers draw from (`look`).
 */
export interface PictureEffectDefinition {
  /**
   * Stable identifier: what timeline state and project files record (e.g.
   * 'vignette'). Never reused for a different effect.
   */
  id: string
  /** The + Effect ▾ menu name, sentence case (e.g. 'Vignette'). */
  name: string
  /** The effect's parameters, in the order its fields show them. */
  params: readonly PictureEffectParam[]
  /**
   * The rendering rule: the look of this effect with `params` (already
   * fitted by `pictureEffectParamsFor`) at `weight` in [0, 1], the ease's
   * progress, and at `time`, seconds on the entry's source clock (#870),
   * the clock its window is measured on. Weight 0 must change nothing, so
   * the effect cannot pop at either end of its window. Pure: both
   * renderers call it every frame, so anything that varies over time, such
   * as a generated texture's pattern, is a function of `time` alone
   * (`textureStep`), never of `Math.random()`. An effect that does not
   * change over time ignores it. `pictureLookAt` always passes it; a
   * caller that omits it, such as a test of a timeless effect, means 0.
   */
  look: (params: Readonly<Record<string, number>>, weight: number, time?: number) => PictureLook
}

/**
 * A definition's parameter values for an effect: each declared key's value
 * clamped into its range, or the default where it is missing, and any key
 * the definition does not declare dropped. How an edit field's commit, and
 * a new effect's starting values, are made to fit the definition.
 */
export function pictureEffectParamsFor(
  definition: PictureEffectDefinition,
  params: Readonly<Record<string, number>> = {},
): Record<string, number> {
  return Object.fromEntries(
    definition.params.map((param) => {
      const value = params[param.key]
      return [param.key, Number.isFinite(value) ? clamp(value, param.min, param.max) : param.default]
    }),
  )
}

/** Why a definition cannot be registered, or null when it can. */
function definitionProblem(definition: PictureEffectDefinition): string | null {
  if (definition.id === '') return 'its id is empty'
  const keys = new Set<string>()
  for (const param of definition.params) {
    if (param.key === '') return 'a parameter key is empty'
    if (keys.has(param.key)) return `the parameter '${param.key}' is declared twice`
    keys.add(param.key)
    const bounds = [param.min, param.max, param.default]
    if (!bounds.every(Number.isFinite) || param.min > param.max) {
      return `the parameter '${param.key}' has no valid range`
    }
    if (param.default < param.min || param.default > param.max) {
      return `the parameter '${param.key}' has a default outside its range`
    }
  }
  return null
}

/**
 * Registry of picture effects, in registration order, which is menu order.
 * The app uses the `pictureEffectRegistry` singleton; tests construct their
 * own. Mirrors the transition registry (#199): `register`/`unregister` are
 * how a plugin's contributions arrive and leave, and `subscribe` + `version`
 * pair with React's `useSyncExternalStore` so the menu re-reads the
 * registry when plugins change it at runtime. No effect is built in: every
 * definition comes from a plugin.
 */
export class PictureEffectRegistry {
  private readonly definitions = new Map<string, PictureEffectDefinition>()
  private readonly listeners = new Set<() => void>()
  /** Monotonic change counter: the snapshot for `useSyncExternalStore`. */
  version = 0

  /**
   * Adds a definition. A duplicate id, or a parameter with no valid range,
   * is a programming error and throws.
   */
  register(definition: PictureEffectDefinition): void {
    if (this.definitions.has(definition.id)) {
      throw new Error(`Picture effect '${definition.id}' is already registered.`)
    }
    const problem = definitionProblem(definition)
    if (problem !== null) {
      throw new Error(`Picture effect '${definition.id}' cannot be registered: ${problem}.`)
    }
    this.definitions.set(definition.id, definition)
    this.notify()
  }

  /**
   * Removes a definition: how a disabled plugin's contributions leave the
   * menu. Effects of that type stay on the timeline. Removing an id that is
   * not registered is a no-op, so a plugin's deactivate stays safe whatever
   * order teardown runs in.
   */
  unregister(id: string): void {
    if (this.definitions.delete(id)) this.notify()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    this.version++
    for (const listener of this.listeners) listener()
  }

  has(id: string): boolean {
    return this.definitions.has(id)
  }

  /** The definition for `id`, or undefined for an unregistered id. */
  find(id: string): PictureEffectDefinition | undefined {
    return this.definitions.get(id)
  }

  /** All registered definitions, in registration order. */
  list(): PictureEffectDefinition[] {
    return [...this.definitions.values()]
  }
}

/** The app's registry. Plugins register into it when enabled. */
export const pictureEffectRegistry = new PictureEffectRegistry()

/**
 * The picture-effect types in `types` that no registered definition covers:
 * what the project-open flow checks *after* plugin dependencies are settled,
 * as it does transitions (#199). A type still unknown then is either a
 * corrupt file or one saved by a newer build.
 */
export function unregisteredPictureEffectTypes(
  types: Iterable<string>,
  registry: PictureEffectRegistry = pictureEffectRegistry,
): string[] {
  return [...new Set(types)].filter((type) => !registry.has(type))
}

/**
 * How long a new picture effect's window is, in the entry's seconds (#862):
 * a new zoom's whole window (`DEFAULT_ZOOM`'s 0.5 s in, 1 s hold, 0.5 s
 * out), so + Effect ▾'s items all add something of one size.
 */
export const DEFAULT_PICTURE_EFFECT_SECONDS = 2

/**
 * Where + Effect ▾ puts a new effect of a type (#862), the way
 * `defaultZoomFor` places a new zoom: at the start of the first gap between
 * the entry's effects **of the same type** that holds
 * `DEFAULT_PICTURE_EFFECT_SECONDS`, or across the widest gap when none
 * does. Effects of different types may overlap, since a blur under a
 * vignette is a stack, so only the same type's windows take room. Null when
 * that type already covers the whole entry: the item is then disabled, as
 * Zoom's is.
 */
export function defaultPictureEffectWindow(
  sameType: readonly Pick<PictureEffectSpec, 'start' | 'end'>[],
  trimmedLength: number,
): { start: number; end: number } | null {
  const sorted = [...sameType].sort((a, b) => a.start - b.start)
  const gaps: { start: number; length: number }[] = []
  let cursor = 0
  for (const effect of sorted) {
    if (effect.start > cursor) gaps.push({ start: cursor, length: effect.start - cursor })
    cursor = Math.max(cursor, effect.end)
  }
  if (trimmedLength > cursor) gaps.push({ start: cursor, length: trimmedLength - cursor })
  if (gaps.length === 0) return null
  const gap =
    gaps.find((candidate) => candidate.length >= DEFAULT_PICTURE_EFFECT_SECONDS) ??
    gaps.reduce((widest, candidate) => (candidate.length > widest.length ? candidate : widest))
  return { start: gap.start, end: gap.start + Math.min(DEFAULT_PICTURE_EFFECT_SECONDS, gap.length) }
}

/**
 * What the entry's row calls each of its picture effects (#862), by id:
 * the definition's name numbered per type in window order ("Vignette 1",
 * "Blur 1", "Vignette 2"), as the row numbers speed segments and pauses
 * separately. A type no definition covers is named by its id and marked
 * "(unavailable)", as a disabled plugin's transition is (#199). The Trim
 * window's warnings (`trimEffects.ts`) use the same names.
 */
export function pictureEffectNames(
  effects: readonly Pick<PictureEffect, 'id' | 'type'>[],
  registry: PictureEffectRegistry = pictureEffectRegistry,
): Map<string, string> {
  const counts = new Map<string, number>()
  const names = new Map<string, string>()
  for (const effect of effects) {
    const count = (counts.get(effect.type) ?? 0) + 1
    counts.set(effect.type, count)
    const definition = registry.find(effect.type)
    names.set(
      effect.id,
      definition === undefined ? `${effect.type} ${count} (unavailable)` : `${definition.name} ${count}`,
    )
  }
  return names
}
