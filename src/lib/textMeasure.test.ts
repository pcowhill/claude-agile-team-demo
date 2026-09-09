import { describe, expect, it, vi } from 'vitest'
import { createTextMeasurer } from './textMeasure'

/**
 * A canvas stand-in: jsdom has no 2D context, so the measurer is exercised
 * against a fake one and the property under test is the wiring — the font
 * is set before the measurement, one canvas serves every call, and a
 * canvas-less environment reports nothing rather than throwing.
 */
const fakeCanvas = (context: { font: string; measureText: (line: string) => { width: number } } | null) =>
  ({ getContext: vi.fn(() => context) }) as unknown as HTMLCanvasElement

describe('measuring text on a canvas (#424)', () => {
  it('sets the font, then measures the line, on one canvas for every call', () => {
    const context = { font: '', measureText: vi.fn((line: string) => ({ width: line.length * 7 })) }
    const canvas = fakeCanvas(context)
    const create = vi.fn(() => canvas)
    const measure = createTextMeasurer(create)

    // Nothing is created at construction: a module that merely imports the
    // measurer pays for no canvas.
    expect(create).not.toHaveBeenCalled()
    expect(measure('400 90px Arial', 'Title')).toBe(35)
    expect(context.font).toBe('400 90px Arial')
    expect(measure('italic 700 20px Georgia', 'Hi')).toBe(14)
    expect(context.font).toBe('italic 700 20px Georgia')
    expect(create).toHaveBeenCalledTimes(1)
    expect(canvas.getContext).toHaveBeenCalledTimes(1)
  })

  it('reports no width where there is no 2D context, instead of throwing', () => {
    const measure = createTextMeasurer(() => fakeCanvas(null))
    expect(measure('400 90px Arial', 'Title')).toBe(0)
    // jsdom's own canvas is such an environment.
    expect(createTextMeasurer()('400 90px Arial', 'Title')).toBe(0)
  })
})
