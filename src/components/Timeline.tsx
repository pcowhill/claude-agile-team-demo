import type { TimelineState } from '../lib/timeline'
import { totalDuration } from '../lib/timeline'
import { formatDuration } from '../lib/mediaLibrary'
import './Timeline.css'

interface TimelineProps {
  timeline: TimelineState
  onMoveEntry: (id: string, direction: 'up' | 'down') => void
  onRemoveEntry: (id: string) => void
}

export function Timeline({ timeline, onMoveEntry, onRemoveEntry }: TimelineProps) {
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
          {entries.map((entry, index) => (
            <li key={entry.id} className="timeline-entry">
              <span className="clip-name" title={entry.name}>
                {entry.name}
              </span>
              <span className="clip-duration">{formatDuration(entry.duration)}</span>
              <span className="timeline-entry-actions">
                <button
                  type="button"
                  aria-label={`Move ${entry.name} at position ${index + 1} up`}
                  disabled={index === 0}
                  onClick={() => onMoveEntry(entry.id, 'up')}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move ${entry.name} at position ${index + 1} down`}
                  disabled={index === entries.length - 1}
                  onClick={() => onMoveEntry(entry.id, 'down')}
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${entry.name} at position ${index + 1} from timeline`}
                  onClick={() => onRemoveEntry(entry.id)}
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
