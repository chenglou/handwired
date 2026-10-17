// Loads the Doom page in headless Chrome and reports what it shows: the GPU's compile steps, a few seconds of play, the
// inspector, the switch both ways, every x-ray control and the x-ray on both sides of the switch, then the page's
// console errors, with screenshots along the way. Run it against a running scripts/serve-doom.ts:
//
//   bun scripts/check-doom-page.ts [url] [screenshot folder]
//
// The folder defaults to a new one in the temp folder. CHROME_PATH names Chrome's binary if it isn't at the macOS
// default, and with RELOAD set, the page loads a second time in the same profile, to show what the caches save.
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

const url = process.argv[2] ?? 'http://127.0.0.1:3001/'
const shots = process.argv[3] ?? mkdtempSync(join(tmpdir(), 'doom-shots-'))
mkdirSync(shots, {recursive: true})
const chromePath = process.env['CHROME_PATH'] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const profile = mkdtempSync(join(tmpdir(), 'doom-check-chrome-'))
const chrome = Bun.spawn([chromePath, '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
  '--no-default-browser-check', '--enable-unsafe-webgpu', '--window-size=1460,1180', 'about:blank'], {stdout: 'ignore', stderr: 'ignore'})
// Chrome goes, and its profile with it, some 65 MB of caches that would otherwise pile up in the temp folder run after
// run.
const finish = async (code: number) => {
  chrome.kill('SIGKILL')
  await chrome.exited
  rmSync(profile, {recursive: true, force: true})
  process.exit(code)
}
// Chrome goes too when this script is stopped, e.g. by Ctrl-C, or fails, or it keeps rendering the page in the
// background.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => void finish(130))
for (const event of ['uncaughtException', 'unhandledRejection'] as const) {
  process.on(event, (error: unknown) => {
    console.error(error)
    void finish(1)
  })
}
setTimeout(() => {
  console.error('timed out')
  void finish(1)
}, 300_000)

async function waitFor<T>(check: () => T | undefined | Promise<T | undefined>, timeoutMs = 60_000): Promise<T | undefined> {
  const start = performance.now()
  while (performance.now() - start < timeoutMs) {
    const value = await check()
    if (value !== undefined) return value
    await Bun.sleep(50)
  }
  return undefined
}

const portFile = join(profile, 'DevToolsActivePort')
const port = await waitFor(() => {
  if (!existsSync(portFile)) return undefined
  const line = readFileSync(portFile, 'utf8').split('\n')[0] ?? ''
  return line === '' ? undefined : line
})
const target = await waitFor(async () => {
  const list = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json() as Promise<{type: string, webSocketDebuggerUrl: string}[]>).catch(() => [])
  return list.find(candidate => candidate.type === 'page')
})
if (target === undefined) throw new Error(`Chrome at ${chromePath} showed no page to drive`)
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise(resolve => socket.addEventListener('open', resolve, {once: true}))
let nextId = 1
const pending = new Map<number, {resolve: (result: unknown) => void, reject: (error: Error) => void}>()
const problems: string[] = []
socket.addEventListener('message', message => {
  const data = JSON.parse(String(message.data)) as {id?: number, result?: unknown, error?: {message: string}, method?: string, params?: {type?: string, args?: {value?: unknown, description?: string}[], exceptionDetails?: {text: string, exception?: {description?: string}}}}
  if (data.id !== undefined) {
    const call = pending.get(data.id)
    pending.delete(data.id)
    if (data.error !== undefined) call?.reject(new Error(data.error.message))
    else call?.resolve(data.result)
  } else if (data.method === 'Runtime.consoleAPICalled' && (data.params?.type === 'error' || data.params?.type === 'warning')) {
    problems.push(`console.${data.params.type}: ${(data.params.args ?? []).map(argument => typeof argument.value === 'string' ? argument.value : JSON.stringify(argument.value ?? argument.description)).join(' ')}`)
  } else if (data.method === 'Runtime.exceptionThrown') {
    problems.push(`exception: ${data.params?.exceptionDetails?.exception?.description ?? data.params?.exceptionDetails?.text}`)
  }
})
const send = <Result>(method: string, params: object = {}) => new Promise<Result>((resolve, reject) => {
  const id = nextId++
  pending.set(id, {resolve: result => resolve(result as Result), reject})
  socket.send(JSON.stringify({id, method, params}))
})
const evaluate = async <T>(expression: string) => (await send<{result: {value: T}}>('Runtime.evaluate', {expression, returnByValue: true})).result.value
const screenshot = async (name: string) => {
  const shot = await send<{data: string}>('Page.captureScreenshot', {format: 'png'})
  const file = join(shots, `${name}.png`)
  writeFileSync(file, Buffer.from(shot.data, 'base64'))
  return file
}
// modifiers: 8 for Shift.
const key = (type: 'keyDown' | 'keyUp', code: string, keyCode: number, modifiers = 0) =>
  send('Input.dispatchKeyEvent', {type, code, key: code, windowsVirtualKeyCode: keyCode, modifiers})
const press = async (code: string, keyCode: number, modifiers = 0) => {
  await key('keyDown', code, keyCode, modifiers)
  await key('keyUp', code, keyCode, modifiers)
}
// The GPU's line once it settles: the checks' count, or that the CPU draws.
const settledGpu = (timeoutMs: number) => waitFor(async () => {
  const text = await evaluate<string>(`document.querySelector('#gpu')?.textContent ?? ''`)
  return text.includes('differ') || text.includes('on the CPU') ? text : undefined
}, timeoutMs)

await send('Page.enable')
await send('Runtime.enable')
await send('Page.navigate', {url})
const started = performance.now()
const firstStats = await waitFor(async () => {
  const text = await evaluate<string>(`document.querySelector('#stats')?.textContent ?? ''`)
  return text.includes('fps') ? text : undefined
})
console.log(`first frames after ${((performance.now() - started) / 1000).toFixed(1)} s: ${firstStats ?? 'none'}`)
console.log(`status: ${await evaluate<string>(`document.querySelector('#status').textContent`)}`)
// The GPU's shaders may still be compiling: print each step of the GPU's line until it settles, with its clocks as
// they first read, and take a screenshot of the inspector's WebGPU section while they compile.
await evaluate<void>(`document.querySelector('[data-gpu]')?.scrollIntoView({block: 'center'})`)
const steps: string[] = []
let compilingShot = false
const gpuLine = await waitFor(async () => {
  const text = await evaluate<string>(`document.querySelector('#gpu')?.textContent ?? ''`)
  const step = text.replace(/[\d.]+ (ms|s)/g, '…')
  if (steps[steps.length - 1]?.replace(/[\d.]+ (ms|s)/g, '…') !== step) steps.push(text)
  if (!compilingShot && text.includes('compiling')) {
    compilingShot = true
    console.log(await screenshot('0-compiling'))
  }
  return text.includes('differ') || text.includes('on the CPU') ? text : undefined
}, 90_000)
for (const step of steps.slice(0, -1)) console.log(`gpu, on the way: ${step}`)
console.log(`gpu: ${gpuLine ?? await evaluate<string>(`document.querySelector('#gpu')?.textContent ?? ''`)}`)
console.log(await screenshot('0-compiled'))
await evaluate<void>(`window.scrollTo(0, 0); document.querySelector('#inspector').scrollTop = 0`)
console.log(await screenshot('0-start'))
for (const [name, code, keyCode, ms] of [['1-forward', 'ArrowUp', 38, 1500], ['2-fire', 'ControlLeft', 17, 1200], ['3-turn', 'ArrowRight', 39, 600], ['4-forward', 'ArrowUp', 38, 2000], ['5-idle', 'KeyQ', 81, 4000]] as const) {
  await key('keyDown', code, keyCode)
  await Bun.sleep(ms)
  await key('keyUp', code, keyCode)
  await Bun.sleep(300)
  console.log(`${name}: ${await evaluate<string>(`document.querySelector('#stats').textContent`)}`)
  console.log(await screenshot(name))
}
// Hover a third of the way across the view, which the inspector follows.
const box = await evaluate<{x: number, y: number, width: number, height: number}>(`(() => { const r = document.querySelector('#screen').getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height} })()`)
await send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: box.x + box.width / 3, y: box.y + box.height * 0.4})
await Bun.sleep(1500)
console.log(await screenshot('6-inspect'))
await key('keyDown', 'ArrowLeft', 37)
await Bun.sleep(1400)
await key('keyUp', 'ArrowLeft', 37)
await send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: box.x + box.width * 0.55, y: box.y + box.height * 0.4})
await Bun.sleep(1200)
console.log(await screenshot('7-inspect-turned'))
await evaluate<void>(`document.querySelector('.activations').scrollIntoView({block: 'center'})`)
await Bun.sleep(600)
console.log(await screenshot('8-activations'))
// The switch: G moves the columns to the other side, and a click on the first side's button moves them back.
await evaluate<void>(`window.scrollTo(0, 0); document.querySelector('#inspector').scrollTop = 0`)
const side = await evaluate<string>(`document.querySelector('[data-columns][aria-pressed="true"]')?.dataset.columns ?? ''`)
const readout = () => evaluate<string>(`document.querySelector('#stats').textContent + ' | ' + document.querySelector('#gpu').textContent`)
const columnsOn = (where: string, timeoutMs: number) => waitFor(async () => (await readout()).includes(`columns on the ${where}`) ? true : undefined, timeoutMs)
const other = side === 'GPU' ? 'CPU' : 'GPU'
await press('KeyG', 71)
// To the GPU for the first time, its shaders compile first.
await columnsOn(other, 60_000)
await Bun.sleep(1500)
console.log(`switched from the ${side} with G: ${await readout()}`)
console.log(await screenshot('9-switched'))
await evaluate<void>(`document.querySelector('[data-columns="${side}"]').click()`)
await columnsOn(side, 10_000)
await Bun.sleep(1500)
console.log(`switched back with its button: ${await readout()}`)
console.log(await screenshot('10-switched-back'))
// The x-ray: X shows the unlit texels, then a chapter's button, steps by C and Shift+C, a click on the inspector's
// activations, the sweep, and the x-ray on the other side of the switch. Each prints the x-ray's line and its fps.
// Clicks a named stop's button; its operation, counted from 1 as the x-ray's line counts.
const chapter = (name: string) => evaluate<string>(`(() => { const button = [...document.querySelectorAll('[data-xray-chapters] button')].find(b => b.textContent === '${name}'); button.click(); return String(Number(button.dataset.operation) + 1) })()`)
const xray = () => evaluate<string>(`document.querySelector('[data-xray-operation]').textContent + ' | ' + document.querySelector('[data-xray-range]').textContent + ' | ' + document.querySelector('#stats').textContent`)
const settled = async (operation: string) => {
  // Until a frame of the operation has come: its range shows, or that its values are palette indices.
  await waitFor(async () => {
    const text = await xray()
    const [line = '', range = ''] = text.split(' | ')
    return line.startsWith(`operation ${operation} `) && range !== '' && !range.includes('compiling') && !range.includes('waiting') ? true : undefined
  }, 60_000)
  await Bun.sleep(1200)
}
await press('KeyX', 88)
const unlit = await evaluate<string>(`String(Number([...document.querySelectorAll('[data-xray-chapters] button')].find(b => b.textContent === 'unlit').dataset.operation) + 1)`)
await settled(unlit)
console.log(`x-ray on with X: ${await xray()}`)
console.log(await screenshot('11-xray-unlit'))
await evaluate<void>(`document.querySelector('[data-gpu]').scrollIntoView({block: 'center'})`)
console.log(await screenshot('11-xray-shaders'))
// The probe shader's compile, as the inspector's WebGPU section shows it, while the GPU draws.
console.log(`probe shader: ${await evaluate<string>(`document.querySelector('[data-probe-clock]')?.textContent || 'not compiled on this side'`)}`)
await evaluate<void>(`window.scrollTo(0, 0); document.querySelector('#inspector').scrollTop = 0`)
for (const name of ['search', 'interval', 'depth', 'light', 'lit']) {
  await settled(await chapter(name))
  console.log(`x-ray ${name}: ${await xray()}`)
  console.log(await screenshot(`12-xray-${name}`))
}
await press('KeyC', 67)
await press('KeyC', 67)
await Bun.sleep(600)
console.log(`x-ray after C C: ${await xray()}`)
await press('KeyC', 67, 8)
await Bun.sleep(600)
console.log(`x-ray after Shift+C: ${await xray()}`)
await press('KeyZ', 90, 8)
await Bun.sleep(600)
console.log(`x-ray after Shift+Z: ${await xray()}`)
// A click on the pixel program's values in the inspector, a third of the way across.
await evaluate<void>(`document.querySelector('.activations').scrollIntoView({block: 'center'})`)
await Bun.sleep(300)
const activationBox = await evaluate<{x: number, y: number, width: number, height: number}>(`(() => { const r = document.querySelector('.activations').getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height} })()`)
for (const type of ['mousePressed', 'mouseReleased']) {
  await send('Input.dispatchMouseEvent', {type, x: activationBox.x + activationBox.width / 3, y: activationBox.y + activationBox.height * 0.8, button: 'left', clickCount: 1})
}
await Bun.sleep(1200)
console.log(`x-ray after a click on the activations: ${await xray()}`)
console.log(await screenshot('13-xray-picked'))
await evaluate<void>(`window.scrollTo(0, 0); document.querySelector('#inspector').scrollTop = 0`)
await press('KeyP', 80)
await Bun.sleep(2500)
console.log(`x-ray sweeping: ${await xray()}`)
console.log(await screenshot('14-xray-sweep'))
await press('KeyP', 80)
const xraySide = await evaluate<string>(`document.querySelector('[data-columns][aria-pressed="true"]')?.dataset.columns ?? ''`)
const otherSide = xraySide === 'GPU' ? 'CPU' : 'GPU'
await press('KeyG', 71)
await columnsOn(otherSide, 60_000)
await settled(await chapter('depth'))
console.log(`x-ray with the columns on the ${otherSide}: ${await xray()}`)
console.log(await screenshot('15-xray-other-side'))
await press('KeyG', 71)
await columnsOn(xraySide, 10_000)
await press('KeyX', 88)
await Bun.sleep(1500)
console.log(`x-ray off with X: ${await readout()} | panel hidden: ${await evaluate<boolean>(`document.querySelector('[data-xray]').hidden`)}`)
console.log(await screenshot('16-xray-off'))
// With RELOAD set, load the page again in the same profile, to see what the browser's caches save, e.g. the shader.
if (process.env['RELOAD'] !== undefined) {
  await send('Page.navigate', {url})
  // The old page's context goes with the navigation, so wait for the new one's.
  await Bun.sleep(500)
  const reloaded = await settledGpu(90_000).catch(() => settledGpu(90_000))
  console.log(`after a reload, gpu: ${reloaded ?? 'no line'}`)
}
console.log(problems.length === 0 ? 'no console problems' : problems.join('\n'))
await finish(problems.length === 0 ? 0 : 1)
