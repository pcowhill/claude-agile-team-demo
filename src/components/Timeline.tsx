import { useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { RemapSpec, TimelineState, TransitionSpec, TransitionType, ZoomSpec } from '../lib/timeline'
import {
  DEFAULT_TRANSITION_DURATION,
  audioTracksOf,
  boundaryTransitions,
  defaultZoomFor,
  effectiveDuration,
  entryOutputDuration,
  isSlateEntry,
  isStillEntry,
  remapsForEntry,
  remapsOf,
  totalDuration,
  zoomsForEntry,
} from '../lib/timeline'
import { defaultPauseFor, defaultSpeedFor } from '../lib/remap'
import { formatDuration } from '../lib/mediaLibrary'
import './Timeline.css'

interface TimelineProps {
  timeline: TimelineState
  onMoveEntry: (id: string, direction: 'up' | 'down') => void
  onRemoveEntry: (id: string) => void
  onTrimEntry: (id: string, inPoint: number, outPoint: number) => void
  /** Sets a still entry's on-screen duration (#140); stills have no trim. */
  onSetStillDuration: (id: string, duration: number) => void
  /** Appends a solid-color slate to the sequence (#143) — no import involved. */
  onAddSlate: () => void
  /** Sets a slate's fill color (#143), as lowercase #rrggbb from the picker. */
  onSetSlateColor: (id: string, color: string) => void
  onSetTransition: (beforeId: string, afterId: string, transition: TransitionSpec) => void
  onRemoveTransition: (beforeId: string, afterId: string) => void
  /** Adds a new zoom to the entry (#129); the id is the caller's to mint. */
  onAddZoom: (entryId: string, zoom: ZoomSpec) => void
  onUpdateZoom: (id: string, zoom: ZoomSpec) => void
  onRemoveZoom: (id: string) => void
  /** Adds a time-remap effect to the entry (#141); the id is the caller's to mint. */
  onAddRemap: (entryId: string, remap: RemapSpec) => void
  onUpdateRemap: (id: string, remap: RemapSpec) => void
  onRemoveRemap: (id: string) => void
  onRemoveAudioTrack: (id: string) => void
  onRetimeAudioTrack: (id: string, offset: number) => void
  onTrimAudioTrack: (id: string, inPoint: number, outPoint: number) => void
  onSetEntryVolume: (id: string, volume: number) => void
  onSetEntryMuted: (id: string, muted: boolean) => void
  onSetAudioTrackVolume: (id: string, volume: number) => void
  onSetAudioTrackFades: (id: string, fadeIn: number, fadeOut: number) => void
}

/** A stored zoom re-expressed as the spec `onSetZoom` takes (no entryId). */
const zoomSpecOf = ({ start, rampIn, hold, rampOut, scale, centerX, centerY }: ZoomSpec): ZoomSpec => ({
  start,
  rampIn,
  hold,
  rampOut,
  scale,
  centerX,
  centerY,
})

const TRANSITION_TYPE_NAMES: Record<TransitionType, string> = {
  crossfade: 'Crossfade',
  'slide-from-above': 'Slide from above',
  'slide-from-below': 'Slide from below',
  'slide-from-left': 'Slide from left',
  'slide-from-right': 'Slide from right',
}

/** Seconds as a plain number string with at most two decimals, e.g. 1.25 → "1.25", 3 → "3". */
const formatSeconds = (seconds: number) => String(Math.round(seconds * 100) / 100)

interface SecondsFieldProps {
  label: string
  value: number
  max: number
  min?: number
  step?: number
  onCommit: (value: number) => void
}

/**
 * Numeric input (trim points, transition durations, zoom parameters) that
 * commits on blur/Enter. The draft is local so the user can type freely; the
 * committed value is validated — and possibly clamped — by the reducer, and
 * the field snaps back to (or shows) the stored state either way, so a
 * clamp is visible rather than silent.
 */
function SecondsField({ label, value, max, min = 0, step = 0.1, onCommit }: SecondsFieldProps) {
  const [draft, setDraft] = useState(() => formatSeconds(value))

  useEffect(() => {
    setDraft(formatSeconds(value))
  }, [value])

  const commit = () => {
    const parsed = Number(draft)
    if (draft.trim() !== '' && Number.isFinite(parsed) && parsed !== value) onCommit(parsed)
    // If the reducer rejected (or clamped to) the same value, no prop change
    // arrives — reset the draft to the current state explicitly.
    setDraft(formatSeconds(value))
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur()
  }

  return (
    <input
      type="number"
      inputMode="decimal"
      step={step}
      min={min}
      max={max}
      aria-label={label}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={handleKeyDown}
    />
  )
}

export function Timeline({
  timeline,
  onMoveEntry,
  onRemoveEntry,
  onTrimEntry,
  onSetStillDuration,
  onAddSlate,
  onSetSlateColor,
  onSetTransition,
  onRemoveTransition,
  onAddZoom,
  onUpdateZoom,
  onRemoveZoom,
  onAddRemap,
  onUpdateRemap,
  onRemoveRemap,
  onRemoveAudioTrack,
  onRetimeAudioTrack,
  onTrimAudioTrack,
  onSetEntryVolume,
  onSetEntryMuted,
  onSetAudioTrackVolume,
  onSetAudioTrackFades,
}: TimelineProps) {
  const { entries } = timeline
  const transitions = boundaryTransitions(timeline)
  const audioTracks = audioTracksOf(timeline)
  // The lane's visual scale: long enough for the video sequence and for
  // every track's end — a track past the sequence end (silent tail) still
  // renders fully instead of overflowing.
  const laneSpan = Math.max(
    totalDuration(timeline),
    ...audioTracks.map((track) => track.offset + effectiveDuration(track)),
  )
  const lanePercent = (seconds: number) =>
    laneSpan > 0 ? `${(seconds / laneSpan) * 100}%` : '0%'

  return (
    <section className="panel panel-wide" aria-label="Timeline">
      <div className="timeline-header">
        <h2>Timeline</h2>
        {/* A slate needs no imported media (#143), so it is added right
            here rather than from the library. */}
        <button type="button" aria-label="Add color slate to timeline" onClick={onAddSlate}>
          + Color slate
        </button>
        <span className="timeline-total">
          Total: <span data-testid="timeline-total">{formatDuration(totalDuration(timeline))}</span>
        </span>
      </div>

      {entries.length === 0 ? (
        <p className="placeholder">
          The sequence is empty. Add clips from the media library to start building your edit.
        </p>
      ) : (
        <ol className="timeline-list" aria-label="Sequence">
          {entries.map((entry, index) => {
            const position = `${entry.name} at position ${index + 1}`
            return (
              <li key={entry.id} className="timeline-entry">
                <div className="timeline-entry-main">
                  <span className="clip-name" title={entry.name}>
                    {entry.name}
                  </span>
                  <span className="clip-duration">{formatDuration(effectiveDuration(entry))}</span>
                  <span className="timeline-entry-actions">
                    <button
                      type="button"
                      aria-label={`Move ${position} up`}
                      disabled={index === 0}
                      onClick={() => onMoveEntry(entry.id, 'up')}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${position} down`}
                      disabled={index === entries.length - 1}
                      onClick={() => onMoveEntry(entry.id, 'down')}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${position} from timeline`}
                      onClick={() => onRemoveEntry(entry.id)}
                    >
                      ✕
                    </button>
                  </span>
                </div>
                {isStillEntry(entry) ? (
                  /* A still has no source material (#140): no trim window to
                     edit, just the one duration, and no audio to control. A
                     slate (#143) adds its color, pickable in full 24-bit. */
                  <div className="timeline-entry-trim">
                    {isSlateEntry(entry) && (
                      <>
                        <span>Color</span>
                        <input
                          type="color"
                          aria-label={`Color of ${position}`}
                          value={entry.color}
                          onChange={(event) => onSetSlateColor(entry.id, event.target.value)}
                        />
                      </>
                    )}
                    <span>Shows for</span>
                    <SecondsField
                      label={`Duration of ${position} in seconds`}
                      value={effectiveDuration(entry)}
                      min={0.1}
                      max={86400}
                      onCommit={(duration) => onSetStillDuration(entry.id, duration)}
                    />
                    <span>s</span>
                  </div>
                ) : (
                  <>
                    <div className="timeline-entry-trim">
                      <span>In</span>
                      <SecondsField
                        label={`Trim in point of ${position} in seconds`}
                        value={entry.inPoint}
                        max={entry.duration}
                        onCommit={(inPoint) => onTrimEntry(entry.id, inPoint, entry.outPoint)}
                      />
                      <span>Out</span>
                      <SecondsField
                        label={`Trim out point of ${position} in seconds`}
                        value={entry.outPoint}
                        max={entry.duration}
                        onCommit={(outPoint) => onTrimEntry(entry.id, entry.inPoint, outPoint)}
                      />
                      <span className="timeline-entry-effective">
                        plays {formatSeconds(effectiveDuration(entry))}s of{' '}
                        {formatSeconds(entry.duration)}s
                        {/* Time-remap effects (#141) change what the entry
                            occupies in the sequence — say so where the trim
                            math is shown. */}
                        {entryOutputDuration(entry, remapsOf(timeline)) !==
                          effectiveDuration(entry) &&
                          ` — ${formatSeconds(entryOutputDuration(entry, remapsOf(timeline)))}s remapped`}
                      </span>
                    </div>
                    <div className="timeline-entry-audio">
                      <span>Volume</span>
                      <SecondsField
                        label={`Volume of ${position} (0 to 1)`}
                        value={entry.volume ?? 1}
                        max={1}
                        step={0.05}
                        onCommit={(volume) => onSetEntryVolume(entry.id, volume)}
                      />
                      <label className="timeline-mute">
                        <input
                          type="checkbox"
                          aria-label={`Mute ${position}`}
                          checked={entry.muted ?? false}
                          onChange={(event) => onSetEntryMuted(entry.id, event.target.checked)}
                        />
                        Mute
                      </label>
                    </div>
                  </>
                )}
                {(() => {
                  // An entry carries any number of non-overlapping zooms
                  // (#129), each independently editable; the accessible
                  // names number them per entry, in window (start) order —
                  // the order the normalized state stores them in.
                  const entryZooms = zoomsForEntry(timeline, entry.id)
                  const addable = defaultZoomFor(entryZooms, effectiveDuration(entry))
                  return (
                    <>
                      {entryZooms.map((entryZoom, zoomIndex) => {
                        const zoomName = `Zoom ${zoomIndex + 1}`
                        const set = (change: Partial<ZoomSpec>) =>
                          onUpdateZoom(entryZoom.id, { ...zoomSpecOf(entryZoom), ...change })
                        return (
                          <div key={entryZoom.id} className="timeline-entry-zoom">
                            <span>{zoomName} at</span>
                            <SecondsField
                              label={`${zoomName} start of ${position} in seconds`}
                              value={entryZoom.start}
                              max={effectiveDuration(entry)}
                              onCommit={(start) => set({ start })}
                            />
                            <span>in</span>
                            <SecondsField
                              label={`${zoomName} ramp-in of ${position} in seconds`}
                              value={entryZoom.rampIn}
                              max={effectiveDuration(entry)}
                              onCommit={(rampIn) => set({ rampIn })}
                            />
                            <span>hold</span>
                            <SecondsField
                              label={`${zoomName} hold of ${position} in seconds`}
                              value={entryZoom.hold}
                              max={effectiveDuration(entry)}
                              onCommit={(hold) => set({ hold })}
                            />
                            <span>out</span>
                            <SecondsField
                              label={`${zoomName} ramp-out of ${position} in seconds`}
                              value={entryZoom.rampOut}
                              max={effectiveDuration(entry)}
                              onCommit={(rampOut) => set({ rampOut })}
                            />
                            <span>×</span>
                            <SecondsField
                              label={`${zoomName} scale of ${position}`}
                              value={entryZoom.scale}
                              min={1}
                              max={10}
                              step={0.25}
                              onCommit={(scale) => set({ scale })}
                            />
                            <span>centre</span>
                            <SecondsField
                              label={`${zoomName} centre X of ${position} (0 to 1)`}
                              value={entryZoom.centerX}
                              max={1}
                              step={0.05}
                              onCommit={(centerX) => set({ centerX })}
                            />
                            <SecondsField
                              label={`${zoomName} centre Y of ${position} (0 to 1)`}
                              value={entryZoom.centerY}
                              max={1}
                              step={0.05}
                              onCommit={(centerY) => set({ centerY })}
                            />
                            <button
                              type="button"
                              aria-label={`Remove zoom ${zoomIndex + 1} from ${position}`}
                              onClick={() => onRemoveZoom(entryZoom.id)}
                            >
                              ✕
                            </button>
                          </div>
                        )
                      })}
                      <div className="timeline-entry-zoom">
                        <button
                          type="button"
                          className="timeline-zoom-add"
                          aria-label={`Add zoom to ${position}`}
                          disabled={addable === null}
                          onClick={() => addable !== null && onAddZoom(entry.id, addable)}
                        >
                          + Zoom
                        </button>
                      </div>
                    </>
                  )
                })()}
                {!isStillEntry(entry) &&
                  (() => {
                    // Time-remap effects (#141): speed segments and pauses,
                    // each independently editable like a zoom. Stills carry
                    // none — their one duration already sets their timing
                    // (#138). Accessible names number each kind separately,
                    // in window order — the order the normalized state
                    // stores them in.
                    const entryRemaps = remapsForEntry(timeline, entry.id)
                    const trimmed = effectiveDuration(entry)
                    const addableSpeed = defaultSpeedFor(entryRemaps, trimmed)
                    const addablePause = defaultPauseFor(entryRemaps, trimmed)
                    const kindIndex = (id: string, kind: RemapSpec['kind']) =>
                      entryRemaps.filter((effect) => effect.kind === kind).findIndex((effect) => effect.id === id) + 1
                    return (
                      <>
                        {entryRemaps.map((effect) =>
                          effect.kind === 'speed' ? (
                            (() => {
                              const name = `Speed segment ${kindIndex(effect.id, 'speed')}`
                              const set = (change: Partial<Omit<typeof effect, 'kind'>>) =>
                                onUpdateRemap(effect.id, {
                                  kind: 'speed',
                                  start: effect.start,
                                  end: effect.end,
                                  factor: effect.factor,
                                  ...change,
                                })
                              return (
                                <div key={effect.id} className="timeline-entry-remap">
                                  <span>{name} from</span>
                                  <SecondsField
                                    label={`${name} start of ${position} in seconds`}
                                    value={effect.start}
                                    max={trimmed}
                                    onCommit={(start) => set({ start })}
                                  />
                                  <span>to</span>
                                  <SecondsField
                                    label={`${name} end of ${position} in seconds`}
                                    value={effect.end}
                                    max={trimmed}
                                    onCommit={(end) => set({ end })}
                                  />
                                  <span>at</span>
                                  <SecondsField
                                    label={`${name} factor of ${position}`}
                                    value={effect.factor}
                                    min={0.05}
                                    max={10}
                                    step={0.25}
                                    onCommit={(factor) => set({ factor })}
                                  />
                                  <span>×</span>
                                  <button
                                    type="button"
                                    aria-label={`Remove speed segment ${kindIndex(effect.id, 'speed')} from ${position}`}
                                    onClick={() => onRemoveRemap(effect.id)}
                                  >
                                    ✕
                                  </button>
                                </div>
                              )
                            })()
                          ) : (
                            (() => {
                              const name = `Pause ${kindIndex(effect.id, 'pause')}`
                              return (
                                <div key={effect.id} className="timeline-entry-remap">
                                  <span>{name} at</span>
                                  <SecondsField
                                    label={`${name} position of ${position} in seconds`}
                                    value={effect.at}
                                    max={trimmed}
                                    onCommit={(at) =>
                                      onUpdateRemap(effect.id, { kind: 'pause', at, hold: effect.hold })
                                    }
                                  />
                                  <span>hold</span>
                                  <SecondsField
                                    label={`${name} hold of ${position} in seconds`}
                                    value={effect.hold}
                                    min={0.1}
                                    max={86400}
                                    onCommit={(hold) =>
                                      onUpdateRemap(effect.id, { kind: 'pause', at: effect.at, hold })
                                    }
                                  />
                                  <span>s</span>
                                  <button
                                    type="button"
                                    aria-label={`Remove pause ${kindIndex(effect.id, 'pause')} from ${position}`}
                                    onClick={() => onRemoveRemap(effect.id)}
                                  >
                                    ✕
                                  </button>
                                </div>
                              )
                            })()
                          ),
                        )}
                        <div className="timeline-entry-remap">
                          <button
                            type="button"
                            className="timeline-remap-add"
                            aria-label={`Add speed segment to ${position}`}
                            disabled={addableSpeed === null}
                            onClick={() => addableSpeed !== null && onAddRemap(entry.id, addableSpeed)}
                          >
                            + Speed
                          </button>
                          <button
                            type="button"
                            className="timeline-remap-add"
                            aria-label={`Add pause to ${position}`}
                            disabled={addablePause === null}
                            onClick={() => addablePause !== null && onAddRemap(entry.id, addablePause)}
                          >
                            + Pause
                          </button>
                        </div>
                      </>
                    )
                  })()}
                {index < entries.length - 1 &&
                  (() => {
                    const next = entries[index + 1]
                    const boundary = `between position ${index + 1} and ${index + 2}`
                    const transition = transitions[index]
                    return transition === undefined ? (
                      <div className="timeline-transition">
                        <button
                          type="button"
                          className="timeline-transition-add"
                          aria-label={`Add transition ${boundary}`}
                          onClick={() =>
                            onSetTransition(entry.id, next.id, {
                              type: 'crossfade',
                              duration: DEFAULT_TRANSITION_DURATION,
                            })
                          }
                        >
                          + Transition
                        </button>
                      </div>
                    ) : (
                      <div className="timeline-transition">
                        <select
                          aria-label={`Transition type ${boundary}`}
                          value={transition.type}
                          onChange={(event) =>
                            onSetTransition(entry.id, next.id, {
                              type: event.target.value as TransitionType,
                              duration: transition.duration,
                            })
                          }
                        >
                          {Object.entries(TRANSITION_TYPE_NAMES).map(([value, name]) => (
                            <option key={value} value={value}>
                              {name}
                            </option>
                          ))}
                        </select>
                        <SecondsField
                          label={`Transition duration ${boundary} in seconds`}
                          value={transition.duration}
                          max={Math.min(effectiveDuration(entry), effectiveDuration(next))}
                          onCommit={(duration) =>
                            onSetTransition(entry.id, next.id, {
                              type: transition.type,
                              duration,
                            })
                          }
                        />
                        <span>s</span>
                        <button
                          type="button"
                          aria-label={`Remove transition ${boundary}`}
                          onClick={() => onRemoveTransition(entry.id, next.id)}
                        >
                          ✕
                        </button>
                      </div>
                    )
                  })()}
              </li>
            )
          })}
        </ol>
      )}

      {audioTracks.length > 0 && (
        <div className="audio-lane">
          <h3 className="audio-lane-heading">Audio</h3>
          <ol className="audio-track-list" aria-label="Audio tracks">
            {audioTracks.map((track, index) => {
              const position = `audio track ${track.name} at position ${index + 1}`
              const trimmedLength = effectiveDuration(track)
              return (
                <li key={track.id} className="audio-track">
                  {/* Position/size at a glance; the numeric fields below are
                      the precise, accessible controls. */}
                  <div className="audio-track-strip" aria-hidden="true">
                    <div
                      className="audio-track-bar"
                      data-testid={`audio-track-bar-${index}`}
                      style={{
                        left: lanePercent(track.offset),
                        width: lanePercent(trimmedLength),
                      }}
                    />
                  </div>
                  <div className="audio-track-main">
                    <span className="clip-name" title={track.name}>
                      {track.name}
                    </span>
                    <span className="clip-duration">{formatDuration(trimmedLength)}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${position} from timeline`}
                      onClick={() => onRemoveAudioTrack(track.id)}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="audio-track-controls">
                    <span>Starts at</span>
                    <SecondsField
                      label={`Start time of ${position} in seconds`}
                      value={track.offset}
                      max={laneSpan}
                      onCommit={(offset) => onRetimeAudioTrack(track.id, offset)}
                    />
                    <span>In</span>
                    <SecondsField
                      label={`Trim in point of ${position} in seconds`}
                      value={track.inPoint}
                      max={track.duration}
                      onCommit={(inPoint) => onTrimAudioTrack(track.id, inPoint, track.outPoint)}
                    />
                    <span>Out</span>
                    <SecondsField
                      label={`Trim out point of ${position} in seconds`}
                      value={track.outPoint}
                      max={track.duration}
                      onCommit={(outPoint) => onTrimAudioTrack(track.id, track.inPoint, outPoint)}
                    />
                    <span className="timeline-entry-effective">
                      plays {formatSeconds(trimmedLength)}s of {formatSeconds(track.duration)}s
                    </span>
                  </div>
                  <div className="audio-track-gain">
                    <span>Volume</span>
                    <SecondsField
                      label={`Volume of ${position} (0 to 1)`}
                      value={track.volume ?? 1}
                      max={1}
                      step={0.05}
                      onCommit={(volume) => onSetAudioTrackVolume(track.id, volume)}
                    />
                    <span>Fade in</span>
                    <SecondsField
                      label={`Fade-in of ${position} in seconds`}
                      value={track.fadeIn ?? 0}
                      max={trimmedLength}
                      onCommit={(fadeIn) =>
                        onSetAudioTrackFades(track.id, fadeIn, track.fadeOut ?? 0)
                      }
                    />
                    <span>out</span>
                    <SecondsField
                      label={`Fade-out of ${position} in seconds`}
                      value={track.fadeOut ?? 0}
                      max={trimmedLength}
                      onCommit={(fadeOut) =>
                        onSetAudioTrackFades(track.id, track.fadeIn ?? 0, fadeOut)
                      }
                    />
                  </div>
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </section>
  )
}
