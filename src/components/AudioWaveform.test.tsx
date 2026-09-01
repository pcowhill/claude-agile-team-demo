import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { AudioWaveform } from './AudioWaveform'

// jsdom has no Web Audio or blob fetch, so the peak source is injected; the
// real decode path runs in the e2e suite (e2e/timeline-audio.spec.ts).
const resolvedPeaks = (peaks: number[]) => () =>
  Promise.resolve<Float32Array | null>(new Float32Array(peaks))

describe('AudioWaveform (#191)', () => {
  it('renders the waveform once peaks resolve', async () => {
    render(
      <AudioWaveform
        url="blob:tone"
        duration={4}
        inPoint={0}
        outPoint={4}
        data-testid="waveform"
        peaksFor={resolvedPeaks([0.1, 0.9, 0.4, 0.2])}
      />,
    )
    const svg = await screen.findByTestId('waveform')
    expect(svg.getAttribute('viewBox')).toBe('0 0 4 2')
    expect(svg.querySelector('path')?.getAttribute('d')).toMatch(/^M0 1L.*Z$/)
  })

  it('windows the peaks to the trim', async () => {
    render(
      <AudioWaveform
        url="blob:tone"
        duration={4}
        inPoint={1}
        outPoint={3}
        data-testid="waveform"
        peaksFor={resolvedPeaks([0.1, 0.9, 0.4, 0.2])}
      />,
    )
    // Two of the four source buckets survive the [1, 3] window of 4s.
    const svg = await screen.findByTestId('waveform')
    expect(svg.getAttribute('viewBox')).toBe('0 0 2 2')
  })

  it('renders nothing while peaks compute and for clips that fail to decode', async () => {
    const { rerender } = render(
      <AudioWaveform
        url="blob:pending"
        duration={4}
        inPoint={0}
        outPoint={4}
        data-testid="waveform"
        peaksFor={() => new Promise<Float32Array | null>(() => {})}
      />,
    )
    expect(screen.queryByTestId('waveform')).not.toBeInTheDocument()

    rerender(
      <AudioWaveform
        url="blob:undecodable"
        duration={4}
        inPoint={0}
        outPoint={4}
        data-testid="waveform"
        peaksFor={() => Promise.resolve<Float32Array | null>(null)}
      />,
    )
    await waitFor(() => expect(screen.queryByTestId('waveform')).not.toBeInTheDocument())
  })
})
