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
      // A scope's heading row (#686) has no cells; it is checked below.
      .filter((row) => within(row).queryAllByRole('cell').length > 0)
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

  it('shows the shape editor’s keys under their own heading in both (#686)', () => {
    const constants = guideConstants({ stepSeconds: 0.1, largeStepSeconds: 1 })
    render(
      <>
        <GuideBlocks blocks={[{ kind: 'shortcuts' }]} context={{ section: 'keyboard-shortcuts', constants, onNavigate: () => {} }} />
        <ShortcutHelpDialog onClose={() => {}} />
      </>,
    )
    const table = screen.getByTestId('user-guide-shortcuts')
    const heading = within(table).getByRole('columnheader', { name: 'In the shape editor' })
    // The editor's keys are the rows after its heading, and only those.
    const after = Array.from(heading.closest('tbody')!.querySelectorAll('tr')).slice(1)
    expect(after.map((row) => row.querySelector('td:last-child')!.textContent)).toEqual([
      'Remove the selected shapes',
      'Duplicate the selected shapes, slightly offset',
    ])
    const sheet = screen.getByRole('dialog', { name: 'Keyboard shortcuts' })
    expect(within(sheet).getByRole('heading', { name: 'In the shape editor' })).toBeInTheDocument()
    const editorList = sheet.querySelector('dl[aria-label="In the shape editor"]')!
    expect(Array.from(editorList.querySelectorAll('kbd')).map((kbd) => kbd.textContent)).toEqual([
      'Delete',
      'Backspace',
      'Ctrl/Cmd + D',
    ])
  })

  it('shows the Trim window’s keys under their own heading in both, with the live step sizes (#707)', () => {
    const settings = { stepSeconds: 0.25, largeStepSeconds: 2 }
    const constants = guideConstants(settings)
    render(
      <>
        <GuideBlocks blocks={[{ kind: 'shortcuts' }]} context={{ section: 'keyboard-shortcuts', constants, onNavigate: () => {} }} />
        <ShortcutHelpDialog onClose={() => {}} stepSeconds={settings.stepSeconds} largeStepSeconds={settings.largeStepSeconds} />
      </>,
    )
    const table = screen.getByTestId('user-guide-shortcuts')
    const heading = within(table).getByRole('columnheader', { name: 'In the Trim window' })
    const after = Array.from(heading.closest('tbody')!.querySelectorAll('tr')).slice(1)
    expect(after.map((row) => row.querySelector('td:last-child')!.textContent)).toEqual([
      'Play / pause Play trim',
      'Set the In / Out clamp at the playhead',
      'Move the focused clamp 0.25 s back / forward',
      'Move the focused clamp 2 s back / forward',
      'Close the window without applying',
    ])
    const sheet = screen.getByRole('dialog', { name: 'Keyboard shortcuts' })
    expect(within(sheet).getByRole('heading', { name: 'In the Trim window' })).toBeInTheDocument()
    const trimList = sheet.querySelector('dl[aria-label="In the Trim window"]')!
    expect(Array.from(trimList.querySelectorAll('kbd')).map((kbd) => kbd.textContent)).toEqual([
      'Space',
      'I / O',
      '← / →',
      'Shift + ← / →',
      'Esc',
    ])
  })
})
