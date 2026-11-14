import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vitest/config'
import pkg from './package.json' with { type: 'json' }

export default defineConfig({
  plugins: [svelte()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  // The OAuth client only accepts registered origins, so the dev port is fixed.
  server: { port: 5173, strictPort: true },
  // The landing page in English (/) and Portuguese (/pt/), the Linux app's
  // page (/linux/, /pt/linux/), and the app itself (/app/).
  build: {
    rollupOptions: {
      input: {
        landing: 'index.html',
        'landing-pt': 'pt/index.html',
        linux: 'linux/index.html',
        'linux-pt': 'pt/linux/index.html',
        app: 'app/index.html',
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
})
