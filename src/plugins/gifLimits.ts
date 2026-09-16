/**
 * The GIF export plugin's stated limits (#198), kept out of the plugin's
 * lazy chunk — the `shapedWipesIds.ts` pattern: top-level wiring the entry
 * bundle may import without pulling in `gifenc`. The plugin's sink reads
 * them to encode; the user guide reads them to state them (#482, design
 * #477 §6.2), so the guide cannot say "10 fps" after the plugin says 15.
 * The reasoning behind each number lives beside its use in `gif/gifSink.ts`.
 */

/** Frames per second the GIF samples at: exactly 10 cs per frame. */
export const GIF_FRAME_RATE = 10

/** The longer side of the GIF is scaled down to at most this many pixels. */
export const GIF_MAX_DIMENSION = 480
