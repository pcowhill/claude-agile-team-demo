import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../../App'
import { libraryHeaderContributions } from '../../lib/libraryHeader'
import type { ProbedMedia } from '../../lib/probeMedia'
import { builtInPlugins } from '../catalog'
import { activate, SOUND_LIBRARY_ITEM_ID } from './index'
import { SoundLibraryDialog } from './SoundLibraryDialog'
import { formatSoundLength, SOUNDS } from './sounds'
import type { LibrarySound } from './sounds'
import manifest from './sounds/manifest.json'

/**
 * The Sound library plugin (#861), against the app's real Media Library
 * header registry: `activate` is what the plugin runtime calls after loading
 * the lazy chunk, and the deactivate it returns is the cleanup.
 */

let deactivate: (() => void) | null = null

afterEach(() => {
  deactivate?.()
  deactivate = null
})

const enable = () =>
  act(() => {
    deactivate = activate()
  })

const disable = () =>
  act(() => {
    deactivate?.()
    deactivate = null
  })

/** A probe that accepts any file as a 1 s audio clip: jsdom cannot decode. */
const probeMedia = async (): Promise<ProbedMedia> => ({ duration: 1, url: 'blob:probed', kind: 'audio' })

const okResponse = (body = 'opus bytes') => Promise.resolve(new Response(body, { headers: { 'content-type': 'audio/webm' } }))

/** A stand-in media element that records what the dialog asks of it. */
function fakeAudio() {
  const audio = {
    src: '',
    paused: true,
    onended: null as (() => void) | null,
    play: vi.fn(() => {
      audio.paused = false
      return Promise.resolve()
    }),
    pause: vi.fn(() => {
      audio.paused = true
    }),
    removeAttribute: vi.fn((name: string) => {
      if (name === 'src') audio.src = ''
    }),
    load: vi.fn(),
  }
  return audio
}

const twoSounds: LibrarySound[] = [
  { id: 'whoosh', name: 'Whoosh', category: 'Transitions', duration: 0.908, licence: 'CC0-1.0', source: 's', url: '/sounds/whoosh.webm' },
  { id: 'click', name: 'Click', category: 'Clicks and keys', duration: 0.128, licence: 'CC0-1.0', source: 's', url: '/sounds/click.webm' },
]

describe('Sound library plugin (#861)', () => {
  it('is a catalog entry with a lazy load, and needs no projectUses', async () => {
    const spec = builtInPlugins.find((plugin) => plugin.id === 'sound-library')
    expect(spec?.name).toBe('Sound library')
    // An added sound is an ordinary library clip: no project depends on it.
    expect(spec?.projectUses).toBeUndefined()
    const module = await spec!.load()
    expect(module.activate).toBe(activate)
  })

  it('every manifest entry has a file URL, a licence and a source; no effect is long, and no bed is short (#869)', () => {
    expect(SOUNDS).toHaveLength(manifest.sounds.length)
    for (const sound of SOUNDS) {
      expect(sound.url, sound.id).toMatch(/\.webm(\?|$)/)
      expect(sound.licence).toBe('CC0-1.0')
      expect(sound.source).not.toBe('')
      if (sound.category === 'Music') {
        expect(sound.duration, sound.id).toBeGreaterThanOrEqual(60)
        expect(sound.duration, sound.id).toBeLessThanOrEqual(180)
      } else {
        expect(sound.duration, sound.id).toBeLessThan(3)
        expect(sound.mood, sound.id).toBeUndefined()
      }
    }
  })

  it('adds Sound library… right after Import clips, and the deactivate removes it', () => {
    render(<App probeMedia={probeMedia} />)
    expect(screen.queryByRole('button', { name: 'Sound library…' })).toBeNull()
    enable()
    expect(libraryHeaderContributions.find(SOUND_LIBRARY_ITEM_ID)?.label).toBe('Sound library…')
    const button = screen.getByRole('button', { name: 'Sound library…' })
    expect(screen.getByRole('button', { name: 'Import clips' }).nextElementSibling).toBe(button)
    disable()
    expect(screen.queryByRole('button', { name: 'Sound library…' })).toBeNull()
  })

  it('Add imports the sound as an ordinary clip under its name, and it stays when the plugin is disabled', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => okResponse())
    try {
      enable()
      render(<App probeMedia={probeMedia} />)
      await userEvent.click(screen.getByRole('button', { name: 'Sound library…' }))
      const dialog = screen.getByRole('dialog', { name: 'Sound library' })
      await userEvent.click(within(dialog).getByRole('button', { name: 'Add Whoosh to the library' }))
      expect(await within(dialog).findByText('Added Whoosh to the library.')).toBeInTheDocument()
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(String(fetchSpy.mock.calls[0][0])).toBe(SOUNDS.find((sound) => sound.id === 'whoosh')!.url)
      const clips = screen.getByRole('list', { name: 'Imported clips' })
      await waitFor(() => expect(within(clips).getAllByRole('listitem')).toHaveLength(1))
      expect(within(clips).getByText('Whoosh.webm')).toBeInTheDocument()
      // The dialog stays open for the next sound.
      expect(screen.getByRole('dialog', { name: 'Sound library' })).toBeInTheDocument()

      disable()
      expect(screen.queryByRole('dialog', { name: 'Sound library' })).toBeNull()
      expect(within(clips).getByText('Whoosh.webm')).toBeInTheDocument()
    } finally {
      fetchSpy.mockRestore()
    }
  })
})

describe('disabling Sound library while its dialog is open (#861)', () => {
  it('closes the dialog, and enabling the plugin again does not reopen it', async () => {
    enable()
    render(<App probeMedia={probeMedia} />)
    await userEvent.click(screen.getByRole('button', { name: 'Sound library…' }))
    expect(screen.getByRole('dialog', { name: 'Sound library' })).toBeInTheDocument()
    disable()
    expect(screen.queryByRole('dialog', { name: 'Sound library' })).toBeNull()
    enable()
    expect(screen.queryByRole('dialog', { name: 'Sound library' })).toBeNull()
  })
})

describe('adding a sound keeps the user\'s place in the list (#889 review)', () => {
  it('focus stays on the Add pressed, through the library re-render the import causes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => okResponse())
    try {
      enable()
      render(<App probeMedia={probeMedia} />)
      await userEvent.click(screen.getByRole('button', { name: 'Sound library…' }))
      const dialog = screen.getByRole('dialog', { name: 'Sound library' })
      // Not the first sound: the first ▶ is where focus used to land.
      const last = SOUNDS[SOUNDS.length - 1]
      const add = within(dialog).getByRole('button', { name: `Add ${last.name} to the library` })
      await userEvent.click(add)
      expect(await within(dialog).findByText(`Added ${last.name} to the library.`)).toBeInTheDocument()
      const clips = screen.getByRole('list', { name: 'Imported clips' })
      await waitFor(() => expect(within(clips).getAllByRole('listitem')).toHaveLength(1))
      expect(add).toHaveFocus()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('Add stays focusable while its sound downloads, and a second press then fetches nothing', async () => {
    let finish: (response: Response) => void = () => {}
    const fetchSound = vi.fn(() => new Promise<Response>((resolve) => (finish = resolve)))
    const onImportFiles = vi.fn()
    render(<SoundLibraryDialog onImportFiles={onImportFiles} onClose={vi.fn()} sounds={twoSounds} fetchSound={fetchSound} />)
    const add = screen.getByRole('button', { name: 'Add Click to the library' })
    await userEvent.click(add)
    expect(add).toHaveAttribute('aria-disabled', 'true')
    expect(add).toHaveFocus()
    await userEvent.click(add)
    expect(fetchSound).toHaveBeenCalledTimes(1)
    await act(async () => finish(new Response('opus')))
    await screen.findByText('Added Click to the library.')
    expect(onImportFiles).toHaveBeenCalledTimes(1)
    expect(add).not.toHaveAttribute('aria-disabled')
    expect(add).toHaveFocus()
  })
})

describe('the Music category (#869)', () => {
  it('lists the music beds last, each with its name, its mood and its length in minutes and seconds', () => {
    render(<SoundLibraryDialog onImportFiles={vi.fn()} onClose={vi.fn()} fetchSound={vi.fn()} />)
    const music = SOUNDS.filter((sound) => sound.category === 'Music')
    expect(music.length).toBeGreaterThanOrEqual(5)
    expect(music.length).toBeLessThanOrEqual(8)
    // Last, after every effect.
    expect(SOUNDS.slice(-music.length)).toEqual(music)
    const section = screen.getByRole('region', { name: 'Music' })
    const rows = within(section).getAllByRole('listitem')
    expect(rows).toHaveLength(music.length)
    rows.forEach((row, index) => {
      const track = music[index]
      expect(track.mood, track.id).toMatch(/^\S+$/)
      expect(track.duration, track.id).toBeGreaterThanOrEqual(60)
      expect(track.duration, track.id).toBeLessThanOrEqual(180)
      expect([...row.children].map((part) => part.textContent)).toEqual([
        track.name,
        track.mood,
        formatSoundLength(track.duration),
        '▶',
        'Add',
      ])
    })
    // An effect's row has no mood.
    const whoosh = screen.getByRole('button', { name: 'Add Whoosh to the library' }).closest('li')!
    expect(whoosh.querySelector('.sound-library-mood')).toBeNull()
  })

  it('formats a length under a minute in tenths of a second, and a longer one as minutes and seconds', () => {
    expect(formatSoundLength(0.128)).toBe('0.1 s')
    expect(formatSoundLength(2.008)).toBe('2.0 s')
    expect(formatSoundLength(60)).toBe('1:00')
    expect(formatSoundLength(76.008)).toBe('1:16')
    expect(formatSoundLength(88.713)).toBe('1:29')
    expect(formatSoundLength(119.6)).toBe('2:00')
  })
})

describe('the Sound library dialog (#861)', () => {
  it('lists every sound under its category with its length, the first Play focused', () => {
    render(<SoundLibraryDialog onImportFiles={vi.fn()} onClose={vi.fn()} fetchSound={vi.fn()} />)
    const categories = [...new Set(SOUNDS.map((sound) => sound.category))]
    for (const category of categories) {
      const section = screen.getByRole('region', { name: category })
      const names = within(section)
        .getAllByRole('listitem')
        .map((row) => row.querySelector('.sound-library-name')?.textContent)
      expect(names).toEqual(SOUNDS.filter((sound) => sound.category === category).map((sound) => sound.name))
    }
    const whoosh = SOUNDS.find((sound) => sound.id === 'whoosh')!
    const row = screen.getByRole('button', { name: 'Add Whoosh to the library' }).closest('li')!
    expect(within(row).getByText(formatSoundLength(whoosh.duration))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `Play ${SOUNDS[0].name}` })).toHaveFocus()
  })

  it('Add fetches only that file and hands the library a File named for the sound', async () => {
    const onImportFiles = vi.fn()
    const fetchSound = vi.fn(() => okResponse('opus'))
    render(<SoundLibraryDialog onImportFiles={onImportFiles} onClose={vi.fn()} sounds={twoSounds} fetchSound={fetchSound} />)
    await userEvent.click(screen.getByRole('button', { name: 'Add Click to the library' }))
    await screen.findByText('Added Click to the library.')
    expect(fetchSound).toHaveBeenCalledTimes(1)
    expect(fetchSound).toHaveBeenCalledWith('/sounds/click.webm')
    expect(onImportFiles).toHaveBeenCalledTimes(1)
    const [[file]] = onImportFiles.mock.calls[0] as [[File]]
    expect(file.name).toBe('Click.webm')
    expect(file.type).toBe('audio/webm')
    expect(await file.text()).toBe('opus')
  })

  it('a failed download imports nothing and says why', async () => {
    const onImportFiles = vi.fn()
    const fetchSound = vi.fn(() => Promise.resolve(new Response('', { status: 404 })))
    render(<SoundLibraryDialog onImportFiles={onImportFiles} onClose={vi.fn()} sounds={twoSounds} fetchSound={fetchSound} />)
    await userEvent.click(screen.getByRole('button', { name: 'Add Whoosh to the library' }))
    expect(await screen.findByText('Whoosh could not be downloaded: the server answered 404.')).toBeInTheDocument()
    expect(onImportFiles).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Add Whoosh to the library' })).not.toHaveAttribute('aria-disabled')
  })

  it('plays one preview at a time, stops on a second press, and stops when the dialog closes', async () => {
    const audio = fakeAudio()
    const createAudio = vi.fn(() => audio as unknown as HTMLAudioElement)
    const { unmount } = render(
      <SoundLibraryDialog onImportFiles={vi.fn()} onClose={vi.fn()} sounds={twoSounds} fetchSound={vi.fn()} createAudio={createAudio} />,
    )
    // Nothing is fetched or streamed until ▶ is pressed.
    expect(createAudio).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Play Whoosh' }))
    expect(audio.src).toBe('/sounds/whoosh.webm')
    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Stop Whoosh' })).toHaveAttribute('aria-pressed', 'true')

    // Another sound replaces the first on the one element.
    await userEvent.click(screen.getByRole('button', { name: 'Play Click' }))
    expect(audio.src).toBe('/sounds/click.webm')
    expect(screen.getByRole('button', { name: 'Play Whoosh' })).toHaveAttribute('aria-pressed', 'false')
    expect(createAudio).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole('button', { name: 'Stop Click' }))
    expect(audio.paused).toBe(true)
    expect(screen.getByRole('button', { name: 'Play Click' })).toBeInTheDocument()

    // Ending on its own resets the button.
    await userEvent.click(screen.getByRole('button', { name: 'Play Click' }))
    act(() => audio.onended?.())
    expect(screen.getByRole('button', { name: 'Play Click' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Play Whoosh' }))
    unmount()
    expect(audio.paused).toBe(true)
    expect(audio.src).toBe('')
  })

  it('Escape and Close close it', async () => {
    const onClose = vi.fn()
    render(<SoundLibraryDialog onImportFiles={vi.fn()} onClose={onClose} sounds={twoSounds} fetchSound={vi.fn()} />)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
