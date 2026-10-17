// The renderer in plain JavaScript, in float64, step for step what the column program computes: a fixed number of
// portal steps per column, each finding the edge its ray leaves a convex cell through, a clip window of whole rows
// that each step narrows, and then, per pixel, which interval of the column the pixel is in and what that interval
// shows, for walls, flats and sky, without the masked textures, sprites and weapon over them. Tests compare the column
// program against it, and the angle and light quantization match the program's.
import {type Assets, MAXLIGHTSCALE, MAXLIGHTZ} from '../../src/doom/assets.ts'
import {Kind} from '../../src/doom/column-program.ts'
import {type Scene, type SceneTexture, maxEdges} from '../../src/doom/scene.ts'
import {type ViewConfig, angleSpan, angleTables, fineAngles, normalFine, viewConstants} from '../../src/doom/view.ts'

type ViewState = {
  x: number
  y: number
  // The eye's height.
  z: number
  // The view angle in fine angles, 0..8191, counterclockwise from east.
  angle: number
  // The cell the eye is in.
  cell: number
}

// Heights and light that change while playing, e.g. a door's ceiling. Defaults to the scene's.
type SectorState = {floor: number[], ceiling: number[], light: number[]}

function initialSectorState(scene: Scene): SectorState {
  return {
    floor: scene.sectors.map(sector => sector.floor),
    ceiling: scene.sectors.map(sector => sector.ceiling),
    light: scene.sectors.map(sector => sector.light),
  }
}

type Interval = {
  kind: Kind
  // Wall: the texture column's address and texture height, the phase in texture heights at row 0 and per row, and the
  // colormap level. Flat: the flat's address, the plane's height from the eye, and the zlight row.
  address: number
  texHeight: number
  phase0: number
  phaseStep: number
  level: number
  planeHeight: number
  lightRow: number
}

const black: Interval = {kind: Kind.Black, address: 0, texHeight: 1, phase0: 0, phaseStep: 0, level: 0, planeHeight: 0, lightRow: 0}

// For tests: the steps of one column.
export type ColumnTrace = {cells: number[], slots: number[], boundaries: number[], intervals: Interval[]}

function prepareReference(scene: Scene, view: ViewConfig) {
  const constants = viewConstants(view)
  const tables = angleTables()
  const lineNormals = scene.lines.map(line => {
    const length = Math.hypot(line.bx - line.ax, line.by - line.ay)
    return {nx: (line.by - line.ay) / length, ny: -(line.bx - line.ax) / length, fine: normalFine(line.ax, line.ay, line.bx, line.by)}
  })
  // The direction a side's u grows along, relative to its line's direction: +1 or -1.
  const sideSign = scene.edges.map(edge => {
    if (edge === null || edge.side < 0) return 1
    const line = scene.lines[edge.line]!
    const side = scene.sides[edge.side]!
    return Math.sign((line.bx - line.ax) * side.dirX + (line.by - line.ay) * side.dirY)
  })
  return {constants, tables, lineNormals, sideSign}
}

function roundHalfEven(value: number) {
  const rounded = Math.round(value)
  return rounded - value === 0.5 && rounded % 2 !== 0 ? rounded - 1 : rounded
}

const projectionLimit = 2 ** 19
const clampProjection = (value: number) => Math.max(-projectionLimit, Math.min(projectionLimit, value))

/** @public */
export function renderReference(
  scene: Scene,
  assets: Assets,
  view: ViewConfig,
  state: ViewState,
  sectors: SectorState = initialSectorState(scene),
  prepared = prepareReference(scene, view),
  traces?: ColumnTrace[],
): Uint8Array {
  const {constants, tables, lineNormals, sideSign} = prepared
  const {centerY, focalY, colFine, cosPhi, rowFactor} = constants
  const halfWidth = view.width / 2
  const theta = state.angle * 2 * Math.PI / fineAngles
  const fx = Math.cos(theta)
  const fy = Math.sin(theta)
  const rx = Math.sin(theta)
  const ry = -Math.cos(theta)

  // Per vertex: s'(c) = a - c × b has the sign of the vertex's offset to the right of column c's ray.
  const vertexA = scene.vertices.map(vertex => {
    const vx = (vertex.x - state.x) * rx + (vertex.y - state.y) * ry
    const vz = (vertex.x - state.x) * fx + (vertex.y - state.y) * fy
    return halfWidth * vx + (halfWidth - 0.5) * vz
  })
  const vertexB = scene.vertices.map(vertex => (vertex.x - state.x) * fx + (vertex.y - state.y) * fy)
  // Per line: 1/z at column c is A + c × B, and h is the signed distance from the eye along the line's normal.
  const lineH = scene.lines.map((line, index) => {
    const normal = lineNormals[index]!
    return (line.ax - state.x) * normal.nx + (line.ay - state.y) * normal.ny
  })
  const lineAB = scene.lines.map((_, index) => {
    const normal = lineNormals[index]!
    const h = lineH[index]!
    // h / max(|h|, 1/4)², which is 1/h away from 0, as the frame program computes it.
    const inverseH = h / Math.max(1 / 4, Math.abs(h)) ** 2
    const nvx = normal.nx * rx + normal.ny * ry
    const nvz = normal.nx * fx + normal.ny * fy
    return {A: (nvz + nvx * (0.5 - halfWidth) / halfWidth) * inverseH, B: nvx / halfWidth * inverseH}
  })
  // Per side: u at the foot of the perpendicular from the eye.
  const sideU0 = scene.sides.map(side => (state.x - side.startX) * side.dirX + (state.y - side.startY) * side.dirY + side.xOffset)
  const ceilingHeight = (sector: number) => sectors.ceiling[sector]! - state.z
  const floorHeight = (sector: number) => sectors.floor[sector]! - state.z
  const lightNumber = (sector: number) => Math.floor(sectors.light[sector]! / 16)

  const sign = (vertex: number, column: number) => vertexA[vertex]! - column * vertexB[vertex]! > 0 ? 1 : 0
  const image = new Uint8Array(view.width * view.height)
  for (let column = 0; column < view.width; column++) {
    const trace: ColumnTrace = {cells: [], slots: [], boundaries: [], intervals: []}
    // Step 0: the eye's cell, by a scan of every vertex.
    let cell = state.cell
    let slot: number
    {
      const vertices = scene.cells[cell]!.vertices
      const n = vertices.length
      slot = 0
      for (let k = 0; k < n; k++) {
        if (sign(vertices[k]!, column) === 1 && sign(vertices[(k + 1) % n]!, column) === 0) slot = k
      }
    }
    let top = 0
    let bottom = view.height
    const tops: number[] = [0]
    const ceilings: number[] = []
    const bottoms: number[] = [view.height]
    const floors: number[] = []
    const topIntervals: Interval[] = []
    const bottomIntervals: Interval[] = []
    for (let step = 0; step < view.steps; step++) {
      trace.cells.push(cell)
      trace.slots.push(slot)
      const edge = scene.edges[cell * maxEdges + slot]!
      const front = scene.cells[cell]!.sector
      const back = scene.cells[edge.nextCell]!.sector
      const frontSector = scene.sectors[front]!
      const backSector = scene.sectors[back]!
      const ab = lineAB[edge.line]!
      const inverseZ = Math.min(4, Math.max(0, ab.A + column * ab.B))
      const project = (height: number) => centerY + roundHalfEven(-clampProjection(height * focalY) * inverseZ)
      const skyBoth = !edge.solid && frontSector.ceilingSky && backSector.ceilingSky
      const frontCeilingY = project(ceilingHeight(skyBoth ? back : front))
      const frontFloorY = project(floorHeight(front))
      const backCeilingY = edge.solid ? frontFloorY : project(ceilingHeight(back))
      const backFloorY = edge.solid ? frontFloorY : project(floorHeight(back))
      const upperBottom = Math.max(frontCeilingY, backCeilingY)
      const lowerTop = Math.min(frontFloorY, backFloorY)
      const ceilingEnd = Math.max(top, Math.min(bottom, frontCeilingY))
      const nextTop = Math.max(ceilingEnd, Math.min(bottom, upperBottom))
      const floorStart = Math.min(bottom, Math.max(nextTop, frontFloorY))
      const nextBottom = Math.min(floorStart, Math.max(nextTop, lowerTop))
      ceilings.push(ceilingEnd)
      tops.push(nextTop)
      floors.push(floorStart)
      bottoms.push(nextBottom)

      // What the walls of this crossing show.
      const lineInfo = lineNormals[edge.line]!
      const h = lineH[edge.line]!
      const delta = state.angle + colFine[column]! - lineInfo.fine + angleSpan
      const z = Math.abs(h) * tables.secant[delta]! * cosPhi[column]!
      const lightRow = Math.max(0, Math.min(15, lightNumber(front) + (edge.side >= 0 ? scene.sides[edge.side]!.lightDelta : 0))) * MAXLIGHTSCALE
      const level = assets.scaleLight[lightRow + Math.min(MAXLIGHTSCALE - 1, Math.floor(2560 * inverseZ))]!
      const wall = (texture: SceneTexture | null, textureMid: number): Interval => {
        if (texture === null || edge.side < 0) return black
        const side = scene.sides[edge.side]!
        const u = sideU0[edge.side]! + sideSign[cell * maxEdges + slot]! * h * tables.tangent[delta]!
        const periods = u / texture.width
        const columnIndex = Math.floor((periods - Math.floor(periods)) * texture.width)
        const iscale = z / focalY
        return {
          kind: Kind.Wall,
          address: texture.base + texture.height * columnIndex,
          texHeight: texture.height,
          phase0: (textureMid + side.yOffset - centerY * iscale) / texture.height,
          phaseStep: iscale / texture.height,
          level,
          planeHeight: 0,
          lightRow: 0,
        }
      }
      const side = edge.side >= 0 ? scene.sides[edge.side]! : null
      let upper: Interval = black
      let lower: Interval = black
      if (side !== null) {
        if (edge.solid) {
          const texture = side.middle
          upper = wall(texture, side.pegBottom ? floorHeight(front) + (texture?.height ?? 0) : ceilingHeight(front))
        } else {
          const texture = side.upper
          upper = wall(texture, side.pegTop ? ceilingHeight(front) : ceilingHeight(back) + (texture?.height ?? 0))
          lower = wall(side.lower, side.pegBottom ? ceilingHeight(front) : floorHeight(back))
        }
      }
      // An animated flat at tic 0 shows its own member: phase × 4096 past its group's first.
      const shift = (animation: Scene['sectors'][number]['floorAnimation']) => animation === null ? 0 : 4096 * (animation.phase % animation.frames)
      const plane = (height: number, flat: number, sky: boolean): Interval => sky
        ? {...black, kind: Kind.Sky}
        : {...black, kind: Kind.Flat, address: flat, planeHeight: Math.abs(height), lightRow: lightNumber(front) * MAXLIGHTZ}
      topIntervals.push(plane(ceilingHeight(front), frontSector.ceilingFlat + shift(frontSector.ceilingAnimation), frontSector.ceilingSky), upper)
      bottomIntervals.push(plane(floorHeight(front), frontSector.floorFlat + shift(frontSector.floorAnimation), frontSector.floorSky), lower)

      top = nextTop
      bottom = nextBottom
      // The next cell, and the edge its ray leaves through: the last vertex right of the ray, walking from the entry
      // edge, by a binary search over vertices v_(entry + m) for m = 1..16, with every m past the cell's last vertex
      // reading the entry vertex itself.
      const nextCell = edge.nextCell
      const entry = edge.nextSlot
      const vertices = scene.cells[nextCell]!.vertices
      const n = vertices.length
      const walkVertex = (m: number) => vertices[m < n ? (entry + m) % n : entry]!
      let m = 1
      for (const stride of [8, 4, 2, 1]) {
        if (sign(walkVertex(Math.min(16, m + stride)), column) === 1) m = Math.min(16, m + stride)
      }
      slot = (entry + Math.min(m, n - 1)) % n
      cell = nextCell
    }
    // Boundaries in order down the column: T0 c0 T1 c1 ... T_K, then B_K f_(K-1) B_(K-1) ... f0 B0.
    const boundaries: number[] = []
    const intervals: Interval[] = []
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
    trace.boundaries = boundaries
    trace.intervals = intervals
    traces?.push(trace)

    // The binary search's first stride: the largest power of two below the boundaries' count.
    let searchStride = 1
    while (searchStride * 2 < boundaries.length) searchStride *= 2
    const skyColumn = (((Math.floor((state.angle + colFine[column]!) / 8)) % scene.sky.width) + scene.sky.width) % scene.sky.width
    const rayX = fx + constants.xs[column]! * rx
    const rayY = fy + constants.xs[column]! * ry
    for (let row = 0; row < view.height; row++) {
      // The interval: the last boundary at or above the row.
      let index = 0
      for (let stride = searchStride; stride >= 1; stride /= 2) {
        const candidate = Math.min(boundaries.length - 1, index + stride)
        if (boundaries[candidate]! <= row) index = candidate
      }
      const interval = intervals[Math.min(index, intervals.length - 1)]!
      let texel = 0
      let level = 0
      if (interval.kind === Kind.Wall) {
        const phase = interval.phase0 + row * interval.phaseStep
        const texRow = Math.floor((phase - Math.floor(phase)) * interval.texHeight)
        texel = assets.texels[interval.address + texRow]!
        level = interval.level
      } else if (interval.kind === Kind.Flat) {
        const z = interval.planeHeight * rowFactor[row]!
        const worldX = state.x + z * rayX
        const worldY = state.y + z * rayY
        const flatColumn = ((Math.floor(worldX) % 64) + 64) % 64
        const flatRow = ((Math.floor(-worldY) % 64) + 64) % 64
        texel = assets.flatTexels[interval.address + 64 * flatRow + flatColumn]!
        level = assets.zLight[interval.lightRow + Math.min(MAXLIGHTZ - 1, Math.floor(z / 16))]!
      } else if (interval.kind === Kind.Sky) {
        const skyRow = (((Math.floor(100 + (row - centerY) * 168 / view.height)) % scene.sky.height) + scene.sky.height) % scene.sky.height
        texel = assets.texels[scene.sky.base + scene.sky.height * skyColumn + skyRow]!
        level = 0
      } else {
        texel = 0
        level = 31
      }
      image[row * view.width + column] = assets.colormaps[level * 256 + texel]!
    }
  }
  return image
}
