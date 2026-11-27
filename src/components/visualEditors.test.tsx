import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentType } from 'react'
import { lazyEditor } from './visualEditors'

/**
 * The loader behind the six visual editors (#537), tested on its own rather
 * than through an editor, because what is under test is the module cache and
 * not any editor's behaviour: a real chunk always resolves in jsdom, so the
 * failure path has no other way in.
 *
 * #568 is the case these cover. The first version cached the load promise
 * with `??=` and so cached a rejection too — a chunk lost once left the
 * dialog blank for the rest of the page's life, with no retry and no
 * message.
 */

type Props = { onClose: () => void }

function RealEditor({ onClose }: Props) {
  return (
    <div role="dialog" aria-label="the loaded editor">
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  )
}
const loaded = RealEditor as ComponentType<Props>

/** A loader that fails until `failing` is set false, counting its calls. */
const flakyLoader = () => {
  const state = { failing: true }
  const load = vi.fn(() =>
    state.failing ? Promise.reject(new Error('chunk gone')) : Promise.resolve(loaded),
  )
  return { state, load }
}

describe("the visual editors' lazy loader (#537, #568)", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not cache a rejected load — the next attempt refetches', async () => {
    const { state, load } = flakyLoader()
    const { preload } = lazyEditor('test', load)

    await expect(preload()).rejects.toThrow('chunk gone')
    // The poisoned-cache bug: with `loading ??=` holding the rejected
    // promise, this second call would re-await the same failure and the
    // loader would never be called again.
    state.failing = false
    await expect(preload()).resolves.toBeUndefined()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('caches a successful load — a second preload does not refetch', async () => {
    const { state, load } = flakyLoader()
    state.failing = false
    const { preload } = lazyEditor('test', load)

    await preload()
    await preload()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('renders the failure as a dialog rather than nothing, naming the editor', async () => {
    const { load } = flakyLoader()
    const { Editor } = lazyEditor('crop', load)
    render(<Editor onClose={vi.fn()} />)

    // The #568 bug was that this rendered nothing at all, so the dialog's
    // presence is the assertion a regression breaks.
    const failed = await screen.findByRole('dialog', { name: 'The crop editor could not load' })
    expect(failed).toBeInTheDocument()
    expect(failed).toHaveTextContent('The crop editor could not load')
    expect(screen.queryByRole('dialog', { name: 'the loaded editor' })).toBeNull()

    // Two remedies (#993): Try again, which works where the browser fetches
    // a failed module again, and Reload the page, which works everywhere
    // (measured in e2e/visual-editor-load-failure.spec.ts). That the button
    // reloads is that spec's to prove — jsdom does not navigate.
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Reload the page' })).toBeInTheDocument()
  })

  it('Try again opens the editor when the load succeeds this time (#993)', async () => {
    const { state, load } = flakyLoader()
    const { Editor } = lazyEditor('crop', load)
    render(<Editor onClose={vi.fn()} />)

    await screen.findByRole('dialog', { name: 'The crop editor could not load' })
    state.failing = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('dialog', { name: 'the loaded editor' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'The crop editor could not load' })).toBeNull()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('a Try again that fails too keeps the dialog, points at Reload, and gives ✕ focus back (#993)', async () => {
    const { load } = flakyLoader()
    const { Editor } = lazyEditor('crop', load)
    render(<Editor onClose={vi.fn()} />)

    const failed = await screen.findByRole('dialog', { name: 'The crop editor could not load' })
    expect(failed).not.toHaveTextContent('still')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    // The same dialog, a different sentence: the attempt was made and failed.
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'The crop editor still could not load. Reloading the page fetches it again.',
      ),
    )
    expect(screen.queryByRole('dialog', { name: 'the loaded editor' })).toBeNull()
    expect(load).toHaveBeenCalledTimes(2)
    // Polled for the reason the focus test below gives: a passive effect.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close the crop editor' })).toHaveFocus())
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
  })

  it('keeps the dialog up while Try again runs, with the button disabled (#993)', async () => {
    const { load } = flakyLoader()
    const { Editor } = lazyEditor('crop', load)
    render(<Editor onClose={vi.fn()} />)
    await screen.findByRole('dialog', { name: 'The crop editor could not load' })

    let settle: (component: ComponentType<Props>) => void = () => {}
    load.mockImplementationOnce(
      () =>
        new Promise<ComponentType<Props>>((resolve) => {
          settle = resolve
        }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    // Nothing flashes away while the import runs, and a second press cannot
    // start a second attempt.
    expect(screen.getByRole('dialog', { name: 'The crop editor could not load' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDisabled()

    settle(loaded)
    expect(await screen.findByRole('dialog', { name: 'the loaded editor' })).toBeInTheDocument()
  })

  it('renders the editor once its module is in hand', async () => {
    const { state, load } = flakyLoader()
    state.failing = false
    const { Editor } = lazyEditor('crop', load)
    render(<Editor onClose={vi.fn()} />)

    expect(await screen.findByRole('dialog', { name: 'the loaded editor' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'The crop editor could not load' })).toBeNull()
  })

  it('offers a way out of the failure: ✕ calls the editor’s own onClose', async () => {
    const { load } = flakyLoader()
    const { Editor } = lazyEditor('zoom', load)
    const onClose = vi.fn()
    render(<Editor onClose={onClose} />)

    await screen.findByRole('dialog', { name: 'The zoom editor could not load' })
    await userEvent.click(screen.getByRole('button', { name: 'Close the zoom editor' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('takes focus on ✕ and closes on Escape, as its own tooltip promises', async () => {
    const { load } = flakyLoader()
    const { Editor } = lazyEditor('crop', load)
    const onClose = vi.fn()
    render(<Editor onClose={onClose} />)

    await screen.findByRole('dialog', { name: 'The crop editor could not load' })
    // The ✕ reads `Close (Esc)`, copied from the six editors — whose own
    // Escape handlers are inside the chunk that just failed to arrive. Found
    // in review of #570: the tooltip named a key nothing listened for. Focus
    // is half of it, because the handler is on the dialog.
    // The panel focuses ✕ in a passive effect after the commit that shows
    // it, so findByRole can resolve in between: retry the read rather than
    // take it once (#624, quality-and-ci.md's "never read a value once").
    const close = screen.getByRole('button', { name: 'Close the crop editor' })
    await waitFor(() => expect(close).toHaveFocus())

    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders nothing while the load is still in flight', () => {
    let settle: (component: ComponentType<Props>) => void = () => {}
    const load = vi.fn(
      () =>
        new Promise<ComponentType<Props>>((resolve) => {
          settle = resolve
        }),
    )
    const { Editor } = lazyEditor('spotlight', load)
    const { container } = render(<Editor onClose={vi.fn()} />)

    // No placeholder and no failure dialog: the editor was not on screen a
    // moment before, and a few kB would flash rather than inform (#537).
    expect(container).toBeEmptyDOMElement()
    settle(loaded)
  })
})
