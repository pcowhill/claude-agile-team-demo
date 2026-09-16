import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { GuideBlocks } from './GuideBlocks'
import { ShortcutHelpDialog } from '../components/ShortcutHelpDialog'
import { guideConstants } from '../lib/guide/constants'

/**
 * The Keyboard shortcuts page's table is the cheat sheet's table (#482,
 * design #477 §6): both render `shortcutsFor`, so the rows must agree —
 * combos and descriptions alike — at the step sizes in force.
 */
describe('the generated shortcut table (#482)', () => {
  it('renders exactly the rows the ? cheat sheet shows, with the configured step sizes', () => {
    const settings = { stepSeconds: 0.25, largeStepSeconds: 2 }
    const constants = guideConstants(settings)
    render(
      <>
        <GuideBlocks blocks={[{ kind: 'shortcuts' }]} context={{ section: 'keyboard-shortcuts', constants, onNavigate: () => {} }} />
        <ShortcutHelpDialog onClose={() => {}} stepSeconds={settings.stepSeconds} largeStepSeconds={settings.largeStepSeconds} />
      </>,
    )
    const table = screen.getByTestId('user-guide-shortcuts')
    const guideRows = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent))
    const sheet = screen.getByRole('dialog', { name: 'Keyboard shortcuts' })
    const sheetRows = Array.from(sheet.querySelectorAll('.shortcut-row')).map((row) => [
      row.querySelector('dt')!.textContent,
      row.querySelector('dd')!.textContent,
    ])
    expect(guideRows).toEqual(sheetRows)
    expect(guideRows.length).toBeGreaterThan(10)
    // The live sizes, not the defaults.
    expect(guideRows.map((row) => row[1])).toContain('Step the playhead 0.25 s back / forward')
    expect(guideRows.map((row) => row[1])).toContain('Step the playhead 2 s back / forward')
  })
})
