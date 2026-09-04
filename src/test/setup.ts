import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Vitest runs without injected globals, so Testing Library's automatic
// cleanup never registers itself — do it explicitly.
//
// Clearing localStorage belongs in the same hook (#345). jsdom gives a whole
// test *file* one store, and the app's persisted preferences default to it —
// the library view (#311), the preview's expanded state (#128) and the
// enabled plugin set (#197). Without this, one test toggling a preference
// silently decided what every later test in that file measured, and an
// assertion meant for the default state passed against the other one. The
// failure is order-dependent and reports success either way, which is worse
// than no test at all.
//
// Order inside the hook matters: unmount first, because a component may
// write on the way out, then clear what it wrote.
afterEach(() => {
  cleanup()
  localStorage.clear()
})
