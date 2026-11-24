/**
 * The Sound library plugin's effects (#861), synthesised from nothing but
 * arithmetic: no sample, recording or third-party file goes into any of
 * them, so they are the team's own work and are released as CC0 (see
 * `src/plugins/soundLibrary/sounds/LICENSES.md`). `generateSounds.ts` renders
 * every recipe here to WAV and encodes it; this module is pure, so it is
 * unit-tested and the set can be regenerated and reviewed.
 *
 * Every recipe is deterministic: its noise comes from a seeded generator, so
 * rendering twice gives the same samples.
 */

export const SAMPLE_RATE = 48000

export interface SoundRecipe {
  /** The file's base name, and the manifest's stable id. */
  id: string
  /** The name the dialog lists and the library clip is named after. */
  name: string
  category: 'Transitions' | 'Clicks and keys' | 'Alerts' | 'Impacts'
  /** Mono samples in −1…1 at `SAMPLE_RATE`, before normalising. */
  render: () => Float32Array
  /**
   * Peak level relative to `PEAK`, for a sound that would otherwise sound far
   * louder than the rest at the same peak: a sustained buzz carries much more
   * energy than a click. 1 when omitted.
   */
  level?: number
}

/** Mulberry32: a small seeded generator, so noise is the same on every run. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const buffer = (seconds: number) => new Float32Array(Math.round(seconds * SAMPLE_RATE))

/**
 * A band-pass biquad (RBJ cookbook, 0 dB peak gain) whose centre can move
 * every sample: `centre(i)` in Hz, at a fixed Q.
 */
function bandPass(input: Float32Array, centre: (index: number) => number, q: number): Float32Array {
  const output = new Float32Array(input.length)
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let index = 0; index < input.length; index++) {
    const w0 = (2 * Math.PI * Math.min(centre(index), SAMPLE_RATE * 0.45)) / SAMPLE_RATE
    const alpha = Math.sin(w0) / (2 * q)
    const a0 = 1 + alpha
    const b0 = alpha / a0
    const b2 = -alpha / a0
    const a1 = (-2 * Math.cos(w0)) / a0
    const a2 = (1 - alpha) / a0
    const x0 = input[index]
    const y0 = b0 * x0 + b2 * x2 - a1 * y1 - a2 * y2
    output[index] = y0
    x2 = x1
    x1 = x0
    y2 = y1
    y1 = y0
  }
  return output
}

function noise(seconds: number, seed: number): Float32Array {
  const random = seededRandom(seed)
  const samples = buffer(seconds)
  for (let index = 0; index < samples.length; index++) samples[index] = random() * 2 - 1
  return samples
}

/** An exponential sweep from `from` to `to` Hz across `length` samples. */
const sweep = (from: number, to: number, length: number) => (index: number) =>
  from * Math.pow(to / from, index / Math.max(1, length - 1))

/** Adds `source` into `target` from sample `at`, scaled by `gain`. */
function mixInto(target: Float32Array, source: Float32Array, at: number, gain = 1): void {
  for (let index = 0; index < source.length && at + index < target.length; index++) {
    if (at + index >= 0) target[at + index] += source[index] * gain
  }
}

/** A sine whose frequency follows `frequency(t)` (t in seconds), under `envelope(t)`. */
function tone(
  seconds: number,
  frequency: (t: number) => number,
  envelope: (t: number) => number,
): Float32Array {
  const samples = buffer(seconds)
  let phase = 0
  for (let index = 0; index < samples.length; index++) {
    const t = index / SAMPLE_RATE
    phase += (2 * Math.PI * frequency(t)) / SAMPLE_RATE
    samples[index] = Math.sin(phase) * envelope(t)
  }
  return samples
}

/** Attack, then exponential decay with time constant `tau`. */
const strike = (attack: number, tau: number) => (t: number) =>
  t < attack ? t / attack : Math.exp(-(t - attack) / tau)

/** Filtered-noise air movement, its band sweeping `from` → `to` Hz. */
function air(seconds: number, from: number, to: number, peakAt: number, seed: number): Float32Array {
  const raw = noise(seconds, seed)
  const filtered = bandPass(raw, sweep(from, to, raw.length), 1.4)
  for (let index = 0; index < filtered.length; index++) {
    const t = index / filtered.length
    // Rises to the peak and falls away, each half a raised sine.
    const shape = t < peakAt ? Math.sin((Math.PI / 2) * (t / peakAt)) : Math.cos((Math.PI / 2) * ((t - peakAt) / (1 - peakAt)))
    filtered[index] *= shape * shape
  }
  return filtered
}

/** One short mechanical click: a noise tick in a band, and a small body tone. */
function tick(seed: number, band: number, body: number, length = 0.04): Float32Array {
  const burst = noise(length, seed)
  const filtered = bandPass(burst, () => band, 2.5)
  for (let index = 0; index < filtered.length; index++) {
    filtered[index] *= Math.exp(-index / (SAMPLE_RATE * 0.002)) * 3
  }
  mixInto(filtered, tone(length, () => body, strike(0.0005, 0.006)), 0, 0.5)
  return filtered
}

/** A bell-like strike: inharmonic partials, the higher ones dying sooner. */
function bell(seconds: number, fundamental: number): Float32Array {
  const partials = [
    { ratio: 1, gain: 1, tau: 0.7 },
    { ratio: 2.0, gain: 0.45, tau: 0.45 },
    { ratio: 2.76, gain: 0.3, tau: 0.3 },
    { ratio: 5.4, gain: 0.15, tau: 0.16 },
    { ratio: 8.93, gain: 0.08, tau: 0.08 },
  ]
  const samples = buffer(seconds)
  for (const partial of partials) {
    mixInto(samples, tone(seconds, () => fundamental * partial.ratio, strike(0.002, partial.tau)), 0, partial.gain)
  }
  return samples
}

/** A soft note: a sine and a quiet octave, struck and decaying. */
function note(seconds: number, frequency: number, tau: number): Float32Array {
  const samples = tone(seconds, () => frequency, strike(0.005, tau))
  mixInto(samples, tone(seconds, () => frequency * 2, strike(0.005, tau / 2)), 0, 0.25)
  return samples
}

const at = (seconds: number) => Math.round(seconds * SAMPLE_RATE)

export const RECIPES: readonly SoundRecipe[] = [
  {
    id: 'whoosh',
    name: 'Whoosh',
    category: 'Transitions',
    render: () => air(0.9, 300, 3200, 0.55, 1),
  },
  {
    id: 'swoosh-out',
    name: 'Swoosh out',
    category: 'Transitions',
    render: () => air(0.7, 3200, 250, 0.25, 2),
  },
  {
    id: 'riser',
    name: 'Riser',
    category: 'Transitions',
    render: () => {
      const samples = air(2, 200, 5000, 0.97, 3)
      // A tone rising two octaves under the air, growing with it.
      const rising = tone(2, (t) => 180 * Math.pow(4, t / 2), (t) => (t / 2) ** 2 * 0.25)
      mixInto(samples, rising, 0)
      return samples
    },
  },
  {
    id: 'click',
    name: 'Click',
    category: 'Clicks and keys',
    render: () => {
      const samples = buffer(0.12)
      mixInto(samples, tick(4, 2400, 1800), at(0.005))
      return samples
    },
  },
  {
    id: 'double-click',
    name: 'Double click',
    category: 'Clicks and keys',
    render: () => {
      const samples = buffer(0.25)
      mixInto(samples, tick(5, 2400, 1800), at(0.005))
      mixInto(samples, tick(6, 2500, 1900), at(0.1), 0.9)
      return samples
    },
  },
  {
    id: 'pop',
    name: 'Pop',
    category: 'Clicks and keys',
    render: () => tone(0.2, (t) => 180 + 720 * Math.exp(-t / 0.02), strike(0.001, 0.035)),
  },
  {
    id: 'typing',
    name: 'Typing',
    category: 'Clicks and keys',
    render: () => {
      const samples = buffer(2)
      const random = seededRandom(7)
      let time = 0.02
      let key = 0
      while (time < 1.85) {
        // Every seventh key is the space bar: lower and a little louder.
        const space = key % 7 === 6
        const click = tick(100 + key, space ? 1400 : 2600 + random() * 1200, space ? 140 : 200 + random() * 80, 0.05)
        mixInto(samples, click, at(time), space ? 1 : 0.6 + random() * 0.35)
        time += 0.09 + random() * 0.09
        key++
      }
      return samples
    },
  },
  {
    id: 'camera-shutter',
    name: 'Camera shutter',
    category: 'Clicks and keys',
    render: () => {
      const samples = buffer(0.35)
      mixInto(samples, tick(8, 1500, 400, 0.05), at(0.005))
      mixInto(samples, air(0.08, 2500, 1200, 0.3, 9), at(0.02), 0.5)
      mixInto(samples, tick(10, 1700, 350, 0.05), at(0.075), 0.8)
      return samples
    },
  },
  {
    id: 'ding',
    name: 'Ding',
    category: 'Alerts',
    render: () => bell(1.8, 880),
  },
  {
    id: 'notification',
    name: 'Notification',
    category: 'Alerts',
    render: () => {
      const samples = buffer(0.75)
      mixInto(samples, note(0.3, 660, 0.08), 0)
      mixInto(samples, note(0.55, 990, 0.14), at(0.17))
      return samples
    },
  },
  {
    id: 'success',
    name: 'Success',
    category: 'Alerts',
    render: () => {
      const samples = buffer(1)
      // C5, E5, G5, C6.
      ;[523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
        mixInto(samples, note(0.6, frequency, 0.18), at(index * 0.1), 0.8)
      })
      return samples
    },
  },
  {
    id: 'error',
    name: 'Error',
    category: 'Alerts',
    // At full peak its mean level measured −4.8 dB against −14 to −26 dB
    // for the rest (ffmpeg volumedetect), so it is set 8 dB down.
    level: 0.4,
    render: () => {
      const samples = buffer(0.5)
      const buzz = () => {
        // A square-ish wave from its first odd harmonics, held then released.
        const length = 0.17
        const out = buffer(length)
        for (const harmonic of [1, 3, 5, 7]) {
          mixInto(out, tone(length, () => 160 * harmonic, (t) => (t < 0.005 ? t / 0.005 : t > length - 0.02 ? (length - t) / 0.02 : 1)), 0, 1 / harmonic)
        }
        return out
      }
      mixInto(samples, buzz(), 0)
      mixInto(samples, buzz(), at(0.24))
      return samples
    },
  },
  {
    id: 'thump',
    name: 'Thump',
    category: 'Impacts',
    render: () => {
      const samples = tone(0.9, (t) => 45 + 75 * Math.exp(-t / 0.06), strike(0.002, 0.22))
      const transient = bandPass(noise(0.03, 11), () => 600, 0.8)
      for (let index = 0; index < transient.length; index++) transient[index] *= Math.exp(-index / (SAMPLE_RATE * 0.004))
      mixInto(samples, transient, 0, 0.6)
      return samples
    },
  },
]

/** Peak level every sound is normalised to: −1 dBFS. */
export const PEAK = 10 ** (-1 / 20)

/**
 * Normalises to `PEAK` (times the recipe's `level`) and adds 2 ms fades at both ends, so no sound starts
 * or stops on a click it did not mean to make.
 */
export function finish(samples: Float32Array, level = 1): Float32Array {
  let peak = 0
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample))
  const out = new Float32Array(samples.length)
  const gain = peak === 0 ? 0 : (PEAK * level) / peak
  const fade = at(0.002)
  for (let index = 0; index < samples.length; index++) {
    const edge = Math.min(1, index / fade, (samples.length - 1 - index) / fade)
    out[index] = samples[index] * gain * Math.max(0, edge)
  }
  return out
}

/** 16-bit PCM mono WAV bytes, for the encoder. */
export function wavBytes(samples: Float32Array): Uint8Array {
  const data = new DataView(new ArrayBuffer(44 + samples.length * 2))
  const writeText = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index++) data.setUint8(offset + index, text.charCodeAt(index))
  }
  writeText(0, 'RIFF')
  data.setUint32(4, 36 + samples.length * 2, true)
  writeText(8, 'WAVE')
  writeText(12, 'fmt ')
  data.setUint32(16, 16, true)
  data.setUint16(20, 1, true)
  data.setUint16(22, 1, true)
  data.setUint32(24, SAMPLE_RATE, true)
  data.setUint32(28, SAMPLE_RATE * 2, true)
  data.setUint16(32, 2, true)
  data.setUint16(34, 16, true)
  writeText(36, 'data')
  data.setUint32(40, samples.length * 2, true)
  samples.forEach((sample, index) => {
    data.setInt16(44 + index * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true)
  })
  return new Uint8Array(data.buffer)
}
