import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ExportFormatRegistry,
  exportFileName,
  exportFormats,
  registerCoreExportFormats,
  supportedExportFormats,
} from './exportFormats'
import type { ExportFormatSpec } from './exportFormats'

const spec = (id: string, overrides: Partial<ExportFormatSpec> = {}): ExportFormatSpec => ({
  id,
  label: id.toUpperCase(),
  extension: id,
  candidates: [`video/${id}`],
  candidatesWithAudio: [`video/${id};codecs=x,y`],
  encode: () => Promise.resolve(new Blob()),
  ...overrides,
})

describe('ExportFormatRegistry (#196)', () => {
  it('registers formats and looks them up by id', () => {
    const registry = new ExportFormatRegistry()
    const webm = spec('webm')
    registry.register(webm)
    expect(registry.has('webm')).toBe(true)
    expect(registry.get('webm')).toBe(webm)
  })

  it('lists formats in registration order — the picker order', () => {
    const registry = new ExportFormatRegistry()
    registry.register(spec('webm'))
    registry.register(spec('mp4'))
    registry.register(spec('gif'))
    expect(registry.list().map((entry) => entry.id)).toEqual(['webm', 'mp4', 'gif'])
  })

  it('rejects a duplicate id — silently replacing a format would be a bug', () => {
    const registry = new ExportFormatRegistry()
    registry.register(spec('webm'))
    expect(() => registry.register(spec('webm'))).toThrow(/already registered/)
    // The original registration survives the rejected attempt.
    expect(registry.list()).toHaveLength(1)
  })

  it('throws on an unknown id rather than returning undefined', () => {
    const registry = new ExportFormatRegistry()
    expect(registry.has('nope')).toBe(false)
    expect(() => registry.get('nope')).toThrow(/Unknown export format/)
  })

  it('unregister removes a format; an unknown id is a safe no-op (#197)', () => {
    const registry = new ExportFormatRegistry()
    registry.register(spec('webm'))
    registry.register(spec('gif'))
    registry.unregister('gif')
    expect(registry.has('gif')).toBe(false)
    expect(registry.list().map((entry) => entry.id)).toEqual(['webm'])
    // Deactivation order is not guaranteed; a second unregister must not throw.
    expect(() => registry.unregister('gif')).not.toThrow()
  })

  it('notifies subscribers on register and unregister, with a moving version (#197)', () => {
    const registry = new ExportFormatRegistry()
    let notified = 0
    const unsubscribe = registry.subscribe(() => notified++)
    const initial = registry.version
    registry.register(spec('gif'))
    expect(notified).toBe(1)
    registry.unregister('gif')
    expect(notified).toBe(2)
    expect(registry.version).toBe(initial + 2)
    // A no-op unregister changes nothing, so it must not notify.
    registry.unregister('gif')
    expect(notified).toBe(2)
    unsubscribe()
    registry.register(spec('gif'))
    expect(notified).toBe(2)
  })
})

describe('core export formats (#114, #196)', () => {
  it('registers WebM first (the picker default), then MP4 and audio-only, at startup', () => {
    // The singleton is populated by the module itself — this is the state
    // the export UI sees without any further wiring.
    expect(exportFormats.list().map((entry) => entry.id)).toEqual([
      'webm',
      'mp4',
      'audio-webm',
      'audio-mp3',
    ])
  })

  it('registerCoreExportFormats populates a fresh registry identically', () => {
    const registry = new ExportFormatRegistry()
    registerCoreExportFormats(registry)
    expect(registry.list().map((entry) => entry.id)).toEqual([
      'webm',
      'mp4',
      'audio-webm',
      'audio-mp3',
    ])
    expect(registry.get('webm').label).toBe('WebM')
    expect(registry.get('mp4').extension).toBe('mp4')
    expect(registry.get('audio-webm').label).toBe('Audio only (WebM/Opus)')
    expect(registry.get('audio-mp3').label).toBe('Audio only (MP3)')
  })

  it('every candidate stays inside its format container — the picked format is a promise', () => {
    const containerOf: Record<string, string> = {
      webm: 'video/webm',
      mp4: 'video/mp4',
      'audio-webm': 'audio/webm',
    }
    for (const format of exportFormats.list()) {
      for (const type of [...format.candidates, ...format.candidatesWithAudio]) {
        expect(type.startsWith(containerOf[format.id])).toBe(true)
      }
    }
  })

  it('the audio-only formats are marked audioOnly and state so in their notes (#245, #269)', () => {
    for (const id of ['audio-webm', 'audio-mp3']) {
      const audio = exportFormats.get(id)
      expect(audio.audioOnly).toBe(true)
      expect(audio.note).toContain('no video track')
    }
    // The video formats carry no marker — the modal treats absent as video.
    expect(exportFormats.get('webm').audioOnly).toBeUndefined()
    expect(exportFormats.get('mp4').audioOnly).toBeUndefined()
  })
})

describe('supportedExportFormats (#114)', () => {
  const ids = (isSupported: (type: string) => boolean) =>
    supportedExportFormats(isSupported).map((entry) => entry.id)

  it('offers both core formats when the browser records both', () => {
    expect(ids(() => true)).toEqual(['webm', 'mp4'])
  })

  it('is WebM-only where MP4 recording is unsupported (Firefox)', () => {
    expect(ids((type) => type.startsWith('video/webm'))).toEqual(['webm'])
  })

  it('offers MP4 when only the bare container type is recordable', () => {
    expect(ids((type) => type.startsWith('video/webm') || type === 'video/mp4')).toEqual([
      'webm',
      'mp4',
    ])
  })

  it('is empty when the browser cannot record at all', () => {
    expect(ids(() => false)).toEqual([])
  })

  it('consults the registry, so a contributed format is offered like a core one', () => {
    const registry = new ExportFormatRegistry()
    registerCoreExportFormats(registry)
    registry.register(spec('gif'))
    expect(
      supportedExportFormats((type) => type === 'video/gif', registry).map((entry) => entry.id),
    ).toEqual(['gif'])
  })

  describe('the audio-only format (#245)', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('is offered where Web Audio exists and an audio MIME is recordable', () => {
      vi.stubGlobal('AudioContext', class {})
      expect(ids((type) => type.startsWith('video/webm') || type.startsWith('audio/webm'))).toEqual(
        ['webm', 'audio-webm', 'audio-mp3'],
      )
    })

    it('is withheld where Web Audio is unavailable — the mix capture is the point', () => {
      // jsdom genuinely lacks AudioContext; assert that precondition so the
      // expectations above and below stay honest about what they rely on.
      expect(typeof AudioContext).toBe('undefined')
      expect(ids(() => true)).toEqual(['webm', 'mp4'])
    })

    it('is withheld where no audio MIME is recordable — but MP3 stays, since it never records (#269)', () => {
      // The WebM audio format needs a recordable audio MIME; the MP3 format
      // encodes its own audio, so Web Audio alone carries it. This is the
      // browser where the two genuinely differ.
      vi.stubGlobal('AudioContext', class {})
      expect(ids((type) => type.startsWith('video/'))).toEqual(['webm', 'mp4', 'audio-mp3'])
    })
  })

  it('a format with its own support probe is judged by the probe, not by MIME candidates (#198)', () => {
    const registry = new ExportFormatRegistry()
    // Empty candidate lists would always fail the MIME rule; the probe wins.
    registry.register({
      ...spec('probed'),
      candidates: [],
      candidatesWithAudio: [],
      isSupported: () => true,
    })
    registry.register({ ...spec('refused'), isSupported: () => false })
    expect(supportedExportFormats(() => true, registry).map((entry) => entry.id)).toEqual([
      'probed',
    ])
  })
})

describe('exportFileName (#114)', () => {
  it('follows the container with its extension', () => {
    expect(exportFileName('webm')).toBe('sequence-export.webm')
    expect(exportFileName('mp4')).toBe('sequence-export.mp4')
    // The audio-only export is still a WebM file, container-wise (#245).
    expect(exportFileName('audio-webm')).toBe('sequence-export.webm')
    expect(exportFileName('audio-mp3')).toBe('sequence-export.mp3')
  })
})
