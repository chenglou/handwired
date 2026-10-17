// Hardware-backed differential gate. Uses Chrome/Edge DevTools without a test framework dependency.
// Run: bun scripts/verify-webgpu-browser.ts
import page from '../assets/handwired-webgpu.html'
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

const server = Bun.serve({hostname: '127.0.0.1', port: 39081, routes: {'/': page}})
const report = process.argv[2] ?? 'webgpu-browser-results.json'
const profile = mkdtempSync(join(tmpdir(), 'handwired-chrome-'))
const binaries = process.platform === 'win32' ? [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
] : process.platform === 'darwin' ? [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
] : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
const preferredBrowser = process.env['HANDWIRED_GPU_BROWSER']
if (preferredBrowser !== undefined && preferredBrowser.length > 0 && !binaries.includes(preferredBrowser)) binaries.unshift(preferredBrowser)
const port = 49381
const requestedVendor = process.env['HANDWIRED_EXPECT_GPU_VENDOR']?.toLowerCase()
let child: ReturnType<typeof Bun.spawn> | undefined
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const browserMode = process.argv[3] === 'benchmark' ? 'benchmark' :
  process.argv[3] === 'probe' ? 'probe' : 'smoke'
const browserUrl = 'http://127.0.0.1:39081/' + (browserMode === 'smoke' ? '?smoke=1' :
  browserMode === 'probe' ? '?probe=1' :
  process.argv[4] === undefined ? '' : '?steps=' + encodeURIComponent(process.argv[4]) +
    (process.argv[5] === undefined ? '' : '&count=' + encodeURIComponent(process.argv[5])))

async function startBrowser(binary: string) {
  const result = Bun.spawn([
    binary, '--headless=new', '--no-first-run', '--disable-extensions', '--disable-gpu-sandbox',
    '--no-sandbox', '--disable-dev-shm-usage',
    ...(process.env['HANDWIRED_GPU_VULKAN'] === '1'
      ? ['--use-angle=vulkan', '--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan,WebGPU', '--use-gl=angle']
      : []),
    ...(process.env['HANDWIRED_GPU_SOFTWARE'] === '1' ? ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] : []),
    '--enable-unsafe-webgpu', '--enable-webgpu-developer-features',
    '--remote-allow-origins=*',
    ...(process.env['HANDWIRED_GPU_EXTRA_FLAGS']?.split(' ').filter(Boolean) ?? []),
    '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank',
  ], {stdout: 'ignore', stderr: 'ignore'})
  for (let attempt = 0; attempt < 45; attempt++) {
    await delay(250)
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/json/list')
      if (response.ok) {
        const pages = await response.json() as {type: string, webSocketDebuggerUrl: string}[]
        const target = pages.find(page => page.type === 'page')
        if (target) return {result, target}
      }
    } catch {}
    if (result.exitCode !== null) break
  }
  result.kill()
  return null
}

async function verify() {
  let target: {type: string, webSocketDebuggerUrl: string} | undefined
  let browser = ''
  for (const binary of binaries) {
    try {
      const response = await startBrowser(binary)
      if (response) {
        child = response.result
        target = response.target
        browser = binary
        break
      }
    } catch { /* Browser executable unavailable; try next installed browser */ }
  }
  if (!target) throw new Error('No browser exposed its DevTools endpoint')
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  const pending = new Map<number, (value: {result?: Record<string, unknown>, error?: unknown}) => void>()
  let sequence = 0
  socket.onmessage = event => {
    const message = JSON.parse(String(event.data)) as {
      id?: number, result?: Record<string, unknown>, error?: unknown
    }
    if (message.id !== undefined) {
      pending.get(message.id)?.(message)
      pending.delete(message.id)
    }
  }
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve()
    socket.onerror = () => reject(new Error('DevTools websocket failed'))
  })
  const command = async (method: string, params: Record<string, unknown> = {}) => {
    const id = ++sequence
    const answer = new Promise<{result?: Record<string, unknown>, error?: unknown}>(resolve => pending.set(id, resolve))
    socket.send(JSON.stringify({id, method, params}))
    const result = await answer
    if (result.error !== undefined && result.error !== null) throw new Error(JSON.stringify(result.error))
    return result.result
  }
  await command('Page.enable')
  await command('Runtime.enable')
  await command('Page.navigate', {url: browserUrl})
  // This check intentionally distinguishes native NVIDIA GPU execution from
  // SwiftShader/llvmpipe; a CUDA GPU listed by nvidia-smi proves neither.
  const adapterResult = await command('Runtime.evaluate', {
    expression: '(async()=>{if(!navigator.gpu)return {error:"navigator.gpu unavailable"};let a=null;for(let i=0;i<6;i++){a=await navigator.gpu.requestAdapter({powerPreference:"high-performance"});if(a)break;await new Promise(r=>setTimeout(r,200));}if(!a)return {error:"no GPU adapter"};return {vendor:a.info.vendor,architecture:a.info.architecture,device:a.info.device,description:a.info.description,isFallbackAdapter:a.isFallbackAdapter??null}})()',
    awaitPromise: true, returnByValue: true,
  })
  const adapterInfo = (adapterResult?.['result'] as {value?: Record<string, unknown>} | undefined)?.value
    ?? {error: 'GPU adapter information could not be read'}
  const adapterLabel = [adapterInfo['vendor'], adapterInfo['architecture'],
    adapterInfo['device'], adapterInfo['description']].join(' ').toLowerCase()
  const suspectedSoftware = adapterInfo['isFallbackAdapter'] === true ||
    /swiftshader|llvmpipe|lavapipe|softpipe|software|subzero|mesa.*cpu/.test(adapterLabel)
  const expectedVendorPresent = requestedVendor === undefined || requestedVendor.length === 0 || adapterLabel.includes(requestedVendor)
  const nativeGpuProven = !suspectedSoftware && expectedVendorPresent &&
    !('error' in adapterInfo) && adapterInfo['vendor'] !== undefined
  console.log('Browser WebGPU adapter:', JSON.stringify(adapterInfo))
  if (browserMode === 'probe') {
    let computeProof: Record<string, unknown> = {}
    try {
      const reply = await command('Runtime.evaluate', {
        expression: '(async()=>{const a=await navigator.gpu.requestAdapter({powerPreference:"high-performance"});const proofInfo={vendor:a.info.vendor,architecture:a.info.architecture,device:a.info.device,description:a.info.description};const d=await a.requestDevice();const u=GPUBufferUsage;const b=d.createBuffer({size:4,usage:u.STORAGE|u.COPY_SRC});const r=d.createBuffer({size:4,usage:u.COPY_DST|u.MAP_READ});const m=d.createShaderModule({code:"@group(0) @binding(0) var<storage,read_write> out:array<f32>; @compute @workgroup_size(1) fn main(){out[0]=42.0;}"});const p=await d.createComputePipelineAsync({layout:"auto",compute:{module:m,entryPoint:"main"}});const group=d.createBindGroup({layout:p.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:b}}]});const e=d.createCommandEncoder();const pass=e.beginComputePass();pass.setPipeline(p);pass.setBindGroup(0,group);pass.dispatchWorkgroups(1);pass.end();e.copyBufferToBuffer(b,0,r,0,4);d.queue.submit([e.finish()]);await r.mapAsync(GPUMapMode.READ);const v=new Float32Array(r.getMappedRange())[0];r.unmap();d.destroy();return {computed:v,valid:v===42,adapterInfo:proofInfo};})()',
        awaitPromise: true, returnByValue: true,
      })
      computeProof = (reply?.['result'] as {value?: Record<string, unknown>} | undefined)?.value
        ?? {error:'compute shader result missing'}
    } catch (error) {computeProof={error:String(error)}}
    const proofAdapter = (computeProof['adapterInfo'] as Record<string, unknown>|undefined) ?? adapterInfo
    const proofLabel=[proofAdapter['vendor'],proofAdapter['architecture'],
      proofAdapter['device'],proofAdapter['description']].join(' ').toLowerCase()
    const proofSoftware=/swiftshader|llvmpipe|lavapipe|softpipe|software|subzero/.test(proofLabel)
    const proofHardware=!proofSoftware && proofLabel.includes(requestedVendor??'nvidia') &&
      typeof proofAdapter['vendor']==='string' && computeProof['valid']===true
    const reportValue={browser,test:'native hardware WebGPU compute probe',adapterInfo:proofAdapter,
      nativeGpuProven:proofHardware,suspectedSoftware:proofSoftware,
      expectedVendor:requestedVendor??null,computeProof,ok:proofHardware}
    writeFileSync(report,JSON.stringify(reportValue,null,2)+'\n')
    console.log(JSON.stringify(reportValue,null,2))
    if(!reportValue.ok)process.exitCode=1
    socket.close()
    return
  }
  let lastStage: string | undefined
  for (let attempt = 0; attempt < 360; attempt++) {
    await delay(350)
    const response = await command('Runtime.evaluate', {
      expression: 'JSON.stringify({status:document.body?.dataset.status, smoke:document.querySelector("#smoke")?.textContent, stage:document.querySelector("#status")?.textContent})',
      returnByValue: true,
    })
    const textValue = (response?.['result'] as {value?: string} | undefined)?.value
    if (textValue === undefined || textValue.length === 0) continue
    const info = JSON.parse(textValue) as {status?: string, smoke?: string, stage?: string}
    lastStage=info.stage
    if (info.status === 'pass' || info.status === 'fail') {
      const details = JSON.parse(info.smoke ?? '{}') as Record<string, unknown>
      const reportValue = {
        browser, test: browserMode === 'smoke' ? 'actual WebGPU mixed-operation differential' : 'GPU/CPU visual-swarm benchmark',
        date: new Date().toISOString(), ...details,
        adapterInfo, suspectedSoftware, expectedVendor: requestedVendor ?? null, nativeGpuProven,
      }
      writeFileSync(report, JSON.stringify(reportValue, null, 2) + '\n')
      if (browserMode === 'benchmark' && process.argv.includes('--screenshot')) {
        const capture = await command('Page.captureScreenshot', {format: 'png', captureBeyondViewport: true})
        const base64 = capture?.['data']
        if (typeof base64 === 'string') {
          writeFileSync(report.replace(/\.json$/, '.png'), Buffer.from(base64, 'base64'))
        }
      }
      console.log(JSON.stringify(reportValue, null, 2))
      socket.close()
      if (info.status !== 'pass' || !expectedVendorPresent || (requestedVendor !== undefined && requestedVendor.length > 0 && !nativeGpuProven)) {
        process.exitCode = 1
      }
      return
    }
  }
  socket.close()
  throw new Error('Browser page did not complete its hardware test; last stage: '+lastStage)
}

try {
  await verify()
} catch (error) {
  const details = {ok: false, error: String(error), date: new Date().toISOString()}
  writeFileSync(report, JSON.stringify(details, null, 2) + '\n')
  console.error(details)
  process.exitCode = 1
} finally {
  child?.kill()
  await server.stop()
  try {rmSync(profile, {recursive: true, force: true})} catch { /* Windows browser file locks */ }
}
