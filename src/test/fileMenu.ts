import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * Reaching the header actions that #415 moved into File ▾ (from the approved
 * button redesign #401 / feedback #395).
 *
 * New Project, Open Project…, Save As…, Plugins… and Settings… used to be
 * top-level buttons; they are menu items now. Nothing about what they *do*
 * changed, so the tests that exercise them keep their assertions and only
 * change how they reach the action — this helper is that change, in one
 * place rather than in each file.
 *
 * Save (💾) and Export Project… are still buttons and need nothing from here.
 */
type Clicker = Pick<ReturnType<typeof userEvent.setup>, 'click'>

export async function chooseFromFileMenu(name: string, user: Clicker = userEvent): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'File' }))
  await user.click(await screen.findByRole('menuitem', { name }))
}

/**
 * Opens File ▾ → Export ▸ and picks a format by its label, the path #415
 * added for starting an export on a chosen format.
 */
export async function chooseExportFormat(label: string, user: Clicker = userEvent): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'File' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Export' }))
  const submenu = await screen.findByRole('menu', { name: 'Export' })
  await user.click(within(submenu).getByRole('menuitem', { name: label }))
}
