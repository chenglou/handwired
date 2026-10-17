// The host: builds the programs for a level and runs them. Per tic it writes the held keys into the game program's
// table, evaluates it, writes its next state back, and copies its view into the frame program's table and its counters
// into the status program's. Per frame it evaluates the frame program, copies its tables into the column program's
// table, and evaluates that once per column; per column it copies the column's record into the pixel program's table
// and evaluates that once per row. Every copy is a block of numbers in the layout both sides declare, which building
// checks; the host computes nothing.
import {type Circuit, type Wire, invariant} from '../runtime/numeric-ui-core.ts'
import {type Assets, loadAssets} from './assets.ts'
import {type TensorProgram, compileProgram, packedPositions} from './codegen.ts'
import {buildColumnPrograms} from './column-program.ts'
import {buildFrameProgram} from './frame-program.ts'
import {buildGameProgram} from './game-program.ts'
import {buildLevel} from './level.ts'
import {buildScene, maxEdges} from './scene.ts'
import {buildStatusProgram, statusHeight, statusWidth} from './status-program.ts'
import {buildSpriteCatalog, buildStateTables, levelThings} from './things.ts'
import {type ViewConfig, defaultView} from './view.ts'
import {readMap, readWad} from './wad.ts'

export type Keys = {
  forward: boolean
  back: boolean
  turnLeft: boolean
  turnRight: boolean
  strafeLeft: boolean
  strafeRight: boolean
  run: boolean
  use: boolean
  fire: boolean
  fist: boolean
  pistol: boolean
  shotgun: boolean
}

export const noKeys: Keys = {
  forward: false, back: false, turnLeft: false, turnRight: false, strafeLeft: false, strafeRight: false, run: false, use: false,
  fire: false, fist: false, pistol: false, shotgun: false,
}

// Every wire of a struct of wires, lists and objects, in declaration order: the order cells.ts lays out cells.
export function flattenWires(struct: unknown, into: Wire[] = []): Wire[] {
  if (typeof struct === 'number') into.push(struct as Wire)
  else if (Array.isArray(struct)) for (const element of struct) flattenWires(element, into)
  else for (const value of Object.values(struct as Record<string, unknown>)) flattenWires(value, into)
  return into
}

// The path of every wire of a struct in flattenWires' order, e.g. 'sprites.3.x1'.
function wirePaths(struct: unknown, path = '', into: string[] = []): string[] {
  if (typeof struct === 'number') into.push(path)
  else if (Array.isArray(struct)) struct.forEach((element, index) => wirePaths(element, `${path}.${index}`, into))
  else for (const [key, value] of Object.entries(struct as Record<string, unknown>)) wirePaths(value, `${path}.${key}`, into)
  return into
}

// Whether `outputs` lists the fields of the run of cells `cells` in their order, from the cell `first` on, which a
// copy of one program's outputs into the next one's cells as a block needs.
function lineUp(outputs: unknown, cells: unknown, first: number) {
  const cellWires = flattenWires(cells)
  return wirePaths(outputs).join() === wirePaths(cells).join() && cellWires.every((wire, index) => wire === first + index)
}

// How a program runs: 'tensor' is the runtime's evaluator, 'js' this folder's generated JavaScript, which computes
// the same bits. Generated JavaScript is faster only once the engine's optimizing compiler has seen each function run
// many times, so it suits the column and pixel programs, which run once per column and pixel, and not the game program,
// which runs once per tic: JavaScriptCore keeps it in its interpreter, tens of times slower. The frame program runs once
// per frame, which is too seldom at the CPU's frame rates and often enough at the GPU's, so a host can move it between
// backends as frames move. The column backend runs both the column and the pixel program.
type Backend = 'tensor' | 'js'
export type Backends = {game: Backend, frame: Backend, column: Backend}
const defaultBackends: Backends = {game: 'tensor', frame: 'tensor', column: 'js'}

// A compiled program's packed values, source cells first at their own positions, and a function that evaluates the
// program in place.
type Runner = {values: Float32Array, run: () => void, program: TensorProgram}

export function createRunner(circuit: Circuit, roots: Wire[], backend: Backend): Runner {
  return runProgram(circuit, circuit.compileTensorProgram(roots), backend)
}

function runProgram(circuit: Circuit, program: TensorProgram, backend: Backend): Runner {
  if (backend === 'js') {
    const compiled = compileProgram(program)
    return {values: compiled.values, run: () => compiled.run(), program}
  }
  const evaluate = circuit.createTensorProgramEvaluator(program)
  const values = evaluate.packedValues
  // The evaluator copies its source into packedValues first, here from packedValues itself.
  const source = values.subarray(0, program.sourceSize)
  return {values, run: () => void evaluate(source), program}
}

// The four instructions, in the order an operation's kind numbers them.
export const instructions = ['sums', 'gates', 'booleans', 'reads'] as const

// A program's operations that compute, i.e. every one but its constants: a constant is a sum of no terms, the same
// value every run, e.g. a texel of a table. Their packed positions, in execution order, and each one's layer and kind,
// an index into `instructions`.
type Operations = {positions: Int32Array, layers: Uint16Array, kinds: Uint8Array, layerCount: number}

export function operationsOf(program: TensorProgram): Operations {
  const positions: number[] = []
  const layers: number[] = []
  const kinds: number[] = []
  let available = program.sourceSize
  program.layers.forEach((layer, layerIndex) => {
    const gates = new Set(layer.gateRows)
    const booleans = new Set(layer.booleanRows)
    const reads = new Set(layer.indexReads.map(read => read.row))
    for (let row = 0; row < layer.outputSize; row++) {
      const kind = reads.has(row) ? 3 : booleans.has(row) ? 2 : gates.has(row) ? 1 : 0
      if (kind === 0 && layer.rowOffsets[row] === layer.rowOffsets[row + 1]) continue
      positions.push(available + row)
      layers.push(layerIndex)
      kinds.push(kind)
    }
    available += layer.outputSize
  })
  return {positions: Int32Array.from(positions), layers: Uint16Array.from(layers), kinds: Uint8Array.from(kinds), layerCount: program.layers.length}
}

// A named operation of the pixel program, by its index among the program's operations, for the page's x-ray.
export type XrayStop = {operation: number, name: string, palette: boolean, chapter: string | null}

// A program's size and its mix of the four instructions: weighted sums, ReGLU gates, boolean atoms and table reads.
// Operations are the ones that compute; constants are counted apart.
export type ProgramSize = {name: string, operations: number, constants: number, layers: number, sums: number, gates: number, booleans: number, reads: number}

function programSize(name: string, program: TensorProgram): ProgramSize {
  let gates = 0
  let booleans = 0
  let reads = 0
  for (const layer of program.layers) {
    gates += layer.gateRows.length
    booleans += layer.booleanRows.length
    reads += layer.indexReads.length
  }
  const operations = operationsOf(program).positions.length
  const constants = program.valueCount - program.sourceSize - operations
  return {name, operations, constants, layers: program.layers.length, sums: operations - gates - booleans - reads, gates, booleans, reads}
}

// What the page's inspector shows about one column: the cells its ray walks, the boundaries of its intervals and
// what each interval shows, how far its ray goes before a wall, and the value of every operation of its column
// program and then of the pixel program for each of its rows, constants left out.
export type ColumnInspection = {
  column: number
  cells: Int32Array
  boundaries: Int16Array
  kinds: Uint8Array
  inverseZ: Float32Array
  // How many steps the ray took up to and including the first solid wall.
  walked: number
  activations: Float32Array
}

// columnsMs and pixelsMs: on the CPU each program's time, and on the GPU both programs' together in columnsMs.
export type Timings = {gameMs: number, frameMs: number, columnsMs: number, pixelsMs: number, statusMs: number}

export function createEngine(
  wadBytes: Uint8Array,
  options: {view?: ViewConfig, map?: string, backends?: Partial<Backends>, log?: (message: string) => void} = {},
) {
  const view = options.view ?? defaultView
  const mapName = options.map ?? 'E1M1'
  const backends: Backends = {...defaultBackends, ...options.backends}
  const log = options.log ?? (() => {})
  const wad = readWad(wadBytes)
  const map = readMap(wad, mapName)
  const level = buildLevel(map, {maxEdges})
  const assets: Assets = loadAssets(wad, map)
  const scene = buildScene(level, assets)
  log(`${mapName}: ${scene.cells.length} cells, ${scene.lines.length} lines`)
  const states = buildStateTables()
  const things = levelThings(map, states)
  const catalog = buildSpriteCatalog(wad, states.frames)
  log(`${things.length} things, ${catalog.lumps.length} sprite lumps`)
  const game = buildGameProgram(level, states, things)
  log('game program built')
  const frame = buildFrameProgram(scene, view, catalog, game.output.view.things.length, states, assets.scaleLight)
  log('frame program built')
  const {columns, pixels} = buildColumnPrograms(scene, assets, view, catalog)
  log('column and pixel programs built')
  const statusBar = buildStatusProgram(wad)

  const viewWires = flattenWires(game.output.view)
  const statusWires = flattenWires(game.output.status)
  const gameRunner = createRunner(game.circuit, [...game.nextSource, ...viewWires, ...statusWires, game.output.exited, game.output.palette], backends.game)
  const statusRunner = createRunner(statusBar.circuit, statusBar.output.pixels, 'tensor')
  const frameWires = flattenWires(frame.output)
  invariant(lineUp(game.output.view, frame.cells, 0), 'the game\'s view must list the frame program\'s cells in their order')
  invariant(lineUp(frame.output, columns.cells.frame, columns.cells.frame.cell), 'the frame program\'s outputs must list the column program\'s frame cells in their order')
  // The frame program's runner on each backend it has run on, made when first used, on one compiled program, so that
  // their cells line up.
  const frameProgram = frame.circuit.compileTensorProgram(frameWires)
  const frameRunners: Partial<Record<Backend, Runner>> = {}
  let frameBackend = backends.frame
  let frameRunner = frameRunners[frameBackend] = runProgram(frame.circuit, frameProgram, frameBackend)
  // The inspector's wires are roots too, so that compiling keeps them.
  const inspected = columns.debug
  const inspectWires = [...inspected.walkCells, ...inspected.boundaries, ...inspected.kinds, ...inspected.crossingInverseZ, ...inspected.walkBlocked]
  const recordWires = flattenWires(columns.output.record)
  const columnRunner = createRunner(columns.circuit, [...recordWires, ...inspectWires], backends.column)
  const pixelRunner = createRunner(pixels.circuit, [pixels.output.pixel], backends.column)
  log(`programs compiled: game ${backends.game}, frame ${backends.frame}, columns and pixels ${backends.column}`)
  const sizes: ProgramSize[] = [
    programSize('game', gameRunner.program),
    programSize('frame', frameRunner.program),
    programSize('column', columnRunner.program),
    programSize('pixel', pixelRunner.program),
    programSize('status', statusRunner.program),
  ]
  const inspectPositions = packedPositions(columnRunner.program, inspectWires)
  const timings: Timings = {gameMs: 0, frameMs: 0, columnsMs: 0, pixelsMs: 0, statusMs: 0}

  const nextPositions = packedPositions(gameRunner.program, game.nextSource)
  const viewPositions = packedPositions(gameRunner.program, viewWires)
  const exitedPosition = packedPositions(gameRunner.program, [game.output.exited])[0]!
  const palettePosition = packedPositions(gameRunner.program, [game.output.palette])[0]!
  const statusPositions = packedPositions(gameRunner.program, statusWires)
  const statusPixelPositions = packedPositions(statusRunner.program, statusBar.output.pixels)
  statusRunner.values.set(statusBar.initialSource)
  const framePositions = packedPositions(frameRunner.program, frameWires)
  // The record's wires in the column program, and the cells that hold it in the pixel program, in the same order.
  const recordPositions = packedPositions(columnRunner.program, recordWires)
  const recordCells = Int32Array.from(flattenWires(pixels.cells.record))
  const pixelPosition = packedPositions(pixelRunner.program, [pixels.output.pixel])[0]!
  const columnComputed = operationsOf(columnRunner.program).positions
  const pixelOperations = operationsOf(pixelRunner.program)
  const pixelComputed = pixelOperations.positions
  // The pixel program's named operations that it computes: a name whose wire compiling left out or made a constant
  // goes unused, as do later names of an operation already named.
  const operationOfPosition = new Map(Array.from(pixelComputed, (position, operation) => [position, operation]))
  const pixelPositionOfWire = new Int32Array(pixelRunner.program.width).fill(-1)
  pixelRunner.program.wireOrder.forEach((wire, position) => {
    pixelPositionOfWire[wire] = position
  })
  const xrayStops: XrayStop[] = []
  for (const {wire, name, palette, chapter} of pixels.debug.stops) {
    const operation = operationOfPosition.get(pixelPositionOfWire[wire]!)
    if (operation !== undefined && !xrayStops.some(stop => stop.operation === operation)) xrayStops.push({operation, name, palette, chapter})
  }
  xrayStops.sort((a, b) => a.operation - b.operation)
  const rowCell = pixels.cells.row
  gameRunner.values.set(game.initialSource)
  frameRunner.values.set(frame.initialSource)
  columnRunner.values.set(columns.initialSource)
  pixelRunner.values.set(pixels.initialSource)
  // Runs the column program for one column and copies its record into the pixel program's cells.
  const runColumn = (column: number) => {
    const values = columnRunner.values
    values[columnCell] = column
    columnRunner.run()
    const pixelValues = pixelRunner.values
    for (let index = 0; index < recordCells.length; index++) pixelValues[recordCells[index]!] = values[recordPositions[index]!]!
  }
  // Runs every column and its pixels, and writes each pixel's value at a packed position of the pixel program: its
  // palette index, or for the x-ray another operation's value.
  const drawColumns = <View extends Uint8Array | Float32Array>(into: View, position: number): View => {
    const started = performance.now()
    let columnsMs = 0
    const pixelValues = pixelRunner.values
    for (let column = 0; column < view.width; column++) {
      const columnStarted = performance.now()
      runColumn(column)
      columnsMs += performance.now() - columnStarted
      for (let row = 0; row < view.height; row++) {
        pixelValues[rowCell] = row
        pixelRunner.run()
        into[row * view.width + column] = pixelValues[position]!
      }
    }
    timings.columnsMs = columnsMs
    timings.pixelsMs = performance.now() - started - columnsMs
    return into
  }
  const nextState = new Float32Array(game.nextSource.length)
  const keyWires = game.cells.keys
  const frameOffset = columns.cells.frame.cell
  const columnCell = columns.cells.column
  let ticCount = 0

  const engine = {
    view,
    assets,
    scene,
    level,
    sizes,
    game,
    get exited() {
      return gameRunner.values[exitedPosition]! > 0
    },
    // The palette the game picks, Doom's 0, or a red or gold one.
    get palette() {
      return gameRunner.values[palettePosition]!
    },
    get tics() {
      return ticCount
    },
    // A game cell's current value, for tests and the page's readout.
    read(wire: Wire) {
      return gameRunner.values[wire]!
    },
    // Sets a game cell, for tests that start the player somewhere else.
    poke(wire: Wire, value: number) {
      gameRunner.values[wire] = value
    },
    timings,
    tic(keys: Keys) {
      const values = gameRunner.values
      for (const name of Object.keys(keyWires) as (keyof Keys)[]) values[keyWires[name]] = keys[name] ? 1 : 0
      const started = performance.now()
      gameRunner.run()
      timings.gameMs = performance.now() - started
      for (let index = 0; index < nextState.length; index++) nextState[index] = values[nextPositions[index]!]!
      values.set(nextState)
      const frameValues = frameRunner.values
      for (let index = 0; index < viewPositions.length; index++) frameValues[index] = values[viewPositions[index]!]!
      const statusValues = statusRunner.values
      for (let index = 0; index < statusPositions.length; index++) statusValues[index] = values[statusPositions[index]!]!
      ticCount++
    },
    // The column and pixel programs as compiled, and where their cells and outputs are, for another backend to run
    // them, e.g. gpu.ts.
    columnProgram: columnRunner.program,
    pixelProgram: pixelRunner.program,
    columnCell,
    rowCell,
    recordPositions,
    recordCells,
    pixelPosition,
    // Runs the frame program on another backend from the next frame on, from the cells it has now.
    useFrameBackend(backend: Backend) {
      if (backend === frameBackend) return
      const next = frameRunners[backend] ??= runProgram(frame.circuit, frameProgram, backend)
      next.values.set(frameRunner.values.subarray(0, frameProgram.sourceSize))
      frameRunner = next
      frameBackend = backend
    },
    // Runs the frame program and copies its tables into the column program's source cells, which it returns.
    prepareColumns() {
      const started = performance.now()
      frameRunner.run()
      timings.frameMs = performance.now() - started
      const frameValues = frameRunner.values
      const values = columnRunner.values
      for (let index = 0; index < framePositions.length; index++) values[frameOffset + index] = frameValues[framePositions[index]!]!
      return values.subarray(0, columnRunner.program.sourceSize)
    },
    // The columns and their pixels on the CPU, after prepareColumns.
    renderColumns(into = new Uint8Array(view.width * view.height)) {
      return drawColumns(into, pixelPosition)
    },
    // The pixel program's operations, and its named ones, for the page's x-ray.
    pixelOperations,
    xrayStops,
    // The value of one of the pixel program's operations at every pixel, row-major like the view, after
    // prepareColumns: what the page's x-ray shows. The program runs as it does for the view, which only reads another
    // of its values.
    probeColumns(operation: number, into = new Float32Array(view.width * view.height)) {
      return drawColumns(into, pixelComputed[operation]!)
    },
    // The view as palette indices, row-major, view.width × view.height.
    render(into = new Uint8Array(view.width * view.height)) {
      engine.prepareColumns()
      return engine.renderColumns(into)
    },
    // Runs one column again, after render, and reads what the inspector shows.
    inspect(column: number): ColumnInspection {
      runColumn(column)
      const values = columnRunner.values
      const pixelValues = pixelRunner.values
      const activations = new Float32Array(columnComputed.length + view.height * pixelComputed.length)
      for (let index = 0; index < columnComputed.length; index++) activations[index] = values[columnComputed[index]!]!
      for (let row = 0; row < view.height; row++) {
        pixelValues[rowCell] = row
        pixelRunner.run()
        const offset = columnComputed.length + row * pixelComputed.length
        for (let index = 0; index < pixelComputed.length; index++) activations[offset + index] = pixelValues[pixelComputed[index]!]!
      }
      const steps = inspected.walkCells.length
      const boundaryCount = inspected.boundaries.length
      const kindCount = inspected.kinds.length
      const at = (index: number) => values[inspectPositions[index]!]!
      return {
        column,
        cells: Int32Array.from({length: steps}, (_, index) => at(index)),
        boundaries: Int16Array.from({length: boundaryCount}, (_, index) => at(steps + index)),
        kinds: Uint8Array.from({length: kindCount}, (_, index) => at(steps + boundaryCount + index)),
        inverseZ: Float32Array.from({length: steps}, (_, index) => at(steps + boundaryCount + kindCount + index)),
        // The steps before the first solid wall, and the one that crosses it.
        walked: Array.from({length: steps}, (_, index) => at(2 * steps + boundaryCount + kindCount + index)).filter(value => value === 0).length,
        activations,
      }
    },
    // The status bar as palette indices, row-major, 320 × 32.
    renderStatus(into = new Uint8Array(statusWidth * statusHeight)) {
      const started = performance.now()
      statusRunner.run()
      timings.statusMs = performance.now() - started
      for (let index = 0; index < statusPixelPositions.length; index++) into[index] = statusRunner.values[statusPixelPositions[index]!]!
      return into
    },
  }
  engine.tic(noKeys)
  return engine
}

export type Engine = ReturnType<typeof createEngine>
