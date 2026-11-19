/**
 * Match levels (#691, from the approved suggestion #540): one action that
 * measures every element with sound and writes into each one's existing
 * **Volume** the value that brings it to a common target. Nothing hidden:
 * the new values are the ordinary Volume fields, editable, and the whole
 * change is one undo step (`volumes-matched`).
 *
 * This module is the pure part — which elements count, and what each one's
 * Volume becomes given its measured window. Decoding and measuring are
 * `audioPeaks.ts` / `audioLevels.ts`; the App wires them together.
 *
 * **Within 0–1.** Volume is a media element's `volume`, which the browser
 * caps at 1, and the preview and the export both rely on that property; so
 * an element quieter than the target goes to 1 and is reported as below
 * target. Raising it further is #692.
 *
 * **Clipping guard.** No element is set to a volume at which its window's
 * peak would pass full scale, whatever the target asks.
 */

import { dbToGain, windowLevel } from './audioLevels'
import type { ClipLevels } from './audioLevels'
import { isImageOverlay } from './videoOverlay'
import { audioTracksOf, videoOverlaysOf } from './timeline'
import type { TimelineState } from './timeline'

/** Which of the three sound-bearing kinds an element is (#691). */
export type LevelElementKind = 'entry' | 'video-overlay' | 'audio-track'

/** One element Match levels may set: what it plays and its current Volume. */
export interface LevelElement {
  kind: LevelElementKind
  id: string
  /** How the report names it: the element's name and where it sits. */
  label: string
  /** The source's object URL, the decode cache's key. */
  url: string
  /** The trimmed window, in source seconds: what actually plays. */
  inPoint: number
  outPoint: number
  /** The current Volume, 0–1 (absent in the state means 1). */
  volume: number
}

/**
 * The elements Match levels acts on (#691), in timeline order: video
 * entries, then video overlays, then audio tracks. Skipped without comment:
 * stills, slates and image overlays, which have no sound, and muted entries
 * and overlays, which the user has silenced on purpose — muting wins over
 * Volume, so a level written into one would change nothing anyone hears.
 */
export function levelElements(state: TimelineState): LevelElement[] {
  const elements: LevelElement[] = []
  state.entries.forEach((entry, index) => {
    if (entry.kind !== undefined || entry.muted === true) return
    elements.push({
      kind: 'entry',
      id: entry.id,
      label: `${entry.name} (sequence, position ${index + 1})`,
      url: entry.url,
      inPoint: entry.inPoint,
      outPoint: entry.outPoint,
      volume: entry.volume ?? 1,
    })
  })
  videoOverlaysOf(state).forEach((overlay, index) => {
    if (isImageOverlay(overlay) || overlay.muted === true) return
    elements.push({
      kind: 'video-overlay',
      id: overlay.id,
      label: `${overlay.name} (overlay, position ${index + 1})`,
      url: overlay.url,
      inPoint: overlay.inPoint,
      outPoint: overlay.outPoint,
      volume: overlay.volume ?? 1,
    })
  })
  audioTracksOf(state).forEach((track, index) => {
    elements.push({
      kind: 'audio-track',
      id: track.id,
      label: `${track.name} (audio, position ${index + 1})`,
      url: track.url,
      inPoint: track.inPoint,
      outPoint: track.outPoint,
      volume: track.volume ?? 1,
    })
  })
  return elements
}

/**
 * The target level a fresh visitor matches to (#691): −20 dB, gated RMS
 * relative to full scale amplitude. It is the digital reference level for
 * speech in broadcast alignment (SMPTE RP 155 puts 0 VU at −20 dBFS), so
 * a clear voice recording lands near it already; and speech's peaks, some
 * 12–15 dB above its average, then sit around −5 to −8 dB — headroom left,
 * nothing near clipping. Within today's 0–1 Volume a target only lowers
 * what is louder than it, so a target well above typical recordings would
 * match nothing.
 */
export const DEFAULT_MATCH_TARGET_DB = -20

/** What happened to one element (#691). */
export type MatchOutcome =
  /** Its Volume now brings it to the target. */
  | 'matched'
  /** It needs more than Volume 1 to reach the target; it is at 1. */
  | 'below-target'
  /** Its peak would pass full scale on the way to the target; it stops short. */
  | 'peak-limited'
  /** Its sound could not be decoded, so it was left as it was. */
  | 'undecodable'
  /** Its window holds no sound above the silence gate, so it was left as it was. */
  | 'silent'

export interface MatchResult {
  element: LevelElement
  outcome: MatchOutcome
  /** The Volume it ends at (its old one when left as it was). */
  volume: number
}

/**
 * Volumes are written to three decimals: the Volume field shows two, and a
 * thousandth of Volume 1 is 0.009 dB — below anything audible — while a
 * saved file is not cluttered with float noise.
 */
function roundVolume(volume: number): number {
  return Math.round(volume * 1000) / 1000
}

/**
 * Each element's new Volume (#691), given its clip's level blocks (`null`
 * when the clip could not be decoded) and the target in dB.
 *
 * The Volume that brings an element to the target is `10^((target − level) /
 * 20)`, measured on the source at Volume 1 — so the result does not depend
 * on where its Volume was before. It is then capped twice: at 1, the media
 * element's ceiling ("below target"), and at the Volume that puts the
 * window's peak exactly at full scale ("peak-limited"), whichever is lower.
 */
export function planMatchLevels(
  elements: readonly LevelElement[],
  levelsFor: (element: LevelElement) => ClipLevels | null,
  targetDb: number,
): MatchResult[] {
  return elements.map((element) => {
    const levels = levelsFor(element)
    if (levels === null) return { element, outcome: 'undecodable', volume: element.volume }
    const measured = windowLevel(levels, element.inPoint, element.outPoint)
    if (measured === null) return { element, outcome: 'silent', volume: element.volume }
    const wanted = dbToGain(targetDb - measured.levelDb)
    const peakCap = measured.peak > 0 ? 1 / measured.peak : Infinity
    if (wanted <= Math.min(1, peakCap)) {
      return { element, outcome: 'matched', volume: roundVolume(wanted) }
    }
    if (peakCap < 1) {
      // Floor, not round: rounding up could put the peak a hair past full scale.
      return { element, outcome: 'peak-limited', volume: Math.floor(peakCap * 1000) / 1000 }
    }
    return { element, outcome: 'below-target', volume: 1 }
  })
}

/**
 * The report's sentence (#691): how many elements were set, and each one
 * held back by name and reason. Short, because it is a status line, not a
 * dialog (#395).
 */
export function matchReport(results: readonly MatchResult[]): string {
  if (results.length === 0) return 'Match levels: no element with sound to match.'
  const matched = results.filter((result) => result.outcome === 'matched').length
  const reasons: Record<Exclude<MatchOutcome, 'matched'>, string> = {
    'below-target': 'below the target even at Volume 1',
    'peak-limited': 'stopped short so its peaks do not clip',
    undecodable: 'its sound could not be read, so it was left as it was',
    silent: 'no sound in its trim, so it was left as it was',
  }
  const held = results
    .filter((result) => result.outcome !== 'matched')
    .map((result) => `${result.element.label}: ${reasons[result.outcome as Exclude<MatchOutcome, 'matched'>]}`)
  const set = `Match levels set ${matched} of ${results.length} element${results.length === 1 ? '' : 's'} to the target.`
  return held.length === 0 ? set : `${set} ${held.join('; ')}.`
}
