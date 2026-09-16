import { defineConfig } from '@playwright/test'
import base from './playwright.config.ts'

/**
 * The user guide's screenshot retake (#483, design #477 §7): `npm run
 * guide:screenshots` drives the app through Quick Start's steps on the
 * committed fixture clips and rewrites `docs/guide/images/`. A second
 * Playwright config rather than a spec under the main one, because the main
 * suite (`npm run test:e2e`, CI) must never rewrite the docs: its testDir
 * matches `*.spec.ts` only, and these two files carry no such suffix.
 *
 * Same browser, base URL and dev server as the e2e suite (playwright.config.ts),
 * so a screenshot shows exactly what the tests exercise. One worker and no
 * retries: the run writes files, and two of it at once would race.
 * `npm run guide:fixtures` re-records the fixture clips the screenshots
 * import; they are committed so a retake changes only what the UI changed.
 */
export default defineConfig({
  ...base,
  testDir: './e2e',
  testMatch: ['guide-screenshots.ts', 'guide-fixtures.ts'],
  outputDir: './node_modules/.tmp/guide-screenshots',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
})
