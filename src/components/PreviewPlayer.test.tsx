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
    // Save frame (#237) rides the transport: offered exactly when there is
    // a frame to save. (The empty-timeline case renders no transport at
    // all — the placeholder test above — matching the export's idiom.)
    expect(screen.getByTestId('preview-save-frame')).toBeEnabled()
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

    // The project's canvas preset (#273): the stage takes the preset's
    // aspect, and everything frame-fractional keeps its fractions.
    describe('canvas preset (#273)', () => {
      const aspectOf = (container: HTMLElement) =>
        (container.querySelector('.preview-stage') as HTMLElement).style.getPropertyValue(
          '--preview-aspect',
        )

      it('reshapes the stage to the preset, and Auto renders exactly as before', () => {
        // No probe resolves in jsdom, so the fallback frame (640×360) is the
        // source-derived one; the preset reshapes that the same way it
        // reshapes a real frame.
        const auto = render(<PreviewPlayer timeline={oneVideoEntry} />)
        expect(aspectOf(auto.container)).toBe(String(640 / 360))
        auto.unmount()

        // An explicitly-Auto project is byte-identical to a preset-free one.
        const explicitAuto = render(
          <PreviewPlayer timeline={{ ...oneVideoEntry, canvasPreset: undefined }} />,
        )
        expect(aspectOf(explicitAuto.container)).toBe(String(640 / 360))
        explicitAuto.unmount()

        const portrait = render(
          <PreviewPlayer timeline={{ ...oneVideoEntry, canvasPreset: '9:16' }} />,
        )
        // presetFrame({640,360}, '9:16') = 648×1152 — the smallest exact
        // 9:16 frame containing the fallback, so nothing downscales.
        expect(aspectOf(portrait.container)).toBe(String(648 / 1152))
        expect(648 / 1152).toBeCloseTo(9 / 16, 10)
      })

      it('gives each preset its own aspect', () => {
        for (const [preset, expected] of [
          ['16:9', 16 / 9],
          ['9:16', 9 / 16],
          ['1:1', 1],
          ['4:5', 4 / 5],
        ] as const) {
          const { container, unmount } = render(
            <PreviewPlayer timeline={{ ...oneVideoEntry, canvasPreset: preset }} />,
          )
          expect(Number(aspectOf(container)), `${preset} stage aspect`).toBeCloseTo(expected, 10)
          unmount()
        }
      })

      it('keeps overlay rectangles and text positions at the same fractions', () => {
        // The whole reason a reshape needs no migration: this state is
        // fractions *of the frame*, so the same numbers mean the right place
        // in any frame. If a preset ever moved these, the two renderers
        // would need a migration instead of a shared rule.
        const withLayers: TimelineState = {
          ...oneVideoEntry,
          videoOverlays: [
            {
              id: 'v1',
              clipId: 'c1',
              name: 'first.webm',
              duration: 4,
              url: 'blob:first',
              offset: 0,
              inPoint: 0,
              outPoint: 4,
              x: 0.6,
              y: 0.65,
              width: 0.3,
              height: 0.25,
            },
          ],
          texts: [
            {
              id: 't1',
              content: 'hello',
              offset: 0,
              duration: 4,
              x: 0.25,
              y: 0.8,
              font: 'sans',
              size: 0.06,
              color: '#ffffff',
              bold: false,
              italic: false,
            },
          ],
        }
        const geometry = (preset?: '9:16') => {
          const { unmount } = render(
            <PreviewPlayer
              timeline={preset === undefined ? withLayers : { ...withLayers, canvasPreset: preset }}
            />,
          )
          const card = screen.getByTestId('preview-overlay-card-0')
          const text = screen.getByTestId('preview-text-0')
          const shape = {
            overlay: [card.style.left, card.style.top, card.style.width, card.style.height],
            text: [text.style.left, text.style.top],
          }
          unmount()
          return shape
        }
        const auto = geometry()
        expect(auto.overlay).toEqual(['60%', '65%', '30%', '25%'])
        expect(geometry('9:16')).toEqual(auto)
      })

      it('composes the preset with a probed source, not just the fallback', async () => {
        // An 800×800 still with a 9:16 preset: the square source is
        // contained, never downscaled, so the frame grows taller.
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
            canvasPreset: '9:16',
          }
          const { container } = render(<PreviewPlayer timeline={still} />)
          await act(async () => {})
          // presetFrame({800,800}, '9:16') = 801×1424: both dimensions cover
          // the source, and the ratio is exactly 9:16.
          expect(aspectOf(container)).toBe(String(801 / 1424))
          expect(801).toBeGreaterThanOrEqual(800)
          expect(1424).toBeGreaterThanOrEqual(800)
        } finally {
          vi.unstubAllGlobals()
        }
      })
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

    // Sequence 3.5 is halfway through the 1s crossfade. Transition styles
    // live on the layer cards (#232); the media elements inside carry only
    // the clip's own looks.
    fireEvent.change(slider, { target: { value: '3.5' } })
    const incoming = screen.getByTestId('preview-video-incoming-card')
    expect(incoming).toHaveStyle({ opacity: '0.5' })
    // The incoming layer ADDS to the outgoing one (a true dissolve), and the
    // outgoing element fades to the stage's black at 1 − progress — so
    // margins the incoming clip does not cover dim instead of popping (#66).
    expect(incoming).toHaveStyle({ mixBlendMode: 'plus-lighter' })
    // No backing on a crossfade's incoming element: the additive blend needs
    // its fitted box's surroundings to stay empty (#74).
    expect(incoming).not.toHaveStyle({ backgroundColor: '#000' })
    expect(screen.getByTestId('preview-video-card')).toHaveStyle({ opacity: '0.5' })
    expect(screen.getByTestId('preview-now-playing')).toHaveTextContent(
      'Clip 1 of 2: first.webm → second.webm (crossfade)',
    )

    // Seeking back out returns to single-clip rendering at full opacity.
    fireEvent.change(slider, { target: { value: '1' } })
    expect(screen.queryByTestId('preview-video-incoming')).not.toBeInTheDocument()
    expect(screen.getByTestId('preview-video-card')).not.toHaveStyle({ opacity: '0.5' })
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
      const incoming = screen.getByTestId('preview-video-incoming-card')
      expect(incoming).toHaveStyle({ transform })
      // Slides keep both layers opaque and non-blended; the incoming element
      // is a full-frame card with its own black backing, so the areas its
      // fitted clip does not cover slide in as black (#74, the customer's
      // decision on #67).
      expect(incoming).toHaveStyle({ opacity: '1' })
      expect(incoming).toHaveStyle({ backgroundColor: '#000' })
      expect(screen.getByTestId('preview-video-card')).toHaveStyle({ opacity: '1' })
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
      expect(screen.getByTestId('preview-video-incoming-card')).toHaveStyle({ opacity: '0.5' })
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
      const video = screen.getByTestId('preview-video-card')

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
      const video = screen.getByTestId('preview-video-card')

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
      const outgoing = screen.getByTestId('preview-video-card')
      expect(outgoing.style.transform).toBe('scale(2) translate(-25%, 0%)')
      expect(outgoing).toHaveStyle({ opacity: '1' })

      // Incoming: the slide's card translate composes with the zoom, in
      // card-then-zoom order, and the #74 backing plus clip keep the card
      // covering exactly its slice of the stage.
      const incoming = screen.getByTestId('preview-video-incoming-card')
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

      it('a duck-enabled track lowers every other source to its level, itself exempt (#241)', () => {
        // t1 becomes a ducking voice over [0, 2); t2 moves under it as music.
        // Inside the window the music and the entry's own audio carry
        // gain × duck level — the same product the export records — while
        // the voice itself is never ducked.
        const ducked: TimelineState = {
          ...withAudioTracks,
          audioTracks: [
            { ...withAudioTracks.audioTracks![0], duck: true, duckLevel: 0.4 },
            { ...withAudioTracks.audioTracks![1], offset: 0, volume: 0.9 },
          ],
        }
        render(<PreviewPlayer timeline={ducked} />)
        fireEvent.click(screen.getByRole('button', { name: 'Play preview' }))

        expect(audio(0).volume).toBe(1)
        expect(audio(1).volume).toBeCloseTo(0.9 * 0.4, 10)
        expect(video().volume).toBeCloseTo(0.4, 10)

        // Past the voice window (and its ramp) the mix recovers: the entry's
        // audio is back at full gain on the next tick.
        video().currentTime = 6
        runTick()
        expect(video().volume).toBe(1)
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
      // The image is the media inside its layer card (#232), which carries
      // the stacked-slot class the video slots share.
      expect(image).toHaveClass('preview-media')
      expect(screen.getByTestId('preview-image-card')).toHaveClass('preview-video')
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
      expect(screen.getByTestId('preview-image-incoming')).toHaveAttribute('src', 'blob:logo')
      const incoming = screen.getByTestId('preview-image-incoming-card')
      expect(incoming).toHaveStyle({ opacity: '0.5' })
      expect(incoming).toHaveStyle({ mixBlendMode: 'plus-lighter' })
      expect(screen.getByTestId('preview-video-card')).toHaveStyle({ opacity: '0.5' })
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
      const incoming = screen.getByTestId('preview-video-incoming-card')
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
      const image = screen.getByTestId('preview-image-card')
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
        const incoming = screen.getByTestId('preview-video-incoming-card')
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
  // The overlay's card (#232): carries the fractional rectangle and the
  // hidden state; the media element inside carries the clip's own looks.
  const overlayCard = (index: number) => screen.getByTestId(`preview-overlay-card-${index}`)
  const seekTo = (value: string) =>
    fireEvent.change(screen.getByRole('slider', { name: 'Seek within sequence' }), {
      target: { value },
    })
  const playedElements = () => playSpy.mock.contexts as unknown as HTMLMediaElement[]

  it('renders one element per overlay at its rectangle, hidden outside its window', () => {
    render(<PreviewPlayer timeline={withOverlays} />)
    expect(overlayElement(0)).toHaveAttribute('src', 'blob:cam')
    const card = overlayCard(0)
    expect(parseFloat(card.style.left)).toBeCloseTo(60, 10)
    expect(parseFloat(card.style.top)).toBeCloseTo(55, 10)
    expect(parseFloat(card.style.width)).toBeCloseTo(35, 10)
    expect(parseFloat(card.style.height)).toBeCloseTo(40, 10)
    // Before its window: mounted (source stays loaded) but hidden.
    expect(card.className).toContain('preview-overlay-hidden')

    seekTo('3')
    expect(overlayCard(0).className).not.toContain('preview-overlay-hidden')
    // Half-open window end, like an audio track's.
    seekTo('4')
    expect(overlayCard(0).className).toContain('preview-overlay-hidden')
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
    const overlay = overlayCard(0)
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
    expect(overlayCard(1).className).toContain('preview-overlay-hidden')
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

describe('transport keyboard shortcuts (#203)', () => {
  const oneClip: TimelineState = {
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

  // Same media stubs as the audio-track block: jsdom implements no playback,
  // so play/pause/paused are faked and rAF captured — enough to observe the
  // component's play state and published position.
  const pausedState = new WeakMap<HTMLMediaElement, boolean>()
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
    vi.stubGlobal('requestAnimationFrame', () => 1)
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const pressOnWindow = (key: string, init: Partial<KeyboardEventInit> = {}) =>
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true, ...init }))
    })
  const slider = () => screen.getByRole('slider', { name: 'Seek within sequence' })

  it('Space toggles play and pause when nothing claims the key', () => {
    render(<PreviewPlayer timeline={oneClip} />)
    expect(screen.getByRole('button', { name: 'Play preview' })).toBeInTheDocument()
    pressOnWindow(' ')
    expect(screen.getByRole('button', { name: 'Pause preview' })).toBeInTheDocument()
    pressOnWindow(' ')
    expect(screen.getByRole('button', { name: 'Play preview' })).toBeInTheDocument()
  })

  it('Space typed into a text-editing field never toggles playback', () => {
    render(<PreviewPlayer timeline={oneClip} />)
    const input = document.createElement('input')
    input.type = 'number'
    document.body.appendChild(input)
    try {
      input.focus()
      fireEvent.keyDown(input, { key: ' ' })
      expect(screen.getByRole('button', { name: 'Play preview' })).toBeInTheDocument()
    } finally {
      input.remove()
    }
  })

  it('arrows step the playhead by 0.1s, Shift+arrows by 1s, clamped to the sequence', () => {
    render(<PreviewPlayer timeline={oneClip} />)
    expect(slider()).toHaveValue('0')
    pressOnWindow('ArrowRight')
    expect(slider()).toHaveValue('0.1')
    pressOnWindow('ArrowRight', { shiftKey: true })
    expect(slider()).toHaveValue('1.1')
    pressOnWindow('ArrowLeft')
    expect(slider()).toHaveValue('1')
    // Clamped at the start…
    pressOnWindow('ArrowLeft', { shiftKey: true })
    pressOnWindow('ArrowLeft')
    expect(slider()).toHaveValue('0')
    // …and at the end (4s total).
    for (let i = 0; i < 5; i++) pressOnWindow('ArrowRight', { shiftKey: true })
    expect(slider()).toHaveValue('4')
  })

  it('Home and End jump to the sequence bounds', () => {
    render(<PreviewPlayer timeline={oneClip} />)
    pressOnWindow('End')
    expect(slider()).toHaveValue('4')
    pressOnWindow('Home')
    expect(slider()).toHaveValue('0')
  })

  it('? opens the cheat sheet listing the #189 undo keys too; Escape and Close dismiss it', () => {
    render(<PreviewPlayer timeline={oneClip} />)
    pressOnWindow('?', { shiftKey: true })
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' })
    expect(dialog).toHaveTextContent('Play / pause the preview')
    expect(dialog).toHaveTextContent('Undo the last timeline edit')

    // While the dialog is open the transport is inert, like under any modal.
    pressOnWindow(' ')
    expect(screen.getByRole('button', { name: 'Play preview' })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    pressOnWindow('?', { shiftKey: true })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders Redo’s alternative combos as separate <kbd> lines, never one wrapping string (#287)', () => {
    render(<PreviewPlayer timeline={oneClip} />)
    pressOnWindow('?', { shiftKey: true })
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' })
    // Each alternative is its own whole <kbd>; the old single "X or Y"
    // string wrapped mid-combo at the dialog's width.
    const combos = Array.from(dialog.querySelectorAll('kbd')).map((kbd) => kbd.textContent)
    expect(combos).toContain('Ctrl/Cmd + Shift + Z')
    expect(combos).toContain('Ctrl/Cmd + Y')
    expect(combos.some((combo) => combo?.includes(' or '))).toBe(false)
  })

  it('? answers on an empty timeline, where there is no transport to drive', () => {
    render(<PreviewPlayer timeline={{ entries: [] }} />)
    pressOnWindow('?', { shiftKey: true })
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
    // The transport keys stay harmless no-ops.
    pressOnWindow(' ')
    pressOnWindow('ArrowRight')
  })
})

describe('orientation (#232)', () => {
  const entryWith = (orientation?: TimelineState['entries'][number]['orientation']): TimelineState => ({
    entries: [
      {
        id: 'e1',
        clipId: 'c1',
        name: 'first.webm',
        duration: 4,
        url: 'blob:first',
        inPoint: 0,
        outPoint: 4,
        ...(orientation === undefined ? {} : { orientation }),
      },
    ],
  })

  it('renders an unoriented entry with no orientation styling on the media element', () => {
    render(<PreviewPlayer timeline={entryWith()} />)
    const media = screen.getByTestId('preview-video')
    expect(media).toHaveClass('preview-media')
    expect(media.style.transform).toBe('')
    expect(media.style.width).toBe('')
  })

  it('a quarter turn swaps the media box to the transposed frame and rotates it back', () => {
    render(<PreviewPlayer timeline={entryWith({ rotation: 90, flipH: true })} />)
    const media = screen.getByTestId('preview-video')
    // No probe resolves in jsdom, so the frame is the 640×360 fallback:
    // the swapped box is 100/(16/9)% wide and 100×(16/9)% tall, centred.
    expect(media.style.transform).toBe('translate(-50%, -50%) rotate(90deg) scale(-1, 1)')
    expect(parseFloat(media.style.width)).toBeCloseTo(56.25, 10)
    expect(parseFloat(media.style.height)).toBeCloseTo((16 / 9) * 100, 10)
    expect(media.style.left).toBe('50%')
    expect(media.style.top).toBe('50%')
    // The card carries no orientation — it stays the frame-shaped box that
    // transitions and zooms style.
    expect(screen.getByTestId('preview-video-card').style.transform).toBe('')
  })

  it('shape-preserving orientations transform in place, box untouched', () => {
    render(<PreviewPlayer timeline={entryWith({ rotation: 180 })} />)
    const media = screen.getByTestId('preview-video')
    expect(media.style.transform).toBe('rotate(180deg)')
    expect(media.style.width).toBe('')

    render(<PreviewPlayer timeline={entryWith({ flipH: true, flipV: true })} />)
    const flipped = screen.getAllByTestId('preview-video')[1]
    expect(flipped.style.transform).toBe('scale(-1, -1)')
    expect(flipped.style.width).toBe('')
  })

  it('composes with a zoom: the card zooms, the media inside stays oriented', () => {
    const timeline: TimelineState = {
      ...entryWith({ rotation: 90 }),
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
    render(<PreviewPlayer timeline={timeline} />)
    fireEvent.change(screen.getByRole('slider', { name: 'Seek within sequence' }), {
      target: { value: '2.5' },
    })
    expect(screen.getByTestId('preview-video-card').style.transform).toBe(
      'scale(2) translate(25%, 0%)',
    )
    expect(screen.getByTestId('preview-video').style.transform).toBe(
      'translate(-50%, -50%) rotate(90deg)',
    )
  })

  it('composes with color adjustments on the same media element', () => {
    render(
      <PreviewPlayer
        timeline={{
          entries: [
            { ...entryWith({ flipH: true }).entries[0], colorAdjustments: { brightness: 150 } },
          ],
        }}
      />,
    )
    const media = screen.getByTestId('preview-video')
    expect(media.style.transform).toBe('scale(-1, 1)')
    expect(media.style.filter).toBe('brightness(150%)')
  })

  it('orients an overlay inside its rectangle card', () => {
    const timeline: TimelineState = {
      ...entryWith(),
      videoOverlays: [
        {
          id: 'v1',
          clipId: 'c2',
          name: 'cam.webm',
          duration: 8,
          url: 'blob:cam',
          offset: 0,
          inPoint: 0,
          outPoint: 4,
          x: 0.6,
          y: 0.55,
          width: 0.35,
          height: 0.4,
          orientation: { rotation: 270 },
        },
      ],
    }
    render(<PreviewPlayer timeline={timeline} />)
    const media = screen.getByTestId('preview-overlay-0') as HTMLVideoElement
    // The overlay card's aspect is the frame aspect × (0.35 / 0.4); the
    // swapped media box inverts it, exactly as for the base slots.
    const cardAspect = (640 / 360) * (0.35 / 0.4)
    expect(media.style.transform).toBe('translate(-50%, -50%) rotate(270deg)')
    expect(parseFloat(media.style.width)).toBeCloseTo(100 / cardAspect, 10)
    expect(parseFloat(media.style.height)).toBeCloseTo(100 * cardAspect, 10)
    // The rectangle stays on the card, orientation-free.
    const card = screen.getByTestId('preview-overlay-card-0')
    expect(card.style.transform).toBe('')
    expect(parseFloat(card.style.width)).toBeCloseTo(35, 10)
  })

  it('an oriented source presents its swapped shape to the frame rule', async () => {
    // The Image-probe stub from the #176 tests: a 800×450 landscape photo,
    // rotated a quarter turn, must shape the frame portrait (450/800).
    class InstantLandscapeImage {
      onload: (() => void) | null = null
      naturalWidth = 0
      naturalHeight = 0
      set src(_value: string) {
        this.naturalWidth = 800
        this.naturalHeight = 450
        queueMicrotask(() => this.onload?.())
      }
      removeAttribute() {}
    }
    vi.stubGlobal('Image', InstantLandscapeImage)
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
            orientation: { rotation: 90 },
          },
        ],
      }
      const { container } = render(<PreviewPlayer timeline={still} />)
      await act(async () => {})
      const stage = container.querySelector('.preview-stage') as HTMLElement
      expect(stage.style.getPropertyValue('--preview-aspect')).toBe(String(450 / 800))
      // And the oriented image's media box swaps against that frame.
      const media = screen.getByTestId('preview-image')
      expect(media.style.transform).toBe('translate(-50%, -50%) rotate(90deg)')
      expect(parseFloat(media.style.width)).toBeCloseTo(100 / (450 / 800), 10)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('crop (#255)', () => {
  /** The Image-probe stub from the #176 tests: an 800×450 landscape photo. */
  class InstantLandscapeImage {
    onload: (() => void) | null = null
    naturalWidth = 0
    naturalHeight = 0
    set src(_value: string) {
      this.naturalWidth = 800
      this.naturalHeight = 450
      queueMicrotask(() => this.onload?.())
    }
    removeAttribute() {}
  }

  const croppedStill = (crop: object, orientation?: object): TimelineState => ({
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
        crop,
        ...(orientation === undefined ? {} : { orientation }),
      },
    ],
  })

  it('a cropped source presents its kept region to the frame rule and clips to it', async () => {
    vi.stubGlobal('Image', InstantLandscapeImage)
    try {
      // Keeping the right half of 800×450 is a 400×450 source: the frame
      // reshapes to it, and the media element clips, scales, and recentres
      // per the shared placement rule (crop.ts).
      const { container } = render(
        <PreviewPlayer timeline={croppedStill({ left: 0.5 })} />,
      )
      await act(async () => {})
      const stage = container.querySelector('.preview-stage') as HTMLElement
      expect(stage.style.getPropertyValue('--preview-aspect')).toBe(String(400 / 450))
      const media = screen.getByTestId('preview-image')
      // Box aspect 8/9, source 16/9: the source letterboxes to half height;
      // its right half contain-fits at twice the size, shifted left.
      expect(media.style.clipPath).toBe('inset(25% 0% 25% 50%)')
      expect(media.style.transform).toBe('translate(-50%, 0%) scale(2)')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('crop composes with a quarter turn: the kept region is what rotates (#232)', async () => {
    vi.stubGlobal('Image', InstantLandscapeImage)
    try {
      const { container } = render(
        <PreviewPlayer timeline={croppedStill({ left: 0.5 }, { rotation: 90 })} />,
      )
      await act(async () => {})
      // Crop before orientation: 800×450 cropped to 400×450, turned to
      // 450×400 — the frame rule sees the rotated kept region.
      const stage = container.querySelector('.preview-stage') as HTMLElement
      expect(stage.style.getPropertyValue('--preview-aspect')).toBe(String(450 / 400))
      // The element box is the transposed card (the #232 swap), and the
      // crop placement works in that box: same clip and inner transform as
      // the unrotated case, with the swap and rotation outside it.
      const media = screen.getByTestId('preview-image')
      expect(media.style.clipPath).toBe('inset(25% 0% 25% 50%)')
      expect(media.style.transform).toBe(
        'translate(-50%, -50%) rotate(90deg) translate(-50%, 0%) scale(2)',
      )
      expect(parseFloat(media.style.width)).toBeCloseTo(100 / (450 / 400), 10)
      expect(parseFloat(media.style.height)).toBeCloseTo(100 * (450 / 400), 10)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('an unprobed source styles no crop yet — the probe gates the placement', async () => {
    // No Image stub: jsdom never reports dimensions, so the media element
    // stays unclipped (and the frame at the fallback) until a probe lands.
    render(<PreviewPlayer timeline={croppedStill({ left: 0.5 })} />)
    await act(async () => {})
    const media = screen.getByTestId('preview-image')
    expect(media.style.clipPath).toBe('')
    expect(media.style.transform).toBe('')
  })
})

describe('background fill (#259)', () => {
  /** The Image-probe stub from the #176 tests: an 800×450 landscape photo. */
  class InstantLandscapeImage {
    onload: (() => void) | null = null
    naturalWidth = 0
    naturalHeight = 0
    set src(_value: string) {
      this.naturalWidth = 800
      this.naturalHeight = 450
      queueMicrotask(() => this.onload?.())
    }
    removeAttribute() {}
  }

  type Fill = NonNullable<TimelineState['entries'][number]['backgroundFill']>

  const filledStill = (backgroundFill?: Fill): TimelineState => ({
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
        ...(backgroundFill === undefined ? {} : { backgroundFill }),
      },
    ],
  })

  const videoWithFill = (backgroundFill: Fill): TimelineState => ({
    entries: [
      {
        id: 'e1',
        clipId: 'c1',
        name: 'clip.webm',
        duration: 10,
        url: 'blob:clip',
        inPoint: 0,
        outPoint: 10,
        backgroundFill,
      },
    ],
  })

  it('a color fill renders the backdrop div under the still, a blur the canvas', () => {
    const { rerender } = render(
      <PreviewPlayer timeline={filledStill({ kind: 'color', color: '#2244aa' })} />,
    )
    const card = screen.getByTestId('preview-image-card')
    const backdrop = screen.getByTestId('preview-backfill-color')
    // First child of the card — behind the media element that follows it.
    expect(card.firstElementChild).toBe(backdrop)
    expect(backdrop).toHaveClass('preview-backfill')
    expect(backdrop.style.backgroundColor).toBe('rgb(34, 68, 170)')

    rerender(<PreviewPlayer timeline={filledStill({ kind: 'blur' })} />)
    const canvas = screen.getByTestId('preview-backfill-blur')
    expect(screen.getByTestId('preview-image-card').firstElementChild).toBe(canvas)
    expect(canvas.tagName).toBe('CANVAS')
    expect(canvas).toHaveClass('preview-backfill')
    // The blur strength comes from the shared rule, in frame-relative cq
    // units — 2% of the frame's shorter side, matching the export's radius.
    expect(canvas.style.filter).toBe('blur(min(2cqw, 2cqh))')
  })

  it('a fill-free entry renders no backdrop node at all — DOM unchanged', () => {
    render(<PreviewPlayer timeline={filledStill()} />)
    expect(screen.queryByTestId('preview-backfill-color')).not.toBeInTheDocument()
    expect(screen.queryByTestId('preview-backfill-blur')).not.toBeInTheDocument()
    expect(screen.getByTestId('preview-image-card').firstElementChild).toBe(
      screen.getByTestId('preview-image'),
    )
  })

  it('a video entry renders its backdrop inside the primary layer card', () => {
    render(<PreviewPlayer timeline={videoWithFill({ kind: 'color', color: '#000000' })} />)
    const card = screen.getByTestId('preview-video-card')
    expect(card.firstElementChild).toBe(screen.getByTestId('preview-backfill-color'))
    // The media element still follows inside the same card.
    expect(card.contains(screen.getByTestId('preview-video'))).toBe(true)
  })

  it('fill never shapes the frame: the aspect matches the fill-free value', async () => {
    vi.stubGlobal('Image', InstantLandscapeImage)
    try {
      const { container, rerender } = render(<PreviewPlayer timeline={filledStill()} />)
      await act(async () => {})
      const stage = () => container.querySelector('.preview-stage') as HTMLElement
      const bare = stage().style.getPropertyValue('--preview-aspect')
      expect(bare).toBe(String(800 / 450))
      rerender(<PreviewPlayer timeline={filledStill({ kind: 'blur' })} />)
      await act(async () => {})
      // The output-frame rule (#176) never consults the fill — a backdrop
      // fills whatever bars the rule leaves, it never shapes the frame.
      expect(stage().style.getPropertyValue('--preview-aspect')).toBe(bare)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('overlay shape mask (#266)', () => {
  const maskedTimeline = (
    shapeMask?: NonNullable<TimelineState['videoOverlays']>[number]['shapeMask'],
  ): TimelineState => ({
    entries: [
      {
        id: 'e1',
        clipId: 'c1',
        name: 'base.webm',
        duration: 10,
        url: 'blob:base',
        inPoint: 0,
        outPoint: 10,
      },
    ],
    videoOverlays: [
      {
        id: 'v1',
        clipId: 'c2',
        name: 'cam.webm',
        duration: 8,
        url: 'blob:cam',
        offset: 0,
        inPoint: 0,
        outPoint: 8,
        x: 0.6,
        y: 0.55,
        width: 0.35,
        height: 0.4,
        ...(shapeMask === undefined ? {} : { shapeMask }),
      },
    ],
  })

  const card = () => screen.getByTestId('preview-overlay-card-0')

  it('an ellipse mask clips the overlay card to the inscribed ellipse', () => {
    render(<PreviewPlayer timeline={maskedTimeline({ kind: 'ellipse' })} />)
    expect(card().style.clipPath).toBe('ellipse(50% 50% at 50% 50%)')
  })

  it('a rounded mask clips by the shared rule in frame-container units', () => {
    render(<PreviewPlayer timeline={maskedTimeline({ kind: 'rounded', radius: 0.2 })} />)
    // 0.2 of the shorter card side: the card is 0.35 frame-widths by 0.4
    // frame-heights, so min(0.2·35cqw, 0.2·40cqh) — the shared maskClipPath.
    expect(card().style.clipPath).toBe('inset(0 round min(7cqw, 8cqh))')
  })

  it('a mask-free overlay card styles no clip-path at all — DOM unchanged', () => {
    render(<PreviewPlayer timeline={maskedTimeline()} />)
    expect(card().style.clipPath).toBe('')
    expect(card().getAttribute('style')).not.toContain('clip-path')
  })
})

describe('transition handovers (#318)', () => {
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
  const still = {
    id: 's1',
    clipId: 'i1',
    name: 'logo.png',
    duration: 5,
    url: 'blob:logo',
    inPoint: 0,
    outPoint: 5,
    kind: 'image' as const,
  }
  /** The outgoing video of the video→video case, rotated so its looks are visible. */
  const rotated = {
    id: 'r1',
    clipId: 'c0',
    name: 'rotated.webm',
    duration: 5,
    url: 'blob:rotated',
    inPoint: 0,
    outPoint: 5,
    orientation: { rotation: 180 as const },
  }
  const incoming = {
    id: 'v1',
    clipId: 'c1',
    name: 'second.webm',
    duration: 4,
    url: 'blob:second',
    inPoint: 0,
    outPoint: 4,
  }

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

  /**
   * Plays a 5s-outgoing / 1s-crossfade sequence into the overlap [4, 5), then
   * hands over with the incoming element's clock 50ms short of the geometric
   * handover point — the drift that made #61's flash, and this one.
   */
  const handOverWithLaggingClock = (outgoing: TimelineState['entries'][number]) => {
    const timeline: TimelineState = {
      entries: [outgoing, incoming],
      transitions: [{ beforeId: outgoing.id, afterId: 'v1', type: 'crossfade', duration: 1 }],
    }
    render(<PreviewPlayer timeline={timeline} />)
    fireEvent.click(screen.getByRole('button', { name: 'Play preview' }))

    // Mid-overlap: the incoming clip is engaged in the secondary slot.
    const outgoingIsStill = outgoing.kind === 'slate' || outgoing.kind === 'image'
    if (outgoingIsStill) {
      now = 4500
    } else {
      ;(screen.getByTestId('preview-video') as HTMLVideoElement).currentTime = 4.5
    }
    runTick()
    const secondary = screen.getByTestId('preview-video-incoming') as HTMLVideoElement

    // The overlap ends, and the promoted element's own clock lags 1.0s by 50ms.
    secondary.currentTime = 0.95
    if (outgoingIsStill) {
      now = 5000
    } else {
      ;(screen.getByTestId('preview-video') as HTMLVideoElement).currentTime = 5
    }
    runTick()
  }

  it('a slate is not repainted over the incoming clip after the handover', () => {
    handOverWithLaggingClock(slate)

    // The slate's turn is over: with the transition finished it would carry
    // no transition style at all, so painting it would cover the whole frame.
    expect(screen.queryByTestId('preview-slate')).toBeNull()
    expect(screen.queryByTestId('preview-slate-incoming')).toBeNull()
    expect(screen.getByTestId('preview-video')).toBeInTheDocument()
    expect(screen.getByTestId('preview-now-playing')).toHaveTextContent(
      'Clip 2 of 2: second.webm',
    )
  })

  it('an image still is not repainted over the incoming clip after the handover', () => {
    handOverWithLaggingClock(still)

    expect(screen.queryByTestId('preview-image-card')).toBeNull()
    expect(screen.queryByTestId('preview-image-incoming-card')).toBeNull()
    expect(screen.getByTestId('preview-video')).toBeInTheDocument()
    expect(screen.getByTestId('preview-now-playing')).toHaveTextContent(
      'Clip 2 of 2: second.webm',
    )
  })

  it("the promoted element wears the incoming entry's looks, not the outgoing entry's", () => {
    handOverWithLaggingClock(rotated)

    // The incoming entry carries no orientation; before the fix the fronting
    // layer was still resolved to the outgoing entry, so its 180° rotation
    // was applied to the clip now playing.
    expect(screen.getByTestId('preview-video').style.transform).toBe('')
    expect(screen.getByTestId('preview-now-playing')).toHaveTextContent(
      'Clip 2 of 2: second.webm',
    )
  })

  it('an edit while mid-sequence fronts the entry the clamped position lands on', () => {
    const timeline: TimelineState = {
      entries: [slate, incoming],
      transitions: [{ beforeId: 'sl1', afterId: 'v1', type: 'crossfade', duration: 1 }],
    }
    const { rerender } = render(<PreviewPlayer timeline={timeline} />)
    fireEvent.click(screen.getByRole('button', { name: 'Play preview' }))
    now = 6000
    runTick()
    expect(screen.getByTestId('preview-now-playing')).toHaveTextContent(
      'Clip 2 of 2: second.webm',
    )

    // The timeline is replaced under the player: position 6 now falls in the
    // *first* entry. The index the player had cued is stale, and must not
    // drag the fronted entry forward to the second one.
    const edited: TimelineState = {
      entries: [
        { ...incoming, id: 'x1', name: 'long.webm', url: 'blob:long', duration: 10, outPoint: 10 },
        { ...incoming, id: 'y1', name: 'after.webm', url: 'blob:after' },
      ],
    }
    rerender(<PreviewPlayer timeline={edited} />)
    expect(screen.getByTestId('preview-now-playing')).toHaveTextContent('Clip 1 of 2: long.webm')
  })

  it('scrubbing backwards into an overlap still renders the transition', () => {
    const timeline: TimelineState = {
      entries: [slate, incoming],
      transitions: [{ beforeId: 'sl1', afterId: 'v1', type: 'crossfade', duration: 1 }],
    }
    render(<PreviewPlayer timeline={timeline} />)
    fireEvent.click(screen.getByRole('button', { name: 'Play preview' }))
    now = 6000
    runTick()
    expect(screen.queryByTestId('preview-slate')).toBeNull()

    // Seeking back into the overlap cues the outgoing entry again, so the
    // guard must not hold the playhead forward.
    fireEvent.change(screen.getByRole('slider', { name: 'Seek within sequence' }), {
      target: { value: '4.5' },
    })
    expect(screen.getByTestId('preview-slate')).toBeInTheDocument()
    expect(screen.getByTestId('preview-video-incoming-card')).toHaveStyle({ opacity: '0.5' })
    expect(screen.getByTestId('preview-now-playing')).toHaveTextContent(
      'Clip 1 of 2: Color slate → second.webm (crossfade)',
    )
  })
})

// Preview parity for the export defect in #319. The export used to delete an
// overlay layer from a frame whose replay element could not supply a picture;
// the preview cannot, because overlay visibility here is declarative from the
// published time and the element is a real <video> that keeps showing its
// last decoded frame. These tests are the reference behavior the export is
// now held to — they pass before and after the export fix, by design.
describe('overlay parity across a transition handover (#319)', () => {
  const videoA = {
    id: 'a1',
    clipId: 'c1',
    name: 'first.webm',
    duration: 5,
    url: 'blob:first',
    inPoint: 0,
    outPoint: 5,
  }
  const slateB = {
    id: 'sl1',
    clipId: '',
    name: 'Color slate',
    duration: 2,
    url: '',
    inPoint: 0,
    outPoint: 2,
    kind: 'slate' as const,
    color: '#ff0000',
  }
  /** Overlay C: covers the whole sequence, so every frame owes it a picture. */
  const cover = {
    id: 'ov1',
    clipId: 'c2',
    name: 'over.webm',
    duration: 10,
    url: 'blob:over',
    offset: 0,
    inPoint: 0,
    outPoint: 10,
    x: 0.62,
    y: 0.62,
    width: 0.35,
    height: 0.35,
  }
  const timeline: TimelineState = {
    entries: [videoA, slateB],
    transitions: [{ beforeId: 'a1', afterId: 'sl1', type: 'crossfade', duration: 0.5 }],
    videoOverlays: [cover],
  }

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
  const card = () => screen.getByTestId('preview-overlay-card-0')
  const shown = () => !card().className.includes('preview-overlay-hidden')

  it('the overlay is on screen on both sides of the handover into a slate', () => {
    render(<PreviewPlayer timeline={timeline} />)
    fireEvent.click(screen.getByRole('button', { name: 'Play preview' }))
    const primary = screen.getByTestId('preview-video') as HTMLVideoElement

    // Before the overlap, inside it, and after the handover — the slate is
    // fronting by the last of these, which is the customer's instant.
    primary.currentTime = 3
    runTick()
    expect(shown()).toBe(true)

    primary.currentTime = 4.75
    runTick()
    expect(shown()).toBe(true)
    expect(screen.getByTestId('preview-slate-incoming')).toBeInTheDocument()

    primary.currentTime = 5
    runTick()
    now = 1000
    runTick()
    expect(screen.getByTestId('preview-slate')).toBeInTheDocument()
    expect(shown()).toBe(true)
  })

  it('the overlay stays on screen while its element cannot supply a frame', () => {
    render(<PreviewPlayer timeline={timeline} />)
    fireEvent.click(screen.getByRole('button', { name: 'Play preview' }))

    // A seeking or re-buffering element reports HAVE_METADATA. The preview
    // does not consult readiness at all: the element stays mounted and its
    // card stays visible, and the browser goes on displaying the last frame
    // it decoded. That indifference is what the export now matches — there,
    // the composed frame keeps the layer by drawing its stand-in.
    vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(
      HTMLMediaElement.HAVE_METADATA,
    )
    const primary = screen.getByTestId('preview-video') as HTMLVideoElement
    primary.currentTime = 4.75
    runTick()

    expect(shown()).toBe(true)
    expect(screen.getByTestId('preview-overlay-0')).toHaveAttribute('src', 'blob:over')
  })
})

describe('freeze frame control (#379)', () => {
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

  it('rides the transport beside Save frame, with the placement choice', () => {
    render(<PreviewPlayer timeline={oneEntry} onFreezeFrame={() => {}} />)
    const button = screen.getByTestId('preview-freeze-frame')
    expect(button).toBeEnabled()
    expect(button).toHaveTextContent('Freeze frame')
    // The UI copy states the snapshot semantics (#316's tradeoff): a freeze
    // is the composition at this instant, never a live reference.
    expect(button).toHaveAttribute('title', expect.stringContaining('not a live reference'))
    const placement = screen.getByRole('combobox', { name: 'Freeze frame placement' })
    // Split & hold is the default (#316); append is the other offered mode.
    expect(placement).toHaveValue('split')
    fireEvent.change(placement, { target: { value: 'append' } })
    expect(placement).toHaveValue('append')
  })

  it('disables without App wiring, like Split', () => {
    render(<PreviewPlayer timeline={oneEntry} />)
    expect(screen.getByTestId('preview-freeze-frame')).toBeDisabled()
  })

  it('renders no freeze control while the timeline is empty — no frame, no transport', () => {
    render(<PreviewPlayer timeline={{ entries: [] }} onFreezeFrame={() => {}} />)
    expect(screen.queryByTestId('preview-freeze-frame')).not.toBeInTheDocument()
  })
})

describe('image overlay layers in the preview (#294)', () => {
  // A 10s base entry with a still overlay showing over sequence [2, 5).
  const baseEntry = {
    id: 'e1',
    clipId: 'c1',
    name: 'first.webm',
    duration: 10,
    url: 'blob:first',
    inPoint: 0,
    outPoint: 10,
  }
  const logo = {
    id: 'i1',
    kind: 'image' as const,
    clipId: 'c2',
    name: 'logo.png',
    duration: 3,
    url: 'blob:logo',
    offset: 2,
    inPoint: 0,
    outPoint: 3,
    x: 0.6,
    y: 0.55,
    width: 0.35,
    height: 0.4,
  }
  const withStill: TimelineState = { entries: [baseEntry], videoOverlays: [logo] }

  const seekTo = (value: string) =>
    fireEvent.change(screen.getByRole('slider', { name: 'Seek within sequence' }), {
      target: { value },
    })

  it('renders the still as an <img> at its rectangle, only within its window', () => {
    render(<PreviewPlayer timeline={withStill} />)
    const media = screen.getByTestId('preview-overlay-0')
    // An <img>, not a <video>: there is nothing to play, and a <video> would
    // never decode a PNG.
    expect(media.tagName).toBe('IMG')
    expect(media).toHaveAttribute('src', 'blob:logo')
    // The card is the fractional rectangle, exactly as a video overlay's.
    const card = () => screen.getByTestId('preview-overlay-card-0')
    expect(parseFloat(card().style.left)).toBeCloseTo(60, 10)
    expect(parseFloat(card().style.top)).toBeCloseTo(55, 10)
    expect(parseFloat(card().style.width)).toBeCloseTo(35, 10)
    expect(parseFloat(card().style.height)).toBeCloseTo(40, 10)

    // Its window is offset + duration, half-open at the end like every lane.
    expect(card().className).toContain('preview-overlay-hidden')
    seekTo('2')
    expect(card().className).not.toContain('preview-overlay-hidden')
    seekTo('4.9')
    expect(card().className).not.toContain('preview-overlay-hidden')
    seekTo('5')
    expect(card().className).toContain('preview-overlay-hidden')
  })

  it('paints no background behind the still, so a transparent PNG shows the base through', () => {
    render(<PreviewPlayer timeline={withStill} />)
    seekTo('3')
    // Alpha is the whole point of a logo or a sticker: the card must not
    // introduce a backdrop, and the image must letterbox rather than
    // stretch (object-fit lives in the shared .preview-media class).
    const card = screen.getByTestId('preview-overlay-card-0')
    expect(card.style.background).toBe('')
    expect(card.style.backgroundColor).toBe('')
    expect(screen.getByTestId('preview-overlay-0').className).toContain('preview-media')
  })

  it('carries the picture treatments into the rendered style', () => {
    render(
      <PreviewPlayer
        timeline={{
          entries: [baseEntry],
          videoOverlays: [{ ...logo, colorAdjustments: { saturation: 0 }, crop: { top: 0.1 } }],
        }}
      />,
    )
    seekTo('3')
    const media = screen.getByTestId('preview-overlay-0')
    // The still goes through the same style pipeline a video overlay does:
    // colour as a CSS filter, crop and orientation through
    // croppedOrientedMediaStyle (whose geometry needs a decoded source
    // aspect, so its own unit tests pin the numbers — here what matters is
    // that a still is not routed around it).
    expect(media.style.filter).toBe('saturate(0%)')
  })

  it('stacks with video overlays in add order, one card each', () => {
    const pip = {
      id: 'v1', clipId: 'c3', name: 'cam.webm', duration: 8, url: 'blob:cam',
      offset: 0, inPoint: 0, outPoint: 8, x: 0.05, y: 0.05, width: 0.3, height: 0.3,
    }
    render(<PreviewPlayer timeline={{ entries: [baseEntry], videoOverlays: [pip, logo] }} />)
    seekTo('3')
    // One lane, one paint order: the later-added still draws over the video
    // layer, which is what a watermark needs.
    expect(screen.getByTestId('preview-overlay-0').tagName).toBe('VIDEO')
    expect(screen.getByTestId('preview-overlay-1').tagName).toBe('IMG')
  })
})
