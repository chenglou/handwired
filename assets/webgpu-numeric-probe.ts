import {Circuit} from '../src/runtime/numeric-ui-core.ts'
import {createWebGpuEvaluator} from '../src/runtime/webgpu.ts'
export async function measureFp32Edges(device:GPUDevice){
  const circuit=new Circuit(4)
  const a=circuit.source(0),b=circuit.source(1),gate=circuit.source(2),idx=circuit.source(3)
  circuit.assumeRange(gate,0,1);circuit.assumeRange(idx,-4,8)
  const sum=circuit.roundAffine([[a,1],[b,1],[a,-1]])
  const pos=circuit.reglu([[sum,1]],0,[[a,1]],0)
  const bit=circuit.boolean(gate)
  const read=circuit.indexReadAffine([[idx,1]],0,[sum,a,b,pos,bit],'zero','clamp')
  circuit.roundAffine([[read,1],[sum,-1]])
  const extremes=[0,-0,1.401298464324817e-45,-1.401298464324817e-45,
    1.1754943508222875e-38,-1.1754943508222875e-38,1e-40,-1e-40,
    0.4999999701976776,0.5,0.5000000596046448,1,-1,2**24,-(2**24),
    3.4028234663852886e38,-3.4028234663852886e38,Infinity,-Infinity]
  const samples=256,inputs=new Float32Array(samples*4)
  for(let i=0;i<samples;i++)inputs.set([extremes[i%extremes.length]!,
    extremes[(i*7+3)%extremes.length]!,
    [0,0.4999999701976776,0.5,0.5000000596046448,1][i%5]!,i%13-4],i*4)
  const summary:Record<string,{total:number,signedZeros:number,subnormals:number,
    nonfinite:number,maxFiniteError:number}>={}
  for(const strategy of ['monolithic','layers','specialized'] as const){
    const evaluator=await createWebGpuEvaluator(circuit,{mode:'gpu',device,capacity:samples,strategy})
    try{
      const values=await evaluator.evaluate(inputs),width=circuit.sourceSize+circuit.operations.length
      const stats={total:0,signedZeros:0,subnormals:0,nonfinite:0,maxFiniteError:0}
      for(let i=0;i<samples;i++){
        const expected=circuit.evaluateReference(inputs.subarray(i*4,i*4+4))
        for(let j=0;j<width;j++){
          const x=expected[j]!,y=values[i*width+j]!
          if(Object.is(x,y))continue
          stats.total++
          if(!Number.isFinite(x)||!Number.isFinite(y))stats.nonfinite++
          else{
            if(x===0&&y===0)stats.signedZeros++
            if(Math.abs(x)<2**-126||Math.abs(y)<2**-126)stats.subnormals++
            stats.maxFiniteError=Math.max(stats.maxFiniteError,Math.abs(x-y))
          }
        }
      }
      summary[strategy]=stats
    }finally{evaluator.destroy()}
  }
  return summary
}
