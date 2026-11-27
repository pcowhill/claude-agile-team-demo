/**
 * Rounding an SVG filter's numbers to whole device pixels (#980, #1021).
 * Chromium and Firefox land a fractional value on the pixel grid
 * differently: Chromium rounds it to the nearest device pixel, and Firefox
 * truncates it toward zero. 3.8 px was drawn as 4 px in Chromium and 3 px
 * in Firefox (CI run 45739047158). A whole number of device px is drawn
 * alike by both. The channel offset's shift (`channelOffsetFilter.ts`) and
 * the slices' band edges and shifts (`slicesFilter.ts`) are both rounded
 * here: canvas px for the export, at a ratio of 1, and device px for the
 * preview, at `devicePixelRatio`.
 */

/** `ratio` when it is a usable density, else 1. */
export function usableRatio(ratio: number): number {
  return ratio > 0 && Number.isFinite(ratio) ? ratio : 1
}

/**
 * The whole number of device px nearest `value` px at `ratio` device px per
 * px, rounding halves away from zero, with no negative zero.
 */
export function wholeDevicePx(value: number, ratio: number): number {
  const whole = Math.round(Math.abs(value) * ratio)
  return whole === 0 ? 0 : Math.sign(value) * whole
}

/**
 * `value`, in px, rounded to a whole number of device pixels at `ratio`
 * device px per px, with no negative zero. It is written back in px, to at
 * most 4 decimals. The result is nudged up by 0.0001 px steps until it
 * holds at least that number of device px, even read as a 32-bit float.
 * Firefox truncates, so a 5.6 that reads as 5.5999999 at a ratio of 1.25
 * would land 6 device px instead of 7.
 */
export function deviceRounded(value: number, ratio: number): number {
  const whole = Math.abs(wholeDevicePx(value, ratio))
  if (whole === 0) return 0
  const reaches = (px: number) =>
    px * ratio >= whole && Math.fround(Math.fround(px) * Math.fround(ratio)) >= whole
  let px = Number((whole / ratio).toFixed(4))
  while (!reaches(px)) px = Number((px + 0.0001).toFixed(4))
  return Math.sign(value) * px
}
