import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CORE_TEXT_FONTS, fontRegistry } from '../lib/textOverlay'
import { typeaheadMatch } from '../lib/typeahead'
import { FontSelect } from './FontSelect'

/**
 * A Font menu (#949): a native select whose press opens an in-page list,
 * each name drawn in its font. What jsdom cannot see (where the list sits,
 * that a face downloads, the names on one line) is e2e/font-pack.spec.ts's.
 */

const PACK = { id: 'pack-script', label: 'Pack script', stack: '"Pack Script", cursive' }

function Harness({ initial = 'sans', onChange = () => {} }: { initial?: string; onChange?: (font: string) => void }) {
  const [font, setFont] = useState(initial)
  return (
    <>
      <FontSelect
        label="Font of text"
        value={font}
        onChange={(next) => {
          onChange(next)
          setFont(next)
        }}
      />
      <button type="button">after</button>
    </>
  )
}

const select = () => screen.getByRole('combobox', { name: 'Font of text' })
const list = () => screen.queryByRole('listbox', { name: 'Font of text' })
const active = () => {
  const listbox = list()!
  return document.getElementById(listbox.getAttribute('aria-activedescendant')!)!.textContent
}

describe('FontSelect (#949)', () => {
  beforeEach(() => fontRegistry.register(PACK))
  afterEach(() => fontRegistry.unregister(PACK.id))

  it('a press opens a list of every font, each name in its own font, the current one selected and focus in the list', async () => {
    render(<Harness initial="serif" />)
    expect(list()).toBeNull()
    await userEvent.click(select())
    const listbox = list()!
    expect(listbox).toHaveFocus()
    const options = within(listbox).getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      ...CORE_TEXT_FONTS.map((font) => font.label),
      PACK.label,
    ])
    for (const [index, font] of [...CORE_TEXT_FONTS, PACK].entries()) {
      // jsdom keeps the stack as written, so the comparison is exact.
      expect(options[index].style.fontFamily, font.label).toBe(font.stack)
    }
    expect(options.filter((option) => option.getAttribute('aria-selected') === 'true').map((o) => o.textContent)).toEqual([
      'Serif',
    ])
    expect(active()).toBe('Serif')
    // The native options stay unstyled: Chromium sizes a closed select by
    // its options' fonts, and styling them would download every pack face.
    for (const option of within(select()).getAllByRole('option')) expect(option.style.fontFamily).toBe('')
  })

  it('clicking a name chooses it and returns focus to the select; a press of the select again closes the list', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await userEvent.click(select())
    await userEvent.click(within(list()!).getByRole('option', { name: 'Pack script' }))
    expect(onChange).toHaveBeenCalledWith('pack-script')
    expect(select()).toHaveValue('pack-script')
    expect(list()).toBeNull()
    expect(select()).toHaveFocus()

    await userEvent.click(select())
    expect(list()).not.toBeNull()
    await userEvent.click(select())
    expect(list()).toBeNull()
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('choosing the current font changes nothing', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await userEvent.click(select())
    await userEvent.click(within(list()!).getByRole('option', { name: 'Sans-serif' }))
    expect(onChange).not.toHaveBeenCalled()
    expect(list()).toBeNull()
  })

  for (const key of ['{Alt>}{ArrowDown}{/Alt}', '{Alt>}{ArrowUp}{/Alt}', '{F4}', ' ', '{Enter}']) {
    it(`${key} on the select opens the list`, async () => {
      render(<Harness />)
      select().focus()
      await userEvent.keyboard(key)
      expect(list()).toHaveFocus()
      expect(active()).toBe('Sans-serif')
    })
  }

  it('in the list the arrows, Home and End move the highlight without wrapping, and Enter chooses', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    select().focus()
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard('{ArrowUp}')
    expect(active()).toBe('Sans-serif')
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    expect(active()).toBe('Monospace')
    await userEvent.keyboard('{End}{ArrowDown}')
    expect(active()).toBe('Pack script')
    await userEvent.keyboard('{Home}')
    expect(active()).toBe('Sans-serif')
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenCalledWith('serif')
    expect(list()).toBeNull()
    expect(select()).toHaveFocus()
  })

  it('typing jumps to a name, and one letter again steps through the names it starts', async () => {
    render(<Harness />)
    select().focus()
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard('p')
    expect(active()).toBe('Pack script')
    // S again and again: Sans-serif, then Serif, from the highlighted name on.
    await userEvent.keyboard('{Home}s')
    expect(active()).toBe('Serif')
    await userEvent.keyboard('s')
    expect(active()).toBe('Sans-serif')
    await userEvent.keyboard('{Enter}')
    expect(select()).toHaveValue('sans')
  })

  it('Escape closes the list unchanged and returns focus; Tab closes it unchanged', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    select().focus()
    await userEvent.keyboard('{Enter}{ArrowDown}{Escape}')
    expect(list()).toBeNull()
    expect(select()).toHaveFocus()
    await userEvent.keyboard('{Enter}{ArrowDown}')
    await userEvent.tab()
    expect(list()).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it("the list's keys stop at the list, so the window's shortcuts do not also act on them", async () => {
    const onWindowKey = vi.fn()
    render(<Harness />)
    select().focus()
    await userEvent.keyboard('{Enter}')
    window.addEventListener('keydown', onWindowKey)
    try {
      await userEvent.keyboard('{ArrowDown}m{Home} ')
      expect(onWindowKey).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', onWindowKey)
    }
  })

  it('a press outside closes the list unchanged', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await userEvent.click(select())
    await userEvent.click(screen.getByRole('button', { name: 'after' }))
    expect(list()).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('closed, the select keeps its native keys: choosing an option changes the font', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await userEvent.selectOptions(select(), 'mono')
    expect(onChange).toHaveBeenCalledWith('mono')
    // A change event, as the arrows fire on a closed native select.
    fireEvent.change(select(), { target: { value: 'display' } })
    expect(onChange).toHaveBeenLastCalledWith('display')
  })

  it('a stored font no registered font covers is listed last as unavailable, selected, in the app font', async () => {
    render(<Harness initial="pack-gone" />)
    expect(select()).toHaveValue('pack-gone')
    await userEvent.click(select())
    const options = within(list()!).getAllByRole('option')
    const last = options[options.length - 1]
    expect(last).toHaveTextContent('pack-gone (unavailable)')
    expect(last).toHaveAttribute('aria-selected', 'true')
    expect(last.style.fontFamily).toBe('')
  })

  it('re-reads the registry while open: a font a plugin removes leaves the list', async () => {
    render(<Harness />)
    await userEvent.click(select())
    expect(within(list()!).getByRole('option', { name: 'Pack script' })).toBeInTheDocument()
    act(() => fontRegistry.unregister(PACK.id))
    expect(within(list()!).queryByRole('option', { name: 'Pack script' })).toBeNull()
  })
})

describe('typeaheadMatch (#949)', () => {
  const labels = ['Sans-serif', 'Serif', 'Monospace', 'Comic Neue', 'Courier Prime']
  it('finds the first label from `from` on that starts with the typed text, ignoring case, wrapping', () => {
    expect(typeaheadMatch(labels, 's', 0)).toBe(0)
    expect(typeaheadMatch(labels, 's', 1)).toBe(1)
    expect(typeaheadMatch(labels, 's', 2)).toBe(0)
    expect(typeaheadMatch(labels, 'CO', 0)).toBe(3)
    expect(typeaheadMatch(labels, 'cou', 0)).toBe(4)
    expect(typeaheadMatch(labels, 'comic n', 0)).toBe(3)
    expect(typeaheadMatch(labels, 'x', 0)).toBe(-1)
  })
})
