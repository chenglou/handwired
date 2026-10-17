// The engine in a worker: it builds the programs from the WAD the page sends, then runs Doom's 35 tics per second
// and renders frames back to back, ahead of the page: it renders the next while the page shows the last, on the GPU
// two at once, the CPU preparing one while the GPU draws the other, and waits while the page has frames to catch up on.
// It only schedules the programs and copies their numbers, as the engine does. Messages in: the WAD, the held keys,
// the column to inspect, where the columns run, the pixel program's operation to x-ray, and each frame shown, with its
// view's buffer back for a later frame and whether the inspector wants the next. Messages out: progress, the level's
// outline once, then frames of palette indices, now and then with what the inspector shows.
//
// The x-ray shows one of the pixel program's operations at every pixel instead of the picture: the programs run as
// they do for the picture, and only another of the pixel program's values comes out, through the probe shader on the
// GPU. The worker turns those values into the page's x-ray palette, which, like the palette, is the display's part.
import {type Backends, type ColumnInspection, type Engine, type Keys, type Timings, type XrayStop, createEngine, noKeys} from './engine.ts'
import {type GpuColumns, type StageState, createGpuColumns} from './gpu.ts'
import {type ViewConfig} from './view.ts'
import {compileColumnShader, compilePixelShader, compileProbeShader} from './wgsl.ts'

// Where the column and pixel programs run.
export type ColumnsOn = 'GPU' | 'CPU'

export type ToWorker =
  | {type: 'start', wad: ArrayBuffer, view: ViewConfig, backends: Partial<Backends>, columnsOn: ColumnsOn}
  | {type: 'columns', on: ColumnsOn}
  | {type: 'keys', keys: Keys}
  | {type: 'inspect', column: number}
  // The pixel program's operation to show at every pixel instead of the picture, by its index among the program's
  // operations, or null for the picture.
  | {type: 'xray', operation: number | null}
  | {type: 'shown', inspect: boolean, view: Uint8Array<ArrayBuffer>}

// The level as lines for the page's map: x1, y1, x2, y2 per line, and whether each is a wall, i.e. one-sided.
export type Outline = {lines: Float32Array, walls: Uint8Array, cells: Float32Array[]}

// Where the GPU's shaders are, for the page's status line and inspector.
export type GpuStatus = {
  // writing: the WGSL; compiling: the shaders, while the CPU draws; checking: GPU frames against the CPU's; running:
  // every frame on the GPU; failed and lost: back on the CPU, for good.
  state: 'writing' | 'compiling' | 'checking' | 'running' | 'failed' | 'lost'
  adapter: string
  // When this state began, in milliseconds since the epoch, so the page can count while it waits.
  since: number
  writeMs: number
  stages: {name: string, operations: number, wgslBytes: number, invocations: number, state: StageState, ms: number}[]
  // Of the checked GPU frames' pixels, how many differ from the CPU's, once one is checked, and how many were compared.
  differing: number | null
  pixels: number
  error: string
}

// The pixel program's operations, for the page's x-ray: each one's layer and kind, an index into engine.ts's
// `instructions`, and its named ones.
export type XrayProgram = {operations: number, layers: Uint16Array, kinds: Uint8Array, layerCount: number, stops: XrayStop[]}

// What a frame's x-ray shows: the operation, the range of values its shades span, and whether its values are palette
// indices, which the page shows through Doom's palette instead.
export type XrayFrame = {operation: number, low: number, high: number, palette: boolean}

// The probe shader's compile, which starts the first time the x-ray is on while the GPU draws: since when, in
// milliseconds since the epoch, and how long it took, once it is ready.
export type ProbeStatus = {
  state: 'compiling' | 'ready' | 'failed'
  since: number
  ms: number
  operations: number
  wgslBytes: number
  invocations: number
  error: string
}

// A monster, as the inspector lists it.
export type Actor = {name: string, x: number, y: number, health: number, maxHealth: number, state: string}

export type FromWorker =
  | {type: 'progress', message: string}
  | {type: 'ready', palettes: Uint8Array[], sizes: Engine['sizes'], view: ViewConfig, outline: Outline, xray: XrayProgram}
  | {
    type: 'frame'
    view: Uint8Array<ArrayBuffer>
    // The status bar, in the frames after a tic, the only time it changes.
    status: Uint8Array | null
    // Which of the WAD's palettes the game picks.
    palette: number
    alive: boolean
    exited: boolean
    renderMs: number
    ticMs: number
    tics: number
    timings: Timings
    // Where the columns ran this frame.
    columnsOn: ColumnsOn
    // In the frames the x-ray shows, what it shows: the view then holds shades of the page's x-ray palette.
    xray: XrayFrame | null
    // The inspected column, in the frames the inspector asked for.
    inspection: ColumnInspection | null
    player: {x: number, y: number, angle: number}
    actors: Actor[]
  }
  | {type: 'gpu', status: GpuStatus}
  | {type: 'probe', status: ProbeStatus}
  | {type: 'error', message: string}

const post = (message: FromWorker, transfer: Transferable[] = []) => self.postMessage(message, {transfer})
// An error's message, with where it came from when the page should show that too.
const messageOf = (error: unknown, withStack = false) =>
  error instanceof Error ? (withStack ? error.stack ?? error.message : error.message) : String(error)

let engine: Engine | null = null
let keys: Keys = noKeys
let started = 0
// Frames posted that the page has yet to show, frames rendering, and the last of them to post, since each posts after
// the one before.
let unshown = 0
let rendering = 0
let lastFrame: Promise<void> = Promise.resolve()
let inspectedColumn = -1
// Whether the next frame carries an inspection: the page asks once per display refresh, and the first frame does.
let inspectNext = true
// The tic the status bar was last drawn for.
let statusTic = -1
// Views the page has shown and sent back, to draw later frames into.
const spareViews: Uint8Array<ArrayBuffer>[] = []
let gpu: GpuColumns | null = null
// Where the page wants the columns and pixels. Switched to the CPU, the GPU keeps its compiled shaders for when it is
// switched back, and it compiles them the first time it is switched on.
let columnsWanted: ColumnsOn = 'CPU'
// Two GPU frames are also drawn on the CPU, and the page shows how many pixels differ: the first, drawn alone, and the
// first whose pixels come back after a frame of a later tic was written to the GPU, which checks that overlapping
// frames keep to their own source.
let gpuChecks = 0
// The tic of the last frame written to the GPU.
let writtenTic = -1
let lastTicMs = 0
// The pixel program's operation the x-ray shows, or null for the picture; the probe shader's state on the GPU; and
// buffers for the operation's values, one per frame in flight.
let xrayOperation: number | null = null
let probeState: 'none' | ProbeStatus['state'] = 'none'
const spareValues: Float32Array<ArrayBuffer>[] = []
let paletteOperations = new Set<number>()

const monsterNames: Record<number, string> = {3004: 'Zombieman', 9: 'Shotgun guy', 3001: 'Imp', 3002: 'Demon'}

function outline(current: Engine): Outline {
  const {map} = current.level
  const lines = new Float32Array(map.linedefs.length * 4)
  const walls = new Uint8Array(map.linedefs.length)
  map.linedefs.forEach((linedef, index) => {
    const a = map.vertices[linedef.v1]!
    const b = map.vertices[linedef.v2]!
    lines.set([a.x, a.y, b.x, b.y], index * 4)
    walls[index] = linedef.back < 0 ? 1 : 0
  })
  const cells = current.scene.cells.map(cell => Float32Array.from(cell.vertices.flatMap(vertex => [current.scene.vertices[vertex]!.x, current.scene.vertices[vertex]!.y])))
  return {lines, walls, cells}
}

function actors(current: Engine): Actor[] {
  const {game} = current
  const monsters = game.things.filter(thing => thing.info.kind === 'monster')
  return monsters.map((thing, index) => {
    const cells = game.cells.monsters[index]!
    return {
      name: monsterNames[thing.type] ?? 'Monster',
      x: current.read(cells.x),
      y: current.read(cells.y),
      health: current.read(cells.health),
      maxHealth: thing.info.health ?? 1,
      state: game.states.names[current.read(game.cells.things[thing.index]!.state)] ?? '',
    }
  })
}

let gpuStatus: GpuStatus | null = null
const postGpu = (changes: Partial<GpuStatus>) => {
  if (gpuStatus === null) return
  gpuStatus = {...gpuStatus, ...changes}
  if (changes.state !== undefined) gpuStatus.since = Date.now()
  post({type: 'gpu', status: {...gpuStatus, stages: gpuStatus.stages.map(stage => ({...stage}))}})
}

async function startGpu(current: Engine) {
  const {width, height} = current.view
  gpuStatus = {state: 'writing', adapter: '', since: Date.now(), writeMs: 0, stages: [], differing: null, pixels: 0, error: ''}
  postGpu({})
  try {
    const started = performance.now()
    const columns = compileColumnShader(current.columnProgram, {columnCell: current.columnCell, record: current.recordPositions, width})
    const pixels = compilePixelShader(current.pixelProgram, {
      rowCell: current.rowCell, recordCells: current.recordCells, pixel: current.pixelPosition, width, height,
    })
    const stages = [columns, pixels].map(shader => ({
      name: shader.name, operations: shader.operations, wgslBytes: shader.code.length, invocations: shader.invocations, state: 'waiting' as StageState, ms: 0,
    }))
    postGpu({state: 'compiling', writeMs: performance.now() - started, stages})
    gpu = await createGpuColumns({columns, pixels}, {width, height, recordSize: current.recordCells.length}, {
      adapter: adapter => postGpu({adapter}),
      stage: (index, state, ms) => postGpu({stages: gpuStatus!.stages.map((stage, at) => at === index ? {...stage, state, ms} : stage)}),
      lost: message => dropGpu('lost', message),
    })
    postGpu({state: 'checking'})
  } catch (error) {
    postGpu({state: 'failed', error: messageOf(error)})
  }
}

// The GPU is gone, whether a frame failed on it or its device was lost while the CPU drew: the CPU draws from then on.
// A lost device fails the frames in flight too, so only the first to tell says why.
function dropGpu(state: 'failed' | 'lost', error: string) {
  if (gpuStatus === null || gpuStatus.state === 'failed' || gpuStatus.state === 'lost') return
  gpu = null
  postGpu({state, error})
}

async function startProbe(current: Engine, running: GpuColumns) {
  const {width, height} = current.view
  probeState = 'compiling'
  const status: ProbeStatus = {state: 'compiling', since: Date.now(), ms: 0, operations: 0, wgslBytes: 0, invocations: 0, error: ''}
  post({type: 'probe', status})
  try {
    const shader = compileProbeShader(current.pixelProgram, {
      rowCell: current.rowCell, recordCells: current.recordCells, operations: current.pixelOperations.positions, width, height,
    })
    Object.assign(status, {operations: shader.operations, wgslBytes: shader.code.length, invocations: shader.invocations})
    post({type: 'probe', status})
    const ms = await running.addProbe(shader)
    probeState = 'ready'
    post({type: 'probe', status: {...status, state: 'ready', ms}})
  } catch (error) {
    probeState = 'failed'
    post({type: 'probe', status: {...status, state: 'failed', error: messageOf(error)}})
  }
}

// The x-ray's view of an operation's values. Palette indices stay as they are. Any other value becomes a shade of the
// page's x-ray palette: 0 for zero, 1 to 127 for negative values and 128 to 255 for positive ones, by where the value
// lies in the range the frame's values span, leaving out the outermost half percent at either end of a sample, so that
// a few far values don't wash out the rest. Values that span zero shade by their magnitude.
function shade(values: Float32Array, into: Uint8Array, operation: number): XrayFrame {
  if (paletteOperations.has(operation)) {
    into.set(values)
    return {operation, low: 0, high: 255, palette: true}
  }
  const step = Math.max(1, Math.floor(values.length / 4096))
  const sample: number[] = []
  for (let index = 0; index < values.length; index += step) if (Number.isFinite(values[index]!)) sample.push(values[index]!)
  sample.sort((a, b) => a - b)
  let low = sample[Math.floor((sample.length - 1) * 0.005)] ?? 0
  let high = sample[Math.ceil((sample.length - 1) * 0.995)] ?? 0
  if (low === high) {
    for (const value of values) {
      if (value < low) low = value
      if (value > high) high = value
    }
  }
  const magnitude = Math.max(-low, high)
  for (let index = 0; index < values.length; index++) {
    const value = values[index]!
    let t: number
    if (value === 0 || Number.isNaN(value)) {
      into[index] = 0
      continue
    } else if (low < 0 && high > 0) t = Math.abs(value) / magnitude
    else if (high > low) t = low >= 0 ? (value - low) / (high - low) : (high - value) / (high - low)
    else t = 1
    t = Math.min(1, Math.max(0, t))
    into[index] = value > 0 ? 128 + Math.round(t * 127) : 1 + Math.round(t * 126)
  }
  return {operation, low, high, palette: false}
}

// Shades an operation's values into a view, and keeps their buffer for a later frame.
function shadeInto(values: Float32Array<ArrayBuffer>, into: Uint8Array, operation: number) {
  const xray = shade(values, into, operation)
  spareValues.push(values)
  return xray
}

// A frame's view, where its columns ran, how long they took, on the GPU from writing the source to the pixels back,
// and what the x-ray shows in it.
type View = {view: Uint8Array<ArrayBuffer>, columnsOn: ColumnsOn, columnsMs: number, pixelsMs: number, xray: XrayFrame | null}

// Starts the view: on the CPU it is done when this returns, and on the GPU it comes when the GPU is, so the frame's
// other work runs meanwhile.
function startView(current: Engine, into: Uint8Array<ArrayBuffer>): View | Promise<View> {
  // The frame program runs as generated JavaScript at the GPU's frame rates, often enough for the JavaScript engine to
  // optimize it, and on the runtime's evaluator at the CPU's.
  const onGpu = gpu !== null && columnsWanted === 'GPU'
  current.useFrameBackend(onGpu ? 'js' : 'tensor')
  // The x-ray: on the GPU it waits for the probe shader, which compiles the first time the x-ray is on there, while
  // frames show the picture; if the shader failed, the CPU draws the x-ray.
  const operation = xrayOperation
  if (operation !== null && gpu !== null && onGpu && probeState === 'none') void startProbe(current, gpu)
  const probing = operation !== null && (!onGpu || probeState === 'ready' || probeState === 'failed')
  const onCpu = (): View => {
    if (operation === null || !probing) {
      const view = current.render(into)
      return {view, columnsOn: 'CPU', columnsMs: current.timings.columnsMs, pixelsMs: current.timings.pixelsMs, xray: null}
    }
    current.prepareColumns()
    const xray = shadeInto(current.probeColumns(operation, spareValues.pop()), into, operation)
    return {view: into, columnsOn: 'CPU', columnsMs: current.timings.columnsMs, pixelsMs: current.timings.pixelsMs, xray}
  }
  if (gpu === null || !onGpu || (probing && probeState === 'failed')) return onCpu()
  const running = gpu
  // A frame that fails on the GPU is drawn on the CPU, and so is every one after it.
  const lostDevice = (error: unknown) => {
    dropGpu(running.lost ? 'lost' : 'failed', `a frame failed on the GPU: ${messageOf(error)}`)
    return onCpu()
  }
  if (operation !== null && probing) {
    const source = current.prepareColumns()
    const started = performance.now()
    return running.probe(source, operation, spareValues.pop()).then(values => {
      const xray = shadeInto(values, into, operation)
      return {view: into, columnsOn: 'GPU' as const, columnsMs: performance.now() - started, pixelsMs: 0, xray}
    }, lostDevice)
  }
  const source = current.prepareColumns()
  const tic = current.tics
  writtenTic = tic
  // Until both checks are done, the source this frame had, since a later frame may write its own meanwhile.
  const kept = gpuChecks < 2 ? source.slice() : null
  const started = performance.now()
  return running.render(source, into).then(view => {
    const columnsMs = performance.now() - started
    if (kept !== null && gpuChecks < 2 && (gpuChecks === 0 || writtenTic !== tic)) {
      source.set(kept)
      const cpu = current.renderColumns()
      let differing = 0
      for (let index = 0; index < cpu.length; index++) if (cpu[index] !== view[index]) differing++
      gpuChecks++
      const counts = {differing: (gpuStatus?.differing ?? 0) + differing, pixels: (gpuStatus?.pixels ?? 0) + cpu.length}
      postGpu(gpuChecks === 2 ? {state: 'running', ...counts} : counts)
    }
    return {view, columnsOn: 'GPU' as const, columnsMs, pixelsMs: 0, xray: null}
  }, lostDevice)
}

// Runs the tics that are due, at most a second of them, so a stalled tab doesn't spin.
function runTics(current: Engine) {
  const due = Math.floor((performance.now() - started) * 35 / 1000)
  let ran = 0
  const ticStart = performance.now()
  while (current.tics < due && ran < 35) {
    current.tic(keys)
    ran++
  }
  if (ran === 35) started = performance.now() - current.tics * 1000 / 35
  // Frames outpace tics: keep the last tic's time for frames that ran none.
  if (ran > 0) lastTicMs = (performance.now() - ticStart) / ran
}

// Renders a frame and posts it after the one before. Everything but the view is read before the view is awaited, since
// the next frame's tics can run meanwhile.
async function renderFrame(current: Engine, previous: Promise<void>) {
  const renderStart = performance.now()
  const pending = startView(current, spareViews.pop() ?? new Uint8Array(current.view.width * current.view.height))
  // The CPU's part of the frame, while the GPU draws: the status bar after a tic, as Doom redraws it only when it
  // changes, and the inspected column if the page asked.
  const status = current.tics === statusTic ? null : current.renderStatus()
  statusTic = current.tics
  const inspection = inspectNext ? current.inspect(inspectedColumn < 0 ? current.view.width >> 1 : inspectedColumn) : null
  inspectNext = false
  const player = current.game.cells.player
  const state = {
    palette: current.palette,
    alive: current.read(player.health) > 0,
    exited: current.exited,
    ticMs: lastTicMs,
    tics: current.tics,
    player: {x: current.read(player.x), y: current.read(player.y), angle: current.read(player.angle)},
    actors: actors(current),
  }
  const timings = {...current.timings}
  const {view, columnsOn, columnsMs, pixelsMs, xray} = await pending
  const renderMs = performance.now() - renderStart
  await previous
  post({
    type: 'frame', view, status, ...state, renderMs, timings: {...timings, columnsMs, pixelsMs}, columnsOn, xray, inspection,
  }, [view.buffer, ...status === null ? [] : [status.buffer], ...inspection === null ? [] : [inspection.activations.buffer]])
  unshown++
}

// An error stops the game, and the page shows it.
function stop(error: unknown) {
  post({type: 'error', message: messageOf(error, true)})
  engine = null
}

// Yields to the worker's messages, e.g. the keys, then pumps again: a message to itself, since nested setTimeout(0)s
// wait at least 4 ms each.
const again = new MessageChannel()
again.port1.onmessage = pump
let ticTimer: ReturnType<typeof setTimeout> | undefined

// Runs the due tics and starts the next frame, unless enough are rendering or the page is behind: two on the GPU
// once its first frame is checked or while it draws the x-ray, otherwise one, and three ahead of the page in all.
// While the page is behind, e.g. in a hidden tab, the game's time goes on by a timer.
function pump() {
  if (engine === null) return
  clearTimeout(ticTimer)
  const overlapping = gpu !== null && columnsWanted === 'GPU' && (gpuChecks > 0 || (xrayOperation !== null && probeState === 'ready'))
  if (rendering >= (overlapping ? 2 : 1)) return
  try {
    runTics(engine)
  } catch (error) {
    stop(error)
    return
  }
  if (unshown + rendering >= 3) {
    ticTimer = setTimeout(pump, 1000 / 35)
    return
  }
  rendering++
  const frame = renderFrame(engine, lastFrame).catch(stop).finally(() => {
    rendering--
    again.port2.postMessage(null)
  })
  lastFrame = frame
  // The next frame can start while this one is on the GPU.
  again.port2.postMessage(null)
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data
  if (message.type === 'start') {
    try {
      engine = createEngine(new Uint8Array(message.wad), {view: message.view, backends: message.backends, log: text => post({type: 'progress', message: text})})
      const operations = engine.pixelOperations
      const xray: XrayProgram = {
        operations: operations.positions.length, layers: operations.layers, kinds: operations.kinds, layerCount: operations.layerCount, stops: engine.xrayStops,
      }
      paletteOperations = new Set(engine.xrayStops.filter(stop => stop.palette).map(stop => stop.operation))
      post({type: 'ready', palettes: engine.assets.palettes, sizes: engine.sizes, view: message.view, outline: outline(engine), xray})
      started = performance.now() - engine.tics * 1000 / 35
      columnsWanted = message.columnsOn
      if (columnsWanted === 'GPU') void startGpu(engine)
      pump()
    } catch (error) {
      stop(error)
    }
  } else if (message.type === 'keys') {
    keys = message.keys
  } else if (message.type === 'inspect') {
    inspectedColumn = message.column
  } else if (message.type === 'xray') {
    xrayOperation = message.operation
  } else if (message.type === 'columns') {
    columnsWanted = message.on
    if (columnsWanted === 'GPU' && gpuStatus === null && engine !== null) void startGpu(engine)
  } else {
    unshown--
    spareViews.push(message.view)
    if (message.inspect) inspectNext = true
    pump()
  }
}
