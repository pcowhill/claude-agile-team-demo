import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { placementFor } from '../lib/menuPlacement'
import type { Placement } from '../lib/menuPlacement'
import './Menu.css'

/**
 * The shared menu component (#412, from the button redesign #401 / #395):
 * one trigger button, one panel of items, and the keyboard and pointer
 * behaviour of a desktop application menu — so that every menu the redesign
 * introduces (File ▾, View ▾, Frame ▾, Add ▾, the per-row ⋯ menus) gets the
 * same accessibility from one implementation. Modelled on the Record ▾ menu
 * the customer liked, which now renders through it.
 *
 * Items are data, not children, so a menu is declared as a list: actions
 * (with an optional shortcut hint), radio groups (list / thumbnail view,
 * sort keys), submenus (File ▾ → Export ▸) and separators.
 *
 * Behaviour (WAI-ARIA menu button pattern):
 * - the trigger carries `aria-haspopup="menu"` / `aria-expanded`; click,
 *   Enter or Space toggle it, ArrowDown opens with the first item focused,
 *   ArrowUp with the last;
 * - inside the panel ArrowUp / ArrowDown move focus and wrap, Home / End
 *   jump, Enter / Space select, Escape closes and returns focus to the
 *   trigger, Tab closes and lets focus move on; the pointer moving over an
 *   item focuses it, so the keys continue from wherever the mouse was;
 * - a submenu item opens on hover, ArrowRight, Enter or Space; ArrowLeft
 *   inside it returns to the parent item; Escape anywhere closes everything;
 * - a pointer press outside closes; selecting an action or a radio closes;
 * - only one menu is open at a time, whichever component owns it;
 * - the panel stays inside the viewport: it opens to the left of its right
 *   edge when it would overflow the window (the header menus sit at the
 *   page's right), and above the trigger when it would overflow the bottom.
 *
 * Disabled items render as disabled buttons: the arrows skip them and they
 * cannot be selected, but they stay visible so the menu's shape is stable.
 */

export interface MenuAction {
  kind: 'action'
  label: ReactNode
  onSelect: () => void
  disabled?: boolean
  /** Keyboard shortcut text, shown right-aligned as a <kbd>. */
  shortcut?: string
  title?: string
  /** Accessible name when the visible label is not the whole story. */
  ariaLabel?: string
  testId?: string
}

export interface MenuRadioOption {
  value: string
  label: ReactNode
  disabled?: boolean
  testId?: string
}

export interface MenuRadioGroup {
  kind: 'radio-group'
  /** The group's heading, shown above its items and used as its name. */
  label: string
  value: string
  options: readonly MenuRadioOption[]
  onChange: (value: string) => void
}

export interface MenuSubmenu {
  kind: 'submenu'
  label: string
  items: readonly MenuItem[]
  disabled?: boolean
  testId?: string
}

export interface MenuSeparator {
  kind: 'separator'
}

export type MenuItem = MenuAction | MenuRadioGroup | MenuSubmenu | MenuSeparator

interface MenuProps {
  /** The trigger's visible content; a string doubles as its accessible name. */
  label: ReactNode
  /** Accessible name of the panel (`role="menu"`). */
  menuLabel: string
  items: readonly MenuItem[]
  /** Overrides the trigger's accessible name (a compact icon trigger, say). */
  ariaLabel?: string
  title?: string
  disabled?: boolean
  /** On the root wrapper — for positioning the whole control in its row. */
  className?: string
  triggerClassName?: string
  testId?: string
}

/**
 * The one open menu on the page, whichever component owns it: opening
 * another closes it first. A module-level slot rather than context, so
 * menus in unrelated panels (the header's and a timeline row's) still know
 * about each other.
 */
let closeOpenMenu: (() => void) | null = null

/** Which of a panel's own items (not a nested submenu's) can take focus. */
function focusableItemsOf(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>('[role^="menuitem"]')).filter(
    (element) =>
      element.closest('[role="menu"]') === panel &&
      !element.hasAttribute('disabled') &&
      element.getAttribute('aria-disabled') !== 'true',
  )
}

interface MenuPanelProps {
  id?: string
  label: string
  items: readonly MenuItem[]
  /** Escape, Tab, or a selection: close the whole menu. */
  onCloseAll: (restoreFocus: boolean) => void
  /** ArrowLeft inside a submenu: close this panel only. Absent on the root. */
  onCloseSubmenu?: () => void
  initialFocus: 'first' | 'last'
  submenu?: boolean
}

function MenuPanel({
  id,
  label,
  items,
  onCloseAll,
  onCloseSubmenu,
  initialFocus,
  submenu = false,
}: MenuPanelProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<Placement>({ end: false, up: false })
  // Which submenu (by item index) is open — the panel owns it, so focusing
  // or hovering any other item closes it.
  const [openSubmenu, setOpenSubmenu] = useState<number | null>(null)
  const [submenuFocus, setSubmenuFocus] = useState<'first' | 'last'>('first')
  const submenuTriggers = useRef(new Map<number, HTMLButtonElement>())

  // Stay inside the viewport: measured once on open, in the natural
  // position, then flipped horizontally and/or vertically as needed. jsdom
  // reports zero-size boxes, so tests exercise the natural position only.
  useLayoutEffect(() => {
    const panel = ref.current
    if (panel === null) return
    const rect = panel.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) return
    // Flip only when the other side actually has the room; otherwise the
    // natural side is the lesser evil. The arithmetic is `placementFor`,
    // which knows a submenu flips against a different anchor edge (#430).
    const next = placementFor(
      rect,
      panel.parentElement?.getBoundingClientRect(),
      { width: document.documentElement.clientWidth, height: window.innerHeight },
      submenu,
    )
    if (next.end || next.up) setPlacement(next)
    // `submenu` never changes for a panel instance; named so the rule is satisfied.
  }, [submenu])

  useEffect(() => {
    const panel = ref.current
    if (panel === null) return
    const focusable = focusableItemsOf(panel)
    const target = initialFocus === 'last' ? focusable[focusable.length - 1] : focusable[0]
    ;(target ?? panel).focus()
  }, [initialFocus])

  const moveFocus = (to: 'next' | 'previous' | 'first' | 'last') => {
    const panel = ref.current
    if (panel === null) return
    const focusable = focusableItemsOf(panel)
    if (focusable.length === 0) return
    const current = focusable.indexOf(document.activeElement as HTMLElement)
    let index: number
    if (to === 'first') index = 0
    else if (to === 'last') index = focusable.length - 1
    else if (current === -1) index = to === 'next' ? 0 : focusable.length - 1
    else index = (current + (to === 'next' ? 1 : -1) + focusable.length) % focusable.length
    focusable[index].focus()
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // A nested submenu handles its own keys first and stops them here.
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        event.stopPropagation()
        moveFocus('next')
        break
      case 'ArrowUp':
        event.preventDefault()
        event.stopPropagation()
        moveFocus('previous')
        break
      case 'Home':
        event.preventDefault()
        event.stopPropagation()
        moveFocus('first')
        break
      case 'End':
        event.preventDefault()
        event.stopPropagation()
        moveFocus('last')
        break
      case 'Escape':
        event.preventDefault()
        event.stopPropagation()
        onCloseAll(true)
        break
      case 'Tab':
        // Not prevented: focus moves on to wherever Tab takes it.
        event.stopPropagation()
        onCloseAll(false)
        break
      case 'ArrowLeft':
        if (onCloseSubmenu !== undefined) {
          event.preventDefault()
          event.stopPropagation()
          onCloseSubmenu()
        }
        break
      default:
        break
    }
  }

  const className = [
    'menu-panel',
    submenu ? 'menu-panel-submenu' : '',
    placement.end ? 'menu-panel-end' : '',
    placement.up ? 'menu-panel-up' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const select = (action: () => void) => {
    action()
    onCloseAll(true)
  }

  return (
    <div
      ref={ref}
      id={id}
      role="menu"
      aria-label={label}
      className={className}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      {items.map((item, index) => {
        switch (item.kind) {
          case 'separator':
            return <div key={index} role="separator" className="menu-separator" />
          case 'action':
            return (
              <button
                key={index}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="menu-item"
                disabled={item.disabled}
                aria-disabled={item.disabled ? true : undefined}
                aria-label={item.ariaLabel}
                title={item.title}
                data-testid={item.testId}
                onClick={() => select(item.onSelect)}
                onMouseEnter={(event) => {
                  setOpenSubmenu(null)
                  event.currentTarget.focus()
                }}
                onFocus={() => setOpenSubmenu(null)}
              >
                <span className="menu-item-label">{item.label}</span>
                {/* Hidden from the accessible name so an item is still
                    found by its label alone; the hint is visual. */}
                {item.shortcut !== undefined && (
                  <kbd className="menu-shortcut" aria-hidden="true">
                    {item.shortcut}
                  </kbd>
                )}
              </button>
            )
          case 'radio-group':
            return (
              <div key={index} role="group" aria-label={item.label} className="menu-group">
                <span className="menu-group-label" aria-hidden="true">
                  {item.label}
                </span>
                {item.options.map((option) => {
                  const checked = option.value === item.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={checked}
                      tabIndex={-1}
                      className="menu-item"
                      disabled={option.disabled}
                      aria-disabled={option.disabled ? true : undefined}
                      data-testid={option.testId}
                      onClick={() => select(() => item.onChange(option.value))}
                      onMouseEnter={(event) => {
                        setOpenSubmenu(null)
                        event.currentTarget.focus()
                      }}
                      onFocus={() => setOpenSubmenu(null)}
                    >
                      <span className="menu-check" aria-hidden="true">
                        {checked ? '✓' : ''}
                      </span>
                      <span className="menu-item-label">{option.label}</span>
                    </button>
                  )
                })}
              </div>
            )
          case 'submenu': {
            const isOpen = openSubmenu === index
            const openWith = (focus: 'first' | 'last') => {
              setSubmenuFocus(focus)
              setOpenSubmenu(index)
            }
            return (
              <div key={index} className="menu-submenu">
                <button
                  ref={(element) => {
                    if (element === null) submenuTriggers.current.delete(index)
                    else submenuTriggers.current.set(index, element)
                  }}
                  type="button"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={isOpen}
                  tabIndex={-1}
                  className="menu-item menu-item-submenu"
                  disabled={item.disabled}
                  aria-disabled={item.disabled ? true : undefined}
                  data-testid={item.testId}
                  onClick={() => (isOpen ? setOpenSubmenu(null) : openWith('first'))}
                  onMouseEnter={(event) => {
                    event.currentTarget.focus()
                    if (!isOpen) openWith('first')
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      event.stopPropagation()
                      openWith('first')
                    }
                  }}
                >
                  <span className="menu-item-label">{item.label}</span>
                  <span className="menu-submenu-arrow" aria-hidden="true">
                    ▸
                  </span>
                </button>
                {isOpen && (
                  <MenuPanel
                    label={item.label}
                    items={item.items}
                    submenu
                    initialFocus={submenuFocus}
                    onCloseAll={onCloseAll}
                    onCloseSubmenu={() => {
                      setOpenSubmenu(null)
                      submenuTriggers.current.get(index)?.focus()
                    }}
                  />
                )}
              </div>
            )
          }
          default:
            return null
        }
      })}
    </div>
  )
}

export function Menu({
  label,
  menuLabel,
  items,
  ariaLabel,
  title,
  disabled = false,
  className,
  triggerClassName,
  testId,
}: MenuProps) {
  const [open, setOpen] = useState(false)
  const [initialFocus, setInitialFocus] = useState<'first' | 'last'>('first')
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  // A stable identity for the one-open-menu slot, delegating to the latest
  // close function.
  const closeRef = useRef<() => void>(() => {})
  const instance = useRef(() => closeRef.current())

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])
  closeRef.current = () => close(false)

  const openWith = (focus: 'first' | 'last') => {
    setInitialFocus(focus)
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    if (closeOpenMenu !== null && closeOpenMenu !== instance.current) closeOpenMenu()
    closeOpenMenu = instance.current
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current
      if (root !== null && !root.contains(event.target as Node)) close(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      if (closeOpenMenu === instance.current) closeOpenMenu = null
    }
  }, [open, close])

  const triggerName = ariaLabel ?? (typeof label === 'string' ? label : undefined)

  return (
    <div ref={rootRef} className={className === undefined ? 'menu' : `menu ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName === undefined ? 'menu-trigger' : `menu-trigger ${triggerClassName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={triggerName}
        title={title}
        disabled={disabled}
        data-testid={testId}
        onClick={() => (open ? close(false) : openWith('first'))}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            openWith('first')
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            openWith('last')
          }
        }}
      >
        {label}
        <span className="menu-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <MenuPanel
          id={panelId}
          label={menuLabel}
          items={items}
          initialFocus={initialFocus}
          onCloseAll={close}
        />
      )}
    </div>
  )
}
