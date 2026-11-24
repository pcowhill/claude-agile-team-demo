import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../../App'
import { addMenuContributions } from '../../lib/addMenu'
import { builtInPlugins } from '../catalog'
import { closeAddMenu, openAddMenu } from '../../test/timelineMenu'
import { activate, TITLE_TEMPLATE_ITEM_ID } from './index'
import { TitleTemplatesDialog } from './TitleTemplatesDialog'
import { TITLE_TEMPLATES } from './templates'

/**
 * The Title templates plugin (#860), against the app's real Add ▾ registry:
 * `activate` is what the plugin runtime calls after loading the lazy chunk,
 * and the deactivate it returns is the cleanup.
 */

let deactivate: (() => void) | null = null

afterEach(() => {
  deactivate?.()
  deactivate = null
})

const CORE_ITEMS = ['Color slate', 'Text overlay', 'Shape group', 'Subtitles from .srt file…']

const menuItems = (menu: HTMLElement) => within(menu).getAllByRole('menuitem').map((item) => item.textContent)

const textRows = () => screen.queryAllByRole('textbox', { name: /^Content of text overlay at position \d+$/ })

describe('Title templates plugin (#860)', () => {
  it('is a catalog entry with a lazy load, and needs no usedByProject', async () => {
    const spec = builtInPlugins.find((plugin) => plugin.id === 'title-templates')
    expect(spec?.name).toBe('Title templates')
    // Placed elements are ordinary text and shapes: no project depends on it.
    expect(spec?.usedByProject).toBeUndefined()
    const module = await spec!.load()
    expect(module.activate).toBe(activate)
  })

  it('adds Title template… after the four core items, and the deactivate removes it', async () => {
    render(<App />)
    let menu = await openAddMenu()
    expect(menuItems(menu)).toEqual(CORE_ITEMS)
    await closeAddMenu()

    act(() => {
      deactivate = activate()
    })
    expect(addMenuContributions.find(TITLE_TEMPLATE_ITEM_ID)?.label).toBe('Title template…')
    menu = await openAddMenu()
    expect(menuItems(menu)).toEqual([...CORE_ITEMS, 'Title template…'])
    await closeAddMenu()

    act(() => {
      deactivate?.()
      deactivate = null
    })
    menu = await openAddMenu()
    expect(menuItems(menu)).toEqual(CORE_ITEMS)
    await closeAddMenu()
  })

  it('places a template in one undo step, and what it placed stays when the plugin is disabled', async () => {
    act(() => {
      deactivate = activate()
    })
    render(<App />)
    const menu = await openAddMenu()
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Title template…' }))
    const dialog = screen.getByRole('dialog', { name: 'Title template' })
    const name = within(dialog).getByRole('textbox', { name: 'Name' })
    await userEvent.clear(name)
    await userEvent.type(name, 'Sam Lee{Enter}')
    expect(screen.queryByRole('dialog', { name: 'Title template' })).toBeNull()

    expect(textRows().map((row) => (row as HTMLTextAreaElement).value)).toEqual(['Sam Lee', 'Product designer'])
    expect(screen.getAllByText('Lower third').length).toBeGreaterThan(0)

    // One undo takes every element away.
    await userEvent.click(screen.getByRole('button', { name: 'Undo last timeline edit' }))
    expect(textRows()).toEqual([])
    expect(screen.queryAllByText('Lower third')).toEqual([])
    await userEvent.click(screen.getByRole('button', { name: 'Redo timeline edit' }))
    expect(textRows()).toHaveLength(2)

    act(() => {
      deactivate?.()
      deactivate = null
    })
    expect(textRows()).toHaveLength(2)
    expect(screen.getAllByText('Lower third').length).toBeGreaterThan(0)
  })
})

describe('disabling Title templates while its gallery is open (#860)', () => {
  it('closes the gallery, and enabling the plugin again does not reopen it', async () => {
    act(() => {
      deactivate = activate()
    })
    render(<App />)
    const menu = await openAddMenu()
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Title template…' }))
    expect(screen.getByRole('dialog', { name: 'Title template' })).toBeInTheDocument()
    act(() => {
      deactivate?.()
      deactivate = null
    })
    expect(screen.queryByRole('dialog', { name: 'Title template' })).toBeNull()
    act(() => {
      deactivate = activate()
    })
    expect(screen.queryByRole('dialog', { name: 'Title template' })).toBeNull()
  })
})

describe('the Title template dialog (#860)', () => {
  const measure = () => 0

  it('offers every template as a radio, the first chosen, with its fields', () => {
    render(<TitleTemplatesDialog frame={{ width: 1920, height: 1080 }} onPlace={vi.fn()} onClose={vi.fn()} measure={measure} />)
    const radios = screen.getAllByRole('radio')
    expect(radios.map((radio) => radio.closest('label')?.querySelector('.title-template-name')?.textContent)).toEqual(
      TITLE_TEMPLATES.map((template) => template.name),
    )
    expect(radios[0]).toBeChecked()
    expect(radios[0]).toHaveFocus()
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Alex Morgan')
    expect(screen.getByRole('textbox', { name: 'Role (optional)' })).toHaveValue('Product designer')
  })

  it('switching template shows its fields, and keeps what was typed in the first', async () => {
    render(<TitleTemplatesDialog frame={{ width: 1920, height: 1080 }} onPlace={vi.fn()} onClose={vi.fn()} measure={measure} />)
    await userEvent.clear(screen.getByRole('textbox', { name: 'Name' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Kim')
    await userEvent.click(screen.getByRole('radio', { name: /Chapter card/ }))
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Chapter 1')
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()
    await userEvent.click(screen.getByRole('radio', { name: /Lower third/ }))
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Kim')
  })

  it('Place hands back the chosen template built from the typed words', async () => {
    const onPlace = vi.fn()
    render(<TitleTemplatesDialog frame={{ width: 1080, height: 1920 }} onPlace={onPlace} onClose={vi.fn()} measure={measure} />)
    await userEvent.click(screen.getByRole('radio', { name: /End card/ }))
    await userEvent.clear(screen.getByRole('textbox', { name: 'Second line (optional)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Place' }))
    expect(onPlace).toHaveBeenCalledTimes(1)
    const [placed] = onPlace.mock.calls[0]
    expect(placed.texts.map((text: { content: string }) => text.content)).toEqual(['Thanks for watching'])
    expect(placed.shapeGroups).toHaveLength(1)
    expect(placed.shapeGroups[0].name).toBe('End card')
  })

  it('an empty required field disables Place, and Escape and Cancel close without placing', async () => {
    const onPlace = vi.fn()
    const onClose = vi.fn()
    render(<TitleTemplatesDialog frame={{ width: 1920, height: 1080 }} onPlace={onPlace} onClose={onClose} measure={measure} />)
    await userEvent.clear(screen.getByRole('textbox', { name: 'Name' }))
    expect(screen.getByRole('button', { name: 'Place' })).toBeDisabled()
    await userEvent.type(screen.getByRole('textbox', { name: 'Role (optional)' }), '{Enter}')
    expect(onPlace).not.toHaveBeenCalled()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
