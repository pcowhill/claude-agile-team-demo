import type { ComponentType } from 'react'
import type { ShapeGroup, ShapeGroupSpec } from './shapes'
import type { TextOverlay, TextOverlaySpec } from './textOverlay'

/**
 * Add ▾ contributions (#860, ADR 0003): how a plugin adds an item to the
 * timeline's **Add ▾** menu. Built for the Title templates plugin (#856,
 * idea 6), the first plugin whose feature is "put new elements on the
 * timeline" rather than "a new kind of thing to pick".
 *
 * The seam is the smallest one that plugin needs. A contribution is a menu
 * label and a dialog. Choosing the item opens the dialog, and the dialog
 * hands back **ordinary elements** — text overlays and shape groups — for
 * core to place. The plugin never sees the timeline, never dispatches, and
 * never invents ids or times: core places what it returns at the Preview
 * time, under fresh ids, as one edit (`placeElementsAt` and the reducer's
 * `elements-placed`). So whatever a plugin places is edited, saved and
 * exported like hand-made elements, and stays when the plugin is disabled.
 */

/**
 * What a contribution's dialog places: elements timed from 0, the moment
 * they are placed at. Ids are assigned by core (`placeElementsAt`), shape
 * ids included, so a plugin's elements can never collide with the
 * timeline's.
 */
export interface PlacedElements {
  texts: TextOverlaySpec[]
  /** Each group's shapes carry ids only to satisfy the type; core replaces them. */
  shapeGroups: ShapeGroupSpec[]
}

/** What core hands a contribution's dialog. */
export interface AddMenuDialogProps {
  /** The output frame in pixels — what a template measures its text against. */
  frame: { width: number; height: number }
  /**
   * The timeline's shape groups, read-only (#868): what a dialog that
   * continues a sequence reads, such as the step badge offering the next
   * number. A dialog never changes them; it only returns new elements.
   */
  shapeGroups: readonly ShapeGroup[]
  /** Places the elements at the Preview time as one edit, then closes. */
  onPlace: (elements: PlacedElements) => void
  /** Cancel, ✕ and Escape: close, placing nothing. */
  onClose: () => void
}

/** One item a plugin adds to Add ▾. */
export interface AddMenuContribution {
  /** Unique among contributions; a plugin's contributions are prefixed with its id by convention. */
  id: string
  /** The menu item's label. A trailing "…" says it opens a dialog. */
  label: string
  /** The dialog the item opens. It lives in the plugin's lazy chunk. */
  Dialog: ComponentType<AddMenuDialogProps>
}

/**
 * Registry of Add ▾ contributions, in registration order (which is menu
 * order, after the core items). Mirrors the font and transition registries
 * (#859, #199): `register`/`unregister` are how a plugin's items arrive and
 * leave, and `subscribe` + `version` pair with `useSyncExternalStore` so the
 * menu re-reads the registry when plugins change it at runtime.
 */
export class AddMenuRegistry {
  private readonly contributions = new Map<string, AddMenuContribution>()
  private readonly listeners = new Set<() => void>()
  /** Monotonic change counter — the snapshot for `useSyncExternalStore`. */
  version = 0

  /** Adds an item. A duplicate id is a programming error and throws. */
  register(contribution: AddMenuContribution): void {
    if (this.contributions.has(contribution.id)) {
      throw new Error(`Add menu item '${contribution.id}' is already registered.`)
    }
    this.contributions.set(contribution.id, contribution)
    this.notify()
  }

  /** Removes an item; an unknown id is a no-op, so teardown order never matters. */
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

  find(id: string): AddMenuContribution | undefined {
    return this.contributions.get(id)
  }

  /** All registered items, in registration order. */
  list(): AddMenuContribution[] {
    return [...this.contributions.values()]
  }
}

/** The app's registry. Core registers nothing here; its own items are fixed. */
export const addMenuContributions = new AddMenuRegistry()

/**
 * The elements a dialog returned, made ready for the timeline: every
 * element's offset moved by `time` (the Preview time), and fresh ids from
 * `newId` for each text, each group and each shape in it.
 */
export function placeElementsAt(
  elements: PlacedElements,
  time: number,
  newId: () => string,
): { texts: TextOverlay[]; shapeGroups: ShapeGroup[] } {
  const at = Math.max(0, time)
  return {
    texts: elements.texts.map((text) => ({ ...text, offset: text.offset + at, id: newId() })),
    shapeGroups: elements.shapeGroups.map((group) => ({
      ...group,
      offset: group.offset + at,
      id: newId(),
      shapes: group.shapes.map((shape) => ({ ...shape, id: newId() })),
    })),
  }
}
