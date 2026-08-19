/**
 * Where project files go when the user saves (#76). Two write paths exist in
 * browsers, so saving is expressed as a port with one implementation per
 * path, picked by feature detection:
 *
 * - **File System Access** (`window.showSaveFilePicker` — Chromium-family
 *   browsers): Save As… opens a real file picker, and Save rewrites the
 *   picked file in place, matching the desktop-app behavior the customer
 *   described (#71).
 * - **Download** (everything else, notably Firefox and Safari): the only
 *   write primitive is triggering a download, so both Save and Save As…
 *   download the file under the established name and the browser decides
 *   where it lands.
 *
 * Components depend only on {@link SavePort}, which also gives tests a seam:
 * the real pickers cannot be driven by automated tests.
 */

/** Extension of a saved project (the gzip'd JSON of `projectFile.ts`). */
export const PROJECT_FILE_EXTENSION = '.bvep'
export const DEFAULT_PROJECT_FILE_NAME = `project${PROJECT_FILE_EXTENSION}`

/** An established place to write project bytes; Save re-uses it silently. */
export interface SaveDestination {
  /** Filename, for display and for re-saves on the download path. */
  readonly name: string
  write(bytes: Uint8Array<ArrayBuffer>): Promise<void>
}

export type PickResult =
  | { kind: 'picked'; destination: SaveDestination }
  | { kind: 'canceled' }

export interface SavePort {
  /**
   * 'file-system-access' when Save can rewrite the picked file in place;
   * 'download' when every save is a new download.
   */
  readonly kind: 'file-system-access' | 'download'
  /** Asks the user where the project goes. Must be called on a user gesture. */
  pickDestination(suggestedName: string): Promise<PickResult>
}

// `showSaveFilePicker` is WICG File System Access, not in lib.dom — but the
// handle type it resolves to is.
interface SaveFilePickerOptions {
  suggestedName?: string
  types?: { description?: string; accept: Record<string, string[]> }[]
}
declare global {
  interface Window {
    showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>
  }
}

function fileSystemAccessPort(
  showSaveFilePicker: NonNullable<Window['showSaveFilePicker']>,
): SavePort {
  return {
    kind: 'file-system-access',
    async pickDestination(suggestedName) {
      let handle: FileSystemFileHandle
      try {
        handle = await showSaveFilePicker({
          suggestedName,
          types: [
            {
              description: 'Browser Video Editor project',
              accept: { 'application/gzip': [PROJECT_FILE_EXTENSION] },
            },
          ],
        })
      } catch (error) {
        // Closing the picker without choosing is an AbortError, not a failure.
        if (error instanceof DOMException && error.name === 'AbortError') {
          return { kind: 'canceled' }
        }
        throw error
      }
      return {
        kind: 'picked',
        destination: {
          name: handle.name,
          async write(bytes) {
            const writable = await handle.createWritable()
            await writable.write(bytes)
            await writable.close()
          },
        },
      }
    },
  }
}

function downloadPort(): SavePort {
  return {
    kind: 'download',
    pickDestination(suggestedName) {
      // There is no picker to show: the "destination" is the filename, and
      // every write downloads under it (the browser adds " (1)" etc. rather
      // than overwriting — the closest a download can get to Save).
      const destination: SaveDestination = {
        name: suggestedName,
        write(bytes) {
          const url = URL.createObjectURL(
            new Blob([bytes as BlobPart], { type: 'application/gzip' }),
          )
          const anchor = document.createElement('a')
          anchor.href = url
          anchor.download = suggestedName
          anchor.click()
          // Deferred: revoking synchronously can abort the download the
          // click just started; a minute comfortably outlives it.
          setTimeout(() => URL.revokeObjectURL(url), 60_000)
          return Promise.resolve()
        },
      }
      return Promise.resolve({ kind: 'picked', destination })
    },
  }
}

/** The save port for the current browser, by feature detection. */
export function createSavePort(): SavePort {
  const picker = window.showSaveFilePicker
  // The picker must stay bound to window — extracted, it throws on call.
  return picker !== undefined ? fileSystemAccessPort(picker.bind(window)) : downloadPort()
}
