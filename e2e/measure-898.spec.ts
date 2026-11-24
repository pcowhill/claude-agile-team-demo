import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { chooseClipAction } from './clipMenu'
import { ADD_SLATE, chooseFromAddMenu } from './timelineMenu'

/**
 * MEASUREMENT ONLY (#898), not a test of record: logs, for the first
 * composed frames of a real export, each overlay replay element's state and
 * what the export canvas drew for it. Removed before the PR.
 */

async function recordWebm(page: Page, color: string, ms: number): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ({ color, ms }) => {
      const canvas = document.createElement('canvas')
      canvas.width = 320
      canvas.height = 360
      const ctx = canvas.getContext('2d')!
      const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/webm' })
      const chunks: Blob[] = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      const stopped = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve()
      })
      recorder.start()
      const start = performance.now()
      await new Promise<void>((resolve) => {
        const draw = () => {
          ctx.fillStyle = color
          ctx.fillRect(0, 0, canvas.width, canvas.height)
          if (performance.now() - start > ms) resolve()
          else requestAnimationFrame(draw)
        }
        draw()
      })
      recorder.stop()
      await stopped
      const buffer = await new Blob(chunks, { type: 'video/webm' }).arrayBuffer()
      let binary = ''
      for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
      return btoa(binary)
    },
    { color, ms },
  )
  return Buffer.from(base64, 'base64')
}

test('MEASURE #898: overlay element state and draw decision on the first export frames', async ({
  page,
  browserName,
}) => {
  test.setTimeout(120_000)
  await page.goto('./')
  await chooseFromAddMenu(page, ADD_SLATE)
  const slateDuration = page.getByRole('spinbutton', {
    name: 'Duration of Color slate at position 1 in seconds',
  })
  await slateDuration.fill('2')
  await slateDuration.blur()
  const left = await recordWebm(page, 'rgb(220, 40, 40)', 2500)
  const right = await recordWebm(page, 'rgb(40, 200, 40)', 2500)
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'left.webm', mimeType: 'video/webm', buffer: left },
    { name: 'right.webm', mimeType: 'video/webm', buffer: right },
  ])
  await expect(page.getByRole('list', { name: 'Imported clips' }).getByRole('listitem')).toHaveCount(2)
  await chooseClipAction(page, 'left.webm', 'Add as overlay')
  await chooseClipAction(page, 'right.webm', 'Add as overlay')
  const urls = await Promise.all(
    [0, 1].map((i) =>
      page.getByTestId(`preview-overlay-${i}`).evaluate((element) => (element as HTMLVideoElement).src),
    ),
  )

  await page.evaluate((urls: string[]) => {
    type Snap = { id: number; rs: number; seeking: boolean; paused: boolean; w: number; t: number }
    const log: { tick: number; phase: string; snaps?: Snap[]; draws?: string[]; seek?: string }[] = []
    ;(window as unknown as { __log: typeof log }).__log = log
    const overlayEls: HTMLMediaElement[] = []
    let exportCanvas: HTMLCanvasElement | null = null
    let tick = -1
    let draws: string[] = []
    const snap = () =>
      overlayEls.map((el, id) => ({
        id,
        rs: el.readyState,
        seeking: el.seeking,
        paused: el.paused,
        w: (el as HTMLVideoElement).videoWidth,
        t: Number(el.currentTime.toFixed(3)),
      }))
    const realCapture = HTMLCanvasElement.prototype.captureStream
    HTMLCanvasElement.prototype.captureStream = function (this: HTMLCanvasElement, rate?: number) {
      if (exportCanvas === null && !this.isConnected) {
        exportCanvas = this
        tick = 0
        log.push({ tick, phase: 'recorder-canvas', snaps: snap() })
      }
      return realCapture.call(this, rate)
    }
    const srcGet = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src')!.get!
    const srcSet = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src')!.set!
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      configurable: true,
      get() {
        return srcGet.call(this)
      },
      set(value: string) {
        if (!this.isConnected && urls.includes(value) && !overlayEls.includes(this)) overlayEls.push(this)
        srcSet.call(this, value)
      },
    })
    const ctGet = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')!.get!
    const ctSet = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')!.set!
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
      configurable: true,
      get() {
        return ctGet.call(this)
      },
      set(value: number) {
        const id = overlayEls.indexOf(this)
        const from = ctGet.call(this)
        const rsBefore = this.readyState
        ctSet.call(this, value)
        if (id >= 0 && tick >= 0 && tick < 12) {
          log.push({
            tick,
            phase: 'seek',
            seek: `overlay ${id}: ${from} -> ${value}; rs ${rsBefore} -> ${this.readyState}, seeking ${this.seeking}`,
          })
        }
      },
    })
    const realPlay = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      const id = overlayEls.indexOf(this)
      if (id >= 0 && tick >= 0 && tick < 12) log.push({ tick, phase: 'play', seek: `overlay ${id} play()` })
      return realPlay.call(this)
    }
    const realDraw = CanvasRenderingContext2D.prototype.drawImage
    CanvasRenderingContext2D.prototype.drawImage = function (
      this: CanvasRenderingContext2D,
      ...args: unknown[]
    ) {
      if (this.canvas === exportCanvas && tick >= 0 && tick < 12) {
        const source = args[0]
        const id = overlayEls.indexOf(source as HTMLMediaElement)
        draws.push(
          id >= 0
            ? `overlay ${id} live`
            : source instanceof HTMLCanvasElement
              ? `canvas ${source.width}x${source.height}`
              : String((source as { constructor: { name: string } }).constructor.name),
        )
      }
      return (realDraw as (...a: unknown[]) => void).apply(this, args)
    } as typeof CanvasRenderingContext2D.prototype.drawImage
    const realRaf = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (callback: FrameRequestCallback) =>
      realRaf((time) => {
        const before = tick >= 0 && tick < 12 ? snap() : null
        draws = []
        callback(time)
        if (before !== null && draws.length > 0) {
          log.push({ tick, phase: 'frame', snaps: before, draws })
          tick += 1
        }
      })
  }, urls)

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Project…' }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  await readFile(await download.path())
  const log = await page.evaluate(() => (window as unknown as { __log: unknown[] }).__log)
  for (const line of log) console.log(`[${browserName}] MEASURE-898 ${JSON.stringify(line)}`)
  expect(log.length).toBeGreaterThan(0)
})
