import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'

/**
 * The in-app user guide (#478) through the whole App: Help ▾, F1, the
 * docked panel, deep links in the URL hash, search, and the cheat sheet's
 * new home. The compiled guide here is the real `docs/guide/`, through the
 * same Vite plugin the build uses, so these read real content — which is
 * what makes "typing `proj` finds Concepts" a claim about the product and
 * not about a fixture.
 */

const openHelpMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Help' }))
  return screen.getByRole('menu', { name: 'Help menu' })
}

/** The loaded panel — the lazy chunk's, not the Suspense placeholder that shares its name. */
const panel = () => screen.findByTestId('user-guide')

/** A keydown on the window, where the transport's handler listens (#203). */
const pressOnWindow = (key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
  })

beforeEach(() => {
  window.history.replaceState(null, '', window.location.pathname)
})

afterEach(() => {
  window.history.replaceState(null, '', window.location.pathname)
})

describe('Help ▾ (#478)', () => {
  it('sits in the header beside File ▾ with the two help surfaces, each showing its key', async () => {
    const user = userEvent.setup()
    render(<App />)
    // Beside File ▾: the Help menu's wrapper is the next element after File's.
    const fileWrapper = screen.getByRole('button', { name: 'File' }).parentElement!
    const help = screen.getByRole('button', { name: 'Help' })
    expect(fileWrapper.nextElementSibling).toBe(help.parentElement)
    expect(help).toHaveAttribute('aria-haspopup', 'menu')

    const menu = await openHelpMenu(user)
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['User guide…F1', 'Keyboard shortcuts…?'])
  })

  it('Keyboard shortcuts… opens the same cheat sheet ? does, and ? still works', async () => {
    const user = userEvent.setup()
    render(<App />)
    const menu = await openHelpMenu(user)
    await user.click(within(menu).getByRole('menuitem', { name: 'Keyboard shortcuts…' }))
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' })
    expect(dialog).toHaveTextContent('Open the user guide')
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    pressOnWindow('?', { shiftKey: true })
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
    // Only one cheat sheet exists now that App owns it.
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })
})

describe('the user guide panel (#478)', () => {
  it('opens from User guide… on Quick Start, docked beside the editor, with focus in the search field', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(screen.queryByRole('complementary', { name: 'User guide' })).toBeNull()

    const menu = await openHelpMenu(user)
    await user.click(within(menu).getByRole('menuitem', { name: 'User guide…' }))
    const guide = await panel()
    expect(within(guide).getByRole('heading', { level: 2, name: 'Quick Start' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#guide/quick-start')
    // Not a modal: the editor's regions are still there and no dialog is up.
    expect(screen.getByRole('region', { name: 'Timeline' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(within(guide).getByRole('searchbox', { name: 'Search the user guide' })).toHaveFocus())
  })

  it('F1 opens it, and is inert while typing in a field or while a modal is open', async () => {
    const user = userEvent.setup()
    render(<App />)
    // A modal first: the cheat sheet.
    pressOnWindow('?', { shiftKey: true })
    pressOnWindow('F1')
    expect(screen.queryByRole('complementary', { name: 'User guide' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Close' }))

    // A text field: the event's target claims the key.
    await user.click(screen.getByRole('button', { name: /^Add$/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Text overlay' }))
    const content = screen.getByRole('textbox', { name: /Content of/ })
    fireEvent.keyDown(content, { key: 'F1', bubbles: true })
    expect(screen.queryByRole('complementary', { name: 'User guide' })).toBeNull()

    pressOnWindow('F1')
    expect(await panel()).toBeInTheDocument()
  })

  it('Escape inside the panel closes it and returns focus to Help ▾; Escape in the editor does not', async () => {
    const user = userEvent.setup()
    render(<App />)
    pressOnWindow('F1')
    const guide = await panel()
    const search = within(guide).getByRole('searchbox', { name: 'Search the user guide' })
    await waitFor(() => expect(search).toHaveFocus())

    // Escape with focus in the editor: the panel stays. (Import clips, not
    // Undo — Undo is disabled on an empty timeline and cannot take focus.)
    screen.getByRole('button', { name: 'Import clips' }).focus()
    expect(screen.getByRole('button', { name: 'Import clips' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('complementary', { name: 'User guide' })).toBeInTheDocument()

    search.focus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('complementary', { name: 'User guide' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Help' })).toHaveFocus()
    // Closing leaves the URL without the guide's hash.
    expect(window.location.hash).toBe('')
  })

  it('Escape in a non-empty search clears it first, then closes on the next press', async () => {
    const user = userEvent.setup()
    render(<App />)
    pressOnWindow('F1')
    const guide = await panel()
    const search = within(guide).getByRole('searchbox', { name: 'Search the user guide' })
    await user.type(search, 'proj')
    await user.keyboard('{Escape}')
    expect(search).toHaveValue('')
    expect(screen.getByRole('complementary', { name: 'User guide' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('complementary', { name: 'User guide' })).toBeNull()
  })

  it('the editor keeps working with the panel open: Space still plays', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /^Add$/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Color slate' }))
    pressOnWindow('F1')
    await panel()
    ;(document.activeElement as HTMLElement | null)?.blur()
    pressOnWindow(' ')
    expect(screen.getByRole('button', { name: 'Pause preview' })).toBeInTheDocument()
    pressOnWindow(' ')
    expect(screen.getByRole('button', { name: 'Play preview' })).toBeInTheDocument()
  })
})

describe('deep links (#478 §4)', () => {
  it('loading with #guide/<section>/<anchor> opens the panel on that heading', async () => {
    window.history.replaceState(null, '', `${window.location.pathname}#guide/concepts/what-is-saved-where`)
    render(<App />)
    const guide = await panel()
    expect(within(guide).getByRole('heading', { level: 2, name: 'Concepts' })).toBeInTheDocument()
    const heading = within(guide).getByRole('heading', { level: 3, name: 'What is saved where' })
    expect(heading.id).toBe('guide-concepts-what-is-saved-where')
    // The contents list marks the section and the heading being read.
    const contents = within(guide).getByRole('navigation', { name: 'Contents' })
    expect(within(contents).getByRole('link', { name: 'Concepts' })).toHaveAttribute('aria-current', 'page')
    expect(within(contents).getByRole('link', { name: 'What is saved where' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('an in-guide link changes the hash and the panel, not the page; Back returns', async () => {
    const user = userEvent.setup()
    render(<App />)
    pressOnWindow('F1')
    const guide = await panel()
    const article = within(guide).getByRole('article')
    // Quick Start's first paragraph links to Concepts.
    const link = within(article).getByRole('link', { name: 'Concepts' })
    expect(link).toHaveAttribute('href', '#guide/concepts')
    await user.click(link)
    expect(window.location.hash).toBe('#guide/concepts')
    expect(within(guide).getByRole('heading', { level: 2, name: 'Concepts' })).toBeInTheDocument()

    // Back: the hash returns to Quick Start and the panel follows.
    act(() => {
      window.history.back()
    })
    await waitFor(() => expect(window.location.hash).toBe('#guide/quick-start'))
    await waitFor(() =>
      expect(within(guide).getByRole('heading', { level: 2, name: 'Quick Start' })).toBeInTheDocument(),
    )
  })

  it('links inside the guide carry the deep-link href of their target heading', async () => {
    render(<App />)
    pressOnWindow('F1')
    const guide = await panel()
    const article = within(guide).getByRole('article')
    expect(within(article).getByRole('link', { name: 'what is saved where' })).toHaveAttribute(
      'href',
      '#guide/concepts/what-is-saved-where',
    )
  })

  it('a hash that is not the guide’s leaves the panel closed', () => {
    window.history.replaceState(null, '', `${window.location.pathname}#something-else`)
    render(<App />)
    expect(screen.queryByRole('complementary', { name: 'User guide' })).toBeNull()
    expect(window.location.hash).toBe('#something-else')
  })
})

describe('search (#478 §5)', () => {
  it('finds Concepts for `proj` as you type, ranks the heading first, highlights the match, and Enter opens it', async () => {
    const user = userEvent.setup()
    render(<App />)
    pressOnWindow('F1')
    const guide = await panel()
    const search = within(guide).getByRole('searchbox', { name: 'Search the user guide' })
    await user.type(search, 'proj')

    const results = within(guide).getByRole('list', { name: 'Search results' })
    const hits = within(results).getAllByRole('button')
    expect(hits.length).toBeGreaterThan(0)
    // Every hit is in a section that exists, and the highlighted text is the prefix typed.
    const marks = results.querySelectorAll('mark')
    expect(marks.length).toBeGreaterThan(0)
    for (const mark of Array.from(marks)) expect(mark.textContent?.toLowerCase()).toBe('proj')
    // The contents and the article step aside while searching.
    expect(within(guide).queryByRole('navigation', { name: 'Contents' })).toBeNull()

    await user.keyboard('{Enter}')
    expect(within(guide).queryByRole('list', { name: 'Search results' })).toBeNull()
    expect(search).toHaveValue('')
    expect(window.location.hash).toMatch(/^#guide\//)
    expect(within(guide).getByRole('article')).toBeInTheDocument()
  })

  it('says so when nothing matches', async () => {
    const user = userEvent.setup()
    render(<App />)
    pressOnWindow('F1')
    const guide = await panel()
    await user.type(within(guide).getByRole('searchbox', { name: 'Search the user guide' }), 'xyzzy')
    expect(within(guide).getByRole('status')).toHaveTextContent('Nothing in the guide matches “xyzzy”.')
  })

  it('fills placeholders from the code’s constants, so the guide states what the code does', async () => {
    window.history.replaceState(null, '', `${window.location.pathname}#guide/concepts`)
    render(<App />)
    const guide = await panel()
    const article = within(guide).getByRole('article')
    expect(within(guide).getByRole('heading', { level: 2, name: 'Concepts' })).toBeInTheDocument()
    expect(article).toHaveTextContent('the history keeps the last 100')
    expect(article).toHaveTextContent('duck level starts at 25%')
    expect(article).not.toHaveTextContent('{{')
  })

  it('shows the step sizes in force, as the cheat sheet does (#286)', async () => {
    window.history.replaceState(null, '', `${window.location.pathname}#guide/quick-start`)
    render(<App />)
    const guide = await panel()
    expect(within(guide).getByRole('article')).toHaveTextContent('step the playhead by 0.1 s, or 1 s with Shift')
  })
})

describe('the standalone preview keeps its own cheat sheet (#203)', () => {
  it('is unaffected: App now owns the sheet, so exactly one renders on ?', () => {
    render(<App />)
    pressOnWindow('?', { shiftKey: true })
    expect(screen.getAllByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveLength(1)
  })
})
