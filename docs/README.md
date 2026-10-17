# Docs

With Handwired you write a numeric program: a fixed list of arithmetic operations over 32-bit floats, which these docs call FP32, mostly weighted sums and products with a ReLU. It is the neural net that the [README](../README.md) describes. You write it in builder code, i.e. ordinary JavaScript that runs once and appends the operations to a `Circuit`. No tool converts existing JavaScript source into a program. The runtime evaluates a program in JavaScript on the CPU, and only the JSON search demo runs on WebGPU.

[template/](../template/) is a toggle switch written as one numeric program and checked against the same switch in plain JavaScript, to copy as the start of a new app. Read the docs in this order:

- [tutorial.md](tutorial.md) walks through the template: declaring cells, builder code, the host loop, DOM writes, the test, and how to add a second switch or a new app folder.
- [expressions.md](expressions.md): one expression, e.g. `a >= b`, `Math.min(a, b)` or `table[index]`, where the hard part is an exact FP32 result.
- [patterns.md](patterns.md): a loop, e.g. `findIndex` or `items.sort(compare)`. The program runs every operation on every frame and can't stop early, so a loop becomes a count, a tree, a table, or the same work on every item.
- [behavior-choices.md](behavior-choices.md): choices that change what the user sees, to shorten dependency chains, make stored state independent of the frame rate, or keep each frame's work under a fixed maximum. E.g. a click during an animation hits elements where they're going, not where they're drawn.
- [execution-model.md](execution-model.md): the reference, to look things up in. It defines the four kinds of operation, which it calls instructions, how each one rounds, and what each builder function requires and guarantees, e.g. the declared ranges that `emitCompare` needs.

## Words the docs use

- **Operation**: one step of a program: a weighted sum (`circuit.affine`), a product with a ReLU (`circuit.reglu`), a score rounded to 0 or 1 (`circuit.boolean`), or a table read (`circuit.indexRead`).
- **Builder function**: a function that appends several operations, e.g. `emitCompare`. execution-model.md also calls it a macro.
- **Source table**: the `Float32Array` that a program reads.
- **Cell**: one number of the source table: a constant, an input, an event bit or state.
- **Wire**: the position of a number, either a cell or the result of an operation.
- **Evaluation**: one run of the program over the source table.
- **Host**: the JavaScript around the program. It writes inputs into cells, evaluates, copies next-state values back into the table, and writes the DOM.

## Running

The repo needs [Bun](https://bun.sh), and is tested with Bun 1.4.3.

```sh
bun install
bun start                                 # the demo site at http://127.0.0.1:3000/: the landing page, and the demos at /os/, /learned-gallery/ and /json-search/
bun run start:template                    # the template app, a toggle switch, at http://localhost:3000/
bun run test                              # every test in tests/, template/ and lab/, in about 3 minutes
bun test tests/runtime                    # one folder's tests, in about 2 s
bun run check                             # type-checks and lints src/, tests/, scripts/, template/ and lab/, in about 3 s
bun run site:build                        # the demo site as static files in site/
bun run site:check                        # builds the site and loads every page in headless Chrome
bun lab/ui-exploration/serve-demos.ts     # the lab's demos, at http://127.0.0.1:4321/
bun lab/runtime-cost/report.ts            # three programs' sizes and µs per evaluation in Bun. "window manager" is HandwiredOS
```

`bun start` takes `--port` for another port. The demo site listens on 127.0.0.1:3000 and the template on localhost:3000, so both can run at once, each at its own address. `bun run site:check` needs Chrome, with `CHROME_PATH` for a binary that isn't at the macOS default path.

## Where things are

- `src/runtime/`: what every program is built and run with. `numeric-ui-core.ts` has the `Circuit` class, the builder functions, the compiler and the evaluators. `cells.ts` declares a program's cells and checks their values. `host-timing.ts` plans a frame's evaluations and spring steps, in plain JavaScript. `prefix-networks.ts` computes every prefix of a list under an associative combine, e.g. running totals of row heights
- `src/handwiredos/`, `src/learned-gallery/` and `src/json-search/`: the three demos, each with a README that names its files. HandwiredOS is a small desktop with three windows and a dock, run by one program. The learned gallery is a photo layout computed by a small network inside a program, whose coefficients are trained with the program's own gradients. JSON search searches 100,000 JSON documents at each keystroke, with two programs that it writes as WebGPU shaders
- `assets/`: the demo site's pages, stylesheets and images, e.g. `demos.html` for the landing page and `index.html` for HandwiredOS
- `template/`: the toggle switch to start an app from
- `tests/`: `tests/runtime/` runs programs, including seeded random ones, through a plain reference evaluator and the compiled one, and compares the results. The other folders hold each demo's tests, which run without a browser, e.g. JSON search's GPU code through an interpreter
- `scripts/`: `check.ts` is what `bun run check` runs, and the other files are the demo site's server, build and check, which share the list of pages in `demo-site-pages.ts`. `.github/workflows/pages.yml` runs the build on pushes to main and publishes site/ to GitHub Pages
- `lab/`: the experiments that the runtime and the demos came out of. You can build an app without reading them. Its READMEs describe the code as it was when each was written. [lab/status.md](../lab/status.md) lists measurements and the known issues in src/, and its section [The folders of lab/](../lab/status.md#the-folders-of-lab) says what each folder is. The lab's [guide](../lab/ui-exploration/guide/README.md) has longer explanations and more runnable examples

- [General-purpose WebGPU backend](webgpu-backend.md): circuit execution, browser verification and profiling.

