import { useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { TimelineState } from '../lib/timeline'
import { effectiveDuration, totalDuration } from '../lib/timeline'
import { formatDuration } from '../lib/mediaLibrary'
import './Timeline.css'

interface TimelineProps {
  timeline: TimelineState
  onMoveEntry: (id: string, direction: 'up' | 'down') => void
  onRemoveEntry: (id: string) => void
  onTrimEntry: (id: string, inPoint: number, outPoint: number) => void
}

/** Seconds as a plain number string with at most two decimals, e.g. 1.25 → "1.25", 3 → "3". */
const formatSeconds = (seconds: number) => String(Math.round(seconds * 100) / 100)

interface TrimFieldProps {
  label: string
  value: number
  max: number
  onCommit: (value: number) => void
}

/**
 * Numeric trim input that commits on blur/Enter. The draft is local so the
 * user can type freely; the committed value is validated by the reducer, and
 * the field snaps back to the last valid state if the commit is rejected.
 */
function TrimField({ label, value, max, onCommit }: TrimFieldProps) {
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
      step={0.1}
      min={0}
      max={max}
      aria-label={label}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={handleKeyDown}
    />
  )
}

export function Timeline({ timeline, onMoveEntry, onRemoveEntry, onTrimEntry }: TimelineProps) {
  const { entries } = timeline

  return (
    <section className="panel panel-wide" aria-label="Timeline">
      <div className="timeline-header">
        <h2>Timeline</h2>
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
                <div className="timeline-entry-trim">
                  <span>In</span>
                  <TrimField
                    label={`Trim in point of ${position} in seconds`}
                    value={entry.inPoint}
                    max={entry.duration}
                    onCommit={(inPoint) => onTrimEntry(entry.id, inPoint, entry.outPoint)}
                  />
                  <span>Out</span>
                  <TrimField
                    label={`Trim out point of ${position} in seconds`}
                    value={entry.outPoint}
                    max={entry.duration}
                    onCommit={(outPoint) => onTrimEntry(entry.id, entry.inPoint, outPoint)}
                  />
                  <span className="timeline-entry-effective">
                    plays {formatSeconds(effectiveDuration(entry))}s of{' '}
                    {formatSeconds(entry.duration)}s
                  </span>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
