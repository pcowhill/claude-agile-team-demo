import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { chooseClipAction, openClipMenu } from './clipMenu'
import { chooseFromFileMenu } from './fileMenu'
import { openPicture } from './pictureDisclosure'
import { ADD_SLATE, ADD_TEXT, openAddMenu, subtitleStyleToggle } from './timelineMenu'
import { openEffectMenu, openRowMenu } from './timelineRowMenu'
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
 *
 * Several controls exist only under a condition (`troubleshooting.md`, *A
 * control is missing*), so the walk creates the condition: it adds a
 * transition between two entries, enables both plugins, turns Duck others
 * on, sets the export marks, and expands the preview.
 *
 * **What it deliberately does not open** — and so cannot check: the visual
 * editors (Crop, Zoom, Overlay, Text, Frame), the recording dialog behind
 * Record ▾'s sources, the Open project and Save mode dialogs, and the user
 * guide panel itself. Their controls may be indexed; the walk neither
 * requires nor forbids an entry for them, and it never fails for an entry it
 * did not meet, so extra entries are allowed by design.
 *
 * **What it does not judge**: whether a page explains a feature well. It
 * checks that an index entry exists. The explaining is the content PRs' job
 * and the reviewer's.
 */

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
    pattern: new RegExp(`\\b(?:of|for|on) ${ELEMENT}`, 'g'),
    replacement: '',
    why: 'the element a row control acts on, with the preposition that introduces it',
  },
  {
    pattern: new RegExp(ELEMENT, 'g'),
    replacement: '',
    why: 'the element named anywhere else in the label (Move ‹element› up)',
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
  // controls would otherwise pass with an empty missing list.
  expect(wanted.size, 'the walk collected the whole app').toBeGreaterThan(150)
})
