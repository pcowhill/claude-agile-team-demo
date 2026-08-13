/**
 * Chooses which Chromium binary Playwright should launch.
 *
 * Playwright pins one browser revision per release and expects `npx playwright
 * install` to have downloaded exactly that revision. Sandboxed agent
 * containers break that assumption: they pre-install some revision, point
 * PLAYWRIGHT_BROWSERS_PATH at it, and set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 so
 * the documented remedy cannot run. The result is a launch error naming a path
 * nobody asked for — which reads like "the browser tests are broken" rather
 * than "this container ships a different revision" (see issue #24).
 *
 * Resolution order, first hit wins:
 *
 *   1. PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH — an explicit override always wins.
 *   2. Playwright's own pinned revision, when it is actually installed. This
 *      is the CI case, and returning nothing there leaves Playwright's own
 *      selection alone (notably its headless-shell build).
 *   3. Any other Chromium revision already sitting in the browsers directory.
 *
 * When none of those yields a real binary this throws, because every remaining
 * outcome is a confusing failure later.
 */

import { readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Layouts a downloaded Chromium uses, relative to its revision directory.
 * Revisions differ here — 1194 ships `chrome-linux`, 1234 ships
 * `chrome-linux64` — so a resolver that hardcodes one breaks at the next
 * browser bump.
 */
const EXECUTABLE_LAYOUTS = [
  join('chrome-linux', 'chrome'),
  join('chrome-linux64', 'chrome'),
] as const

/** Revision directories to consider, e.g. `chromium-1194`. */
const REVISION_DIRECTORY = /^chromium-(\d+)$/

/** The pieces of the world this resolver reads, injected so it can be tested. */
export interface ChromiumEnvironment {
  /** What `chromium.executablePath()` reports — Playwright's pinned revision. */
  pinnedExecutable: string
  /** Explicit override, if the caller set one. */
  overridePath?: string
  /**
   * Whether a path is a regular file. Existence alone is not enough: a path
   * that names a revision's *directory* exists happily and then fails at
   * launch, which is the confusing failure this module exists to prevent.
   */
  isFile: (path: string) => boolean
  listDirectory: (path: string) => string[]
}

export class ChromiumNotFoundError extends Error {}

/**
 * The browsers directory holding a revision executable — two levels up from
 * the binary (`<browsers>/chromium-1234/chrome-linux64/chrome`). Derived from
 * the pinned path rather than from PLAYWRIGHT_BROWSERS_PATH so it also finds
 * the default cache directory when that variable is unset.
 */
function browsersDirectory(pinnedExecutable: string): string {
  return dirname(dirname(dirname(pinnedExecutable)))
}

/**
 * Installed Chromium executables in `directory`, newest revision first. A
 * revision directory without a recognizable executable is skipped rather than
 * treated as a candidate — a partial download must not win over a good one.
 */
function installedExecutables(
  directory: string,
  { isFile, listDirectory }: Pick<ChromiumEnvironment, 'isFile' | 'listDirectory'>,
): string[] {
  let entries: string[]
  try {
    entries = listDirectory(directory)
  } catch {
    // No browsers directory at all: nothing installed, which the caller
    // reports as "no usable Chromium" along with the paths it tried.
    return []
  }
  const revisions: { name: string; revision: number }[] = []
  for (const entry of entries) {
    const match = REVISION_DIRECTORY.exec(entry)
    if (match !== null) revisions.push({ name: entry, revision: Number(match[1]) })
  }
  revisions.sort((a, b) => b.revision - a.revision)
  return revisions.flatMap(({ name }) =>
    EXECUTABLE_LAYOUTS.map((layout) => join(directory, name, layout)).filter(isFile),
  )
}

/**
 * The executable to launch, or `undefined` to let Playwright choose for
 * itself — which is what should happen whenever its pinned revision is
 * installed.
 *
 * @throws ChromiumNotFoundError when no Chromium can be found anywhere.
 */
export function resolveChromiumExecutable(environment: ChromiumEnvironment): string | undefined {
  const { pinnedExecutable, overridePath, isFile } = environment

  if (overridePath !== undefined && overridePath !== '') {
    if (!isFile(overridePath)) {
      throw new ChromiumNotFoundError(
        `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH points at ${overridePath}, which is not a file.\n` +
          'Point it at the browser binary itself, not at the directory holding it.',
      )
    }
    return overridePath
  }

  if (isFile(pinnedExecutable)) return undefined

  const directory = browsersDirectory(pinnedExecutable)
  const fallback = installedExecutables(directory, environment)[0]
  if (fallback !== undefined) return fallback

  throw new ChromiumNotFoundError(
    `No Chromium available for Playwright.\n` +
      `Its pinned revision is not installed (${pinnedExecutable}), and ${directory} ` +
      `holds no other Chromium revision.\n` +
      'Install it with `npx playwright install chromium`, or — in an environment that ' +
      'pre-installs browsers and sets PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 — set ' +
      'PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to the browser binary.',
  )
}

function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** {@link resolveChromiumExecutable} against the real filesystem and env. */
export function resolveChromiumExecutableFromEnvironment(
  pinnedExecutable: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return resolveChromiumExecutable({
    pinnedExecutable,
    overridePath: env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    isFile: isRegularFile,
    listDirectory: readdirSync,
  })
}
