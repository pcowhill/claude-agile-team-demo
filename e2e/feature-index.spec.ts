import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { resolveChromiumExecutableFromEnvironment } from '../tools/chromiumExecutable'
import { chooseClipAction, openClipMenu } from './clipMenu'
import { chooseFromFileMenu } from './fileMenu'
import { openPicture } from './pictureDisclosure'
import { ADD_SLATE, ADD_TEXT, openAddMenu, subtitleStyleToggle } from './timelineMenu'
import { chooseEffect, openEffectMenu, openRowMenu } from './timelineRowMenu'
import { sineWav } from './sineWav'

/**
 * The guide's contract with the customer's requirement that no feature may
 * exist in the app the guide does not mention (#476, design #477 §6.1, issue
 * #485): a walk of the running editor collects every control it can see, and
 * every one must be an entry in `docs/guide/feature-index.md`.
 *
 * **The surfaces this walk opens.** It cannot find a control behind a menu it
 * never opens, so the list is written here rather than left to be inferred —
 * a session that adds a new surface adds it here too:
 *
 * - the header: File ▾ (and its Export ▸ submenu), Help ▾, Save, Export
 *   Project…
 * - the media library: its own controls, Record ▾, View ▾, and a row's ⋯
 * - the preview: the transport, Frame ▾
 * - the timeline: the header controls and the Canvas preset, each section's
 *   heading controls, and for every row — expanded — its inline controls,
 *   its Picture disclosure, its ⋯ menu and its + Effect ▾ menu
 * - Add ▾, and the Subtitle style disclosure it reveals
 * - the Settings dialog, the Plugins dialog, and the Export project dialog
 *   on each of its formats
 * - the keyboard cheat sheet, for the shortcut combos, together with the
 *   shortcut hints the menus show
 * - the five visual editors (#507): Crop, Zoom, Overlay, Text and
 *   Redaction, each from the Adjust visually… button on the row it edits
 * - the recording dialog, in all three of its states (#514) — counting
 *   down, recording, and paused
 * - the Save mode dialog, and the Open project dialog it writes the file
 *   for, both before and after its clips are re-linked
 * - the discard guard (#520), in both its wordings: one dialog whose
 *   confirm button is named for what it is about to do, so New Project and
 *   Open Project… over an unsaved edit show different buttons over it
 *
 * Several controls exist only under a condition (`troubleshooting.md`, *A
 * control is missing*), so the walk creates the condition: it adds a
 * transition between two entries, enables both plugins, turns Duck others
 * on, sets the export marks, expands the preview, and — since #507 — adds a
 * zoom and a redaction region, because neither a zoom's fields nor a
 * region's exist until one has been made. Since #525 it adds the other two
 * + Effect ▾ effects for the same reason: a speed segment's three fields
 * and a pause's two exist only once the effect does.
 *
 * **What it deliberately does not open** — and so cannot check:
 *
 * - the **screen, webcam and screen + camera** recording sources. The
 *   display-capture prompt cannot be auto-answered the way the fake
 *   microphone can, and the dialog's own controls are the same three
 *   states whichever source filled it.
 * - the **user guide panel** itself, which is documentation rather than
 *   product surface (#485's own decision).
 *
 * Their controls may be indexed; the walk neither requires nor forbids an
 * entry for them, and it never fails for an entry it did not meet, so extra
 * entries are allowed by design.
 *
 * **What it does not judge**: whether a page explains a feature well. It
 * checks that an index entry exists. The explaining is the content PRs' job
 * and the reviewer's.
 */

/**
 * Chromium's fake media device, so the walk can open the recording dialog
 * (#507): `getUserMedia` delivers a generated tone and the permission is
 * auto-granted, which is the idiom `record-voice-over.spec.ts` and the other
 * recording specs use. The executable resolution mirrors playwright.config.ts,
 * which per-file launch options would otherwise drop.
 */
const executablePath = resolveChromiumExecutableFromEnvironment(chromium.executablePath())
test.use({
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    ...(executablePath === undefined ? {} : { executablePath }),
  },
})

/** Stands in for a clip, row or section name while a label is normalized. */
const ELEMENT = '‹element›'

/**
 * How a control's accessible name is turned into the name the Feature Index
 * lists. Every rule exists because the app's name carries something that is
 * not part of the control: the element it acts on, a unit, or live state.
 * Applied in order.
 */
const SHAPE_RULES: { pattern: RegExp; replacement: string; why: string }[] = [
  {
    pattern: / slider$/,
    replacement: '',
    why: 'a number field and its range slider share a name; the slider adds the word',
  },
  {
    pattern: / \((?:percent|0 to 1|fraction of frame (?:width|height))\)$/,
    replacement: '',
    why: 'the unit is told to a screen reader, and is not part of the name',
  },
  {
    pattern: / in (?:seconds|pixels|frames per second)$/,
    replacement: '',
    why: 'as above — a unit, not a name',
  },
  {
    pattern: / \(currently [^)]*\)$/,
    replacement: '',
    why: 'Rotate says the angle it is at now, which changes as it is used',
  },
  {
    pattern: / \(unsaved changes\)$/,
    replacement: '',
    why: "Save says whether the project is dirty, which is state, not the control's name",
  },
  {
    pattern: / \(\d+:\d\d(?:\.\d+)? – \d+:\d\d(?:\.\d+)?\)$/,
    replacement: '',
    why: "the Marked range option names the marks' own times, which move with them",
  },
  {
    pattern: /between position \d+ and \d+/,
    replacement: '',
    why: 'a transition button names the two entries it sits between',
  },
  {
    pattern: new RegExp(`\\b(?:of|for|on|from) ${ELEMENT}`, 'g'),
    replacement: '',
    why: 'the element a row control acts on, with the preposition that introduces it (Remove zoom 1 *from* ‹element›)',
  },
  {
    pattern: new RegExp(ELEMENT, 'g'),
    replacement: '',
    why: 'the element named anywhere else in the label (Move ‹element› up)',
  },
  {
    pattern: / region \d+/,
    replacement: ' region',
    why: "a redaction control names which of an element's regions it edits, which is a position in a list rather than part of the control (#492)",
  },
  {
    pattern: /\b([Zz])oom \d+/g,
    replacement: '$1oom',
    why: "the same shape one effect up: a zoom control names which of an entry's zooms it edits, a position in a list rather than part of the control (#421). Both cases, because Remove says it in lower case",
  },
  {
    pattern: /\b([Ss])peed segment \d+/g,
    replacement: '$1peed segment',
    why: "the same shape again: a speed segment's fields name which of an entry's segments they edit (#525). Both cases, because Remove says it in lower case. The stem keeps the effect's whole name — the entry is Speed segment factor, not Speed factor, because Speed segment is what the + Effect ▾ item and the row both call it",
  },
  {
    pattern: /\b([Pp])ause \d+/g,
    replacement: '$1ause',
    why: "as the speed segment above (#525). Safe beside Pause and Pause recording, which carry no number: the digit is what this matches",
  },
  {
    pattern: /^(Expand|Collapse) all .*elements$/,
    replacement: '$1 all',
    why: 'the fold-all pair names the section or the whole timeline it folds',
  },
  {
    pattern: /^(Expand|Collapse) .+ section$/,
    replacement: '$1 section',
    why: "a section heading's fold names its own section",
  },
]

/**
 * Names that are one control in the app but read differently in the
 * accessibility tree, mapped to the Feature Index's entry. Each says why the
 * two differ — the index lists what the reader sees on screen, and a reader
 * who saw `Duck others` must find `Duck others`.
 */
const ALIASES: { from: string; to: string; why: string }[] = [
  {
    from: 'Duck other audio while plays',
    to: 'Duck others',
    why: 'the checkbox reads "Duck others"; the accessible name spells out what it ducks',
  },
  { from: 'Add to timeline', to: 'Add', why: 'the button reads "Add"; the name says where' },
  {
    from: 'More actions',
    to: '⋯ menu',
    why: 'the trigger is the ⋯ glyph; "More actions" is its accessible name',
  },
  {
    from: 'Trim in point',
    to: 'In',
    why: 'the field is labelled "In"; the accessible name says what it trims',
  },
  { from: 'Trim out point', to: 'Out', why: 'as above, the field is labelled "Out"' },
  {
    from: 'Undo last timeline edit',
    to: 'Undo',
    why: 'the button reads "↺ Undo"; the name says which undo',
  },
  { from: 'Redo timeline edit', to: 'Redo', why: 'as above, the button reads "↻ Redo"' },
  {
    from: 'Rotate 90 degrees clockwise',
    to: 'Rotate',
    why: 'the button reads "Rotate <angle>°"; each press turns it by 90°',
  },
  {
    from: 'Flip horizontally',
    to: 'Flip H',
    why: 'the checkbox reads "Flip H"; the accessible name spells the axis out',
  },
  { from: 'Flip vertically', to: 'Flip V', why: 'as above, the checkbox reads "Flip V"' },
  {
    from: 'Adjust the crop visually',
    to: 'Adjust visually…',
    why: 'both visual-editor buttons read "Adjust visually…"; the name says which editor opens',
  },
  {
    from: 'Adjust the placement visually',
    to: 'Adjust visually…',
    why: 'as above — the placement editor, same button text',
  },
  {
    from: 'Adjust Redaction region visually',
    to: 'Adjust visually…',
    why: 'as above — the redaction editor (#493), same button text; the shape rule above lifted the region number out',
  },
  {
    from: 'Adjust Zoom visually',
    to: 'Adjust visually…',
    why: 'as above — the zoom editor (#413), same button text; the shape rule above lifted the zoom number out',
  },
  // The five visual editors' own controls (#507). Each is drawn once, in
  // five editors, and a reader looking one up has seen the word on screen —
  // so five accessible names collapse onto the one entry the reader would
  // search for, exactly as the row controls above do.
  {
    from: 'Close the crop editor',
    to: '✕ (close a visual editor)',
    why: "an editor's close is the ✕ glyph with no words; its accessible name says which editor's it is",
  },
  {
    from: 'Close the placement editor',
    to: '✕ (close a visual editor)',
    why: 'as above — the overlay and text editors share this one, both placing something',
  },
  {
    from: 'Close the redaction editor',
    to: '✕ (close a visual editor)',
    why: 'as above — the redaction editor (#493)',
  },
  {
    from: 'Close the Zoom editor',
    to: '✕ (close a visual editor)',
    why: 'as above — the zoom editor, whose name is capitalised because the zoom it edits is "Zoom 1"',
  },
  {
    from: 'Preview time of Zoom',
    to: 'Preview',
    why: 'the scrub slider is labelled "Preview"; the accessible name says whose time it scrubs',
  },
  {
    from: 'Preview time of Redaction region',
    to: 'Preview',
    why: 'as above — the same slider in the redaction editor (#493)',
  },
  {
    from: 'Loop the hold of Zoom',
    to: '↻ Loop',
    why: 'the toggle reads "↻ Loop"; the accessible name says what it plays',
  },
  {
    from: 'Loop the window of Redaction region',
    to: '↻ Loop',
    why: 'as above — the same toggle in the redaction editor, over a region\'s window',
  },
  {
    from: 'Reset crop in the editor',
    to: 'Reset crop',
    why: 'the editor\'s button reads "Reset" and clears the same crop the row\'s own Reset does; one control name, two places',
  },
  {
    from: 'Remove from timeline',
    to: '✕ (remove from timeline)',
    why: 'the button is the ✕ glyph and has no words',
  },
  {
    from: 'Expand',
    to: '▾ (expand a row)',
    why: 'the row disclosure is the ▾ glyph; the name says what it does',
  },
  { from: 'Collapse', to: '▾ (expand a row)', why: 'the same button, named for its open state' },
  {
    from: 'Expand section',
    to: '▾ (fold a section)',
    why: "a section heading's own ▾, which folds the whole section",
  },
  { from: 'Collapse section', to: '▾ (fold a section)', why: 'the same button, once open' },
  { from: 'Collapse all', to: '▲ ▼ (fold all)', why: 'the pair is drawn as ▲ and ▼, without words' },
  { from: 'Expand all', to: '▲ ▼ (fold all)', why: 'as above — the other half of the pair' },
  { from: 'Move up', to: '↑ (move up)', why: 'the button is the ↑ glyph' },
  { from: 'Move down', to: '↓ (move down)', why: 'the button is the ↓ glyph' },
  { from: 'Jump to previous cut', to: '⏮ (previous cut)', why: 'the button is the ⏮ glyph' },
  { from: 'Jump to next cut', to: '⏭ (next cut)', why: 'the button is the ⏭ glyph' },
  { from: 'Mark in', to: '⇥ Mark in', why: 'the button carries the ⇥ glyph before its words' },
  { from: 'Mark out', to: '⇤ Mark out', why: 'as above, with ⇤' },
  { from: 'Loop playback', to: '↻ Loop', why: 'the toggle is the ↻ glyph' },
  { from: 'Play preview', to: '▶ Play', why: 'the button is the ▶ glyph' },
  {
    from: 'Preview',
    to: '▶ (preview a clip)',
    why: "a library row's ▶, which plays the source in place",
  },
  {
    from: 'Select',
    to: 'Select a clip',
    why: "a library row's checkbox has no visible label of its own",
  },
  {
    from: 'Seek bar',
    to: 'Seek bar',
    why: 'the bar has no visible label; "Seek within sequence" is its accessible name',
  },
  {
    from: 'Restore preview size',
    to: 'Restore size',
    why: 'the button reads "Restore size"; the accessible name says what it restores',
  },
  {
    from: 'Seek within sequence',
    to: 'Seek bar',
    why: 'as above — the accessible name says what it seeks',
  },
]

/** Normalizes one accessible name to the Feature Index entry it belongs to. */
export function featureKey(accessibleName: string, elementNames: readonly string[]): string {
  let key = accessibleName
  // Longest first, so "clip.webm at position 1" goes before "clip.webm".
  for (const name of [...elementNames].sort((a, b) => b.length - a.length)) {
    key = key.split(name).join(ELEMENT)
  }
  for (const { pattern, replacement } of SHAPE_RULES) key = key.replace(pattern, replacement)
  key = key.replace(/\s+/g, ' ').trim()
  return ALIASES.find((alias) => alias.from === key)?.to ?? key
}

const CONTROL_ROLES = [
  'button',
  'checkbox',
  'combobox',
  'link',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'radio',
  'slider',
  'spinbutton',
  'switch',
  'textbox',
] as const

/** Records a short solid-colour WebM so rows have a decodable source. */
async function recordWebm(page: Page, ms: number): Promise<Buffer> {
  const base64 = await page.evaluate(async (ms) => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 180
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
        ctx.fillStyle = 'rgb(0, 0, 205)'
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
  }, ms)
  return Buffer.from(base64, 'base64')
}

/** A solid PNG, so the still and the image overlay have a real source. */
async function makePng(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 180
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = 'rgb(205, 120, 0)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))
    const buffer = await blob.arrayBuffer()
    let binary = ''
    for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
    return btoa(binary)
  })
  return Buffer.from(base64, 'base64')
}

/**
 * Every control inside `scope`, as `role<TAB>accessible name`, plus every
 * shortcut hint (`<kbd>`) as `kbd<TAB>combo`.
 *
 * The accessible name is what identifies a control: a `<select>`'s own text
 * is every option run together, and an icon button (↑, ✕, ⋯, ▾) has no words
 * at all. The `<kbd>` hints are marked `aria-hidden` so an item is found by
 * its label alone, which is why they are collected separately rather than
 * falling out of the names.
 */
async function controlsIn(scope: Locator): Promise<string[]> {
  return scope.evaluate((root, roles) => {
    const selector = roles.map((role) => `[role="${role}"]`).join(',')
    const implicit = 'button,input:not([type="hidden"]),select,textarea,a[href],summary'
    const clean = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim()
    /** A node's words, without the ▾ carets and hints it marks `aria-hidden`. */
    const wordsOf = (node: Element, withoutControls: boolean): string => {
      const copy = node.cloneNode(true) as HTMLElement
      for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove()
      if (withoutControls) {
        for (const control of copy.querySelectorAll('input,select,textarea,button')) control.remove()
      }
      return clean(copy.textContent)
    }
    const found: string[] = []
    for (const node of root.querySelectorAll(`${selector},${implicit}`)) {
      const element = node as HTMLElement
      if (element.closest('[aria-hidden="true"]') !== null) continue
      const labelledBy = element.getAttribute('aria-labelledby')
      const labels = (element as HTMLInputElement).labels
      const label = labels !== undefined && labels !== null && labels.length > 0 ? labels[0] : null
      // A form control's own text is not a name: a `select` reads as every
      // option run together. Only a `<label>` beside it, or `aria-label`.
      const isFormControl = /^(input|select|textarea)$/.test(element.tagName.toLowerCase())
      const accessible = clean(
        element.getAttribute('aria-label') ??
          (labelledBy === null
            ? null
            : root.ownerDocument.getElementById(labelledBy)?.textContent) ??
          (label === null ? (isFormControl ? '' : wordsOf(element, false)) : wordsOf(label, true)),
      )
      const role = element.getAttribute('role') ?? element.tagName.toLowerCase()
      if (accessible.length > 0) found.push(`${role}\t${accessible}`)
    }
    for (const key of root.querySelectorAll('kbd')) {
      const combo = clean(key.textContent)
      if (combo.length > 0) found.push(`kbd\t${combo}`)
    }
    return found
  }, CONTROL_ROLES as unknown as string[])
}

/**
 * The Feature Index's entries: the bolded name opening each bullet of
 * `docs/guide/feature-index.md`. Read from the source rather than the
 * rendered panel, so a failure names the file a session must edit; the
 * compile test (`tools/guide/guideContent.test.ts`) is what checks every
 * entry's link resolves.
 */
function indexEntries(): Set<string> {
  const source = readFileSync(join('docs', 'guide', 'feature-index.md'), 'utf8')
  const entries = new Set<string>()
  for (const line of source.split('\n')) {
    const match = /^-\s+\*\*(.+?)\*\*/.exec(line)
    if (match !== null) entries.add(match[1].trim())
  }
  return entries
}

test('every control in the app has a Feature Index entry (#485)', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1280, height: 900 })
  // Force the download path for Save (the `save.spec.ts` idiom): with the
  // File System Access picker present, Save As… opens a native dialog no
  // driver can answer, and this walk needs the file it writes to reach the
  // Open project dialog. It changes where the bytes go, not which controls
  // the Save mode dialog offers.
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker
  })
  await page.goto('./')

  const collected = new Map<string, string>()
  const record = async (surface: string, scope: Locator) => {
    for (const row of await controlsIn(scope)) {
      if (!collected.has(row)) collected.set(row, surface)
    }
  }

  // A project with one of every row kind, so every row's controls exist.
  const webm = await recordWebm(page, 1200)
  const png = await makePng(page)
  await page.getByTestId('clip-file-input').setInputFiles([
    { name: 'clip.webm', mimeType: 'video/webm', buffer: webm },
    { name: 'picture.png', mimeType: 'image/png', buffer: png },
    { name: 'tone.wav', mimeType: 'audio/wav', buffer: sineWav(2) },
  ])

  const library = page.getByRole('region', { name: 'Media library' })
  const timeline = page.getByRole('region', { name: 'Timeline' })
  const preview = page.getByRole('region', { name: 'Preview' })
  for (const name of ['clip.webm', 'picture.png', 'tone.wav']) {
    await expect(library.getByRole('listitem').filter({ hasText: name })).toBeVisible()
  }

  await page.getByRole('button', { name: 'Add clip.webm to timeline' }).click()
  await page.getByRole('button', { name: 'Add picture.png to timeline' }).click()
  await page.getByRole('button', { name: 'Add tone.wav to timeline' }).click()
  await chooseClipAction(page, 'clip.webm', 'Add as overlay')
  await chooseClipAction(page, 'picture.png', 'Add as overlay')

  const addMenu = await openAddMenu(page)
  await record('Add ▾', addMenu)
  await addMenu.getByRole('menuitem', { name: ADD_SLATE, exact: true }).click()
  await expect(addMenu).toHaveCount(0)
  const addMenuAgain = await openAddMenu(page)
  await addMenuAgain.getByRole('menuitem', { name: ADD_TEXT, exact: true }).click()
  await expect(addMenuAgain).toHaveCount(0)
  await expect(timeline.getByRole('button', { name: /^More actions for text overlay/ })).toBeVisible()

  await record('the header', page.locator('header'))
  await record('the media library', library)
  await record('the preview', preview)
  await record('the timeline', timeline)

  // The header menus. The panel is taken as "the menu that is open" rather
  // than by name: not every panel is named for its trigger's word (Record ▾
  // opens a menu named "Recording sources").
  for (const trigger of ['File', 'Help', 'Record', 'View', 'Frame']) {
    await page.getByRole('button', { name: trigger, exact: true }).click()
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    await record(`${trigger} ▾`, menu)
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
  }

  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Export', exact: true }).click()
  const exportSubmenu = page.getByRole('menu', { name: 'Export' })
  await expect(exportSubmenu).toBeVisible()
  await record('File ▾ › Export ▸', exportSubmenu)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)

  const clipMenu = await openClipMenu(page, 'clip.webm')
  await record("a library row's ⋯", clipMenu)
  await page.keyboard.press('Escape')
  await expect(clipMenu).toHaveCount(0)

  // Rows are taken from the ⋯ triggers, which exist once per row — the
  // Expand/Collapse buttons include the section headings' fold-all pairs.
  const positions = await timeline
    .getByRole('button', { name: /^More actions for / })
    .evaluateAll((nodes) =>
      nodes.map((node) => (node.getAttribute('aria-label') ?? '').replace(/^More actions for /, '')),
    )
  expect(positions.length, 'one row of each kind is on the timeline').toBe(7)

  for (const position of positions) {
    const expand = timeline.getByRole('button', { name: `Expand ${position}`, exact: true })
    if ((await expand.count()) > 0) await expand.click()
  }
  await record('an expanded timeline row', timeline)

  for (const position of positions) {
    if ((await page.getByRole('button', { name: `Picture of ${position}`, exact: true }).count()) > 0) {
      await openPicture(page, position)
      await record(`the Picture disclosure of ${position}`, timeline)
    }
    const rowMenu = await openRowMenu(page, position)
    await record("a row's ⋯", rowMenu)
    await page.keyboard.press('Escape')
    await expect(rowMenu).toHaveCount(0)
    if ((await page.getByRole('button', { name: `+ Effect on ${position}`, exact: true }).count()) > 0) {
      const menu = await openEffectMenu(page, position)
      await record('+ Effect ▾', menu)
      await page.keyboard.press('Escape')
      await expect(menu).toHaveCount(0)
    }
  }
  await record('the timeline with every row open', timeline)

  const subtitle = subtitleStyleToggle(page)
  await expect(subtitle).toBeVisible()
  if ((await subtitle.getAttribute('aria-expanded')) !== 'true') await subtitle.click()
  await expect(subtitle).toHaveAttribute('aria-expanded', 'true')
  await record('the Subtitle style disclosure', timeline)

  for (const item of ['Settings…', 'Plugins…'] as const) {
    await chooseFromFileMenu(page, item)
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await record(`the ${item.replace('…', '')} dialog`, dialog)
    // Both plugins on, so the formats and transitions they add exist below.
    if (item === 'Plugins…') {
      for (const plugin of ['GIF export', 'Shaped wipes'] as const) {
        const enable = dialog.getByRole('button', { name: `Enable ${plugin}`, exact: true })
        if ((await enable.count()) > 0) await enable.click()
        await expect(dialog.getByRole('button', { name: `Disable ${plugin}`, exact: true })).toBeVisible()
      }
      await record('the Plugins dialog, both enabled', dialog)
    }
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  }

  // The controls that exist only once something is set up.
  await timeline.getByRole('button', { name: /^Add transition/ }).first().click()
  await expect(page.getByRole('combobox', { name: /^Transition type/ })).toBeVisible()
  await record('a transition between two entries', timeline)

  // Each of these reads what an input just revealed, so it waits for the
  // control to be there with a retrying matcher first: a bare read on the
  // next line can see the render before it (`quality-and-ci.md`), and here
  // that would quietly collect less rather than fail.
  const duck = timeline.getByRole('checkbox', { name: /^Duck other audio/ })
  await duck.check()
  await expect(timeline.getByRole('spinbutton', { name: /^Duck level/ })).toBeVisible()
  await record('an audio track with Duck others on', timeline)

  await preview.getByRole('button', { name: 'Mark in', exact: true }).click()
  await page.getByRole('slider', { name: 'Seek within sequence' }).fill('1')
  await preview.getByRole('button', { name: 'Mark out', exact: true }).click()
  await expect(preview.getByRole('button', { name: /Marks/ })).toBeVisible()
  await record('the preview with both marks set', preview)

  const expand = preview.getByRole('button', { name: 'Expand preview', exact: true })
  const restore = preview.getByRole('button', { name: 'Restore preview size', exact: true })
  await expand.click()
  await expect(restore).toBeVisible()
  await record('the expanded preview', preview)
  await restore.click()
  await expect(expand).toBeVisible()

  await page.getByRole('button', { name: 'Export Project…' }).click()
  const exportDialog = page.getByRole('dialog', { name: 'Export project' })
  await expect(exportDialog).toBeVisible()
  // Each format in turn: the Output group changes with the format chosen.
  for (const format of await exportDialog.getByRole('radio').all()) {
    await format.check()
    await record('the Export project dialog', exportDialog)
  }
  await page.keyboard.press('Escape')
  await expect(exportDialog).toHaveCount(0)

  await page.getByRole('button', { name: 'Help', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Keyboard shortcuts…', exact: true }).click()
  const cheatSheet = page.getByRole('dialog')
  await expect(cheatSheet).toBeVisible()
  await record('the keyboard cheat sheet', cheatSheet)
  await page.keyboard.press('Escape')
  await expect(cheatSheet).toHaveCount(0)

  // ── The five visual editors (#507) ──────────────────────────────────
  //
  // Each draws under the row it edits, behind an Adjust visually… button
  // that is a toggle, so the same button closes what it opened; the
  // Settings switch that gates them all is on by default. Two have to have
  // their subject made first — a zoom before it can be adjusted, and a
  // redaction region before it can be dragged — and making the region is
  // what brings the Redact fields themselves into the walk, which is a
  // sixth surface of exactly this kind for one button click (#507).
  const openEditors = timeline.getByRole('dialog')
  const walkEditor = async (trigger: Locator, surface: string) => {
    await trigger.click()
    const editor = openEditors.first()
    await expect(editor).toBeVisible()
    await record(surface, editor)
    await trigger.click()
    await expect(openEditors).toHaveCount(0)
  }

  // A zoom on the first sequence entry, which is also the first entry's own
  // zoom fields — neither exists until an effect is added.
  const [firstEntry] = positions
  await chooseEffect(page, firstEntry, 'Zoom')
  await expect(timeline.getByRole('spinbutton', { name: `Zoom 1 scale of ${firstEntry}` })).toBeVisible()
  await record('an entry with a zoom', timeline)
  await walkEditor(
    timeline.getByRole('button', { name: `Adjust Zoom 1 of ${firstEntry} visually`, exact: true }),
    'the zoom editor',
  )

  // A redaction region on the same entry: the region's own fields, then the
  // editor that drags it.
  await timeline.getByRole('button', { name: `Add a redaction region on ${firstEntry}`, exact: true }).click()
  await expect(timeline.getByRole('combobox', { name: `Redaction region 1 style of ${firstEntry}` })).toBeVisible()
  await record('an element with a redaction region', timeline)
  await walkEditor(
    timeline.getByRole('button', {
      name: `Adjust Redaction region 1 of ${firstEntry} visually`,
      exact: true,
    }),
    'the redaction editor',
  )

  // The crop editor, on the same entry's Picture group.
  await walkEditor(
    timeline.getByRole('button', { name: `Adjust the crop of ${firstEntry} visually`, exact: true }),
    'the crop editor',
  )

  // The placement editor, on every row that offers one — an overlay's
  // rectangle and a text overlay's centre share the button's name but not
  // their editors' contents, so both are walked rather than the first only.
  for (const position of positions) {
    const adjust = timeline.getByRole('button', {
      name: `Adjust the placement of ${position} visually`,
      exact: true,
    })
    if ((await adjust.count()) === 0) continue
    await walkEditor(adjust, `the placement editor of ${position}`)
  }

  // ── A speed segment and a pause (#525) ──────────────────────────────
  //
  // The other two + Effect ▾ effects. Neither has a visual editor, so the
  // block above never met them, and like the zoom their fields exist only
  // once the effect does — the menu items were always collected, the seven
  // controls they draw never were. Both go on the same video entry, which
  // is the kind that takes a remap at all.
  await chooseEffect(page, firstEntry, 'Speed segment')
  await expect(
    timeline.getByRole('spinbutton', { name: `Speed segment 1 factor of ${firstEntry}` }),
  ).toBeVisible()
  await chooseEffect(page, firstEntry, 'Pause')
  await expect(
    timeline.getByRole('spinbutton', { name: `Pause 1 hold of ${firstEntry} in seconds` }),
  ).toBeVisible()
  await record('an entry with a speed segment and a pause', timeline)

  // ── The recording dialog (#507) ─────────────────────────────────────
  //
  // Three states since #514, each with controls of its own: counting down
  // (Start now), recording (Pause, Stop) and paused (Resume). Chromium's
  // fake device — the launch flags at the top of this file, the idiom every
  // recording spec uses — grants the microphone with no prompt, so the
  // dialog really opens. Microphone rather than a screen source: the
  // display-capture prompt cannot be auto-answered the same way, and the
  // dialog's controls are the same three states whatever the source.
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Microphone', exact: true }).click()
  const recordDialog = page.getByRole('dialog', { name: 'Recording voice-over' })
  await expect(recordDialog).toBeVisible()
  await record('the recording dialog, counting down', recordDialog)

  await recordDialog.getByRole('button', { name: 'Start now', exact: true }).click()
  await expect(recordDialog.getByTestId('record-phase')).toContainText('Recording')
  await record('the recording dialog, recording', recordDialog)

  await recordDialog.getByRole('button', { name: 'Pause recording', exact: true }).click()
  await expect(recordDialog.getByTestId('record-phase')).toContainText('Paused')
  await record('the recording dialog, paused', recordDialog)

  // Cancel, not Stop: a delivered clip would land in the library and change
  // the project this walk is about to save.
  await recordDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(recordDialog).toHaveCount(0)

  // ── The Save mode and Open project dialogs (#507) ───────────────────
  //
  // Last of all, because opening a project replaces the timeline every
  // surface above was collected from. Saving references-only is also what
  // produces the file the Open project dialog needs: its re-link step
  // exists precisely because a references-only file carries no media (#77),
  // so the two surfaces are walked with one save between them.
  await chooseFromFileMenu(page, 'Save As…')
  const saveMode = page.getByRole('dialog', { name: 'Save project' })
  await expect(saveMode).toBeVisible()
  await record('the Save mode dialog', saveMode)

  await saveMode.getByRole('radio', { name: 'Store references only', exact: true }).check()
  const downloading = page.waitForEvent('download')
  await saveMode.getByRole('button', { name: 'Save…', exact: true }).click()
  const projectBytes = await readFile((await (await downloading).path())!)
  await expect(saveMode).toHaveCount(0)

  // ── The discard guard (#520) ────────────────────────────────────────
  //
  // One dialog with two wordings: its confirm button is named for what it
  // is about to do, so File ▾ › New Project and File ▾ › Open Project…
  // raise the same guard with different buttons. It needs an unsaved edit
  // standing, which is why it sits here and not earlier — the save above
  // has just made the project clean, so the walk dirties it again with one
  // field that touches no row: the canvas preset is project state and is
  // always on screen, where a row's own field needs its row still open.
  //
  // Cancelled both times, never confirmed: Discard and start new would
  // empty the timeline the rest of this section still needs, and Discard
  // and open chains straight into the browser's own file picker — which is
  // why the Open project dialog below is still reached through the file
  // input, exactly as it was before this guard was walked.
  await timeline.getByRole('combobox', { name: 'Canvas aspect' }).selectOption({ index: 1 })
  const discardGuard = page.getByRole('dialog', { name: 'Discard unsaved changes?' })
  for (const [item, surface] of [
    ['New Project', 'the discard guard, starting a new project'],
    ['Open Project…', 'the discard guard, opening a project'],
  ] as const) {
    await chooseFromFileMenu(page, item)
    await expect(discardGuard).toBeVisible()
    await record(surface, discardGuard)
    await discardGuard.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(discardGuard).toHaveCount(0)
  }

  await page
    .getByTestId('project-file-input')
    .setInputFiles([
      { name: 'walk.bvep', mimeType: 'application/gzip', buffer: projectBytes },
    ])
  const openDialog = page.getByRole('dialog', { name: 'Open walk.bvep' })
  await expect(openDialog).toBeVisible()
  await record('the Open project dialog', openDialog)

  // Re-linked as well as missing: the dialog's own list gains a per-clip
  // state, and Open project only becomes usable once every clip is linked.
  await page.getByTestId('relink-file-input').setInputFiles([
    { name: 'clip.webm', mimeType: 'video/webm', buffer: webm },
    { name: 'picture.png', mimeType: 'image/png', buffer: png },
    { name: 'tone.wav', mimeType: 'audio/wav', buffer: sineWav(2) },
  ])
  await expect(openDialog.getByRole('button', { name: 'Open project', exact: true })).toBeEnabled()
  await record('the Open project dialog, every clip re-linked', openDialog)
  await openDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(openDialog).toHaveCount(0)

  const elementNames = [...positions, 'clip.webm', 'picture.png', 'tone.wav']
  const wanted = new Map<string, string>()
  for (const [row, surface] of collected) {
    const [role, name] = row.split('\t')
    const key = role === 'kbd' ? name : featureKey(name, elementNames)
    if (key.length > 0 && !wanted.has(key)) wanted.set(key, surface)
  }

  const entries = indexEntries()
  const missing = [...wanted]
    .filter(([key]) => !entries.has(key))
    .sort(([a], [b]) => a.localeCompare(b))

  if (process.env.FEATURE_INDEX_DUMP) {
    testInfo.attach('collected', {
      body: [...wanted]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, surface]) => `${key}\t${surface}`)
        .join('\n'),
      contentType: 'text/plain',
    })
    console.log(`\nCOLLECTED ${wanted.size}, MISSING ${missing.length}`)
    console.log(missing.map(([key, surface]) => `${key}\t\t(${surface})`).join('\n'))
  }

  expect(
    missing.map(([key, surface]) => `${key}  —  seen in ${surface}`),
    'every control the walk met is an entry in docs/guide/feature-index.md',
  ).toEqual([])
  // A guard on the walk itself: a collection that silently stopped finding
  // controls would otherwise pass with an empty missing list. Raised with
  // each widening — 162 originally, 194 with #507's four surfaces, 205 with
  // #520's discard guard and #525's speed segment and pause (the other two
  // came from #527's transport control and its key) — keeping roughly the
  // slack the original 150-against-162 left, so a surface that stops
  // opening is caught while an ordinary control being retired is not.
  expect(wanted.size, 'the walk collected the whole app').toBeGreaterThan(196)
})
