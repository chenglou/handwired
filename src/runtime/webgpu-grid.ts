// Reusable GPU-resident 9-point field stencil for cloth/fluid neighborhood passes.
// Channels are stored as interleaved f32 cells. Ping-pong state avoids readbacks.
export type GridBoundary = 'clamp' | 'wrap' | 'zero'
export type GridWeights = {center:number, left:number, right:number, up:number, down:number,
  upLeft?:number, upRight?:number, downLeft?:number, downRight?:number}
export type GridOptions = {width:number, height:number, channels?:number, boundary?:GridBoundary,
  weights:GridWeights, device?:GPUDevice, mode?:'auto'|'cpu'|'gpu'}
const Usage = {MAP_READ:1, COPY_SRC:4, COPY_DST:8, UNIFORM:64, STORAGE:128} as const
const wgsl = "\nstruct Params {\n  width:u32, height:u32, channels:u32, edge:u32,\n  center:f32, left:f32, right:f32, up:f32,\n  down:f32, upLeft:f32, upRight:f32, downLeft:f32,\n  downRight:f32, pad0:u32, pad1:u32, pad2:u32,\n};\n@group(0) @binding(0) var<uniform> p:Params;\n@group(0) @binding(1) var<storage,read> src:array<f32>;\n@group(0) @binding(2) var<storage,read_write> dst:array<f32>;\nfn sampleCell(x:i32,y:i32,c:u32)->f32 {\n  let w=i32(p.width); let h=i32(p.height);\n  if(p.edge==2u && (x<0||x>=w||y<0||y>=h)){return 0.0;}\n  var cx=clamp(x,0,w-1); var cy=clamp(y,0,h-1);\n  if(p.edge==1u){cx=((x%w)+w)%w;cy=((y%h)+h)%h;}\n  return src[(u32(cy)*p.width+u32(cx))*p.channels+c];\n}\n@compute @workgroup_size(8,8,1)\nfn main(@builtin(global_invocation_id) gid:vec3<u32>) {\n  if(gid.x>=p.width||gid.y>=p.height||gid.z>=p.channels){return;}\n  let x=i32(gid.x);let y=i32(gid.y);let c=gid.z;\n  var v=p.center*sampleCell(x,y,c);\n  v=v+p.left*sampleCell(x-1,y,c);\n  v=v+p.right*sampleCell(x+1,y,c);\n  v=v+p.up*sampleCell(x,y-1,c);\n  v=v+p.down*sampleCell(x,y+1,c);\n  v=v+p.upLeft*sampleCell(x-1,y-1,c);\n  v=v+p.upRight*sampleCell(x+1,y-1,c);\n  v=v+p.downLeft*sampleCell(x-1,y+1,c);\n  v=v+p.downRight*sampleCell(x+1,y+1,c);\n  dst[(gid.y*p.width+gid.x)*p.channels+c]=v;\n}\n"
export class GridStencil {
  readonly width:number
  readonly height:number
  readonly channels:number
  readonly length:number
  readonly boundary:GridBoundary
  readonly mode:'cpu'|'gpu'
  readonly weights:GridWeights
  readonly fallbackReason:string|null
  private buffers:GPUBuffer[]=[]
  private pipeline?:GPUComputePipeline
  private groups?:[GPUBindGroup,GPUBindGroup]
  private host:[Float32Array,Float32Array]
  private current=0
  private loaded=false
  private disposed=false
  private loss:string|null=null
  private constructor(private device:GPUDevice|undefined, options:GridOptions,reason:string|null) {
    this.width=options.width;this.height=options.height;this.channels=options.channels??1
    this.boundary=options.boundary??'clamp';this.weights=options.weights
    this.length=this.width*this.height*this.channels
    this.mode=device===undefined?'cpu':'gpu';this.fallbackReason=reason
    this.host=[new Float32Array(this.length),new Float32Array(this.length)]
  }
  static async create(options:GridOptions):Promise<GridStencil> {
    const width=options.width,height=options.height,channels=options.channels??1
    if(![width,height,channels].every(x=>Number.isSafeInteger(x)&&x>0) ||
      width>524280||height>524280||channels>65535||width*height*channels>0x3fffffff) {
      throw new Error('invalid grid dimensions')
    }
    if(!['clamp','wrap','zero'].includes(options.boundary??'clamp'))throw new Error('invalid edge rule')
    const w=options.weights
    const coefficients=[w.center,w.left,w.right,w.up,w.down,w.upLeft??0,w.upRight??0,w.downLeft??0,w.downRight??0]
    if(!coefficients.every(Number.isFinite))throw new Error('nonfinite grid coefficient')
    let device=options.mode==='cpu'?undefined:options.device
    let reason:string|null=null
    if(options.mode!=='cpu'&&device===undefined){
      try {
        const adapter=typeof navigator==='undefined'?null:await navigator.gpu.requestAdapter()
        device=(await adapter?.requestDevice())??undefined
        if(device===undefined)reason='WebGPU unavailable'
      }catch(error){if(options.mode==='gpu')throw error;reason=String(error)}
    }
    if(options.mode==='gpu'&&device===undefined)throw new Error('WebGPU unavailable')
    const out=new GridStencil(device,options,reason)
    if(device!==undefined){
      try{await out.initialize(device)}
      catch(error){
        out.destroy()
        if(options.mode==='gpu')throw error
        return new GridStencil(undefined,options,String(error))
      }
    }
    return out
  }
  private async initialize(device:GPUDevice) {
    const size=this.length*4
    if(size>device.limits.maxStorageBufferBindingSize||size>device.limits.maxBufferSize)
      throw new Error('grid exceeds available GPU limits')
    if(Math.ceil(this.width/8)>device.limits.maxComputeWorkgroupsPerDimension ||
      Math.ceil(this.height/8)>device.limits.maxComputeWorkgroupsPerDimension ||
      this.channels>device.limits.maxComputeWorkgroupsPerDimension)
      throw new Error('grid workgroups exceed available GPU limits')
    const uniform=device.createBuffer({size:64,usage:Usage.UNIFORM|Usage.COPY_DST})
    const a=device.createBuffer({size,usage:Usage.STORAGE|Usage.COPY_DST|Usage.COPY_SRC})
    const b=device.createBuffer({size,usage:Usage.STORAGE|Usage.COPY_DST|Usage.COPY_SRC})
    this.buffers.push(uniform,a,b)
    const params=new ArrayBuffer(64),view=new DataView(params)
    for(const [i,n] of [this.width,this.height,this.channels,
      {clamp:0,wrap:1,zero:2}[this.boundary]].entries())view.setUint32(i*4,n,true)
    const w=this.weights
    for(const [i,n] of [w.center,w.left,w.right,w.up,w.down,w.upLeft??0,w.upRight??0,
      w.downLeft??0,w.downRight??0].entries())view.setFloat32(16+i*4,n,true)
    device.queue.writeBuffer(uniform,0,params)
    const module=device.createShaderModule({code:wgsl,label:'Handwired neighborhood stencil'})
    const errors=(await module.getCompilationInfo()).messages.filter(x=>x.type==='error')
    if(errors.length)throw new Error('grid WGSL compile: '+errors.map(x=>x.message).join('; '))
    this.pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}})
    const layout=this.pipeline.getBindGroupLayout(0)
    const group=(src:GPUBuffer,dst:GPUBuffer)=>device.createBindGroup({layout,entries:[
      {binding:0,resource:{buffer:uniform}},{binding:1,resource:{buffer:src}},
      {binding:2,resource:{buffer:dst}},
    ]})
    this.groups=[group(a,b),group(b,a)]
    void device.lost.then(info=>{this.loss=info.message.length>0?info.message:info.reason})
  }
  private check() {
    if(this.disposed)throw new Error('grid destroyed')
    if(this.loss!==null)throw new Error('GPU device lost: '+this.loss)
  }
  load(source:Float32Array) {
    this.check()
    if(source.length!==this.length)throw new Error('grid source length mismatch')
    this.current=0;this.loaded=true
    if(this.device)this.device.queue.writeBuffer(this.buffers[1]!,0,source)
    else this.host[0].set(source)
  }
  private cpuStep() {
    const from=this.host[this.current]!,to=this.host[1-this.current]!
    const sample=(x:number,y:number,c:number)=>{
      if(this.boundary==='zero'&&(x<0||y<0||x>=this.width||y>=this.height))return 0
      if(this.boundary==='wrap') {
        x=((x%this.width)+this.width)%this.width
        y=((y%this.height)+this.height)%this.height
      }else{
        x=Math.max(0,Math.min(this.width-1,x))
        y=Math.max(0,Math.min(this.height-1,y))
      }
      return from[(y*this.width+x)*this.channels+c]!
    }
    const w=this.weights,f=Math.fround
    for(let y=0;y<this.height;y++)for(let x=0;x<this.width;x++)for(let c=0;c<this.channels;c++) {
      let value=f(f(w.center)*sample(x,y,c))
      for(const [dx,dy,coef] of [[-1,0,w.left],[1,0,w.right],[0,-1,w.up],[0,1,w.down],
        [-1,-1,w.upLeft??0],[1,-1,w.upRight??0],[-1,1,w.downLeft??0],[1,1,w.downRight??0]]){
        value=f(value+f(f(coef!)*sample(x+dx!,y+dy!,c)))
      }
      to[(y*this.width+x)*this.channels+c]=value
    }
  }
  async step(steps=1) {
    this.check()
    if(!this.loaded)throw new Error('load before step')
    if(!Number.isSafeInteger(steps)||steps<=0)throw new Error('steps must be positive integer')
    if(this.device) {
      const encoder=this.device.createCommandEncoder()
      for(let n=0;n<steps;n++) {
        const pass=encoder.beginComputePass()
        pass.setPipeline(this.pipeline!)
        pass.setBindGroup(0,this.groups![this.current]!)
        pass.dispatchWorkgroups(Math.ceil(this.width/8),Math.ceil(this.height/8),this.channels)
        pass.end()
        this.current=1-this.current
      }
      this.device.queue.submit([encoder.finish()])
      await this.device.queue.onSubmittedWorkDone()
      this.check()
    }else for(let n=0;n<steps;n++){this.cpuStep();this.current=1-this.current}
  }
  async read():Promise<Float32Array> {
    this.check()
    if(!this.loaded)throw new Error('load before read')
    if(!this.device)return this.host[this.current]!.slice()
    const bytes=this.length*4
    const staging=this.device.createBuffer({size:bytes,usage:Usage.MAP_READ|Usage.COPY_DST})
    try{
      const encoder=this.device.createCommandEncoder()
      encoder.copyBufferToBuffer(this.buffers[this.current+1]!,0,staging,0,bytes)
      this.device.queue.submit([encoder.finish()])
      await staging.mapAsync(1)
      const out=new Float32Array(staging.getMappedRange().slice(0))
      staging.unmap()
      return out
    }finally{staging.destroy()}
  }
  destroy(){if(this.disposed)return;this.disposed=true;for(const b of this.buffers)b.destroy();this.buffers=[]}
}
export const createGridStencil=(options:GridOptions)=>GridStencil.create(options)
