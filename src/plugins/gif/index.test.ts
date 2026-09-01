import { afterEach, describe, expect, it } from 'vitest'
import { exportFormats } from '../../lib/exportFormats'
import { activate, GIF_FORMAT_ID } from './index'
import { GIF_FRAME_RATE, GIF_MAX_DIMENSION } from './gifSink'

/**
 * The GIF plugin's registration (#198). These tests exercise the module the
 * plugin runtime lazy-loads, against the app's real registry singleton —
 * the deactivate returned by `activate` is the cleanup.
 */

let deactivate: (() => void) | null = null

afterEach(() => {
  deactivate?.()
  deactivate = null
})

describe('GIF plugin activate/deactivate (#198)', () => {
  it('registers the Animated GIF format and the deactivate unregisters it', () => {
    expect(exportFormats.has(GIF_FORMAT_ID)).toBe(false)
    deactivate = activate()
    expect(exportFormats.has(GIF_FORMAT_ID)).toBe(true)
    const spec = exportFormats.get(GIF_FORMAT_ID)
    expect(spec.label).toBe('Animated GIF')
    expect(spec.extension).toBe('gif')
    deactivate()
    deactivate = null
    expect(exportFormats.has(GIF_FORMAT_ID)).toBe(false)
  })

  it('probes support directly instead of through recorder MIME candidates', () => {
    deactivate = activate()
    const spec = exportFormats.get(GIF_FORMAT_ID)
    // No MediaRecorder involvement: the candidate lists are empty and the
    // probe answers for itself (jsdom grants no 2D context, so it is
    // honestly false here; the e2e suite proves the true case in Chromium).
    expect(spec.candidates).toEqual([])
    expect(spec.candidatesWithAudio).toEqual([])
    expect(spec.isSupported?.(() => true)).toBe(
      document.createElement('canvas').getContext('2d') !== null,
    )
  })

  it('states its limits in the format note — the caps the sink enforces', () => {
    deactivate = activate()
    const note = exportFormats.get(GIF_FORMAT_ID).note
    expect(note).toContain(`${GIF_FRAME_RATE} fps`)
    expect(note).toContain(`${GIF_MAX_DIMENSION} px`)
    expect(note).toContain('soundless')
  })
})
