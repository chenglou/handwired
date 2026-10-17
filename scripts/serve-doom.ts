// Serves the Doom page while developing: the page as a Bun HTML import, its worker built at each request, and the WADs
// that scripts/fetch-doom-wad.ts downloaded.
//
//   bun scripts/serve-doom.ts    (http://127.0.0.1:3001/, or ?wad=freedoom for Freedoom; PORT for another port)
import {existsSync} from 'node:fs'
import {resolve} from 'node:path'
import page from '../assets/doom.html'

// Looked up at each request, so a WAD fetched while the server runs is served; a missing one is a 404, which the page
// explains.
const wadNames = ['doom1.wad', 'freedoom1.wad']
const wadPath = (name: string) => resolve(import.meta.dir, '../.cache/doom', name)
const port = Number(process.env['PORT'] ?? 3001)
const server = Bun.serve({
  port,
  hostname: '127.0.0.1',
  routes: {
    '/': page,
    ...Object.fromEntries(wadNames.map(name => [`/${name}`, () =>
      existsSync(wadPath(name)) ? new Response(Bun.file(wadPath(name))) : new Response(`${name} is not in .cache/doom`, {status: 404})])),
    '/worker.js': async () => {
      const built = await Bun.build({entrypoints: [resolve(import.meta.dir, '../src/doom/worker.ts')], target: 'browser', format: 'iife', throw: false})
      const script = built.outputs[0]
      if (!built.success || script === undefined) return new Response(built.logs.map(log => log.message).join('\n'), {status: 500})
      return new Response(script, {headers: {'content-type': 'text/javascript;charset=utf-8'}})
    },
  },
  // Bundled per change like development: true, but without hot reloading, whose runtime fails to reload the page's
  // module after an edit ("Failed to load bundled module './main.ts'") until the server restarts. Reload the page.
  development: {hmr: false},
})
const wads = wadNames.filter(name => existsSync(wadPath(name)))
console.log(`Handwired Doom at ${server.url} with ${wads.length === 0 ? 'no WAD yet: run `bun scripts/fetch-doom-wad.ts`' : wads.join(', ')}`)
