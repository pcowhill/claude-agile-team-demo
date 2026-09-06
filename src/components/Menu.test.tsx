import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Menu } from './Menu'
import type { MenuItem } from './Menu'

/**
 * The shared menu component (#412): the keyboard and pointer contract every
 * menu of the button redesign (#401) relies on, pinned once here. What jsdom
 * cannot see — the panel staying inside the viewport — is e2e/menu.spec.ts's.
 */

function Harness({
  onSelect = () => {},
  onView = () => {},
  onExport = () => {},
  view = 'list',
}: {
  onSelect?: (label: string) => void
  onView?: (value: string) => void
  onExport?: (format: string) => void
  view?: string
}) {
  const items: MenuItem[] = [
    { kind: 'action', label: 'New', onSelect: () => onSelect('New') },
    { kind: 'action', label: 'Open…', onSelect: () => onSelect('Open'), disabled: true },
    { kind: 'action', label: 'Save', onSelect: () => onSelect('Save'), shortcut: 'Ctrl+S' },
    { kind: 'separator' },
    {
      kind: 'radio-group',
      label: 'View',
      value: view,
      options: [
        { value: 'list', label: 'List' },
        { value: 'thumbnails', label: 'Thumbnails' },
      ],
      onChange: onView,
    },
    { kind: 'separator' },
    {
      kind: 'submenu',
      label: 'Export',
      items: [
        { kind: 'action', label: 'WebM', onSelect: () => onExport('webm') },
        { kind: 'action', label: 'GIF', onSelect: () => onExport('gif') },
      ],
    },
    { kind: 'action', label: 'Settings…', onSelect: () => onSelect('Settings') },
  ]
  return (
    <div>
      <button type="button">Before</button>
      <Menu label="File" menuLabel="File menu" items={items} />
      <button type="button">After</button>
    </div>
  )
}

const trigger = () => screen.getByRole('button', { name: 'File' })
const panel = () => screen.getByRole('menu', { name: 'File menu' })
const item = (name: string) => screen.getByRole('menuitem', { name })

describe('Menu (#412)', () => {
  it('names its trigger after a string label and marks it as a menu button', () => {
    render(<Harness />)
    expect(trigger()).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('an explicit aria-label wins over the visible label', () => {
    render(<Menu label="⋯" ariaLabel="More actions" menuLabel="More" items={[]} />)
    expect(screen.getByRole('button', { name: 'More actions' })).toBeInTheDocument()
  })

  it('opens on click with the first item focused, and a second click closes it', async () => {
    render(<Harness />)
    await userEvent.click(trigger())
    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
    expect(panel()).toBeInTheDocument()
    expect(item('New')).toHaveFocus()
    await userEvent.click(trigger())
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
  })

  it('ArrowDown on the trigger opens with the first item focused; ArrowUp with the last', async () => {
    render(<Harness />)
    trigger().focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(item('New')).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(trigger()).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    expect(item('Settings…')).toHaveFocus()
  })

  it('arrows move focus, skip a disabled item and wrap; Home and End jump', async () => {
    render(<Harness />)
    await userEvent.click(trigger())
    expect(item('New')).toHaveFocus()
    // Open… is disabled: ArrowDown lands on Save.
    await userEvent.keyboard('{ArrowDown}')
    expect(item('Save')).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitemradio', { name: 'List' })).toHaveFocus()
    await userEvent.keyboard('{End}')
    expect(item('Settings…')).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(item('New')).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    expect(item('Settings…')).toHaveFocus()
    await userEvent.keyboard('{Home}')
    expect(item('New')).toHaveFocus()
  })

  it('a disabled item is inert and stays visible', async () => {
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)
    await userEvent.click(trigger())
    expect(item('Open…')).toBeDisabled()
    await userEvent.click(item('Open…'))
    expect(onSelect).not.toHaveBeenCalled()
    expect(panel()).toBeInTheDocument()
  })

  it('Enter selects the focused item, closes the menu and returns focus to the trigger', async () => {
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)
    trigger().focus()
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(onSelect).toHaveBeenCalledWith('Save')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger()).toHaveFocus()
  })

  it('a click on an item selects it and closes the menu', async () => {
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)
    await userEvent.click(trigger())
    await userEvent.click(item('New'))
    expect(onSelect).toHaveBeenCalledWith('New')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('Escape closes and returns focus to the trigger; nothing is selected', async () => {
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)
    await userEvent.click(trigger())
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger()).toHaveFocus()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('a pointer press outside closes the menu', async () => {
    render(<Harness />)
    await userEvent.click(trigger())
    await userEvent.click(screen.getByRole('button', { name: 'After' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('Tab closes the menu and lets focus move on', async () => {
    render(<Harness />)
    await userEvent.click(trigger())
    await userEvent.tab()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger()).not.toHaveFocus()
  })

  it('renders a shortcut hint as <kbd> without it joining the accessible name', async () => {
    render(<Harness />)
    await userEvent.click(trigger())
    const save = item('Save')
    const kbd = save.querySelector('kbd')
    expect(kbd).not.toBeNull()
    expect(kbd).toHaveTextContent('Ctrl+S')
  })

  it('renders separators with the separator role', async () => {
    render(<Harness />)
    await userEvent.click(trigger())
    expect(within(panel()).getAllByRole('separator')).toHaveLength(2)
  })

  it('a radio group shows the chosen option checked, and choosing another calls back and closes', async () => {
    const onView = vi.fn()
    render(<Harness onView={onView} view="list" />)
    await userEvent.click(trigger())
    const group = within(panel()).getByRole('group', { name: 'View' })
    expect(within(group).getByRole('menuitemradio', { name: 'List' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(within(group).getByRole('menuitemradio', { name: 'Thumbnails' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    await userEvent.click(within(group).getByRole('menuitemradio', { name: 'Thumbnails' }))
    expect(onView).toHaveBeenCalledWith('thumbnails')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('a submenu opens on ArrowRight with its first item focused, ArrowLeft returns to the parent item', async () => {
    render(<Harness />)
    await userEvent.click(trigger())
    const exportItem = item('Export')
    expect(exportItem).toHaveAttribute('aria-haspopup', 'menu')
    expect(exportItem).toHaveAttribute('aria-expanded', 'false')
    exportItem.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(exportItem).toHaveAttribute('aria-expanded', 'true')
    const submenu = screen.getByRole('menu', { name: 'Export' })
    expect(within(submenu).getByRole('menuitem', { name: 'WebM' })).toHaveFocus()
    // Arrows stay inside the submenu.
    await userEvent.keyboard('{ArrowDown}')
    expect(within(submenu).getByRole('menuitem', { name: 'GIF' })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(within(submenu).getByRole('menuitem', { name: 'WebM' })).toHaveFocus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(screen.queryByRole('menu', { name: 'Export' })).not.toBeInTheDocument()
    expect(item('Export')).toHaveFocus()
    expect(panel()).toBeInTheDocument()
  })

  it('Enter on a submenu item opens it; hover opens it too; focusing a sibling closes it', async () => {
    render(<Harness />)
    await userEvent.click(trigger())
    item('Export').focus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('menu', { name: 'Export' })).toBeInTheDocument()
    await userEvent.hover(item('Settings…'))
    expect(item('Settings…')).toHaveFocus()
    expect(screen.queryByRole('menu', { name: 'Export' })).not.toBeInTheDocument()
    await userEvent.hover(item('Export'))
    expect(screen.getByRole('menu', { name: 'Export' })).toBeInTheDocument()
  })

  it('selecting inside a submenu closes the whole menu; Escape inside it does too', async () => {
    const onExport = vi.fn()
    render(<Harness onExport={onExport} />)
    await userEvent.click(trigger())
    item('Export').focus()
    await userEvent.keyboard('{ArrowRight}{ArrowDown}{Enter}')
    expect(onExport).toHaveBeenCalledWith('gif')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger()).toHaveFocus()

    await userEvent.keyboard('{ArrowDown}')
    item('Export').focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('menu', { name: 'Export' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger()).toHaveFocus()
  })

  it('clicking a submenu item opens it rather than toggling it shut (#415)', async () => {
    // A pointer click is always preceded by the hover that already opened
    // the submenu, so a toggle would close the thing being clicked. #415's
    // Export ▸ is the first shipped submenu and hit exactly that.
    render(<Harness />)
    await userEvent.click(trigger())
    await userEvent.click(item('Export'))
    expect(screen.getByRole('menu', { name: 'Export' })).toBeInTheDocument()
    expect(item('Export')).toHaveAttribute('aria-expanded', 'true')
  })

  it('only one menu is open at a time, across unrelated components', async () => {
    render(
      <>
        <Menu label="First" menuLabel="First menu" items={[{ kind: 'action', label: 'A', onSelect: () => {} }]} />
        <Menu label="Second" menuLabel="Second menu" items={[{ kind: 'action', label: 'B', onSelect: () => {} }]} />
      </>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'First' }))
    expect(screen.getByRole('menu', { name: 'First menu' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Second' }))
    expect(screen.queryByRole('menu', { name: 'First menu' })).not.toBeInTheDocument()
    expect(screen.getByRole('menu', { name: 'Second menu' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'First' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('a disabled trigger does not open', async () => {
    render(<Menu label="File" menuLabel="File menu" items={[]} disabled />)
    await userEvent.click(trigger())
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
