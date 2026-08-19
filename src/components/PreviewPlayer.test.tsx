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
    // The incoming layer ADDS to the outgoing one (a true dissolve), and the
    // outgoing element fades to the stage's black at 1 − progress — so
    // margins the incoming clip does not cover dim instead of popping (#66).
    expect(incoming).toHaveStyle({ mixBlendMode: 'plus-lighter' })
    // No backing on a crossfade's incoming element: the additive blend needs
    // its fitted box's surroundings to stay empty (#74).
    expect(incoming).not.toHaveStyle({ backgroundColor: '#000' })
    expect(screen.getByTestId('preview-video')).toHaveStyle({ opacity: '0.5' })
    expect(screen.getByTestId('preview-now-playing')).toHaveTextContent(
      'Clip 1 of 2: first.webm → second.webm (crossfade)',
    )

    // Seeking back out returns to single-clip rendering at full opacity.
    fireEvent.change(slider, { target: { value: '1' } })
    expect(screen.queryByTestId('preview-video-incoming')).not.toBeInTheDocument()
    expect(screen.getByTestId('preview-video')).not.toHaveStyle({ opacity: '0.5' })
    expect(screen.getByTestId('preview-now-playing')).toHaveTextContent(
      'Clip 1 of 2: first.webm',
    )
    expect(screen.getByTestId('preview-now-playing')).not.toHaveTextContent('→')
  })

  // Seek 3.25 is a quarter into the 1s overlap, so the incoming element is
  // still 75% of the frame away from exact cover, on each direction's own
  // axis (#62).
  const slideCases = [
    ['slide-from-above', 'translate(0%, -75%)', '(slide from above)'],
    ['slide-from-below', 'translate(0%, 75%)', '(slide from below)'],
    ['slide-from-left', 'translate(-75%, 0%)', '(slide from left)'],
    ['slide-from-right', 'translate(75%, 0%)', '(slide from right)'],
  ] as const

  for (const [type, transform, label] of slideCases) {
    it(`renders ${type} as a translate of the incoming element`, () => {
      const slide: TimelineState = {
        ...withTransition,
        transitions: [{ beforeId: 'e1', afterId: 'e2', type, duration: 1 }],
      }
      render(<PreviewPlayer timeline={slide} />)
      fireEvent.change(screen.getByRole('slider', { name: 'Seek within sequence' }), {
        target: { value: '3.25' },
      })
      const incoming = screen.getByTestId('preview-video-incoming')
      expect(incoming).toHaveStyle({ transform })
      // Slides keep both layers opaque and non-blended; the incoming element
      // is a full-frame card with its own black backing, so the areas its
      // fitted clip does not cover slide in as black (#74, the customer's
      // decision on #67).
      expect(incoming).toHaveStyle({ opacity: '1' })
      expect(incoming).toHaveStyle({ backgroundColor: '#000' })
      expect(screen.getByTestId('preview-video')).toHaveStyle({ opacity: '1' })
      expect(screen.getByTestId('preview-now-playing')).toHaveTextContent(label)
    })
  }

  // Zoom rendering (#64). All magnification numbers come from zoomAt (#63):
  // the component maps { scale, centerX, centerY } to CSS and adds no easing
  // of its own, so these pin the mapping, not the maths.
  describe('zoom', () => {
    // e1 (4s) carries a 2× zoom into the left-centre region: window
    // start 1s, 1s ramps around a 1s hold, centre (0.25, 0.5).
    const withZoomOnFirst: TimelineState = {
      entries: withTransition.entries,
      zooms: [
        {
          entryId: 'e1',
          start: 1,
          rampIn: 1,
          hold: 1,
          rampOut: 1,
          scale: 2,
          centerX: 0.25,
          centerY: 0.5,
        },
      ],
    }

    const seekTo = (value: string) =>
      fireEvent.change(screen.getByRole('slider', { name: 'Seek within sequence' }), {
        target: { value },
      })

    it('renders no zoom styling outside the window and full zoom during the hold', () => {
      render(<PreviewPlayer timeline={withZoomOnFirst} />)
      const video = screen.getByTestId('preview-video')

      seekTo('0.5')
      expect(video.style.transform).toBe('')
      expect(video.style.clipPath).toBe('')

      // Mid-hold (g = 1): scale 2 about the element centre, translated so
      // the configured centre (0.25, 0.5) sits mid-frame, clipped to the
      // visible region [0, 0.5] × [0.25, 0.75].
      seekTo('2.5')
      expect(video.style.transform).toBe('scale(2) translate(25%, 0%)')
      expect(video.style.clipPath).toBe('inset(25% 50% 25% 0%)')
    })

    it('renders the eased intermediate magnification inside the ramps', () => {
      render(<PreviewPlayer timeline={withZoomOnFirst} />)
      const video = screen.getByTestId('preview-video')

      // Ramp-in midpoint: g = smoothstep(0.5) = 0.5, so scale 1.5 and the
      // centre halfway from 0.5 to 0.25 — exactly zoomAt's output.
      seekTo('1.5')
      expect(video.style.transform).toBe('scale(1.5) translate(12.5%, 0%)')

      // Ramp-out midpoint mirrors it.
      seekTo('3.5')
      expect(video.style.transform).toBe('scale(1.5) translate(12.5%, 0%)')
    })

    it('composes a zoom with a slide transition on either side of the overlap', () => {
      // Crossfade → slide-from-left between e1 and e2; e1 zooms at its tail
      // (full zoom from 2.5s on), e2 zooms from its head (zero ramp-in
      // starts at full zoom, per zoomAt).
      const timeline: TimelineState = {
        entries: withTransition.entries,
        transitions: [{ beforeId: 'e1', afterId: 'e2', type: 'slide-from-left', duration: 1 }],
        zooms: [
          {
            entryId: 'e1',
            start: 2.5,
            rampIn: 0.5,
            hold: 1,
            rampOut: 0,
            scale: 2,
            centerX: 0.75,
            centerY: 0.5,
          },
          {
            entryId: 'e2',
            start: 0,
            rampIn: 0,
            hold: 2,
            rampOut: 1,
            scale: 2,
            centerX: 0.5,
            centerY: 0.25,
          },
        ],
      }
      render(<PreviewPlayer timeline={timeline} />)
      // Sequence 3.25: a quarter into the overlap — outgoing source time
      // 3.25 (in e1's hold), incoming source time 0.25 (in e2's hold).
      seekTo('3.25')

      // Outgoing: zoom only (transitions never transform the primary).
      const outgoing = screen.getByTestId('preview-video')
      expect(outgoing.style.transform).toBe('scale(2) translate(-25%, 0%)')
      expect(outgoing).toHaveStyle({ opacity: '1' })

      // Incoming: the slide's card translate composes with the zoom, in
      // card-then-zoom order, and the #74 backing plus clip keep the card
      // covering exactly its slice of the stage.
      const incoming = screen.getByTestId('preview-video-incoming')
      expect(incoming.style.transform).toBe('translate(-75%, 0%) scale(2) translate(0%, 25%)')
      expect(incoming.style.clipPath).toBe('inset(0% 25% 50% 25%)')
      expect(incoming).toHaveStyle({ backgroundColor: '#000' })
      expect(incoming).toHaveStyle({ opacity: '1' })
    })
  })
})
