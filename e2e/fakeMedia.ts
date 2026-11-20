import type { test as baseTest } from '@playwright/test'

/**
 * A synthetic camera and microphone with no permission prompt, for the
 * browser running the spec (#599).
 *
 * The recording specs used to set `test.use({ launchOptions: { args: […] } })`
 * with Chromium's fake-media flags. A `launchOptions` set that way *replaces*
 * the project's own. Under the `firefox` project, Firefox was then launched
 * with Chromium flags and without its fake-media prefs, and failed to start.
 * Under `chromium`, it also dropped the project's `executablePath`, which is
 * why every such spec re-resolved it.
 *
 * This extends the project's launch options instead of replacing them.
 * Chromium gets its flags, plus any the spec adds (the screen specs'
 * `--auto-select-tab-capture-source-by-title`). Firefox keeps the project's
 * `firefoxUserPrefs` (`playwright.config.ts`), which are its counterpart:
 * `media.navigator.streams.fake` and `media.navigator.permission.disabled`.
 */
export function withFakeMedia(test: typeof baseTest, chromiumArgs: readonly string[] = []) {
  test.use({
    launchOptions: [
      async ({ browserName, launchOptions }, provide) => {
        if (browserName !== 'chromium') {
          await provide(launchOptions)
          return
        }
        await provide({
          ...launchOptions,
          args: [
            ...(launchOptions.args ?? []),
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            ...chromiumArgs,
          ],
        })
      },
      { scope: 'worker' },
    ],
  })
}
