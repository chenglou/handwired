const config = {
  entry: [
    'src/handwiredos/window-manager.ts',
    'src/learned-gallery/learned-gallery.ts',
    // JSON search's page loads demo.ts. demo.ts starts demo-worker.ts as a worker from a URL, which is not an import,
    // and imports only two types from it, and scripts/demo-site-pages.ts builds the worker as a file of its own. So
    // both are entries. demo.ts reaches the two programs that the page runs, in src/json-search/regex and
    // src/json-search/highlighter.
    'src/json-search/demo.ts',
    'src/json-search/demo-worker.ts',
    // The prefix networks, which only tests and lab code import, e.g. tests/runtime/prefix-networks.test.ts,
    // lab/knuth-plass and the guide's examples in lab/ui-exploration/guide.
    'src/runtime/prefix-networks.ts',
    'lab/candidate-gallery/candidate-gallery.ts',
    'template/main.ts',
    // The template's switch in plain JavaScript, which only template/toggle.test.ts imports.
    'template/toggle-reference.ts',
    // The Doom port's page loads main.ts, which starts worker.ts as a worker from a URL. package.json's start:doom
    // runs its server, and the scripts that fetch a WAD and check the page in headless Chrome are run by hand.
    'src/doom/main.ts',
    'src/doom/worker.ts',
    'scripts/fetch-doom-wad.ts',
    'scripts/check-doom-page.ts',
  ],
  // lab/ holds standalone experiments that run as scripts or tests, so knip only checks src/, scripts/ and the template.
  project: ['*.ts', 'src/**/*.ts', 'scripts/*.ts', 'template/*.ts'],
  // Bun otherwise discovers tests as entries before the ignore is applied.
  bun: false,
  // Test imports should not keep production exports alive. An export that stays for tests/ or lab/,
  // e.g. validateGrids, has a /** @public */ comment above its declaration, which knip skips.
  ignore: ['**/*.test.ts'],
  ignoreExportsUsedInFile: true,
  // scripts/check.ts runs tsc and oxlint through bunx, which knip doesn't see, and knip never reports the typescript
  // package. Only lab/ imports pretext, e.g. lab/knuth-plass and lab/ui-exploration/text-walker/batch, and knip doesn't
  // look at lab/. typescript6 is TypeScript 6, the last version written in JavaScript, which only lab/trace-compiler
  // imports, for the compiler API that TypeScript 7 doesn't have. Its name sorts after "typescript", so Bun links
  // node_modules/.bin/tsc to TypeScript 7: of two packages with a `tsc` binary, Bun 1.4.3 links the one whose name
  // sorts first. scripts/check.ts stops if `bunx tsc` is ever another compiler than the typescript package's.
  ignoreDependencies: ['oxlint', 'oxlint-tsgolint', '@chenglou/pretext', 'typescript6'],
}

export default config
