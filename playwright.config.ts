import { chromium, defineConfig, devices } from '@playwright/test'
import { resolveChromiumExecutableFromEnvironment } from './tools/chromiumExecutable.ts'

// The dev server serves under the same base path as GitHub Pages
// (vite.config.ts), so e2e URLs mirror production paths.
//
// Full-suite runs and parallel load (#365): a sizeable minority of these
// specs assert real-time media behavior — wall-clock exports, element
// clocks, MediaRecorder captures — and they lose their deadlines when the
// suite oversubscribes the machine. Measured 2026-09-05 on a 4-core
// container: at the default worker count (50% of cores → 2) the full suite
// passed 163/163 three times consecutively, while `--workers=8` (2× the
// cores) failed 5 and then 2 real-time specs across two runs, different
// specs each time (#370 tracks the remaining class). So: run the full suite
// at the default worker count, and read a real-time media failure in a
// full-suite run with suspicion before attributing it to your diff — if the
// spec passes alone and fails identically on unmodified main, it is
// environment load, which belongs on an issue (#365/#370), not in your PR's
// evidence as a regression. CI is unaffected: its runners stayed green
// throughout, and it retries (`retries: 2` below), which local runs
// deliberately do not.
const PORT = 4173
const BASE_URL = `http://localhost:${PORT}/claude-agile-team-demo/`

// Which Chromium to launch. Undefined means "Playwright's own", which is the
// normal case (CI included); a path means this environment ships a browser
// whose revision differs from the pinned one. See tools/chromiumExecutable.ts.
const executablePath = resolveChromiumExecutableFromEnvironment(chromium.executablePath())

// Firefox (#586). The customer asked for Firefox to be tested as a
// first-class browser (#581), and every Firefox defect so far reached them
// under a Chromium-only CI (#579, #584, #585, #593). CI always runs the
// `firefox` project. Locally it is opt-in, with `E2E_FIREFOX=1`, because
// session containers ship Chromium only. A default `npx playwright test`
// that also asked for Firefox would fail every local run at launch. To run
// it, install Playwright's Firefox once (#586 has the steps for a session
// container) and use `E2E_FIREFOX=1 npx playwright test --project=firefox`.
const includeFirefox = Boolean(process.env.CI) || process.env.E2E_FIREFOX === '1'

/**
 * What the `firefox` project does not run yet, each entry with the issue
 * that owns it. These lists are meant to shrink: a PR that fixes the cause
 * removes the entries in the same change. A whole file is listed only when
 * none of its tests can run under Firefox; otherwise the tests are listed by
 * title. The audit that produced them is in #586's PR.
 */
const FIREFOX_EXCLUDED_FILES: ReadonlyArray<{ file: string; why: string }> = [
]
const FIREFOX_EXCLUDED_TESTS: ReadonlyArray<{ title: string; why: string }> = [
  { title: 'selecting MP4 exports a file that demuxes as MP4 (#114)', why: 'Chromium-only: Firefox\'s MediaRecorder cannot record MP4, so the picker rightly omits it (#114 covers that case)' },
]

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(executablePath === undefined ? {} : { launchOptions: { executablePath } }),
      },
    },
    ...(includeFirefox ? [firefoxProject()] : []),
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})

function firefoxProject() {
  return {
    name: 'firefox',
    testIgnore: FIREFOX_EXCLUDED_FILES.map(({ file }) => `**/${file}`),
    grepInvert: FIREFOX_EXCLUDED_TESTS.map(({ title }) => new RegExp(escapeRegExp(title))),
    use: {
      ...devices['Desktop Firefox'],
      launchOptions: {
        // Firefox's counterpart of Chromium's fake-media flags: a synthetic
        // camera and microphone, and no permission prompt.
        firefoxUserPrefs: {
          'media.navigator.streams.fake': true,
          'media.navigator.permission.disabled': true,
        },
      },
    },
  }
}
