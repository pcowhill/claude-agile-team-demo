import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import guide from 'virtual:user-guide'
import type { GuideConstants } from '../lib/guide/constantNames'
import type { GuideLinkTarget } from '../lib/guide/document'
import { guideHash, headingElementId } from '../lib/guide/location'
import type { GuideLocation } from '../lib/guide/location'
import { GuideBlocks } from './GuideBlocks'
import { buildIndex, searchGuide } from './search'
import type { SearchHit } from './search'
import './UserGuide.css'

/**
 * The in-app user guide (#478, from the approved design #477 §1 and §5;
 * customer feedback #476): a panel docked beside the editor — not a modal,
 * so you can read what *Duck others* does while looking at the checkbox —
 * with a search field, a collapsible table of contents and the section
 * being read. Opened from Help ▾ → User guide…, F1, or a `#guide/…` URL.
 *
 * Lazily loaded (`React.lazy` in App): this module, the search index and
 * the compiled guide are one chunk that downloads on first opening, so the
 * editor's entry bundle does not grow — the same discipline the plugins
 * follow (ADR 0003), enforced by `npm run check:bundle`.
 *
 * Keys: the editor's shortcuts keep working while the panel is open because
 * they are inert only over controls that claim them, and everything
 * focusable here — the search field, the links, the buttons — does. Escape
 * with focus inside the panel closes it (or clears a search first); Escape
 * in the editor is not the panel's to answer.
 */

export interface UserGuideProps {
  location: GuideLocation
  constants: GuideConstants
  onNavigate: (location: GuideLocation) => void
  onClose: () => void
}

export const HELP_MENU_TRIGGER_SELECTOR = '.project-help-menu .menu-trigger'

export default function UserGuide({ location, constants, onNavigate, onClose }: UserGuideProps) {
  const section = guide.sections.find((candidate) => candidate.id === location.section) ?? guide.sections[0]
  const index = guide.sections.indexOf(section)
  const previous = index > 0 ? guide.sections[index - 1] : null
  const next = index < guide.sections.length - 1 ? guide.sections[index + 1] : null

  const [query, setQuery] = useState('')
  const [contentsOpen, setContentsOpen] = useState(true)
  const passages = useMemo(() => buildIndex(guide, constants), [constants])
  const hits = useMemo(() => searchGuide(passages, query), [passages, query])
  const searching = query.trim().length > 0

  const searchRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const titleId = useId()
  const contentsId = useId()
  const resultsId = useId()

  // Opening moves focus into the panel, on the search field: the first thing
  // a reader who came here to look something up wants, and a control that
  // claims the editor's keys so typing never drives the transport.
  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  // Arriving somewhere shows it: the heading for a deep link, the top of the
  // section otherwise. `scrollIntoView` is missing in jsdom, hence the guard.
  useEffect(() => {
    if (searching) return
    if (location.anchor !== null) {
      const heading = document.getElementById(headingElementId(section.id, location.anchor))
      if (heading !== null) {
        heading.scrollIntoView?.({ block: 'start' })
        return
      }
    }
    if (panelRef.current !== null) panelRef.current.scrollTop = 0
  }, [section.id, location.anchor, searching])

  const go = (target: GuideLinkTarget) => {
    setQuery('')
    onNavigate(target)
  }

  const openHit = (hit: SearchHit) => {
    go({ section: hit.passage.section, anchor: hit.passage.anchor })
    searchRef.current?.focus()
  }

  const close = () => {
    onClose()
    // Focus goes back to where the panel was opened from: Help ▾'s trigger,
    // the menu-button convention (#412). F1 has no button; the trigger is
    // still the nearest sensible home for focus.
    document.querySelector<HTMLElement>(HELP_MENU_TRIGGER_SELECTOR)?.focus()
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    if (searching && event.target === searchRef.current) {
      setQuery('')
      return
    }
    close()
  }

  const context = { section: section.id, constants, onNavigate: go }
  const linkTo = (target: GuideLinkTarget, label: string, current = false) => (
    <a
      href={guideHash(target)}
      aria-current={current ? 'page' : undefined}
      onClick={(event) => {
        event.preventDefault()
        go(target)
      }}
    >
      {label}
    </a>
  )

  return (
    <aside
      className="user-guide"
      aria-label="User guide"
      ref={panelRef}
      onKeyDown={onKeyDown}
      data-testid="user-guide"
    >
      <div className="user-guide-bar">
        <h2 className="user-guide-heading">User guide</h2>
        <button type="button" className="user-guide-close" aria-label="Close the user guide" onClick={close}>
          ✕
        </button>
      </div>
      <div className="user-guide-search" role="search">
        <input
          ref={searchRef}
          type="search"
          className="user-guide-search-field"
          aria-label="Search the user guide"
          placeholder="Search the guide"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && hits.length > 0) {
              event.preventDefault()
              openHit(hits[0])
            }
          }}
          aria-controls={searching ? resultsId : undefined}
        />
      </div>
      {searching ? (
        <div className="user-guide-results" id={resultsId}>
          <p className="user-guide-results-count" role="status">
            {hits.length === 0
              ? `Nothing in the guide matches “${query.trim()}”.`
              : `${hits.length} result${hits.length === 1 ? '' : 's'} — Enter opens the first.`}
          </p>
          {hits.length > 0 && (
            <ol className="user-guide-hit-list" aria-label="Search results">
              {hits.map((hit, hitIndex) => (
                <li key={`${hit.passage.section}/${hit.passage.anchor ?? ''}/${hitIndex}`}>
                  <button type="button" className="user-guide-hit" onClick={() => openHit(hit)}>
                    <span className="user-guide-hit-where">
                      {hit.passage.sectionTitle}
                      {hit.passage.heading !== null && hit.passage.kind !== 'title' && (
                        <>
                          {' › '}
                          {hit.passage.heading}
                        </>
                      )}
                    </span>
                    {hit.passage.kind === 'body' && (
                      <span className="user-guide-hit-snippet">
                        <Highlighted text={hit.snippet} ranges={hit.ranges} />
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : (
        <>
          <nav className="user-guide-contents" aria-label="Contents">
            <button
              type="button"
              className="user-guide-contents-toggle"
              aria-expanded={contentsOpen}
              aria-controls={contentsId}
              onClick={() => setContentsOpen((open) => !open)}
            >
              <span aria-hidden="true">{contentsOpen ? '▾' : '▸'}</span> Contents
            </button>
            {contentsOpen && (
              <ol id={contentsId} className="user-guide-toc">
                {guide.sections.map((entry) => (
                  <li key={entry.id}>
                    {linkTo({ section: entry.id, anchor: null }, entry.title, entry.id === section.id)}
                    {entry.id === section.id && entry.headings.some((heading) => heading.level === 2) && (
                      <ol className="user-guide-toc-headings">
                        {entry.headings
                          .filter((heading) => heading.level === 2)
                          .map((heading) => (
                            <li key={heading.anchor}>
                              {linkTo(
                                { section: entry.id, anchor: heading.anchor },
                                heading.text,
                                location.anchor === heading.anchor,
                              )}
                            </li>
                          ))}
                      </ol>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </nav>
          <article className="user-guide-article" aria-labelledby={titleId}>
            <h2 id={titleId}>{section.title}</h2>
            <GuideBlocks blocks={section.blocks} context={context} />
          </article>
          <nav className="user-guide-neighbours" aria-label="Neighbouring sections">
            {previous !== null && (
              <span>
                ← {linkTo({ section: previous.id, anchor: null }, previous.title)}
              </span>
            )}
            {next !== null && (
              <span className="user-guide-next">
                {linkTo({ section: next.id, anchor: null }, next.title)} →
              </span>
            )}
          </nav>
        </>
      )}
    </aside>
  )
}

/** A snippet with its matched ranges wrapped in <mark>. */
function Highlighted({ text, ranges }: { text: string; ranges: readonly [number, number][] }) {
  const parts = []
  let cursor = 0
  for (const [from, to] of ranges) {
    if (from > cursor) parts.push(text.slice(cursor, from))
    parts.push(<mark key={from}>{text.slice(from, to)}</mark>)
    cursor = to
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts
}
