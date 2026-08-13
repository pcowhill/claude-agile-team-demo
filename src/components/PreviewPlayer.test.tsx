import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
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

  // Two 4s entries with a 1s crossfade: total 7, overlap at sequence [3, 4).
  const withTransition: TimelineState = {
    entries: [
      {
        id: 'e1',
        clipId: 'c1',
        name: 'first.webm',
        duration: 4,
        url: 'blob:first',
        inPoint: 0,
        outPoint: 4,
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
    transitions: [{ beforeId: 'e1', afterId: 'e2', type: 'crossfade', duration: 1 }],
  }

  it('shrinks the scrubber range by the transition overlap', () => {
    render(<PreviewPlayer timeline={withTransition} />)
    expect(screen.getByRole('slider', { name: 'Seek within sequence' })).toHaveAttribute(
      'max',
      '7',
    )
    expect(screen.getByTestId('preview-position')).toHaveTextContent('0:00 / 0:07')
  })

  it('seeking into an overlap shows the incoming element mid-effect; seeking out hides it', () => {
    render(<PreviewPlayer timeline={withTransition} />)
    const slider = screen.getByRole('slider', { name: 'Seek within sequence' })

    // Outside the overlap: only the primary element is exposed.
    expect(screen.queryByTestId('preview-video-incoming')).not.toBeInTheDocument()

    // Sequence 3.5 is halfway through the 1s crossfade.
    fireEvent.change(slider, { target: { value: '3.5' } })
    const incoming = screen.getByTestId('preview-video-incoming')
    expect(incoming).toHaveStyle({ opacity: '0.5' })
    expect(screen.getByTestId('preview-now-playing')).toHaveTextContent(
      'Clip 1 of 2: first.webm → second.webm (crossfade)',
    )

    // Seeking back out returns to single-clip rendering.
    fireEvent.change(slider, { target: { value: '1' } })
    expect(screen.queryByTestId('preview-video-incoming')).not.toBeInTheDocument()
    expect(screen.getByTestId('preview-now-playing')).toHaveTextContent(
      'Clip 1 of 2: first.webm',
    )
    expect(screen.getByTestId('preview-now-playing')).not.toHaveTextContent('→')
  })

  it('renders slide-from-above as a translate of the incoming element', () => {
    const slide: TimelineState = {
      ...withTransition,
      transitions: [{ beforeId: 'e1', afterId: 'e2', type: 'slide-from-above', duration: 1 }],
    }
    render(<PreviewPlayer timeline={slide} />)
    fireEvent.change(screen.getByRole('slider', { name: 'Seek within sequence' }), {
      target: { value: '3.25' },
    })
    const incoming = screen.getByTestId('preview-video-incoming')
    expect(incoming).toHaveStyle({ transform: 'translateY(-75%)' })
    expect(screen.getByTestId('preview-now-playing')).toHaveTextContent('(slide from above)')
  })
})
