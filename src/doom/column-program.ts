// The renderer as two programs. The column program runs once per screen column, every one of the same operations: it
// walks the column's ray through a fixed number of convex cells, narrowing a clip window of whole rows at each portal
// as Doom's ceilingclip and floorclip do, and hands its rows a record: the window's boundaries, what each interval
// shows, and the masked textures, sprites and weapon that cross the column. The pixel program runs once per pixel, on
// its column's record and its row: the row finds its interval by a binary search over the boundaries, and the interval
// says which texture, flat or sky it shows and how lit; then the overlays draw over it. tests/doom/reference.ts is the
// same renderer in plain JavaScript, without the overlays.
import {type CellSpec, type Spec, createSourceTable, input} from '../runtime/cells.ts'
import {type Circuit, type Terms, type Wire, emitCompare} from '../runtime/numeric-ui-core.ts'
import {type Assets, MAXLIGHTSCALE, MAXLIGHTZ} from './assets.ts'
import {frameSpec} from './frame-program.ts'
import {constantTable, emitClampZeroTo, emitFloorish, emitMax, emitMin, emitPositiveBit, emitReluSum, emitRound} from './ops.ts'
import {type Scene, type SceneTexture, maxEdges} from './scene.ts'
import {type PspriteColumn, type SpriteColumn, emitPspriteColumn, emitPspritePixel, emitSpriteColumn, emitSpritePixel} from './sprites.ts'
import {type SpriteCatalog} from './things.ts'
import {type ViewConfig, angleSpan, angleTables, normalFine, viewConstants} from './view.ts'

// What each interval of a column shows.
export const enum Kind {Wall = 0, Flat = 1, Sky = 2, Black = 3}

// A ray's binary search over a cell's vertices reads positions 1..16 past the entry edge.
const walkStride = maxEdges + 1

type Fields = {kind: Wire, address: Wire, height: Wire, phase0: Wire, scale: Wire, light: Wire}
// A named operation of the pixel program, for the page's x-ray.
type Stop = {wire: Wire, name: string, palette: boolean, chapter: string | null}

// A masked texture's span in a column, as the column hands it to its rows.
type MaskedColumn = {used: Wire, start: Wire, end: Wire, address: Wire, row0: Wire, rowStep: Wire, level: Wire}

// The pixel program's cells for a record of the column program's wires: each an input cell with the range and grid the
// column program proves for its wire, so that the pixel program builds the operations it would build on the wire.
type Mirrored<T> = T extends Wire ? CellSpec : {readonly [Field in keyof T]: Mirrored<T[Field]>}
function mirror<T>(circuit: Circuit, struct: T): Mirrored<T> {
  const cells = (value: unknown): Spec => {
    if (typeof value === 'number') {
      const {minimum, maximum} = circuit.ranges[value]!
      const grid = circuit.grids[value]
      const initial = Math.min(Math.max(0, minimum), maximum)
      return input([minimum, maximum], grid === undefined ? {initial} : {initial, grid})
    }
    if (Array.isArray(value)) return value.map(cells)
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([field, element]) => [field, cells(element)]))
  }
  return cells(struct) as Mirrored<T>
}

// `overlays: false` leaves out masked textures, sprites and the weapon, e.g. for comparing walls and flats alone with
// reference.ts.
export function buildColumnPrograms(scene: Scene, assets: Assets, view: ViewConfig, catalog: SpriteCatalog, options: {overlays?: boolean} = {}) {
  const overlays = options.overlays ?? true
  if (view.height % 2 !== 0) throw new Error('the view needs an even number of rows')
  const table = createSourceTable()
  const cells = table.declare({column: input([0, view.width - 1], {grid: 1}), frame: frameSpec(scene, view)})
  const circuit = table.createCircuit()
  const {frame, column} = cells
  const constants = viewConstants(view)
  const {centerY, focalY, rowFactor} = constants
  const half = view.width / 2
  const cellCount = scene.cells.length
  const consts = (values: ArrayLike<number>) => constantTable(circuit, values)
  const zero = circuit.constant(0)
  const one = circuit.constant(1)
  const read = (terms: Terms, bias: number, candidates: Wire[]) =>
    circuit.indexReadAffine(terms, bias, candidates, 'clamp', 'clamp', {indexRange: {minimum: 0, maximum: candidates.length - 1}})

  // A black texture for walls that name none, 8 × 8 texels of palette index 0, after the WAD's texels.
  const blackTexture: SceneTexture = {base: assets.texels.length, width: 8, height: 8}
  const scaleLight = consts(assets.scaleLight)
  const angles = angleTables()
  const secants = consts(angles.secant)
  // Tangents, then negated tangents for sides whose u runs against their line.
  const tangents = consts([...angles.tangent, ...angles.tangent.map(value => -value)])

  const edgeAt = (cell: number, slot: number) => scene.edges[cell * maxEdges + slot] ?? scene.edges[cell * maxEdges]!
  const perEdge = <T>(make: (edge: NonNullable<Scene['edges'][number]>) => T) =>
    Array.from({length: cellCount * maxEdges}, (_, index) => make(edgeAt(Math.floor(index / maxEdges), index % maxEdges)))
  const sectorOf = (cell: number) => scene.cells[cell]!.sector
  const nextCellTable = consts(perEdge(edge => edge.nextCell))
  const nextSlotTable = consts(perEdge(edge => edge.nextSlot))
  const solidTable = consts(perEdge(edge => edge.solid ? 1 : 0))
  const lineATable = perEdge(edge => frame.lineA[edge.line]!)
  const lineBTable = perEdge(edge => frame.lineB[edge.line]!)
  const lineHTable = perEdge(edge => frame.lineH[edge.line]!)
  const lineAbsHTable = perEdge(edge => frame.lineAbsH[edge.line]!)
  const lineFineTable = consts(perEdge(edge => {
    const line = scene.lines[edge.line]!
    return normalFine(line.ax, line.ay, line.bx, line.by)
  }))
  const sideU0Table = perEdge(edge => edge.side >= 0 ? frame.sideU0[edge.side]! : zero)
  const tangentOffsetTable = consts(perEdge(edge => {
    if (edge.side < 0) return 0
    const line = scene.lines[edge.line]!
    const side = scene.sides[edge.side]!
    return (line.bx - line.ax) * side.dirX + (line.by - line.ay) * side.dirY >= 0 ? 0 : angles.tangent.length
  }))
  // The heights each crossing projects. A wall's back is its own floor, which closes the window below its middle
  // texture. Where both sides show sky above, Doom draws no upper texture, so the front's ceiling is the back's.
  const projections = perEdge(edge => {
    const front = sectorOf(edge.cell)
    const back = sectorOf(edge.nextCell)
    const skyBoth = !edge.solid && scene.sectors[front]!.ceilingSky && scene.sectors[back]!.ceilingSky
    return {
      frontCeiling: frame.projCeiling[skyBoth ? back : front]!,
      frontFloor: frame.projFloor[front]!,
      backCeiling: edge.solid ? frame.projFloor[front]! : frame.projCeiling[back]!,
      backFloor: edge.solid ? frame.projFloor[front]! : frame.projFloor[back]!,
    }
  })
  const projFrontCeiling = projections.map(projection => projection.frontCeiling)
  const projFrontFloor = projections.map(projection => projection.frontFloor)
  const projBackCeiling = projections.map(projection => projection.backCeiling)
  const projBackFloor = projections.map(projection => projection.backFloor)
  const wallLightTable = perEdge(edge => {
    const delta = edge.side >= 0 ? scene.sides[edge.side]!.lightDelta : 0
    return frame.wallLightRow[sectorOf(edge.cell) * 3 + delta + 1]!
  })
  // Per wall interval: the texture and where its top row sits, as a frame value plus a constant.
  type WallSpec = {texture: SceneTexture, midRef: Wire, midAdd: number}
  const wallTables = (spec: (edge: NonNullable<Scene['edges'][number]>) => WallSpec) => {
    const specs = perEdge(spec)
    return {
      base: consts(specs.map(wall => wall.texture.base)),
      width: consts(specs.map(wall => wall.texture.width)),
      inverseWidth: consts(specs.map(wall => 1 / wall.texture.width)),
      height: consts(specs.map(wall => wall.texture.height)),
      inverseHeight: consts(specs.map(wall => 1 / wall.texture.height)),
      midRef: specs.map(wall => wall.midRef),
      midAdd: consts(specs.map(wall => wall.midAdd)),
    }
  }
  const blackWall: WallSpec = {texture: blackTexture, midRef: zero, midAdd: 0}
  const upperTables = wallTables(edge => {
    if (edge.side < 0) return blackWall
    const side = scene.sides[edge.side]!
    const front = sectorOf(edge.cell)
    const back = sectorOf(edge.nextCell)
    if (edge.solid) {
      const texture = side.middle
      if (texture === null) return blackWall
      return side.pegBottom
        ? {texture, midRef: frame.relFloor[front]!, midAdd: texture.height + side.yOffset}
        : {texture, midRef: frame.relCeiling[front]!, midAdd: side.yOffset}
    }
    const texture = side.upper
    if (texture === null) return blackWall
    return side.pegTop
      ? {texture, midRef: frame.relCeiling[front]!, midAdd: side.yOffset}
      : {texture, midRef: frame.relCeiling[back]!, midAdd: texture.height + side.yOffset}
  })
  const lowerTables = wallTables(edge => {
    if (edge.side < 0 || edge.solid) return blackWall
    const side = scene.sides[edge.side]!
    const texture = side.lower
    if (texture === null) return blackWall
    return side.pegBottom
      ? {texture, midRef: frame.relCeiling[sectorOf(edge.cell)]!, midAdd: side.yOffset}
      : {texture, midRef: frame.relFloor[sectorOf(edge.nextCell)]!, midAdd: side.yOffset}
  })
  // Masked middle textures of two-sided lines, e.g. E1M1's grates: drawn over what is behind them, with holes. Their
  // texels go in a table of their own, as palette index + 1 and 0 where transparent, laid out as the sprites' are
  // (things.ts): texel (u, v) at base + u × (height + 1) + v, with a transparent texel after each column.
  const maskedNames = [...new Set(scene.sides.flatMap(side => side.maskedName === null ? [] : [side.maskedName]))]
  const maskedPlacement = new Map<string, {base: number, width: number, height: number}>()
  const maskedTexels: number[] = [0]
  for (const name of maskedNames) {
    const texture = assets.maskedTextures.get(name)!
    maskedPlacement.set(name, {base: maskedTexels.length, width: texture.width, height: texture.height})
    texture.texels.forEach((texel, index) => {
      maskedTexels.push(texel + 1)
      if (index % texture.height === texture.height - 1) maskedTexels.push(0)
    })
  }
  const maskedSpec = perEdge(edge => {
    const side = edge.side >= 0 ? scene.sides[edge.side]! : null
    if (side === null || edge.solid || side.maskedName === null) return null
    const placement = maskedPlacement.get(side.maskedName)!
    const front = sectorOf(edge.cell)
    const back = sectorOf(edge.nextCell)
    const frontSector = scene.sectors[front]!
    const backSector = scene.sectors[back]!
    // Doom's R_RenderMaskedSegRange: bottom-pegged to the higher floor, else hung from the lower ceiling.
    const midRef = side.pegBottom
      ? frame.relFloor[frontSector.floor >= backSector.floor ? front : back]!
      : frame.relCeiling[frontSector.ceiling <= backSector.ceiling ? front : back]!
    return {...placement, midRef, midAdd: (side.pegBottom ? placement.height : 0) + side.yOffset}
  })
  const maskedSlots = maskedNames.length === 0 || !overlays ? 0 : 2
  const maskedTables = {
    present: consts(maskedSpec.map(spec => spec === null ? 0 : 1)),
    base: consts(maskedSpec.map(spec => spec?.base ?? 0)),
    width: consts(maskedSpec.map(spec => spec?.width ?? 1)),
    inverseWidth: consts(maskedSpec.map(spec => 1 / (spec?.width ?? 1))),
    height: consts(maskedSpec.map(spec => spec?.height ?? 1)),
    midRef: maskedSpec.map(spec => spec?.midRef ?? zero),
    midAdd: consts(maskedSpec.map(spec => spec?.midAdd ?? 0)),
  }
  type MaskedSpan = {present: Wire, address: Wire, height: Wire, row0: Wire, rowStep: Wire, start: Wire, end: Wire, level: Wire, inverseZ: Wire}
  const maskedSpans: MaskedSpan[] = []

  const perCell = <T>(make: (sector: Scene['sectors'][number], sector_: number) => T) =>
    scene.cells.map(cell => make(scene.sectors[cell.sector]!, cell.sector))
  const ceilingKind = consts(perCell(sector => sector.ceilingSky ? Kind.Sky : Kind.Flat))
  const ceilingBase = consts(perCell(sector => sector.ceilingFlat))
  const ceilingHeight = perCell((_, sector) => frame.absCeiling[sector]!)
  const floorKind = consts(perCell(sector => sector.floorSky ? Kind.Sky : Kind.Flat))
  const floorBase = consts(perCell(sector => sector.floorFlat))
  const floorHeight = perCell((_, sector) => frame.absFloor[sector]!)
  const ceilingShift = perCell((_, sector) => frame.ceilingShift[sector]!)
  const floorShift = perCell((_, sector) => frame.floorShift[sector]!)
  const flatLight = perCell((_, sector) => frame.flatLightRow[sector]!)

  // The eye's cell scanned from its first vertex: vertices past the last repeat it, so no edge there changes sign.
  const scanVertex = (index: number) => {
    const vertices = scene.cells[Math.floor(index / maxEdges)]!.vertices
    return vertices[Math.min(index % maxEdges, vertices.length - 1)]!
  }
  const scanA = Array.from({length: cellCount * maxEdges}, (_, index) => frame.vertexA[scanVertex(index)]!)
  const scanB = Array.from({length: cellCount * maxEdges}, (_, index) => frame.vertexB[scanVertex(index)]!)
  const scanSlot = consts(Array.from({length: cellCount * maxEdges}, (_, index) => {
    const n = scene.cells[Math.floor(index / maxEdges)]!.vertices.length
    const k = index % maxEdges
    return k <= n - 2 ? k : n - 1
  }))
  // A cell entered through slot i: vertex i + m for m = 0..16, where m past the last vertex reads vertex i.
  const walkIndex = (index: number) => {
    const m = index % walkStride
    const entry = Math.floor(index / walkStride) % maxEdges
    const cell = Math.floor(index / (walkStride * maxEdges))
    const vertices = scene.cells[cell]!.vertices
    const n = vertices.length
    const i = entry < n ? entry : 0
    return {vertex: vertices[m < n ? (i + m) % n : i]!, slot: (i + Math.min(m, n - 1)) % n}
  }
  const walkLength = cellCount * maxEdges * walkStride
  const walkA = Array.from({length: walkLength}, (_, index) => frame.vertexA[walkIndex(index).vertex]!)
  const walkB = Array.from({length: walkLength}, (_, index) => frame.vertexB[walkIndex(index).vertex]!)
  const walkSlot = consts(Array.from({length: walkLength}, (_, index) => walkIndex(index).slot))

  const colFine = read([[column, 1]], 0, consts(constants.colFine))
  const cosPhi = read([[column, 1]], 0, consts(constants.cosPhi))
  // The sky's texture column: Doom's (view angle + column angle) >> 22, i.e. fine angle / 8, mod the sky's width.
  const skyAddress = read([[frame.angle, 1], [colFine, 1]], 1024, consts(Array.from({length: 8192 + 2048}, (_, index) => {
    const skyColumn = ((Math.floor((index - 1024) / 8) % scene.sky.width) + scene.sky.width) % scene.sky.width
    return scene.sky.base + scene.sky.height * skyColumn
  })))
  // The ray's direction per unit of depth: forward + xs × right, with xs = (column + 0.5 - half) / half.
  const columnSin = circuit.multiply(column, frame.sin)
  const columnCos = circuit.multiply(column, frame.cos)
  const rayX = circuit.affine([[frame.cos, 1], [columnSin, 1 / half], [frame.sin, (0.5 - half) / half]])
  const rayY = circuit.affine([[frame.sin, 1], [columnCos, -1 / half], [frame.cos, -(0.5 - half) / half]])

  // [vertex is right of this column's ray], from its a - column × b.
  const rightOfRay = (a: Wire, b: Wire) => emitPositiveBit(circuit, [[a, 1], [circuit.reglu([[b, 1]], 0, [[column, 1]], 0), -1]])

  // Step 0: the edge the ray leaves the eye's cell through, where the vertices' bits go from 1 to 0.
  let cell: Wire = frame.cell
  let slot: Wire
  {
    const bits = Array.from({length: maxEdges}, (_, k) => rightOfRay(read([[cell, maxEdges]], k, scanA), read([[cell, maxEdges]], k, scanB)))
    const exits = bits.map((bit, k) => emitReluSum(circuit, [[bit, 1], [bits[(k + 1) % maxEdges]!, -1]]))
    slot = read([[cell, maxEdges], ...exits.map((exit, k) => [exit, k] as const)], 0, scanSlot)
  }

  const boundary = (wire: Wire) => {
    // Each boundary holds a projected row between the window's top and bottom so far, which start at 0 and
    // view.height. Projected rows are rounded and offset by centerY, which is whole since the row count is even, and
    // the max and min of whole rows are exact, so it is a whole row.
    circuit.assumeRange(wire, 0, view.height, {allowExistingReaders: true})
    circuit.assumeGrid(wire, 1, {allowExistingReaders: true})
    return wire
  }
  let top: Wire = circuit.constant(0)
  let bottom: Wire = circuit.constant(view.height)
  const tops: Wire[] = [top]
  const ceilings: Wire[] = []
  const bottoms: Wire[] = [bottom]
  const floors: Wire[] = []
  const topIntervals: Fields[] = []
  const bottomIntervals: Fields[] = []
  // 1/z at each step, held at a solid wall's for every step after it, since the walk past a wall reads edges of no
  // meaning. Sprites search it, which needs it never to rise.
  const crossingInverseZ: Wire[] = []
  let blocked: Wire = zero
  const lightLimit = MAXLIGHTSCALE - 1
  // The cell each step starts in, for the page's inspector.
  const walkCells: Wire[] = []
  // Whether a solid wall came before each step: past one, the walk means nothing.
  const walkBlocked: Wire[] = []
  for (let step = 0; step < view.steps; step++) {
    walkCells.push(cell)
    const edge: Terms = [[cell, maxEdges], [slot, 1]]
    const atEdge = (candidates: Wire[]) => read(edge, 0, candidates)
    const atCell = (candidates: Wire[]) => read([[cell, 1]], 0, candidates)
    const nextCell = atEdge(nextCellTable)
    const nextSlot = atEdge(nextSlotTable)

    // 1/z at the crossing, clamped to 0..4.
    const lineB = atEdge(lineBTable)
    const inverseZ = emitClampZeroTo(circuit, [[atEdge(lineATable), 1], [circuit.reglu([[lineB, 1]], 0, [[column, 1]], 0), 1]], 0, 4)
    // A projected height's row: centerY - projection × 1/z, rounded.
    const project = (projection: Wire) => {
      const offset = emitRound(circuit, circuit.reglu([[projection, -1]], 0, [[inverseZ, 1]], 0))
      return circuit.affine([[offset, 1]], centerY)
    }
    const frontCeilingY = project(atEdge(projFrontCeiling))
    const frontFloorY = project(atEdge(projFrontFloor))
    const backCeilingY = project(atEdge(projBackCeiling))
    const backFloorY = project(atEdge(projBackFloor))
    crossingInverseZ.push(step === 0 ? inverseZ : circuit.indexRead(blocked, [inverseZ, crossingInverseZ[step - 1]!]))
    walkBlocked.push(blocked)
    blocked = emitMax(circuit, blocked, atEdge(solidTable))
    const upperBottom = emitMax(circuit, frontCeilingY, backCeilingY)
    const lowerTop = emitMin(circuit, frontFloorY, backFloorY)
    const ceilingEnd = boundary(emitMax(circuit, top, emitMin(circuit, bottom, frontCeilingY)))
    const nextTop = boundary(emitMax(circuit, ceilingEnd, emitMin(circuit, bottom, upperBottom)))
    const floorStart = boundary(emitMin(circuit, bottom, emitMax(circuit, nextTop, frontFloorY)))
    const nextBottom = boundary(emitMin(circuit, floorStart, emitMax(circuit, nextTop, lowerTop)))
    ceilings.push(ceilingEnd)
    tops.push(nextTop)
    floors.push(floorStart)
    bottoms.push(nextBottom)

    // The wall's colormap level from its scale, Doom's rw_scale >> 12 = 2560 / z.
    const lightIndex = emitClampZeroTo(circuit, [[inverseZ, 2560]], 0, lightLimit)
    const level = read([[atEdge(wallLightTable), 1], [lightIndex, 1]], 0, scaleLight)
    // The ray's angle from the line's normal, then depth z = |h| × |sec| × cos(column angle), and u along the wall.
    const delta: Terms = [[frame.angle, 1], [colFine, 1], [atEdge(lineFineTable), -1]]
    const secant = read(delta, angleSpan, secants)
    const tangent = read([...delta, [atEdge(tangentOffsetTable), 1]], angleSpan, tangents)
    const z = circuit.multiply(circuit.multiply(atEdge(lineAbsHTable), secant), cosPhi)
    const u = circuit.affine([[atEdge(sideU0Table), 1], [circuit.multiply(atEdge(lineHTable), tangent), 1]])
    const wall = (tables: ReturnType<typeof wallTables>): Fields => {
      const width = atEdge(tables.width)
      const height = atEdge(tables.height)
      const inverseHeight = atEdge(tables.inverseHeight)
      const periods = circuit.multiply(u, atEdge(tables.inverseWidth))
      // floorish is one more than floor within 2^-10 below a whole number, so the fraction can come out just below 0:
      // the gate holds it at 0, where it would otherwise floor to -1, the last column of the texture before.
      const periodsFloor = emitFloorish(circuit, [[periods, 1]])
      const columnIndex = circuit.reglu([[width, 1]], 0, [[periods, 1], [periodsFloor, -1]], 0)
      circuit.assumeRange(columnIndex, 0, 257, {allowExistingReaders: true})
      const columnFloor = emitFloorish(circuit, [[columnIndex, 1]])
      const address = circuit.affine([[atEdge(tables.base), 1], [circuit.reglu([[height, 1]], 0, [[columnFloor, 1]], 0), 1]])
      const midRef = atEdge(tables.midRef)
      const midAdd = atEdge(tables.midAdd)
      // Doom's v at row r is textureMid + (r - centerY) × z / focalY, here in texture heights.
      const phase0 = circuit.reglu([[midRef, 1], [midAdd, 1], [z, -centerY / focalY]], 0, [[inverseHeight, 1]], 0)
      const phaseStep = circuit.reglu([[z, 1 / focalY]], 0, [[inverseHeight, 1]], 0)
      return {kind: circuit.constant(Kind.Wall), address, height, phase0, scale: phaseStep, light: level}
    }
    const upper = wall(upperTables)
    const lower = wall(lowerTables)
    if (maskedSlots > 0) {
      // The masked texture's column, its rows from the top of the texture at texMid, and the window this crossing
      // leaves, which clips it.
      const width = atEdge(maskedTables.width)
      const height = atEdge(maskedTables.height)
      const periods = circuit.multiply(u, atEdge(maskedTables.inverseWidth))
      const periodsFloor = emitFloorish(circuit, [[periods, 1]])
      const columnIndex = circuit.reglu([[width, 1]], 0, [[periods, 1], [periodsFloor, -1]], 0)
      // The gated fraction is within 0..1, so the index is within 0..width, and textures are at most 256 wide.
      circuit.assumeRange(columnIndex, 0, 257, {allowExistingReaders: true})
      const columnFloor = emitFloorish(circuit, [[columnIndex, 1]])
      const textureMid: Terms = [[atEdge(maskedTables.midRef), 1], [atEdge(maskedTables.midAdd), 1]]
      // Rows: the texture's top at centerY - texMid × focalY / z, its bottom height × focalY / z below.
      const topOffset = circuit.reglu(textureMid, 0, [[inverseZ, focalY]], 0)
      const heightRows = circuit.reglu([[height, 1]], 0, [[inverseZ, focalY]], 0)
      // 1/z is at most 4, so at 168 rows, where focalY is 160, these are at most 640 times the texture's middle and
      // height. The bounds assume both under 1,638 units, as in E1M1: its masked textures are 128 tall, and their
      // middles, a sector's height less the eye's plus up to 128, stay within about ±600, its heights being -136..264.
      circuit.assumeRange(topOffset, -(2 ** 20), 2 ** 20, {allowExistingReaders: true})
      circuit.assumeRange(heightRows, 0, 2 ** 20, {allowExistingReaders: true})
      // ceil(centerY - topOffset) = -floor(topOffset - centerY)
      const firstRow = circuit.affine([[emitFloorish(circuit, [[topOffset, 1]], -centerY), -1]])
      const pastRow = circuit.affine([[emitFloorish(circuit, [[topOffset, 1], [heightRows, -1]], -centerY), -1]])
      const clampRow = (wire: Wire) => {
        const clamped = circuit.affine([[emitClampZeroTo(circuit, [[wire, 1]], 0, view.height), 1]])
        // The row clamped to 0..view.height. Both callers pass a max and min of whole rows, and clamping a whole
        // number to whole bounds keeps it whole.
        circuit.assumeRange(clamped, 0, view.height, {allowExistingReaders: true})
        circuit.assumeGrid(clamped, 1, {allowExistingReaders: true})
        return clamped
      }
      const start = clampRow(emitMax(circuit, emitMin(circuit, firstRow, circuit.constant(view.height)), nextTop))
      const end = clampRow(emitMin(circuit, emitMax(circuit, pastRow, circuit.constant(0)), nextBottom))
      const iscale = circuit.affine([[z, 1 / focalY]])
      maskedSpans.push({
        present: emitReluSum(circuit, [[atEdge(maskedTables.present), 1], [emitCompare(circuit, end, '>', start), 1]], -1),
        address: circuit.affine([[atEdge(maskedTables.base), 1], [circuit.reglu([[height, 1]], 1, [[columnFloor, 1]], 0), 1]]),
        height,
        row0: circuit.affine(textureMid.map(([wire, c]) => [wire, c] as const).concat([[iscale, -centerY]])),
        rowStep: iscale,
        start,
        end,
        level,
        inverseZ,
      })
    }
    const light = atCell(flatLight)
    const flatAddress = (base: Wire[], shift: Wire[]) => circuit.affine([[atCell(base), 1], [atCell(shift), 1]])
    topIntervals.push({kind: atCell(ceilingKind), address: flatAddress(ceilingBase, ceilingShift), height: one, phase0: zero, scale: atCell(ceilingHeight), light}, upper)
    bottomIntervals.push({kind: atCell(floorKind), address: flatAddress(floorBase, floorShift), height: one, phase0: zero, scale: atCell(floorHeight), light}, lower)

    top = nextTop
    bottom = nextBottom
    // The edge the ray leaves the next cell through: the last vertex right of the ray past the entry edge, by a binary
    // search over m = 1..16, where m past the cell's last vertex reads the entry vertex, which is left of the ray.
    const walkBase: Terms = [[nextCell, maxEdges * walkStride], [nextSlot, walkStride]]
    const m: (readonly [Wire, number])[] = []
    for (const stride of [8, 4, 2, 1]) {
      const at: Terms = [...walkBase, ...m]
      m.push([rightOfRay(read(at, 1 + stride, walkA), read(at, 1 + stride, walkB)), stride])
    }
    slot = read([...walkBase, ...m], 1, walkSlot)
    cell = nextCell
  }

  // The column's intervals, top to bottom: T0 c0 T1 c1 ... T_K, then B_K f_(K-1) B_(K-1) ... f0 B0.
  const black: Fields = {kind: circuit.constant(Kind.Black), address: zero, height: one, phase0: zero, scale: zero, light: zero}
  const boundaries: Wire[] = []
  const intervals: Fields[] = []
  for (let step = 0; step < view.steps; step++) {
    boundaries.push(tops[step]!, ceilings[step]!)
    intervals.push(topIntervals[2 * step]!, topIntervals[2 * step + 1]!)
  }
  boundaries.push(tops[view.steps]!, bottoms[view.steps]!)
  intervals.push(black)
  for (let step = view.steps - 1; step >= 0; step--) {
    boundaries.push(floors[step]!, bottoms[step]!)
    intervals.push(bottomIntervals[2 * step + 1]!, bottomIntervals[2 * step]!)
  }
  const field = (name: keyof Fields) => intervals.map(interval => interval[name])

  // Masked textures: the first spans down the walk, farthest first, each one's 1/z for the sprites behind it.
  const masked: MaskedColumn[] = []
  const occluderInverseZ: Wire[] = []
  if (maskedSlots > 0) {
    const ranks: Wire[] = []
    let rank: Wire = zero
    for (const span of maskedSpans) {
      ranks.push(rank)
      rank = circuit.affine([[rank, 1], [span.present, 1]])
    }
    const fields = Object.keys(maskedSpans[0]!) as (keyof MaskedSpan)[]
    const tables = Object.fromEntries(fields.map(name => [name, maskedSpans.map(span => span[name])])) as Record<keyof MaskedSpan, Wire[]>
    for (let place = maskedSlots - 1; place >= 0; place--) {
      const picks = maskedSpans.map((span, step) => {
        const below = (threshold: number) => emitReluSum(circuit, [[emitReluSum(circuit, [[ranks[step]!, 1]], 1 - threshold), -1]], 1)
        return emitReluSum(circuit, [[span.present, 1], [below(place), -1], [below(place + 1), 1]], -1)
      })
      const index: Terms = picks.map((pick, step) => [pick, step] as const)
      const pick = (name: keyof MaskedSpan) => read(index, 0, tables[name])
      const start = pick('start')
      const end = pick('end')
      // Reads of the spans' starts and ends, which clampRow keeps whole.
      circuit.assumeGrid(start, 1)
      circuit.assumeGrid(end, 1)
      masked.push({
        used: circuit.affine(picks.map(bit => [bit, 1] as const)),
        start,
        end,
        address: pick('address'),
        row0: pick('row0'),
        rowStep: pick('rowStep'),
        level: pick('level'),
      })
      occluderInverseZ.push(pick('inverseZ'))
    }
  }
  const sprites: SpriteColumn[] = overlays
    ? emitSpriteColumn(circuit, {column, slots: frame.sprites, crossingInverseZ, tops, bottoms, occluderInverseZ})
    : []
  const psprites: PspriteColumn[] = overlays ? emitPspriteColumn(circuit, view, {column, psprites: frame.psprites}) : []
  // What the column hands each of its rows.
  const record = {
    boundaries,
    kind: field('kind'),
    address: field('address'),
    height: field('height'),
    phase0: field('phase0'),
    scale: field('scale'),
    light: field('light'),
    rayX,
    rayY,
    skyAddress,
    viewX: frame.viewX,
    viewY: frame.viewY,
    masked,
    sprites,
    psprites,
  }
  const columns = {
    cells,
    output: {record},
    debug: {boundaries, kinds: field('kind'), walkCells, walkBlocked, crossingInverseZ},
    ...table.finish(),
  }

  // The pixel program: one row of one column.
  const pixelTable = createSourceTable()
  const pixelCells = pixelTable.declare({row: input([0, view.height - 1], {grid: 1}), record: mirror(circuit, record)})
  const pixel = pixelTable.createCircuit()
  const {row, record: fromColumn} = pixelCells
  const pixelConsts = (values: ArrayLike<number>) => constantTable(pixel, values)
  const pixelRead = (terms: Terms, bias: number, candidates: Wire[]) =>
    pixel.indexReadAffine(terms, bias, candidates, 'clamp', 'clamp', {indexRange: {minimum: 0, maximum: candidates.length - 1}})
  const pixelTexels = pixelConsts([...assets.texels, ...new Array<number>(64).fill(0)])
  const pixelColormaps = pixelConsts(assets.colormaps)
  // Named operations, in the order they're built, for the page's x-ray: palette marks those whose values are palette
  // indices, which it shows through Doom's palette, and chapter the few it offers as stops to jump to. Naming a wire
  // changes nothing in the program; a name whose wire the compiler leaves out, or makes a constant, goes unused.
  const stops: Stop[] = []
  const stop = (wire: Wire, name: string, options: {palette?: boolean, chapter?: string} = {}) => {
    stops.push({wire, name, palette: options.palette ?? false, chapter: options.chapter ?? null})
    return wire
  }
  const strides: number[] = []
  for (let stride = 1; stride < fromColumn.boundaries.length; stride *= 2) strides.unshift(stride)
  // The interval: the last boundary at or above the row.
  const index: (readonly [Wire, number])[] = []
  for (const stride of strides) {
    // Past the last boundary the read clamps to the column's bottom, which is below every row. Every boundary is a
    // whole row, as the column program's are.
    const at =pixel.indexReadAffine(index, stride, fromColumn.boundaries, 'clamp', 'clamp')
    pixel.assumeGrid(at, 1)
    const step = index.length + 1
    // The first step's boundary is a cell of the record, which no operation reads into the program.
    stop(at, `search step ${step}: the boundary it probes`)
    index.push([stop(emitCompare(pixel, at, '<=', row), `search step ${step}: whether that boundary is at or above the row`, step === 1 ? {chapter: 'search'} : {}), stride])
  }
  const kind = stop(pixelRead(index, 0, fromColumn.kind), 'the interval\'s kind: wall, flat, sky or none', {chapter: 'interval'})
  const address = stop(pixelRead(index, 0, fromColumn.address), 'the interval\'s texture address')
  const height = stop(pixelRead(index, 0, fromColumn.height), 'the interval\'s texture height')
  const phase0 = stop(pixelRead(index, 0, fromColumn.phase0), 'the interval\'s texture row at row 0')
  const scale = stop(pixelRead(index, 0, fromColumn.scale), 'the interval\'s texture rows per screen row')
  const light = stop(pixelRead(index, 0, fromColumn.light), 'the interval\'s light level')
  // A wall: the texture row at phase0 + row × scale texture heights.
  const scaleRow = pixel.reglu([[scale, 1]], 0, [[row, 1]], 0)
  const phaseFloor = emitFloorish(pixel, [[phase0, 1], [scaleRow, 1]])
  // Gated as the column's index is, at 0 rather than just below it.
  const textureRow = stop(pixel.reglu([[height, 1]], 0, [[phase0, 1], [scaleRow, 1], [phaseFloor, -1]], 0), 'a wall\'s texture row')
  pixel.assumeRange(textureRow, 0, 257, {allowExistingReaders: true})
  // Floored before it meets the address: at addresses near 2^20 an FP32 sum keeps only 1/16 of a texel, and
  // 2.99 + 578560 would round to the next texel.
  const wallTexel = stop(pixelRead([[address, 1], [emitFloorish(pixel, [[textureRow, 1]]), 1]], 0, pixelTexels), 'a wall\'s texel, unlit', {palette: true, chapter: 'walls'})
  // A flat: depth z = plane height × the row's factor, and the world point the ray reaches at that depth.
  const depth = stop(pixel.multiply(scale, pixelRead([[row, 1]], 0, pixelConsts(rowFactor))), 'a flat\'s depth', {chapter: 'depth'})
  const alongX = pixel.reglu([[fromColumn.rayX, 1]], 0, [[depth, 1]], 0)
  const alongY = pixel.reglu([[fromColumn.rayY, 1]], 0, [[depth, 1]], 0)
  const blockX = emitFloorish(pixel, [[fromColumn.viewX, 1 / 64], [alongX, 1 / 64]])
  const blockY = emitFloorish(pixel, [[fromColumn.viewY, -1 / 64], [alongY, -1 / 64]])
  const flatRow = emitFloorish(pixel, [[fromColumn.viewY, -1], [alongY, -1], [blockY, -64]], 0, {minimum: -1, maximum: 65})
  const flatTexel = stop(pixelRead([[address, 1], [flatRow, 64], [fromColumn.viewX, 1], [alongX, 1], [blockX, -64]], 0, pixelConsts(assets.flatTexels)), 'a flat\'s texel, unlit', {palette: true, chapter: 'flats'})
  const zIndex = emitClampZeroTo(pixel, [[depth, 1 / 16]], 0, MAXLIGHTZ - 1)
  const flatLevel = stop(pixelRead([[light, 1], [zIndex, 1]], 0, pixelConsts(assets.zLight)), 'a flat\'s light level, darker with depth')
  // The sky: Doom's sky texture row 100 + (row - centerY) in 200-row units.
  const skyRows = Array.from({length: view.height}, (_, at) => (((Math.floor(100 + (at - centerY) * 168 / view.height)) % scene.sky.height) + scene.sky.height) % scene.sky.height)
  const skyTexel = stop(pixelRead([[fromColumn.skyAddress, 1], [pixelRead([[row, 1]], 0, pixelConsts(skyRows)), 1]], 0, pixelTexels), 'the sky\'s texel', {palette: true, chapter: 'sky'})
  const texel = stop(pixel.indexRead(kind, [wallTexel, flatTexel, skyTexel, pixel.constant(0)]), 'the texel the interval\'s kind picks, unlit', {palette: true, chapter: 'unlit'})
  const shade = stop(pixel.indexRead(kind, [light, flatLevel, pixel.constant(0), pixel.constant(31)]), 'the light level the interval\'s kind picks', {chapter: 'light'})
  let drawn = stop(pixelRead([[shade, 256], [texel, 1]], 0, pixelColormaps), 'the texel through its colormap: lit', {palette: true, chapter: 'lit'})
  // Masked textures, farthest first over the walls and flats, and whether each drew here, which hides sprites behind it.
  const occluderDrawn: Wire[] = []
  if (fromColumn.masked.length > 0) {
    const maskedTable = pixelConsts(maskedTexels)
    for (const span of fromColumn.masked) {
      const inside = emitReluSum(pixel, [
        [span.used, 1],
        [emitCompare(pixel, span.start, '<=', row), 1],
        [emitCompare(pixel, span.end, '>', row), 1],
      ], -2)
      const maskedTexel = pixel.indexReadAffine([[span.address, 1], [span.row0, 1], [pixel.reglu([[span.rowStep, 1]], 0, [[row, 1]], 0), 1]], 0, maskedTable, 'clamp', 'clamp')
      const opaque = pixel.affine([[maskedTexel, 1], [emitReluSum(pixel, [[maskedTexel, 1]], -1), -1]])
      const color = pixel.indexReadAffine([[span.level, 256], [maskedTexel, 1]], -1, pixelColormaps, 'clamp', 'clamp')
      const drawnHere = emitReluSum(pixel, [[inside, 1], [opaque, 1]], -1)
      occluderDrawn.push(drawnHere)
      drawn = stop(pixel.indexRead(drawnHere, [drawn, color]), `masked texture ${occluderDrawn.length} drawn over it`, {palette: true, ...occluderDrawn.length === fromColumn.masked.length ? {chapter: 'masked'} : {}})
    }
  }
  if (overlays) {
    const spriteTexels = pixelConsts(catalog.texels)
    drawn = stop(emitSpritePixel(pixel, {row, places: fromColumn.sprites, texels: spriteTexels, colormaps: pixelColormaps, pixel: drawn, occluderDrawn}), 'the sprites drawn over it', {palette: true, chapter: 'sprites'})
    drawn = stop(emitPspritePixel(pixel, view, {row, columns: fromColumn.psprites, texels: spriteTexels, colormaps: pixelColormaps, pixel: drawn}), 'the weapon drawn over it: the pixel', {palette: true, chapter: 'weapon'})
  }
  const pixels = {cells: pixelCells, output: {pixel: drawn}, debug: {stops}, ...pixelTable.finish()}
  return {columns, pixels}
}
