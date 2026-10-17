// Turns a Doom map into convex cells joined by portals, the form that the column program walks, and a BSP tree that
// finds the cell containing a point. Plain JavaScript that runs while building.
//
// The WAD's own nodes are unusable here: Doom's node builder rounded every split vertex to whole map units, so its
// subsectors overlap and leave slivers. So this file builds its own BSP from the linedefs, with split points kept as
// float64 and shared by both sides. Each leaf is a convex polygon: the bounding box clipped by the partition lines on
// the path to it, then by the lines of its own segs. Neighboring leaves can meet at a T-junction, so every edge is
// split at every vertex that lies on it, and then each edge has exactly one neighbor across it: a cell, or nothing
// behind a one-sided wall. Adjacent cells of one sector are then merged while their union stays convex and small,
// since every portal that a ray crosses costs the column program one step.
import {type DoomMap, ML_TWOSIDED} from './wad.ts'

type Point = {x: number, y: number}

// One edge of a cell, from `a` to `b` in counterclockwise order, so the cell lies on its left.
type Edge = {
  a: Point
  b: Point
  // The cell across the edge, or -1 behind a one-sided wall.
  neighbor: number
  // The linedef the edge lies on and which of its sides faces this cell (0 front, 1 back), or -1 for a free portal
  // between two cells of one sector.
  linedef: number
  side: number
}

type Cell = {sector: number, edges: Edge[]}

// A partition: points p with cross((dx, dy), p - (x, y)) <= 0 are on its right, Doom's front, and go to `front`. A
// child >= 0 is a node, and a child < 0 is the leaf ~child.
type BspNode = {x: number, y: number, dx: number, dy: number, front: number, back: number}

export type Level = {
  map: DoomMap
  cells: Cell[]
  nodes: BspNode[]
  // The cell of each leaf, or -1 for a leaf outside the map.
  leafCell: number[]
}

type Seg = {a: Point, b: Point, linedef: number, side: number, sector: number}

const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx

// Split a convex polygon by the directed line through (x, y) along (dx, dy) into its right (front) and left (back)
// parts. Both parts get the same point object at each crossing.
function splitPolygon(polygon: Point[], x: number, y: number, dx: number, dy: number): [Point[], Point[]] {
  const scale = Math.hypot(dx, dy)
  const sides = polygon.map(point => cross(dx, dy, point.x - x, point.y - y) / scale)
  const tolerance = 1e-9
  const front: Point[] = []
  const back: Point[] = []
  for (let index = 0; index < polygon.length; index++) {
    const current = polygon[index]!
    const next = polygon[(index + 1) % polygon.length]!
    const currentSide = sides[index]!
    const nextSide = sides[(index + 1) % polygon.length]!
    if (currentSide <= tolerance) front.push(current)
    if (currentSide >= -tolerance) back.push(current)
    if ((currentSide < -tolerance && nextSide > tolerance) || (currentSide > tolerance && nextSide < -tolerance)) {
      const t = currentSide / (currentSide - nextSide)
      const crossing = {x: current.x + (next.x - current.x) * t, y: current.y + (next.y - current.y) * t}
      front.push(crossing)
      back.push(crossing)
    }
  }
  return [front, back]
}

function polygonArea(polygon: Point[]) {
  let area = 0
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index]!
    const b = polygon[(index + 1) % polygon.length]!
    area += cross(a.x, a.y, b.x, b.y)
  }
  return area / 2
}

function mapSegs(map: DoomMap): Seg[] {
  const segs: Seg[] = []
  for (const [index, linedef] of map.linedefs.entries()) {
    const v1 = map.vertices[linedef.v1]!
    const v2 = map.vertices[linedef.v2]!
    if (v1.x === v2.x && v1.y === v2.y) continue
    segs.push({a: v1, b: v2, linedef: index, side: 0, sector: map.sidedefs[linedef.front]!.sector})
    if (linedef.back >= 0) segs.push({a: v2, b: v1, linedef: index, side: 1, sector: map.sidedefs[linedef.back]!.sector})
  }
  return segs
}

// The sector that contains a point, by the nearest linedef along a ray, or -1 outside the map.
export function sectorAt(map: DoomMap, x: number, y: number) {
  // A ray direction that no map line is parallel to and that misses vertices.
  const rx = 1
  const ry = 0.0001234567
  let nearest = Infinity
  let sector = -1
  for (const linedef of map.linedefs) {
    const a = map.vertices[linedef.v1]!
    const b = map.vertices[linedef.v2]!
    const ex = b.x - a.x
    const ey = b.y - a.y
    const denominator = cross(rx, ry, ex, ey)
    if (denominator === 0) continue
    const t = cross(a.x - x, a.y - y, ex, ey) / denominator
    const u = cross(a.x - x, a.y - y, rx, ry) / denominator
    if (t <= 0 || u < 0 || u > 1 || t >= nearest) continue
    nearest = t
    // The point is on the linedef's front (right) side when cross(e, p - a) < 0.
    const onFront = cross(ex, ey, x - a.x, y - a.y) < 0
    const sidedef = onFront ? linedef.front : linedef.back
    sector = sidedef < 0 ? -1 : map.sidedefs[sidedef]!.sector
  }
  return sector
}

type Leaf = {polygon: Point[], segs: Seg[], sector: number}

function buildBsp(map: DoomMap) {
  const segs = mapSegs(map)
  const xs = map.vertices.map(vertex => vertex.x)
  const ys = map.vertices.map(vertex => vertex.y)
  const margin = 64
  const left = Math.min(...xs) - margin
  const right = Math.max(...xs) + margin
  const bottom = Math.min(...ys) - margin
  const top = Math.max(...ys) + margin
  const box: Point[] = [{x: left, y: bottom}, {x: right, y: bottom}, {x: right, y: top}, {x: left, y: top}]
  const nodes: BspNode[] = []
  const leaves: Leaf[] = []
  const sideOf = (splitter: Seg, point: Point) => {
    const dx = splitter.b.x - splitter.a.x
    const dy = splitter.b.y - splitter.a.y
    return cross(dx, dy, point.x - splitter.a.x, point.y - splitter.a.y) / Math.hypot(dx, dy)
  }
  const tolerance = 1e-7
  // Where a seg lies relative to a splitter: 'front', 'back', or 'split' with the crossing's parameter.
  const classify = (splitter: Seg, seg: Seg): 'front' | 'back' | number => {
    const sa = sideOf(splitter, seg.a)
    const sb = sideOf(splitter, seg.b)
    if (Math.abs(sa) <= tolerance && Math.abs(sb) <= tolerance) {
      const same = (splitter.b.x - splitter.a.x) * (seg.b.x - seg.a.x) + (splitter.b.y - splitter.a.y) * (seg.b.y - seg.a.y) > 0
      return same ? 'front' : 'back'
    }
    if (sa <= tolerance && sb <= tolerance) return 'front'
    if (sa >= -tolerance && sb >= -tolerance) return 'back'
    return sa / (sa - sb)
  }
  const build = (set: Seg[], region: Point[]): number => {
    // A set is convex when every seg is on or in front of every other seg's line.
    let best: Seg | null = null
    let bestScore = Infinity
    for (const splitter of set) {
      let frontCount = 0
      let backCount = 0
      let splits = 0
      for (const seg of set) {
        if (seg === splitter) continue
        const where = classify(splitter, seg)
        if (where === 'front') frontCount++
        else if (where === 'back') backCount++
        else splits++
      }
      if (backCount === 0 && splits === 0) continue
      const score = splits * 8 + Math.abs(frontCount - backCount)
      if (score < bestScore) {
        bestScore = score
        best = splitter
      }
    }
    if (best === null) {
      leaves.push({polygon: region, segs: set, sector: set.length > 0 ? set[0]!.sector : -2})
      return ~(leaves.length - 1)
    }
    const front: Seg[] = []
    const back: Seg[] = []
    for (const seg of set) {
      const where = seg === best ? 'front' : classify(best, seg)
      if (where === 'front') front.push(seg)
      else if (where === 'back') back.push(seg)
      else {
        const crossing = {x: seg.a.x + (seg.b.x - seg.a.x) * where, y: seg.a.y + (seg.b.y - seg.a.y) * where}
        const first = {...seg, b: crossing}
        const second = {...seg, a: crossing}
        if (sideOf(best, seg.a) < 0) {
          front.push(first)
          back.push(second)
        } else {
          back.push(first)
          front.push(second)
        }
      }
    }
    const dx = best.b.x - best.a.x
    const dy = best.b.y - best.a.y
    const [frontRegion, backRegion] = splitPolygon(region, best.a.x, best.a.y, dx, dy)
    const index = nodes.length
    nodes.push({x: best.a.x, y: best.a.y, dx, dy, front: 0, back: 0})
    const frontChild = build(front, frontRegion)
    const backChild = build(back, backRegion)
    nodes[index]!.front = frontChild
    nodes[index]!.back = backChild
    return index
  }
  const root = build(segs, box)
  if (root !== 0) throw new Error('the map has no partition')
  for (const leaf of leaves) {
    let polygon = leaf.polygon
    for (const seg of leaf.segs) polygon = splitPolygon(polygon, seg.a.x, seg.a.y, seg.b.x - seg.a.x, seg.b.y - seg.a.y)[0]
    leaf.polygon = polygon
    if (leaf.sector === -2) {
      if (polygon.length < 3 || polygonArea(polygon) < 1e-6) leaf.sector = -1
      else {
        const cx = polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length
        const cy = polygon.reduce((sum, point) => sum + point.y, 0) / polygon.length
        leaf.sector = sectorAt(map, cx, cy)
      }
    }
  }
  return {nodes, leaves}
}

export function buildLevel(map: DoomMap, options: {maxEdges: number}): Level {
  const {maxEdges} = options
  const {nodes, leaves} = buildBsp(map)

  // Weld points closer than 1e-6 into one point object, through a spatial hash.
  const weldGrid = new Map<string, Point[]>()
  const weldTolerance = 1e-6
  const cellSize = 1 / 64
  const allPoints: Point[] = []
  const weld = (point: Point): Point => {
    const gx = Math.floor(point.x / cellSize)
    const gy = Math.floor(point.y / cellSize)
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        for (const existing of weldGrid.get(`${gx + ox},${gy + oy}`) ?? []) {
          if (Math.abs(existing.x - point.x) <= weldTolerance && Math.abs(existing.y - point.y) <= weldTolerance) return existing
        }
      }
    }
    const created = {x: point.x, y: point.y}
    const key = `${gx},${gy}`
    weldGrid.set(key, [...(weldGrid.get(key) ?? []), created])
    allPoints.push(created)
    return created
  }
  for (const vertex of map.vertices) weld(vertex)
  const leafPolygons = leaves.map(leaf => {
    const points: Point[] = []
    for (const point of leaf.polygon.map(weld)) if (points[points.length - 1] !== point) points.push(point)
    while (points.length > 1 && points[0] === points[points.length - 1]) points.pop()
    return points
  })

  // Split each edge at every welded point that lies on it, so that neighbors share whole edges.
  const splitAtPoints = (polygon: Point[]) => {
    const result: Point[] = []
    for (let index = 0; index < polygon.length; index++) {
      const a = polygon[index]!
      const b = polygon[(index + 1) % polygon.length]!
      result.push(a)
      const dx = b.x - a.x
      const dy = b.y - a.y
      const lengthSquared = dx * dx + dy * dy
      const length = Math.sqrt(lengthSquared)
      const minX = Math.min(a.x, b.x) - 1e-3
      const maxX = Math.max(a.x, b.x) + 1e-3
      const minY = Math.min(a.y, b.y) - 1e-3
      const maxY = Math.max(a.y, b.y) + 1e-3
      const onEdge: {t: number, point: Point}[] = []
      for (const point of allPoints) {
        if (point === a || point === b || point.x < minX || point.x > maxX || point.y < minY || point.y > maxY) continue
        const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared
        if (t * length <= 1e-6 || (1 - t) * length <= 1e-6) continue
        if (Math.abs(cross(dx, dy, point.x - a.x, point.y - a.y)) / length < 1e-6) onEdge.push({t, point})
      }
      onEdge.sort((first, second) => first.t - second.t)
      for (const {point} of onEdge) result.push(point)
    }
    return result
  }

  const cells: Cell[] = []
  const leafCell: number[] = []
  leaves.forEach((leaf, leafIndex) => {
    const polygon = leafPolygons[leafIndex]!
    if (leaf.sector < 0 || polygon.length < 3 || polygonArea(polygon) < 1e-6) {
      leafCell.push(-1)
      return
    }
    const points = splitAtPoints(polygon)
    const edges: Edge[] = points.map((a, index) => {
      const b = points[(index + 1) % points.length]!
      // The seg of this leaf that the edge lies on, if any. A seg has the leaf on its right, and an edge has the cell
      // on its left, so they run in opposite directions.
      let linedef = -1
      let side = -1
      for (const seg of leaf.segs) {
        const dx = seg.b.x - seg.a.x
        const dy = seg.b.y - seg.a.y
        const length = Math.hypot(dx, dy)
        if (Math.abs(cross(dx, dy, a.x - seg.a.x, a.y - seg.a.y)) / length > 1e-6) continue
        if (Math.abs(cross(dx, dy, b.x - seg.a.x, b.y - seg.a.y)) / length > 1e-6) continue
        const tA = ((a.x - seg.a.x) * dx + (a.y - seg.a.y) * dy) / (length * length)
        const tB = ((b.x - seg.a.x) * dx + (b.y - seg.a.y) * dy) / (length * length)
        if (Math.min(tA, tB) * length < -1e-6 || (Math.max(tA, tB) - 1) * length > 1e-6) continue
        linedef = seg.linedef
        side = seg.side
        break
      }
      return {a, b, neighbor: -1, linedef, side}
    })
    leafCell.push(cells.length)
    cells.push({sector: leaf.sector, edges})
  })

  linkNeighbors(cells)
  let unmatched = 0
  for (const cell of cells) {
    for (const edge of cell.edges) if (edge.neighbor < 0 && edge.linedef < 0) unmatched++
  }
  if (unmatched > 0) throw new Error(`${unmatched} cell edges have no neighbor and no wall`)

  const merged = mergeCells(cells, maxEdges)
  const {cells: compacted, remap} = compactCells(cells)
  for (const cell of compacted) cell.edges = fuseEdges(cell.edges)
  compacted.forEach((cell, cellIndex) => {
    for (const edge of cell.edges) {
      if (edge.neighbor < 0) continue
      const twins = compacted[edge.neighbor]!.edges.filter(back => back.a === edge.b && back.b === edge.a)
      if (twins.length !== 1 || twins[0]!.neighbor !== cellIndex) {
        throw new Error(`cell ${cellIndex}'s edge (${edge.a.x}, ${edge.a.y})-(${edge.b.x}, ${edge.b.y}) has ${twins.length} twins in cell ${edge.neighbor}`)
      }
    }
  })
  return {map, cells: compacted, nodes, leafCell: leafCell.map(cell => cell < 0 ? -1 : remap.get(merged.get(cell) ?? cell)!)}
}


function edgeKey(a: Point, b: Point) {
  return `${a.x},${a.y}|${b.x},${b.y}`
}

function linkNeighbors(cells: Cell[]) {
  const byKey = new Map<string, number>()
  cells.forEach((cell, cellIndex) => {
    for (const edge of cell.edges) byKey.set(edgeKey(edge.a, edge.b), cellIndex)
  })
  cells.forEach(cell => {
    for (const edge of cell.edges) edge.neighbor = byKey.get(edgeKey(edge.b, edge.a)) ?? -1
  })
}

function isConvex(points: Point[]) {
  for (let index = 0; index < points.length; index++) {
    const a = points[index]!
    const b = points[(index + 1) % points.length]!
    const c = points[(index + 2) % points.length]!
    if (cross(b.x - a.x, b.y - a.y, c.x - b.x, c.y - b.y) < -1e-9) return false
  }
  return true
}

// Fuse consecutive collinear edges that lead to the same place, i.e. the same neighbor through the same linedef side.
function fuseEdges(edges: Edge[]): Edge[] {
  let result = edges
  let changed = true
  while (changed && result.length > 3) {
    changed = false
    for (let index = 0; index < result.length; index++) {
      const first = result[index]!
      const second = result[(index + 1) % result.length]!
      if (first.neighbor !== second.neighbor || first.linedef !== second.linedef || first.side !== second.side) continue
      const turn = cross(first.b.x - first.a.x, first.b.y - first.a.y, second.b.x - second.a.x, second.b.y - second.a.y)
      const scale = Math.hypot(first.b.x - first.a.x, first.b.y - first.a.y) * Math.hypot(second.b.x - second.a.x, second.b.y - second.a.y)
      if (Math.abs(turn) > 1e-9 * scale) continue
      const fused: Edge = {...first, b: second.b}
      const next = result.filter((_, edgeIndex) => edgeIndex !== index && edgeIndex !== (index + 1) % result.length)
      next.splice(index < (index + 1) % result.length ? index : index - 1, 0, fused)
      result = next
      changed = true
      break
    }
  }
  return result
}

// Greedy merging: join two cells of one sector across free portals while the union is convex and has at most
// maxEdges edges. Larger cells first, so big rooms become few cells.
// Returns where each merged-away cell went, resolved through chains of merges.
function mergeCells(cells: (Cell | null)[], maxEdges: number) {
  const area = (cell: Cell) => polygonArea(cell.edges.map(edge => edge.a))
  const into = new Map<number, number>()
  let merged = true
  while (merged) {
    merged = false
    const order = cells.map((cell, index) => ({index, area: cell === null ? 0 : area(cell)})).sort((a, b) => b.area - a.area)
    for (const {index} of order) {
      const cell = cells[index]
      if (cell === null || cell === undefined) continue
      const candidates = [...new Set(cell.edges.filter(edge => edge.linedef < 0 && edge.neighbor >= 0).map(edge => edge.neighbor))]
      for (const otherIndex of candidates) {
        const other = cells[otherIndex]
        if (other === null || other === undefined || otherIndex === index || other.sector !== cell.sector) continue
        const union = unionEdges(cell, index, other, otherIndex)
        if (union === null) continue
        // Edges stay split while merging, so that both sides of every edge keep the same vertices, and one pass at
        // the end fuses them. The size limit counts the fused edges.
        if (fuseEdges(union).length > maxEdges || !isConvex(union.map(edge => edge.a))) continue
        cells[index] = {sector: cell.sector, edges: union}
        cells[otherIndex] = null
        into.set(otherIndex, index)
        for (const edge of union) {
          if (edge.neighbor < 0) continue
          const neighbor = cells[edge.neighbor]!
          for (const back of neighbor.edges) if (back.neighbor === otherIndex) back.neighbor = index
        }
        merged = true
        break
      }
    }
  }
  const resolved = new Map<number, number>()
  for (const from of into.keys()) {
    let to = into.get(from)!
    while (into.has(to)) to = into.get(to)!
    resolved.set(from, to)
  }
  return resolved
}

// The boundary of two cells that share a contiguous run of free portal edges, without that run, or null when they
// share edges in more than one run.
function unionEdges(cell: Cell, cellIndex: number, other: Cell, otherIndex: number): Edge[] | null {
  const shared = (edge: Edge, toward: number) => edge.neighbor === toward && edge.linedef < 0
  const rotateToBoundary = (edges: Edge[], toward: number) => {
    // Start right after the shared run.
    const count = edges.length
    for (let start = 0; start < count; start++) {
      if (shared(edges[(start + count - 1) % count]!, toward) && !shared(edges[start]!, toward)) {
        return Array.from({length: count}, (_, offset) => edges[(start + offset) % count]!)
      }
    }
    return null
  }
  const first = rotateToBoundary(cell.edges, otherIndex)
  const second = rotateToBoundary(other.edges, cellIndex)
  if (first === null || second === null) return null
  const firstOutside = first.filter(edge => !shared(edge, otherIndex))
  const secondOutside = second.filter(edge => !shared(edge, cellIndex))
  // Each outside part has to be one contiguous run.
  const contiguous = (edges: Edge[], toward: number) => {
    let runs = 0
    for (let index = 0; index < edges.length; index++) {
      if (!shared(edges[index]!, toward) && (index === 0 || shared(edges[index - 1]!, toward))) runs++
    }
    return runs === 1
  }
  if (!contiguous(first, otherIndex) || !contiguous(second, cellIndex)) return null
  // The outside runs meet end to start.
  if (firstOutside[firstOutside.length - 1]!.b !== secondOutside[0]!.a) return null
  if (secondOutside[secondOutside.length - 1]!.b !== firstOutside[0]!.a) return null
  const union = [...firstOutside, ...secondOutside]
  // Two cells that also meet across a linedef would leave a slit, an edge from the union to itself.
  if (union.some(edge => edge.neighbor === cellIndex || edge.neighbor === otherIndex)) return null
  return union.map(edge => ({...edge}))
}

function compactCells(cells: (Cell | null)[]) {
  const remap = new Map<number, number>()
  const result: Cell[] = []
  cells.forEach((cell, index) => {
    if (cell === null) return
    remap.set(index, result.length)
    result.push(cell)
  })
  for (const cell of result) {
    for (const edge of cell.edges) if (edge.neighbor >= 0) edge.neighbor = remap.get(edge.neighbor)!
  }
  return {cells: result, remap}
}

// Which side of a linedef blocks everything: a one-sided linedef.
export function isOneSided(map: DoomMap, linedef: number) {
  return (map.linedefs[linedef]!.flags & ML_TWOSIDED) === 0 || map.linedefs[linedef]!.back < 0
}

// The cell that contains a point, by testing every cell, for tests and reference code.
/** @public */
// The cell that holds a point that must be in one, e.g. where a thing or the player starts.
export function cellContaining(level: Level, x: number, y: number) {
  const cell = findCell(level, x, y)
  if (cell < 0) throw new Error(`no cell contains (${x}, ${y})`)
  return cell
}

export function findCell(level: Level, x: number, y: number) {
  for (const [index, cell] of level.cells.entries()) {
    if (cell.edges.every(edge => cross(edge.b.x - edge.a.x, edge.b.y - edge.a.y, x - edge.a.x, y - edge.a.y) >= -1e-9)) return index
  }
  return -1
}
