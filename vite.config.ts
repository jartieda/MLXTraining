import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // Principle IV / SC-008: the heavy ML runtime must not sit in the initial route.
    // Keeping it in its own chunk makes a regression visible in the build output
    // rather than only in a Lighthouse run.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@tensorflow')) return 'tfjs'
          return undefined
        },
      },
    },
  },
})
