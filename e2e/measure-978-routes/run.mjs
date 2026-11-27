import { chromium } from '@playwright/test'
const [exe, dir] = process.argv.slice(2)
const browser = await chromium.launch({ executablePath: exe })
const routes = (process.env.ROUTES ?? 'plain,svg,copies,webgl').split(',')
for (const blur of ['0', '1']) for (const route of routes) for (let run = 1; run <= 3; run++) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  await page.goto(`http://127.0.0.1:8765/page.html?route=${route}&blur=${blur}&src=src.webm`)
  const r = await page.evaluate(() => window.measure())
  console.log(`ROUTE ${route} blur=${blur} run${run} ${JSON.stringify(r)}`)
  await page.close()
}
await browser.close()
