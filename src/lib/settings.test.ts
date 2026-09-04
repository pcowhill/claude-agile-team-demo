import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  LARGE_STEP_CHOICES,
  SESSION_RESTORE_CHOICES,
  SETTINGS_KEY,
  STEP_CHOICES,
  STILL_DURATION_CHOICES,
  formatSeconds,
  loadSettings,
  parseSettings,
  saveSettings,
  sessionRestoreLabel,
} from './settings'
import type { AppSettings } from './settings'
import { DEFAULT_STILL_DURATION } from './timeline'
import { LARGE_STEP_SECONDS, STEP_SECONDS } from './transport'

/** A store that records what was written, like the component tests' own. */
function fakeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  }
}

/** A store whose every access throws (storage disabled by the browser). */
const brokenStorage = {
  getItem: () => {
    throw new Error('storage disabled')
  },
  setItem: () => {
    throw new Error('storage disabled')
  },
}

describe('settings defaults (#286)', () => {
  it('defaults to the values the product used before there were settings', () => {
    // The promise in the issue's acceptance criteria — "a fresh visitor sees
    // exactly today's behavior" — checked against the constants themselves
    // rather than against retyped numbers, so it cannot rot if a constant
    // changes.
    expect(DEFAULT_SETTINGS).toEqual({
      stepSeconds: STEP_SECONDS,
      largeStepSeconds: LARGE_STEP_SECONDS,
      stillDurationSeconds: DEFAULT_STILL_DURATION,
      sessionRestore: 'ask',
      exportFormat: 'webm',
    })
  })

  it('offers every default as a choice, so the dialog can show it', () => {
    // A default outside its own choice list would leave a fresh visitor
    // looking at a <select> with nothing selected.
    expect(STEP_CHOICES).toContain(DEFAULT_SETTINGS.stepSeconds)
    expect(LARGE_STEP_CHOICES).toContain(DEFAULT_SETTINGS.largeStepSeconds)
    expect(STILL_DURATION_CHOICES).toContain(DEFAULT_SETTINGS.stillDurationSeconds)
    expect(SESSION_RESTORE_CHOICES).toContain(DEFAULT_SETTINGS.sessionRestore)
  })

  it('labels each choice for the dialog', () => {
    expect(formatSeconds(0.1)).toBe('0.1 s')
    expect(formatSeconds(10)).toBe('10 s')
    expect(SESSION_RESTORE_CHOICES.map(sessionRestoreLabel)).toEqual([
      'Ask each time',
      'Always restore',
      'Never restore',
    ])
  })
})

describe('settings validation (#286)', () => {
  const stored: AppSettings = {
    stepSeconds: 0.25,
    largeStepSeconds: 2,
    stillDurationSeconds: 10,
    sessionRestore: 'never',
    exportFormat: 'mp4',
  }

  it('keeps every recognized stored value', () => {
    expect(parseSettings(stored)).toEqual(stored)
  })

  it.each([
    ['not an object', 'nonsense'],
    ['null', null],
    ['an array', []],
  ])('falls back to the defaults for %s', (_label, value) => {
    expect(parseSettings(value)).toEqual(DEFAULT_SETTINGS)
  })

  it('replaces only the fields it cannot recognize', () => {
    // Field-by-field validation is the point: a store written by a version
    // that offered a step size this one does not must cost the user that one
    // row, not the four settings around it.
    expect(
      parseSettings({
        stepSeconds: 0.02,
        largeStepSeconds: 2,
        stillDurationSeconds: 'five',
        sessionRestore: 'maybe',
        exportFormat: 'mp4',
      }),
    ).toEqual({
      stepSeconds: DEFAULT_SETTINGS.stepSeconds,
      largeStepSeconds: 2,
      stillDurationSeconds: DEFAULT_SETTINGS.stillDurationSeconds,
      sessionRestore: DEFAULT_SETTINGS.sessionRestore,
      exportFormat: 'mp4',
    })
  })

  it('keeps an export format this browser cannot currently offer', () => {
    // The registry decides availability at runtime (#114/#197), not this
    // module: a preference for a plugin's format must survive the plugin
    // being disabled, so any non-empty string is stored as given.
    expect(parseSettings({ exportFormat: 'gif' }).exportFormat).toBe('gif')
    expect(parseSettings({ exportFormat: '' }).exportFormat).toBe('webm')
    expect(parseSettings({ exportFormat: 7 }).exportFormat).toBe('webm')
  })
})

describe('settings persistence (#286)', () => {
  const stored: AppSettings = {
    ...DEFAULT_SETTINGS,
    stepSeconds: 0.5,
    sessionRestore: 'always',
  }

  it('round-trips through a store under its own key', () => {
    const storage = fakeStorage()
    saveSettings(stored, storage)

    expect([...storage.values.keys()]).toEqual([SETTINGS_KEY])
    expect(loadSettings(storage)).toEqual(stored)
  })

  it('reads the defaults from an empty store', () => {
    expect(loadSettings(fakeStorage())).toEqual(DEFAULT_SETTINGS)
  })

  it('reads the defaults from a corrupt entry rather than throwing', () => {
    expect(loadSettings(fakeStorage({ [SETTINGS_KEY]: '{not json' }))).toEqual(DEFAULT_SETTINGS)
  })

  it('survives a store that is absent or throws on access', () => {
    // Same policy as the other preferences (#128/#311): losing the setting
    // is acceptable, breaking the editor is not.
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(loadSettings(brokenStorage)).toEqual(DEFAULT_SETTINGS)
    expect(() => saveSettings(stored, null)).not.toThrow()
    expect(() => saveSettings(stored, brokenStorage)).not.toThrow()
  })
})
