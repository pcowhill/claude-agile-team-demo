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
// Headless Firefox has no display to share: its getDisplayMedia rejects with
// NotFoundError ("The object can not be found here.", measured in CI run
// 44760993364 for #599), and Chromium's --auto-select-tab-capture-source-by-
// title has no Firefox counterpart. Headed Firefox under xvfb, with the same
// fake-media prefs, does grant a screen (#580), so this is the CI's
// environment, not the product.
const NO_HEADLESS_SCREEN = 'Chromium-only: headless Firefox has no screen for getDisplayMedia to share (#599)'
const FIREFOX_EXCLUDED_FILES: ReadonlyArray<{ file: string; why: string }> = [
  { file: 'record-screen.spec.ts', why: NO_HEADLESS_SCREEN },
  { file: 'record-screen-camera.spec.ts', why: NO_HEADLESS_SCREEN },
]
const FIREFOX_EXCLUDED_TESTS: ReadonlyArray<{ title: string; why: string }> = [
  { title: 'a screen + camera take paused ten times delivers two clips whose lengths agree within three frames (#514)', why: NO_HEADLESS_SCREEN },
  { title: 'a pause is absent from the file: one clip, shorter than the wall time, and Space toggles it (#514)', why: '#801: the paused take decodes to about half its recorded length (0.87–0.89 s of ~2 s, run 44790911804)' },
  { title: 'selecting MP4 exports a file that demuxes as MP4 (#114)', why: 'Chromium-only: Firefox\'s MediaRecorder cannot record MP4, so the picker rightly omits it (#114 covers that case)' },
]

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export default defineConfig({
  testDir: './e2e',
  // MEASUREMENT ONLY (#801): run just the measurement spec, with stdout in the log.
  testMatch: '**/measure-801.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
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
