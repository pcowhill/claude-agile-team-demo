/**
 * Measuring a line of text the way the export draws it (#424): a canvas 2D
 * context's `measureText`, under the same `font` shorthand `textDraw` sets
 * before its `fillText`. The width it returns is the line's advance width in
 * px at that font, which is the width the exported frame — and the still the
 * visual editors show, since the still *is* the export's draw (#237) — gives
 * the line. Measured rather than estimated because the four curated stacks
 * (`TEXT_FONTS`) differ by a third in width for the same string, and a
 * handle drawn on an estimated box would sit beside the text, not on it.
 *
 * jsdom has no canvas: `getContext` yields nothing there, so the measurer
 * reports 0 rather than throwing, and the component tests inject a
 * deterministic measurer instead — the same arrangement `FrameEditor` has
 * with its injectable snapshot.
 */

export type TextMeasurer = (font: string, line: string) => number

/**
 * A measurer over one lazily created canvas, reused for every call: the
 * context is created on the first measurement, not at import, so modules
 * that merely import this pay nothing and a canvas-less environment fails no
 * import.
 */
export function createTextMeasurer(
  createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas'),
): TextMeasurer {
  let context: CanvasRenderingContext2D | null | undefined
  return (font, line) => {
    if (context === undefined) {
      context = typeof document === 'undefined' ? null : (createCanvas().getContext?.('2d') ?? null)
    }
    if (context === null) return 0
    context.font = font
    return context.measureText(line).width
  }
}

/** The app's measurer — one canvas for every text block the editors size. */
export const measureTextWidth: TextMeasurer = createTextMeasurer()
