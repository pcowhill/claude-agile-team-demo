import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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

    // The remedy is a reload, not a retry: a browser caches a module whose
    // fetch failed, so re-importing the same specifier re-rejects without a
    // request (measured in e2e/visual-editor-load-failure.spec.ts). That the
    // button reloads is that spec's to prove — jsdom does not navigate.
    expect(screen.getByRole('button', { name: 'Reload the page' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
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
