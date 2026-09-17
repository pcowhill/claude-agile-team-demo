/**
 * Review speed (#522, from the customer-approved suggestion #515): how fast
 * the preview *plays*, as a property of watching rather than an edit.
 *
 * It is a lens, not a value: stored nowhere, rendered into nothing, and
 * multiplied into whatever rate the timeline's own effects already give a
 * clip — so a 2× speed segment reviewed at 2× plays at 4×, which is the
 * decision taken in #515 and stated in the guide rather than left to be
 * discovered.
 *
 * The four rates and the cap are #515's too: speech stays intelligible to
 * about 2× with pitch preserved (browsers preserve it by default and the app
 * does not set `preservesPitch`), and not far beyond.
 */

/** The offered rates, in the order the control and the shortcut step through. */
export const REVIEW_RATES = [0.5, 1, 1.5, 2] as const

export type ReviewRate = (typeof REVIEW_RATES)[number]

/** What a session starts at, and what a reload returns to. */
export const DEFAULT_REVIEW_RATE: ReviewRate = 1

/**
 * The next rate in the cycle, wrapping past the last back to the first —
 * what the shortcut does. An unknown rate steps to the default rather than
 * throwing: the only way to hold one is a bug, and a preview stuck at an
 * unrecognised speed should be one key away from normal.
 */
export function nextReviewRate(rate: number): ReviewRate {
  const at = REVIEW_RATES.indexOf(rate as ReviewRate)
  if (at === -1) return DEFAULT_REVIEW_RATE
  return REVIEW_RATES[(at + 1) % REVIEW_RATES.length]
}

/**
 * The rate as the control and the readout show it: `0.5×`, `1×`, `1.5×`,
 * `2×` — no trailing zero, because `1.0×` reads like a measurement rather
 * than a setting.
 */
export function formatReviewRate(rate: number): string {
  return `${rate}×`
}
