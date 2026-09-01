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

  it('renders nothing while capturing and for clips that cannot be captured', async () => {
    const { rerender } = render(
      <ClipThumbnail
        url="blob:pending"
        inPoint={0}
        data-testid="thumb"
        thumbnailFor={() => new Promise<string | null>(() => {})}
      />,
    )
    expect(screen.queryByTestId('thumb')).not.toBeInTheDocument()

    rerender(
      <ClipThumbnail
        url="blob:uncapturable"
        inPoint={0}
        data-testid="thumb"
        thumbnailFor={resolved(null)}
      />,
    )
    await waitFor(() => expect(screen.queryByTestId('thumb')).not.toBeInTheDocument())
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
    // The re-trim resets the row to no-thumbnail rather than keeping the old
    // frame; the new capture fills it in when it lands.
    expect(screen.queryByTestId('thumb')).not.toBeInTheDocument()
    release('data:retrimmed-frame')
    const image = await screen.findByTestId('thumb')
    expect(image).toHaveAttribute('src', 'data:retrimmed-frame')
    expect(captures).toEqual([0, 2])
  })
})
