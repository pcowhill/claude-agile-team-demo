import { describe, expect, it } from 'vitest'
import {
  ChromiumNotFoundError,
  resolveChromiumExecutable,
  type ChromiumEnvironment,
} from './chromiumExecutable.ts'

const PINNED = '/opt/pw-browsers/chromium-1234/chrome-linux64/chrome'

/**
 * A filesystem described by the paths that exist. Directory listings are
 * derived from them, so a test cannot accidentally describe a revision
 * directory that lists an executable it does not contain.
 */
function environment(
  paths: string[],
  overridePath?: string,
): ChromiumEnvironment & { pinnedExecutable: string } {
  return {
    pinnedExecutable: PINNED,
    overridePath,
    isFile: (path) => paths.includes(path),
    listDirectory: (directory) => {
      const prefix = `${directory}/`
      const children = paths
        .filter((path) => path.startsWith(prefix))
        .map((path) => path.slice(prefix.length).split('/')[0])
      if (children.length === 0) throw new Error(`ENOENT: ${directory}`)
      return [...new Set(children)]
    },
  }
}

describe('resolveChromiumExecutable', () => {
  it('defers to Playwright when its pinned revision is installed', () => {
    // The CI case. Returning a path here would override Playwright's own
    // choice of build for no reason.
    expect(resolveChromiumExecutable(environment([PINNED]))).toBeUndefined()
  })

  it('defers to Playwright when only the pinned headless shell is installed', () => {
    // `playwright install --only-shell chromium` is a documented CI setup, and
    // Playwright launches from it happily. Throwing here refused a Chromium
    // that was sitting right there (issue #27).
    const shell =
      '/opt/pw-browsers/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell'
    expect(resolveChromiumExecutable(environment([shell]))).toBeUndefined()
  })

  it('recognizes either headless shell layout, since revisions disagree about it', () => {
    // Older revisions ship chrome-linux/headless_shell instead.
    const shell = '/opt/pw-browsers/chromium_headless_shell-1234/chrome-linux/headless_shell'
    expect(resolveChromiumExecutable(environment([shell]))).toBeUndefined()
  })

  it('only defers to a headless shell matching the pinned revision', () => {
    // A stale shell from an earlier browser bump says nothing about whether
    // Playwright's current pin can launch, so it must not suppress the scan.
    const stale =
      '/opt/pw-browsers/chromium_headless_shell-1194/chrome-headless-shell-linux64/chrome-headless-shell'
    const usable = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
    expect(resolveChromiumExecutable(environment([stale, usable]))).toBe(usable)
  })

  it('falls back to another installed revision when the pinned one is missing', () => {
    const installed = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
    expect(resolveChromiumExecutable(environment([installed]))).toBe(installed)
  })

  it('accepts either directory layout, since revisions disagree about it', () => {
    // 1194 ships chrome-linux; 1234 ships chrome-linux64.
    const installed = '/opt/pw-browsers/chromium-1300/chrome-linux64/chrome'
    expect(resolveChromiumExecutable(environment([installed]))).toBe(installed)
  })

  it('prefers the newest installed revision', () => {
    const older = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
    const newer = '/opt/pw-browsers/chromium-1210/chrome-linux/chrome'
    expect(resolveChromiumExecutable(environment([older, newer]))).toBe(newer)
    // Numerically, not lexically: '1194' sorts after '999' as a string.
    const oldest = '/opt/pw-browsers/chromium-999/chrome-linux/chrome'
    expect(resolveChromiumExecutable(environment([oldest, older]))).toBe(older)
  })

  it('skips a revision directory with no usable executable', () => {
    // An interrupted download must not shadow a working browser.
    const partial = '/opt/pw-browsers/chromium-1300/DOWNLOAD_IN_PROGRESS'
    const usable = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
    expect(resolveChromiumExecutable(environment([partial, usable]))).toBe(usable)
  })

  it('never hands back a shell binary from the fallback scan', () => {
    // The scan supplies `executablePath`, which must be a full browser: a
    // headless shell cannot serve a headed launch. A shell from a revision
    // other than the pinned one is therefore no help at all — neither as a
    // deferral (wrong revision) nor as a scan result (wrong kind of binary).
    const shell =
      '/opt/pw-browsers/chromium_headless_shell-1194/chrome-headless-shell-linux64/chrome-headless-shell'
    const ffmpeg = '/opt/pw-browsers/ffmpeg-1011/chrome-linux/chrome'
    expect(() => resolveChromiumExecutable(environment([shell, ffmpeg]))).toThrow(
      ChromiumNotFoundError,
    )
  })

  it('honors an explicit override ahead of the pinned revision', () => {
    const override = '/somewhere/else/chrome'
    expect(resolveChromiumExecutable(environment([PINNED, override], override))).toBe(override)
  })

  it('ignores an empty override, which is how an unset variable often arrives', () => {
    expect(resolveChromiumExecutable(environment([PINNED], ''))).toBeUndefined()
  })

  it('rejects an override that is not a file instead of failing at launch', () => {
    // Pointing at the directory rather than the binary is the easy mistake —
    // and it survives a bare existence check, then dies at browserType.launch
    // with a message that never mentions the variable that caused it.
    const revisionDirectory = '/opt/pw-browsers/chromium-1194/chrome-linux'
    const binary = `${revisionDirectory}/chrome`
    expect(() => resolveChromiumExecutable(environment([binary], revisionDirectory))).toThrow(
      /PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH/,
    )
  })

  it('reports both remedies when no Chromium exists at all', () => {
    let message = ''
    try {
      resolveChromiumExecutable(environment([]))
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('npx playwright install chromium')
    expect(message).toContain('PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH')
    // Naming the paths it looked at is what turns this from a dead end into
    // something a stateless session can act on.
    expect(message).toContain(PINNED)
    expect(message).toContain('/opt/pw-browsers')
  })

  it('never silently returns a path that does not exist', () => {
    // The failure mode this whole module exists to prevent: a stale path
    // reaching browserType.launch and surfacing as "Executable doesn't exist".
    const environments: ChromiumEnvironment[] = [
      environment(['/opt/pw-browsers/chromium-1194/chrome-linux/chrome']),
      environment([PINNED]),
      environment([PINNED, '/override/chrome'], '/override/chrome'),
    ]
    for (const candidate of environments) {
      const resolved = resolveChromiumExecutable(candidate)
      if (resolved !== undefined) expect(candidate.isFile(resolved)).toBe(true)
    }
  })
})
