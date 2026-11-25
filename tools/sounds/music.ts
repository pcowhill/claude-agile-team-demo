/**
 * The Sound library plugin's music beds (#869), composed and synthesised
 * from arithmetic alone, like the effects in `recipes.ts` (#861): no
 * sample, recording or third-party file goes into any of them, so they are
 * the team's own work and are released as CC0 (see
 * `src/plugins/soundLibrary/sounds/LICENSES.md`).
 *
 * Each track is a short arrangement: a chord progression in one key, voiced
 * close to a centre pitch so the chords move smoothly, played by a few
 * instruments (pads, electric piano, plucked strings, marimba, bass, soft
 * drums), each entering and leaving by section, with a room reverb over the
 * mix. A bed is meant to sit under speech, so nothing here leads: there is
 * no singing line, the drums are soft, and every track keeps one tempo and
 * one key throughout.
 *
 * Every track is deterministic. Its timing and velocity variation, its
 * melodies and its noise all come from seeded generators, so rendering
 * twice gives the same samples, and `generateSounds.ts` repeats byte for
 * byte.
 */
import { SAMPLE_RATE, seededRandom } from './recipes.ts'

export interface Stereo {
  left: Float32Array
  right: Float32Array
}

export interface MusicTrack {
  /** The file's base name, and the manifest's stable id. */
  id: string
  /** The name the dialog lists and the library clip is named after. */
  name: string
  /** One word for the dialog's list. */
  mood: string
  /** What it sounds like, for the PR and the guide: the customer auditions these. */
  description: string
  /** Stereo samples at `SAMPLE_RATE`, before mastering. */
  render: () => Stereo
}

const TAU = 2 * Math.PI

const midiToHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12)

const samplesFor = (seconds: number) => Math.max(0, Math.round(seconds * SAMPLE_RATE))

// ---------------------------------------------------------------------------
// Harmony

/** Semitones above the tonic for each scale degree. */
const MAJOR = [0, 2, 4, 5, 7, 9, 11]
const MINOR = [0, 2, 3, 5, 7, 8, 10]

/**
 * A diatonic chord's pitch classes (semitones above the key's tonic, which
 * may exceed 12): built in thirds on `degree` (1–7) of `scale`, with
 * `tones` notes (3 a triad, 4 a seventh chord).
 */
function chordTones(scale: readonly number[], degree: number, tones = 3): number[] {
  const notes: number[] = []
  for (let index = 0; index < tones; index++) {
    const step = degree - 1 + index * 2
    notes.push(scale[step % 7] + 12 * Math.floor(step / 7))
  }
  return notes
}

/**
 * The chord's tones as MIDI notes, each placed in the octave nearest
 * `centre`: consecutive chords voiced this way share or move by a step
 * between most of their notes, which is what makes a progression sound
 * smooth rather than jumping in parallel.
 */
function voice(tonic: number, tones: readonly number[], centre: number): number[] {
  return tones
    .map((tone) => {
      let note = tonic + tone
      while (note - centre > 6) note -= 12
      while (centre - note > 6) note += 12
      return note
    })
    .sort((a, b) => a - b)
}

// ---------------------------------------------------------------------------
// Oscillators and envelopes

const TABLE_SIZE = 4096

/** One cycle of a waveform with these harmonic amplitudes, peak-normalised. */
function wavetable(harmonics: readonly number[]): Float32Array {
  const table = new Float32Array(TABLE_SIZE)
  let peak = 0
  for (let index = 0; index < TABLE_SIZE; index++) {
    let sum = 0
    harmonics.forEach((amplitude, k) => {
      sum += amplitude * Math.sin((TAU * (k + 1) * index) / TABLE_SIZE)
    })
    table[index] = sum
    peak = Math.max(peak, Math.abs(sum))
  }
  for (let index = 0; index < TABLE_SIZE; index++) table[index] /= peak
  return table
}

/** A soft sawtooth: every harmonic, each a little quieter than 1/k. */
const WARM_SAW = wavetable(Array.from({ length: 12 }, (_, k) => Math.exp(-0.18 * k) / (k + 1)))
/** Odd harmonics only, rolled off: a hollow, clarinet-like tone. */
const SOFT_SQUARE = wavetable(Array.from({ length: 9 }, (_, k) => (k % 2 === 0 ? Math.exp(-0.2 * k) / (k + 1) : 0)))
/** A few low harmonics: a round, organ-like tone. */
const ROUND = wavetable([1, 0.35, 0.12, 0.05])

/** Reads `table` at `frequency(t)` Hz for `length` samples, from phase `phase` (0–1). */
function oscillate(table: Float32Array, length: number, frequency: (t: number) => number, phase = 0): Float32Array {
  const out = new Float32Array(length)
  let position = phase * TABLE_SIZE
  for (let index = 0; index < length; index++) {
    const whole = Math.floor(position)
    const fraction = position - whole
    const a = table[whole % TABLE_SIZE]
    const b = table[(whole + 1) % TABLE_SIZE]
    out[index] = a + (b - a) * fraction
    position += (frequency(index / SAMPLE_RATE) * TABLE_SIZE) / SAMPLE_RATE
    if (position >= TABLE_SIZE) position -= TABLE_SIZE
  }
  return out
}

/**
 * An attack–decay–sustain–release envelope over a note held `hold`
 * seconds, applied in place. The attack is a raised sine (no click), and
 * the release a raised cosine to silence.
 */
function envelope(
  samples: Float32Array,
  hold: number,
  attack: number,
  decay: number,
  sustain: number,
  release: number,
): Float32Array {
  for (let index = 0; index < samples.length; index++) {
    const t = index / SAMPLE_RATE
    let level: number
    if (t < attack) level = 0.5 - 0.5 * Math.cos((Math.PI * t) / attack)
    else if (t < attack + decay) level = 1 - (1 - sustain) * ((t - attack) / decay)
    else level = sustain
    if (t > hold) {
      const r = (t - hold) / release
      level *= r >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * r)
    }
    samples[index] *= level
  }
  return samples
}

/** A one-pole low-pass filter, in place, at `cutoff` Hz (a constant or per sample). */
function lowPass(samples: Float32Array, cutoff: number | ((index: number) => number)): Float32Array {
  let y = 0
  for (let index = 0; index < samples.length; index++) {
    const fc = typeof cutoff === 'number' ? cutoff : cutoff(index)
    const a = 1 - Math.exp((-TAU * fc) / SAMPLE_RATE)
    y += a * (samples[index] - y)
    samples[index] = y
  }
  return samples
}

/** A one-pole high-pass filter, in place. */
function highPass(samples: Float32Array, cutoff: number): Float32Array {
  const a = Math.exp((-TAU * cutoff) / SAMPLE_RATE)
  let previousIn = 0
  let previousOut = 0
  for (let index = 0; index < samples.length; index++) {
    const x = samples[index]
    previousOut = a * (previousOut + x - previousIn)
    previousIn = x
    samples[index] = previousOut
  }
  return samples
}

function noise(length: number, random: () => number): Float32Array {
  const out = new Float32Array(length)
  for (let index = 0; index < length; index++) out[index] = random() * 2 - 1
  return out
}

// ---------------------------------------------------------------------------
// Instruments: each returns one note as mono samples, starting at its onset.

/**
 * A pad: three slightly detuned voices of `table`, a slow swell and a long
 * release, under a low-pass that keeps it behind everything else.
 */
function pad(midi: number, hold: number, random: () => number, table = WARM_SAW, brightness = 1800): Float32Array {
  const release = 1.6
  const length = samplesFor(hold + release)
  const out = new Float32Array(length)
  const base = midiToHz(midi)
  for (const cents of [-7, 0, 6]) {
    const frequency = base * 2 ** (cents / 1200)
    const rate = 4 + random() * 1.5
    const voiceSamples = oscillate(table, length, (t) => frequency * (1 + 0.0015 * Math.sin(TAU * rate * t)), random())
    for (let index = 0; index < length; index++) out[index] += voiceSamples[index] / 3
  }
  lowPass(lowPass(out, brightness), brightness)
  return envelope(out, hold, Math.min(0.9, hold / 2), 0.5, 0.85, release)
}

/**
 * An electric piano: a frequency-modulated sine whose brightness fades
 * faster than its body, like a struck tine, with a soft bell overtone.
 */
function electricPiano(midi: number, hold: number, velocity: number): Float32Array {
  const release = 0.35
  const length = samplesFor(hold + release)
  const out = new Float32Array(length)
  const f = midiToHz(midi)
  let carrier = 0
  let modulator = 0
  let bell = 0
  for (let index = 0; index < length; index++) {
    const t = index / SAMPLE_RATE
    const depth = (0.6 + 1.4 * velocity) * Math.exp(-t / 0.35)
    modulator += (TAU * f) / SAMPLE_RATE
    carrier += (TAU * f) / SAMPLE_RATE
    bell += (TAU * f * 7.02) / SAMPLE_RATE
    const body = Math.sin(carrier + depth * Math.sin(modulator)) * Math.exp(-t / 1.6)
    out[index] = velocity * (body + 0.06 * velocity * Math.sin(bell) * Math.exp(-t / 0.08))
  }
  return envelope(out, hold, 0.004, 0.1, 1, release)
}

/**
 * A plucked string (Karplus–Strong): seeded noise in a delay line the
 * length of one period, averaged on each pass so the high partials die
 * first. A first-order all-pass holds the fractional part of the period,
 * so the pitch is in tune.
 */
function pluck(midi: number, seconds: number, velocity: number, random: () => number, brightness = 0.5): Float32Array {
  const length = samplesFor(seconds)
  const out = new Float32Array(length)
  const period = SAMPLE_RATE / midiToHz(midi)
  // The averaging filter delays by half a sample, the all-pass by `fraction`.
  const delay = Math.floor(period - 0.5)
  const fraction = period - 0.5 - delay
  const coefficient = (1 - fraction) / (1 + fraction)
  const line = new Float32Array(delay)
  let smoothed = 0
  for (let index = 0; index < delay; index++) {
    // Low-passed noise: a softer pick.
    smoothed += brightness * (random() * 2 - 1 - smoothed)
    line[index] = smoothed
  }
  let cursor = 0
  let previous = 0
  let allPassIn = 0
  let allPassOut = 0
  const loss = 0.996
  for (let index = 0; index < length; index++) {
    const current = line[cursor]
    const averaged = loss * 0.5 * (current + previous)
    previous = current
    const tuned = coefficient * averaged + allPassIn - coefficient * allPassOut
    allPassIn = averaged
    allPassOut = tuned
    line[cursor] = tuned
    cursor = (cursor + 1) % delay
    out[index] = current * velocity
  }
  return envelope(highPass(out, 80), seconds - 0.05, 0.002, 0.01, 1, 0.05)
}

/** A marimba bar: the fundamental, its fourth-harmonic overtone that dies fast, and a soft mallet tick. */
function marimba(midi: number, velocity: number): Float32Array {
  const length = samplesFor(0.9)
  const out = new Float32Array(length)
  const f = midiToHz(midi)
  for (let index = 0; index < length; index++) {
    const t = index / SAMPLE_RATE
    out[index] =
      velocity *
      (Math.sin(TAU * f * t) * Math.exp(-t / 0.22) +
        0.35 * Math.sin(TAU * f * 3.98 * t) * Math.exp(-t / 0.04) +
        0.15 * Math.sin(TAU * f * 9.2 * t) * Math.exp(-t / 0.012))
  }
  return envelope(out, 0.85, 0.002, 0.01, 1, 0.05)
}

/** A bass note: a round tone, gently filtered, held `hold` seconds. */
function bass(midi: number, hold: number, velocity: number, plucked = false): Float32Array {
  const release = 0.08
  const length = samplesFor(hold + release)
  const f = midiToHz(midi)
  const out = oscillate(ROUND, length, () => f)
  for (let index = 0; index < length; index++) {
    const t = index / SAMPLE_RATE
    out[index] *= velocity * (plucked ? Math.exp(-t / 0.25) : 1)
  }
  lowPass(out, 900)
  return envelope(out, hold, 0.006, 0.15, plucked ? 1 : 0.8, release)
}

/** A soft kick: a sine falling from about 140 Hz to `low` Hz, with a short body. */
function kick(velocity: number, low = 48, tau = 0.22): Float32Array {
  const length = samplesFor(0.6)
  const out = new Float32Array(length)
  let phase = 0
  for (let index = 0; index < length; index++) {
    const t = index / SAMPLE_RATE
    phase += (TAU * (low + 90 * Math.exp(-t / 0.03))) / SAMPLE_RATE
    out[index] = velocity * Math.sin(phase) * Math.exp(-t / tau)
  }
  return envelope(out, 0.55, 0.002, 0.01, 1, 0.05)
}

/** A snare: a short tone for the drum's body, and band-limited noise for its wires. */
function snare(velocity: number, random: () => number, tau = 0.12): Float32Array {
  const length = samplesFor(0.45)
  const wires = highPass(lowPass(noise(length, random), 6000), 900)
  const out = new Float32Array(length)
  for (let index = 0; index < length; index++) {
    const t = index / SAMPLE_RATE
    out[index] = velocity * (0.55 * wires[index] * Math.exp(-t / tau) + 0.45 * Math.sin(TAU * 185 * t) * Math.exp(-t / 0.05))
  }
  return envelope(out, 0.4, 0.001, 0.01, 1, 0.05)
}

/** A clap: three quick bursts of filtered noise and a short tail. */
function clap(velocity: number, random: () => number): Float32Array {
  const length = samplesFor(0.35)
  const burst = highPass(lowPass(noise(length, random), 5000), 1000)
  const out = new Float32Array(length)
  for (let index = 0; index < length; index++) {
    const t = index / SAMPLE_RATE
    let level = Math.exp(-Math.max(0, t - 0.02) / 0.09)
    for (const at of [0, 0.01, 0.02]) if (t >= at && t < at + 0.01) level = Math.max(level, Math.exp(-(t - at) / 0.004))
    out[index] = velocity * burst[index] * level
  }
  return envelope(out, 0.3, 0.001, 0.01, 1, 0.05)
}

/** A hi-hat (or, with a longer `tau`, a shaker): high-passed noise, very short. */
function hat(velocity: number, random: () => number, tau = 0.035, attack = 0.001): Float32Array {
  const length = samplesFor(Math.max(0.1, tau * 6))
  const out = highPass(highPass(noise(length, random), 6000), 6000)
  for (let index = 0; index < length; index++) out[index] *= velocity * Math.exp(-index / SAMPLE_RATE / tau)
  return envelope(out, length / SAMPLE_RATE - 0.02, attack, 0.001, 1, 0.02)
}

// ---------------------------------------------------------------------------
// Mixing

/**
 * The mix being built: a dry stereo bus, and a send that the reverb
 * returns. Notes are added at a time, a gain, a pan (−1 left … 1 right,
 * equal power) and a reverb send level.
 */
class Mix {
  readonly dry: Stereo
  readonly send: Stereo
  readonly length: number

  constructor(seconds: number) {
    this.length = samplesFor(seconds)
    this.dry = { left: new Float32Array(this.length), right: new Float32Array(this.length) }
    this.send = { left: new Float32Array(this.length), right: new Float32Array(this.length) }
  }

  add(samples: Float32Array, at: number, gain: number, pan = 0, reverb = 0.2, bus: Stereo = this.dry): void {
    const start = samplesFor(at)
    const angle = ((pan + 1) * Math.PI) / 4
    const left = Math.cos(angle) * gain
    const right = Math.sin(angle) * gain
    for (let index = 0; index < samples.length; index++) {
      const target = start + index
      if (target >= this.length) break
      const sample = samples[index]
      bus.left[target] += sample * left
      bus.right[target] += sample * right
      this.send.left[target] += sample * left * reverb
      this.send.right[target] += sample * right * reverb
    }
  }

  /** The dry mix plus the reverb's return, at `wet`. */
  finish(room: number, damping: number, wet: number): Stereo {
    const returned = reverb(this.send, room, damping)
    const left = new Float32Array(this.length)
    const right = new Float32Array(this.length)
    for (let index = 0; index < this.length; index++) {
      left[index] = this.dry.left[index] + wet * returned.left[index]
      right[index] = this.dry.right[index] + wet * returned.right[index]
    }
    return { left, right }
  }
}

/**
 * A room reverb after Freeverb: parallel damped comb filters into series
 * all-passes, each channel's delays offset so the two sides decorrelate
 * into width.
 */
function reverb(input: Stereo, room: number, damping: number): Stereo {
  const scale = SAMPLE_RATE / 44100
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617]
  const allPasses = [556, 441, 341, 225]
  const channel = (samples: Float32Array, spread: number) => {
    const out = new Float32Array(samples.length)
    for (const length of combs) {
      const size = Math.round((length + spread) * scale)
      const line = new Float32Array(size)
      let cursor = 0
      let store = 0
      for (let index = 0; index < samples.length; index++) {
        const delayed = line[cursor]
        store = delayed * (1 - damping) + store * damping
        line[cursor] = samples[index] + store * room
        cursor = cursor + 1 === size ? 0 : cursor + 1
        out[index] += delayed / combs.length
      }
    }
    for (const length of allPasses) {
      const size = Math.round((length + spread) * scale)
      const line = new Float32Array(size)
      let cursor = 0
      for (let index = 0; index < out.length; index++) {
        const delayed = line[cursor]
        const x = out[index]
        line[cursor] = x + delayed * 0.5
        out[index] = delayed - x
        cursor = cursor + 1 === size ? 0 : cursor + 1
      }
    }
    return out
  }
  return { left: channel(input.left, 0), right: channel(input.right, 23) }
}

/**
 * A slow fade over the whole mix: in over `fadeIn` seconds from the start,
 * and out over `fadeOut` seconds before the end, each a raised cosine.
 */
function fadeEnds(mix: Stereo, fadeIn: number, fadeOut: number): Stereo {
  const length = mix.left.length
  const inLength = samplesFor(fadeIn)
  const outLength = samplesFor(fadeOut)
  for (let index = 0; index < length; index++) {
    let gain = 1
    if (index < inLength) gain = 0.5 - 0.5 * Math.cos((Math.PI * index) / inLength)
    const fromEnd = length - 1 - index
    if (fromEnd < outLength) gain *= 0.5 - 0.5 * Math.cos((Math.PI * fromEnd) / outLength)
    mix.left[index] *= gain
    mix.right[index] *= gain
  }
  return mix
}

/** Seeded timing and level variation, so repeated parts do not sound machined. */
function humanise(random: () => number, timing = 0.006, level = 0.12) {
  return {
    at: (seconds: number) => seconds + (random() * 2 - 1) * timing,
    gain: (gain: number) => gain * (1 - level / 2 + random() * level),
  }
}

/** A song's clock: bars and beats in seconds at one tempo. */
function clock(bpm: number) {
  const beat = 60 / bpm
  return { beat, bar: 4 * beat, at: (bar: number, beatInBar = 0) => bar * 4 * beat + beatInBar * beat }
}

/** The reverb tail and final fade every track ends with, in seconds. */
const TAIL = 4

// ---------------------------------------------------------------------------
// The tracks

/**
 * Calm: slow, warm pads on major-seventh chords, an electric piano
 * arpeggio rising and falling across each chord, and a deep, wide room.
 * No drums.
 */
function stillWater(): Stereo {
  const random = seededRandom(1001)
  const human = humanise(seededRandom(1002), 0.012, 0.2)
  const time = clock(68)
  const tonic = 62 // D
  // Imaj7, vi7, IVmaj7, V — four bars each pass, six passes.
  const progression = [1, 6, 4, 5]
  const passes = 6
  const bars = progression.length * passes
  const mix = new Mix(bars * time.bar + TAIL)
  for (let bar = 0; bar < bars; bar++) {
    const degree = progression[bar % progression.length]
    const pass = Math.floor(bar / progression.length)
    const tones = chordTones(MAJOR, degree, 4)
    for (const note of voice(tonic, tones, 60)) {
      mix.add(pad(note, time.bar + 0.3, random, WARM_SAW, 1500), time.at(bar), 0.11, (note % 5) / 5 - 0.4, 0.5)
    }
    mix.add(bass(voice(tonic - 24, tones.slice(0, 1), 40)[0], time.bar - 0.1, 0.9), time.at(bar), 0.32, 0, 0.15)
    // The arpeggio sits out the first pass and the last half pass.
    if (pass === 0 || bar >= bars - 2) continue
    const arpeggio = voice(tonic + 12, tones, 72)
    const pattern = [0, 1, 2, 3, 2, 1, 2, 3]
    pattern.forEach((step, eighth) => {
      const note = arpeggio[step % arpeggio.length]
      const velocity = human.gain(eighth === 0 ? 0.75 : 0.5)
      mix.add(
        electricPiano(note, time.beat * 0.9, velocity),
        human.at(time.at(bar, eighth / 2)),
        0.16,
        eighth % 2 === 0 ? -0.35 : 0.35,
        0.55,
      )
    })
  }
  return fadeEnds(mix.finish(0.88, 0.35, 0.9), 2.5, TAIL + time.bar)
}

/**
 * Upbeat: a bright plucked-guitar pattern in eighth notes over the
 * I–V–vi–IV progression, a driving bass, kick and clap, offbeat hats,
 * and a pad for the choruses.
 */
function brightSide(): Stereo {
  const random = seededRandom(2001)
  const human = humanise(seededRandom(2002))
  const time = clock(112)
  const tonic = 60 // C
  const progression = [1, 5, 6, 4]
  const bars = 36
  const mix = new Mix(bars * time.bar + TAIL)
  for (let bar = 0; bar < bars; bar++) {
    const degree = progression[bar % progression.length]
    const tones = chordTones(MAJOR, degree)
    const section = bar < 4 ? 'intro' : bar < 12 ? 'verse' : bar < 20 ? 'chorus' : bar < 28 ? 'verse' : bar < 34 ? 'chorus' : 'outro'
    const full = section === 'chorus'
    // Guitar: chord tones up and down, two octaves.
    const strings = [...voice(tonic, tones, 60), ...voice(tonic + 12, tones, 72)]
    const order = [0, 2, 4, 3, 5, 3, 4, 2]
    order.forEach((step, eighth) => {
      mix.add(
        pluck(strings[step], time.beat * 1.5, human.gain(eighth % 2 === 0 ? 0.9 : 0.65), random, 0.55),
        human.at(time.at(bar, eighth / 2)),
        0.75,
        -0.3,
        0.25,
      )
    })
    if (section === 'intro') {
      for (const note of voice(tonic, tones, 67)) {
        mix.add(pad(note, time.bar, random, WARM_SAW, 2600), time.at(bar), 0.07, 0.4, 0.4)
      }
      continue
    }
    const root = voice(tonic - 24, tones.slice(0, 1), 38)[0]
    for (let eighth = 0; eighth < 8; eighth++) {
      const note = eighth === 6 ? root + 7 : root
      mix.add(bass(note, time.beat * 0.42, human.gain(eighth % 2 === 0 ? 0.9 : 0.7)), time.at(bar, eighth / 2), 0.32, 0, 0.05)
    }
    if (section === 'outro') continue
    for (const beat of [0, 2]) mix.add(kick(human.gain(0.9)), time.at(bar, beat), 0.55, 0, 0.05)
    if (full) mix.add(kick(human.gain(0.6)), time.at(bar, 2.5), 0.5, 0, 0.05)
    for (const beat of [1, 3]) mix.add(clap(human.gain(0.8), random), human.at(time.at(bar, beat)), 0.32, 0.1, 0.3)
    for (let eighth = 0; eighth < 8; eighth++) {
      mix.add(hat(human.gain(eighth % 2 === 1 ? 0.6 : 0.3), random), human.at(time.at(bar, eighth / 2)), 0.16, 0.45, 0.1)
    }
    if (full) {
      for (const note of voice(tonic, tones, 67)) {
        mix.add(pad(note, time.bar, random, WARM_SAW, 2600), time.at(bar), 0.07, 0.4, 0.4)
      }
    }
  }
  return fadeEnds(mix.finish(0.78, 0.4, 0.5), 0.01, TAIL + 2 * time.bar)
}

/**
 * Lo-fi: electric-piano seventh chords on a ii–V–I–vi turnaround, a lazy
 * swung beat, a round bass, everything under a low-pass, and a quiet
 * vinyl crackle.
 */
function lateNightNotes(): Stereo {
  const random = seededRandom(3001)
  const human = humanise(seededRandom(3002), 0.01, 0.18)
  const time = clock(78)
  const tonic = 65 // F
  const progression = [2, 5, 1, 6]
  const bars = 24
  const swing = (eighth: number) => (eighth % 2 === 1 ? 0.16 : 0)
  const mix = new Mix(bars * time.bar + TAIL)
  for (let bar = 0; bar < bars; bar++) {
    const degree = progression[bar % progression.length]
    const tones = chordTones(MAJOR, degree, 4)
    const chord = voice(tonic, tones, 62)
    // Chords: on the one, and a softer push before the three.
    for (const [beat, hold, velocity] of [
      [0, 1.4, 0.6],
      [2.5 + swing(1) / 2, 1.2, 0.45],
    ] as const) {
      chord.forEach((note, voiceIndex) => {
        mix.add(
          electricPiano(note, time.beat * hold, human.gain(velocity)),
          human.at(time.at(bar, beat) + voiceIndex * 0.012),
          0.14,
          voiceIndex / chord.length - 0.4,
          0.35,
        )
      })
    }
    const root = voice(tonic - 24, tones.slice(0, 1), 41)[0]
    mix.add(bass(root, time.beat * 1.6, 0.9), time.at(bar), 0.4, 0, 0.05)
    mix.add(bass(root + 7, time.beat * 0.8, 0.7), time.at(bar, 2.5 + swing(1) / 2), 0.36, 0, 0.05)
    if (bar < 2 || bar >= bars - 1) continue
    mix.add(kick(human.gain(0.85), 50, 0.18), time.at(bar), 0.5, 0, 0.05)
    mix.add(kick(human.gain(0.6), 50, 0.18), time.at(bar, 2.5 + swing(1) / 2), 0.45, 0, 0.05)
    for (const beat of [1, 3]) mix.add(snare(human.gain(0.7), random, 0.09), human.at(time.at(bar, beat)), 0.28, 0.05, 0.25)
    for (let eighth = 0; eighth < 8; eighth++) {
      mix.add(hat(human.gain(eighth % 2 === 0 ? 0.45 : 0.3), random), human.at(time.at(bar, eighth / 2 + swing(eighth) / 2)), 0.13, 0.35, 0.1)
    }
  }
  const out = mix.finish(0.8, 0.5, 0.45)
  // The low-pass that makes it "lo-fi", and a soft crackle from a seeded
  // scatter of tiny clicks.
  const crackle = seededRandom(3003)
  for (const side of [out.left, out.right]) {
    lowPass(lowPass(side, 3200), 3200)
  }
  for (let index = 0; index < out.left.length; index++) {
    if (crackle() < 0.0004) {
      const amplitude = 0.004 + crackle() * 0.012
      const side = crackle() < 0.5 ? out.left : out.right
      for (let tail = 0; tail < 24 && index + tail < side.length; tail++) {
        side[index + tail] += amplitude * Math.exp(-tail / 4) * (tail % 2 === 0 ? 1 : -1)
      }
    }
  }
  return fadeEnds(out, 1.5, TAIL + time.bar)
}

/**
 * Cinematic: low strings swelling on a minor i–VI–III–VII progression,
 * deep drum hits that build, and high piano notes falling over the top,
 * growing from a quiet opening to a full close.
 */
function horizon(): Stereo {
  const random = seededRandom(4001)
  const human = humanise(seededRandom(4002), 0.008, 0.15)
  const time = clock(66)
  const tonic = 62 // D minor
  const progression = [1, 6, 3, 7]
  const bars = 20
  const mix = new Mix(bars * time.bar + TAIL)
  for (let bar = 0; bar < bars; bar++) {
    const degree = progression[bar % progression.length]
    const tones = chordTones(MINOR, degree)
    // Rises from 0.6 to 1 over the track, falling back in the last two bars.
    const build = bar >= bars - 2 ? 0.75 : 0.6 + (0.4 * bar) / (bars - 3)
    for (const note of voice(tonic - 12, tones, 52)) {
      mix.add(pad(note, time.bar + 0.2, random, WARM_SAW, 900 + 1400 * build), time.at(bar), 0.11 * build, (note % 3) / 3 - 0.33, 0.45)
    }
    // An octave of the root underneath, for weight.
    const root = voice(tonic - 24, tones.slice(0, 1), 38)[0]
    mix.add(pad(root, time.bar + 0.2, random, SOFT_SQUARE, 500), time.at(bar), 0.16 * build, 0, 0.3)
    if (bar >= 4) {
      mix.add(kick(human.gain(0.9), 42, 0.45), time.at(bar), 0.55 * build, 0, 0.5)
      if (bar >= 12 && bar < bars - 2) mix.add(kick(human.gain(0.6), 42, 0.35), time.at(bar, 2.5), 0.45 * build, 0, 0.5)
    }
    // High piano: three chord tones falling across the bar, from the second pass on.
    if (bar >= 4 && bar < bars - 1) {
      const high = voice(tonic + 12, tones, 76).reverse()
      high.forEach((note, step) => {
        mix.add(electricPiano(note, time.beat * 1.2, human.gain(0.5)), human.at(time.at(bar, step * 1.33)), 0.11, 0.3 - step * 0.3, 0.7)
      })
    }
  }
  return fadeEnds(mix.finish(0.9, 0.3, 0.85), 2, TAIL + time.bar)
}

/**
 * Playful: a marimba tune and a bouncing pizzicato bass over I–vi–IV–V,
 * finger snaps on the back beat and a shaker. The tune is a two-bar motif
 * fitted to each chord, so it repeats and varies like a written melody.
 */
function bounce(): Stereo {
  const random = seededRandom(5001)
  const human = humanise(seededRandom(5002))
  const time = clock(118)
  const tonic = 67 // G
  const progression = [1, 6, 4, 5]
  const bars = 36
  const mix = new Mix(bars * time.bar + TAIL)
  // The motif: which eighths sound, and a contour (scale steps) for each.
  const motifRandom = seededRandom(5003)
  const rhythm = Array.from({ length: 16 }, (_, eighth) => eighth % 4 === 0 || motifRandom() < 0.45)
  const contour = Array.from({ length: 16 }, () => Math.floor(motifRandom() * 5))
  for (let bar = 0; bar < bars; bar++) {
    const degree = progression[bar % progression.length]
    const tones = chordTones(MAJOR, degree)
    const intro = bar < 4
    const outro = bar >= bars - 2
    // Marimba: from the motif, each note the chord tone nearest its contour.
    if (!outro) {
      const chord = voice(tonic + 12, tones, 76)
      const candidates = [...chord.map((note) => note - 12), ...chord, ...chord.map((note) => note + 12)]
      for (let eighth = 0; eighth < 8; eighth++) {
        const step = (bar % 2) * 8 + eighth
        if (!rhythm[step] || (intro && eighth % 4 !== 0)) continue
        const note = candidates[Math.min(candidates.length - 1, 2 + contour[step])]
        mix.add(marimba(note, human.gain(eighth % 4 === 0 ? 0.9 : 0.65)), human.at(time.at(bar, eighth / 2)), 0.3, 0.25, 0.3)
      }
    }
    // Soft chord stabs on the off-beats, a marimba an octave down.
    for (const beat of [0.5, 1.5, 2.5, 3.5]) {
      voice(tonic, tones, 64).forEach((note, index) => {
        mix.add(marimba(note, human.gain(0.4)), human.at(time.at(bar, beat)), 0.12, -0.3 + index * 0.15, 0.25)
      })
    }
    if (intro) continue
    const root = voice(tonic - 24, tones.slice(0, 1), 43)[0]
    for (const [beat, offset] of [
      [0, 0],
      [1, 7],
      [2, 12],
      [3, 7],
    ] as const) {
      mix.add(bass(root + offset, time.beat * 0.5, human.gain(0.85), true), time.at(bar, beat), 0.45, 0, 0.05)
    }
    if (outro) continue
    mix.add(kick(human.gain(0.7), 55, 0.15), time.at(bar), 0.4, 0, 0.05)
    mix.add(kick(human.gain(0.55), 55, 0.15), time.at(bar, 2), 0.4, 0, 0.05)
    for (const beat of [1, 3]) mix.add(clap(human.gain(0.55), random), human.at(time.at(bar, beat)), 0.22, -0.15, 0.35)
    for (let sixteenth = 0; sixteenth < 16; sixteenth++) {
      mix.add(
        hat(human.gain(sixteenth % 4 === 2 ? 0.6 : 0.3), random, 0.05, 0.01),
        human.at(time.at(bar, sixteenth / 4)),
        0.1,
        0.5,
        0.1,
      )
    }
  }
  return fadeEnds(mix.finish(0.75, 0.45, 0.45), 0.01, TAIL + time.bar)
}

/**
 * Tech: a sixteenth-note synth arpeggio over a minor i–VI–III–VII, a pad
 * that pumps with a four-on-the-floor kick, offbeat hats, and a filter
 * that opens across the track.
 */
function circuit(): Stereo {
  const random = seededRandom(6001)
  const human = humanise(seededRandom(6002), 0.003, 0.1)
  const time = clock(120)
  const tonic = 57 // A minor
  const progression = [1, 6, 3, 7]
  const bars = 36
  const mix = new Mix(bars * time.bar + TAIL)
  const padBus: Stereo = { left: new Float32Array(mix.length), right: new Float32Array(mix.length) }
  for (let bar = 0; bar < bars; bar++) {
    const degree = progression[bar % progression.length]
    const tones = chordTones(MINOR, degree, 4)
    const open = Math.min(1, bar / 24)
    for (const note of voice(tonic + 12, tones, 64)) {
      mix.add(pad(note, time.bar, random, WARM_SAW, 1200 + 1800 * open), time.at(bar), 0.09, (note % 4) / 4 - 0.4, 0.35, padBus)
    }
    // Arpeggio: up through the chord and its octave, a sixteenth each.
    const arpeggio = [...voice(tonic + 12, tones, 69), ...voice(tonic + 24, tones, 81)]
    const order = [0, 1, 2, 3, 4, 3, 2, 1]
    if (bar >= 1 && bar < bars - 1) {
      for (let sixteenth = 0; sixteenth < 16; sixteenth++) {
        const note = arpeggio[order[sixteenth % order.length]]
        const length = samplesFor(time.beat * 0.22 + 0.06)
        const f = midiToHz(note)
        const tone = lowPass(oscillate(SOFT_SQUARE, length, () => f), 900 + 2600 * open)
        envelope(tone, time.beat * 0.22, 0.003, 0.05, 0.6, 0.06)
        mix.add(tone, time.at(bar, sixteenth / 4), human.gain(0.16), sixteenth % 2 === 0 ? -0.4 : 0.4, 0.3)
      }
    }
    if (bar < 4 || bar >= bars - 2) continue
    const root = voice(tonic - 24, tones.slice(0, 1), 36)[0]
    for (let eighth = 0; eighth < 8; eighth++) {
      if (eighth % 2 === 0) continue
      mix.add(bass(root, time.beat * 0.4, human.gain(0.9)), time.at(bar, eighth / 2), 0.42, 0, 0.03)
    }
    for (let beat = 0; beat < 4; beat++) mix.add(kick(human.gain(0.9), 46, 0.2), time.at(bar, beat), 0.5, 0, 0.03)
    for (let beat = 0; beat < 4; beat++) mix.add(hat(human.gain(0.55), random, 0.04), human.at(time.at(bar, beat + 0.5)), 0.15, 0.35, 0.1)
    if (bar >= 12) for (const beat of [1, 3]) mix.add(clap(human.gain(0.6), random), time.at(bar, beat), 0.2, 0, 0.3)
  }
  // The pad ducks on every beat from bar 4, as if the kick pushed it aside.
  const kickFrom = samplesFor(time.at(4))
  const kickTo = samplesFor(time.at(bars - 2))
  const beatLength = samplesFor(time.beat)
  for (let index = 0; index < mix.length; index++) {
    let gain = 1
    if (index >= kickFrom && index < kickTo) {
      const phase = ((index - kickFrom) % beatLength) / beatLength
      gain = 0.35 + 0.65 * Math.min(1, phase / 0.45)
    }
    mix.dry.left[index] += padBus.left[index] * gain
    mix.dry.right[index] += padBus.right[index] * gain
  }
  return fadeEnds(mix.finish(0.8, 0.4, 0.45), 1, TAIL + 2 * time.bar)
}

export const MUSIC: readonly MusicTrack[] = [
  {
    id: 'still-water',
    name: 'Still water',
    mood: 'Calm',
    description:
      'Calm, ambient. Warm pads on slow major-seventh chords in D, a soft electric-piano arpeggio, a deep room. No drums. 68 BPM.',
    render: stillWater,
  },
  {
    id: 'bright-side',
    name: 'Bright side',
    mood: 'Upbeat',
    description:
      'Upbeat, corporate. Plucked guitar in eighth notes on C–G–Am–F, driving bass, kick, clap and hats, a pad in the choruses. 112 BPM.',
    render: brightSide,
  },
  {
    id: 'late-night-notes',
    name: 'Late night notes',
    mood: 'Lo-fi',
    description:
      'Lo-fi. Electric-piano seventh chords on a ii–V–I–vi in F, a lazy swung beat, round bass, rolled-off highs and a quiet vinyl crackle. 78 BPM.',
    render: lateNightNotes,
  },
  {
    id: 'horizon',
    name: 'Horizon',
    mood: 'Cinematic',
    description:
      'Cinematic. Low strings swelling on Dm–B♭–F–C, deep drum hits that build, high piano notes falling over the top. 66 BPM.',
    render: horizon,
  },
  {
    id: 'bounce',
    name: 'Bounce',
    mood: 'Playful',
    description:
      'Playful. A marimba tune and off-beat marimba chords on G–Em–C–D, a bouncing plucked bass, snaps and a shaker. 118 BPM.',
    render: bounce,
  },
  {
    id: 'circuit',
    name: 'Circuit',
    mood: 'Tech',
    description:
      'Tech. A sixteenth-note synth arpeggio on Am–F–C–G, a pad pumping with a four-on-the-floor kick, offbeat hats, a filter opening across the track. 120 BPM.',
    render: circuit,
  },
]

/** The level every bed is mastered to: its RMS, in dBFS. */
export const MUSIC_RMS_DB = -18
/** Where the limiter starts to round peaks off, as a fraction of full scale. */
const KNEE = 0.6

/**
 * Masters a bed: scales it so its RMS (both channels together) is
 * `MUSIC_RMS_DB`, so every bed plays at about the same loudness, then
 * rounds off any peak above `KNEE` smoothly towards `peak`, so nothing
 * clips. Below the knee the samples are untouched.
 */
export function masterMusic(mix: Stereo, peak: number): Stereo {
  let energy = 0
  for (const side of [mix.left, mix.right]) for (const sample of side) energy += sample * sample
  const rms = Math.sqrt(energy / (2 * mix.left.length))
  const gain = rms === 0 ? 0 : 10 ** (MUSIC_RMS_DB / 20) / rms
  const knee = KNEE * peak
  const limit = (x: number) => {
    const magnitude = Math.abs(x * gain)
    if (magnitude <= knee) return x * gain
    return Math.sign(x) * (knee + (peak - knee) * Math.tanh((magnitude - knee) / (peak - knee)))
  }
  return { left: mix.left.map(limit), right: mix.right.map(limit) }
}
