// The demo site's pages, and its icon. Three scripts read this file, so a page has the same path in each:
// build-demo-site.ts builds the pages into site/, serve-demo-site.ts serves them while developing, and
// check-demo-site.ts loads the built site in headless Chrome.
import {existsSync} from 'node:fs'
import {resolve} from 'node:path'

export const repoRoot = resolve(import.meta.dir, '..')

// `source` is the page's file in the repo, and `path` is its folder on the site, relative to the site's root, e.g.
// 'os/' is served at <site>/os/ and built as site/os/index.html. The site is served under a path prefix, e.g.
// https://example.com/handwired/, so every link between pages is relative and written for these paths: the index
// links to HandwiredOS as "os/", and a demo's page links to the index as "../". A link from one demo's page to
// another demo would be e.g. "../learned-gallery/", and no page has such a link today.
export type SitePage = {source: string, path: string}

const publishedPages: SitePage[] = [
  {source: 'assets/demos.html', path: ''},
  {source: 'assets/index.html', path: 'os/'},
  {source: 'assets/neural-lander.html', path: 'neural-lander/'},
  {source: 'assets/learned-gallery.html', path: 'learned-gallery/'},
]
// A page of this list is built, served and checked only while its file exists. The list was made for the GPU search
// demo while its page was being written. The page exists now, and its card in assets/demos.html is shown.
const pagesBuiltWhenTheyExist: SitePage[] = [
  {source: 'assets/json-search.html', path: 'json-search/'},
]
export const sitePages: SitePage[] = [
  ...publishedPages,
  ...pagesBuiltWhenTheyExist.filter(page => existsSync(resolve(repoRoot, page.source))),
]
export const siteFoldersNotBuilt: string[] = pagesBuiltWhenTheyExist
  .filter(page => !existsSync(resolve(repoRoot, page.source)))
  .map(page => page.path)

// The scripts that a page starts as a worker. Bun's bundler (1.4.3) doesn't follow `new Worker(...)` from a page's
// script, so each worker is built on its own, as one file that imports nothing. `path` is the file on the site,
// relative to the site's root, next to its page: the page at json-search/ starts its worker as "./demo-worker.js".
export type SiteWorker = {source: string, path: string}
export const siteWorkers: SiteWorker[] = [
  {source: 'src/json-search/demo-worker.ts', path: 'json-search/demo-worker.js'},
].filter(worker => existsSync(resolve(repoRoot, worker.source)))

// The project's mark, three wires into one eyelet and one wire out, on a tile of the paper color, so the mark also
// shows on a dark tab bar. The colors repeat --paper, --ink and --copper of assets/site.css, since an image can't read
// the page's custom properties.
export const iconSvg = [
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>`,
  `<rect width='32' height='32' rx='7' fill='#f3eee4'/>`,
  `<path d='M5 8.5h4.5l4.6 5.4M5 16h6.2M5 23.5h4.5l4.6-5.4M20.8 16H27' fill='none' stroke='#1e1a16' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/>`,
  `<circle cx='16' cy='16' r='4.3' fill='#f3eee4' stroke='#a64d1d' stroke-width='2.4'/>`,
  `</svg>`,
].join('')

// The icon as a link tag with the image inline, so a page needs no icon file and no request to the host's root, where
// /favicon.ico belongs to another site when this one is served under a path prefix. Inside a URL in a double-quoted
// attribute, only these three characters of the image need escaping.
export const iconLinkTag = `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${iconSvg.replaceAll('#', '%23').replaceAll('<', '%3C').replaceAll('>', '%3E')}">`
