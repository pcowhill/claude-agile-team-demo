/**
 * Volume changes (#1025, from the customer's approval of #836): an element
 * with sound is turned down or up for a stretch of its time, with smooth
 * ramps either side, without being split into pieces whose volumes jump.
 *
 * A change is a **start**, a **length** and a **level**. The level is a
 * multiple of the element's own Volume, in the Volume field's units: 0 is
 * silent, 1 is unchanged, 0.2 is the "20 %" of #836's first example, up to
 * `MAX_VOLUME`.
 *
 * **Time base.** `start` is seconds into the element's *trimmed range*, 0
 * at its In: the base an entry's and an overlay's zooms use. On an audio
 * track that is simply seconds into the track's window. A change therefore
 * keeps its offset from In when the element is retrimmed, as a zoom does,
 * and normalization re-clamps it into the new range.
 *
 * **Ramps.** The level holds for the whole of `start` to `start + length`.
 * The factor ramps linearly from 1 to the level over
 * `VOLUME_CHANGE_RAMP_SECONDS` just *before* the change, and back over the
 * same time just *after* it: Duck others' convention (#241), so the change
 * is already at its level on its first instant. A ramp falling outside the
 * element's window is simply not heard, so a change starting at 0 plays at
 * its level from the first instant, and one ending at the window's end
 * stays at its level to the end. That is also what lets Split… divide a
 * change in two without a dip at the join.
 *
 * **Two changes closer than two ramps** move linearly from one level to the
 * next across the gap, so the factor never leaves the range spanned by the
 * two levels and 1.
 */
import { MAX_VOLUME, clampVolume } from './volume'

/** What a change is, without its handle: when, how long, and how loud. */
export interface VolumeChangeSpec {
  /** Seconds into the element's trimmed range where the level begins. ≥ 0. */
  start: number
  /** How long the level holds, in seconds. ≥ 0; 0 is a change that plays nothing. */
  length: number
  /** The element's volume for the stretch, as a multiple of its own: 0 to `MAX_VOLUME`. */
  level: number
}

/** One volume change on an element (#1025): a spec plus its handle. */
export interface VolumeChange extends VolumeChangeSpec {
  /** Unique within its element: what update and remove act on. */
  id: string
}

/**
 * The ramp at each side of a change, in seconds. The same as Duck others'
 * `DUCK_RAMP_SECONDS` (#241), the app's one other level change in the
 * middle of a sound; the suggestion's "about 0.3 s" asked for about this.
 */
export const VOLUME_CHANGE_RAMP_SECONDS = 0.25

/** How long a change added from + Effect ▾ lasts, in seconds, when there is room. */
export const DEFAULT_VOLUME_CHANGE_LENGTH = 2

/**
 * The level a change added from + Effect ▾ starts at: half as loud, so
 * adding one is heard at once, as adding a zoom is seen at once.
 */
export const DEFAULT_VOLUME_CHANGE_LEVEL = 0.5

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/** Whether a change's fields are finite numbers: ranges clamp, they are not refused. */
export function isValidVolumeChangeSpec(spec: VolumeChangeSpec): boolean {
  return Number.isFinite(spec.start) && Number.isFinite(spec.length) && Number.isFinite(spec.level)
}

/** Whether two changes' specs are the same (ids aside). */
export function volumeChangeSpecsEqual(a: VolumeChangeSpec, b: VolumeChangeSpec): boolean {
  return a.start === b.start && a.length === b.length && a.level === b.level
}

/**
 * Changes normalized against a window of `windowLength` seconds: sorted by
 * start (ties keep their stored order), each starting at or after the
 * previous one ends, every one inside `[0, windowLength]`, and every level
 * clamped to 0 to `MAX_VOLUME`. The earlier change wins an overlap, and what
 * no longer fits collapses against the window's end rather than being
 * dropped: the sweep zooms, remaps and Moves use (#129, #138, #834). Each
 * change that needed nothing is returned as the same object.
 */
export function sweptVolumeChanges<T extends VolumeChange>(changes: readonly T[], windowLength: number): T[] {
  const sorted = [...changes].sort((a, b) => a.start - b.start)
  const end = Math.max(0, windowLength)
  let cursor = 0
  return sorted.map((change) => {
    const start = clamp(change.start, cursor, end)
    const length = clamp(change.length, 0, end - start)
    const level = clampVolume(change.level)
    cursor = start + length
    if (start === change.start && length === change.length && level === change.level) return change
    return { ...change, start, length, level }
  })
}

/**
 * An element with its changes normalized against its trimmed window. The
 * same object when nothing moved, so a change-free element keeps every
 * reference and every saved byte; an empty list is stored as no key.
 */
export function withVolumeChangesClamped<
  T extends { inPoint: number; outPoint: number; volumeChanges?: VolumeChange[] },
>(element: T): T {
  if (element.volumeChanges === undefined) return element
  if (element.volumeChanges.length === 0) {
    const next = { ...element }
    delete next.volumeChanges
    return next
  }
  const swept = sweptVolumeChanges(element.volumeChanges, element.outPoint - element.inPoint)
  const unchanged =
    swept.length === element.volumeChanges.length &&
    swept.every((change, index) => change === element.volumeChanges?.[index])
  return unchanged ? element : { ...element, volumeChanges: swept }
}

/**
 * The multiplicative factor the changes apply `into` seconds into the
 * element's trimmed range: 1 away from every change, the level inside one,
 * and linear over the ramps (see the module comment). Changes must be
 * normalized (sorted, disjoint), as any published state's are. A change
 * with no length plays nothing, so it has no ramps either.
 */
export function volumeChangeFactorAt(changes: readonly VolumeChangeSpec[] | undefined, into: number): number {
  if (changes === undefined || changes.length === 0) return 1
  const ramp = VOLUME_CHANGE_RAMP_SECONDS
  const live = changes.filter((change) => change.length > 0)
  for (let index = 0; index < live.length; index++) {
    const change = live[index]
    const level = clampVolume(change.level)
    const end = change.start + change.length
    const previous = live[index - 1]
    if (into < change.start) {
      // In the gap before this change. Closer to the previous one than two
      // ramps: one straight line from its level to this one's.
      if (previous !== undefined) {
        const previousEnd = previous.start + previous.length
        const gap = change.start - previousEnd
        if (gap < 2 * ramp) {
          const from = clampVolume(previous.level)
          const f = gap > 0 ? (into - previousEnd) / gap : 1
          return from + (level - from) * clamp(f, 0, 1)
        }
        if (into < previousEnd + ramp) {
          const from = clampVolume(previous.level)
          return from + (1 - from) * ((into - previousEnd) / ramp)
        }
      }
      if (into <= change.start - ramp) return 1
      return level + (1 - level) * ((change.start - into) / ramp)
    }
    if (into <= end) return level
  }
  const last = live[live.length - 1]
  if (last === undefined) return 1
  const lastEnd = last.start + last.length
  if (into >= lastEnd + ramp) return 1
  const level = clampVolume(last.level)
  return level + (1 - level) * ((into - lastEnd) / ramp)
}

/**
 * An element's Volume with its changes applied at `into` seconds into its
 * trimmed range, clamped to `MAX_VOLUME`: a stretch is never louder than
 * the loudest Volume could make the element (#692's +12 dB).
 */
export function changedVolumeAt(
  volume: number,
  changes: readonly VolumeChangeSpec[] | undefined,
  into: number,
): number {
  return Math.min(clampVolume(volume) * volumeChangeFactorAt(changes, into), MAX_VOLUME)
}

/**
 * What + Effect ▾ › Volume change adds (#1025): a change of
 * `DEFAULT_VOLUME_CHANGE_LENGTH` (or what room is left) at
 * `DEFAULT_VOLUME_CHANGE_LEVEL`, starting where the element's last change
 * ends. Null when the window has no room left.
 */
export function defaultVolumeChangeFor(
  changes: readonly VolumeChangeSpec[] | undefined,
  windowLength: number,
): VolumeChangeSpec | null {
  const list = changes ?? []
  const last = list[list.length - 1]
  const start = last === undefined ? 0 : last.start + last.length
  const length = Math.min(DEFAULT_VOLUME_CHANGE_LENGTH, windowLength - start)
  if (!(length > 0)) return null
  return { start, length, level: DEFAULT_VOLUME_CHANGE_LEVEL }
}

/**
 * An element's changes divided at `at` seconds into its trimmed range, for
 * every edit that rebuilds an element as parts (Split…, Cut…, the ripple's
 * shortening):
 *
 * - **`before`**: the changes that end by `at`, unchanged, and the part
 *   before `at` of one that contains it;
 * - **`after`**, relative to `at`: the changes that start at or after it,
 *   shifted earlier by `at`, and the rest of one that contains it, from 0.
 *
 * A change across `at` becomes one in each part at the same level. Each
 * part's edge at `at` is a window edge, where no ramp is heard, so across
 * that change the two parts play on as the one did. A change that ends or
 * starts within `VOLUME_CHANGE_RAMP_SECONDS` of `at` is different: the part
 * of its ramp on the far side of `at` is not carried, so the part without
 * the change plays at full volume up to the join, where the original was
 * partway down the ramp (#1029's review measured 1.00 against 0.52 at
 * Level 0.2). The guide says so (`audio.md`, *Volume change*). Ids are
 * unique within an element, so both parts keep the original's.
 */
export function splitVolumeChangesAt<T extends VolumeChange>(
  changes: readonly T[] | undefined,
  at: number,
): { before: T[]; after: T[] } {
  const before: T[] = []
  const after: T[] = []
  for (const change of changes ?? []) {
    const end = change.start + change.length
    if (end <= at) before.push(change)
    else if (change.start >= at) after.push({ ...change, start: change.start - at })
    else {
      before.push({ ...change, length: at - change.start })
      after.push({ ...change, start: 0, length: end - at })
    }
  }
  return { before, after }
}
