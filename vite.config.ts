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
  // No `manualChunks`, deliberately, and this is the second time it has been worth
  // stating (T119).
  //
  // A `manualChunks` entry forcing `@tensorflow` into its own chunk was here to make
  // the ML runtime's size visible in the build output. It had the opposite effect: a
  // forced chunk becomes a static dependency of whatever references it, so Vite emitted
  // a `<link rel="modulepreload">` for it in `index.html` and every visitor downloaded
  // 279 KB gzipped of TensorFlow.js on first paint — including an anonymous visitor
  // who never opened the lab. SC-008's three-second budget was being missed by more
  // than twice over, invisibly, because the build output looked *better* with the
  // named chunk than without it.
  //
  // Rollup's automatic chunking keeps the runtime inside the lazily-imported lab graph,
  // which is what was wanted. `npm run check:bundle` is what makes the size visible,
  // and unlike a named chunk it fails rather than merely informing.
})
