import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { trimFramesFor } from '../lib/trimFrames'
import { TrimDialog } from './TrimDialog'

/**
 * The Trim window's frame row (#708), on the component: the window never
 * waits for the frames, and reopening it on the same clip decodes nothing.
 * That the frames are the clip's own, and where the row sits, needs a real
 * browser: `e2e/trim-frames.spec.ts`.
 */
describe('the Trim window’s frame row (#708)', () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())
    vi.stubGlobal('requestAnimationFrame', () => 1)
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const peaksFor = () => Promise.resolve(new Float32Array([0.2, 0.8, 0.5, 0.3]))
  const props = (url: string) => ({
    entry: { name: 'a.mp4', url, duration: 10, inPoint: 0, outPoint: 10 },
    position: 'a.mp4 at position 1',
    stepSeconds: 0.1,
    largeStepSeconds: 1,
    onClose: () => {},
    peaksFor,
  })

  it('works before any frame has arrived: a clamp moves, and Apply writes it', async () => {
    const onApply = vi.fn()
    // Held back for the whole test: the frames never arrive.
    const framesFor = vi.fn(() => new Promise<(string | null)[]>(() => {}))
    render(<TrimDialog {...props('blob:held')} onApply={onApply} framesFor={framesFor} />)
    expect(framesFor).toHaveBeenCalledWith('blob:held', 10)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByTestId('trim-frames')).toBeNull()

    const inClamp = within(dialog).getByRole('slider', { name: 'In clamp' })
    inClamp.focus()
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}')
    expect(inClamp).toHaveAttribute('aria-valuenow', '1')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }))
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith(1, 10)
  })

  it('decodes a clip’s frames once: closing and reopening the window on it captures nothing new', async () => {
    let decoded = 0
    const capture = (_url: string, times: number[]) => {
      decoded += times.length
      return Promise.resolve(times.map((time) => `data:image/jpeg;base64,frame-${time}`))
    }
    const framesFor = (url: string, duration: number) => trimFramesFor(url, duration, capture)

    const first = render(<TrimDialog {...props('blob:reopened')} onApply={() => {}} framesFor={framesFor} />)
    expect(await screen.findAllByTestId('trim-frame')).toHaveLength(20)
    expect(decoded).toBe(20)
    first.unmount()

    render(<TrimDialog {...props('blob:reopened')} onApply={() => {}} framesFor={framesFor} />)
    expect(await screen.findAllByTestId('trim-frame')).toHaveLength(20)
    expect(decoded).toBe(20)
  })

  it('shows no row for a clip none of whose frames could be drawn', async () => {
    const framesFor = vi.fn(() => Promise.resolve(Array<string | null>(20).fill(null)))
    render(<TrimDialog {...props('blob:undecodable')} onApply={() => {}} framesFor={framesFor} />)
    await vi.waitFor(() => expect(framesFor).toHaveBeenCalled())
    await Promise.resolve()
    expect(screen.queryByTestId('trim-frames')).toBeNull()
    expect(screen.getByRole('slider', { name: 'In clamp' })).toBeInTheDocument()
  })
})
