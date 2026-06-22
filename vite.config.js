import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'
import { resolve } from 'path'

const WIDGET_SOURCES = [
  'aftercare-text-widget.js',
  'aftercare-badge-poll.js',
]

function syncWidgetPlugin() {
  function runSync() {
    try {
      execSync('npm run sync-widget', { stdio: 'inherit', cwd: resolve(__dirname) })
    } catch (e) {
      console.error('[sync-widget] Failed:', e.message)
    }
  }

  return {
    name: 'sync-widget',
    buildStart() {
      // Run sync (copy + minify) at the start of every build cycle so the
      // freshest widget files are in public/ before Vite copies them to dist/.
      runSync()
      // Register widget source files with Vite's watcher so a change to
      // either file triggers a new build cycle in --watch mode.
      for (const f of WIDGET_SOURCES) {
        this.addWatchFile(resolve(process.cwd(), f))
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), syncWidgetPlugin()],
    define: {
      'import.meta.env.FIREBASE_DB_URL': JSON.stringify(env.FIREBASE_DB_URL ?? ''),
    },
    server: {
      port: 3000
    }
  }
})
