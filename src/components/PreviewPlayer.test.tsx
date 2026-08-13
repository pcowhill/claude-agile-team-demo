import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PreviewPlayer } from './PreviewPlayer'
import type { TimelineState } from '../lib/timeline'

// Media playback does not run in jsdom; these tests cover the rendered
// structure. Play/pause/seek behavior is covered by e2e/preview.spec.ts,
// and the position mapping by lib/playback.test.ts.
describe('PreviewPlayer', () => {
  it('shows a placeholder while the timeline is empty', () => {
    render(<PreviewPlayer timeline={{ entries: [] }} />)
    expect(screen.getByRole('region', { name: 'Preview' })).toBeInTheDocument()
    expect(screen.getByText(/add clips to the timeline/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Play preview' })).not.toBeInTheDocument()
  })

  it('renders player controls and sequence position once entries exist', () => {
    const timeline: TimelineState = {
      entries: [
        {
          id: 'e1',
          clipId: 'c1',
          name: 'first.webm',
          duration: 10,
          url: 'blob:first',
          inPoint: 2,
          outPoint: 7,
        },
        {
          id: 'e2',
          clipId: 'c2',
          name: 'second.webm',
          duration: 4,
          url: 'blob:second',
          inPoint: 0,
          outPoint: 4,
        },
      ],
    }
    render(<PreviewPlayer timeline={timeline} />)

    expect(screen.getByRole('button', { name: 'Play preview' })).toBeInTheDocument()
    const seek = screen.getByRole('slider', { name: 'Seek within sequence' })
    // Trimmed total: (7−2) + (4−0) = 9 seconds.
    expect(seek).toHaveAttribute('max', '9')
    expect(screen.getByTestId('preview-position')).toHaveTextContent('0:00 / 0:09')
    expect(screen.getByTestId('preview-now-playing')).toHaveTextContent(
      'Clip 1 of 2: first.webm',
    )
  })
})
