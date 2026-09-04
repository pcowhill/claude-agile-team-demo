import type { ColorAdjustments } from './colorAdjustments'
import type { Orientation } from './orientation'
import type { Crop } from './crop'
import type { BackgroundFill } from './backgroundFill'
import type { TextFontId } from './textOverlay'
import type { AudioTrack, TimelineEntry, TextOverlay } from './timeline'
import { isSlateEntry, isStillEntry } from './timeline'
import type { VideoOverlay } from './videoOverlay'

/**
 * Copy settings / Paste settings between timeline elements (#315): the pure
 * rules for what a row's copiable settings are, which groups a row can hold,
 * and which of a copied set applies to a given target. The copied settings
 * themselves are SESSION STATE, owned by the Timeline component like the
 * collapse state (#299) — never written to the project model, project files,
 * or the autosave snapshot. Only a paste — an ordinary reducer action — ever
 * reaches the model.
 *
 * Copy semantics are "make the target look like the source": each group
 * records the source's *effective* value, identity included. A source with
 * no crop copies "whole frame", and pasting the Crop group resets the
 * target's crop — the exact-match behavior of every mainstream editor's
 * Paste Attributes, and the reason a group's value may be `undefined`
 * (identity / none) while the group itself is present.
 */

/** The kind discriminator paste actions carry — the #314 duplicate kinds. */
export type SettingsElementKind = 'entry' | 'audio-track' | 'video-overlay' | 'text'

export const SETTINGS_GROUPS = [
  { id: 'color', label: 'Color' },
  { id: 'orientation', label: 'Orientation' },
  { id: 'crop', label: 'Crop' },
  { id: 'background-fill', label: 'Background fill' },
  { id: 'audio', label: 'Audio' },
  { id: 'text-style', label: 'Text style' },
] as const

export type SettingsGroup = (typeof SETTINGS_GROUPS)[number]['id']

/**
 * The audio group's fields (#104/#220): effective values, so identity
 * (full volume, unmuted, no fades) pastes as the reset it is. `muted` is
 * present only when the source kind holds a mute at all (sequence entries
 * and video overlays; an audio track has none) — absent means "leave the
 * target's mute alone", never "unmute".
 */
export interface AudioSettings {
  volume: number
  muted?: boolean
  fadeIn: number
  fadeOut: number
}

/**
 * The text-style group: the subtitle-style surface (#250's
 * SUBTITLE_STYLE_FIELDS — position, type, color, emphasis) plus the visual
 * fades (#177), which the customer's motivating case names alongside them.
 * `x`/`y` are the block's on-frame centre — style, not timeline placement;
 * a paste never touches offset or duration.
 */
export interface TextStyleSettings {
  x: number
  y: number
  font: TextFontId
  size: number
  color: string
  bold: boolean
  italic: boolean
  fadeIn: number
  fadeOut: number
}

/**
 * What Copy settings holds. A key is present exactly when the source row
 * holds that group; the value inside may be `undefined`, meaning the
 * source's effective value is the identity (see the module comment).
 */
export interface CopiedSettings {
  color?: { adjustments: ColorAdjustments | undefined }
  orientation?: { orientation: Orientation | undefined }
  crop?: { crop: Crop | undefined }
  'background-fill'?: { fill: BackgroundFill | undefined }
  audio?: AudioSettings
  'text-style'?: TextStyleSettings
}

const groupsOf = (settings: CopiedSettings): SettingsGroup[] =>
  SETTINGS_GROUPS.filter(({ id }) => settings[id] !== undefined).map(({ id }) => id)

/**
 * The groups a row can hold, judged from the element (not just its kind):
 * a slate holds none — its color is set directly (#143) and it carries no
 * adjustments, orientation, crop, fill, or audio — and a still image holds
 * no audio (soundless, #220). This is both what Copy takes and what a paste
 * checklist may offer the row as a target.
 */
export function heldSettingsGroups(
  kind: SettingsElementKind,
  element: TimelineEntry | AudioTrack | VideoOverlay | TextOverlay,
): SettingsGroup[] {
  switch (kind) {
    case 'entry': {
      const entry = element as TimelineEntry
      if (isSlateEntry(entry)) return []
      const visual: SettingsGroup[] = ['color', 'orientation', 'crop', 'background-fill']
      return isStillEntry(entry) ? visual : [...visual, 'audio']
    }
    case 'audio-track':
      return ['audio']
    case 'video-overlay':
      return ['color', 'orientation', 'crop', 'audio']
    case 'text':
      return ['text-style']
  }
}

/**
 * Copy settings (#315): the source row's settings, one entry per group the
 * row holds, effective values throughout. Returns `undefined` for a row
 * with nothing to copy (a slate), so the control can simply not render.
 */
export function copyElementSettings(
  kind: SettingsElementKind,
  element: TimelineEntry | AudioTrack | VideoOverlay | TextOverlay,
): CopiedSettings | undefined {
  switch (kind) {
    case 'entry': {
      const entry = element as TimelineEntry
      if (isSlateEntry(entry)) return undefined
      const visual: CopiedSettings = {
        color: { adjustments: entry.colorAdjustments },
        orientation: { orientation: entry.orientation },
        crop: { crop: entry.crop },
        'background-fill': { fill: entry.backgroundFill },
      }
      if (isStillEntry(entry)) return visual
      return {
        ...visual,
        audio: {
          volume: entry.volume ?? 1,
          muted: entry.muted ?? false,
          fadeIn: entry.fadeIn ?? 0,
          fadeOut: entry.fadeOut ?? 0,
        },
      }
    }
    case 'audio-track': {
      const track = element as AudioTrack
      // No `muted`: a track holds no mute, so a paste from it leaves the
      // target's mute alone rather than inventing a value.
      return {
        audio: {
          volume: track.volume ?? 1,
          fadeIn: track.fadeIn ?? 0,
          fadeOut: track.fadeOut ?? 0,
        },
      }
    }
    case 'video-overlay': {
      const overlay = element as VideoOverlay
      return {
        color: { adjustments: overlay.colorAdjustments },
        orientation: { orientation: overlay.orientation },
        crop: { crop: overlay.crop },
        audio: {
          volume: overlay.volume ?? 1,
          muted: overlay.muted ?? false,
          fadeIn: overlay.fadeIn ?? 0,
          fadeOut: overlay.fadeOut ?? 0,
        },
      }
    }
    case 'text': {
      const text = element as TextOverlay
      return {
        'text-style': {
          x: text.x,
          y: text.y,
          font: text.font,
          size: text.size,
          color: text.color,
          bold: text.bold,
          italic: text.italic,
          fadeIn: text.fadeIn ?? 0,
          fadeOut: text.fadeOut ?? 0,
        },
      }
    }
  }
}

/**
 * The groups a paste checklist offers: exactly those both the copied set
 * and the target row hold, in the canonical `SETTINGS_GROUPS` order. Empty
 * means the paste has nothing to apply — the dialog says so instead of
 * presenting an empty checklist.
 */
export function compatibleSettingsGroups(
  copied: CopiedSettings,
  targetKind: SettingsElementKind,
  target: TimelineEntry | AudioTrack | VideoOverlay | TextOverlay,
): SettingsGroup[] {
  const held = new Set(heldSettingsGroups(targetKind, target))
  return groupsOf(copied).filter((group) => held.has(group))
}

/** The subset of a copied set the checklist's chosen groups keep. */
export function filterSettings(
  copied: CopiedSettings,
  chosen: readonly SettingsGroup[],
): CopiedSettings {
  const keep = new Set(chosen)
  const filtered: CopiedSettings = {}
  if (keep.has('color') && copied.color !== undefined) filtered.color = copied.color
  if (keep.has('orientation') && copied.orientation !== undefined)
    filtered.orientation = copied.orientation
  if (keep.has('crop') && copied.crop !== undefined) filtered.crop = copied.crop
  if (keep.has('background-fill') && copied['background-fill'] !== undefined)
    filtered['background-fill'] = copied['background-fill']
  if (keep.has('audio') && copied.audio !== undefined) filtered.audio = copied.audio
  if (keep.has('text-style') && copied['text-style'] !== undefined)
    filtered['text-style'] = copied['text-style']
  return filtered
}
