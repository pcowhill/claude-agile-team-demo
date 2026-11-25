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
 * The rule that draws an effect is not here yet. Both renderers will
 * consume one rule per definition (#66), and it arrives with them, so its
 * shape is set by what they need rather than in anticipation (ADR 0003).
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
 * One registered picture effect (#862). **This interface is a contract
 * plugins depend on** (ADR 0003), like `TransitionDefinition`: change it
 * deliberately, with every registration updated in the same change. It
 * carries what the model needs today, an id, a menu name and the parameter
 * declarations, and gains its rendering rule when the renderers that
 * consume it arrive.
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
