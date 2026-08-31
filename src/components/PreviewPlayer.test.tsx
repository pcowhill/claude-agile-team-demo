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

  describe('output frame (#176)', () => {
    const oneVideoEntry: TimelineState = {
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

    it('renders every layer inside the frame element, with the fallback aspect', () => {
      const { container } = render(<PreviewPlayer timeline={oneVideoEntry} />)
      // No probe has resolved in jsdom, so the shared rule's fallback frame
      // (640×360) applies — the CSS variable the stage carries says 16:9.
      const stage = container.querySelector('.preview-stage') as HTMLElement
      expect(stage.style.getPropertyValue('--preview-aspect')).toBe(String(640 / 360))
      // The stacked video elements live inside the frame, not loose in the
      // stage: their fractional geometry must resolve against the frame.
      const frame = screen.getByTestId('preview-frame')
      expect(frame.parentElement).toBe(stage)
      expect(frame.querySelectorAll('.preview-video')).toHaveLength(2)
    })

    it('sizes the frame from every source via the shared rule once probes report', async () => {
      // jsdom fires no media events, but Image probes are stubbable: an
      // 800×800 still must reshape the frame to a square — proving the
      // probe wiring feeds outputFrameSize, not just the fallback.
      class InstantSquareImage {
        onload: (() => void) | null = null
        naturalWidth = 0
        naturalHeight = 0
        set src(_value: string) {
          this.naturalWidth = 800
          this.naturalHeight = 800
          queueMicrotask(() => this.onload?.())
        }
        removeAttribute() {}
      }
      vi.stubGlobal('Image', InstantSquareImage)
      try {
        const still: TimelineState = {
          entries: [
            {
              id: 'i1',
              clipId: 'c1',
              name: 'photo.png',
              duration: 4,
              url: 'blob:photo',
              inPoint: 0,
              outPoint: 4,
              kind: 'image',
            },
          ],
        }
        const { container } = render(<PreviewPlayer timeline={still} />)
        await act(async () => {})
        const stage = container.querySelector('.preview-stage') as HTMLElement
        expect(stage.style.getPropertyValue('--preview-aspect')).toBe('1')
      } finally {
        vi.unstubAllGlobals()
      }
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

  // Time remapping (#141). Real rate/pause playback is covered by
  // e2e/preview-remap.spec.ts; the mapping maths by lib/remap.test.ts and
  // lib/playback.test.ts. These pin what jsdom can see: the remapped totals
  // and how seeks resolve through the remapped mapping.
  describe('time remapping (#141)', () => {
    it('sizes the scrubber and totals by the remapped duration', () => {
      const remapped: TimelineState = {
        entries: withTransition.entries,
        // e1: 4s source, [0,4]@0.5 plays for 8s, plus a 2s hold on e2.
        remaps: [
          { id: 'r1', entryId: 'e1', kind: 'speed', start: 0, end: 4, factor: 0.5 },
          { id: 'r2', entryId: 'e2', kind: 'pause', at: 1, hold: 2 },
        ],
      }
      render(<PreviewPlayer timeline={remapped} />)
      expect(screen.getByRole('slider', { name: 'Seek within sequence' })).toHaveAttribute(
        'max',
        '14',
      )
      expect(screen.getByTestId('preview-position')).toHaveTextContent('0:00 / 0:14')
    })

    it('resolves seeks into remapped regions to the right entry', () => {
      const remapped: TimelineState = {
        entries: withTransition.entries,
        remaps: [{ id: 'r1', entryId: 'e1', kind: 'speed', start: 0, end: 4, factor: 0.5 }],
      }
      render(<PreviewPlayer timeline={remapped} />)
      const slider = screen.getByRole('slider', { name: 'Seek within sequence' })

      // Sequence 6 is still inside e1's slowed 8s of output.
      fireEvent.change(slider, { target: { value: '6' } })
      expect(screen.getByTestId('preview-now-playing')).toHaveTextContent(
        'Clip 1 of 2: first.webm',
      )

      // Past e1's remapped end the second entry fronts.
      fireEvent.change(slider, { target: { value: '9' } })
      expect(screen.getByTestId('preview-now-playing')).toHaveTextContent(
        'Clip 2 of 2: second.webm',
      )
    })

    it('places a transition overlap by output time on a remapped entry', () => {
      const remapped: TimelineState = {
        ...withTransition,
        remaps: [{ id: 'r1', entryId: 'e1', kind: 'speed', start: 0, end: 4, factor: 0.5 }],
      }
      render(<PreviewPlayer timeline={remapped} />)
      const slider = screen.getByRole('slider', { name: 'Seek within sequence' })

      // e1 now plays for 8s, so the 1s crossfade covers sequence [7, 8) —
      // where the *unremapped* timeline had it at [3, 4).
      fireEvent.change(slider, { target: { value: '3.5' } })
      expect(screen.queryByTestId('preview-video-incoming')).not.toBeInTheDocument()

      fireEvent.change(slider, { target: { value: '7.5' } })
      expect(screen.getByTestId('preview-video-incoming')).toHaveStyle({ opacity: '0.5' })
      expect(screen.getByTestId('preview-now-playing')).toHaveTextContent(
        'Clip 1 of 2: first.webm → second.webm (crossfade)',
      )
    })
  })

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

  describe('still entries (#140)', () => {
    const stillEntry = {
      id: 's1',
      clipId: 'i1',
      name: 'logo.png',
      duration: 5,
      url: 'blob:logo',
      inPoint: 0,
      outPoint: 5,
      kind: 'image' as const,
    }
    const videoEntry = {
      id: 'v1',
      clipId: 'c1',
      name: 'first.webm',
      duration: 4,
      url: 'blob:first',
      inPoint: 0,
      outPoint: 4,
    }

    it('renders a fronting still as an image, in place of the video element', () => {
      render(<PreviewPlayer timeline={{ entries: [stillEntry] }} />)
      const image = screen.getByTestId('preview-image')
      expect(image).toHaveAttribute('src', 'blob:logo')
      expect(image).toHaveClass('preview-video')
      // The primary video element stands idle — the still owns the slot.
      expect(screen.queryByTestId('preview-video')).not.toBeInTheDocument()
      expect(screen.getByRole('slider', { name: 'Seek within sequence' })).toHaveAttribute(
        'max',
        '5',
      )
      expect(screen.getByTestId('preview-now-playing')).toHaveTextContent(
        'Clip 1 of 1: logo.png',
      )
    })

    it('a transition into a still renders the incoming image mid-effect', () => {
      const timeline: TimelineState = {
        entries: [videoEntry, stillEntry],
        transitions: [{ beforeId: 'v1', afterId: 's1', type: 'crossfade', duration: 1 }],
      }
      render(<PreviewPlayer timeline={timeline} />)
      // Sequence 3.5 is halfway through the 1s crossfade out of the video.
      fireEvent.change(screen.getByRole('slider', { name: 'Seek within sequence' }), {
        target: { value: '3.5' },
      })
      const incoming = screen.getByTestId('preview-image-incoming')
      expect(incoming).toHaveAttribute('src', 'blob:logo')
      expect(incoming).toHaveStyle({ opacity: '0.5' })
      expect(incoming).toHaveStyle({ mixBlendMode: 'plus-lighter' })
      expect(screen.getByTestId('preview-video')).toHaveStyle({ opacity: '0.5' })
      expect(screen.getByTestId('preview-now-playing')).toHaveTextContent(
        'Clip 1 of 2: first.webm → logo.png (crossfade)',
      )
    })

    it('a transition out of a still renders the incoming video over the image', () => {
      const timeline: TimelineState = {
        entries: [stillEntry, videoEntry],
        transitions: [{ beforeId: 's1', afterId: 'v1', type: 'slide-from-left', duration: 1 }],
      }
      render(<PreviewPlayer timeline={timeline} />)
      // Sequence 4.25 is a quarter into the overlap [4, 5).
      fireEvent.change(screen.getByRole('slider', { name: 'Seek within sequence' }), {
        target: { value: '4.25' },
      })
      expect(screen.getByTestId('preview-image')).toBeInTheDocument()
      const incoming = screen.getByTestId('preview-video-incoming')
      expect(incoming).toHaveStyle({ transform: 'translate(-75%, 0%)' })
      expect(incoming).toHaveStyle({ backgroundColor: '#000' })
      expect(screen.getByTestId('preview-now-playing')).toHaveTextContent(
        'Clip 1 of 2: logo.png → first.webm (slide from left)',
      )
    })

    it('renders a zoom on a still exactly as on a video (#140)', () => {
      const timeline: TimelineState = {
        entries: [stillEntry],
        zooms: [
          {
            id: 'z1',
            entryId: 's1',
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
      render(<PreviewPlayer timeline={timeline} />)
      fireEvent.change(screen.getByRole('slider', { name: 'Seek within sequence' }), {
        target: { value: '2.5' },
      })
      const image = screen.getByTestId('preview-image')
      expect(image.style.transform).toBe('scale(2) translate(25%, 0%)')
      expect(image.style.clipPath).toBe('inset(25% 50% 25% 0%)')
    })

    describe('color slates (#143)', () => {
      const slate = {
        id: 'sl1',
        clipId: '',
        name: 'Color slate',
        duration: 5,
        url: '',
        inPoint: 0,
        outPoint: 5,
        kind: 'slate' as const,
        color: '#ff0000',
      }

      it('renders a fronting slate as its flat color, in place of the video element', () => {
        render(<PreviewPlayer timeline={{ entries: [slate] }} />)
        const layer = screen.getByTestId('preview-slate')
        expect(layer).toHaveClass('preview-video')
        expect(layer).toHaveStyle({ backgroundColor: '#ff0000' })
        // Neither a video element nor an image fronts — the slate owns the slot.
        expect(screen.queryByTestId('preview-video')).not.toBeInTheDocument()
        expect(screen.queryByTestId('preview-image')).not.toBeInTheDocument()
        expect(screen.getByTestId('preview-now-playing')).toHaveTextContent(
          'Clip 1 of 1: Color slate',
        )
      })

      it('a crossfade from a slate into a video ramps both layers (the customer example)', () => {
        const timeline: TimelineState = {
          entries: [slate, videoEntry],
          transitions: [{ beforeId: 'sl1', afterId: 'v1', type: 'crossfade', duration: 1 }],
        }
        render(<PreviewPlayer timeline={timeline} />)
        // Sequence 4.5 is halfway through the overlap [4, 5).
        fireEvent.change(screen.getByRole('slider', { name: 'Seek within sequence' }), {
          target: { value: '4.5' },
        })
        expect(screen.getByTestId('preview-slate')).toHaveStyle({ backgroundColor: '#ff0000' })
        const incoming = screen.getByTestId('preview-video-incoming')
        expect(incoming).toHaveStyle({ opacity: '0.5' })
        expect(screen.getByTestId('preview-now-playing')).toHaveTextContent(
          'Clip 1 of 2: Color slate → first.webm (crossfade)',
        )
      })

      it('a transition into a slate renders the incoming color layer mid-effect', () => {
        const timeline: TimelineState = {
          entries: [videoEntry, { ...slate, color: '#00cc66' }],
          transitions: [{ beforeId: 'v1', afterId: 'sl1', type: 'slide-from-above', duration: 1 }],
        }
        render(<PreviewPlayer timeline={timeline} />)
        // Sequence 3.25 is a quarter into the overlap [3, 4).
        fireEvent.change(screen.getByRole('slider', { name: 'Seek within sequence' }), {
          target: { value: '3.25' },
        })
        const incoming = screen.getByTestId('preview-slate-incoming')
        expect(incoming).toHaveStyle({ backgroundColor: '#00cc66' })
        expect(incoming).toHaveStyle({ transform: 'translate(0%, -75%)' })
        expect(screen.getByTestId('preview-now-playing')).toHaveTextContent(
          'Clip 1 of 2: first.webm → Color slate (slide from above)',
        )
      })
    })

    describe('playback clock', () => {
      const pausedState = new WeakMap<HTMLMediaElement, boolean>()
      let frames: FrameRequestCallback[]
      let now: number

      beforeEach(() => {
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
          this: HTMLMediaElement,
        ) {
          pausedState.set(this, false)
          return Promise.resolve()
        })
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
          this: HTMLMediaElement,
        ) {
          pausedState.set(this, true)
        })
        vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(function (
          this: HTMLMediaElement,
        ) {
          return pausedState.get(this) ?? true
        })
        now = 0
        vi.spyOn(performance, 'now').mockImplementation(() => now)
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

      const runTick = () => {
        const tick = frames[frames.length - 1]
        act(() => tick(0))
      }

      it('a fronting still advances on the wall clock and ends the sequence on time', () => {
        render(<PreviewPlayer timeline={{ entries: [stillEntry] }} />)
        fireEvent.click(screen.getByRole('button', { name: 'Play preview' }))

        now = 1000
        runTick()
        expect(screen.getByTestId('preview-position')).toHaveTextContent('0:01 / 0:05')

        now = 5100
        runTick()
        expect(screen.getByTestId('preview-position')).toHaveTextContent('0:05 / 0:05')
        expect(screen.getByRole('button', { name: 'Play preview' })).toBeInTheDocument()
      })

      it('a hard cut hands the clock from the video element to the still', () => {
        render(<PreviewPlayer timeline={{ entries: [videoEntry, stillEntry] }} />)
        fireEvent.click(screen.getByRole('button', { name: 'Play preview' }))
        const video = screen.getByTestId('preview-video') as HTMLVideoElement

        // The video reaches its out-point: the still takes over, rendered as
        // an image and timed by the wall clock from here on.
        video.currentTime = 4
        runTick()
        expect(screen.getByTestId('preview-image')).toBeInTheDocument()
        expect(screen.queryByTestId('preview-video')).not.toBeInTheDocument()

        now = 2000
        runTick()
        expect(screen.getByTestId('preview-position')).toHaveTextContent('0:06 / 0:09')
      })

      it('pausing freezes the still clock; resuming continues from the same spot', () => {
        render(<PreviewPlayer timeline={{ entries: [stillEntry] }} />)
        fireEvent.click(screen.getByRole('button', { name: 'Play preview' }))
        now = 2000
        runTick()
        expect(screen.getByTestId('preview-position')).toHaveTextContent('0:02 / 0:05')

        fireEvent.click(screen.getByRole('button', { name: 'Pause preview' }))
        // Wall time passes while paused; the position must not.
        now = 4000
        fireEvent.click(screen.getByRole('button', { name: 'Play preview' }))
        now = 5000
        runTick()
        expect(screen.getByTestId('preview-position')).toHaveTextContent('0:03 / 0:05')
      })
    })
  })
})

describe('text overlays (#139)', () => {
  const baseEntry = {
    id: 'e1',
    clipId: 'c1',
    name: 'first.webm',
    duration: 10,
    url: 'blob:first',
    inPoint: 0,
    outPoint: 10,
  }
  const overlay = {
    id: 't1',
    content: 'Hello\nworld',
    offset: 2,
    duration: 3,
    x: 0.25,
    y: 0.75,
    font: 'serif',
    size: 0.1,
    color: '#00ff88',
    bold: true,
    italic: true,
  } as const

  const seekTo = (value: string) =>
    fireEvent.change(screen.getByRole('slider', { name: 'Seek within sequence' }), {
      target: { value },
    })

  it('shows an overlay only during its window, styled and positioned as configured', () => {
    render(<PreviewPlayer timeline={{ entries: [baseEntry], texts: [overlay] }} />)

    // Before the window: nothing.
    expect(screen.queryByTestId('preview-text-0')).not.toBeInTheDocument()

    seekTo('2')
    const text = screen.getByTestId('preview-text-0')
    expect(text).toHaveTextContent('Hello world')
    expect(text.style.left).toBe('25%')
    expect(text.style.top).toBe('75%')
    expect(text.style.color).toBe('rgb(0, 255, 136)')
    expect(text.style.fontFamily).toContain('Georgia')
    expect(text.style.fontWeight).toBe('700')
    expect(text.style.fontStyle).toBe('italic')
    // Sized as a fraction of the frame height, via container-query units
    // against the stage.
    expect(text.style.fontSize).toBe('10cqh')

    // Half-open window end: at offset + duration the overlay is gone.
    seekTo('4.99')
    expect(screen.getByTestId('preview-text-0')).toBeInTheDocument()
    seekTo('5')
    expect(screen.queryByTestId('preview-text-0')).not.toBeInTheDocument()
  })

  it('stacks overlapping overlays in add order and shows each for its own window', () => {
    const second = {
      ...overlay,
      id: 't2',
      content: 'On top',
      offset: 3,
      duration: 10,
      bold: false,
      italic: false,
    }
    render(<PreviewPlayer timeline={{ entries: [baseEntry], texts: [overlay, second] }} />)

    seekTo('3.5')
    const stage = screen.getByTestId('preview-text-0').parentElement as HTMLElement
    const rendered = Array.from(stage.querySelectorAll('.preview-text')).map(
      (element) => element.textContent,
    )
    // Both active; document order is add order — the later-added renders on
    // top (same z-index, later in the paint order).
    expect(rendered).toEqual(['Hello\nworld', 'On top'])

    seekTo('9')
    expect(screen.queryByTestId('preview-text-0')).not.toBeInTheDocument()
    expect(screen.getByTestId('preview-text-1')).toHaveTextContent('On top')
  })

  it('renders an overlay above a transition overlap, inside the same stage', () => {
    const withTransition = {
      entries: [
        { ...baseEntry, duration: 4, outPoint: 4 },
        { ...baseEntry, id: 'e2', clipId: 'c2', name: 'second.webm', url: 'blob:second', duration: 4, outPoint: 4 },
      ],
      transitions: [{ beforeId: 'e1', afterId: 'e2', type: 'crossfade' as const, duration: 1 }],
      texts: [{ ...overlay, offset: 0, duration: 99 }],
    }
    render(<PreviewPlayer timeline={withTransition} />)

    // Mid-overlap (sequence time 3.5 of 7): the incoming element is live and
    // the overlay still renders, after it in the stage's paint order.
    seekTo('3.5')
    const incoming = screen.getByTestId('preview-video-incoming')
    const text = screen.getByTestId('preview-text-0')
    expect(text).toBeInTheDocument()
    expect(incoming.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('an overlay whose window lies past the sequence end never shows', () => {
    render(
      <PreviewPlayer
        timeline={{
          entries: [{ ...baseEntry, duration: 4, outPoint: 4 }],
          texts: [{ ...overlay, offset: 10 }],
        }}
      />,
    )
    seekTo('4')
    expect(screen.queryByTestId('preview-text-0')).not.toBeInTheDocument()
  })
})

describe('overlay video layers (#145)', () => {
  // A 10s base entry; one overlay playing source [1, 3) over sequence
  // [2, 4), placed in the bottom-right quadrant; a second overlay from 8.
  const baseEntry = {
    id: 'e1',
    clipId: 'c1',
    name: 'first.webm',
    duration: 10,
    url: 'blob:first',
    inPoint: 0,
    outPoint: 10,
  }
  const pip = {
    id: 'v1',
    clipId: 'c2',
    name: 'cam.webm',
    duration: 8,
    url: 'blob:cam',
    offset: 2,
    inPoint: 1,
    outPoint: 3,
    x: 0.6,
    y: 0.55,
    width: 0.35,
    height: 0.4,
  }
  const withOverlays: TimelineState = {
    entries: [baseEntry],
    videoOverlays: [pip, { ...pip, id: 'v2', clipId: 'c3', url: 'blob:cam2', offset: 8, x: 0.05 }],
  }

  const pausedState = new WeakMap<HTMLMediaElement, boolean>()
  let playSpy: ReturnType<typeof vi.spyOn>
  let frames: FrameRequestCallback[]

  beforeEach(() => {
    playSpy = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementation(function (this: HTMLMediaElement) {
        pausedState.set(this, false)
        return Promise.resolve()
      })
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
      this: HTMLMediaElement,
    ) {
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

  const overlayElement = (index: number) =>
    screen.getByTestId(`preview-overlay-${index}`) as HTMLVideoElement
  const seekTo = (value: string) =>
    fireEvent.change(screen.getByRole('slider', { name: 'Seek within sequence' }), {
      target: { value },
    })
  const playedElements = () => playSpy.mock.contexts as unknown as HTMLMediaElement[]

  it('renders one element per overlay at its rectangle, hidden outside its window', () => {
    render(<PreviewPlayer timeline={withOverlays} />)
    const element = overlayElement(0)
    expect(element).toHaveAttribute('src', 'blob:cam')
    expect(parseFloat(element.style.left)).toBeCloseTo(60, 10)
    expect(parseFloat(element.style.top)).toBeCloseTo(55, 10)
    expect(parseFloat(element.style.width)).toBeCloseTo(35, 10)
    expect(parseFloat(element.style.height)).toBeCloseTo(40, 10)
    // Before its window: mounted (source stays loaded) but hidden.
    expect(element.className).toContain('preview-overlay-hidden')

    seekTo('3')
    expect(overlayElement(0).className).not.toContain('preview-overlay-hidden')
    // Half-open window end, like an audio track's.
    seekTo('4')
    expect(overlayElement(0).className).toContain('preview-overlay-hidden')
  })

  it('renders overlays below text overlays in the stage paint order', () => {
    render(
      <PreviewPlayer
        timeline={{
          ...withOverlays,
          texts: [
            {
              id: 't1',
              content: 'Title',
              offset: 0,
              duration: 99,
              x: 0.5,
              y: 0.5,
              font: 'sans',
              size: 0.1,
              color: '#ffffff',
              bold: false,
              italic: false,
            },
          ],
        }}
      />,
    )
    seekTo('3')
    const overlay = overlayElement(0)
    const text = screen.getByTestId('preview-text-0')
    // Same stage; the text follows the overlay in document order and carries
    // the higher z-index, so it paints on top.
    expect(overlay.parentElement).toBe(text.parentElement)
    expect(overlay.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('playing starts a covering overlay at its mapped source time; an upcoming one stays cued', () => {
    render(<PreviewPlayer timeline={withOverlays} />)
    seekTo('3')
    fireEvent.click(screen.getByRole('button', { name: 'Play preview' }))

    // Sequence 3 is 1s into the window: source = inPoint 1 + 1.
    expect(overlayElement(0).currentTime).toBe(2)
    expect(playedElements()).toContain(overlayElement(0))
    // The second overlay's window starts at 8 — past the base sequence end
    // is allowed; here it is simply not covering yet: cued, not playing.
    expect(overlayElement(1).paused).toBe(true)
    expect(playedElements()).not.toContain(overlayElement(1))
  })

  it('seeking while paused cues the overlay frame without playing it', () => {
    render(<PreviewPlayer timeline={withOverlays} />)
    seekTo('2.5')
    expect(overlayElement(0).currentTime).toBe(1.5)
    expect(overlayElement(0).paused).toBe(true)
    expect(playedElements()).toHaveLength(0)
  })

  it('honors the overlay volume and mute in the mixed audio', () => {
    const withGain: TimelineState = {
      entries: [baseEntry],
      videoOverlays: [
        { ...pip, volume: 0.4 },
        { ...pip, id: 'v2', url: 'blob:cam2', muted: true },
      ],
    }
    render(<PreviewPlayer timeline={withGain} />)
    seekTo('3')
    expect(overlayElement(0).volume).toBe(0.4)
    // Mute wins over everything (#104).
    expect(overlayElement(1).volume).toBe(0)
  })

  it('an overlay whose window lies past the sequence end never shows', () => {
    render(<PreviewPlayer timeline={withOverlays} />)
    seekTo('10')
    expect(overlayElement(1).className).toContain('preview-overlay-hidden')
  })
})

describe('Split at playhead (#190)', () => {
  const twoClips: TimelineState = {
    entries: [
      {
        id: 'e1',
        clipId: 'c1',
        name: 'first.webm',
        duration: 4,
        url: 'blob:first',
        inPoint: 1,
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
  }

  it('enables exactly where a split is possible and reports the source instant', () => {
    const onSplit = vi.fn()
    render(<PreviewPlayer timeline={twoClips} onSplit={onSplit} />)
    const button = screen.getByTestId('preview-split')
    const slider = screen.getByRole('slider', { name: 'Seek within sequence' })

    // At the sequence start there is nothing before the playhead to split.
    expect(button).toBeDisabled()

    // Mid-first-entry: 1.5s into e1's trimmed range → source 1 + 1.5.
    fireEvent.change(slider, { target: { value: '1.5' } })
    expect(button).toBeEnabled()
    fireEvent.click(button)
    expect(onSplit).toHaveBeenCalledWith('e1', 2.5)

    // The e1→e2 hard-cut boundary resolves to e2's very start: disabled.
    fireEvent.change(slider, { target: { value: '3' } })
    expect(button).toBeDisabled()

    // The sequence end: disabled.
    fireEvent.change(slider, { target: { value: '7' } })
    expect(button).toBeDisabled()
  })

  it('disables inside a transition overlap', () => {
    const withTransition: TimelineState = {
      ...twoClips,
      transitions: [{ beforeId: 'e1', afterId: 'e2', type: 'crossfade', duration: 1 }],
    }
    render(<PreviewPlayer timeline={withTransition} onSplit={vi.fn()} />)
    const slider = screen.getByRole('slider', { name: 'Seek within sequence' })
    // The overlap covers sequence [2, 3): both clips are playing.
    fireEvent.change(slider, { target: { value: '2.5' } })
    expect(screen.getByTestId('preview-split')).toBeDisabled()
    fireEvent.change(slider, { target: { value: '1.5' } })
    expect(screen.getByTestId('preview-split')).toBeEnabled()
  })

  it('stays disabled without an onSplit wiring', () => {
    render(<PreviewPlayer timeline={twoClips} />)
    fireEvent.change(screen.getByRole('slider', { name: 'Seek within sequence' }), {
      target: { value: '1.5' },
    })
    expect(screen.getByTestId('preview-split')).toBeDisabled()
  })
})
