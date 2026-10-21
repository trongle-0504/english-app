import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { contentPlugin } from './content-pipeline/vite-plugin.ts'

const rootDir = import.meta.dirname

/**
 * Mounts the local API (grammar analyzer, admin editors) on the dev server. server/ is loaded through Vite's SSR
 * module graph instead of being imported here, so an edit there only re-evaluates the changed modules on the next
 * request. Imported here, every edit restarted the whole dev server, and each restart re-imported the bundled config
 * (Node never frees an imported module): the server ran out of memory after a few hundred edits.
 * State that must outlive a reload (running jobs) is kept on globalThis by the modules that own it.
 */
function apiPlugin(): Plugin {
  return {
    name: 'english-app:api',
    configureServer(server) {
      const ctx = { contentDir: path.join(rootDir, 'content'), rootDir, onContentChange: () => {} }
      const load = <T>(url: string) => server.ssrLoadModule(url) as Promise<T>
      // .env must reach process.env before the other server modules are evaluated: some read it at load time.
      let envLoaded: Promise<void> | undefined
      server.middlewares.use('/api', async (req, res, next) => {
        try {
          await (envLoaded ??= load<typeof import('./server/env.ts')>('/server/env.ts').then((m) => m.loadEnv(rootDir)))
          const [{ createApiMiddleware }, { routes }] = await Promise.all([
            load<typeof import('./server/api.ts')>('/server/api.ts'),
            load<typeof import('./server/routes.ts')>('/server/routes.ts'),
          ])
          // Content edits made by the API are picked up by the content plugin's file watcher.
          await createApiMiddleware(ctx, routes)(req, res, next)
        } catch (error) {
          // A server module failed to load (e.g. a half-saved edit, logged by Vite); the next request tries again.
          envLoaded = undefined
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: `API failed to load: ${(error as Error).message}` }))
        }
      })
    },
  }
}

/**
 * The login gate on the dev server (the production server calls the same `gate`). It must run before the content
 * plugin's /data middleware, hence `enforce: 'pre'` and first in the list. Loaded like apiPlugin, through Vite's SSR
 * module graph.
 */
function authPlugin(): Plugin {
  return {
    name: 'english-app:auth',
    enforce: 'pre',
    configureServer(server) {
      const load = <T>(url: string) => server.ssrLoadModule(url) as Promise<T>
      let envLoaded: Promise<void> | undefined
      server.middlewares.use(async (req, res, next) => {
        try {
          await (envLoaded ??= load<typeof import('./server/env.ts')>('/server/env.ts').then((m) => m.loadEnv(rootDir)))
          const { gate } = await load<typeof import('./server/auth/middleware.ts')>('/server/auth/middleware.ts')
          if (await gate(req, res)) next()
        } catch (error) {
          envLoaded = undefined
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: `Auth check failed: ${(error as Error).message}` }))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [authPlugin(), contentPlugin(rootDir), react(), tailwindcss(), apiPlugin()],
  resolve: { alias: { '@': path.join(rootDir, 'src') } },
  // logs/, progress/ and data/ are written while the server runs; watching them would reload pages.
  server: { port: 5173, watch: { ignored: ['**/logs/**', '**/progress/**', '**/cache/**', '**/data/**'] } },
})
