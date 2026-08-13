/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base must match the GitHub Pages project path:
// https://pcowhill.github.io/claude-agile-team-demo/
export default defineConfig({
  base: '/claude-agile-team-demo/',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Playwright owns e2e/; Vitest must not try to run those specs. tools/ is
    // repository tooling (not shipped code), unit-tested here because
    // Playwright cannot test the config that decides how to launch it.
    include: ['src/**/*.test.{ts,tsx}', 'tools/**/*.test.ts'],
  },
})
