# 0004. MP3 export encodes with a pure-JS LAME port (`@breezystack/lamejs`)

- Status: accepted
- Date: 2026-09-04
- Links: #269 (the MP3 export issue), #264 (originating customer feedback),
  #245 (audio-only export and the mix graph this taps), #198 (the frame-sink
  precedent the audio-sink seam follows)

## Context

The customer asked for MP3 as an audio export format (#264). Every existing
export encodes through MediaRecorder, but no browser's MediaRecorder emits
MP3, so the format cannot ride the recording pipeline the way `audio-webm`
(#245) does. Encoding must happen in product code, which makes this the
project's first media-encoding dependency — until now the only runtime
dependencies were React and `gifenc` (a GIF *palette* encoder, inside the
GIF plugin).

Three ways to get PCM into an encoder were weighed in #269 and in the PR:

- **Tap the existing mix graph** while the export's replay loop runs, then
  encode the captured PCM. One mix, the same per-frame gain sync as every
  other export; parity with the WebM path is by construction.
- **Record WebM/Opus first, then decode and re-encode.** Simple, but a
  double lossy generation (Opus then MP3), and it needs MediaRecorder audio
  support, which the tap does not.
- **Render the mix offline** (OfflineAudioContext). Faster than real time,
  but it re-implements the mix — a second place gains, fades, ducking and
  remaps must agree with the preview, which is exactly what #245 avoided.

## Decision

Tap the mix graph (an `ExportAudioSink` seam in `exportVideo.ts`, the audio
counterpart of #198's frame sink) and encode with **`@breezystack/lamejs`
1.2.7**, a maintained fork of `lamejs` — the LAME MP3 encoder ported to
pure JavaScript. The fork over the original because upstream `lamejs` was
last published in 2019 and its 1.2.1 build breaks under ES-module bundling
(the known `MPEGMode is not defined` defect); the fork fixes that, ships
ESM with TypeScript types, and changes no encoding behaviour.

Encoding parameters: 192 kbps CBR stereo at the AudioContext's sample rate
(`MP3_KBPS` in `exportMp3.ts` states the reasoning).

### License

`@breezystack/lamejs` is **LGPL-3.0** (as is upstream `lamejs`; LAME itself
is LGPL). Everything else this product ships is MIT-licensed, so this is a
deliberate exception, and it is compatible with this use: the library is
used unmodified as a separable, dynamically imported chunk — a later session
must keep it that way. Bundling it into the entry chunk, or patching the
library in place rather than wrapping it, would change the compliance
picture and needs a fresh look at this ADR.

### Consequences

- The encoder loads lazily inside `exportMp3.ts`; the entry bundle does not
  grow. A visitor pays the encoder's download (~55 kB gzipped) on the first
  MP3 export.
- Pure JS encoding is fast enough here: the pipeline already runs in real
  time (a 30 s sequence takes 30 s to replay), and encoding happens after
  capture at far better than real time.
- MP3 support requires only Web Audio, not MediaRecorder — the format's
  `isSupported` reflects that, so it can be offered where `audio-webm`
  cannot.
- If the dependency rots, the seams hold: `Mp3EncoderModule` in
  `exportMp3.ts` is the contract a replacement encoder (another LAME port,
  or a WASM encoder) has to meet, and the audio sink does not care what
  encodes the PCM it captured.
