import type { GuideLinkTarget } from './document.ts'

/**
 * The guide's place in the URL (#478, design #477 §4): `#guide/<section>`
 * or `#guide/<section>/<anchor>`, so a section is bookmarkable, a link in
 * an issue opens the panel on the right heading, and the browser's Back
 * button walks the panel's history. A hash that is not the guide's is left
 * alone — the app has no other hash routes today, but this module must not
 * be the reason it never can.
 */
export type GuideLocation = GuideLinkTarget

export const GUIDE_HASH_PREFIX = '#guide'

/** Where "User guide…" and F1 open the panel when it has no place yet. */
export const DEFAULT_GUIDE_LOCATION: GuideLocation = { section: 'quick-start', anchor: null }

const SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function isGuideHash(hash: string): boolean {
  return hash === GUIDE_HASH_PREFIX || hash.startsWith(`${GUIDE_HASH_PREFIX}/`)
}

/**
 * The location a hash names, or null when the hash is not the guide's.
 * A bare `#guide` is the default location; malformed segments are treated
 * as the default too rather than as an error — a mistyped bookmark should
 * open the guide, not nothing.
 */
export function parseGuideHash(hash: string): GuideLocation | null {
  if (!isGuideHash(hash)) return null
  const segments = hash
    .slice(GUIDE_HASH_PREFIX.length)
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => decodeURIComponent(segment))
  const [section, anchor] = segments
  if (section === undefined || !SEGMENT.test(section)) return DEFAULT_GUIDE_LOCATION
  if (anchor === undefined || !SEGMENT.test(anchor)) return { section, anchor: null }
  return { section, anchor }
}

export function guideHash(location: GuideLocation): string {
  const path = location.anchor === null ? location.section : `${location.section}/${location.anchor}`
  return `${GUIDE_HASH_PREFIX}/${path}`
}

/** The DOM id of a section heading in the rendered panel, unique across the document. */
export function headingElementId(section: string, anchor: string): string {
  return `guide-${section}-${anchor}`
}

export function sameGuideLocation(a: GuideLocation | null, b: GuideLocation | null): boolean {
  if (a === null || b === null) return a === b
  return a.section === b.section && a.anchor === b.anchor
}
