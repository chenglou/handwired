import {Circuit} from '../src/runtime/numeric-ui-core.ts'
import {createWebGpuEvaluator} from '../src/runtime/webgpu.ts'

const requestedCount = Number(new URLSearchParams(location.search).get('count') ?? 8192)
const count = Number.isSafeInteger(requestedCount) && requestedCount >= 1 && requestedCount <= 8192
  ? requestedCount : 8192
const canvas = document.querySelector<HTMLCanvasElement>('#swarm')!
const context = canvas.getContext('2d')!
const status = document.querySelector<HTMLElement>('#status')!
const results = document.querySelector<HTMLElement>('#results')!
const runButton = document.querySelector<HTMLButtonElement>('#run')!
const smoke = document.querySelector<HTMLElement>('#smoke')!
const circuit = new Circuit(4)
const x = circuit.source(0), y = circuit.source(1)
const vx = circuit.source(2), vy = circuit.source(3)
const xNext = circuit.roundAffine([[x, 1], [vx, 0.016]])
const yNext = circuit.roundAffine([[y, 1], [vy, 0.016]])
const forceX = circuit.roundAffine([[xNext, -0.07]], 0.035)
const forceY = circuit.roundAffine([[yNext, -0.07]], 0.035)
const vxNext = circuit.roundAffine([[vx, 0.997], [forceX, 0.016]])
const vyNext = circuit.roundAffine([[vy, 0.997], [forceY, 0.016]])
const state = [
  {source: 0, from: xNext}, {source: 1, from: yNext},
  {source: 2, from: vxNext}, {source: 3, from: vyNext},
]
const width = circuit.sourceSize + circuit.operations.length
const sources = new Float32Array(count * circuit.sourceSize)
let seed = 27
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) | 0
  return (seed >>> 0) / 4294967296
}
for (let i = 0; i < count; i++) {
  const theta = random() * 6.283185307179586
  const r = Math.sqrt(random()) * 0.36
  sources.set([0.5 + Math.cos(theta) * r, 0.5 + Math.sin(theta) * r,
    (random() - 0.5) * 0.32, (random() - 0.5) * 0.32], i * 4)
}

function draw(cpu: Float32Array, gpu: Float32Array) {
  context.fillStyle = '#091326'
  context.fillRect(0, 0, canvas.width, canvas.height)
  for (const [values, left, color] of [[cpu, 0, '#51dcdf'], [gpu, canvas.width / 2, '#e5b8ff']] as const) {
    context.fillStyle = color
    for (let i = 0; i < count; i++) {
      const at = i * width
      const px = left + 18 + ((values[at + xNext] ?? 0) * (canvas.width / 2 - 36))
      const py = 14 + ((values[at + yNext] ?? 0) * (canvas.height - 28))
      context.fillRect(px, py, 1.5, 1.5)
    }
  }
  context.fillStyle = '#e8f0ff'
  context.font = '600 17px system-ui'
  context.fillText('CPU Reference', 20, 30)
  context.fillText('WebGPU Circuit', canvas.width / 2 + 20, 30)
}

// Independent, hand-written implementation of the same six-operation circuit.
// Its FP32 steps intentionally mirror the documented reference arithmetic.
function handwrittenJavaScript(input: Float32Array, steps: number): Float32Array {
  const output = new Float32Array(count * width)
  const f = Math.fround
  const timeStep = f(0.016), drag = f(0.997), stiffness = f(-0.07), center = f(0.035)
  for (let i = 0; i < count; i++) {
    const at = i * 4
    let px = input[at]!, py = input[at + 1]!
    let velocityX = input[at + 2]!, velocityY = input[at + 3]!
    for (let step = 0; step < steps; step++) {
      const xValue = f(f(px) + f(timeStep * velocityX))
      const yValue = f(f(py) + f(timeStep * velocityY))
      const forceXValue = f(center + f(stiffness * xValue))
      const forceYValue = f(center + f(stiffness * yValue))
      const vxValue = f(f(drag * velocityX) + f(timeStep * forceXValue))
      const vyValue = f(f(drag * velocityY) + f(timeStep * forceYValue))
      if (step === steps - 1) {
        const offset = i * width
        output.set([px, py, velocityX, velocityY,
          xValue, yValue, forceXValue, forceYValue, vxValue, vyValue], offset)
      }
      px = xValue
      py = yValue
      velocityX = vxValue
      velocityY = vyValue
    }
  }
  return output
}

async function compare() {
  runButton.disabled = true
  status.textContent = 'Running independent CPU and WebGPU executions...'
  const steps = Number(new URLSearchParams(location.search).get('steps')
    ?? document.querySelector<HTMLSelectElement>('#steps')!.value)
  // Chrome headless + Vulkan may expose the physical adapter on one request
  // and return null on a subsequent independent request. Share one device
  // across the three Handwired strategies and independent GPU baseline.
  let adapter:GPUAdapter|null=null
  for(let attempt=0;attempt<6;attempt++){
    adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'})
    if(adapter)break
    await new Promise(resolve=>setTimeout(resolve,200))
  }
  if(!adapter)throw new Error('No benchmark WebGPU adapter')
  const device=await adapter.requestDevice()
  const cpu = await createWebGpuEvaluator(circuit, {mode: 'cpu', capacity: count})
  const beganCpu = performance.now()
  const cpuValues = await cpu.evaluate(sources, {steps, stateUpdates: state})
  const cpuMs = performance.now() - beganCpu
  cpu.destroy()
  const beganJs = performance.now()
  const jsValues = handwrittenJavaScript(sources, steps)
  const jsMs = performance.now() - beganJs

  const startedGpuInit = performance.now()
  status.textContent='GPU monolithic: compiling and executing'
  const gpu = await createWebGpuEvaluator(circuit, {mode: 'gpu', device, capacity: count})
  const gpuInitMs = performance.now() - startedGpuInit
  const beganGpu = performance.now()
  const gpuValues = await gpu.evaluate(sources, {steps, stateUpdates: state})
  const gpuMs = performance.now() - beganGpu
  gpu.destroy()
  const startedLayerInit = performance.now()
  status.textContent='GPU dependency layers: compiling and executing'
  const layered = await createWebGpuEvaluator(circuit, {mode: 'gpu', device, capacity: count, strategy: 'layers'})
  const layeredInitMs = performance.now() - startedLayerInit
  const beganLayered = performance.now()
  const layeredValues = await layered.evaluate(sources, {steps, stateUpdates: state})
  const layeredMs = performance.now() - beganLayered
  const layerCount = layered.layerCount
  layered.destroy()
  const specializedStartInit = performance.now()
  status.textContent='GPU specialized: compiling and executing'
  const specialized = await createWebGpuEvaluator(circuit,
    {mode:'gpu',device,capacity:count,strategy:'specialized'})
  const specializedInitMs = performance.now()-specializedStartInit
  const startedSpecialized = performance.now()
  const specializedValues = await specialized.evaluate(sources,{steps,stateUpdates:state})
  const specializedMs = performance.now()-startedSpecialized
  specialized.destroy()
  const {HandwrittenSwarmGpu}=await import('../src/runtime/webgpu-handwritten-baseline.ts')
  const nativeDevice=device
  const nativeInitAt=performance.now()
  status.textContent='Independent handwritten WebGPU baseline: compiling and executing'
  const nativeGpu=await HandwrittenSwarmGpu.create(nativeDevice,count)
  const nativeGpuInitMs=performance.now()-nativeInitAt
  const nativeStarted=performance.now()
  const nativeValues=await nativeGpu.evaluate(sources,steps)
  const nativeGpuMs=performance.now()-nativeStarted
  nativeGpu.destroy()
  nativeDevice.destroy()
  let mismatches = 0, maxDifference = 0, jsMismatches = 0, handwrittenGpuMismatches=0
  for (let i = 0; i < gpuValues.length; i++) {
    const difference = Math.abs(cpuValues[i]! - gpuValues[i]!)
    const layerDifference = Math.abs(cpuValues[i]! - layeredValues[i]!)
    const specializedDifference = Math.abs(cpuValues[i]! - specializedValues[i]!)
    const handwrittenGpuDifference=Math.abs(cpuValues[i]! - nativeValues[i]!)
    if(handwrittenGpuDifference>0.00002)handwrittenGpuMismatches++
    const jsDifference = Math.abs(cpuValues[i]! - jsValues[i]!)
    if (jsDifference > 0.00002) jsMismatches++
    if (difference > 0.00002 || layerDifference > 0.00002 || specializedDifference > 0.00002) mismatches++
    maxDifference = Math.max(maxDifference, difference, layerDifference, specializedDifference)
  }
  status.textContent='Rendering and checking all GPU baselines'
  draw(cpuValues, gpuValues)
  results.textContent = 'Particles: ' + count.toLocaleString()
    + ' · Steps: ' + steps + ' · CPU: ' + cpuMs.toFixed(2) + ' ms'
    + ' · Handwritten JS: ' + jsMs.toFixed(2) + ' ms'
    + ' · GPU (including upload + readback): ' + gpuMs.toFixed(2) + ' ms'
    + ' · Layers: ' + layeredMs.toFixed(2) + ' ms (' + layerCount + ' layers)'
    + ' · Specialized: ' + specializedMs.toFixed(2) + ' ms'
    + ' · Handwritten GPU: ' + nativeGpuMs.toFixed(2) + ' ms'
    + ' · Monolithic speedup: ' + (cpuMs / gpuMs).toFixed(2) + '×'
    + ' · GPU mismatches (>2e-5): ' + mismatches
    + ' · JS mismatches: ' + jsMismatches
    + ' · Maximum error: ' + maxDifference.toExponential(2)
  status.textContent = 'Both sides use exactly the same Handwired circuit.'
  smoke.textContent = JSON.stringify({ok: mismatches === 0, samples: count, steps,
    cpuMs, jsMs, gpuMs, layeredMs, specializedMs, gpuInitMs, layeredInitMs, specializedInitMs,
    layerCount, nativeGpuMs, nativeGpuInitMs, handwrittenGpuMismatches,
    speedup: cpuMs / gpuMs,
    layeredSpeedup: cpuMs / layeredMs, mismatches, jsMismatches, maxDifference})
  document.body.dataset.status = mismatches === 0 && jsMismatches === 0 && handwrittenGpuMismatches===0 ? 'pass' : 'fail'
  runButton.disabled = false
}

async function smokeTest() {
  document.body.dataset.debug = 'true'
  const test = new Circuit(5)
  const a = test.source(0), b = test.source(1)
  const gate = test.source(2), index = test.source(3), score = test.source(4)
  test.assumeRange(gate, 0, 1)
  test.assumeRange(index, -2, 5)
  test.assumeRange(score, 0, 1)
  const sum = test.roundAffine([[a, 0.1], [b, 0.2]], 0.3)
  const relu = test.reglu([[sum, 1]], 0, [[gate, 1]], 0)
  const bit = test.boolean(score)
  const read = test.indexReadAffine([[index, 1]], 0, [a, b, relu, bit], 'zero', 'clamp')
  test.roundAffine([[read, 1], [sum, -1]], 2)
  const data = new Float32Array(512 * 5)
  for (let i = 0; i < 512; i++) {
    data.set([i / 12 - 2, 2 - i / 19, i % 3 / 2, (i % 8) - 2, (i % 7 === 0 ? 0.5 : i % 4 / 3)], i * 5)
  }
  const adapter = await navigator.gpu?.requestAdapter()
  if (!adapter) throw new Error('No WebGPU adapter')
  const device = await adapter.requestDevice()
  const backend = await createWebGpuEvaluator(test, {mode: 'gpu', device, capacity: 512})
  let mismatches = 0, maxError = 0
  let stateMismatches = 0, stateMaxError = 0
  try {
    const values = await backend.evaluate(data)
    const countPerSample = test.sourceSize + test.operations.length
    for (let i = 0; i < 512; i++) {
      const expected = test.evaluateReference(data.subarray(i * 5, (i + 1) * 5))
      for (let w = 0; w < expected.length; w++) {
        const actual = values[i * countPerSample + w]!
        const err = Math.abs(actual - expected[w]!)
        maxError = Math.max(maxError, err)
        if (!Number.isFinite(actual) || err > 0.00002) mismatches++
      }
    }
    backend.load(data)
    await backend.run(5, [{source: 0, from: sum}])
    const stepped = await backend.readValues()
    for (let i = 0; i < 512; i++) {
      const source = data.slice(i * 5, (i + 1) * 5)
      let reference = test.evaluateReference(source)
      for (let step = 1; step < 5; step++) {
        source[0] = reference[sum]!
        reference = test.evaluateReference(source)
      }
      for (let w = 0; w < reference.length; w++) {
        const actual = stepped[i * countPerSample + w]!
        const err = Math.abs(actual - reference[w]!)
        stateMaxError = Math.max(stateMaxError, err)
        if (!Number.isFinite(actual) || err > 0.00002) stateMismatches++
      }
    }
  } finally {
    backend.destroy()
  }
  let layerMismatches = 0, layerStateMismatches = 0
  const layerBackend = await createWebGpuEvaluator(test, {mode: 'gpu', device, capacity: 512, strategy: 'layers'})
  try {
    const layerValues = await layerBackend.evaluate(data)
    const width = test.sourceSize + test.operations.length
    for (let i = 0; i < 512; i++) {
      const reference = test.evaluateReference(data.subarray(i * 5, (i + 1) * 5))
      for (let w = 0; w < width; w++) {
        if (!Number.isFinite(layerValues[i * width + w]!) ||
          Math.abs(layerValues[i * width + w]! - reference[w]!) > 0.00002) layerMismatches++
      }
    }
    layerBackend.load(data)
    await layerBackend.run(5, [{source: 0, from: sum}])
    const stepped = await layerBackend.readValues()
    for (let i = 0; i < 512; i++) {
      const source = data.slice(i * 5, (i + 1) * 5)
      let reference = test.evaluateReference(source)
      for (let step = 1; step < 5; step++) {
        source[0] = reference[sum]!
        reference = test.evaluateReference(source)
      }
      for (let w = 0; w < width; w++) {
        if (!Number.isFinite(stepped[i * width + w]!) ||
          Math.abs(stepped[i * width + w]! - reference[w]!) > 0.00002) layerStateMismatches++
      }
    }
  } finally {
    layerBackend.destroy()
  }
  // Circuit-specialized WGSL must agree with the original reference and state updates.
  let specializedMismatches=0, specializedStateMismatches=0
  const specializedBackend=await createWebGpuEvaluator(test,{mode:'gpu',device,capacity:512,strategy:'specialized'})
  try{
    const vals=await specializedBackend.evaluate(data)
    const width=test.sourceSize+test.operations.length
    for(let i=0;i<512;i++){
      const expected=test.evaluateReference(data.subarray(i*5,(i+1)*5))
      for(let j=0;j<width;j++)if(!Number.isFinite(vals[i*width+j]!) ||
        Math.abs(vals[i*width+j]!-expected[j]!)>0.00002)specializedMismatches++
    }
    specializedBackend.load(data)
    await specializedBackend.run(5,[{source:0,from:sum}])
    const valsState=await specializedBackend.readValues()
    for(let i=0;i<512;i++){
      const source=data.slice(i*5,(i+1)*5)
      let expected=test.evaluateReference(source)
      for(let step=1;step<5;step++){
        source[0]=expected[sum]!
        expected=test.evaluateReference(source)
      }
      for(let j=0;j<width;j++)if(!Number.isFinite(valsState[i*width+j]!) ||
        Math.abs(valsState[i*width+j]!-expected[j]!)>0.00002)specializedStateMismatches++
    }
  }finally{specializedBackend.destroy()}
  // Integrate with an unmodified, actual HandwiredOS application circuit:
  // 800 operations in 67 dependency layers at the checked-in baseline.
  const {createValueListCircuit} = await import('../src/handwiredos/value-list.ts')
  const integrated = createValueListCircuit()
  const integratedSource = Float32Array.from(integrated.initialSource)
  const integratedExpected = integrated.circuit.evaluateReference(integratedSource)
  let integratedMismatches = 0, integratedBitMismatches = 0, integratedMaxError = 0
  let integratedLayerCount = 0
  for (const strategy of ['monolithic', 'layers', 'specialized'] as const) {
    const realEvaluator = await createWebGpuEvaluator(integrated.circuit, {
      mode: 'gpu', device, capacity: 1, strategy,
    })
    try {
      integratedLayerCount = realEvaluator.layerCount
      const actual = await realEvaluator.evaluate(integratedSource)
      for (let i = 0; i < integratedExpected.length; i++) {
        const expected = integratedExpected[i]!, got = actual[i]!
        if (!Object.is(expected, got)) integratedBitMismatches++
        const difference = Math.abs(expected - got)
        if (Number.isFinite(difference)) integratedMaxError = Math.max(integratedMaxError, difference)
        if (!(Object.is(expected, got) ||
          (Number.isFinite(difference) && difference <= 0.0001))) integratedMismatches++
      }
    } finally {
      realEvaluator.destroy()
    }
  }
  // Second unmodified application: photo gallery, including its boolean atoms.
  const {createPhotoGalleryCircuit} = await import('../src/handwiredos/photo-gallery.ts')
  const gallery = createPhotoGalleryCircuit()
  const gallerySource = Float32Array.from(gallery.initialSource)
  const galleryExpected = gallery.circuit.evaluateReference(gallerySource)
  let galleryMismatches = 0, galleryBitMismatches = 0, galleryMaxError = 0
  const galleryMismatchExamples: {strategy:string,wire:number,kind:string,expected:string,actual:string}[]=[]
  let galleryCachedBitMismatches=0, galleryCachedMismatches=0
  let galleryLayerCount = 0
  for (const strategy of ['monolithic', 'layers', 'specialized'] as const) {
    const galleryEvaluator = await createWebGpuEvaluator(gallery.circuit, {
      mode: 'gpu', device, capacity: 1, strategy,
    })
    try {
      galleryLayerCount = galleryEvaluator.layerCount
      const actual = await galleryEvaluator.evaluate(gallerySource)
      for (let i = 0; i < galleryExpected.length; i++) {
        const expected = galleryExpected[i]!, got = actual[i]!
        if (!Object.is(expected, got)) galleryBitMismatches++
        const difference = Math.abs(expected - got)
        if (Number.isFinite(difference)) galleryMaxError = Math.max(galleryMaxError, difference)
        if (!(Object.is(expected, got) ||
          (Number.isFinite(difference) && difference <= 0.0001))) {
          galleryMismatches++
          if (galleryMismatchExamples.length < 16) galleryMismatchExamples.push({
            strategy,wire:i,kind:i<gallery.circuit.sourceSize?'source':
              gallery.circuit.operations[i-gallery.circuit.sourceSize]?.kind??'unknown',
            expected:String(expected),actual:String(got),
          })
        }
      }
    } finally {
      galleryEvaluator.destroy()
    }
  }
  const startedWarmCache=performance.now()
  const cachedGallery=await createWebGpuEvaluator(gallery.circuit,{mode:'gpu',device,capacity:1,strategy:'specialized'})
  const cachedGalleryInitMs=performance.now()-startedWarmCache
  const galleryCacheHit=cachedGallery.specializedCacheHit
  try{
    const cachedResult=await cachedGallery.evaluate(gallerySource)
    for(let i=0;i<galleryExpected.length;i++){
      const actual=cachedResult[i]!,expected=galleryExpected[i]!
      if(!Object.is(actual,expected)){
        galleryCachedBitMismatches++
        const difference=Math.abs(actual-expected)
        if(galleryMismatchExamples.length<16)galleryMismatchExamples.push({
          strategy:'specialized-cached',wire:i,
          kind:i<gallery.circuit.sourceSize?'source':
            gallery.circuit.operations[i-gallery.circuit.sourceSize]?.kind??'unknown',
          expected:Object.is(expected,-0)?'-0':String(expected),
          actual:Object.is(actual,-0)?'-0':String(actual),
        })
        if(!(Number.isFinite(difference)&&difference<=0.0001)){
          galleryMismatches++
          galleryCachedMismatches++
        }
      }
    }
  }finally{cachedGallery.destroy()}
  const {createGridStencil}=await import('../src/runtime/webgpu-grid.ts')
  const weights={center:0.40,left:0.10,right:0.10,up:0.10,down:0.10,
    upLeft:0.05,upRight:0.05,downLeft:0.05,downRight:0.05}
  let gridMismatches=0,gridMaxError=0
  for(const boundary of ['clamp','wrap','zero'] as const){
    const opts={width:31,height:17,channels:3,boundary,weights}
    const sample=Float32Array.from({length:31*17*3},(_,i)=>Math.fround(Math.sin(i*0.037)*3))
    const gridCpu=await createGridStencil({...opts,mode:'cpu'})
    const gridGpu=await createGridStencil({...opts,mode:'gpu',device})
    try{
      gridCpu.load(sample);gridGpu.load(sample)
      await gridCpu.step(7);await gridGpu.step(7)
      const a=await gridCpu.read(),b=await gridGpu.read()
      for(let i=0;i<a.length;i++){
        const diff=Math.abs(a[i]!-b[i]!)
        gridMaxError=Math.max(gridMaxError,diff)
        if(!Number.isFinite(b[i]!)||diff>0.00001)gridMismatches++
      }
    }finally{gridCpu.destroy();gridGpu.destroy()}
  }
  const {measureFp32Edges}=await import('./webgpu-numeric-probe.ts')
  const fp32Edges=await measureFp32Edges(device)
  let fallbackAdapterName:string|null=null
  let fallbackAdapterMismatches=0
  try{
    const fallback=await navigator.gpu?.requestAdapter({forceFallbackAdapter:true})
    if(fallback){
      fallbackAdapterName=fallback.info?.description||fallback.info?.vendor||'fallback'
      const fallbackDevice=await fallback.requestDevice()
      try{
        for(const strategy of ['monolithic','layers','specialized'] as const){
          const backend=await createWebGpuEvaluator(test,
            {mode:'gpu',device:fallbackDevice,strategy,capacity:512})
          try{
            const vals=await backend.evaluate(data),stride=test.sourceSize+test.operations.length
            for(let i=0;i<512;i++){
              const ref=test.evaluateReference(data.subarray(i*5,(i+1)*5))
              for(let j=0;j<stride;j++)if(!Number.isFinite(vals[i*stride+j]!) ||
                Math.abs(vals[i*stride+j]!-ref[j]!)>0.00002)fallbackAdapterMismatches++
            }
          }finally{backend.destroy()}
        }
      }finally{fallbackDevice.destroy()}
    }
  }catch(error){fallbackAdapterName='unavailable: '+String(error)}
  const doomed = await createWebGpuEvaluator(test, {mode: 'gpu', device, capacity: 512})
  doomed.load(data)
  device.destroy()
  await device.lost
  let deviceLossCaught = false
  try {
    await doomed.run()
  } catch (error) {
    deviceLossCaught = String(error).includes('device lost')
  } finally {
    doomed.destroy()
  }
  const info = {ok: mismatches === 0 && stateMismatches === 0 && layerMismatches === 0
    && layerStateMismatches === 0 && integratedMismatches === 0 && galleryMismatches === 0
    && deviceLossCaught && specializedMismatches===0 && specializedStateMismatches===0
    && gridMismatches===0 && fallbackAdapterMismatches===0 && galleryCacheHit,
    specializedMismatches,specializedStateMismatches,gridMismatches,gridMaxError,
    fp32Edges,fallbackAdapterName,fallbackAdapterMismatches,galleryCacheHit,cachedGalleryInitMs,
    deviceLossCaught, galleryOperations: gallery.circuit.operations.length,
    galleryLayerCount, galleryMismatches, galleryBitMismatches, galleryMaxError,
    galleryCachedBitMismatches,galleryCachedMismatches,galleryMismatchExamples,
    integratedOperations: integrated.circuit.operations.length,
    integratedLayerCount, integratedMismatches, integratedBitMismatches, integratedMaxError,
    mismatches, maxError, stateMismatches, stateMaxError, layerMismatches, layerStateMismatches,
    adapter: adapter.info?.description || adapter.info?.vendor || 'WebGPU adapter',
    testedSamples: 512, operationKinds: ['affine', 'reglu', 'boolean', 'index']}
  smoke.textContent = JSON.stringify(info)
  document.body.dataset.status = info.ok ? 'pass' : 'fail'
  // Preserve all individual gate results in the browser report when a gate fails.
  // The verifier already treats dataset.status=fail as a nonzero exit code.
}

runButton.addEventListener('click', () => {
  void compare().catch(error => {
    status.textContent = String(error)
    runButton.disabled = false
  })
})
if (new URLSearchParams(location.search).has('smoke')) {
  void smokeTest().catch(error => {
    smoke.textContent = JSON.stringify({ok: false, error: String(error)})
    document.body.dataset.status = 'fail'
  })
} else if (!new URLSearchParams(location.search).has('probe')) {
  void compare().catch(error => {
    const lastStage=status.textContent
    status.textContent=String(error)
    smoke.textContent=JSON.stringify({ok:false,error:String(error),lastStage})
    document.body.dataset.status='fail'
    runButton.disabled=false
  })
}
