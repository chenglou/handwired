import {createLander, flight, type Snapshot, type State} from './lander.ts'

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const canvas = element<HTMLCanvasElement>('flight')
const context = canvas.getContext('2d')!
const chart = element<HTMLCanvasElement>('loss-chart')
const chartContext = chart.getContext('2d')!
const targetInput = element<HTMLInputElement>('target')
const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0]!
const machine = createLander(randomSeed())
const isMachineFinished = () => machine.finished
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
const mint = '#7cf9d1', amber = '#ffc18b'
const launchHold = 1
const contactHold = 0.9
const replayRate = 1.5
let replay = machine.current
let replayTime = 0
let paused = false
let history: Snapshot[] = []
let queue: Snapshot[] = []
let lossHistory: number[] = [replay.loss]
let initialLoss = replay.loss
let previousFrame = 0
let lastSample = 0
let trainingCredit = 0
let width = 0, height = 0
let selectedCommand = 0
type Particle = {x: number, y: number, vx: number, vy: number, life: number, duration: number, size: number, side: boolean}
let particles: Particle[] = []
let exhaustCredit = 0, sideCredit = 0

const parameterElements = Array.from({length: flight.commands}, (_, index) => {
  const command = document.createElement('div')
  command.className = 'command'
  command.tabIndex = 0
  command.innerHTML = `<div class="command-pair"><i class="parameter"></i><i class="parameter vertical"></i></div><span class="command-number">${String(index + 1).padStart(2, '0')}</span>`
  element('parameter-bars').append(command)
  for (const event of ['pointerenter', 'focus', 'click']) command.addEventListener(event, () => {
    selectedCommand = index
    updateParameterReadout()
  })
  return {command, x: command.querySelector<HTMLElement>('.parameter')!, y: command.querySelector<HTMLElement>('.vertical')!}
})
element('operations').textContent = machine.built.stats.operations.toLocaleString()
element('weights').textContent = machine.built.stats.weights.toLocaleString()

function updateParameterReadout() {
  const x = machine.current.parameters[selectedCommand * 2]!
  const y = machine.current.parameters[selectedCommand * 2 + 1]!
  element('parameter-value').textContent = `${String(selectedCommand + 1).padStart(2, '0')} / X ${x >= 0 ? '+' : ''}${x.toFixed(4)} · Y ${y.toFixed(4)}`
}

// Drawing transforms only. The renderer consumes circuit states; it never steps physics.
const horizontalScale = () => (width - 80) / (2 * flight.targetLimit + 4)
const verticalScale = () => (height - 145) / flight.startY
const screenX = (x: number) => width / 2 + x * horizontalScale()
const screenY = (y: number) => height - 62 - y * verticalScale()
function resize() {
  width = canvas.clientWidth
  height = canvas.clientHeight
  const ratio = Math.min(devicePixelRatio || 1, 2)
  for (const surface of [canvas, chart]) {
    surface.width = Math.round(surface.clientWidth * ratio)
    surface.height = Math.round(surface.clientHeight * ratio)
    surface.getContext('2d')!.setTransform(ratio, 0, 0, ratio, 0, 0)
  }
  draw(0)
  drawChart()
}
new ResizeObserver(resize).observe(canvas)

function drawChart() {
  const w = chart.clientWidth, h = chart.clientHeight
  chartContext.clearRect(0, 0, w, h)
  const values = lossHistory.map(value => Math.log10(Math.max(value, 1e-8)))
  const hi = Math.max(...values) + 0.1, lo = Math.min(...values) - 0.1
  chartContext.strokeStyle = '#253a3e'
  chartContext.lineWidth = 1
  for (const y of [h * 0.25, h * 0.75]) {
    chartContext.beginPath(); chartContext.moveTo(0, y); chartContext.lineTo(w, y); chartContext.stroke()
  }
  chartContext.beginPath()
  values.forEach((value, i) => {
    const x = i / Math.max(1, values.length - 1) * w
    const y = h - 4 - (value - lo) / (hi - lo) * (h - 8)
    if (i === 0) chartContext.moveTo(x, y)
    else chartContext.lineTo(x, y)
  })
  chartContext.strokeStyle = mint
  chartContext.lineWidth = 1.5
  chartContext.stroke()
}

function updateTelemetry() {
  const current = machine.current
  const landed = current.outcome.status === 'landed'
  element('loss').textContent = current.loss < 0.001 ? current.loss.toExponential(2) : current.loss.toFixed(3)
  element('iteration').textContent = String(current.iteration).padStart(4, '0')
  element('accuracy').innerHTML = `${current.outcome.error.toFixed(2)} <small>m</small>`
  element('speed').innerHTML = `${current.outcome.speed.toFixed(2)} <small>m/s</small>`
  element('outcome').textContent = current.outcome.status === 'missed' ? 'AIRBORNE' : current.outcome.status.toUpperCase()
  element('outcome').style.color = landed ? mint : amber
  element('training-status').textContent = paused ? 'PAUSED' : machine.error !== null ? 'ERROR' : landed ? 'CONVERGED' : machine.finished ? 'FAILED' : 'TRAINING'
  element('metric-note').textContent = current.outcome.status === 'missed'
    ? 'No ground contact. Error and speed measured at the horizon.'
    : 'Latest trajectory · first ground contact. Replay may be an earlier iteration.'
  element('loss-change').textContent = `${((1 - current.loss / initialLoss) * 100).toFixed(1)}% REDUCTION`
  element('target-value').textContent = `${current.target >= 0 ? '+' : ''}${current.target.toFixed(2)} m`
  targetInput.value = String(current.target)
  const failed = machine.finished && !landed
  element('failure').hidden = !failed
  element('failure').textContent = machine.error ?? 'No safe landing within 5,000 updates. Move the target or try a new seed.'
  for (const [i, parts] of parameterElements.entries()) {
    const x = current.parameters[i * 2]!, y = current.parameters[i * 2 + 1]!
    parts.x.style.height = `${(x + 1) * 50}%`
    parts.y.style.height = `${y * 100}%`
    const label = `Command ${i + 1}: lateral ${x.toFixed(4)}, vertical ${y.toFixed(4)}`
    parts.command.title = label
    parts.command.setAttribute('aria-label', label)
  }
  updateParameterReadout()
  drawChart()
}

function path(snapshot: Snapshot, color: string, opacity: number, dashed = false, until = snapshot.outcome.time) {
  const end = Math.min(Math.max(0, until), snapshot.outcome.time)
  context.save()
  context.beginPath()
  context.rect(0, 45, width, screenY(0) - 45)
  context.clip()
  context.globalAlpha = opacity
  context.strokeStyle = color
  context.lineWidth = dashed ? 1 : 2
  context.lineCap = 'round'
  if (!dashed) { context.shadowColor = color; context.shadowBlur = 9 }
  context.setLineDash(dashed ? [3, 5] : [])
  context.beginPath()
  context.moveTo(screenX(snapshot.states[0]!.x), screenY(snapshot.states[0]!.y))
  const whole = Math.min(snapshot.states.length - 1, Math.floor(end / flight.dt))
  for (let i = 1; i <= whole; i++) {
    const state = snapshot.states[i]!
    context.lineTo(screenX(state.x), screenY(state.y))
  }
  const fraction = end / flight.dt - whole
  if (fraction > 0 && whole + 1 < snapshot.states.length) {
    const a = snapshot.states[whole]!, b = snapshot.states[whole + 1]!
    context.lineTo(screenX(a.x + (b.x - a.x) * fraction), screenY(a.y + (b.y - a.y) * fraction))
  }
  if (end >= snapshot.outcome.time) context.lineTo(screenX(snapshot.outcome.x), screenY(snapshot.outcome.y))
  context.stroke()
  context.restore()
}

function drawParticles(delta: number) {
  context.save()
  context.globalCompositeOperation = 'lighter'
  for (const particle of particles) {
    particle.life -= delta
    particle.x += particle.vx * delta
    particle.y += particle.vy * delta
    const fade = Math.max(0, particle.life / particle.duration)
    context.fillStyle = particle.side ? `rgba(124,249,209,${fade * 0.65})` : `rgba(255,193,139,${fade * 0.75})`
    context.beginPath()
    context.arc(particle.x, particle.y, particle.size * (0.4 + fade * 0.6), 0, Math.PI * 2)
    context.fill()
  }
  context.restore()
  particles = particles.filter(particle => particle.life > 0).slice(-180)
}

function drawRocket(state: State, elapsed: number, active: boolean, delta: number) {
  const x = screenX(state.x), y = screenY(state.y)
  if (!reducedMotion.matches && active && state.ty > 0.04) {
    exhaustCredit += delta * (12 + state.ty * 70)
    const count = Math.min(12, Math.floor(exhaustCredit))
    exhaustCredit -= count
    for (let i = 0; i < count; i++) {
      const duration = 0.28 + Math.random() * 0.4
      particles.push({x: x + (Math.random() - 0.5) * 6, y: y + 3,
        vx: (Math.random() - 0.5) * 35 - state.vx * 5,
        vy: 45 + state.ty * 80 + Math.random() * 50,
        life: duration, duration, size: 1 + Math.random() * 2, side: false})
    }
  } else exhaustCredit = 0
  if (!reducedMotion.matches && active && Math.abs(state.tx) > 0.08) {
    sideCredit += delta * (7 + Math.abs(state.tx) * 35)
    const count = Math.min(8, Math.floor(sideCredit))
    sideCredit -= count
    for (let i = 0; i < count; i++) {
      const duration = 0.18 + Math.random() * 0.3
      particles.push({x: x + (state.tx > 0 ? -7 : 7), y: y - 13 + (Math.random() - 0.5) * 3,
        vx: -Math.sign(state.tx) * (45 + Math.abs(state.tx) * 65),
        vy: (Math.random() - 0.5) * 28,
        life: duration, duration, size: 0.8 + Math.random() * 1.5, side: true})
    }
  } else sideCredit = 0
  context.save()
  context.translate(x, y)
  context.scale(1.12, 1.12)
  // Upright two-axis craft: body angle is fixed, side jets expose lateral control.
  if (active && state.ty > 0.02) {
    const flame = (reducedMotion.matches ? 1 : 0.9 + Math.sin(elapsed * 70) * 0.1) * state.ty
    const gradient = context.createLinearGradient(0, 0, 0, 7 + flame * 28)
    gradient.addColorStop(0, '#fff3cf'); gradient.addColorStop(0.3, amber); gradient.addColorStop(1, '#ffc18b00')
    context.shadowColor = amber; context.shadowBlur = 16
    context.fillStyle = gradient
    context.beginPath(); context.moveTo(-4, -2); context.lineTo(0, 7 + flame * 28); context.lineTo(4, -2); context.fill()
    context.shadowBlur = 0
  }
  if (active && Math.abs(state.tx) > 0.03) {
    const side = state.tx > 0 ? -1 : 1
    const length = 6 + Math.abs(state.tx) * (reducedMotion.matches ? 17 : 16 + Math.sin(elapsed * 65) * 2)
    const jet = context.createLinearGradient(side * 6, -13, side * (6 + length), -13)
    jet.addColorStop(0, '#dffff4'); jet.addColorStop(0.4, mint); jet.addColorStop(1, '#7cf9d100')
    context.fillStyle = jet
    context.beginPath(); context.moveTo(side * 6, -15); context.lineTo(side * (6 + length), -13)
    context.lineTo(side * 6, -11); context.fill()
  }
  context.shadowColor = '#7cf9d140'; context.shadowBlur = 12
  context.fillStyle = '#d8e7e4'; context.strokeStyle = '#7a9f9c'; context.lineWidth = 1
  context.beginPath(); context.moveTo(0, -29); context.quadraticCurveTo(7, -23, 6, -8)
  context.lineTo(10, -1); context.lineTo(5, -1); context.lineTo(3, -5); context.lineTo(-3, -5)
  context.lineTo(-5, -1); context.lineTo(-10, -1); context.lineTo(-6, -8)
  context.quadraticCurveTo(-7, -23, 0, -29); context.fill(); context.stroke()
  context.shadowBlur = 0; context.fillStyle = '#133b40'; context.beginPath(); context.arc(0, -19, 3, 0, Math.PI * 2); context.fill()
  context.strokeStyle = '#5d8e8c'; context.beginPath(); context.moveTo(-5, -9); context.lineTo(5, -9); context.stroke()
  context.restore()
}

function draw(delta: number) {
  if (!width) return
  context.clearRect(0, 0, width, height)
  const ground = screenY(0)
  const time = Math.min(Math.max(0, (replayTime - launchHold) * replayRate), replay.outcome.time)
  const glow = context.createRadialGradient(screenX(machine.current.target), ground, 0, screenX(machine.current.target), ground, width * 0.55)
  glow.addColorStop(0, '#133c3a44'); glow.addColorStop(1, '#0a111600')
  context.fillStyle = glow; context.fillRect(0, 0, width, height)
  // Stable decorative stars/grid, unrelated to model randomness.
  for (let i = 0; i < 45; i++) {
    const x = ((i * 137.51) % width), y = 45 + (i * 71.73) % Math.max(1, ground - 60)
    const shimmer = reducedMotion.matches ? 0.4 : 0.35 + 0.2 * Math.sin(replayTime * 1.5 + i * 1.7)
    context.fillStyle = `rgba(105,137,141,${i % 4 === 0 ? shimmer : shimmer * 0.4})`
    context.fillRect(x, y, 1, 1)
  }
  context.font = '8px monospace'; context.fillStyle = '#536b73'; context.strokeStyle = '#1c2d34'; context.lineWidth = 0.5
  for (let altitude = 0; altitude <= flight.startY; altitude += 2) {
    const y = screenY(altitude)
    context.setLineDash([2, 7]); context.beginPath(); context.moveTo(44, y); context.lineTo(width - 22, y); context.stroke()
    context.fillText(`${String(altitude).padStart(2, '0')} m`, 14, y + 3)
  }
  context.setLineDash([])
  history.forEach((snapshot, i) => path(snapshot, '#698b91', 0.1 + i / Math.max(1, history.length) * 0.22, true))
  path(replay, mint, 0.2, true)
  if (time > 0) path(replay, mint, 0.85, false, time)
  const launch = replay.states[0]!
  context.fillStyle = '#789691'
  context.fillText(`LAUNCH ${launch.y.toFixed(0)} M`, screenX(launch.x) + 17, screenY(launch.y) - 17)
  // Ground and platform: contact classification uses y=0 at the rocket's feet.
  context.fillStyle = '#0d191f'; context.fillRect(0, ground + 1, width, height - ground)
  context.strokeStyle = '#2c444b'; context.beginPath(); context.moveTo(0, ground); context.lineTo(width, ground); context.stroke()
  for (let x = 0; x < width; x += 18) {
    context.strokeStyle = '#223239'; context.beginPath(); context.moveTo(x, ground + 5); context.lineTo(x - 6, ground + 11); context.stroke()
  }
  const platformX = screenX(machine.current.target), platformWidth = Math.max(30, horizontalScale() * 1.3)
  context.shadowColor = mint; context.shadowBlur = 16; context.fillStyle = mint
  context.fillRect(platformX - platformWidth / 2, ground - 2, platformWidth, 3)
  context.shadowBlur = 0; context.strokeStyle = '#7cf9d166'; context.lineWidth = 1
  context.beginPath(); context.moveTo(platformX - 4, ground + 20); context.lineTo(platformX, ground + 16); context.lineTo(platformX + 4, ground + 20); context.stroke()
  context.fillStyle = mint; context.textAlign = 'center'; context.fillText('LANDING TARGET', platformX, ground + 33); context.textAlign = 'left'
  const index = Math.min(replay.states.length - 2, Math.floor(time / flight.dt))
  const a = replay.states[index]!, b = replay.states[index + 1]!
  const fraction = Math.min(1, (time - index * flight.dt) / flight.dt)
  const state = {...b, x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction}
  const ended = time >= replay.outcome.time
  if (ended) { state.x = replay.outcome.x; state.y = replay.outcome.y }
  const visible = screenX(state.x) > 5 && screenX(state.x) < width - 5 && screenY(state.y) > 72
  drawParticles(delta)
  if (visible) drawRocket(state, time, !ended, delta)
  else {
    context.fillStyle = amber; context.textAlign = 'center'
    context.fillText('TRAJECTORY OUT OF VIEW', width / 2, 65); context.textAlign = 'left'
  }
  if (ended && replay.outcome.status !== 'missed') {
    context.strokeStyle = replay.outcome.status === 'landed' ? mint : amber
    context.globalAlpha = 0.5; context.beginPath(); context.ellipse(screenX(state.x), ground, 17, 5, 0, 0, Math.PI * 2); context.stroke(); context.globalAlpha = 1
    const impactAge = replayTime - launchHold - replay.outcome.time / replayRate
    if (!reducedMotion.matches && impactAge >= 0 && impactAge < 0.8) {
      context.globalAlpha = (1 - impactAge / 0.8) * 0.65
      context.lineWidth = 2
      context.beginPath()
      context.ellipse(screenX(state.x), ground, 17 + impactAge * 48, 5 + impactAge * 15, 0, 0, Math.PI * 2)
      context.stroke()
      context.globalAlpha = 1
    }
  }
  element('replay-iteration').textContent = String(replay.iteration).padStart(4, '0')
  element('replay-status').textContent = replay.iteration === 0 && !ended ? 'RANDOM INITIALIZATION' : ended ? replay.outcome.status.toUpperCase() : 'SIMULATED FLIGHT'
  element('replay-status').style.color = ended && replay.outcome.status !== 'landed' ? amber : '#81939a'
  element('flight-time').textContent = `T + ${time.toFixed(2)} s`
}

function restartDisplay(snapshot: Snapshot) {
  replay = snapshot; replayTime = 0; queue = []; history = []; particles = []
  exhaustCredit = 0; sideCredit = 0
  lossHistory = [snapshot.loss]; initialLoss = snapshot.loss; lastSample = 0; trainingCredit = 0
  updateTelemetry(); draw(0)
}
function retarget(value: number) {
  if (Math.abs(value - machine.current.target) < 0.001) return
  restartDisplay(machine.setTarget(value))
}
targetInput.addEventListener('input', () => retarget(Number(targetInput.value)))
let dragging: number | null = null
const targetAt = (event: PointerEvent) => Math.max(-8, Math.min(8, (event.clientX - canvas.getBoundingClientRect().left - width / 2) / horizontalScale()))
canvas.addEventListener('pointerdown', event => {
  const rect = canvas.getBoundingClientRect()
  if (Math.abs(event.clientY - rect.top - screenY(0)) > 35 || Math.abs(event.clientX - rect.left - screenX(machine.current.target)) > 40) return
  dragging = event.pointerId; canvas.setPointerCapture(event.pointerId); canvas.classList.add('dragging'); event.preventDefault()
})
canvas.addEventListener('pointermove', event => { if (event.pointerId === dragging) retarget(targetAt(event)) })
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, () => { dragging = null; canvas.classList.remove('dragging') })
element('pause').addEventListener('click', () => {
  paused = !paused; element('pause').textContent = paused ? '▶ Resume' : 'Ⅱ Pause'
  element('pause').setAttribute('aria-pressed', String(paused)); updateTelemetry()
})
element('reset').addEventListener('click', () => restartDisplay(machine.reset(randomSeed())))
document.addEventListener('visibilitychange', () => {
  previousFrame = 0; trainingCredit = 0
  if (!document.hidden) {
    replayTime = 0; particles = []; exhaustCredit = 0; sideCredit = 0
    draw(0)
  }
})

function frame(now: number) {
  const delta = previousFrame === 0 ? 0 : Math.min(0.05, (now - previousFrame) / 1000)
  previousFrame = now
  if (!paused && !document.hidden) {
    trainingCredit = Math.min(8, trainingCredit + delta * 120)
    const deadline = performance.now() + 4
    let changed = false
    while (trainingCredit >= 1 && performance.now() < deadline && !isMachineFinished()) {
      machine.step(); trainingCredit--; changed = true
      if (machine.current.iteration - lastSample >= 24 || isMachineFinished()) {
        lastSample = machine.current.iteration
        queue.push(machine.current)
        // Keep early failures and the latest solution, with bounded replay memory.
        if (queue.length > 5) queue.splice(3, 1)
      }
    }
    if (changed) {
      lossHistory.push(machine.current.loss)
      if (lossHistory.length > 600) lossHistory.splice(1, 1)
      if (machine.finished && queue.length > 0) {
        // Show an early real attempt, then the final result without a long replay backlog.
        queue = queue[0] === machine.current ? [machine.current] : [queue[0]!, machine.current]
      }
      updateTelemetry()
    }
    replayTime += delta
    if (replayTime > launchHold + replay.outcome.time / replayRate + contactHold) {
      if (queue.length > 0 || replay.iteration !== machine.current.iteration) {
        history.push(replay); if (history.length > 8) history.shift()
        replay = queue.shift() ?? machine.current
      }
      replayTime = 0; particles = []; exhaustCredit = 0; sideCredit = 0
    }
    draw(delta)
  }
  requestAnimationFrame(frame)
}
updateTelemetry()
requestAnimationFrame(frame)
