/**
 * Builds a real, decodable WAV (mono, 8 kHz, 16-bit sine) directly in Node —
 * WAV is a fixed header plus raw PCM, so no recorder is needed and no binary
 * fixture is committed. Chromium decodes it natively, so audio flows
 * (#101 import, #102 timeline placement) run against real media.
 */
export function sineWav(seconds = 2, sampleRate = 8000): Buffer {
  const sampleCount = seconds * sampleRate
  const dataLength = sampleCount * 2
  const buffer = Buffer.alloc(44 + dataLength)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataLength, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16) // PCM chunk size
  buffer.writeUInt16LE(1, 20) // PCM format
  buffer.writeUInt16LE(1, 22) // mono
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28) // byte rate
  buffer.writeUInt16LE(2, 32) // block align
  buffer.writeUInt16LE(16, 34) // bits per sample
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataLength, 40)
  for (let index = 0; index < sampleCount; index++) {
    const sample = Math.round(Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 0x4000)
    buffer.writeInt16LE(sample, 44 + index * 2)
  }
  return buffer
}
