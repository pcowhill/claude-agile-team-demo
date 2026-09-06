import { fireEvent, screen } from '@testing-library/react'

/**
 * Reaching the preview transport's frame actions that #417 moved into
 * Frame ▾ (from the approved button redesign #401 / feedback #395, where the
 * customer named the preview as the busiest region).
 *
 * Split, Save frame and both Freeze frame placements were top-level buttons;
 * they are menu items now, under the same test ids. What they do is
 * unchanged, so the tests that exercise them keep their assertions and only
 * change how they reach the control — this helper is that change, in one
 * place. `fireEvent`, not `userEvent`, because the PreviewPlayer suite
 * drives everything with `fireEvent` (its playback stubs and fake rAF are
 * simplest without a user-event clock).
 *
 * ⇥ Mark in / ⇤ Mark out and ✕ Marks are still buttons and need nothing here.
 */
export function openFrameMenu(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: 'Frame' }))
  return screen.getByRole('menu', { name: 'Frame menu' })
}

/** Frame ▾ → the item with `testId`; the menu closes on selection. */
export function chooseFromFrameMenu(testId: string): void {
  openFrameMenu()
  fireEvent.click(screen.getByTestId(testId))
}

/** Frame ▾'s item with `testId`, for reading its state (enabled, title). */
export function frameMenuItem(testId: string): HTMLElement {
  if (screen.queryByRole('menu', { name: 'Frame menu' }) === null) openFrameMenu()
  return screen.getByTestId(testId)
}

/** Escape closes the menu (focus returns to the trigger, as the menu-button contract says). */
export function closeFrameMenu(): void {
  const menu = screen.queryByRole('menu', { name: 'Frame menu' })
  if (menu !== null) fireEvent.keyDown(menu, { key: 'Escape' })
}
