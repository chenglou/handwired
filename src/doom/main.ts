// The page: fetches the WAD, starts the worker, sends it the held keys, and shows its frames. Showing a frame is the
// display's job, as Doom's video hardware did: the view's and the status bar's palette indices through the palette the
// game picks, into a 320 × 200 canvas, each of the view's columns 320 / width canvas columns wide. With the x-ray on,
// the view shows one operation of the pixel program at every pixel, through the x-ray's palette.
import {type Backends, type Keys, instructions, noKeys} from './engine.ts'
import {type ViewConfig} from './view.ts'
import {createInspector, escapeHtml, gpuSummary, instructionColors, instructionNames, xrayPalette} from './inspector.ts'
import {type ColumnsOn, type FromWorker, type GpuStatus, type ProbeStatus, type ToWorker, type XrayFrame, type XrayProgram} from './worker.ts'

const parameters = new URLSearchParams(location.search)
// The columns start on the GPU where WebGPU is, and otherwise run as generated JavaScript; ?columns=cpu starts them on
// the CPU, and ?columns=tensor runs them there on the runtime's evaluator. The switch under the screen, or G, moves
// them while the game runs. A page that starts on the GPU has Doom's full 320 columns, and one that starts on the CPU
// the 160 of its low detail, which stay when switched; ?detail=high or ?detail=low picks either.
// Only the backends the page knows; anything else is the default.
const columnsParameter = ['gpu', 'cpu', 'tensor'].find(name => name === parameters.get('columns')) ?? null
// WebGPU, if the browser has it and an adapter: some declare it and have none, and their columns would start on the
// CPU at the GPU's 320.
const webGpu = 'gpu' in navigator && await navigator.gpu.requestAdapter().then(adapter => adapter !== null, () => false)
// Where the page wants the columns, which is where they run once the GPU is ready.
let columnsOn: ColumnsOn = (columnsParameter === null || columnsParameter === 'gpu') && webGpu ? 'GPU' : 'CPU'
const backends: Partial<Backends> = columnsParameter === 'tensor' ? {column: 'tensor'} : {}
const detail = parameters.get('detail') ?? (columnsOn === 'GPU' ? 'high' : 'low')
const view: ViewConfig = {width: detail === 'high' ? 320 : 160, height: 168, steps: 32}
const canvas = document.querySelector<HTMLCanvasElement>('#screen')!
const status = document.querySelector<HTMLElement>('#status')!
const stats = document.querySelector<HTMLElement>('#stats')!
const message = document.querySelector<HTMLElement>('#message')!
const columnOutline = document.querySelector<HTMLElement>('#column-outline')!
const gpuStatus = document.querySelector<HTMLElement>('#gpu')!
const switches = [...document.querySelectorAll<HTMLButtonElement>('[data-columns]')]
const layout = document.querySelector<HTMLElement>('.layout')!
const inspectorRoot = document.querySelector<HTMLElement>('#inspector')!
let inspector: ReturnType<typeof createInspector> | null = null
// The inspector's column, picked by hovering the screen, and whether the inspector shows, kept for the next visit.
let inspectedColumn = view.width >> 1
const inspectorKey = 'handwired-doom-inspector'
try {
  if (localStorage.getItem(inspectorKey) === 'hidden') layout.classList.add('inspector-hidden')
} catch {
  // Storage can be unavailable; the inspector then starts shown.
}
const context = canvas.getContext('2d')!
const image = context.createImageData(320, 200)
// The canvas's pixels as one 32-bit RGBA word each, and each palette as words: bytes R, G, B, A, little-endian like
// every machine browsers run on. Each of the 320 canvas columns shows a view column.
const imageWords = new Uint32Array(image.data.buffer)
let palettes: Uint8Array[] = []
let paletteWords: Uint32Array[] = []
const wordsOf = (palette: Uint8Array) => Uint32Array.from({length: 256}, (_, index) =>
  (0xff000000 | palette[index * 3 + 2]! << 16 | palette[index * 3 + 1]! << 8 | palette[index * 3]!) >>> 0)
const sourceColumns = Int32Array.from({length: 320}, (_, x) => Math.floor(x * view.width / 320))

// The GPU's status, shown under the screen and in the inspector, with clocks that tick while the shaders compile.
let gpuState: GpuStatus | null = null
let gpuClock = 0
// The x-ray's probe shader, once the x-ray has asked the GPU for it.
let probeStatus: ProbeStatus | null = null
const gpuOff = webGpu
  ? `columns and pixels run on the CPU${columnsParameter === 'tensor' ? ', on the runtime\'s evaluator' : ''}: the switch or G puts them on the GPU`
  : 'this browser has no WebGPU, so columns and pixels run on the CPU'
// The GPU can take the columns while the browser has WebGPU and it hasn't failed or lost its device.
const gpuUsable = () => webGpu && gpuState?.state !== 'failed' && gpuState?.state !== 'lost'
function showGpu() {
  const now = Date.now()
  if (!gpuUsable()) columnsOn = 'CPU'
  gpuStatus.textContent = gpuState === null ? (columnsOn === 'GPU' ? 'WebGPU · waiting for the programs' : gpuOff) : gpuSummary(gpuState, now, columnsOn)
  inspector?.showGpu(gpuState, gpuOff, now, columnsOn, probeStatus)
  for (const button of switches) {
    button.setAttribute('aria-pressed', String(button.dataset['columns'] === columnsOn))
    if (button.dataset['columns'] === 'GPU') {
      button.disabled = !gpuUsable()
      button.title = !webGpu ? 'this browser has no WebGPU' : gpuUsable() ? 'columns and pixels on the GPU (G)' : 'the GPU failed, so the CPU draws'
    }
  }
  const waiting = (gpuState !== null && (gpuState.state === 'writing' || gpuState.state === 'compiling')) || probeStatus?.state === 'compiling'
  if (waiting && gpuClock === 0) gpuClock = window.setInterval(showGpu, 100)
  if (!waiting && gpuClock !== 0) {
    window.clearInterval(gpuClock)
    gpuClock = 0
  }
}
showGpu()

const worker = new Worker('./worker.js')
const send = (toWorker: ToWorker, transfer: Transferable[] = []) => worker.postMessage(toWorker, transfer)
// E.g. a worker that doesn't build, which the server answers with its errors.
worker.onerror = event => {
  status.textContent = `error: the worker failed${event.message === '' ? '' : `: ${event.message}`}`
}

function switchColumns(on: ColumnsOn) {
  if (on === columnsOn || (on === 'GPU' && !gpuUsable())) return
  columnsOn = on
  send({type: 'columns', on})
  showGpu()
  showXray()
}
for (const button of switches) {
  button.addEventListener('click', () => {
    switchColumns(button.dataset['columns'] === 'GPU' ? 'GPU' : 'CPU')
    // Space is Doom's use key, which would press a focused button again.
    button.blur()
  })
}

// The x-ray: which of the pixel program's operations shows at every pixel, or none for the picture. The strip under
// the screen has a cell per operation, colored by its instruction and grouped by layer, with ticks at the named ones;
// dragging on it, the arrows beside it, Z and C, or a click on the inspector's activations picks one. The sweep steps
// from the shown one, or from the first when the last shows, pausing at the stops that have buttons, and ends on the
// last, the pixel itself.
const xrayPanel = document.querySelector<HTMLElement>('[data-xray]')!
const xrayToggle = document.querySelector<HTMLButtonElement>('[data-xray-toggle]')!
const xrayStrip = document.querySelector<HTMLCanvasElement>('[data-xray-strip]')!
const xraySweep = document.querySelector<HTMLButtonElement>('[data-xray-sweep]')!
const xrayOperationText = document.querySelector<HTMLElement>('[data-xray-operation]')!
const xrayRange = document.querySelector<HTMLElement>('[data-xray-range]')!
const xrayChapters = document.querySelector<HTMLElement>('[data-xray-chapters]')!
const xrayWords = wordsOf(xrayPalette)
let xrayProgram: XrayProgram | null = null
let xrayOperation: number | null = null
// The operation the x-ray shows when switched on: the last one shown, at first the unlit texels.
let xrayPick = 0
let lastXray: XrayFrame | null = null
let sweepTimer = 0

function setXray(operation: number | null) {
  if (xrayProgram === null) return
  if (operation !== null) {
    operation = Math.max(0, Math.min(xrayProgram.operations - 1, operation))
    xrayPick = operation
  }
  if (operation === xrayOperation) return
  xrayOperation = operation
  if (operation === null) stopSweep()
  send({type: 'xray', operation})
  showXray()
}

const toggleXray = () => setXray(xrayOperation === null ? xrayPick : null)

function stopSweep() {
  window.clearTimeout(sweepTimer)
  sweepTimer = 0
  xraySweep.setAttribute('aria-pressed', 'false')
}

function sweep() {
  if (xrayProgram === null) return
  if (sweepTimer !== 0) {
    stopSweep()
    return
  }
  xraySweep.setAttribute('aria-pressed', 'true')
  const program = xrayProgram
  const step = (operation: number) => {
    setXray(operation)
    if (operation >= program.operations - 1) {
      stopSweep()
      return
    }
    sweepTimer = window.setTimeout(() => step(operation + 1), program.stops.some(stop => stop.operation === operation && stop.chapter !== null) ? 1200 : 90)
  }
  // From the start, or from where the x-ray is unless that is the end.
  step(xrayOperation === null || xrayOperation >= program.operations - 1 ? 0 : xrayOperation)
}

// The first operation of the layer `by` layers from the shown one's.
function layerStep(by: number) {
  if (xrayProgram === null) return 0
  const {layers} = xrayProgram
  const current = xrayOperation ?? xrayPick
  const target = Math.max(0, Math.min(xrayProgram.layerCount - 1, layers[current]! + by))
  let first = layers.findIndex(layer => layer >= target)
  if (first < 0) first = layers.length - 1
  // A layer can have no operation that computes: past the last, keep to the last.
  if (by < 0) first = layers.findIndex(layer => layer === layers[first])
  return first
}

function drawStrip() {
  if (xrayProgram === null || xrayOperation === null) return
  const ratio = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1
  const width = Math.round(xrayStrip.clientWidth * ratio)
  const height = Math.round(xrayStrip.clientHeight * ratio)
  if (xrayStrip.width !== width || xrayStrip.height !== height) {
    xrayStrip.width = width
    xrayStrip.height = height
  }
  const strip = xrayStrip.getContext('2d')!
  strip.clearRect(0, 0, width, height)
  const {operations, layers, kinds, stops} = xrayProgram
  const cell = width / operations
  const top = Math.round(height * 0.3)
  for (let operation = 0; operation < operations; operation++) {
    const x = operation * cell
    // A gap between layers, and every other layer dimmer.
    const gap = operation > 0 && layers[operation] !== layers[operation - 1] ? Math.max(1, Math.round(ratio)) : 0
    strip.globalAlpha = layers[operation]! % 2 === 0 ? 1 : 0.6
    strip.fillStyle = instructionColors[instructions[kinds[operation]!]!]
    strip.fillRect(Math.round(x) + gap, top, Math.max(1, Math.round(x + cell) - Math.round(x) - gap), height - top)
  }
  strip.globalAlpha = 1
  // Ticks at the named operations, taller at the stops the buttons below jump to.
  strip.fillStyle = '#8a8a93'
  for (const stop of stops) strip.fillRect(Math.round((stop.operation + 0.5) * cell - ratio / 2), stop.chapter === null ? top * 0.55 : 0, Math.max(1, Math.round(ratio)), stop.chapter === null ? top * 0.45 : top)
  // The shown operation: outlined, under a pointer.
  const shown = xrayOperation
  const center = (shown + 0.5) * cell
  strip.strokeStyle = '#0b0b0c'
  strip.lineWidth = 4 * ratio
  strip.strokeRect(Math.round(shown * cell), top, Math.max(3 * ratio, Math.round(cell)), height - top)
  strip.strokeStyle = '#ffffff'
  strip.lineWidth = 2 * ratio
  strip.strokeRect(Math.round(shown * cell), top, Math.max(3 * ratio, Math.round(cell)), height - top)
  strip.fillStyle = '#ffffff'
  strip.beginPath()
  strip.moveTo(center - top * 0.6, 0)
  strip.lineTo(center + top * 0.6, 0)
  strip.lineTo(center, top - ratio)
  strip.closePath()
  strip.fill()
}

function formatValue(value: number) {
  if (value === 0) return '0'
  const magnitude = Math.abs(value)
  if (magnitude >= 1e6 || magnitude < 1e-3) return value.toExponential(2)
  return value.toLocaleString('en-US', {maximumFractionDigits: magnitude >= 100 ? 0 : magnitude >= 1 ? 2 : 4})
}

// The range the shown frame's shades span, or why the x-ray isn't showing yet.
function showXrayRange() {
  let html: string
  if (xrayOperation !== null && columnsOn === 'GPU' && probeStatus?.state === 'compiling') {
    html = 'compiling the probe shader; the picture shows meanwhile'
  } else if (lastXray === null || lastXray.operation !== xrayOperation) {
    html = 'waiting for its frame…'
  } else if (lastXray.palette) {
    html = 'palette indices, through Doom\'s palette'
  } else {
    const {low, high} = lastXray
    const gradient = low < 0 && high > 0
      ? 'linear-gradient(90deg, #e0f6ff, #38bdf8, #08162a, #0c0c0f, #281608, #f5a524, #fff4d6)'
      : high <= 0 ? 'linear-gradient(90deg, #e0f6ff, #38bdf8, #08162a)' : 'linear-gradient(90deg, #281608, #f5a524, #fff4d6)'
    html = `${formatValue(low)} <b style="background:${gradient}"></b> ${formatValue(high)}`
  }
  if (probeStatus?.state === 'failed' && xrayOperation !== null) html = `the probe shader failed, so the CPU draws the x-ray: ${escapeHtml(probeStatus.error)}`
  if (xrayRange.innerHTML !== html) xrayRange.innerHTML = html
}

function showXray() {
  const on = xrayOperation !== null
  xrayToggle.setAttribute('aria-pressed', String(on))
  xrayPanel.hidden = !on
  inspector?.showXray(xrayOperation)
  if (xrayProgram === null || xrayOperation === null) return
  const operation = xrayOperation
  const kind = instructions[xrayProgram.kinds[operation]!]!
  const stop = xrayProgram.stops.find(named => named.operation === operation)
  xrayOperationText.innerHTML = `operation ${operation + 1} of ${xrayProgram.operations} · layer ${xrayProgram.layers[operation]! + 1} of ${xrayProgram.layerCount} · <i style="background:${instructionColors[kind]}"></i>${instructionNames[kind]}${stop === undefined ? '' : ` · ${stop.name}`}`
  for (const button of xrayChapters.querySelectorAll<HTMLButtonElement>('button')) button.setAttribute('aria-pressed', String(Number(button.dataset['operation']) === operation))
  showXrayRange()
  drawStrip()
}

function setUpXray(program: XrayProgram) {
  xrayProgram = program
  xrayPick = program.stops.find(stop => stop.chapter === 'unlit')?.operation ?? program.operations - 1
  xrayChapters.replaceChildren(...program.stops.filter(stop => stop.chapter !== null).map(stop => {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = stop.chapter
    button.title = stop.name
    button.dataset['operation'] = String(stop.operation)
    button.addEventListener('click', () => {
      stopSweep()
      setXray(stop.operation)
      button.blur()
    })
    return button
  }))
}

xrayToggle.addEventListener('click', () => {
  toggleXray()
  xrayToggle.blur()
})
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-xray-step]')) {
  button.addEventListener('click', () => {
    stopSweep()
    setXray((xrayOperation ?? xrayPick) + Number(button.dataset['xrayStep']))
    button.blur()
  })
}
xraySweep.addEventListener('click', () => {
  sweep()
  xraySweep.blur()
})
const scrub = (event: PointerEvent) => {
  if (xrayProgram === null) return
  const bounds = xrayStrip.getBoundingClientRect()
  stopSweep()
  setXray(Math.floor((event.clientX - bounds.left) / bounds.width * xrayProgram.operations))
}
xrayStrip.addEventListener('pointerdown', event => {
  xrayStrip.setPointerCapture(event.pointerId)
  scrub(event)
})
xrayStrip.addEventListener('pointermove', event => {
  if (xrayStrip.hasPointerCapture(event.pointerId)) scrub(event)
})
new ResizeObserver(drawStrip).observe(xrayStrip)

// Doom's keys, and WASD.
const bindings: Record<string, keyof Keys> = {
  ArrowUp: 'forward', KeyW: 'forward',
  ArrowDown: 'back', KeyS: 'back',
  ArrowLeft: 'turnLeft',
  ArrowRight: 'turnRight',
  KeyA: 'strafeLeft', Comma: 'strafeLeft',
  KeyD: 'strafeRight', Period: 'strafeRight',
  ShiftLeft: 'run', ShiftRight: 'run',
  Space: 'use', KeyE: 'use',
  ControlLeft: 'fire', ControlRight: 'fire', KeyF: 'fire',
  Digit1: 'fist', Digit2: 'pistol', Digit3: 'shotgun',
}
const held: Keys = {...noKeys}
function setKey(key: keyof Keys, down: boolean) {
  if (held[key] === down) return
  held[key] = down
  send({type: 'keys', keys: {...held}})
}
const xrayKeys = ['KeyX', 'KeyZ', 'KeyC', 'KeyP']
const releaseKeys = () => {
  Object.assign(held, noKeys)
  send({type: 'keys', keys: {...held}})
}
window.addEventListener('keydown', event => {
  // The browser's and the system's shortcuts, e.g. Cmd+S, are theirs. macOS sends no keyup for a key released while
  // Cmd is down, so a key held then would stay held.
  if (event.metaKey) return
  if (xrayKeys.includes(event.code)) {
    event.preventDefault()
    if (event.code === 'KeyX' && !event.repeat) toggleXray()
    if (event.code === 'KeyP' && !event.repeat) sweep()
    if (event.code === 'KeyZ' || event.code === 'KeyC') {
      stopSweep()
      const by = event.code === 'KeyZ' ? -1 : 1
      setXray(event.shiftKey ? layerStep(by) : (xrayOperation ?? xrayPick) + by)
    }
    return
  }
  if (event.code === 'KeyG') {
    event.preventDefault()
    if (!event.repeat) switchColumns(columnsOn === 'GPU' ? 'CPU' : 'GPU')
    return
  }
  if (event.code === 'Tab') {
    event.preventDefault()
    if (event.repeat) return
    layout.classList.toggle('inspector-hidden')
    try {
      localStorage.setItem(inspectorKey, layout.classList.contains('inspector-hidden') ? 'hidden' : 'shown')
    } catch {
      // Storage can be unavailable; the choice then lasts this visit.
    }
    return
  }
  const key = bindings[event.code]
  if (key === undefined) return
  event.preventDefault()
  setKey(key, true)
})
window.addEventListener('keyup', event => {
  if (event.code === 'MetaLeft' || event.code === 'MetaRight') releaseKeys()
  const key = bindings[event.code]
  if (key === undefined) return
  event.preventDefault()
  setKey(key, false)
})
canvas.addEventListener('pointerdown', event => {
  if (event.button === 0) setKey('fire', true)
})
canvas.addEventListener('pointermove', event => {
  const bounds = canvas.getBoundingClientRect()
  // Only the view's rows pick a column; the status bar is below them.
  if ((event.clientY - bounds.top) / bounds.height > view.height / 200) return
  const column = Math.max(0, Math.min(view.width - 1, Math.floor((event.clientX - bounds.left) / bounds.width * view.width)))
  if (column === inspectedColumn) return
  inspectedColumn = column
  send({type: 'inspect', column})
})
window.addEventListener('pointerup', () => setKey('fire', false))
// E.g. a touch that the browser takes for scrolling.
window.addEventListener('pointercancel', () => setKey('fire', false))
window.addEventListener('blur', releaseKeys)

let frames = 0
let lastStats = performance.now()
let currentFps = 0
// The inspector draws at most once per display refresh: the worker's first frame carries an inspection, and after each,
// the next animation frame asks the worker for another, which comes with a later frame.
let inspectionWanted = false
let outlinedColumn = -1
// The inspected column's outline over the view, moved when the inspection's column changes.
function outline(column: number) {
  outlinedColumn = column
  columnOutline.style.left = `${column / view.width * 100}%`
  columnOutline.style.width = `${100 / view.width}%`
  columnOutline.style.height = `${view.height / 200 * 100}%`
}
outline(view.width >> 1)
worker.onmessage = (event: MessageEvent<FromWorker>) => {
  const fromWorker = event.data
  if (fromWorker.type === 'progress') {
    status.textContent = fromWorker.message
  } else if (fromWorker.type === 'gpu') {
    gpuState = fromWorker.status
    showGpu()
    showXray()
  } else if (fromWorker.type === 'probe') {
    probeStatus = fromWorker.status
    showGpu()
    showXray()
  } else if (fromWorker.type === 'error') {
    status.textContent = `error: ${fromWorker.message}`
  } else if (fromWorker.type === 'ready') {
    palettes = fromWorker.palettes
    paletteWords = palettes.map(wordsOf)
    status.textContent = `${fromWorker.sizes.map(size => `${size.name} program: ${size.operations.toLocaleString('en-US')} operations in ${size.layers} layers`).join(' · ')}, constants apart`
    inspector = createInspector(inspectorRoot, {
      view, sizes: fromWorker.sizes, outline: fromWorker.outline, steps: view.steps,
      pick: operation => {
        stopSweep()
        setXray(operation)
      },
    })
    setUpXray(fromWorker.xray)
    showGpu()
    showXray()
  } else {
    const gamePalette = palettes[fromWorker.palette]!
    const gameWords = paletteWords[fromWorker.palette]!
    // An x-ray of values that aren't palette indices shows through the x-ray's palette.
    const {xray} = fromWorker
    const shaded = xray !== null && !xray.palette
    const palette = shaded ? xrayPalette : gamePalette
    const words = shaded ? xrayWords : gameWords
    const pixels = fromWorker.view
    for (let row = 0; row < view.height; row++) {
      const from = row * view.width
      const to = row * 320
      for (let x = 0; x < 320; x++) imageWords[to + x] = words[pixels[from + sourceColumns[x]!]!]!
    }
    // The status bar comes when it changes, once per tic, and otherwise stays.
    const bar = fromWorker.status
    if (bar !== null) for (let index = 0; index < bar.length; index++) imageWords[view.height * 320 + index] = gameWords[bar[index]!]!
    if (xray !== lastXray && (xray === null || lastXray === null || xray.operation !== lastXray.operation || xray.low !== lastXray.low || xray.high !== lastXray.high)) {
      lastXray = xray
      showXrayRange()
    }
    context.putImageData(image, 0, 0)
    const inspectorShown = !layout.classList.contains('inspector-hidden')
    const {inspection} = fromWorker
    if (inspection !== null) {
      if (inspection.column !== outlinedColumn) outline(inspection.column)
      if (inspectorShown) inspector?.update({...fromWorker, inspection}, palette, currentFps)
      requestAnimationFrame(() => {
        inspectionWanted = true
      })
    }
    const inspect = inspectorShown && inspectionWanted
    if (inspect) inspectionWanted = false
    // The view's buffer goes back, for the worker to draw a later frame into. A hidden page needs no frames, so it
    // takes its time, which the browser stretches to a second, while the worker's tics keep the game's time.
    const shown = () => send({type: 'shown', inspect, view: fromWorker.view}, [fromWorker.view.buffer])
    if (document.hidden) setTimeout(shown, 100)
    else shown()
    const text = fromWorker.exited ? 'Level complete. Press Space to play again.' : fromWorker.alive ? '' : 'You died. Press Space to restart.'
    if (message.textContent !== text) message.textContent = text
    frames++
    const now = performance.now()
    if (now - lastStats > 500) {
      currentFps = frames * 1000 / (now - lastStats)
      stats.textContent = `${currentFps.toFixed(1)} fps, columns on the ${fromWorker.columnsOn} · frame ${fromWorker.renderMs.toFixed(1)} ms · tic ${fromWorker.ticMs.toFixed(2)} ms`
      frames = 0
      lastStats = now
    }
  }
}

// Doom's shareware DOOM1.WAD, or Freedoom's with ?wad=freedoom.
const wadName = parameters.get('wad') === 'freedoom' ? 'freedoom1.wad' : 'doom1.wad'
status.textContent = `fetching ${wadName}`
try {
  const response = await fetch(`./${wadName}`)
  if (!response.ok) {
    status.textContent = `${wadName} is missing: run \`bun scripts/fetch-doom-wad.ts${wadName === 'doom1.wad' ? '' : ' freedoom'}\` first`
  } else {
    const wad = await response.arrayBuffer()
    status.textContent = 'building the programs'
    send({type: 'start', wad, view, backends, columnsOn}, [wad])
  }
} catch (error) {
  status.textContent = `couldn't fetch ${wadName}: ${error instanceof Error ? error.message : String(error)}`
}
