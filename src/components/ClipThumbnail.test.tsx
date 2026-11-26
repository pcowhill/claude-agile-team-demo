import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ClipThumbnail } from './ClipThumbnail'

// jsdom decodes no video, so the capture is injected; the real capture path
// runs in the e2e suite (e2e/thumbnails.spec.ts).
const resolved = (dataUrl: string | null) => () => Promise.resolve(dataUrl)

describe('ClipThumbnail (#193)', () => {
  it('renders the captured frame once it resolves, hidden from assistive tech', async () => {
    render(
      <ClipThumbnail
        url="blob:clip"
        inPoint={0}
        data-testid="thumb"
        thumbnailFor={resolved('data:image/jpeg;base64,frame')}
      />,
    )
    const image = await screen.findByTestId('thumb')
    expect(image).toHaveAttribute('src', 'data:image/jpeg;base64,frame')
    expect(image).toHaveAttribute('aria-hidden', 'true')
    expect(image).toHaveAttribute('alt', '')
  })

  it('holds the thumbnail\'s box while capturing, and renders nothing for clips that cannot be captured (#967)', async () => {
    const { rerender } = render(
      <ClipThumbnail
        url="blob:pending"
        inPoint={0}
        data-testid="thumb"
        thumbnailFor={() => new Promise<string | null>(() => {})}
      />,
    )
    expect(screen.queryByTestId('thumb')).not.toBeInTheDocument()
    // The same class as the image, so the same 64 × 36 box: the row keeps
    // its height while the frame is captured.
    const pending = screen.getByTestId('thumb-pending')
    expect(pending).toHaveClass('clip-thumbnail')
    expect(pending).toHaveAttribute('aria-hidden', 'true')

    rerender(
      <ClipThumbnail
        url="blob:uncapturable"
        inPoint={0}
        data-testid="thumb"
        thumbnailFor={resolved(null)}
      />,
    )
    await waitFor(() => expect(screen.queryByTestId('thumb-pending')).not.toBeInTheDocument())
    expect(screen.queryByTestId('thumb')).not.toBeInTheDocument()
  })

  it('re-captures when the in-point changes and never shows the stale frame meanwhile', async () => {
    let release: (dataUrl: string | null) => void = () => {}
    const captures: number[] = []
    const thumbnailFor = (_url: string, inPoint: number) => {
      captures.push(inPoint)
      if (inPoint === 0) return Promise.resolve<string | null>('data:first-frame')
      return new Promise<string | null>((resolve) => {
        release = resolve
      })
    }
    const { rerender } = render(
      <ClipThumbnail url="blob:clip" inPoint={0} data-testid="thumb" thumbnailFor={thumbnailFor} />,
    )
    await screen.findByTestId('thumb')

    rerender(
      <ClipThumbnail url="blob:clip" inPoint={2} data-testid="thumb" thumbnailFor={thumbnailFor} />,
    )
    // The re-trim replaces the old frame with the empty box rather than
    // keeping it; the new capture fills the box in when it lands.
    expect(screen.queryByTestId('thumb')).not.toBeInTheDocument()
    expect(screen.getByTestId('thumb-pending')).toHaveClass('clip-thumbnail')
    release('data:retrimmed-frame')
    const image = await screen.findByTestId('thumb')
    expect(image).toHaveAttribute('src', 'data:retrimmed-frame')
    expect(screen.queryByTestId('thumb-pending')).not.toBeInTheDocument()
    expect(captures).toEqual([0, 2])
  })
})
