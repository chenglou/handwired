// The static tables of a level, shared by the plain JavaScript reference renderer and the builder code of the programs:
// cells as lists of vertex ids, directed edges at a fixed stride per cell, the geometric lines that edges lie on, and
// what each edge looks like. Plain JavaScript that runs while building.
import {type Assets, flatAnimations, skyFlat} from './assets.ts'
import {type Level, isOneSided} from './level.ts'
import {ML_DONTPEGBOTTOM, ML_DONTPEGTOP} from './wad.ts'

// Edges per cell slot: a cell's edge k is at cell × maxEdges + k.
export const maxEdges = 16

export type SceneTexture = {base: number, width: number, height: number}

type SceneEdge = {
  cell: number
  slot: number
  // The next cell across the edge, and the slot of this edge in it, i.e. the edge a ray enters through. A wall leads
  // back into its own cell, at its own slot.
  nextCell: number
  nextSlot: number
  // Into lines: the geometric line the edge lies on.
  line: number
  // Into sides: the linedef side that faces this cell, or -1 for a free portal.
  side: number
  // Nothing behind it: a one-sided linedef.
  solid: boolean
}

type SceneLine = {ax: number, ay: number, bx: number, by: number}

// A linedef side that some edge shows.
type SceneSide = {
  linedef: number
  // The vertex where the texture's u = 0 is, and the direction along which u grows.
  startX: number
  startY: number
  dirX: number
  dirY: number
  xOffset: number
  yOffset: number
  upper: SceneTexture | null
  lower: SceneTexture | null
  middle: SceneTexture | null
  pegTop: boolean
  pegBottom: boolean
  // Doom's special 48: the texture moves one unit per tic.
  scrolls: boolean
  // The middle texture of a two-sided line, drawn masked, or null.
  maskedName: string | null
  // Doom's fake contrast: -1 for a horizontal linedef, +1 for a vertical one.
  lightDelta: number
}

// An animated flat: its group's first member and the member a sector names, Doom's i in (time / 8 + i) mod n.
type FlatAnimation = {group: number, phase: number, frames: number}

type SceneSector = {
  floor: number
  ceiling: number
  floorFlat: number
  ceilingFlat: number
  floorAnimation: FlatAnimation | null
  ceilingAnimation: FlatAnimation | null
  floorSky: boolean
  ceilingSky: boolean
  light: number
}

export type Scene = {
  vertices: {x: number, y: number}[]
  // Per cell: its sector and its vertex ids in counterclockwise order; edge k runs from vertex k to vertex k + 1.
  cells: {sector: number, vertices: number[]}[]
  // At cell × maxEdges + slot; slots past a cell's vertex count are null.
  edges: (SceneEdge | null)[]
  lines: SceneLine[]
  sides: SceneSide[]
  sectors: SceneSector[]
  sky: SceneTexture
}

export function buildScene(level: Level, assets: Assets): Scene {
  const {map} = level
  const vertexIds = new Map<{x: number, y: number}, number>()
  const vertices: {x: number, y: number}[] = []
  const vertexId = (point: {x: number, y: number}) => {
    let id = vertexIds.get(point)
    if (id === undefined) {
      id = vertices.length
      vertexIds.set(point, id)
      vertices.push({x: point.x, y: point.y})
    }
    return id
  }
  for (const cell of level.cells) {
    if (cell.edges.length > maxEdges) throw new Error(`a cell has ${cell.edges.length} edges, more than ${maxEdges}`)
  }
  const cells = level.cells.map(cell => ({sector: cell.sector, vertices: cell.edges.map(edge => vertexId(edge.a))}))

  const texture = (name: string): SceneTexture | null => {
    if (name === '-' || name === '') return null
    const info = assets.textures.get(name)
    if (info === undefined) throw new Error(`texture ${name} is not loaded`)
    return {base: info.base, width: info.width, height: info.height}
  }

  // Lines: one per undirected vertex pair.
  const lineIds = new Map<string, number>()
  const lines: SceneLine[] = []
  const sideIds = new Map<string, number>()
  const sides: SceneSide[] = []
  const edges: (SceneEdge | null)[] = Array.from({length: cells.length * maxEdges}, () => null)
  level.cells.forEach((cell, cellIndex) => {
    cell.edges.forEach((edge, slot) => {
      const a = vertexId(edge.a)
      const b = vertexId(edge.b)
      const key = a < b ? `${a},${b}` : `${b},${a}`
      let line = lineIds.get(key)
      if (line === undefined) {
        line = lines.length
        lineIds.set(key, line)
        lines.push({ax: edge.a.x, ay: edge.a.y, bx: edge.b.x, by: edge.b.y})
      }
      let side = -1
      if (edge.linedef >= 0) {
        const sideKey = `${edge.linedef},${edge.side}`
        const existing = sideIds.get(sideKey)
        if (existing === undefined) {
          const linedef = map.linedefs[edge.linedef]!
          const sidedef = map.sidedefs[edge.side === 0 ? linedef.front : linedef.back]!
          const v1 = map.vertices[linedef.v1]!
          const v2 = map.vertices[linedef.v2]!
          const start = edge.side === 0 ? v1 : v2
          const end = edge.side === 0 ? v2 : v1
          const length = Math.hypot(end.x - start.x, end.y - start.y)
          side = sides.length
          sideIds.set(sideKey, side)
          sides.push({
            linedef: edge.linedef,
            startX: start.x,
            startY: start.y,
            dirX: (end.x - start.x) / length,
            dirY: (end.y - start.y) / length,
            xOffset: sidedef.xOffset,
            yOffset: sidedef.yOffset,
            upper: texture(sidedef.upper),
            lower: texture(sidedef.lower),
            middle: texture(sidedef.middle),
            scrolls: linedef.special === 48,
            maskedName: linedef.back >= 0 && sidedef.middle !== '-' ? sidedef.middle : null,
            pegTop: (linedef.flags & ML_DONTPEGTOP) !== 0,
            pegBottom: (linedef.flags & ML_DONTPEGBOTTOM) !== 0,
            lightDelta: v1.y === v2.y ? -1 : v1.x === v2.x ? 1 : 0,
          })
        } else {
          side = existing
        }
      }
      const solid = edge.neighbor < 0 || (edge.linedef >= 0 && isOneSided(map, edge.linedef))
      let nextCell = cellIndex
      let nextSlot = slot
      if (!solid) {
        nextCell = edge.neighbor
        nextSlot = level.cells[edge.neighbor]!.edges.findIndex(back => back.a === edge.b && back.b === edge.a)
        if (nextSlot < 0) throw new Error(`edge ${cellIndex}:${slot} has no twin in cell ${edge.neighbor}`)
      }
      edges[cellIndex * maxEdges + slot] = {cell: cellIndex, slot, nextCell, nextSlot, line, side, solid}
    })
  })

  const animation = (name: string): FlatAnimation | null => {
    const group = flatAnimations.findIndex(members => members.includes(name))
    if (group < 0) return null
    const members = flatAnimations[group]!.filter(member => assets.flats.has(member))
    return {group, phase: members.indexOf(name), frames: members.length}
  }
  // An animated flat's base is its group's first member's.
  const flatBase = (name: string) => {
    const group = flatAnimations.find(members => members.includes(name))
    return assets.flats.get(group?.find(member => assets.flats.has(member)) ?? name)!
  }
  const sectors = map.sectors.map(sector => ({
    floor: sector.floor,
    ceiling: sector.ceiling,
    floorFlat: flatBase(sector.floorPic),
    ceilingFlat: flatBase(sector.ceilingPic),
    floorAnimation: animation(sector.floorPic),
    ceilingAnimation: animation(sector.ceilingPic),
    floorSky: sector.floorPic === skyFlat,
    ceilingSky: sector.ceilingPic === skyFlat,
    light: sector.light,
  }))
  const sky = texture('SKY1')!
  return {vertices, cells, edges, lines, sides, sectors, sky}
}
