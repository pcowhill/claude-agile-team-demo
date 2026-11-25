import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, RefObject } from 'react'
import { fontRegistry } from '../lib/textOverlay'
import type { TextFontId } from '../lib/textOverlay'
import { placementBounds } from '../lib/menuPlacement'
import { typeaheadMatch } from '../lib/typeahead'
import './FontSelect.css'

/**
 * A Font menu (#859, #949): a text row's Font and the Subtitle style's
 * Font. Each font's name is drawn in that font, Font pack faces included.
 *
 * **Two parts.** The control is a native `<select>`, and its closed
 * behaviour is the native one: its accessible name, the value a screen
 * reader announces, the arrow keys and typing a letter all change the font
 * as they always have. What a press of it opens is not the native popup
 * but an in-page list (`role="listbox"`), drawn under the select, in which
 * each entry is set in its own font.
 *
 * **Why not style the native popup.** A native popup is drawn by the
 * browser or the platform, outside the page. Some ignore an option's font
 * altogether, and none can be relied on to reach the page's Font pack
 * `FontFace`s, which exist only in the page's `document.fonts`. No test can
 * screenshot one either. The in-page list is drawn by the page, alike on
 * every platform, and a test can measure it. The native options are left
 * unstyled on purpose: Chromium sizes a closed select by its options' own
 * fonts, so styling them would change the select's width and download
 * every pack face as soon as the menu is drawn.
 *
 * **Loading the faces.** Each entry renders in its font's stack, so
 * opening the list downloads each Font pack face's regular file, the one
 * the name is drawn in. Enabling the plugin still downloads nothing: the
 * list exists only while it is open.
 *
 * **Opening.** A primary press on the select, or a key that would open its
 * native popup (Alt+↓, Alt+↑, F4, Space, Enter), opens the list, with the
 * current font highlighted and focus in the list. Inside it ↑ / ↓ / Home /
 * End move the highlight, typing a name's first letters jumps to it, Enter
 * or Space or a click chooses, and Escape closes it unchanged. Either way
 * focus returns to the select. Tab, a press outside, a resize, and a scroll
 * that moves the select close it unchanged.
 *
 * A stored font that no registered font covers is listed last as
 * *… (unavailable)*, selected, and drawn in the app's own font (#859), as
 * the transition type picker does (#199), instead of the select silently
 * showing the first font. The subscription to `fontRegistry` sits on the
 * component that owns the `<select>`, not on its options: React re-applies
 * a controlled select's value only when the select itself re-renders, so
 * options re-rendering alone left the browser showing the first font once
 * the selected one was swapped for its "(unavailable)" entry.
 */
export function FontSelect({
  label,
  value,
  onChange,
}: {
  label: string
  value: TextFontId
  onChange: (font: TextFontId) => void
}) {
  useSyncExternalStore(fontRegistry.subscribe, () => fontRegistry.version)
  const entries: FontEntry[] = fontRegistry.list().map((font) => ({ id: font.id, label: font.label, stack: font.stack }))
  if (!fontRegistry.has(value)) entries.push({ id: value, label: `${value} (unavailable)`, stack: null })
  const selectRef = useRef<HTMLSelectElement>(null)
  const [open, setOpen] = useState(false)

  // Stable, so the list's listeners and the place it measured on opening
  // stay put while it is open.
  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false)
    if (restoreFocus) selectRef.current?.focus({ preventScroll: true })
  }, [])
  const choose = (id: TextFontId) => {
    close(true)
    if (id !== value) onChange(id)
  }

  const handleMouseDown = (event: ReactMouseEvent<HTMLSelectElement>) => {
    if (event.button !== 0) return
    // Keeps the native popup shut. It also keeps the press from focusing
    // the select, so focus it here, as the press would have.
    event.preventDefault()
    if (open) {
      close(true)
      return
    }
    selectRef.current?.focus({ preventScroll: true })
    setOpen(true)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLSelectElement>) => {
    if (open) return
    const opensPopup =
      ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && event.altKey) ||
      event.key === 'F4' ||
      event.key === ' ' ||
      event.key === 'Enter'
    if (!opensPopup) return
    event.preventDefault()
    setOpen(true)
  }

  return (
    // No wrapper: the select stays a direct child of its row, and the list
    // is fixed, so it takes no part in the row's layout.
    <>
      <select
        ref={selectRef}
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onMouseDown={handleMouseDown}
        onKeyDown={handleKeyDown}
      >
        {entries.map((entry) => (
          <option key={entry.stack === null ? `unavailable:${entry.id}` : entry.id} value={entry.id}>
            {entry.label}
          </option>
        ))}
      </select>
      {open && (
        <FontList
          label={label}
          entries={entries}
          value={value}
          anchor={selectRef}
          onChoose={choose}
          onClose={close}
        />
      )}
    </>
  )
}

interface FontEntry {
  id: TextFontId
  label: string
  /** The font's CSS stack; null for a stored font no registered font covers. */
  stack: string | null
}

/** How long a pause ends a type-ahead search, as a native select's does. */
const TYPEAHEAD_MS = 500

/** The gap between the select and the list, in px. */
const GAP = 2

function FontList({
  label,
  entries,
  value,
  anchor,
  onChoose,
  onClose,
}: {
  label: string
  entries: readonly FontEntry[]
  value: TextFontId
  anchor: RefObject<HTMLSelectElement | null>
  onChoose: (id: TextFontId) => void
  onClose: (restoreFocus: boolean) => void
}) {
  const id = useId()
  const listRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(() => Math.max(0, entries.findIndex((entry) => entry.id === value)))
  const typed = useRef({ text: '', at: 0 })

  // Where the list sits: under the select, or above it when only above has
  // the room, inside the app's box (#653), as `position: fixed` offsets so
  // that no scrolling row or panel clips it (#416). Fixed offsets resolve
  // against the viewport unless an ancestor has a transform, filter or
  // containment, so the list is put at (0, 0) first and offset from where
  // that lands, as the shared menu does.
  useLayoutEffect(() => {
    const list = listRef.current
    const select = anchor.current
    if (list === null || select === null) return
    const at = select.getBoundingClientRect()
    list.style.minWidth = `${at.width}px`
    list.style.maxHeight = ''
    list.style.top = '0px'
    list.style.left = '0px'
    const origin = list.getBoundingClientRect()
    if (origin.width === 0 && origin.height === 0) return
    const bounds = placementBounds(
      { width: document.documentElement.clientWidth, height: window.innerHeight },
      select.closest('.app')?.getBoundingClientRect(),
    )
    const below = bounds.bottom - at.bottom - GAP
    const above = at.top - bounds.top - GAP
    const up = origin.height > below && above > below
    const height = Math.min(origin.height, up ? above : below)
    if (height < origin.height) list.style.maxHeight = `${Math.max(0, height)}px`
    const top = up ? at.top - GAP - height : at.bottom + GAP
    const left = Math.max(bounds.left, Math.min(at.left, bounds.right - origin.width))
    list.style.top = `${top - origin.top}px`
    list.style.left = `${left - origin.left}px`
  }, [anchor])

  // Focus moves into the list on open, and the highlighted entry is kept in view.
  useEffect(() => {
    listRef.current?.focus({ preventScroll: true })
  }, [])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  // A press outside, a resize, or a scroll that moves the select closes the
  // list unchanged, as a native popup closes.
  useEffect(() => {
    const select = anchor.current
    if (select === null) return
    const openedAt = select.getBoundingClientRect()
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target !== null && (listRef.current?.contains(target) || select.contains(target))) return
      onClose(false)
    }
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && listRef.current?.contains(event.target)) return
      const now = select.getBoundingClientRect()
      if (Math.abs(now.top - openedAt.top) <= 1 && Math.abs(now.left - openedAt.left) <= 1) return
      onClose(false)
    }
    const onResize = () => onClose(false)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('scroll', onScroll, { capture: true })
      window.removeEventListener('resize', onResize)
    }
  }, [anchor, onClose])

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const last = entries.length - 1
    // The keys the list uses are the list's: the app-wide shortcuts
    // (Space plays, the arrows step, letters such as M and X act on the
    // timeline) listen on the window, and must not also act on them.
    if (event.key !== 'Tab' && !event.ctrlKey && !event.metaKey) event.stopPropagation()
    // Moving the highlight by any other key starts the next search afresh.
    if (event.key.length > 1) typed.current = { text: '', at: 0 }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActive((index) => Math.min(last, index + 1))
        return
      case 'ArrowUp':
        event.preventDefault()
        setActive((index) => Math.max(0, index - 1))
        return
      case 'Home':
      case 'PageUp':
        event.preventDefault()
        setActive(0)
        return
      case 'End':
      case 'PageDown':
        event.preventDefault()
        setActive(last)
        return
      case 'Enter':
        event.preventDefault()
        onChoose(entries[active].id)
        return
      case ' ':
        event.preventDefault()
        // A space inside a type-ahead search is part of the name ("Comic Neue").
        if (typed.current.text !== '' && event.timeStamp - typed.current.at < TYPEAHEAD_MS) {
          typeahead(' ', event.timeStamp)
          return
        }
        onChoose(entries[active].id)
        return
      case 'Escape':
        event.preventDefault()
        onClose(true)
        return
      case 'Tab':
        // Focus moves on from the select, as it would from a native popup.
        onClose(true)
        return
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      typeahead(event.key, event.timeStamp)
    }
  }

  const typeahead = (key: string, at: number) => {
    const continuing = at - typed.current.at < TYPEAHEAD_MS
    const text = continuing ? typed.current.text + key : key
    typed.current = { text, at }
    const labels = entries.map((entry) => entry.label)
    // A new search starts after the highlighted entry, and so does one
    // letter pressed again and again, which steps through the names it
    // starts; a continuing search stays on its entry while it still matches.
    const cycling = text.length > 1 && [...text].every((char) => char === text[0])
    const match = typeaheadMatch(labels, cycling ? key : text, continuing && !cycling ? active : active + 1)
    if (match !== -1) setActive(match)
  }

  return (
    <div
      ref={listRef}
      className="font-select-list"
      role="listbox"
      aria-label={label}
      aria-activedescendant={`${id}-${active}`}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      {entries.map((entry, index) => (
        <div
          key={entry.stack === null ? `unavailable:${entry.id}` : entry.id}
          id={`${id}-${index}`}
          data-index={index}
          role="option"
          aria-selected={entry.id === value}
          className={`font-select-option${index === active ? ' font-select-option-active' : ''}`}
          style={entry.stack === null ? undefined : { fontFamily: entry.stack }}
          onPointerMove={() => setActive(index)}
          onClick={() => onChoose(entry.id)}
        >
          {entry.label}
        </div>
      ))}
    </div>
  )
}
