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
  },
})
