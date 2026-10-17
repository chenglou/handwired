// Tests for the Doom port, src/doom. They need Doom's shareware WAD in .cache/doom/: `bun scripts/fetch-doom-wad.ts`.
// Without it they are skipped.
import {beforeAll, describe, expect, test} from 'bun:test'
import {existsSync, readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {createEvaluator} from '../../src/runtime/cells.ts'
import {type Circuit, validateGrids, validateNoNaN} from '../../src/runtime/numeric-ui-core.ts'
import {type Assets, loadAssets} from '../../src/doom/assets.ts'
import {createRunner, createEngine, type Engine, flattenWires, noKeys, type Keys, operationsOf} from '../../src/doom/engine.ts'
import {packedPositions} from '../../src/doom/codegen.ts'
import {buildColumnPrograms} from '../../src/doom/column-program.ts'
import {buildFrameProgram} from '../../src/doom/frame-program.ts'
import {buildGameProgram} from '../../src/doom/game-program.ts'
import {buildLevel, findCell, type Level} from '../../src/doom/level.ts'
import {type ColumnTrace, renderReference} from './reference.ts'
import {buildScene, type Scene, maxEdges} from '../../src/doom/scene.ts'
import {buildStatusProgram} from '../../src/doom/status-program.ts'
import {buildSpriteCatalog, buildStateTables, levelThings} from '../../src/doom/things.ts'
import {type ViewConfig} from '../../src/doom/view.ts'
import {type DoomMap, readMap, readWad, type Wad} from '../../src/doom/wad.ts'
import {type StageShader, compileColumnShader, compilePixelShader, compileProbeShader} from '../../src/doom/wgsl.ts'
import {createShaderInterpreter} from './shader-interpreter.ts'

const wadPath = resolve(import.meta.dir, '../../.cache/doom/doom1.wad')
const haveWad = existsSync(wadPath)
const view: ViewConfig = {width: 64, height: 168, steps: 32}

let wad: Wad
let map: DoomMap
let level: Level
let assets: Assets
let scene: Scene

beforeAll(() => {
  if (!haveWad) return
  wad = readWad(new Uint8Array(readFileSync(wadPath)))
  map = readMap(wad, 'E1M1')
  level = buildLevel(map, {maxEdges})
  assets = loadAssets(wad, map)
  scene = buildScene(level, assets)
})

describe.skipIf(!haveWad)('level', () => {
  test('cells are convex, counterclockwise, and every portal has exactly one twin', () => {
    for (const [index, cell] of level.cells.entries()) {
      cell.edges.forEach((edge, slot) => {
        const next = cell.edges[(slot + 1) % cell.edges.length]!
        const turn = (edge.b.x - edge.a.x) * (next.b.y - next.a.y) - (edge.b.y - edge.a.y) * (next.b.x - next.a.x)
        expect(turn).toBeGreaterThan(-1e-6)
        if (edge.neighbor >= 0) {
          const twins = level.cells[edge.neighbor]!.edges.filter(back => back.a === edge.b && back.b === edge.a && back.neighbor === index)
          expect(twins.length).toBe(1)
        }
      })
    }
  })

  test('the BSP finds the cell that contains each cell center', () => {
    for (const [index, cell] of level.cells.entries()) {
      const x = cell.edges.reduce((sum, edge) => sum + edge.a.x, 0) / cell.edges.length
      const y = cell.edges.reduce((sum, edge) => sum + edge.a.y, 0) / cell.edges.length
      let place = 0
      while (place >= 0) {
        const node = level.nodes[place]!
        const back = node.dx * (y - node.y) - node.dy * (x - node.x) > 0
        place = back ? node.back : node.front
      }
      expect(level.leafCell[~place]).toBe(index)
    }
  })
})

describe.skipIf(!haveWad)('the column program', () => {
  // The frame, column and pixel programs for walls and flats only, evaluated with the runtime's checks, which include
  // that every record the column program hands the pixel program lies within the ranges the pixel program was built
  // for, against reference.ts.
  function renderViews(views: {x: number, y: number, angle: number}[]) {
    const states = buildStateTables()
    const catalog = buildSpriteCatalog(wad, states.frames)
    const thingCount = levelThings(map, states).length
    const frame = buildFrameProgram(scene, view, catalog, thingCount, states, assets.scaleLight)
    const {columns, pixels} = buildColumnPrograms(scene, assets, view, catalog, {overlays: false})
    const evaluateFrame = createEvaluator(frame)
    const evaluateColumn = createEvaluator(columns)
    const evaluatePixel = createEvaluator(pixels)
    const recordCells = flattenWires(pixels.cells.record)
    return views.map(({x, y, angle}) => {
      const cell = findCell(level, x, y)
      const z = scene.sectors[scene.cells[cell]!.sector]!.floor + 41
      const source = new Float32Array(frame.initialSource)
      source[frame.cells.cell] = cell
      source[frame.cells.angle] = angle
      source[frame.cells.x] = x
      source[frame.cells.y] = y
      source[frame.cells.z] = z
      scene.sectors.forEach((sector, index) => {
        source[frame.cells.floor[index]!] = sector.floor
        source[frame.cells.ceiling[index]!] = sector.ceiling
        source[frame.cells.light[index]!] = sector.light
      })
      const frameValues = flattenWires(evaluateFrame(source).output)
      const columnSource = new Float32Array(columns.initialSource)
      columnSource.set(frameValues, columns.cells.frame.cell)
      const image = new Uint8Array(view.width * view.height)
      const boundaries: number[][] = []
      const debug = columns.circuit.createTensorEvaluator(columns.debug.boundaries)
      const pixelSource = new Float32Array(pixels.initialSource)
      for (let column = 0; column < view.width; column++) {
        columnSource[columns.cells.column] = column
        const record = flattenWires(evaluateColumn(columnSource).output.record)
        recordCells.forEach((cell, index) => {
          pixelSource[cell] = record[index]!
        })
        for (let row = 0; row < view.height; row++) {
          pixelSource[pixels.cells.row] = row
          image[row * view.width + column] = evaluatePixel(pixelSource).output.pixel
        }
        boundaries.push([...debug(columnSource)])
      }
      const traces: ColumnTrace[] = []
      const reference = renderReference(scene, assets, view, {x, y, z, angle, cell}, undefined, undefined, traces)
      return {image, reference, boundaries, traces}
    })
  }

  test('matches the reference renderer: window boundaries within a row, and nearly every pixel', () => {
    const start = map.things.find(thing => thing.type === 1)!
    const results = renderViews([
      {x: start.x, y: start.y, angle: 2048},
      {x: start.x, y: start.y, angle: 6144},
      {x: 1600, y: -3300, angle: 0},
      {x: 2600, y: -2700, angle: 3000},
    ])
    // Each view's share of pixels that may differ: about twice what it is, 0.47%, 1.4%, 0.07% and 0.14%, so that a
    // change that moves more texels fails.
    const pixelLimits = [0.01, 0.025, 0.002, 0.003]
    for (const [at, {image, reference, boundaries, traces}] of results.entries()) {
      // A projected row that lands within FP32 rounding of a half rounds the other way now and then.
      let off = 0
      let total = 0
      boundaries.forEach((columnBoundaries, column) => columnBoundaries.forEach((boundary, index) => {
        const expected = traces[column]!.boundaries[index]!
        expect(Math.abs(boundary - expected)).toBeLessThanOrEqual(1)
        if (boundary !== expected) off++
        total++
      }))
      expect(off / total).toBeLessThan(0.01)
      let different = 0
      for (let index = 0; index < image.length; index++) if (image[index] !== reference[index]) different++
      // FP32 against float64 at texel boundaries.
      expect(different / image.length).toBeLessThan(pixelLimits[at]!)
    }
  })
})

describe.skipIf(!haveWad)('sprites', () => {
  test('a sprite that the screen\'s left edge cuts starts at the texture column Doom\'s does', () => {
    const states = buildStateTables()
    const catalog = buildSpriteCatalog(wad, states.frames)
    const things = levelThings(map, states)
    const frame = buildFrameProgram(scene, view, catalog, things.length, states, assets.scaleLight)
    const {columns} = buildColumnPrograms(scene, assets, view, catalog)
    const start = map.things.find(thing => thing.type === 1)!
    const cell = findCell(level, start.x, start.y)
    const floor = scene.sectors[scene.cells[cell]!.sector]!.floor
    const source = new Float32Array(frame.initialSource)
    Object.assign(source, {[frame.cells.cell]: cell, [frame.cells.angle]: 2048, [frame.cells.x]: start.x, [frame.cells.y]: start.y, [frame.cells.z]: floor + 41})
    scene.sectors.forEach((sector, index) => {
      source[frame.cells.floor[index]!] = sector.floor
      source[frame.cells.ceiling[index]!] = sector.ceiling
      source[frame.cells.light[index]!] = sector.light
    })
    // A barrel 32 units north of the eye, which faces north, and 30 to its left: at 1 column per unit, its 23 columns
    // start 8 left of the screen.
    const barrel = things.find(thing => thing.type === 2035)!
    const frameIndex = states.frame[barrel.state]!
    const lump = catalog.lumps[catalog.rotations[frameIndex * 8]!.lump]!
    const depth = 32
    const across = -30
    const thing = frame.cells.things[0]!
    Object.assign(source, {
      [thing.x]: start.x + across, [thing.y]: start.y + depth, [thing.z]: floor, [thing.sector]: scene.cells[cell]!.sector,
      [thing.frame]: frameIndex, [thing.visible]: 1, [thing.direction]: 0,
    })
    const half = view.width / 2
    const x1 = Math.floor(half + (across - lump.left) * half / depth)
    expect(x1).toBeLessThan(0)
    const columnSource = new Float32Array(columns.initialSource)
    columnSource.set(flattenWires(createEvaluator(frame)(source).output), columns.cells.frame.cell)
    const evaluateColumn = createEvaluator(columns)
    for (const column of [0, 1, 5]) {
      columnSource[columns.cells.column] = column
      const place = evaluateColumn(columnSource).output.record.sprites.find(sprite => sprite.shown === 1)!
      // Doom's startfrac advanced by the columns cut off, then a column per screen column; texels at base + u × (height
      // + 1) + v.
      expect(place.address).toBe(lump.base + Math.floor((column - x1) * depth / half) * (lump.height + 1))
    }
  })
})

describe.skipIf(!haveWad)('the JavaScript backend', () => {
  test('computes the bits of the runtime evaluator', () => {
    const states = buildStateTables()
    const catalog = buildSpriteCatalog(wad, states.frames)
    const {columns, pixels} = buildColumnPrograms(scene, assets, view, catalog)
    const recordWires = flattenWires(columns.output.record)
    const recordCells = flattenWires(pixels.cells.record)
    const tensor = createRunner(columns.circuit, recordWires, 'tensor')
    const js = createRunner(columns.circuit, recordWires, 'js')
    const tensorPixel = createRunner(pixels.circuit, [pixels.output.pixel], 'tensor')
    const jsPixel = createRunner(pixels.circuit, [pixels.output.pixel], 'js')
    expect(js.program.valueCount).toBe(tensor.program.valueCount)
    expect(jsPixel.program.valueCount).toBe(tensorPixel.program.valueCount)
    const recordPositions = packedPositions(tensor.program, recordWires)
    // The table of a real frame, the engine's a second into the level, whose columns cross portals and show walls,
    // flats, sky and things.
    const engine = createEngine(new Uint8Array(readFileSync(wadPath)), {view})
    for (let tic = 0; tic < 35; tic++) engine.tic({...noKeys, forward: true, turnLeft: tic % 4 === 0})
    const source = engine.prepareColumns()
    expect(source.length).toBe(columns.circuit.sourceSize)
    for (const runner of [tensor, js]) runner.values.set(source)
    for (const runner of [tensorPixel, jsPixel]) runner.values.set(pixels.initialSource)
    for (const column of [0, 17, 40, 63]) {
      for (const runner of [tensor, js]) {
        runner.values[columns.cells.column] = column
        runner.run()
      }
      expect(js.values).toEqual(tensor.values)
      // Not a column of zeros and constants: a record of a real view has hundreds of distinct values.
      expect(new Set(tensor.values.subarray(columns.circuit.sourceSize)).size).toBeGreaterThan(300)
      for (const runner of [tensorPixel, jsPixel]) {
        recordCells.forEach((cell, index) => {
          runner.values[cell] = tensor.values[recordPositions[index]!]!
        })
      }
      for (const row of [0, 40, 83, 84, 130, 167]) {
        for (const runner of [tensorPixel, jsPixel]) {
          runner.values[pixels.cells.row] = row
          runner.run()
        }
        expect(jsPixel.values).toEqual(tensorPixel.values)
      }
    }
  })

  test('plays the same game as the runtime evaluator', () => {
    const bytes = new Uint8Array(readFileSync(wadPath))
    const a = createEngine(bytes, {view, backends: {game: 'js', frame: 'js', column: 'js'}})
    const b = createEngine(bytes, {view, backends: {game: 'tensor', frame: 'tensor', column: 'tensor'}})
    const script: [number, Partial<Keys>][] = [[20, {forward: true}], [10, {turnLeft: true, fire: true}], [25, {forward: true, run: true, strafeRight: true}]]
    for (const [step, [tics, keys]] of script.entries()) {
      // The frame program moves between backends mid-game, as the page's GPU switch moves it, and keeps its cells.
      if (step > 0) a.useFrameBackend(step % 2 === 1 ? 'tensor' : 'js')
      for (let tic = 0; tic < tics; tic++) {
        a.tic({...noKeys, ...keys})
        b.tic({...noKeys, ...keys})
      }
      expect(a.render()).toEqual(b.render())
      expect(a.renderStatus()).toEqual(b.renderStatus())
    }
  }, 120_000)

  test('the x-ray reads the pixel program\'s own values: its last operation is the picture, and its palette stops are palette indices', () => {
    const engine = createEngine(new Uint8Array(readFileSync(wadPath)), {view})
    for (let tic = 0; tic < 20; tic++) engine.tic({...noKeys, forward: true})
    const picture = engine.render()
    const operations = engine.pixelOperations.positions.length
    expect(Array.from(engine.probeColumns(operations - 1))).toEqual(Array.from(picture))
    const chapters = engine.xrayStops.filter(stop => stop.chapter !== null).map(stop => stop.chapter)
    expect(chapters).toEqual(['search', 'sky', 'interval', 'depth', 'light', 'walls', 'flats', 'unlit', 'lit', 'masked', 'sprites', 'weapon'])
    for (const stop of engine.xrayStops.filter(named => named.palette)) {
      for (const value of engine.probeColumns(stop.operation)) expect(Number.isInteger(value) && value >= 0 && value <= 255).toBe(true)
    }
    // Probing runs the same programs: the picture after it is the picture before.
    engine.prepareColumns()
    expect(engine.renderColumns()).toEqual(picture)
  }, 60_000)
})

describe.skipIf(!haveWad)('the shaders', () => {
  // Bun has no WebGPU, so these run the shaders' text through shader-interpreter.ts and check it; scripts/check-doom-page.ts
  // runs them in Chrome, where the page compares two GPU frames with the CPU's.
  test('run through an interpreter of their WGSL, give the CPU\'s bits: every pixel, and the probe\'s values', () => {
    const engine = createEngine(new Uint8Array(readFileSync(wadPath)), {view})
    for (let tic = 0; tic < 70; tic++) engine.tic({...noKeys, forward: tic < 40, turnLeft: tic % 5 === 0})
    const source = engine.prepareColumns()
    const {width, height} = view
    // As worker.ts writes them, from the engine's compiled programs.
    const columnShader = compileColumnShader(engine.columnProgram, {columnCell: engine.columnCell, record: engine.recordPositions, width})
    const pixelOptions = {rowCell: engine.rowCell, recordCells: engine.recordCells, width, height}
    const pixelShader = compilePixelShader(engine.pixelProgram, {...pixelOptions, pixel: engine.pixelPosition})
    const probeShader = compileProbeShader(engine.pixelProgram, {...pixelOptions, operations: engine.pixelOperations.positions})
    // A shader's buffers as gpu.ts fills them: statics holds the source cells, then the constant operations' values.
    const buffersOf = (shader: StageShader, cells = new Float32Array(0)) => {
      const statics = new Float32Array(shader.staticsSize)
      statics.set(cells)
      statics.set(shader.staticsConstants, shader.staticsSize - shader.staticsConstants.length)
      return {statics, constants: shader.constants, positions: shader.positions, records, output}
    }
    const records = new Float32Array(width * engine.recordCells.length)
    const output = new Uint32Array(width * height)
    createShaderInterpreter(columnShader.code)(buffersOf(columnShader, new Float32Array(source)), columnShader.invocations)
    createShaderInterpreter(pixelShader.code)(buffersOf(pixelShader), pixelShader.invocations)
    expect(Array.from(output)).toEqual(Array.from(engine.renderColumns()))
    // The probe writes an operation's bits, at each named stop with a button.
    const probe = createShaderInterpreter(probeShader.code)
    for (const stop of engine.xrayStops.filter(named => named.chapter !== null)) {
      probe(buffersOf(probeShader), probeShader.invocations, stop.operation)
      expect(Array.from(output)).toEqual(Array.from(new Uint32Array(engine.probeColumns(stop.operation).buffer)))
    }
  }, 60_000)

  test('declare every value before reading it, and write rounds and booleans that a compiler can\'t fold', () => {
    const states = buildStateTables()
    const catalog = buildSpriteCatalog(wad, states.frames)
    const {columns, pixels} = buildColumnPrograms(scene, assets, view, catalog)
    const recordWires = flattenWires(columns.output.record)
    const columnProgram = columns.circuit.compileTensorProgram(recordWires)
    const pixelProgram = pixels.circuit.compileTensorProgram([pixels.output.pixel])
    const columnShader = compileColumnShader(columnProgram, {columnCell: columns.cells.column, record: packedPositions(columnProgram, recordWires), width: view.width})
    const pixelShader = compilePixelShader(pixelProgram, {
      rowCell: pixels.cells.row,
      recordCells: Int32Array.from(flattenWires(pixels.cells.record)),
      pixel: packedPositions(pixelProgram, [pixels.output.pixel])[0]!,
      width: view.width,
      height: view.height,
    })
    const probeShader = compileProbeShader(pixelProgram, {
      rowCell: pixels.cells.row,
      recordCells: Int32Array.from(flattenWires(pixels.cells.record)),
      operations: operationsOf(pixelProgram).positions,
      width: view.width,
      height: view.height,
    })
    for (const shader of [columnShader, pixelShader, probeShader]) {
      const declared = new Set<string>()
      for (const line of shader.code.split('\n')) {
        const declaration = /^(?:let|var) (\w+)/.exec(line)
        const used = line.slice(declaration === null ? 0 : line.indexOf('=') + 1).match(/\b[vpa]\d+(?:_\w+)?\b/g) ?? []
        for (const name of used) expect(declared.has(name)).toBe(true)
        if (declaration !== null) declared.add(declaration[1]!)
      }
      // No (x + 2^23 + 2^22) and no (score + 2^23 + 1) survive as sums: they are round() and select(). The probe
      // shader keeps a round's shifted sum, an operation of the program it can show, on its own, with nothing after.
      const shifted = shader.code.split('\n').filter(line => line.includes('12582912'))
      if (shader === probeShader) for (const line of shifted) expect(line).toMatch(/^let v\d+: f32 = \(12582912\.0f \+ v\d+\);$/)
      else expect(shifted).toEqual([])
      expect(shader.code).not.toContain('8388609')
      expect(shader.code).toContain('select(0.0f, 1.0f,')
    }
    // The column shader projects heights with rounds; the pixel shader reads the texels and its intervals from the
    // column's record, with no table of its own over it.
    expect(columnShader.code).toContain('round(')
    expect(pixelShader.constants.length).toBeGreaterThan(assets.texels.length)
    expect(pixelShader.code).toContain('records[recordBase + ')
    expect(pixelShader.code).not.toContain('var a')
    expect(pixelShader.operations).toBeLessThan(columnShader.operations / 10)
    // The probe shader keeps every operation, a case for each, and writes the picked one's bits.
    const operations = operationsOf(pixelProgram).positions.length
    expect(probeShader.code.match(/^ {4}case \d+u: \{ value = v\d+; \}$/gm)?.length).toBe(operations)
    expect(probeShader.code).toContain('var<uniform> probe: u32')
    expect(probeShader.code).toContain('= bitcast<u32>(value);')
    expect(pixelShader.code).not.toContain('switch')
  })
})

describe.skipIf(!haveWad)('the declarations', () => {
  // The runtime's checks on every wire of every program, over a walk that fires, opens doors and keeps things in view:
  // each value on the grid its program declares or infers for it, and none NaN. Index reads are left out, since the
  // programs read tables at fractional indices, e.g. a texel at a fractional row, which the read floors.
  test('every value keeps its grid and none is NaN, through a walk that fires, opens doors and sees things', () => {
    const states = buildStateTables()
    const things = levelThings(map, states)
    const catalog = buildSpriteCatalog(wad, states.frames)
    const game = buildGameProgram(level, states, things)
    const frame = buildFrameProgram(scene, view, catalog, game.output.view.things.length, states, assets.scaleLight)
    const {columns, pixels} = buildColumnPrograms(scene, assets, view, catalog)
    const statusBar = buildStatusProgram(wad)
    const evaluate = (circuit: Circuit, source: Float32Array) => {
      const values = circuit.evaluateReference(source)
      validateGrids(circuit, values)
      validateNoNaN(circuit, values)
      return values
    }
    // The engine's copies from each program's outputs to the next one's cells.
    const copy = (values: Float32Array, wires: number[], into: Float32Array, at = 0) => wires.forEach((wire, index) => {
      into[at + index] = values[wire]!
    })
    const viewWires = flattenWires(game.output.view)
    const statusWires = flattenWires(game.output.status)
    const frameWires = flattenWires(frame.output)
    const recordWires = flattenWires(columns.output.record)
    const recordCells = flattenWires(pixels.cells.record)
    const gameSource = new Float32Array(game.initialSource)
    const frameSource = new Float32Array(frame.initialSource)
    const columnSource = new Float32Array(columns.initialSource)
    const pixelSource = new Float32Array(pixels.initialSource)
    const statusSource = new Float32Array(statusBar.initialSource)
    const walk: [number, Partial<Keys>][] = [
      [40, {forward: true}], [20, {turnRight: true}], [30, {forward: true, fire: true}], [10, {use: true}], [30, {forward: true, run: true}],
      [15, {turnLeft: true}], [40, {forward: true, run: true, fire: true}], [10, {shotgun: true}], [20, {strafeLeft: true, fire: true}],
      [30, {forward: true, use: true}], [40, {forward: true, run: true, fire: true, turnLeft: true}],
    ]
    let tic = 0
    for (const [tics, keys] of walk) {
      for (let step = 0; step < tics; step++) {
        const held = {...noKeys, ...keys}
        for (const name of Object.keys(game.cells.keys) as (keyof Keys)[]) gameSource[game.cells.keys[name]] = held[name] ? 1 : 0
        const values = evaluate(game.circuit, gameSource)
        copy(values, game.nextSource, gameSource)
        copy(values, statusWires, statusSource)
        copy(values, viewWires, frameSource)
        if (++tic % 10 === 0) evaluate(statusBar.circuit, statusSource)
        if (tic % 70 !== 0) continue
        copy(evaluate(frame.circuit, frameSource), frameWires, columnSource, columns.cells.frame.cell)
        for (let column = 0; column < view.width; column += 2) {
          columnSource[columns.cells.column] = column
          const columnValues = evaluate(columns.circuit, columnSource)
          recordWires.forEach((wire, index) => {
            pixelSource[recordCells[index]!] = columnValues[wire]!
          })
          for (let row = column % 4; row < view.height; row += 4) {
            pixelSource[pixels.cells.row] = row
            evaluate(pixels.circuit, pixelSource)
          }
        }
      }
    }
    expect(tic).toBe(285)
  }, 60_000)
})

describe.skipIf(!haveWad)('the game', () => {
  let engine: Engine
  const bytes = () => new Uint8Array(readFileSync(wadPath))
  const run = (tics: number, keys: Partial<Keys> = {}) => {
    for (let tic = 0; tic < tics; tic++) engine.tic({...noKeys, ...keys})
  }
  const player = () => engine.game.cells.player
  // Puts the player at (x, y) facing `angle`, standing on that cell's floor.
  const place = (x: number, y: number, angle: number) => {
    const cell = findCell(engine.level, x, y)
    const floor = engine.scene.sectors[engine.scene.cells[cell]!.sector]!.floor
    const p = player()
    engine.poke(p.x, x)
    engine.poke(p.y, y)
    engine.poke(p.cell, cell)
    engine.poke(p.z, floor)
    engine.poke(p.floorZ, floor)
    engine.poke(p.angle, angle)
    engine.poke(p.momX, 0)
    engine.poke(p.momY, 0)
  }

  beforeAll(() => {
    if (haveWad) engine = createEngine(bytes(), {view})
  })

  test('the programs have the sizes that README.md gives', () => {
    // The frame program's per-column work grows with the view's width, so its size here is this view's: 32,867 at
    // the README's 320 columns.
    expect(engine.sizes.map(({name, operations, layers}) => [name, operations, layers])).toEqual([
      ['game', 33_204, 1009], ['frame', 32_996, 139], ['column', 6655, 724], ['pixel', 150, 42], ['status', 12_031, 7],
    ])
  })

  test('walking moves the player at Doom speed, and a wall stops it', () => {
    const start = map.things.find(thing => thing.type === 1)!
    place(start.x, start.y, 2048)
    run(35, {forward: true})
    const moved = engine.read(player().y) - start.y
    // Doom's walk: 25/32 of thrust per tic against 0.90625 friction, about 214 units in the first second.
    expect(moved).toBeGreaterThan(180)
    expect(moved).toBeLessThan(260)
    // Keep walking north: the room's wall holds the player at its radius.
    run(140, {forward: true})
    const y = engine.read(player().y)
    run(35, {forward: true})
    expect(Math.abs(engine.read(player().y) - y)).toBeLessThan(1)
  })

  test('using a door opens it, and it closes again after its wait', () => {
    // The first door line of the level, used from 32 units in front of its middle.
    const line = map.linedefs.findIndex(linedef => linedef.special === 1)
    const linedef = map.linedefs[line]!
    const a = map.vertices[linedef.v1]!
    const b = map.vertices[linedef.v2]!
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    // The front side is on the right of v1 → v2.
    const nx = (b.y - a.y) / length
    const ny = -(b.x - a.x) / length
    const x = (a.x + b.x) / 2 + nx * 32
    const y = (a.y + b.y) / 2 + ny * 32
    const angle = Math.round(((Math.atan2(-ny, -nx) / (2 * Math.PI)) * 8192 + 8192) % 8192)
    place(x, y, angle)
    const sector = map.sidedefs[linedef.back]!.sector
    const ceiling = engine.game.cells.sectors.ceiling[sector]!
    const closed = engine.read(ceiling)
    run(1, {use: true})
    run(60)
    expect(engine.read(ceiling)).toBeGreaterThan(closed + 64)
    // Open for 150 tics, then back down at 2 units per tic. Step out of the doorway first.
    place(x + nx * 64, y + ny * 64, angle)
    run(150 + 200)
    expect(engine.read(ceiling)).toBe(closed)
  })

  test('a pickup raises its counter once and disappears', () => {
    const things = engine.game.things
    const stimpack = things.find(thing => thing.type === 2011 || thing.type === 2012)!
    engine.poke(player().health, 50)
    place(stimpack.x, stimpack.y, 6144)
    run(1)
    const health = engine.read(player().health)
    expect(health).toBe(stimpack.type === 2011 ? 60 : 75)
    expect(engine.read(engine.game.cells.things[stimpack.index]!.present)).toBe(0)
    run(5)
    expect(engine.read(player().health)).toBe(health)
  })

  test('the pistol kills a zombieman in sight', () => {
    engine = createEngine(bytes(), {view})
    const monsters = engine.game.things.filter(thing => thing.info.kind === 'monster')
    const zombie = monsters.find(thing => thing.type === 3004)!
    const index = monsters.indexOf(zombie)
    // Stand 128 units from it on a clear line, found by trying eight directions.
    for (let direction = 0; direction < 8; direction++) {
      const angle = direction * Math.PI / 4
      const x = zombie.x + 128 * Math.cos(angle)
      const y = zombie.y + 128 * Math.sin(angle)
      if (findCell(engine.level, x, y) < 0 || !clearLine(map, x, y, zombie.x, zombie.y)) continue
      place(x, y, Math.round(((angle + Math.PI) / (2 * Math.PI)) * 8192) % 8192)
      break
    }
    // The zombie may walk off the line of fire; keep facing it.
    for (let tic = 0; tic < 400 && engine.read(engine.game.cells.monsters[index]!.health) > 0; tic++) {
      const dx = engine.read(engine.game.cells.monsters[index]!.x) - engine.read(player().x)
      const dy = engine.read(engine.game.cells.monsters[index]!.y) - engine.read(player().y)
      engine.poke(player().angle, Math.round(((Math.atan2(dy, dx) / (2 * Math.PI)) * 8192 + 8192) % 8192))
      engine.poke(player().health, 100)
      engine.tic({...noKeys, fire: true})
    }
    expect(engine.read(engine.game.cells.monsters[index]!.health)).toBeLessThanOrEqual(0)
    run(40)
    const state = engine.game.states.names[engine.read(engine.game.cells.things[zombie.index]!.state)]
    expect(state === 'POSS_DIE5' || state === 'POSS_XDIE9').toBe(true)
  }, 60_000)

  test('the palette is Doom\'s: red by the damage count, gold after a pickup', () => {
    engine = createEngine(bytes(), {view})
    // ST_doPaletteStuff's red palette, 1 + min(7, (count + 7) >> 3), of the count this tic leaves: 9 gives 3.
    engine.poke(player().damageCount, 10)
    run(1)
    expect(engine.palette).toBe(3)
    run(10)
    expect(engine.palette).toBe(0)
    // Walking onto a clip: a gold palette, 10 to 12, while bonuscount runs down.
    const clip = engine.game.things.find(thing => thing.type === 2007)!
    place(clip.x, clip.y - 40, 2048)
    const palettes: number[] = []
    for (let tic = 0; tic < 24; tic++) {
      engine.tic({...noKeys, forward: tic < 8})
      palettes.push(engine.palette)
    }
    expect(palettes.some(palette => palette >= 10 && palette <= 12)).toBe(true)
    expect(palettes.at(-1)).toBe(0)
  })

  test('a shot wakes no monster in ambush that doesn\'t see the player, and every one of shareware E1M1 is', () => {
    engine = createEngine(bytes(), {view})
    run(3, {fire: true})
    run(40)
    const monsters = engine.game.things.filter(thing => thing.info.kind === 'monster')
    expect(monsters.every(thing => thing.ambush)).toBe(true)
    for (const thing of monsters) expect(engine.game.states.names[engine.read(engine.game.cells.things[thing.index]!.state)]).toMatch(/_STND/)
  })

  test('after death the weapon stays down, the view sinks a unit per tic, and a chasing monster gives up', () => {
    engine = createEngine(bytes(), {view})
    const zombie = engine.game.things.find(thing => thing.type === 3004)!
    engine.poke(engine.game.cells.things[zombie.index]!.state, engine.game.states.names.indexOf('POSS_RUN1'))
    engine.poke(engine.game.cells.things[zombie.index]!.tics, 1)
    engine.poke(player().health, 0)
    const viewHeights: number[] = []
    for (let tic = 0; tic < 70; tic++) {
      engine.tic(noKeys)
      viewHeights.push(engine.read(player().viewHeight))
    }
    expect([viewHeights[0], viewHeights[10], viewHeights.at(-1)]).toEqual([40, 30, 6])
    expect(engine.read(player().weapon.y)).toBe(128)
    expect(engine.game.states.names[engine.read(engine.game.cells.things[zombie.index]!.state)]).toMatch(/^POSS_STND/)
    expect(engine.read(player().damageCount)).toBe(0)
  })

  test('using after death starts the level over', () => {
    engine.poke(player().health, 0)
    run(5)
    run(1, {use: true})
    run(1)
    const start = map.things.find(thing => thing.type === 1)!
    expect(engine.read(player().health)).toBe(100)
    expect(Math.abs(engine.read(player().x) - start.x)).toBeLessThan(1)
  })
})

function clearLine(map: DoomMap, x0: number, y0: number, x1: number, y1: number) {
  for (const linedef of map.linedefs) {
    const a = map.vertices[linedef.v1]!
    const b = map.vertices[linedef.v2]!
    const dx = x1 - x0
    const dy = y1 - y0
    const ex = b.x - a.x
    const ey = b.y - a.y
    const denominator = dx * ey - dy * ex
    if (denominator === 0) continue
    const t = ((a.x - x0) * ey - (a.y - y0) * ex) / denominator
    const u = ((a.x - x0) * dy - (a.y - y0) * dx) / denominator
    if (t <= 0 || t >= 1 || u < 0 || u > 1) continue
    if (linedef.back < 0) return false
    const front = map.sectors[map.sidedefs[linedef.front]!.sector]!
    const back = map.sectors[map.sidedefs[linedef.back]!.sector]!
    if (Math.min(front.ceiling, back.ceiling) - Math.max(front.floor, back.floor) < 56) return false
  }
  return true
}
