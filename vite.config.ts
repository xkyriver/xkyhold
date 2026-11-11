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
  test: {
    include: ['src/**/*.test.ts'],
  },
})
