import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // Node is the DEFAULT on purpose. Constitution Principle VI requires src/ml/ to be
    // testable without a DOM, and defaulting to jsdom would hide an accidental DOM
    // dependency in the ML core until it broke somewhere else. Component tests opt in
    // per file with a `@vitest-environment jsdom` docblock.
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    setupFiles: ['tests/setup.ts'],
    globals: true,
  },
})
