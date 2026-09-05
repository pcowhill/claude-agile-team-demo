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
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
