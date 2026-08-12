import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Vitest runs without injected globals, so Testing Library's automatic
// cleanup never registers itself — do it explicitly.
afterEach(cleanup)
