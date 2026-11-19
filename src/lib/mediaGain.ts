/**
 * Putting a composed gain on a media element (#692).
 *
 * `gain.ts` composes volume, mute, fades, transitions and ducking into one
 * number, and since #692 that number may exceed 1: Volume goes to
 * `MAX_VOLUME`. A media element's own `volume` cannot — browsers throw on
 * anything above 1 — so a gain is split in two:
 *
 * - the element's `volume` carries the part up to 1, exactly as it carried
 *   every gain before #692, so a project with no Volume above 1 drives the
 *   elements with the very same numbers it always did;
 * - a Web Audio `GainNode` after the element (its **boost**) carries the
 *   rest: 1 while the gain is at or below 1, the gain itself above it.
 *
 * Their product is the composed gain. An element has a boost only once
 * something has routed it into an audio graph: the export routes every
 * element it records (`createAudioCapture`), and the preview routes one
 * lazily, the first time its gain passes 1 (`PreviewPlayer.tsx`). An element
 * with no boost plays a gain above 1 at 1 — never louder than full volume,
 * never an exception.
 */

/** The boost after an element: anything with an assignable `gain.value`. */
export interface BoostNode {
  readonly gain: { value: number }
}

/** What a gain is put on: a media element, or a test's stand-in for one. */
export interface GainTarget {
  volume: number
}

/** Routes an element into a graph and returns its boost; null when it cannot. */
export type BoostRoute = (element: GainTarget) => BoostNode | null

const boosts = new WeakMap<object, BoostNode>()
const intended = new WeakMap<object, number>()

/** Records that `element` plays through `node`, so gains above 1 reach it (#692). */
export function attachBoost(element: object, node: BoostNode): void {
  boosts.set(element, node)
}

/** The boost an element plays through, if it has one. */
export function boostOf(element: object): BoostNode | undefined {
  return boosts.get(element)
}

/**
 * The gain last asked of an element — above 1 when its boost carries part
 * of it — or, for an element never given one here, its own `volume`. An
 * export's audio twin (#611) follows its replay's gain through this, since
 * the replay's `volume` alone stops at 1.
 */
export function intendedGain(element: GainTarget): number {
  return intended.get(element) ?? element.volume
}

/**
 * Puts a composed gain on an element (#692): its `volume` takes the part up
 * to 1 and its boost the rest. Without a boost, `route` (when given) is
 * asked for one — but only once the gain passes 1, so an element that never
 * needs one is never routed and plays exactly as before.
 */
export function setMediaGain(element: GainTarget, gain: number, route?: BoostRoute): void {
  const wanted = Number.isFinite(gain) ? Math.max(gain, 0) : 0
  intended.set(element, wanted)
  let boost = boosts.get(element)
  if (boost === undefined && wanted > 1 && route !== undefined) {
    boost = route(element) ?? undefined
    if (boost !== undefined) boosts.set(element, boost)
  }
  element.volume = Math.min(wanted, 1)
  if (boost !== undefined) {
    const value = Math.max(wanted, 1)
    if (boost.gain.value !== value) {
      boost.gain.value = value
      // Readable from the page (#692's preview criterion): a GainNode is
      // not, and the element's own `volume` stops at 1.
      if (typeof HTMLElement !== 'undefined' && element instanceof HTMLElement) element.dataset.boost = String(value)
    }
  }
}

/**
 * Whether this browser plays a media element at its `playbackRate` once its
 * audio is captured into Web Audio (#611). Chromium does. Firefox does not:
 * an element routed through `createMediaElementSource` (or captured with
 * `mozCaptureStream`) reports the rate it was given and plays at 1× anyway.
 * Measured in Firefox 153 on a video-only WebM set to 0.5: 0.47× plain, 0.94×
 * captured, while Chromium plays 0.50× either way. `mozCaptureStream` is the
 * Gecko marker — the engine with the limitation, not a user-agent string.
 */
export function capturedElementsHonourPlaybackRate(): boolean {
  return typeof HTMLMediaElement === 'undefined' || !('mozCaptureStream' in HTMLMediaElement.prototype)
}

let previewContext: AudioContext | null | undefined

/**
 * The preview's route (#692): the first time an element's gain passes 1,
 * its sound is taken into one page-wide `AudioContext` — element, boost,
 * speakers — and stays there for the element's life (a media element can
 * be sourced into a graph only once). Elements that never pass 1 are never
 * routed, so a project with no Volume above 1 plays exactly as before.
 *
 * Null — the element plays at most at full volume — where Web Audio is
 * missing or refuses the element, and in a browser whose routed elements
 * ignore `playbackRate` (Firefox, #611): there a routed element would play
 * at 1× through a speed segment or a review speed, and the preview, which
 * re-seeks any element that drifts, would stutter through it. The export
 * has a twin for that case; the preview does not, so it stops at 1 there.
 */
export const previewBoostRoute: BoostRoute = (element) => {
  if (!capturedElementsHonourPlaybackRate()) return null
  if (typeof HTMLMediaElement === 'undefined' || !(element instanceof HTMLMediaElement)) return null
  try {
    if (previewContext === undefined) {
      previewContext = typeof AudioContext === 'undefined' ? null : new AudioContext()
    }
    if (previewContext === null) return null
    const context = previewContext
    const boost = context.createGain()
    context.createMediaElementSource(element).connect(boost)
    boost.connect(context.destination)
    wakePreviewAudio()
    return boost
  } catch {
    return null
  }
}

/**
 * Resumes the preview's context if it is suspended (#692). A routed element
 * sounds only through it, and a context made before the page's first
 * gesture — a Volume above 1 scrubbed to before anything was clicked —
 * starts suspended and plays nothing. Asked on every gain put on a routed
 * element, so whichever call follows the gesture wakes it.
 */
export function wakePreviewAudio(): void {
  if (previewContext?.state === 'suspended') previewContext.resume().catch(() => {})
}
