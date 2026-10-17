// The page's inspector: what the programs are and what they did this frame. It draws from what the worker sends: the
// programs' sizes and mix of instructions, their times, one column's portal walk, intervals and every operation's
// value, and the monsters' states. Drawing only, on the page's side.
import {type ColumnInspection, type ProgramSize, type Timings, instructions} from './engine.ts'
import {type ViewConfig, viewConstants} from './view.ts'
import {type Actor, type ColumnsOn, type GpuStatus, type Outline, type ProbeStatus} from './worker.ts'

type Frame = {
  view: Uint8Array
  timings: Timings
  columnsOn: ColumnsOn
  inspection: ColumnInspection
  player: {x: number, y: number, angle: number}
  actors: Actor[]
}

const programs: Record<string, {title: string, cadence: string, does: string}> = {
  game: {
    title: 'Game',
    cadence: '35 times a second',
    does: 'Keys to movement, wall and thing collision, doors and lifts, pickups, the weapon, every monster\'s thinking, and damage.',
  },
  frame: {
    title: 'Frame',
    cadence: 'once per frame',
    does: 'Views every vertex from the eye, gives every portal line its 1/z per column, projects every sprite and sorts them nearest first.',
  },
  column: {
    title: 'Column',
    cadence: 'once per screen column',
    does: 'Walks the column\'s ray through convex cells, narrows a clip window at each portal, and hands its rows a record: the window\'s intervals, and the masked textures, sprites and weapon crossing it.',
  },
  pixel: {
    title: 'Pixel',
    cadence: 'once per pixel',
    does: 'Finds its row\'s interval in its column\'s record by binary search, then its texel, light and colormap, and draws the overlays over it.',
  },
  status: {
    title: 'Status bar',
    cadence: 'once per tic',
    does: 'Draws the 320 × 32 bar: numbers, face, keys and arms, a table read per pixel of each, and constant pixels for the rest.',
  },
}

export const instructionColors = {sums: '#8b93a7', gates: '#f5a524', booleans: '#f472b6', reads: '#38bdf8'}
export const instructionNames = {sums: 'weighted sum', gates: 'ReLU gate', booleans: 'boolean atom', reads: 'table read'}
// Shorter, for the legend to fit on one line.
const legendNames = {sums: 'sums', gates: 'ReLU gates', booleans: 'booleans', reads: 'table reads'}

// The colors of values, as the inspector and the x-ray show them: amber ramps for positive values and blue ones for
// negative values, from dark to light, and near-black for zero.
const ramp = (from: number[], to: number[], t: number) => from.map((value, index) => Math.round(value + (to[index]! - value) * t))
const positive = Array.from({length: 256}, (_, index) => {
  const t = index / 255
  return t < 0.6 ? ramp([40, 22, 8], [245, 165, 36], t / 0.6) : ramp([245, 165, 36], [255, 244, 214], (t - 0.6) / 0.4)
})
const negative = Array.from({length: 256}, (_, index) => {
  const t = index / 255
  return t < 0.6 ? ramp([8, 22, 40], [56, 189, 248], t / 0.6) : ramp([56, 189, 248], [224, 246, 255], (t - 0.6) / 0.4)
})
const zero = [12, 12, 15]

// The x-ray's palette, as the worker shades an operation's values: 0 for zero, 1 to 127 negative values and 128 to
// 255 positive ones, each from dark to light. Red, green, blue per entry, like Doom's palettes.
export const xrayPalette = Uint8Array.from(Array.from({length: 256}, (_, index) => {
  if (index === 0) return zero
  if (index < 128) return negative[Math.round((index - 1) / 126 * 255)]!
  return positive[Math.round((index - 128) / 127 * 255)]!
}).flat())

export function createInspector(root: HTMLElement, options: {
  view: ViewConfig
  sizes: ProgramSize[]
  outline: Outline
  steps: number
  // Called with the pixel program's operation that a click on the activations picks, for the x-ray.
  pick: (operation: number) => void
}) {
  const {view, sizes, outline, steps} = options
  const size = (name: string) => sizes.find(entry => entry.name === name)!
  const perFrame = size('frame').operations + size('column').operations * view.width
    + size('pixel').operations * view.width * view.height
  const columnOperations = size('column').operations
  const pixelOperations = size('pixel').operations
  const constants = viewConstants(view)

  root.innerHTML = `
    <header class="inspector-head">
      <h2>Under the hood</h2>
      <span class="hint">Tab hides this</span>
    </header>
    <p class="lede">Every tic and every pixel come from five fixed programs of weighted sums, ReLU gates, boolean atoms and table reads: no branches, no loops, nothing trained. JavaScript only writes the keys in and copies numbers between them.</p>
    <div class="totals">
      <div><b data-total="frame">${formatCount(perFrame)}</b><span>operations per frame</span></div>
      <div><b data-total="second">—</b><span>operations per second</span></div>
    </div>
    <div class="legend">${instructions.map(kind => `<span><i style="background:${instructionColors[kind]}"></i>${legendNames[kind]}</span>`).join('')}</div>
    <div class="pipeline">${Object.keys(programs).map(name => {
      const entry = size(name)
      const info = programs[name]!
      const total = entry.operations
      const bar = instructions.map(kind => `<i style="flex:${entry[kind]};background:${instructionColors[kind]}"></i>`).join('')
      return `<article class="program">
        <div class="program-head"><h3>${info.title}</h3><span class="cadence">${name === 'column' ? `${view.width} times a frame` : name === 'pixel' ? `${(view.width * view.height).toLocaleString('en-US')} times a frame` : info.cadence}</span><span class="time" data-time="${name}">—</span></div>
        <div class="numbers">${formatCount(total)} operations · ${entry.layers.toLocaleString('en-US')} layers · ${formatCount(entry.constants)} constants</div>
        <div class="mix">${bar}</div>
        <p>${info.does}</p>
      </article>`
    }).join('')}</div>
    <h3 class="section">WebGPU <small data-gpu-head>—</small></h3>
    <div class="gpu" data-gpu></div>
    <h3 class="section">Column <span data-column>${view.width >> 1}</span> <small>hover the screen to pick another</small></h3>
    <div class="inspect">
      <canvas class="minimap" width="720" height="480"></canvas>
      <div class="column-detail">
        <figure><canvas class="strip intervals" width="20" height="${view.height}"></canvas><figcaption>intervals</figcaption></figure>
        <figure><canvas class="strip pixels" width="1" height="${view.height}"></canvas><figcaption>pixels</figcaption></figure>
        <div class="walk-text" data-walk></div>
      </div>
      <figure class="activations-figure">
        <div class="activations-frame"><canvas class="activations"></canvas><div class="probe-marker" hidden></div></div>
        <figcaption>Above the line, the column program's ${formatCount(columnOperations)} values for this column; below it, the pixel program's ${formatCount(pixelOperations)} values for each of its ${view.height} rows, a row of the image per row of the column. One pixel per operation in execution order, constants left out: amber positive, blue negative, dark zero. Click below the line to x-ray an operation: the screen then shows its value at every pixel.</figcaption>
      </figure>
    </div>
    <h3 class="section">Monsters <small>thinking in the game program</small></h3>
    <ol class="monsters" data-monsters></ol>
  `
  const query = <T extends Element>(selector: string) => root.querySelector<T>(selector)!
  const minimap = query<HTMLCanvasElement>('.minimap')
  const intervals = query<HTMLCanvasElement>('.intervals')
  const pixels = query<HTMLCanvasElement>('.pixels')
  const activations = query<HTMLCanvasElement>('.activations')
  const walkText = query<HTMLElement>('[data-walk]')
  const columnLabel = query<HTMLElement>('[data-column]')
  const monsterList = query<HTMLElement>('[data-monsters]')
  const perSecond = query<HTMLElement>('[data-total="second"]')
  const times = Object.fromEntries(Object.keys(programs).map(name => [name, query<HTMLElement>(`[data-time="${name}"]`)]))
  const gpuHead = query<HTMLElement>('[data-gpu-head]')
  const gpuBody = query<HTMLElement>('[data-gpu]')
  const probeMarker = query<HTMLElement>('.probe-marker')

  // Activations: the pixel program's values one row of the image per row of the column, under the column program's
  // values, wrapped at the same width, and a line between them.
  const activationWidth = pixelOperations
  const columnRows = Math.ceil(columnOperations / activationWidth)
  activations.width = activationWidth
  activations.height = columnRows + 1 + view.height
  const activationImage = activations.getContext('2d')!.createImageData(activations.width, activations.height)
  // The pixel program's rows start below the line, and a pixel's x there is its operation.
  const pixelTop = (columnRows + 1) / activations.height
  probeMarker.style.top = `${pixelTop * 100}%`
  probeMarker.style.width = `${100 / activationWidth}%`
  activations.addEventListener('click', event => {
    const bounds = activations.getBoundingClientRect()
    if ((event.clientY - bounds.top) / bounds.height < pixelTop) return
    options.pick(Math.max(0, Math.min(activationWidth - 1, Math.floor((event.clientX - bounds.left) / bounds.width * activationWidth))))
  })

  // The map's frame: centered on the player, 1600 units across.
  const mapContext = minimap.getContext('2d')!
  const span = 1600
  let fps = 0
  let lastTimesUpdate = 0

  function drawMap(frame: Frame) {
    const {player, inspection} = frame
    const context = mapContext
    const width = minimap.width
    const height = minimap.height
    const scale = width / span
    const toX = (x: number) => (x - player.x) * scale + width / 2
    const toY = (y: number) => height / 2 - (y - player.y) * scale
    context.fillStyle = '#0d0d10'
    context.fillRect(0, 0, width, height)
    // The cells the ray walks, in order, until a wall stops it: the walk repeats its cell from then on.
    const walked: number[] = []
    for (const cell of inspection.cells.subarray(0, inspection.walked)) if (walked[walked.length - 1] !== cell) walked.push(cell)
    walked.forEach((cell, index) => {
      const polygon = outline.cells[cell]
      if (polygon === undefined) return
      context.beginPath()
      for (let point = 0; point < polygon.length; point += 2) {
        const x = toX(polygon[point]!)
        const y = toY(polygon[point + 1]!)
        if (point === 0) context.moveTo(x, y)
        else context.lineTo(x, y)
      }
      context.closePath()
      context.fillStyle = `rgba(56, 189, 248, ${0.32 - 0.22 * index / Math.max(1, walked.length - 1)})`
      context.fill()
      context.strokeStyle = 'rgba(56, 189, 248, 0.55)'
      context.lineWidth = 1
      context.stroke()
    })
    // Lines: walls bright, two-sided lines dim.
    for (let index = 0; index < outline.walls.length; index++) {
      context.strokeStyle = outline.walls[index] === 1 ? '#a1a1aa' : '#3f3f46'
      context.lineWidth = outline.walls[index] === 1 ? 2 : 1
      context.beginPath()
      context.moveTo(toX(outline.lines[index * 4]!), toY(outline.lines[index * 4 + 1]!))
      context.lineTo(toX(outline.lines[index * 4 + 2]!), toY(outline.lines[index * 4 + 3]!))
      context.stroke()
    }
    const angle = player.angle * 2 * Math.PI / 8192
    // The view's edges, and the inspected column's ray to the wall that closes it: the 1/z it held at its last step.
    for (const edge of [-1, 1]) {
      const edgeAngle = angle + edge * Math.PI / 4
      context.strokeStyle = 'rgba(244, 244, 245, 0.18)'
      context.beginPath()
      context.moveTo(toX(player.x), toY(player.y))
      context.lineTo(toX(player.x + Math.cos(edgeAngle) * span), toY(player.y + Math.sin(edgeAngle) * span))
      context.stroke()
    }
    const slope = constants.xs[inspection.column]!
    const rayAngle = angle - Math.atan(slope)
    const lastInverseZ = inspection.inverseZ[inspection.inverseZ.length - 1]!
    const reach = lastInverseZ > 1e-4 ? Math.min(span, 1 / lastInverseZ * Math.sqrt(1 + slope * slope)) : span
    context.strokeStyle = '#38bdf8'
    context.lineWidth = 2
    context.beginPath()
    context.moveTo(toX(player.x), toY(player.y))
    context.lineTo(toX(player.x + Math.cos(rayAngle) * reach), toY(player.y + Math.sin(rayAngle) * reach))
    context.stroke()
    // Monsters, colored by what they are doing.
    for (const actor of frame.actors) {
      const mood = moodOf(actor)
      context.fillStyle = mood.color
      context.beginPath()
      context.arc(toX(actor.x), toY(actor.y), mood.label === 'dead' ? 3 : 5, 0, Math.PI * 2)
      context.fill()
    }
    // The player.
    context.save()
    context.translate(toX(player.x), toY(player.y))
    context.rotate(-angle)
    context.fillStyle = '#f4f4f5'
    context.beginPath()
    context.moveTo(9, 0)
    context.lineTo(-6, 5)
    context.lineTo(-6, -5)
    context.closePath()
    context.fill()
    context.restore()
  }

  function drawColumn(frame: Frame, palette: Uint8Array) {
    const {inspection} = frame
    // The intervals, top to bottom: per step a ceiling and an upper wall, then the gap past the last step, then per
    // step back up a lower wall and a floor. Walls get a hue per step, so each portal reads as its own band.
    const context = intervals.getContext('2d')!
    context.fillStyle = '#000'
    context.fillRect(0, 0, intervals.width, intervals.height)
    const count = inspection.kinds.length
    for (let index = 0; index < count; index++) {
      const top = inspection.boundaries[index]!
      const bottom = inspection.boundaries[index + 1]!
      if (bottom <= top) continue
      let color: string
      if (index === 2 * steps) color = '#000'
      else {
        const upper = index < 2 * steps
        const step = upper ? Math.floor(index / 2) : steps - 1 - Math.floor((index - 2 * steps - 1) / 2)
        const isWall = upper ? index % 2 === 1 : (index - 2 * steps - 1) % 2 === 0
        const kind = inspection.kinds[index]!
        if (kind === 2) color = '#7cc4ff'
        else if (isWall) color = `hsl(${(30 + step * 47) % 360} 85% ${upper ? 58 : 46}%)`
        else color = upper ? '#5b6b8c' : '#4d6b5a'
      }
      context.fillStyle = color
      context.fillRect(0, top, intervals.width, bottom - top)
    }
    // The column's own pixels from the frame.
    const pixelContext = pixels.getContext('2d')!
    const image = pixelContext.createImageData(1, view.height)
    for (let row = 0; row < view.height; row++) {
      const index = frame.view[row * view.width + inspection.column]! * 3
      image.data.set([palette[index]!, palette[index + 1]!, palette[index + 2]!, 255], row * 4)
    }
    pixelContext.putImageData(image, 0, 0)
    // Every operation's value: the column program's, then a line, then the pixel program's per row, colored by sign
    // and log magnitude, 2^-8 to 2^16.
    const data = activationImage.data
    const values = inspection.activations
    const pixelStart = (columnRows + 1) * activationWidth
    for (let index = 0; index < activations.width * activations.height; index++) {
      let value = 0
      if (index < columnOperations) value = values[index]!
      else if (index >= pixelStart) value = values[columnOperations + index - pixelStart] ?? 0
      let color: number[]
      if (index >= columnRows * activationWidth && index < pixelStart) color = [63, 63, 70]
      else if (value === 0 || !Number.isFinite(value)) color = zero
      else {
        const t = Math.max(0, Math.min(1, (Math.log2(Math.abs(value)) + 8) / 24))
        color = (value > 0 ? positive : negative)[Math.round(t * 255)]!
      }
      data.set([color[0]!, color[1]!, color[2]!, 255], index * 4)
    }
    activations.getContext('2d')!.putImageData(activationImage, 0, 0)
    const walked = new Set(inspection.cells.subarray(0, inspection.walked)).size
    const visibleIntervals = Array.from({length: count}, (_, index) => inspection.boundaries[index + 1]! > inspection.boundaries[index]!).filter(Boolean).length
    const lastInverseZ = inspection.inverseZ[inspection.inverseZ.length - 1]!
    walkText.innerHTML = `
      <div><b>${walked}</b> convex cells walked before a solid wall, of ${steps} steps every column takes</div>
      <div><b>${visibleIntervals}</b> visible intervals of ${count}, found per row by an 8-step binary search</div>
      <div>first wall at <b>${lastInverseZ > 1e-4 ? Math.round(1 / lastInverseZ) : '—'}</b> units deep</div>`
    columnLabel.textContent = String(inspection.column)
  }

  function drawMonsters(frame: Frame) {
    monsterList.innerHTML = frame.actors.map(actor => {
      const mood = moodOf(actor)
      const health = Math.max(0, actor.health) / actor.maxHealth
      return `<li title="${actor.state}"><span class="dot" style="background:${mood.color}"></span><span class="name">${actor.name}</span><span class="mood">${mood.label}</span><span class="health"><i style="width:${Math.round(health * 100)}%"></i></span></li>`
    }).join('')
  }

  // The GPU's section: a card per shader with a bar that moves while it compiles, rebuilt when a state changes, and
  // between changes only its clocks. off says why there is no GPU, on where the page wants the columns, and probe how
  // the x-ray's shader compiles, once the x-ray has asked for it.
  let gpuShape = ''
  function showGpu(status: GpuStatus | null, off: string, now: number, on: ColumnsOn, probe: ProbeStatus | null) {
    if (status === null) {
      gpuHead.textContent = 'off'
      if (gpuShape !== 'off') {
        const note = document.createElement('p')
        note.className = 'gpu-note'
        note.textContent = off
        gpuBody.replaceChildren(note)
      }
      gpuShape = 'off'
      return
    }
    const switchedOff = on === 'CPU' && status.state !== 'failed' && status.state !== 'lost'
    gpuHead.textContent = `${gpuStateLabels[status.state]}${switchedOff ? ', switched to the CPU' : ''}`
    const shape = `${status.state} ${status.adapter} ${status.stages.map(stage => stage.state).join(' ')} ${switchedOff} ${status.differing} ${probe?.state} ${probe?.wgslBytes}`
    if (shape !== gpuShape) {
      gpuShape = shape
      const stages = status.stages.map((stage, index) => `
        <div class="gpu-stage" data-state="${stage.state}">
          <div class="gpu-stage-head"><b>${stage.name === 'column' ? 'Column' : 'Pixel'} shader</b><em data-stage-clock="${index}"></em></div>
          <div class="gpu-stage-meta">${formatCount(stage.operations)} operations · ${formatBytes(stage.wgslBytes)} of WGSL · ${stage.invocations.toLocaleString('en-US')} invocations a frame</div>
          <div class="gpu-bar"><i></i></div>
        </div>`).join('') + (probe === null ? '' : `
        <div class="gpu-stage" data-state="${probe.state}">
          <div class="gpu-stage-head"><b>Probe shader, for the x-ray</b><em data-probe-clock></em></div>
          <div class="gpu-stage-meta">${probe.wgslBytes === 0 ? 'writing the WGSL' : `${formatCount(probe.operations)} operations, every one kept · ${formatBytes(probe.wgslBytes)} of WGSL · ${probe.invocations.toLocaleString('en-US')} invocations a frame`}</div>
          <div class="gpu-bar"><i></i></div>
        </div>`)
      const notes: string[] = []
      if (status.adapter !== '') notes.push(`on ${escapeHtml(status.adapter)}`)
      if (status.state !== 'writing') notes.push(`WGSL written in ${Math.round(status.writeMs)} ms`)
      if (switchedOff) notes.push('switched to the CPU, which draws the columns and pixels; the shaders stay compiled for when the GPU is switched back')
      if (status.state === 'compiling') notes.push('the CPU draws until both are ready; the browser caches compiled shaders, so later loads compile faster')
      if (status.state === 'checking') notes.push('drawing two frames on both, to compare: the first, alone, then one that a later tic\'s frame overlaps on the GPU')
      if (status.differing !== null) notes.push(`checked against the CPU: ${status.differing.toLocaleString('en-US')} of ${status.pixels.toLocaleString('en-US')} pixels differ, over the first frame and one that a later tic's frame overlaps`)
      if (status.state === 'failed') notes.push(`failed, so the CPU draws: ${escapeHtml(status.error)}`)
      if (status.state === 'lost') notes.push(`the GPU device was lost, so the CPU draws: ${escapeHtml(status.error)}`)
      if (probe?.state === 'compiling') notes.push('the picture shows until the probe shader is ready')
      if (probe?.state === 'failed') notes.push(`the probe shader failed, so the CPU draws the x-ray: ${escapeHtml(probe.error)}`)
      gpuBody.innerHTML = `${status.state === 'writing' ? '<p class="gpu-note">writing the WGSL from the compiled programs</p>' : stages}<p class="gpu-note">${notes.join(' · ')}</p>`
    }
    status.stages.forEach((stage, index) => {
      const clock = gpuBody.querySelector<HTMLElement>(`[data-stage-clock="${index}"]`)
      if (clock === null) return
      clock.textContent = stage.state === 'compiling' ? `${formatSeconds(now - status.since)}…` : stage.state === 'waiting' ? 'waiting' : formatSeconds(stage.ms)
    })
    const probeClock = gpuBody.querySelector<HTMLElement>('[data-probe-clock]')
    if (probe !== null && probeClock !== null) {
      probeClock.textContent = probe.state === 'compiling' ? `${formatSeconds(now - probe.since)}…` : probe.state === 'failed' ? 'failed' : formatSeconds(probe.ms)
    }
  }

  return {
    showGpu,
    // Marks the operation the x-ray shows on the pixel program's values, or nothing when it is off.
    showXray(operation: number | null) {
      probeMarker.hidden = operation === null
      if (operation !== null) probeMarker.style.left = `${operation / activationWidth * 100}%`
    },
    update(frame: Frame, palette: Uint8Array, framesPerSecond: number) {
      fps = framesPerSecond
      drawMap(frame)
      drawColumn(frame, palette)
      const now = performance.now()
      if (now - lastTimesUpdate > 250) {
        lastTimesUpdate = now
        times['game']!.textContent = `${frame.timings.gameMs.toFixed(2)} ms`
        times['frame']!.textContent = `${frame.timings.frameMs.toFixed(1)} ms`
        times['column']!.textContent = frame.columnsOn === 'GPU' ? `${frame.timings.columnsMs.toFixed(1)} ms with pixels, GPU` : `${frame.timings.columnsMs.toFixed(1)} ms, CPU`
        times['pixel']!.textContent = frame.columnsOn === 'GPU' ? 'GPU' : `${frame.timings.pixelsMs.toFixed(1)} ms, CPU`
        times['status']!.textContent = `${frame.timings.statusMs.toFixed(1)} ms`
        perSecond.textContent = formatCount(Math.round(perFrame * fps + (size('game').operations + size('status').operations) * 35))
        drawMonsters(frame)
      }
    },
  }
}

function moodOf(actor: Actor) {
  if (actor.health <= 0) return {label: 'dead', color: '#7f1d1d'}
  if (actor.state.includes('_ATK')) return {label: 'attacking', color: '#ef4444'}
  if (actor.state.includes('_PAIN')) return {label: 'in pain', color: '#f472b6'}
  if (actor.state.includes('_RUN')) return {label: 'chasing', color: '#f5a524'}
  return {label: 'idle', color: '#9ca3af'}
}

const gpuStateLabels: Record<GpuStatus['state'], string> = {
  writing: 'writing shaders',
  compiling: 'compiling',
  checking: 'checking',
  running: 'running',
  failed: 'failed',
  lost: 'lost',
}

// The status line under the screen: what the GPU is doing, with clocks that count while it compiles, or, switched to
// the CPU, how ready it is to take the columns back.
export function gpuSummary(status: GpuStatus, now: number, on: ColumnsOn) {
  if (on === 'CPU' && status.state !== 'failed' && status.state !== 'lost') {
    const ready = status.state === 'running' || status.state === 'checking'
    return `Switched to the CPU · WebGPU ${ready ? `ready on ${status.adapter}` : 'compiling its shaders meanwhile'}: the switch or G puts the columns back on it`
  }
  const stages = status.stages.map(stage => {
    const name = `${stage.name} shader`
    if (stage.state === 'compiling') return `compiling the ${name} ${formatSeconds(now - status.since)}…`
    if (stage.state === 'ready') return `${name} ready in ${formatSeconds(stage.ms)}`
    if (stage.state === 'failed') return `${name} failed`
    return `${name} waiting`
  })
  const compiled = formatSeconds(Math.max(0, ...status.stages.map(stage => stage.ms)))
  switch (status.state) {
    case 'writing': return `WebGPU · writing the WGSL ${formatSeconds(now - status.since)}…`
    case 'compiling': return `WebGPU · ${stages.join(' · ')} · the CPU draws meanwhile`
    case 'checking': return `WebGPU · shaders compiled in ${compiled} · checking frames against the CPU's…`
    case 'running': return `WebGPU on ${status.adapter} · shaders compiled in ${compiled} · two frames checked, one overlapped by the next tic's: ${(status.differing ?? 0).toLocaleString('en-US')} of ${status.pixels.toLocaleString('en-US')} pixels differ from the CPU's`
    case 'failed': return `WebGPU failed, so columns and pixels run on the CPU: ${status.error}`
    case 'lost': return 'WebGPU lost its device, so columns and pixels run on the CPU'
  }
}

function formatSeconds(ms: number) {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

function formatBytes(bytes: number) {
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.round(bytes / 1e3)} KB`
}

export function escapeHtml(text: string) {
  return text.replace(/[&<>"]/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[character]!)
}

function formatCount(value: number) {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`
  if (value >= 1e4) return `${Math.round(value / 1e3)}k`
  return value.toLocaleString('en-US')
}
