import page from '../assets/handwired-webgpu.html'
const port = Number(process.env['PORT'] ?? '39080')
const server = Bun.serve({
  hostname: '127.0.0.1',
  port,
  routes: {'/': page},
  development: true,
})
console.log('Handwired WebGPU browser demonstration: ' + server.url)
