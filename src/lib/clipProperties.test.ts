import { describe, expect, it } from 'vitest'
import {
  READING,
  UNKNOWN,
  clipPropertyRows,
  formatAspectRatio,
  formatChannels,
  formatFileSize,
  formatLength,
} from './clipProperties'
import type { ClipReads } from './clipProperties'
import { NOT_STATED } from './containerInfo'

const settled: ClipReads = {
  file: { state: 'done', value: { type: 'video/webm', size: 4_212_345 } },
  dimensions: { state: 'done', value: { width: 1920, height: 1080 } },
  channels: { state: 'done', value: 2 },
  container: {
    state: 'done',
    value: {
      container: 'WebM',
      video: { codec: 'VP9', frameRate: { kind: 'constant', fps: 30000 / 1001 } },
      audio: { codec: 'Opus', sampleRate: 48000 },
    },
  },
}
const labels = (rows: { label: string }[]) => rows.map((row) => row.label)
const valueOf = (rows: { label: string; value: string }[], label: string) =>
  rows.find((row) => row.label === label)?.value

describe('formatters (#804)', () => {
  it('writes sizes in decimal units with the exact bytes', () => {
    expect(formatFileSize(1)).toBe('1 byte')
    expect(formatFileSize(999)).toBe('999 bytes')
    expect(formatFileSize(4_212_345)).toBe('4.2 MB (4,212,345 bytes)')
    expect(formatFileSize(42_000)).toBe('42 kB (42,000 bytes)')
    expect(formatFileSize(1_500_000_000)).toBe('1.5 GB (1,500,000,000 bytes)')
  })

  it('writes an aspect ratio in recognisable terms, else as a decimal', () => {
    expect(formatAspectRatio(1920, 1080)).toBe('16:9')
    expect(formatAspectRatio(640, 480)).toBe('4:3')
    expect(formatAspectRatio(64, 64)).toBe('1:1')
    expect(formatAspectRatio(1366, 768)).toBe('1.78:1')
  })

  it('names one and two channels, and counts the rest', () => {
    expect(formatChannels(1)).toBe('Mono')
    expect(formatChannels(2)).toBe('Stereo')
    expect(formatChannels(6)).toBe('6 channels')
  })

  it('writes a length in the app’s format and in seconds', () => {
    expect(formatLength(65.2)).toBe('1:05 (65.20 s)')
    expect(formatLength(6.008)).toBe('0:06 (6.01 s)')
  })
})

describe('clipPropertyRows (#804)', () => {
  it('gives a video every row that applies, in order', () => {
    const rows = clipPropertyRows({ name: 'a.webm', kind: 'video', duration: 6.008 }, settled, 2)
    expect(labels(rows)).toEqual([
      'Name',
      'Kind',
      'File type',
      'Container',
      'File size',
      'Length',
      'Dimensions',
      'Aspect ratio',
      'Frame rate',
      'Video codec',
      'Has sound',
      'Audio channels',
      'Audio codec',
      'Sample rate',
      'On the timeline',
    ])
    expect(valueOf(rows, 'Kind')).toBe('Video')
    expect(valueOf(rows, 'File type')).toBe('video/webm')
    expect(valueOf(rows, 'File size')).toBe('4.2 MB (4,212,345 bytes)')
    expect(valueOf(rows, 'Dimensions')).toBe('1920 × 1080 px')
    expect(valueOf(rows, 'Aspect ratio')).toBe('16:9')
    expect(valueOf(rows, 'Has sound')).toBe('Yes')
    expect(valueOf(rows, 'Audio channels')).toBe('Stereo')
    expect(valueOf(rows, 'On the timeline')).toBe('2 placements')
    // The container's own statements (#805).
    expect(valueOf(rows, 'Container')).toBe('WebM')
    expect(valueOf(rows, 'Frame rate')).toBe('29.97 fps')
    expect(valueOf(rows, 'Video codec')).toBe('VP9')
    expect(valueOf(rows, 'Audio codec')).toBe('Opus')
    expect(valueOf(rows, 'Sample rate')).toBe('48,000 Hz')
  })

  it('says what the container leaves unstated, and drops the sound rows when it has no audio track (#805)', () => {
    const rows = clipPropertyRows(
      { name: 'rec.webm', kind: 'video', duration: 3 },
      {
        ...settled,
        channels: { state: 'done', value: null },
        container: {
          state: 'done',
          value: { container: 'WebM', video: { codec: 'VP8', frameRate: { kind: 'not-stated' } }, audio: null },
        },
      },
      0,
    )
    expect(valueOf(rows, 'Frame rate')).toBe(NOT_STATED)
    expect(labels(rows)).not.toContain('Audio codec')
    expect(labels(rows)).not.toContain('Sample rate')

    const variable = clipPropertyRows(
      { name: 'phone.mp4', kind: 'video', duration: 3 },
      {
        ...settled,
        container: {
          state: 'done',
          value: {
            container: 'MP4',
            video: { codec: 'H.264', frameRate: { kind: 'variable', average: 29.456 } },
            audio: { codec: 'AAC', sampleRate: null },
          },
        },
      },
      0,
    )
    expect(valueOf(variable, 'Frame rate')).toBe('Variable (29.46 fps on average)')
    expect(valueOf(variable, 'Sample rate')).toBe(NOT_STATED)
  })

  it('drops Audio channels from a video with no decodable sound', () => {
    const rows = clipPropertyRows(
      { name: 'a.webm', kind: 'video', duration: 3 },
      { ...settled, channels: { state: 'done', value: null } },
      0,
    )
    expect(valueOf(rows, 'Has sound')).toBe('No (none this browser can decode)')
    expect(labels(rows)).not.toContain('Audio channels')
    expect(valueOf(rows, 'On the timeline')).toBe('Not placed')
  })

  it('gives audio no picture rows', () => {
    const rows = clipPropertyRows(
      { name: 'tone.wav', kind: 'audio', duration: 2 },
      { ...settled, file: { state: 'done', value: { type: 'audio/wav', size: 32_044 } }, channels: { state: 'done', value: 1 } },
      1,
    )
    expect(labels(rows)).toEqual([
      'Name',
      'Kind',
      'File type',
      'Container',
      'File size',
      'Length',
      'Audio channels',
      'Audio codec',
      'Sample rate',
      'On the timeline',
    ])
    expect(valueOf(rows, 'Audio channels')).toBe('Mono')
    expect(valueOf(rows, 'On the timeline')).toBe('1 placement')
  })

  it('gives an image its size from the clip, and no length or sound', () => {
    const rows = clipPropertyRows(
      { name: 'still.png', kind: 'image', duration: 0, width: 64, height: 32 },
      { ...settled, file: { state: 'done', value: { type: 'image/png', size: 120 } } },
      0,
    )
    expect(labels(rows)).toEqual(['Name', 'Kind', 'File type', 'File size', 'Dimensions', 'Aspect ratio', 'On the timeline'])
    expect(valueOf(rows, 'Dimensions')).toBe('64 × 32 px')
    expect(valueOf(rows, 'Aspect ratio')).toBe('2:1')
  })

  it('shows both names for a renamed clip, and the source of an extracted one', () => {
    const renamed = clipPropertyRows({ name: 'Intro', fileName: 'a.webm', kind: 'video', duration: 1 }, settled, 0)
    expect(valueOf(renamed, 'Name')).toBe('Intro')
    expect(valueOf(renamed, 'Original filename')).toBe('a.webm')

    const extracted = clipPropertyRows(
      { name: 'a.webm (audio)', kind: 'audio', duration: 6, extractedFrom: 'a.webm' },
      settled,
      0,
    )
    expect(valueOf(extracted, 'Extracted from')).toBe('a.webm')
    expect(labels(extracted)).not.toContain('Original filename')
    // Its file rows describe the video's bytes it plays from, and say so.
    expect(valueOf(extracted, 'File type')).toBe('video/webm (the source video’s file)')
    expect(valueOf(extracted, 'Container')).toBe('WebM (the source video’s file)')
    // Its sound is the video's audio track, so the codec rows are the clip's own.
    expect(valueOf(extracted, 'Audio codec')).toBe('Opus')
  })

  it('says Reading… until a read settles, Unknown when it fails or is empty', () => {
    const pending = clipPropertyRows(
      { name: 'a.webm', kind: 'video', duration: 1 },
      {
        file: { state: 'reading' },
        dimensions: { state: 'reading' },
        channels: { state: 'reading' },
        container: { state: 'reading' },
      },
      0,
    )
    for (const label of [
      'File type',
      'Container',
      'File size',
      'Dimensions',
      'Aspect ratio',
      'Frame rate',
      'Video codec',
      'Has sound',
      'Audio channels',
      'Audio codec',
      'Sample rate',
    ]) {
      expect(valueOf(pending, label)).toBe(READING)
    }
    const failed = clipPropertyRows(
      { name: 'a.webm', kind: 'video', duration: 1 },
      {
        file: { state: 'done', value: { type: '', size: 10 } },
        dimensions: { state: 'failed' },
        channels: { state: 'failed' },
        container: { state: 'failed' },
      },
      0,
    )
    expect(valueOf(failed, 'File type')).toBe(UNKNOWN)
    expect(valueOf(failed, 'Dimensions')).toBe(UNKNOWN)
    expect(valueOf(failed, 'Has sound')).toBe(UNKNOWN)
    expect(valueOf(failed, 'Audio channels')).toBe(UNKNOWN)
    // Unreadable headers (#805): every container row is Unknown, and the
    // rows the other reads fill are untouched by it.
    for (const label of ['Container', 'Frame rate', 'Video codec', 'Audio codec', 'Sample rate']) {
      expect(valueOf(failed, label)).toBe(UNKNOWN)
    }
    expect(valueOf(failed, 'File size')).toBe('10 bytes')
  })
})
