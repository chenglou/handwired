// Independent handwritten GPU baseline for the six-operation swarm benchmark.
// Deliberately NOT constructed from a Handwired Circuit or its shader generator.
const shader = /* wgsl */ `
struct Params {count:u32,steps:u32,pad0:u32,pad1:u32};
@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var<storage,read> input:array<f32>;
@group(0) @binding(2) var<storage,read_write> output:array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
  if(gid.x>=p.count){return;}
  let src=gid.x*4u;
  var x=input[src]; var y=input[src+1u];
  var vx=input[src+2u]; var vy=input[src+3u];
  var nx:f32=0.0;var ny:f32=0.0;
  var fx:f32=0.0;var fy:f32=0.0;
  var nvx:f32=0.0;var nvy:f32=0.0;
  var beforeX:f32=0.0;var beforeY:f32=0.0;
  var beforeVx:f32=0.0;var beforeVy:f32=0.0;
  for(var t=0u;t<p.steps;t=t+1u){
    beforeX=x;beforeY=y;beforeVx=vx;beforeVy=vy;
    nx=0.0+(1.0*x); nx=nx+(0.016*vx);
    ny=0.0+(1.0*y); ny=ny+(0.016*vy);
    fx=0.035+(-0.07*nx);
    fy=0.035+(-0.07*ny);
    nvx=0.0+(0.997*vx);nvx=nvx+(0.016*fx);
    nvy=0.0+(0.997*vy);nvy=nvy+(0.016*fy);
    x=nx;y=ny;vx=nvx;vy=nvy;
  }
  let out=gid.x*10u;
  output[out]=beforeX;output[out+1u]=beforeY;
  output[out+2u]=beforeVx;output[out+3u]=beforeVy;
  output[out+4u]=nx;output[out+5u]=ny;
  output[out+6u]=fx;output[out+7u]=fy;
  output[out+8u]=nvx;output[out+9u]=nvy;
}
`
const U={MAP_READ:1,COPY_SRC:4,COPY_DST:8,UNIFORM:64,STORAGE:128} as const
export class HandwrittenSwarmGpu {
  private readonly buffers:GPUBuffer[]=[]
  private readonly uniform:GPUBuffer
  private readonly input:GPUBuffer
  private readonly output:GPUBuffer
  private readonly bindGroup:GPUBindGroup
  private readonly pipeline:GPUComputePipeline
  private constructor(private readonly device:GPUDevice,readonly capacity:number,
    buffers:GPUBuffer[], bindGroup:GPUBindGroup, pipeline:GPUComputePipeline){
    this.buffers=buffers
    this.uniform=buffers[0]!
    this.input=buffers[1]!
    this.output=buffers[2]!
    this.bindGroup=bindGroup
    this.pipeline=pipeline
  }
  static async create(device:GPUDevice, capacity:number):Promise<HandwrittenSwarmGpu>{
    if(!Number.isSafeInteger(capacity)||capacity<=0)throw new Error('invalid baseline capacity')
    const buffers=[
      device.createBuffer({size:16,usage:U.UNIFORM|U.COPY_DST}),
      device.createBuffer({size:capacity*4*4,usage:U.STORAGE|U.COPY_DST}),
      device.createBuffer({size:capacity*10*4,usage:U.STORAGE|U.COPY_SRC}),
    ]
    try{
      const module=device.createShaderModule({code:shader})
      const errors=(await module.getCompilationInfo()).messages.filter(x=>x.type==='error')
      if(errors.length)throw new Error('handwritten shader invalid: '+errors.map(x=>x.message).join('; '))
      const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}})
      const bindGroup=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[
        {binding:0,resource:{buffer:buffers[0]!}},
        {binding:1,resource:{buffer:buffers[1]!}},
        {binding:2,resource:{buffer:buffers[2]!}},
      ]})
      return new HandwrittenSwarmGpu(device,capacity,buffers,bindGroup,pipeline)
    }catch(error){for(const buffer of buffers)buffer.destroy();throw error}
  }
  async evaluate(input:Float32Array,steps:number):Promise<Float32Array>{
    const count=input.length/4
    if(!Number.isSafeInteger(count)||count<1||count>this.capacity)throw new Error('invalid swarm count')
    if(!Number.isSafeInteger(steps)||steps<1)throw new Error('invalid steps')
    const bytes=count*10*4
    this.device.queue.writeBuffer(this.uniform,0,new Uint32Array([count,steps,0,0]))
    this.device.queue.writeBuffer(this.input,0,input)
    const staging=this.device.createBuffer({size:bytes,usage:U.MAP_READ|U.COPY_DST})
    try{
      const cmd=this.device.createCommandEncoder()
      const pass=cmd.beginComputePass()
      pass.setPipeline(this.pipeline)
      pass.setBindGroup(0,this.bindGroup)
      pass.dispatchWorkgroups(Math.ceil(count/64))
      pass.end()
      cmd.copyBufferToBuffer(this.output,0,staging,0,bytes)
      this.device.queue.submit([cmd.finish()])
      await staging.mapAsync(1)
      const result=new Float32Array(staging.getMappedRange().slice(0))
      staging.unmap()
      return result
    }finally{staging.destroy()}
  }
  destroy(){for(const b of this.buffers)b.destroy()}
}
