import { describe, expect, it } from 'vitest'
import {
  SETTINGS_GROUPS,
  compatibleSettingsGroups,
  copyElementSettings,
  filterSettings,
  heldSettingsGroups,
} from './settingsClipboard'
import type { CopiedSettings } from './settingsClipboard'
import type { AudioTrack, TimelineEntry } from './timeline'
import { slateEntry } from './timeline'
import type { VideoOverlay } from './videoOverlay'
import type { TextOverlay } from './textOverlay'
import { DEFAULT_TEXT } from './textOverlay'

const videoEntry = (overrides: Partial<TimelineEntry> = {}): TimelineEntry => ({
  id: 'e1',
  clipId: 'c1',
  name: 'a.mp4',
  duration: 10,
  url: 'blob:a',
  inPoint: 0,
  outPoint: 10,
  ...overrides,
})

const track = (overrides: Partial<AudioTrack> = {}): AudioTrack => ({
  id: 't1',
  clipId: 'c2',
  name: 'm.mp3',
  duration: 8,
  url: 'blob:m',
  offset: 0,
  inPoint: 0,
  outPoint: 8,
  ...overrides,
})

const overlay = (overrides: Partial<VideoOverlay> = {}): VideoOverlay => ({
  id: 'v1',
  clipId: 'c3',
  name: 'cam.webm',
  duration: 6,
  url: 'blob:cam',
  offset: 0,
  inPoint: 0,
  outPoint: 6,
  x: 0.62,
  y: 0.62,
  width: 0.35,
  height: 0.35,
  ...overrides,
})

/**
 * A still overlay (#294): the same lane as `overlay` above, with a kind and
 * no audio fields at all — the model refuses them on this kind.
 */
const stillOverlay = (overrides: Partial<VideoOverlay> = {}): VideoOverlay =>
  overlay({ id: 'i1', kind: 'image', clipId: 'c-logo', name: 'logo.png', duration: 5, url: 'blob:logo', outPoint: 5, ...overrides })

const text = (overrides: Partial<TextOverlay> = {}): TextOverlay => ({
  ...DEFAULT_TEXT,
  id: 'x1',
  ...overrides,
})

describe('heldSettingsGroups (#315)', () => {
  it('judges from the element, not just its kind', () => {
    expect(heldSettingsGroups('entry', videoEntry())).toEqual([
      'color',
      'orientation',
      'crop',
      'background-fill',
      'audio',
    ])
    // A still image is soundless (#220): the visual groups only.
    expect(heldSettingsGroups('entry', videoEntry({ kind: 'image' }))).toEqual([
      'color',
      'orientation',
      'crop',
      'background-fill',
    ])
    // A slate holds nothing: its color is set directly (#143).
    expect(heldSettingsGroups('entry', slateEntry('s1'))).toEqual([])
    expect(heldSettingsGroups('audio-track', track())).toEqual(['audio'])
    // An overlay has no background fill; its card is its own frame.
    expect(heldSettingsGroups('video-overlay', overlay())).toEqual([
      'color',
      'orientation',
      'crop',
      'audio',
    ])
    expect(heldSettingsGroups('text', text())).toEqual(['text-style'])
  })
})

describe('copyElementSettings (#315)', () => {
  it('copies a video entry with effective values, identity included', () => {
    const decorated = videoEntry({
      colorAdjustments: { brightness: 150 },
      crop: { left: 0.1 },
      volume: 0.5,
      muted: true,
      fadeIn: 1,
    })
    expect(copyElementSettings('entry', decorated)).toEqual({
      color: { adjustments: { brightness: 150 } },
      orientation: { orientation: undefined },
      crop: { crop: { left: 0.1 } },
      'background-fill': { fill: undefined },
      audio: { volume: 0.5, muted: true, fadeIn: 1, fadeOut: 0 },
    })
    // An untouched entry copies pure identity — pasting it is a reset.
    expect(copyElementSettings('entry', videoEntry())).toEqual({
      color: { adjustments: undefined },
      orientation: { orientation: undefined },
      crop: { crop: undefined },
      'background-fill': { fill: undefined },
      audio: { volume: 1, muted: false, fadeIn: 0, fadeOut: 0 },
    })
  })

  it('a slate has nothing to copy', () => {
    expect(copyElementSettings('entry', slateEntry('s1'))).toBeUndefined()
  })

  it('a track copies audio without a muted key — a track holds no mute', () => {
    const copied = copyElementSettings('audio-track', track({ volume: 0.7, fadeOut: 2 }))
    expect(copied).toEqual({ audio: { volume: 0.7, fadeIn: 0, fadeOut: 2 } })
    expect(Object.hasOwn(copied!.audio!, 'muted')).toBe(false)
  })

  it('an overlay copies its visual groups and audio; a text its style with fades', () => {
    expect(
      copyElementSettings('video-overlay', overlay({ orientation: { rotation: 90 } })),
    ).toEqual({
      color: { adjustments: undefined },
      orientation: { orientation: { rotation: 90 } },
      crop: { crop: undefined },
      audio: { volume: 1, muted: false, fadeIn: 0, fadeOut: 0 },
    })
    expect(
      copyElementSettings('text', text({ color: '#ffcc00', bold: true, fadeIn: 0.5 })),
    ).toEqual({
      'text-style': {
        x: 0.5,
        y: 0.5,
        font: 'sans',
        size: 0.08,
        color: '#ffcc00',
        bold: true,
        italic: false,
        fadeIn: 0.5,
        fadeOut: 0,
      },
    })
  })
})

describe('compatibleSettingsGroups (#315)', () => {
  const fromClip = copyElementSettings('entry', videoEntry())!

  it('offers exactly the groups both rows hold, in canonical order', () => {
    expect(compatibleSettingsGroups(fromClip, 'entry', videoEntry({ id: 'e2' }))).toEqual([
      'color',
      'orientation',
      'crop',
      'background-fill',
      'audio',
    ])
    expect(compatibleSettingsGroups(fromClip, 'video-overlay', overlay())).toEqual([
      'color',
      'orientation',
      'crop',
      'audio',
    ])
    expect(compatibleSettingsGroups(fromClip, 'audio-track', track())).toEqual(['audio'])
    // Still image target: the clip's audio group does not apply.
    expect(compatibleSettingsGroups(fromClip, 'entry', videoEntry({ kind: 'image' }))).toEqual([
      'color',
      'orientation',
      'crop',
      'background-fill',
    ])
  })

  it('disjoint kinds yield nothing: clip→text, text→clip, clip→slate', () => {
    expect(compatibleSettingsGroups(fromClip, 'text', text())).toEqual([])
    const fromText = copyElementSettings('text', text())!
    expect(compatibleSettingsGroups(fromText, 'entry', videoEntry())).toEqual([])
    expect(compatibleSettingsGroups(fromClip, 'entry', slateEntry('s1'))).toEqual([])
  })
})

describe('filterSettings (#315)', () => {
  it('keeps only the chosen groups that the copied set holds', () => {
    const copied: CopiedSettings = copyElementSettings(
      'entry',
      videoEntry({ colorAdjustments: { saturation: 0 }, crop: { top: 0.2 } }),
    )!
    expect(filterSettings(copied, ['color', 'crop'])).toEqual({
      color: { adjustments: { saturation: 0 } },
      crop: { crop: { top: 0.2 } },
    })
    // Choosing a group the copied set lacks adds nothing.
    expect(filterSettings({ audio: copied.audio! }, ['audio', 'text-style'])).toEqual({
      audio: copied.audio,
    })
    expect(filterSettings(copied, [])).toEqual({})
  })

  it('the group ids and labels stay in one canonical list', () => {
    expect(SETTINGS_GROUPS.map(({ id }) => id)).toEqual([
      'color',
      'orientation',
      'crop',
      'background-fill',
      'audio',
      'text-style',
    ])
  })
})

describe('still overlays hold no audio group (#332)', () => {
  // The overlay lane holds video and stills since #294, so the audio group
  // has to be judged from the element — the regression this pins is that a
  // fixed per-kind list credited every overlay with audio, which made a
  // paste FROM a still reset the target's audio.
  it('a still overlay holds the visual groups only; a video overlay keeps audio', () => {
    expect(heldSettingsGroups('video-overlay', stillOverlay())).toEqual([
      'color',
      'orientation',
      'crop',
    ])
    expect(heldSettingsGroups('video-overlay', overlay())).toEqual([
      'color',
      'orientation',
      'crop',
      'audio',
    ])
  })

  it('copying a still overlay carries no audio key at all', () => {
    const copied = copyElementSettings('video-overlay', stillOverlay())
    expect(copied).toEqual({
      color: { adjustments: undefined },
      orientation: { orientation: undefined },
      crop: { crop: undefined },
    })
    // Not merely absent-valued: the key itself must not exist, or the paste
    // would treat it as "apply the identity", which is the reset.
    expect(Object.hasOwn(copied!, 'audio')).toBe(false)
    // The treatments a still overlay does hold still copy through.
    const graded = copyElementSettings(
      'video-overlay',
      stillOverlay({ colorAdjustments: { saturation: 140 }, crop: { top: 0.1 } }),
    )
    expect(graded).toMatchObject({
      color: { adjustments: { saturation: 140 } },
      crop: { crop: { top: 0.1 } },
    })
  })

  it('offers no Audio group in either direction between a still overlay and a clip', () => {
    const fromClip = copyElementSettings('entry', videoEntry())!
    const fromStill = copyElementSettings('video-overlay', stillOverlay())!
    // Pasting a clip's settings ONTO a still overlay: the target holds no
    // audio, so the intersection drops it.
    expect(compatibleSettingsGroups(fromClip, 'video-overlay', stillOverlay())).toEqual([
      'color',
      'orientation',
      'crop',
    ])
    // Pasting a still overlay's settings onto anything: it never carried an
    // audio group to offer — including onto an audio track, which holds
    // nothing else, so the paste has nothing to apply at all.
    expect(compatibleSettingsGroups(fromStill, 'entry', videoEntry())).toEqual([
      'color',
      'orientation',
      'crop',
    ])
    expect(compatibleSettingsGroups(fromStill, 'video-overlay', overlay())).toEqual([
      'color',
      'orientation',
      'crop',
    ])
    expect(compatibleSettingsGroups(fromStill, 'audio-track', track())).toEqual([])
  })
})
