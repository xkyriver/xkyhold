import { execSync } from 'node:child_process'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import pkg from './package.json' with { type: 'json' }

// What this build is, so an open tab can tell that a newer one was
// deployed (docs/UPDATES.md in xkyhold-lx, section 3). The commit when
// there is one; otherwise the build time.
function buildId(): string {
  try {
    return execSync('git rev-parse --short=12 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return `t${Date.now()}`
  }
}
const BUILD = buildId()

/** Writes /version.json next to the pages (served with no-store). */
function versionFile(): Plugin {
  return {
    name: 'xkyhold-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version: pkg.version, build: BUILD }) + '\n',
      })
    },
  }
}

export default defineConfig({
  plugins: [svelte(), versionFile()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD__: JSON.stringify(BUILD),
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
