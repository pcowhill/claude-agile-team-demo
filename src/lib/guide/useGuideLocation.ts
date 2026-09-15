import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_GUIDE_LOCATION,
  guideHash,
  isGuideHash,
  parseGuideHash,
  sameGuideLocation,
} from './location'
import type { GuideLocation } from './location'

/**
 * The guide panel's place, kept in step with the URL hash (#478, design
 * #477 §4). The hash is the record: navigating the panel writes it (one
 * history entry per place, so Back walks the panel's history), loading
 * the page with one opens the panel there, and Back or Forward landing on
 * one — or off one — moves the panel through `hashchange`.
 *
 * Closing pushes a hash-less URL rather than rewriting history, so Back
 * after closing reopens the guide where it was — the same as any page.
 * Reopening without a place goes back to the last one read, or Quick Start.
 */
export interface GuideNavigation {
  location: GuideLocation | null
  /** Open at the last place read (Quick Start the first time). */
  open: () => void
  navigate: (location: GuideLocation) => void
  close: () => void
}

export function useGuideLocation(): GuideNavigation {
  const [location, setLocation] = useState<GuideLocation | null>(() =>
    parseGuideHash(window.location.hash),
  )
  const lastRead = useRef<GuideLocation>(location ?? DEFAULT_GUIDE_LOCATION)
  if (location !== null) lastRead.current = location

  useEffect(() => {
    const onHashChange = () => {
      const next = parseGuideHash(window.location.hash)
      setLocation((current) => (sameGuideLocation(current, next) ? current : next))
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const navigate = useCallback((next: GuideLocation) => {
    setLocation((current) => (sameGuideLocation(current, next) ? current : next))
    const hash = guideHash(next)
    if (window.location.hash !== hash) window.location.hash = hash
  }, [])

  const open = useCallback(() => navigate(lastRead.current), [navigate])

  const close = useCallback(() => {
    setLocation(null)
    if (isGuideHash(window.location.hash)) {
      window.history.pushState(null, '', window.location.pathname + window.location.search)
    }
  }, [])

  return { location, open, navigate, close }
}
