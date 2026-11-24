import type { ComponentType } from 'react'

/**
 * Media Library header contributions (#861, ADR 0003): how a plugin adds a
 * media source beside **Import clips**. Built for the Sound library plugin
 * (#856, idea 10). #856 named this a *media-source registry* that stickers
 * (idea 11) could later share, but idea 11 was not approved, so this is
 * only what one source needs.
 *
 * A contribution is a button label and a dialog. The dialog hands back
 * **files**, which core imports through the same path a picked file takes
 * (`onImportFiles`), as voice-over recording does (#224). So what a source
 * adds is an ordinary library clip: it is probed, named, saved and reopened
 * like any import, and it stays when the plugin is disabled. The plugin
 * never sees the library or dispatches.
 */

/** What core hands a contribution's dialog. */
export interface LibraryHeaderDialogProps {
  /** Imports files exactly as Import clips does. The dialog stays open. */
  onImportFiles: (files: File[]) => void
  /** Close, ✕ and Escape. */
  onClose: () => void
}

/** One button a plugin adds to the Media Library header. */
export interface LibraryHeaderContribution {
  /** Unique among contributions; a plugin's are prefixed with its id by convention. */
  id: string
  /** The button's label. A trailing "…" says it opens a dialog. */
  label: string
  /** The dialog the button opens. It lives in the plugin's lazy chunk. */
  Dialog: ComponentType<LibraryHeaderDialogProps>
}

/**
 * Registry of header contributions, in registration order (which is button
 * order, after Import clips). The same shape as the Add ▾, font and
 * transition registries (#860, #859, #199): `subscribe` + `version` pair
 * with `useSyncExternalStore`, so the header re-reads it when a plugin is
 * enabled or disabled at runtime.
 */
export class LibraryHeaderRegistry {
  private readonly contributions = new Map<string, LibraryHeaderContribution>()
  private readonly listeners = new Set<() => void>()
  /** Monotonic change counter: the snapshot for `useSyncExternalStore`. */
  version = 0

  /** Adds a button. A duplicate id is a programming error and throws. */
  register(contribution: LibraryHeaderContribution): void {
    if (this.contributions.has(contribution.id)) {
      throw new Error(`Media Library header item '${contribution.id}' is already registered.`)
    }
    this.contributions.set(contribution.id, contribution)
    this.notify()
  }

  /** Removes a button; an unknown id is a no-op, so teardown order never matters. */
  unregister(id: string): void {
    if (this.contributions.delete(id)) this.notify()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    this.version++
    for (const listener of this.listeners) listener()
  }

  find(id: string): LibraryHeaderContribution | undefined {
    return this.contributions.get(id)
  }

  /** All registered buttons, in registration order. */
  list(): LibraryHeaderContribution[] {
    return [...this.contributions.values()]
  }
}

/** The app's registry. Core registers nothing here; its own controls are fixed. */
export const libraryHeaderContributions = new LibraryHeaderRegistry()
