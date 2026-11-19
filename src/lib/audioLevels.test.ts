import { describe, expect, it } from 'vitest'
import { computeLevels, windowLevel } from './audioLevels'

const RATE = 48000

/** A sine at `amplitude`, `seconds` long: its RMS is amplitude / √2. */
function sine(amplitude: number, seconds: number, frequency = 440): Float32Array {
  const samples = new Float32Array(Math.round(seconds * RATE))
  for (let index = 0; index < samples.length; index++) {
    samples[index] = amplitude * Math.sin((2 * Math.PI * frequency * index) / RATE)
  }
  return samples
}

/** The dB a sine of this amplitude should read, worked out from its definition. */
const sineDb = (amplitude: number) => 20 * Math.log10(amplitude / Math.SQRT2)

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((total, part) => total + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

describe('audio levels: the measure (#691)', () => {
  it.each([1, 0.5, 0.1, 0.02])('measures a %s-amplitude sine within 0.5 dB of its RMS', (amplitude) => {
    const levels = computeLevels([sine(amplitude, 2)], RATE)
    const measured = windowLevel(levels, 0, 2)
    expect(measured).not.toBeNull()
    expect(Math.abs(measured!.levelDb - sineDb(amplitude))).toBeLessThan(0.5)
    expect(measured!.peak).toBeCloseTo(amplitude, 2)
  })

  it('gates silence: a tone with half its length silent measures as the continuous tone', () => {
    const continuous = windowLevel(computeLevels([sine(0.3, 4)], RATE), 0, 4)!
    const halved = windowLevel(computeLevels([concat(sine(0.3, 2), new Float32Array(2 * RATE))], RATE), 0, 4)!
    // Without the gate the halved tone would read 3 dB down.
    expect(Math.abs(halved.levelDb - continuous.levelDb)).toBeLessThan(0.5)
  })

  it('gates a pause of room tone, not only digital silence', () => {
    // Speech-like: a tone, then a pause holding hiss 40 dB down, then the tone.
    const hiss = sine(0.003, 2, 7000)
    const levels = computeLevels([concat(sine(0.3, 2), hiss, sine(0.3, 2))], RATE)
    expect(Math.abs(windowLevel(levels, 0, 6)!.levelDb - sineDb(0.3))).toBeLessThan(0.5)
  })

  it('averages the channels, so a stereo pair of the same tone reads as the mono tone', () => {
    const tone = sine(0.25, 1)
    const stereo = windowLevel(computeLevels([tone, tone], RATE), 0, 1)!
    const mono = windowLevel(computeLevels([tone], RATE), 0, 1)!
    expect(stereo.levelDb).toBeCloseTo(mono.levelDb, 5)
  })

  it('reads a silent window as no level at all, rather than a very quiet one', () => {
    expect(windowLevel(computeLevels([new Float32Array(RATE)], RATE), 0, 1)).toBeNull()
    expect(windowLevel(computeLevels([], RATE), 0, 1)).toBeNull()
  })
})

describe('audio levels: the window (#691)', () => {
  it('measures a trim on the part it keeps, not on the whole source', () => {
    // A loud 2 s, then a quiet 2 s 20 dB down, in one source.
    const levels = computeLevels([concat(sine(0.5, 2), sine(0.05, 2))], RATE)
    const quiet = windowLevel(levels, 2, 4)!
    const loud = windowLevel(levels, 0, 2)!
    expect(Math.abs(quiet.levelDb - sineDb(0.05))).toBeLessThan(0.5)
    expect(Math.abs(loud.levelDb - sineDb(0.5))).toBeLessThan(0.5)
    // The window's own peak, not the source's.
    expect(quiet.peak).toBeCloseTo(0.05, 2)
  })

  it('leaves out a block the trim cuts through, which holds sound the trim removed', () => {
    // The loud take runs 0.05 s into the 2.0–2.1 block the quiet trim
    // starts in. Weighted by the half it keeps, that block alone read
    // 3.6 dB high: half a block 20 dB up outweighs 19 quiet ones.
    const levels = computeLevels([concat(sine(0.5, 2.05), sine(0.05, 1.95))], RATE)
    const quiet = windowLevel(levels, 2.05, 4)!
    expect(Math.abs(quiet.levelDb - sineDb(0.05))).toBeLessThan(0.5)
    // Its peak still counts: overstating a peak is the clipping guard's safe side.
    expect(quiet.peak).toBeCloseTo(0.5, 2)
  })

  it('measures a trim shorter than one block from the block it sits in', () => {
    const levels = computeLevels([sine(0.2, 1)], RATE)
    expect(Math.abs(windowLevel(levels, 0.42, 0.47)!.levelDb - sineDb(0.2))).toBeLessThan(0.5)
  })

  it('counts a short last block as whole when the trim runs to the end of the source', () => {
    // 1.04 s: a silent second (ten whole blocks), then a loud 0.04 s tail block.
    const levels = computeLevels([concat(new Float32Array(RATE), sine(0.3, 0.04))], RATE)
    expect(Math.abs(windowLevel(levels, 1, 1.04)!.levelDb - sineDb(0.3))).toBeLessThan(0.5)
  })
})
