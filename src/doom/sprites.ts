// Sprites, as builder code shared by the frame program and the column program. Per frame, every thing is viewed from
// the eye (Doom's R_ProjectSprite): its depth, its columns, its rows, the rotation of its frame that faces the eye,
// and its light. A sorting network orders the things nearest first, and the first slots go to the column program. Per
// column, the program picks the nearest few sprites that cover the column, clips each to the window that the walls in
// front of it leave (Doom clips against drawsegs), and draws them over the column far to near.
import {input, list, inputBit} from '../runtime/cells.ts'
import {type Circuit, type Terms, type Wire, emitCompare} from '../runtime/numeric-ui-core.ts'
import {MAXLIGHTSCALE} from './assets.ts'
import {constantTable, emitAbs, emitClampZeroTo, emitFloorish, emitMax, emitMin, emitPositiveBit, emitReluSum} from './ops.ts'
import {type SpriteCatalog} from './things.ts'
import {type ViewConfig, viewConstants} from './view.ts'

// Sprites the frame program hands the column program, and sprites a column draws at most.
const spriteSlots = 32
const spritesPerColumn = 3

// The nearest a sprite is drawn, Doom's MINZ, and the farthest the reciprocal covers.
const nearest = 4
const farthest = 8192

export function slotSpec(view: ViewConfig) {
  return list(spriteSlots, () => ({
    visible: inputBit(),
    // First and last screen columns, clamped to -1..width.
    x1: input([-1, view.width], {grid: 1}),
    x2: input([-1, view.width], {grid: 1}),
    // The texture column, with its fraction, at x1: 0 unless the screen's left edge cuts the sprite, where it is
    // Doom's startfrac, advanced by the columns cut off.
    textureStart: input([0, 512]),
    inverseZ: input([-1, 1 / nearest]),
    base: input([0, 2 ** 22], {grid: 1}),
    width: input([1, 512], {grid: 1, initial: 1}),
    height: input([1, 512], {grid: 1, initial: 1}),
    flip: inputBit(),
    // Texture columns per screen column, and texture rows at row 0 and per row.
    columnStep: input([0, farthest]),
    row0: input([-(2 ** 16), 2 ** 16]),
    rowStep: input([0, farthest]),
    // Rows of the sprite, clamped to 0..height: from rowTop to before rowBottom.
    rowTop: input([0, view.height], {grid: 1}),
    rowBottom: input([0, view.height], {grid: 1}),
    level: input([0, 31], {grid: 1}),
  }))
}

type ThingInput = {x: Wire, y: Wire, z: Wire, sector: Wire, frame: Wire, bright: Wire, direction: Wire, visible: Wire}
type SlotWires = {[Field in keyof ReturnType<typeof slotSpec>[number]]: Wire}

// The octant of an angle from its cosine's and sine's signs and which is larger: octant k covers 45k..45(k+1) degrees.
// Indexed by [cos > 0] × 4 + [sin > 0] × 2 + [|cos| > |sin|].
const octants = [5, 4, 2, 3, 6, 7, 1, 0]

export function emitSprites(
  circuit: Circuit,
  catalog: SpriteCatalog,
  view: ViewConfig,
  eye: {x: Wire, y: Wire, z: Wire, cos: Wire, sin: Wire},
  lightRows: Wire[],
  scaleLight: Wire[],
  things: ThingInput[],
): SlotWires[] {
  const {centerX, centerY, focalY} = viewConstants(view)
  const half = view.width / 2
  const consts = (values: number[]) => constantTable(circuit, values)
  const rotationLump = consts(catalog.rotations.map(rotation => rotation.lump))
  const rotationFlip = consts(catalog.rotations.map(rotation => rotation.flip ? 1 : 0))
  const lumpWidth = consts(catalog.lumps.map(lump => lump.width))
  const lumpHeight = consts(catalog.lumps.map(lump => lump.height))
  const lumpLeft = consts(catalog.lumps.map(lump => lump.left))
  const lumpTop = consts(catalog.lumps.map(lump => lump.top))
  const lumpBase = consts(catalog.lumps.map(lump => lump.base))
  const octantTable = consts(octants)
  // Doom's rotation 1 faces the eye and spans ±22.5°, so each facing direction's frame is turned back by 22.5°.
  const turned = Array.from({length: 8}, (_, direction) => (direction * 45 - 22.5) * Math.PI / 180)
  const cosTurned = consts(turned.map(Math.cos))
  const sinTurned = consts(turned.map(Math.sin))
  const seedSteps = 0.5
  const seeds = consts(Array.from({length: farthest * seedSteps + 1}, (_, index) => seedSteps / (Math.max(1, index) + 0.5)))
  const read = (index: Terms, bias: number, candidates: Wire[]) => circuit.indexReadAffine(index, bias, candidates, 'clamp', 'clamp')
  const clampTo = (value: Wire, low: number, high: number) => {
    const clamped = circuit.affine([[emitClampZeroTo(circuit, [[value, 1]], -low, high - low), 1]], low)
    // The value clamped to low..high. Every caller passes a whole column or row from emitFloorish, and clamping a
    // whole number to whole bounds keeps it whole.
    circuit.assumeRange(clamped, low, high, {allowExistingReaders: true})
    circuit.assumeGrid(clamped, 1, {allowExistingReaders: true})
    return clamped
  }

  type Projected = Record<keyof SlotWires, Wire>
  const projected: Projected[] = []
  const keys: Wire[] = []
  for (const thing of things) {
    const relX = circuit.affine([[thing.x, 1], [eye.x, -1]])
    const relY = circuit.affine([[thing.y, 1], [eye.y, -1]])
    const depth = circuit.affine([[circuit.multiply(relX, eye.cos), 1], [circuit.multiply(relY, eye.sin), 1]])
    const across = circuit.affine([[circuit.multiply(relX, eye.sin), 1], [circuit.multiply(relY, eye.cos), -1]])
    const inFront = emitPositiveBit(circuit, [[depth, 1]], -nearest)
    const clampedDepth = circuit.affine([[emitClampZeroTo(circuit, [[depth, 1]], -nearest, farthest - nearest), 1]], nearest)
    // The depth clamped to nearest..farthest.
    circuit.assumeRange(clampedDepth, nearest, farthest)
    let inverseZ = read([[clampedDepth, seedSteps]], 0, seeds)
    for (let step = 0; step < 4; step++) {
      inverseZ = circuit.reglu([[inverseZ, 1]], 0, [[circuit.multiply(clampedDepth, inverseZ), -1]], 2)
      // The seed for a depth in 2i..2i + 2 is 1/(2i + 1), within a fifth of 1/depth as i is at least 2, and a step on
      // an estimate with relative error e gives (1 - e²)/depth: within 0..1/depth, and depth is at least nearest.
      circuit.assumeRange(inverseZ, 0, 1 / nearest)
    }
    // Which rotation faces the eye: the angle from the thing to the eye, relative to its facing.
    const cosT = circuit.indexRead(thing.direction, cosTurned)
    const sinT = circuit.indexRead(thing.direction, sinTurned)
    const along = circuit.affine([[circuit.multiply(relX, cosT), -1], [circuit.multiply(relY, sinT), -1]])
    const side = circuit.affine([[circuit.multiply(relY, cosT), -1], [circuit.multiply(relX, sinT), 1]])
    const octant = circuit.indexReadAffine([
      [emitPositiveBit(circuit, [[along, 1]]), 4],
      [emitPositiveBit(circuit, [[side, 1]]), 2],
      [emitPositiveBit(circuit, [[emitAbs(circuit, along), 1], [emitAbs(circuit, side), -1]]), 1],
    ], 0, octantTable, 'clamp', 'clamp')
    const rotationIndex: Terms = [[thing.frame, 8], [octant, 1]]
    const lump = read(rotationIndex, 0, rotationLump)
    const flip = read(rotationIndex, 0, rotationFlip)
    const width = read([[lump, 1]], 0, lumpWidth)
    const height = read([[lump, 1]], 0, lumpHeight)
    const left = read([[lump, 1]], 0, lumpLeft)
    const top = read([[lump, 1]], 0, lumpTop)
    // Columns: Doom's x1 = floor(centerx + (vx - left) × xscale) and x2 = floor(centerx + (vx - left + width) × xscale) - 1.
    const scaledLeft = circuit.multiply(circuit.affine([[across, 1], [left, -1]]), inverseZ)
    const scaledRight = circuit.multiply(circuit.affine([[across, 1], [left, -1], [width, 1]]), inverseZ)
    // The thing and the eye are inside the map, at most about 5,400 units apart in E1M1, and lumps' left offsets and
    // widths are within ±256, so with 1/z at most 1/nearest these stay within ±1,500. The bound assumes a map under
    // about 15,800 units across.
    circuit.assumeRange(scaledLeft, -(2 ** 12), 2 ** 12, {allowExistingReaders: true})
    circuit.assumeRange(scaledRight, -(2 ** 12), 2 ** 12, {allowExistingReaders: true})
    const unclippedX1 = emitFloorish(circuit, [[scaledLeft, half]], centerX)
    const x1 = clampTo(unclippedX1, -1, view.width)
    const x2 = clampTo(emitFloorish(circuit, [[scaledRight, half]], centerX - 1), -1, view.width)
    const columnStep = circuit.affine([[clampedDepth, 1 / half]])
    // Rows: the sprite's top is z + top above the eye, and row r shows texture row rel - (centerY - r) × z / focalY.
    const rel = circuit.affine([[thing.z, 1], [top, 1], [eye.z, -1]])
    const topY = circuit.multiply(rel, inverseZ)
    const bottomY = circuit.multiply(circuit.affine([[rel, 1], [height, -1]]), inverseZ)
    // The thing's and the eye's z are within ±4096, a lump's top offset is a 16-bit patch offset and its height at
    // most 512, as the slot's cell declares, so |rel| and |rel - height| are below 2^16, and 1/z is at most 1/nearest.
    circuit.assumeRange(topY, -(2 ** 14), 2 ** 14, {allowExistingReaders: true})
    circuit.assumeRange(bottomY, -(2 ** 14), 2 ** 14, {allowExistingReaders: true})
    // ceil(centerY - focalY × value) = -floor(focalY × value - centerY)
    const ceilRow = (value: Wire) => circuit.affine([[emitFloorish(circuit, [[value, focalY]], -centerY), -1]])
    const rowTop = clampTo(ceilRow(topY), 0, view.height)
    const rowBottom = clampTo(ceilRow(bottomY), 0, view.height)
    const onScreen = and(circuit, inFront, thing.visible,
      emitCompare(circuit, x2, '>=', circuit.constant(0)),
      emitCompare(circuit, x1, '<=', circuit.constant(view.width - 1)),
      emitCompare(circuit, rowBottom, '>', rowTop))
    const lightIndex = emitClampZeroTo(circuit, [[inverseZ, 2560]], 0, MAXLIGHTSCALE - 1)
    const lit = read([[read([[thing.sector, 1]], 0, lightRows), 1], [lightIndex, 1]], 0, scaleLight)
    projected.push({
      visible: onScreen,
      x1,
      x2,
      textureStart: emitClampZeroTo(circuit, [[circuit.reglu([[columnStep, 1]], 0, [[x1, 1], [unclippedX1, -1]], 0), 1]], 0, 512),
      inverseZ: circuit.affine([[circuit.reglu([[inverseZ, 1]], 1, [[onScreen, 1]], 0), 1]], -1),
      base: read([[lump, 1]], 0, lumpBase),
      width,
      height,
      flip,
      columnStep,
      row0: circuit.affine([[rel, 1], [clampedDepth, -centerY / focalY]]),
      rowStep: circuit.affine([[clampedDepth, 1 / focalY]]),
      rowTop,
      rowBottom,
      // Fullbright frames take the brightest colormap.
      level: circuit.reglu([[lit, 1]], 0, [[thing.bright, -1]], 1),
    })
    keys.push(projected[projected.length - 1]!.inverseZ)
  }
  // The key is 1/z for things on screen and -1 for the rest, so the nearest come first.
  const order = emitSortDescending(circuit, keys)
  // In the spec's order, which the column program's cells for the slots have.
  const spec = slotSpec(view)[0]!
  const fields = Object.keys(spec) as (keyof SlotWires)[]
  const tables = Object.fromEntries(fields.map(field => [field, projected.map(thing => thing[field])])) as Record<keyof SlotWires, Wire[]>
  // A level with fewer things than slots leaves the last slots empty: each field at its cell's initial value, which
  // isn't visible.
  return Array.from({length: spriteSlots}, (_, slot) => {
    if (slot >= projected.length) return Object.fromEntries(fields.map(field => [field, circuit.constant(spec[field].initial)])) as SlotWires
    const index = order[slot]!
    return Object.fromEntries(fields.map(field => [field, circuit.indexRead(index, tables[field])])) as SlotWires
  })
}

const and = (circuit: Circuit, ...bits: Wire[]) => emitReluSum(circuit, bits.map(wire => [wire, 1] as const), 1 - bits.length)

// A bitonic sorting network over keys, largest first, carrying each key's index. Returns the indices in order. Keys
// past the list's end are -2, below every real key.
function emitSortDescending(circuit: Circuit, keys: Wire[]): Wire[] {
  let size = 1
  while (size < keys.length) size *= 2
  let sortKeys: Wire[] = Array.from({length: size}, (_, index) => keys[index] ?? circuit.constant(-2))
  let indices: Wire[] = Array.from({length: size}, (_, index) => circuit.constant(Math.min(index, keys.length - 1)))
  for (let block = 2; block <= size; block *= 2) {
    for (let stride = block / 2; stride >= 1; stride /= 2) {
      const nextKeys = [...sortKeys]
      const nextIndices = [...indices]
      for (let first = 0; first < size; first++) {
        const second = first ^ stride
        if (second <= first) continue
        // Within an ascending half of the network the larger key goes second.
        const descending = (first & block) === 0
        const [high, low] = descending ? [first, second] : [second, first]
        const swap = emitPositiveBit(circuit, [[sortKeys[low]!, 1], [sortKeys[high]!, -1]], 0, 2 ** 20)
        nextKeys[high] = circuit.indexRead(swap, [sortKeys[high]!, sortKeys[low]!])
        nextKeys[low] = circuit.indexRead(swap, [sortKeys[low]!, sortKeys[high]!])
        nextIndices[high] = circuit.indexRead(swap, [indices[high]!, indices[low]!])
        nextIndices[low] = circuit.indexRead(swap, [indices[low]!, indices[high]!])
      }
      sortKeys = nextKeys
      indices = nextIndices
    }
  }
  return indices
}

// What a column hands its rows about each sprite it draws, farthest first: whether it shows, its rows, its texture
// column's address, the texture rows at row 0 and per row, its light, and whether each masked texture is nearer.
export type SpriteColumn = {shown: Wire, rowStart: Wire, rowEnd: Wire, address: Wire, row0: Wire, rowStep: Wire, level: Wire, occluderNearer: Wire[]}

// Picks the column's up to spritesPerColumn nearest sprites. `crossingInverseZ` is 1/z at each portal step, which
// only falls along the walk, and tops and bottoms are the clip window before each step and after the last. Masked
// textures drawn before the sprites occlude them where they are nearer: `occluderInverseZ` is each one's 1/z.
export function emitSpriteColumn(
  circuit: Circuit,
  options: {column: Wire, slots: SlotWires[], crossingInverseZ: Wire[], tops: Wire[], bottoms: Wire[], occluderInverseZ?: Wire[]},
): SpriteColumn[] {
  const {column, slots, crossingInverseZ, tops, bottoms} = options
  const occluderInverseZ = options.occluderInverseZ ?? []
  const read = (index: Terms, bias: number, candidates: Wire[]) => circuit.indexReadAffine(index, bias, candidates, 'clamp', 'clamp')
  // Which slots cover this column, and each one's rank among those that do, nearest first.
  const covers = slots.map(slot => and(circuit, slot.visible,
    emitCompare(circuit, column, '>=', slot.x1),
    emitCompare(circuit, column, '<=', slot.x2)))
  const ranks: Wire[] = []
  let rank: Wire = circuit.constant(0)
  for (const cover of covers) {
    ranks.push(rank)
    rank = circuit.affine([[rank, 1], [cover, 1]])
    // Each cover is an exact bit, so the rank, a count of the covering slots so far, is a whole number.
    circuit.assumeGrid(rank, 1, {allowExistingReaders: true})
  }
  const fields = Object.keys(slots[0]!) as (keyof SlotWires)[]
  const tables = Object.fromEntries(fields.map(field => [field, slots.map(slot => slot[field])])) as Record<keyof SlotWires, Wire[]>
  const strides: number[] = []
  for (let stride = 1; stride <= crossingInverseZ.length; stride *= 2) strides.unshift(stride)
  const places: SpriteColumn[] = []
  // Far to near, so the nearest sprite is drawn last.
  for (let place = spritesPerColumn - 1; place >= 0; place--) {
    // The slot whose rank is `place`, by [rank >= place] - [rank >= place + 1] among covering slots.
    const picks = covers.map((cover, slot) => {
      // [rank < threshold] for a whole-number rank: relu(1 - relu(rank + 1 - threshold)).
      const below = (threshold: number) => emitReluSum(circuit, [[emitReluSum(circuit, [[ranks[slot]!, 1]], 1 - threshold), -1]], 1)
      return emitReluSum(circuit, [[cover, 1], [below(place), -1], [below(place + 1), 1]], -1)
    })
    const used = circuit.affine(picks.map(pick => [pick, 1] as const))
    const slotIndex: Terms = picks.map((pick, slot) => [pick, slot] as const)
    const field = (name: keyof SlotWires) => read(slotIndex, 0, tables[name])
    const inverseZ = field('inverseZ')
    // k, the number of crossings nearer than the sprite, by a binary search for the length of the run of crossings
    // whose 1/z exceeds the sprite's: 1/z only falls along the walk. The window after those k crossings clips it.
    const nearer: (readonly [Wire, number])[] = []
    for (const stride of strides) {
      const at = read(nearer, stride - 1, crossingInverseZ)
      nearer.push([emitPositiveBit(circuit, [[at, 1], [inverseZ, -1]], 0, 2 ** 20), stride])
    }
    const windowIndex: Terms = nearer
    const windowTop = read(windowIndex, 0, tops)
    const windowBottom = read(windowIndex, 0, bottoms)
    // The window's tops and bottoms are whole rows: 0, view.height and the column program's boundaries.
    circuit.assumeGrid(windowTop, 1)
    circuit.assumeGrid(windowBottom, 1)
    const rowStart = emitMax(circuit, windowTop, field('rowTop'))
    const rowEnd = emitMin(circuit, windowBottom, field('rowBottom'))
    // The larger and the smaller of two whole rows, the window's and the slot's, which emitMax and emitMin keep exact.
    circuit.assumeGrid(rowStart, 1, {allowExistingReaders: true})
    circuit.assumeGrid(rowEnd, 1, {allowExistingReaders: true})
    // The texture column: floor(textureStart + (column - x1) × columnStep), mirrored for flipped frames. Columns that
    // the sprite doesn't cover compute one too, held to the texture's 512 columns at most.
    const width = field('width')
    const height = field('height')
    const step = circuit.reglu([[field('columnStep'), 1]], 0, [[column, 1], [field('x1'), -1]], 0)
    const textureColumn = emitFloorish(circuit, [[emitClampZeroTo(circuit, [[step, 1], [field('textureStart'), 1]], 0, 512), 1]], 0, {minimum: 0, maximum: 512})
    const mirrored = circuit.reglu([[width, 1], [textureColumn, -2]], -1, [[field('flip'), 1]], 0)
    const columnIndex = emitClampZeroTo(circuit, [[textureColumn, 1], [mirrored, 1]], 0, 511)
    places.push({
      shown: and(circuit, used, emitCompare(circuit, rowEnd, '>', rowStart)),
      rowStart,
      rowEnd,
      address: circuit.affine([[field('base'), 1], [circuit.reglu([[height, 1]], 1, [[columnIndex, 1]], 0), 1]]),
      row0: field('row0'),
      rowStep: field('rowStep'),
      level: field('level'),
      occluderNearer: occluderInverseZ.map(occluder => emitPositiveBit(circuit, [[occluder, 1], [inverseZ, -1]], 0, 2 ** 20)),
    })
  }
  return places
}

// Draws a column's sprites over one row's pixel. `occluderDrawn` is whether each masked texture drew this pixel.
export function emitSpritePixel(
  circuit: Circuit,
  options: {row: Wire, places: SpriteColumn[], texels: Wire[], colormaps: Wire[], pixel: Wire, occluderDrawn: Wire[]},
): Wire {
  const {row, occluderDrawn} = options
  const read = (index: Terms, bias: number, candidates: Wire[]) => circuit.indexReadAffine(index, bias, candidates, 'clamp', 'clamp')
  let pixel = options.pixel
  for (const place of options.places) {
    const inside = and(circuit, place.shown, emitCompare(circuit, place.rowStart, '<=', row), emitCompare(circuit, place.rowEnd, '>', row))
    const texel = read([[place.address, 1], [place.row0, 1], [circuit.reglu([[place.rowStep, 1]], 0, [[row, 1]], 0), 1]], 0, options.texels)
    // Texels are palette index + 1, and 0 where the sprite is transparent.
    const opaque = circuit.affine([[texel, 1], [emitReluSum(circuit, [[texel, 1]], -1), -1]])
    let drawn = and(circuit, inside, opaque)
    if (occluderDrawn.length > 0) {
      const hidden = occluderDrawn.map((occluder, index) => and(circuit, occluder, place.occluderNearer[index]!))
      drawn = emitReluSum(circuit, [[drawn, 1], ...hidden.map(bit => [bit, -1] as const)])
    }
    const color = read([[place.level, 256], [texel, 1]], -1, options.colormaps)
    pixel = circuit.indexRead(drawn, [pixel, color])
  }
  return pixel
}

// The player's weapon: Doom's psprites, drawn over the view unscaled.
export function pspriteSpec() {
  return list(2, () => ({
    visible: inputBit(),
    base: input([0, 2 ** 22], {grid: 1}),
    width: input([1, 512], {grid: 1, initial: 1}),
    height: input([1, 512], {grid: 1, initial: 1}),
    // Texture column at screen column c is column0 + c × columnStep, and texture row at row r is row0 + r × rowStep.
    column0: input([-1024, 1024]),
    row0: input([-1024, 1024]),
    level: input([0, 31], {grid: 1}),
  }))
}

type PspriteWires = {[Field in keyof ReturnType<typeof pspriteSpec>[number]]: Wire}

// The weapon and its flash: their frames' lumps, placed as Doom's R_DrawPSprite does, at (sx - left, sy - top) in
// 320 × 200 coordinates, with the view's top row 16 rows below the screen's center line of 100.
export function emitPsprites(
  circuit: Circuit,
  catalog: SpriteCatalog,
  view: ViewConfig,
  options: {weaponFrame: Wire, flashFrame: Wire, flashVisible: Wire, x: Wire, y: Wire, weaponBright: Wire, level: Wire},
): PspriteWires[] {
  const consts = (values: number[]) => constantTable(circuit, values)
  // Rotation 0 of each frame.
  const lumpOfFrame = consts(catalog.rotations.filter((_, index) => index % 8 === 0).map(rotation => rotation.lump))
  const field = (lump: Wire, values: number[]) => circuit.indexRead(lump, consts(values))
  const columnScale = 320 / view.width
  const rowScale = 168 / view.height
  const make = (frame: Wire, visible: Wire, bright: Wire): PspriteWires => {
    const lump = circuit.indexRead(frame, lumpOfFrame)
    const left = field(lump, catalog.lumps.map(entry => entry.left))
    const top = field(lump, catalog.lumps.map(entry => entry.top))
    return {
      visible,
      base: field(lump, catalog.lumps.map(entry => entry.base)),
      width: field(lump, catalog.lumps.map(entry => entry.width)),
      height: field(lump, catalog.lumps.map(entry => entry.height)),
      column0: circuit.affine([[options.x, -1], [left, 1]], 0.5 * columnScale),
      row0: circuit.affine([[options.y, -1], [top, 1]], 100 - (view.height / 2) * rowScale),
      level: circuit.reglu([[options.level, 1]], 0, [[bright, -1]], 1),
    }
  }
  return [
    make(options.weaponFrame, circuit.constant(1), options.weaponBright),
    make(options.flashFrame, options.flashVisible, circuit.constant(1)),
  ]
}

// The rows a weapon can reach: the shotgun's pump is the tallest frame, 41 rows below the top of a 168-row view.
const firstWeaponRow = 40

// What a column hands its rows about each of the weapon's sprites: whether this column shows it, its texture column's
// address, and its rows and light.
export type PspriteColumn = {shown: Wire, address: Wire, row0: Wire, height: Wire, level: Wire}

export function emitPspriteColumn(circuit: Circuit, view: ViewConfig, options: {column: Wire, psprites: PspriteWires[]}): PspriteColumn[] {
  const columnScale = 320 / view.width
  return options.psprites.map(psprite => {
    const u = emitFloorish(circuit, [[psprite.column0, 1], [options.column, columnScale]], 0, {minimum: -2048, maximum: 2048})
    return {
      shown: and(circuit, psprite.visible,
        emitPositiveBit(circuit, [[u, 1]], 0.5),
        emitPositiveBit(circuit, [[psprite.width, 1], [u, -1]], -0.5)),
      address: circuit.affine([[psprite.base, 1], [circuit.reglu([[psprite.height, 1]], 1, [[u, 1]], 0), 1]]),
      row0: psprite.row0,
      height: psprite.height,
      level: psprite.level,
    }
  })
}

export function emitPspritePixel(
  circuit: Circuit,
  view: ViewConfig,
  options: {row: Wire, columns: PspriteColumn[], texels: Wire[], colormaps: Wire[], pixel: Wire},
): Wire {
  const rowScale = 168 / view.height
  const reachable = emitCompare(circuit, options.row, '>=', circuit.constant(Math.floor(firstWeaponRow / rowScale)))
  let pixel = options.pixel
  for (const psprite of options.columns) {
    const v = circuit.affine([[psprite.row0, 1], [options.row, rowScale]])
    const inside = and(circuit, psprite.shown, reachable,
      emitPositiveBit(circuit, [[v, 1]], 0.5 / 64),
      emitPositiveBit(circuit, [[psprite.height, 1], [v, -1]], 0))
    const texel = circuit.indexReadAffine([[psprite.address, 1], [v, 1]], 0, options.texels, 'clamp', 'clamp')
    const opaque = circuit.affine([[texel, 1], [emitReluSum(circuit, [[texel, 1]], -1), -1]])
    const color = circuit.indexReadAffine([[psprite.level, 256], [texel, 1]], -1, options.colormaps, 'clamp', 'clamp')
    pixel = circuit.indexRead(and(circuit, inside, opaque), [pixel, color])
  }
  return pixel
}
