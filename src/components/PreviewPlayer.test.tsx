import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
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

  describe('expand toggle (#128)', () => {
    const oneEntry: TimelineState = {
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
      ],
    }

    it('renders the toggle and reports each click, in the empty panel too', () => {
      const onToggleExpanded = vi.fn()
      const { rerender } = render(
        <PreviewPlayer timeline={{ entries: [] }} onToggleExpanded={onToggleExpanded} />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Expand preview' }))
      expect(onToggleExpanded).toHaveBeenCalledTimes(1)

      // The label names the action now available, matching the play/pause idiom.
      rerender(
        <PreviewPlayer timeline={{ entries: [] }} expanded onToggleExpanded={onToggleExpanded} />,
      )
      expect(screen.getByRole('button', { name: 'Restore preview size' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Expand preview' })).not.toBeInTheDocument()
    })

    it('marks the stage expanded only while expanded', () => {
      const { container, rerender } = render(
        <PreviewPlayer timeline={oneEntry} expanded onToggleExpanded={() => {}} />,
      )
      expect(container.querySelector('.preview-stage')).toHaveClass('preview-stage-expanded')

      rerender(<PreviewPlayer timeline={oneEntry} onToggleExpanded={() => {}} />)
      expect(container.querySelector('.preview-stage')).not.toHaveClass('preview-stage-expanded')
    })

    it('renders no toggle when no handler is wired', () => {
      render(<PreviewPlayer timeline={oneEntry} />)
      expect(screen.queryByRole('button', { name: 'Expand preview' })).not.toBeInTheDocument()
    })
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
          id: 'z1',
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
            id: 'z1',
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
            id: 'z2',
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

  // Audio tracks in the preview (#103). jsdom loads no media, so play/pause
  // and the paused flag are mocked to behave like a browser's, and the rAF
  // loop is driven by hand — what these tests pin is the component's cueing
  // logic against the published position. Real playback runs in
  // e2e/preview-audio.spec.ts; the position → source-time mapping itself is
  // covered by lib/playback.test.ts.
  describe('audio tracks (#103)', () => {
    // A 10s video entry, a track playing source [1, 3) over sequence [0, 2),
    // and a track playing source [0, 2) over sequence [5, 7).
    const withAudioTracks: TimelineState = {
      entries: [
        {
          id: 'e1',
          clipId: 'c1',
          name: 'first.webm',
          duration: 10,
          url: 'blob:first',
          inPoint: 0,
          outPoint: 10,
        },
      ],
      audioTracks: [
        {
          id: 't1',
          clipId: 'a1',
          name: 'music.mp3',
          duration: 30,
          url: 'blob:music',
          offset: 0,
          inPoint: 1,
          outPoint: 3,
        },
        {
          id: 't2',
          clipId: 'a2',
          name: 'fx.wav',
          duration: 6,
          url: 'blob:fx',
          offset: 5,
          inPoint: 0,
          outPoint: 2,
        },
      ],
    }

    const pausedState = new WeakMap<HTMLMediaElement, boolean>()
    let playSpy: ReturnType<typeof vi.spyOn>
    let pauseSpy: ReturnType<typeof vi.spyOn>
    let frames: FrameRequestCallback[]

    beforeEach(() => {
      playSpy = vi
        .spyOn(HTMLMediaElement.prototype, 'play')
        .mockImplementation(function (this: HTMLMediaElement) {
          pausedState.set(this, false)
          return Promise.resolve()
        })
      pauseSpy = vi
        .spyOn(HTMLMediaElement.prototype, 'pause')
        .mockImplementation(function (this: HTMLMediaElement) {
          pausedState.set(this, true)
        })
      vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(function (
        this: HTMLMediaElement,
      ) {
        return pausedState.get(this) ?? true
      })
      frames = []
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        frames.push(callback)
        return frames.length
      })
      vi.stubGlobal('cancelAnimationFrame', () => {})
    })

    afterEach(() => {
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    })

    const audio = (index: number) => screen.getByTestId(`preview-audio-${index}`) as HTMLAudioElement
    const video = () => screen.getByTestId('preview-video') as HTMLVideoElement
    /** Runs the most recently scheduled rAF tick. */
    const runTick = () => {
      const tick = frames[frames.length - 1]
      act(() => tick(0))
    }
    const playedElements = () => playSpy.mock.contexts as unknown as HTMLMediaElement[]

    it('renders one sound-only element per track, each keeping its own source', () => {
      render(<PreviewPlayer timeline={withAudioTracks} />)
      expect(audio(0)).toHaveAttribute('src', 'blob:music')
      expect(audio(1)).toHaveAttribute('src', 'blob:fx')
      expect(audio(0)).toHaveAttribute('preload', 'auto')
      expect(screen.queryByTestId('preview-audio-2')).not.toBeInTheDocument()
    })

    it('playing starts the covering track at its source time and leaves upcoming ones cued', () => {
      render(<PreviewPlayer timeline={withAudioTracks} />)
      fireEvent.click(screen.getByRole('button', { name: 'Play preview' }))

      // t1 covers position 0: cued to its in-point and playing.
      expect(audio(0).currentTime).toBe(1)
      expect(playedElements()).toContain(audio(0))
      // t2 starts at 5: cued at its in-point, not playing.
      expect(audio(1).paused).toBe(true)
      expect(playedElements()).not.toContain(audio(1))
    })

    it('a track starting mid-sequence begins playing when the position reaches it', () => {
      render(<PreviewPlayer timeline={withAudioTracks} />)
      fireEvent.click(screen.getByRole('button', { name: 'Play preview' }))
      expect(audio(1).paused).toBe(true)

      // The video's clock advances to sequence 6 — inside t2's [5, 7) window
      // and past t1's [0, 2) one.
      video().currentTime = 6
      runTick()

      expect(audio(1).paused).toBe(false)
      expect(audio(1).currentTime).toBe(1) // inPoint 0 + (6 − offset 5)
      expect(audio(0).paused).toBe(true)
      expect(audio(0).currentTime).toBe(3) // parked at its out-point
      expect(screen.getByTestId('preview-position')).toHaveTextContent('0:06 / 0:10')
    })

    it('pausing pauses every playing track and resuming re-aligns it', () => {
      render(<PreviewPlayer timeline={withAudioTracks} />)
      fireEvent.click(screen.getByRole('button', { name: 'Play preview' }))
      expect(audio(0).paused).toBe(false)

      fireEvent.click(screen.getByRole('button', { name: 'Pause preview' }))
      expect(audio(0).paused).toBe(true)
      expect(pauseSpy.mock.contexts as unknown as HTMLMediaElement[]).toContain(audio(0))

      fireEvent.click(screen.getByRole('button', { name: 'Play preview' }))
      expect(audio(0).paused).toBe(false)
      expect(audio(0).currentTime).toBe(1) // position still 0 → in-point 1
    })

    it('seeking while paused cues covering tracks without playing them', () => {
      render(<PreviewPlayer timeline={withAudioTracks} />)
      fireEvent.change(screen.getByRole('slider', { name: 'Seek within sequence' }), {
        target: { value: '6' },
      })

      expect(audio(1).currentTime).toBe(1)
      expect(audio(1).paused).toBe(true)
      expect(audio(0).currentTime).toBe(3)
      expect(playedElements()).toHaveLength(0)
    })

    it('seeking while playing switches which tracks play', () => {
      render(<PreviewPlayer timeline={withAudioTracks} />)
      fireEvent.click(screen.getByRole('button', { name: 'Play preview' }))
      expect(audio(0).paused).toBe(false)

      fireEvent.change(screen.getByRole('slider', { name: 'Seek within sequence' }), {
        target: { value: '6' },
      })
      expect(audio(0).paused).toBe(true)
      expect(audio(1).paused).toBe(false)
      expect(audio(1).currentTime).toBe(1)
    })

    // Gain in the preview (#104): element volumes are real in jsdom, so
    // these pin the composed values syncAudioTracks/syncSecondary/tick
    // assign. The gain maths itself is covered by lib/gain.test.ts.
    describe('gain (#104)', () => {
      it('two overlapping tracks hold independent volumes', () => {
        const withVolumes: TimelineState = {
          ...withAudioTracks,
          audioTracks: [
            { ...withAudioTracks.audioTracks![0], volume: 0.2 },
            { ...withAudioTracks.audioTracks![1], offset: 0, volume: 0.9 },
          ],
        }
        render(<PreviewPlayer timeline={withVolumes} />)
        fireEvent.click(screen.getByRole('button', { name: 'Play preview' }))

        expect(audio(0).paused).toBe(false)
        expect(audio(1).paused).toBe(false)
        expect(audio(0).volume).toBe(0.2)
        expect(audio(1).volume).toBe(0.9)
      })

      it('adjusting a track volume is reflected next time it plays', () => {
        const { rerender } = render(<PreviewPlayer timeline={withAudioTracks} />)
        fireEvent.click(screen.getByRole('button', { name: 'Play preview' }))
        expect(audio(0).volume).toBe(1)

        // The edit replaces the timeline (stopping playback, as any edit
        // does); resuming applies the new gain.
        rerender(
          <PreviewPlayer
            timeline={{
              ...withAudioTracks,
              audioTracks: [
                { ...withAudioTracks.audioTracks![0], volume: 0.5 },
                withAudioTracks.audioTracks![1],
              ],
            }}
          />,
        )
        expect(audio(0).paused).toBe(true)
        fireEvent.click(screen.getByRole('button', { name: 'Play preview' }))
        expect(audio(0).paused).toBe(false)
        expect(audio(0).volume).toBe(0.5)
      })

      it('renders a fade as a volume ramp across rAF ticks', () => {
        // One track over the whole 10s video: window [0, 10), fadeIn 2,
        // fadeOut 4 — so full volume in [2, 6], ramping at both ends.
        const fading: TimelineState = {
          entries: withAudioTracks.entries,
          audioTracks: [
            {
              id: 't1',
              clipId: 'a1',
              name: 'music.mp3',
              duration: 30,
              url: 'blob:music',
              offset: 0,
              inPoint: 0,
              outPoint: 10,
              fadeIn: 2,
              fadeOut: 4,
            },
          ],
        }
        render(<PreviewPlayer timeline={fading} />)
        fireEvent.click(screen.getByRole('button', { name: 'Play preview' }))
        expect(audio(0).volume).toBe(0) // fade-in starts from silence

        video().currentTime = 1
        runTick()
        expect(audio(0).volume).toBe(0.5)

        video().currentTime = 4
        runTick()
        expect(audio(0).volume).toBe(1)

        video().currentTime = 8
        runTick()
        expect(audio(0).volume).toBe(0.5) // 2s from the end of a 4s fade-out
      })

      it('applies a video entry volume when cued and muting silences it through a transition', () => {
        // Two 4s entries with a 1s crossfade; e1 muted, e2 at volume 0.6.
        const muted: TimelineState = {
          entries: [
            {
              id: 'e1',
              clipId: 'c1',
              name: 'first.webm',
              duration: 4,
              url: 'blob:first',
              inPoint: 0,
              outPoint: 4,
              muted: true,
            },
            {
              id: 'e2',
              clipId: 'c2',
              name: 'second.webm',
              duration: 4,
              url: 'blob:second',
              inPoint: 0,
              outPoint: 4,
              volume: 0.6,
            },
          ],
          transitions: [{ beforeId: 'e1', afterId: 'e2', type: 'crossfade', duration: 1 }],
        }
        render(<PreviewPlayer timeline={muted} />)
        fireEvent.click(screen.getByRole('button', { name: 'Play preview' }))
        expect(video().volume).toBe(0)

        // Halfway through the overlap (source 3.5 of [3, 4)): the muted
        // outgoing entry stays silent instead of ramping to 0.5; the
        // incoming one ramps within its own 0.6 volume.
        video().currentTime = 3.5
        runTick()
        expect(video().volume).toBe(0)
        const incoming = screen.getByTestId('preview-video-incoming') as HTMLVideoElement
        expect(incoming.volume).toBeCloseTo(0.3, 5)
      })
    })

    it('the end of the video sequence stops the mix, tails included', () => {
      // t2 retimed to outlast the 10s video: window [9, 11) — a silent tail
      // per #102. The preview's playback range ends with the video sequence.
      const withTail: TimelineState = {
        ...withAudioTracks,
        audioTracks: [
          withAudioTracks.audioTracks![0],
          { ...withAudioTracks.audioTracks![1], offset: 9 },
        ],
      }
      render(<PreviewPlayer timeline={withTail} />)
      fireEvent.click(screen.getByRole('button', { name: 'Play preview' }))

      video().currentTime = 9.5
      runTick()
      expect(audio(1).paused).toBe(false)

      // The video reaches its out-point: playback finishes and every track
      // pauses with it, even though t2's window extends to 11.
      video().currentTime = 10
      runTick()
      expect(audio(1).paused).toBe(true)
      expect(screen.getByRole('button', { name: 'Play preview' })).toBeInTheDocument()
      expect(screen.getByTestId('preview-position')).toHaveTextContent('0:10 / 0:10')
    })
  })
})
