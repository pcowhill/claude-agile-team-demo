import type { LibraryClip } from '../lib/mediaLibrary'
import { formatDuration } from '../lib/mediaLibrary'
import type { TimelineState } from '../lib/timeline'
import { timelineDuration } from '../lib/timeline'
import './Timeline.css'

interface TimelineProps {
  timeline: TimelineState
  clips: LibraryClip[]
  onMoveEntry: (entryId: string, direction: 'up' | 'down') => void
  onRemoveEntry: (entryId: string) => void
}

export function Timeline({ timeline, clips, onMoveEntry, onRemoveEntry }: TimelineProps) {
  const clipsById = new Map(clips.map((clip) => [clip.id, clip]))
  const total = timelineDuration(timeline, clips)

  return (
    <section className="panel panel-wide" aria-label="Timeline">
      <div className="timeline-header">
        <h2>Timeline</h2>
        <span className="timeline-total">
          Total: <span data-testid="timeline-total-duration">{formatDuration(total)}</span>
        </span>
      </div>

      {timeline.entries.length === 0 ? (
        <p className="placeholder">
          The sequence is empty. Add clips from the media library to build your edit.
        </p>
      ) : (
        <ol className="timeline-list" aria-label="Timeline entries">
          {timeline.entries.map((entry, index) => {
            const clip = clipsById.get(entry.clipId)
            const position = index + 1
            return (
              <li key={entry.id} className="timeline-entry">
                <span className="entry-position" aria-hidden="true">
                  {position}
                </span>
                <span className="entry-name" title={clip?.name}>
                  {clip?.name ?? 'Missing clip'}
                </span>
                <span className="entry-duration">{formatDuration(clip?.duration ?? Number.NaN)}</span>
                <span className="entry-actions">
                  <button
                    type="button"
                    aria-label={`Move entry ${position} up`}
                    disabled={index === 0}
                    onClick={() => onMoveEntry(entry.id, 'up')}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move entry ${position} down`}
                    disabled={index === timeline.entries.length - 1}
                    onClick={() => onMoveEntry(entry.id, 'down')}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove entry ${position}`}
                    onClick={() => onRemoveEntry(entry.id)}
                  >
                    ✕
                  </button>
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
