/**
 * The Volume range (#692): 0 is silent, 1 is the source as recorded, and
 * `MAX_VOLUME` is the loudest a source may be raised — 4, which is +12 dB.
 *
 * Before #692 Volume stopped at 1, because a media element's own `volume`
 * does; the part above 1 is now a Web Audio gain after the element
 * (`mediaGain.ts`). +12 dB is enough to bring a recording made at a low
 * microphone gain up to a speaking level, and little enough that a raised
 * source's room tone and hiss do not swamp the rest of the mix. Match
 * levels (#691) never raises a source past full scale whatever this says.
 */
export const MAX_VOLUME = 4

/** A Volume brought into range: 0 to `MAX_VOLUME`. Callers check finiteness. */
export function clampVolume(volume: number): number {
  return Math.min(Math.max(volume, 0), MAX_VOLUME)
}
