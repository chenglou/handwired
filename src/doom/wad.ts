// A reader for Doom's WAD format: the lump directory, a map's lumps, and the graphics (palette, colormaps, wall
// textures composed from patches, flats and sprites). Plain JavaScript that runs while building, never inside a
// program: everything it returns becomes constants and tables of the programs.

type Lump = {name: string, offset: number, size: number}

export type Wad = {
  bytes: Uint8Array
  view: DataView
  lumps: Lump[]
}

export function readWad(bytes: Uint8Array): Wad {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const magic = String.fromCharCode(...bytes.subarray(0, 4))
  if (magic !== 'IWAD' && magic !== 'PWAD') throw new Error(`not a WAD file: ${magic}`)
  const count = view.getInt32(4, true)
  const directory = view.getInt32(8, true)
  const lumps: Lump[] = []
  for (let index = 0; index < count; index++) {
    const at = directory + index * 16
    lumps.push({offset: view.getInt32(at, true), size: view.getInt32(at + 4, true), name: readName(bytes, at + 8)})
  }
  return {bytes, view, lumps}
}

function readName(bytes: Uint8Array, at: number) {
  let name = ''
  for (let index = 0; index < 8; index++) {
    const code = bytes[at + index]!
    if (code === 0) break
    name += String.fromCharCode(code)
  }
  return name.toUpperCase()
}

export function lumpIndex(wad: Wad, name: string, after = 0) {
  for (let index = after; index < wad.lumps.length; index++) if (wad.lumps[index]!.name === name) return index
  return -1
}

export function lumpBytes(wad: Wad, lump: Lump) {
  return wad.bytes.subarray(lump.offset, lump.offset + lump.size)
}

export function namedLump(wad: Wad, name: string) {
  const index = lumpIndex(wad, name)
  if (index < 0) throw new Error(`lump ${name} not found`)
  return lumpBytes(wad, wad.lumps[index]!)
}

// The lumps between two markers, e.g. F_START and F_END for flats, S_START and S_END for sprites.
function lumpsBetween(wad: Wad, start: string, end: string) {
  const first = lumpIndex(wad, start)
  const last = first < 0 ? -1 : lumpIndex(wad, end, first)
  if (last < 0) throw new Error(`markers ${start}..${end} not found`)
  return wad.lumps.slice(first + 1, last).filter(lump => lump.size > 0)
}

type Vertex = {x: number, y: number}
type Linedef = {v1: number, v2: number, flags: number, special: number, tag: number, front: number, back: number}
type Sidedef = {xOffset: number, yOffset: number, upper: string, lower: string, middle: string, sector: number}
type Sector = {floor: number, ceiling: number, floorPic: string, ceilingPic: string, light: number, special: number, tag: number}
export type Seg = {v1: number, v2: number, angle: number, linedef: number, side: number, offset: number}
type Subsector = {count: number, first: number}
type Node = {
  x: number, y: number, dx: number, dy: number
  // Bounding boxes: top, bottom, left, right.
  rightBox: [number, number, number, number]
  leftBox: [number, number, number, number]
  // A child with bit 15 set is a subsector, the low 15 bits its index.
  right: number
  left: number
}
type Thing = {x: number, y: number, angle: number, type: number, flags: number}
export type Blockmap = {originX: number, originY: number, columns: number, rows: number, lists: number[][]}

export type DoomMap = {
  name: string
  vertices: Vertex[]
  linedefs: Linedef[]
  sidedefs: Sidedef[]
  sectors: Sector[]
  segs: Seg[]
  subsectors: Subsector[]
  nodes: Node[]
  things: Thing[]
  blockmap: Blockmap
  reject: Uint8Array
}

// Linedef flags.
export const ML_BLOCKING = 1
export const ML_BLOCKMONSTERS = 2
export const ML_TWOSIDED = 4
export const ML_DONTPEGTOP = 8
export const ML_DONTPEGBOTTOM = 16
export const ML_SOUNDBLOCK = 64

export function readMap(wad: Wad, name: string): DoomMap {
  const marker = lumpIndex(wad, name)
  if (marker < 0) throw new Error(`map ${name} not found`)
  const lump = (lumpName: string) => {
    for (let index = marker + 1; index < marker + 12 && index < wad.lumps.length; index++) {
      if (wad.lumps[index]!.name === lumpName) return lumpBytes(wad, wad.lumps[index]!)
    }
    throw new Error(`${name} has no ${lumpName}`)
  }
  const records = <T>(lumpName: string, size: number, read: (view: DataView, bytes: Uint8Array, at: number) => T) => {
    const bytes = lump(lumpName)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return Array.from({length: Math.floor(bytes.length / size)}, (_, index) => read(view, bytes, index * size))
  }
  const vertices = records('VERTEXES', 4, (view, _, at) => ({x: view.getInt16(at, true), y: view.getInt16(at + 2, true)}))
  const linedefs = records('LINEDEFS', 14, (view, _, at) => ({
    v1: view.getUint16(at, true),
    v2: view.getUint16(at + 2, true),
    flags: view.getUint16(at + 4, true),
    special: view.getUint16(at + 6, true),
    tag: view.getUint16(at + 8, true),
    front: view.getUint16(at + 10, true),
    back: view.getUint16(at + 12, true) === 0xffff ? -1 : view.getUint16(at + 12, true),
  }))
  const sidedefs = records('SIDEDEFS', 30, (view, bytes, at) => ({
    xOffset: view.getInt16(at, true),
    yOffset: view.getInt16(at + 2, true),
    upper: readName(bytes, at + 4),
    lower: readName(bytes, at + 12),
    middle: readName(bytes, at + 20),
    sector: view.getUint16(at + 28, true),
  }))
  const sectors = records('SECTORS', 26, (view, bytes, at) => ({
    floor: view.getInt16(at, true),
    ceiling: view.getInt16(at + 2, true),
    floorPic: readName(bytes, at + 4),
    ceilingPic: readName(bytes, at + 12),
    light: view.getInt16(at + 20, true),
    special: view.getInt16(at + 22, true),
    tag: view.getInt16(at + 24, true),
  }))
  const segs = records('SEGS', 12, (view, _, at) => ({
    v1: view.getUint16(at, true),
    v2: view.getUint16(at + 2, true),
    angle: view.getUint16(at + 4, true),
    linedef: view.getUint16(at + 6, true),
    side: view.getUint16(at + 8, true),
    offset: view.getInt16(at + 10, true),
  }))
  const subsectors = records('SSECTORS', 4, (view, _, at) => ({count: view.getUint16(at, true), first: view.getUint16(at + 2, true)}))
  const nodes = records('NODES', 28, (view, _, at) => ({
    x: view.getInt16(at, true),
    y: view.getInt16(at + 2, true),
    dx: view.getInt16(at + 4, true),
    dy: view.getInt16(at + 6, true),
    rightBox: [view.getInt16(at + 8, true), view.getInt16(at + 10, true), view.getInt16(at + 12, true), view.getInt16(at + 14, true)] as [number, number, number, number],
    leftBox: [view.getInt16(at + 16, true), view.getInt16(at + 18, true), view.getInt16(at + 20, true), view.getInt16(at + 22, true)] as [number, number, number, number],
    right: view.getUint16(at + 24, true),
    left: view.getUint16(at + 26, true),
  }))
  const things = records('THINGS', 10, (view, _, at) => ({
    x: view.getInt16(at, true),
    y: view.getInt16(at + 2, true),
    angle: view.getInt16(at + 4, true),
    type: view.getInt16(at + 6, true),
    flags: view.getInt16(at + 8, true),
  }))
  const blockmapBytes = lump('BLOCKMAP')
  const blockmapView = new DataView(blockmapBytes.buffer, blockmapBytes.byteOffset, blockmapBytes.byteLength)
  const originX = blockmapView.getInt16(0, true)
  const originY = blockmapView.getInt16(2, true)
  const columns = blockmapView.getUint16(4, true)
  const rows = blockmapView.getUint16(6, true)
  const lists: number[][] = []
  for (let block = 0; block < columns * rows; block++) {
    let at = blockmapView.getUint16(8 + block * 2, true) * 2
    const list: number[] = []
    // Each list starts with a 0 and ends with 0xffff.
    at += 2
    for (;;) {
      const line = blockmapView.getUint16(at, true)
      if (line === 0xffff) break
      list.push(line)
      at += 2
    }
    lists.push(list)
  }
  return {
    name,
    vertices,
    linedefs,
    sidedefs,
    sectors,
    segs,
    subsectors,
    nodes,
    things,
    blockmap: {originX, originY, columns, rows, lists},
    reject: lump('REJECT').slice(),
  }
}

// 14 palettes of 256 RGB triples; the first is the normal one.
export function readPalettes(wad: Wad) {
  const bytes = namedLump(wad, 'PLAYPAL')
  return Array.from({length: Math.floor(bytes.length / 768)}, (_, index) => bytes.slice(index * 768, index * 768 + 768))
}

// 34 maps of 256 palette indices: 32 light levels from brightest to darkest, the invulnerability map, and black.
export function readColormaps(wad: Wad) {
  const bytes = namedLump(wad, 'COLORMAP')
  return Array.from({length: Math.floor(bytes.length / 256)}, (_, index) => bytes.slice(index * 256, index * 256 + 256))
}

// A picture in Doom's patch format, as palette indices in column-major order, with -1 for transparent texels.
export type Picture = {name: string, width: number, height: number, leftOffset: number, topOffset: number, texels: Int16Array}

export function readPicture(name: string, bytes: Uint8Array): Picture {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint16(0, true)
  const height = view.getUint16(2, true)
  const leftOffset = view.getInt16(4, true)
  const topOffset = view.getInt16(6, true)
  const texels = new Int16Array(width * height).fill(-1)
  for (let column = 0; column < width; column++) {
    let at = view.getUint32(8 + column * 4, true)
    // Posts: a top delta (0xff ends the column), a length, a padding byte, the texels and another padding byte.
    // Tall patches use DeePsea's convention: a delta at or below the previous one adds to it.
    let previousDelta = -1
    for (;;) {
      let delta = bytes[at]!
      if (delta === 0xff) break
      if (delta <= previousDelta) delta += previousDelta
      previousDelta = delta
      const length = bytes[at + 1]!
      for (let row = 0; row < length; row++) {
        const y = delta + row
        if (y < height) texels[column * height + y] = bytes[at + 3 + row]!
      }
      at += length + 4
    }
  }
  return {name, width, height, leftOffset, topOffset, texels}
}

export type Texture = {name: string, width: number, height: number, texels: Int16Array}

// Wall textures from TEXTURE1 (and TEXTURE2 when present), composed from the patches that PNAMES names. Texels that
// no patch covers stay -1, which Doom draws as whatever was there before; they read as palette index 0 here.
export function readTextures(wad: Wad): Texture[] {
  const pnamesBytes = namedLump(wad, 'PNAMES')
  const pnamesView = new DataView(pnamesBytes.buffer, pnamesBytes.byteOffset, pnamesBytes.byteLength)
  const patchNames = Array.from({length: pnamesView.getInt32(0, true)}, (_, index) => readName(pnamesBytes, 4 + index * 8))
  const patchCache = new Map<string, Picture | null>()
  const patch = (name: string) => {
    if (!patchCache.has(name)) {
      const index = lumpIndex(wad, name)
      patchCache.set(name, index < 0 ? null : readPicture(name, lumpBytes(wad, wad.lumps[index]!)))
    }
    return patchCache.get(name) ?? null
  }
  const textures: Texture[] = []
  for (const lumpName of ['TEXTURE1', 'TEXTURE2']) {
    if (lumpIndex(wad, lumpName) < 0) continue
    const bytes = namedLump(wad, lumpName)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const count = view.getInt32(0, true)
    for (let index = 0; index < count; index++) {
      const at = view.getInt32(4 + index * 4, true)
      const name = readName(bytes, at)
      const width = view.getInt16(at + 12, true)
      const height = view.getInt16(at + 14, true)
      const patchCount = view.getInt16(at + 20, true)
      const texels = new Int16Array(width * height).fill(-1)
      for (let patchIndex = 0; patchIndex < patchCount; patchIndex++) {
        const patchAt = at + 22 + patchIndex * 10
        const originX = view.getInt16(patchAt, true)
        const originY = view.getInt16(patchAt + 2, true)
        const picture = patch(patchNames[view.getInt16(patchAt + 4, true)]!)
        if (picture === null) continue
        for (let column = 0; column < picture.width; column++) {
          const x = originX + column
          if (x < 0 || x >= width) continue
          for (let row = 0; row < picture.height; row++) {
            const y = originY + row
            const texel = picture.texels[column * picture.height + row]!
            if (y < 0 || y >= height || texel < 0) continue
            texels[x * height + y] = texel
          }
        }
      }
      textures.push({name, width, height, texels})
    }
  }
  return textures
}

// Flats are 64×64 raw palette indices, row-major.
export function readFlats(wad: Wad) {
  const flats = new Map<string, Uint8Array>()
  for (const lump of lumpsBetween(wad, 'F_START', 'F_END')) {
    if (lump.size === 4096) flats.set(lump.name, lumpBytes(wad, lump).slice())
  }
  return flats
}

export function readSprites(wad: Wad) {
  const sprites = new Map<string, Picture>()
  for (const lump of lumpsBetween(wad, 'S_START', 'S_END')) sprites.set(lump.name, readPicture(lump.name, lumpBytes(wad, lump)))
  return sprites
}
