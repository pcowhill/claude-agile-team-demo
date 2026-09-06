import { useEffect, useRef, useState } from 'react'
import './NameField.css'

interface NameFieldProps {
  label: string
  value: string
  onCommit: (value: string) => void
  onCancel: () => void
}

/**
 * The inline rename field (#405, shared with the media library since #404):
 * takes the name's place in its row, opens with the current name selected,
 * and commits on Enter or blur — once, so
 * an Enter that unmounts it cannot commit again through the blur that
 * follows. Escape cancels; an empty or whitespace-only name is a cancel
 * too, so the row keeps its name rather than round-tripping a rejection
 * through the reducer.
 */
export function NameField({ label, value, onCommit, onCancel }: NameFieldProps) {
  const [draft, setDraft] = useState(value)
  const settled = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const settle = (commit: boolean) => {
    if (settled.current) return
    settled.current = true
    const trimmed = draft.trim()
    if (commit && trimmed !== '') onCommit(trimmed)
    else onCancel()
  }

  return (
    <input
      ref={inputRef}
      type="text"
      className="clip-name-field"
      aria-label={label}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => settle(true)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          settle(true)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          settle(false)
        }
      }}
    />
  )
}
