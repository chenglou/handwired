import {describe,expect,test} from 'bun:test'
import {Circuit} from '../../src/runtime/numeric-ui-core.ts'
import {createWebGpuEvaluator} from '../../src/runtime/webgpu.ts'
import {createGridStencil,type GridBoundary,type GridWeights} from '../../src/runtime/webgpu-grid.ts'
import {emitSpecializedWgsl} from '../../src/runtime/webgpu-specialize.ts'

const f=Math.fround
function referenceGrid(input:Float32Array,width:number,height:number,channels:number,
  boundary:GridBoundary,w:GridWeights):Float32Array {
  const output=new Float32Array(input.length)
  for(let i=0;i<input.length;i++){
    const c=i%channels,pixel=(i-c)/channels,x=pixel%width,y=Math.floor(pixel/width)
    const at=(xx:number,yy:number)=>{
      if(boundary==='zero'&&(xx<0||xx>=width||yy<0||yy>=height))return 0
      if(boundary==='wrap'){xx=((xx%width)+width)%width;yy=((yy%height)+height)%height}
      else{xx=Math.max(0,Math.min(width-1,xx));yy=Math.max(0,Math.min(height-1,yy))}
      return input[(yy*width+xx)*channels+c]!
    }
    let v=f(f(w.center)*at(x,y))
    for(const [dx,dy,weight] of [[-1,0,w.left],[1,0,w.right],[0,-1,w.up],[0,1,w.down],
      [-1,-1,w.upLeft??0],[1,-1,w.upRight??0],[-1,1,w.downLeft??0],[1,1,w.downRight??0]]){
      v=f(v+f(f(weight!)*at(x+dx!,y+dy!)))
    }
    output[i]=v
  }
  return output
}
describe('general 9-point grid kernels',()=>{
  const weights:GridWeights={center:0.4,left:0.1,right:0.1,up:0.1,down:0.1,
    upLeft:0.05,upRight:0.05,downLeft:0.05,downRight:0.05}
  for(const boundary of ['clamp','wrap','zero'] as const){
    for(const [width,height,channels] of [[1,1,1],[2,3,2],[15,9,3]]){
      test(boundary+' '+width+'x'+height+'x'+channels,async()=>{
        const start=Float32Array.from({length:width!*height!*channels!},
          (_,i)=>f(Math.sin(i*0.117)*3.5))
        const grid=await createGridStencil({width:width!,height:height!,channels:channels!,
          boundary,weights,mode:'cpu'})
        try{
          grid.load(start)
          await grid.step(7)
          let actual:Float32Array=start
          for(let j=0;j<7;j++)actual=referenceGrid(actual,width!,height!,channels!,boundary,weights)
          expect(Array.from(await grid.read())).toEqual(Array.from(actual))
        }finally{grid.destroy()}
      })
    }
  }
  test('reject invalid dimensions, nonfinite weights and inconsistent lengths',async()=>{
    let rejected=false
    try{await createGridStencil({width:0,height:1,weights,mode:'cpu'})}catch{rejected=true}
    expect(rejected).toBe(true)
    rejected=false
    try{await createGridStencil({width:5,height:1,weights:{...weights,up:Infinity},mode:'cpu'})}
    catch{rejected=true}
    expect(rejected).toBe(true)
    const grid=await createGridStencil({width:3,height:2,weights,mode:'cpu'})
    expect(()=>grid.load(new Float32Array(5))).toThrow()
    grid.load(new Float32Array(6))
    let badStep=false
    try{await grid.step(0)}catch{badStep=true}
    expect(badStep).toBe(true)
    await grid.step(2)
    expect((await grid.read()).length).toBe(6)
    grid.destroy()
    grid.destroy()
    expect(()=>grid.load(new Float32Array(6))).toThrow()
  })
})
describe('circuit-specific GPU compilation',()=>{
  const construct=()=>{
    const circuit=new Circuit(4)
    const a=circuit.source(0),b=circuit.source(1),gate=circuit.source(2),idx=circuit.source(3)
    circuit.assumeRange(gate,0,1)
    circuit.assumeRange(idx,-1,5)
    const sum=circuit.roundAffine([[a,0.1],[b,-0.3]],0.6)
    const reglu=circuit.reglu([[sum,1]],0,[[gate,1]],0)
    const rounded=circuit.boolean(gate)
    circuit.indexReadAffine([[idx,1]],0,[a,b,reglu,rounded],'zero','clamp')
    return circuit
  }
  test('emits all four operations, with exact f32 bit patterns',()=>{
    const code=emitSpecializedWgsl(construct())
    expect(code).toContain('fn executeSpecialized')
    expect(code).toContain('bitcast<f32>')
    expect(code).toContain('select(0.0,1.0')
    expect(code).toContain('candidates[')
    expect(code).toContain('max(0.0')
  })
  test('exact reference policy always uses CPU',async()=>{
    const circuit=construct()
    const cpu=await createWebGpuEvaluator(circuit,{capacity:1,numericPolicy:'reference-exact'})
    try{
      expect(cpu.mode).toBe('cpu')
      expect(cpu.fallbackReason).toContain('reference-exact')
      const inputs=Float32Array.from([0.5,-1.5,0.5,2])
      const expected=circuit.evaluateReference(inputs)
      const result=await cpu.evaluate(inputs)
      for(let i=0;i<expected.length;i++)expect(Object.is(result[i],expected[i])).toBe(true)
    }finally{cpu.destroy()}
    let rejected=false
    try{await createWebGpuEvaluator(circuit,{mode:'gpu',numericPolicy:'reference-exact'})}
    catch{rejected=true}
    expect(rejected).toBe(true)
  })
  test('256 seeded samples match CPU reference',async()=>{
    const circuit=construct(),data=new Float32Array(256*4)
    let s=31
    const random=()=>{s=(Math.imul(s,1664525)+1013904223)|0;return(s>>>0)/4294967296}
    for(let i=0;i<256;i++)data.set([random()*8-4,random()*6-3,random(),i%7-1],i*4)
    const evaluator=await createWebGpuEvaluator(circuit,{capacity:256,mode:'cpu',strategy:'specialized'})
    try{
      const values=await evaluator.evaluate(data),width=circuit.sourceSize+circuit.operations.length
      for(let i=0;i<256;i++){
        const expected=circuit.evaluateReference(data.subarray(i*4,i*4+4))
        for(let j=0;j<width;j++)expect(values[i*width+j]).toBe(expected[j])
      }
    }finally{evaluator.destroy()}
  })
})
