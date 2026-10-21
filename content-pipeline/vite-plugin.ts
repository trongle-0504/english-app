import path from 'node:path'
import type { Plugin } from 'vite'
import { createContentStore } from './store.ts'

/**
 * Serves /data/*.json from content/ during dev (rebuilt and hot-reloaded on edit) and emits the same
 * files into dist/data on build, so the app never bundles content into JavaScript.
 */
export function contentPlugin(root: string): Plugin {
  const contentDir = path.join(root, 'content')
  const store = createContentStore(contentDir)
  // Speaking ideas' tags (content/speaking/) are not part of the build and are rewritten batch by batch during a
  // sync: changes there must not rebuild the content or reload pages.
  const speakingDir = path.join(contentDir, 'speaking')
  const watched = (file: string) => file.startsWith(contentDir) && !file.startsWith(speakingDir)

  return {
    name: 'english-app:content',
    // Runs before @tailwindcss/vite (also 'pre'), see hotUpdate below.
    enforce: 'pre',
    config() {
      return { define: { __CONTENT_VERSION__: JSON.stringify(store.current().version) } }
    },
    configureServer(server) {
      server.watcher.add(contentDir)
      const onChange = (file: string) => {
        if (!watched(file)) return
        store.invalidate()
        server.config.logger.info(`content changed: ${path.relative(contentDir, file)}`, { timestamp: true })
        server.ws.send({ type: 'custom', event: 'content:changed' })
      }
      server.watcher.on('change', onChange)
      server.watcher.on('add', onChange)
      server.watcher.on('unlink', onChange)
      server.middlewares.use('/data', store.middleware({ cache: 'no-store' }))
    },
    // Tailwind scans content/ for class names and reloads every page when a scanned file changes, which
    // would wipe the admin editor right after a save. Hand Vite only the stylesheet instead: Tailwind then
    // regenerates the CSS (new classes in blog markdown still work) and pages decide themselves whether to
    // reload (see src/lib/contentReload.ts). This plugin must be listed before tailwindcss().
    hotUpdate({ file }) {
      if (!file.startsWith(contentDir)) return
      if (!watched(file)) return []
      const css = this.environment.moduleGraph.getModulesByFile(path.join(root, 'src/styles/index.css'))
      return css ? [...css] : []
    },
    generateBundle() {
      const build = store.current()
      for (const warning of build.warnings) this.warn(warning)
      for (const [key, json] of build.files) {
        this.emitFile({ type: 'asset', fileName: `data/${key}`, source: json })
      }
    },
  }
}
