/**
 * The More export formats plugin's stated limits (#858), kept out of the
 * plugin's lazy chunk for the reason `gifLimits.ts` is (#503): the user
 * guide states them through its placeholders (`src/lib/guide/constants.ts`),
 * and importing the plugin module for a few numbers would pull its chunk
 * into the guide's. The plugin's sink reads the same constants, so the
 * guide cannot drift from what the export does.
 *
 * **Why the Animated WebP matches the GIF plugin's 10 fps and 480 px.**
 * The plugin encodes every frame as a standalone still (the browser has no
 * animated encoder), so a WebP frame costs about what a key frame does,
 * however little changed since the last one. Measured in Chromium on #858,
 * exporting two 4 s 1280×720 clips (FFmpeg's `testsrc2` pattern, and the
 * guide's static screenshot `editor-after-import.png`), against the GIF
 * plugin's 498,440 and 299,131 bytes for the same clips:
 *
 * | WebP settings          | testsrc2 | screenshot |
 * |------------------------|---------:|-----------:|
 * | 10 fps, 480 px, q 0.8  |  287,142 |    219,822 |
 * | 20 fps, 480 px, q 0.8  |  575,376 |    439,530 |
 * | 20 fps, 640 px, q 0.8  |  742,702 |    583,560 |
 * | 20 fps, 640 px, q 0.6  |  571,046 |    461,264 |
 *
 * At the GIF's own rate and size, WebP is 42% and 27% smaller, in full
 * colour. A faster rate or a larger frame makes it larger than the GIF it
 * is meant to improve on, and lowering the quality does not win that back.
 * So the WebP keeps the GIF's numbers: switching formats keeps the same
 * animation, smaller and without the GIF's 256-colour banding.
 */

/**
 * Frames per second the Animated WebP samples at: 100 ms per frame, exact
 * in WebP's millisecond frame durations.
 */
export const WEBP_FRAME_RATE = 10

/** The longer side of the Animated WebP is scaled down to at most this many pixels. */
export const WEBP_MAX_DIMENSION = 480

/**
 * The quality each frame is encoded at, as `canvas.toBlob` takes it (0–1,
 * lossy). 0.8 is Chromium's own default for WebP.
 */
export const WEBP_QUALITY = 0.8
