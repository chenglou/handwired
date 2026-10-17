// Rays through the level's convex cells for the game program: line of sight and hitscans. A ray starts in a known cell
// and walks a fixed number of portals, as the column program's rays do, but from any origin in any direction: each
// vertex's side of the ray is computed from the vertex's coordinates on the spot. The first crossing that blocks, a
// one-sided wall or a closed door, is where the ray stops, given as a fraction t = numerator / denominator of the ray's
// direction vector, with a negative denominator. A ray that crosses nothing that blocks within its steps stops far
// away. Comparing t with a target's t needs no division: a target at t = 1 is visible when numerator < denominator.
import {type Terms, type Wire, type Circuit} from '../runtime/numeric-ui-core.ts'
import {type Level, isOneSided} from './level.ts'
import {constantTable, emitMax, emitMin, emitPositiveBit, emitReluSum} from './ops.ts'
import {maxEdges} from './scene.ts'

const walkStride = maxEdges + 1

export type RayTables = ReturnType<typeof rayTables>

export function rayTables(circuit: Circuit, level: Level, floor: readonly Wire[], ceiling: readonly Wire[]) {
  const consts = (values: number[]) => constantTable(circuit, values)
  const cells = level.cells
  const cellCount = cells.length
  const edgeAt = (cell: number, slot: number) => cells[cell]!.edges[Math.min(slot, cells[cell]!.edges.length - 1)]!
  // The eye's cell scanned from its first vertex, vertices past the last repeating it.
  const scanPoint = (index: number) => {
    const edges = cells[Math.floor(index / maxEdges)]!.edges
    return edges[Math.min(index % maxEdges, edges.length - 1)]!.a
  }
  const scanLength = cellCount * maxEdges
  const scanSlot = Array.from({length: scanLength}, (_, index) => {
    const n = cells[Math.floor(index / maxEdges)]!.edges.length
    const k = index % maxEdges
    return k <= n - 2 ? k : n - 1
  })
  const walkPoint = (index: number) => {
    const m = index % walkStride
    const entry = Math.floor(index / walkStride) % maxEdges
    const cell = Math.floor(index / (walkStride * maxEdges))
    const edges = cells[cell]!.edges
    const n = edges.length
    const i = entry < n ? entry : 0
    return {point: edges[m < n ? (i + m) % n : i]!.a, slot: (i + Math.min(m, n - 1)) % n}
  }
  const walkLength = cellCount * maxEdges * walkStride
  const walk = Array.from({length: walkLength}, (_, index) => walkPoint(index))
  // Per edge: where the ray goes next, the edge itself, and what blocks there. A one-sided wall leads back into its own
  // cell, like the column program's, and the walk stops mattering there since the wall blocks.
  const edgeIds = Array.from({length: cellCount * maxEdges}, (_, index) => ({cell: Math.floor(index / maxEdges), slot: index % maxEdges}))
  const edges = edgeIds.map(({cell, slot}) => edgeAt(cell, slot))
  const nextCell = edgeIds.map(({cell}, index) => edges[index]!.neighbor < 0 || isSolid(level, edges[index]!) ? cell : edges[index]!.neighbor)
  const nextSlot = edgeIds.map(({cell, slot}, index) => {
    const edge = edges[index]!
    if (nextCell[index] === cell) return Math.min(slot, cells[cell]!.edges.length - 1)
    return cells[edge.neighbor]!.edges.findIndex(back => back.a === edge.b && back.b === edge.a)
  })
  // A crossing is closed when the opening between the two sectors has no height, e.g. a shut door.
  const front = edgeIds.map(({cell}) => cells[cell]!.sector)
  const back = nextCell.map(cell => cells[cell]!.sector)
  const closed = edgeIds.map((_, index) => {
    if (isSolid(level, edges[index]!)) return circuit.constant(1)
    const top = emitMin(circuit, ceiling[front[index]!]!, ceiling[back[index]!]!)
    const bottom = emitMax(circuit, floor[front[index]!]!, floor[back[index]!]!)
    return emitPositiveBit(circuit, [[bottom, 1], [top, -1]], 0.5, 1)
  })
  return {
    scanX: consts(Array.from({length: scanLength}, (_, index) => scanPoint(index).x)),
    scanY: consts(Array.from({length: scanLength}, (_, index) => scanPoint(index).y)),
    scanSlot: consts(scanSlot),
    walkX: consts(walk.map(entry => entry.point.x)),
    walkY: consts(walk.map(entry => entry.point.y)),
    walkSlot: consts(walk.map(entry => entry.slot)),
    nextCell: consts(nextCell),
    nextSlot: consts(nextSlot),
    edgeAX: consts(edges.map(edge => edge.a.x)),
    edgeAY: consts(edges.map(edge => edge.a.y)),
    edgeDX: consts(edges.map(edge => edge.b.x - edge.a.x)),
    edgeDY: consts(edges.map(edge => edge.b.y - edge.a.y)),
    closed,
  }
}

// An edge that a ray can't cross: the level's outside, or a one-sided line.
function isSolid(level: Level, edge: Level['cells'][number]['edges'][number]) {
  if (edge.neighbor < 0) return true
  return edge.linedef >= 0 && isOneSided(level.map, edge.linedef)
}

type RayHit = {
  // The first blocking crossing at t = numerator / denominator, denominator < 0.
  numerator: Wire
  denominator: Wire
}

// Walks a ray from (x, y) in `cell` along (dx, dy) for `steps` portals.
export function emitRay(circuit: Circuit, tables: RayTables, options: {x: Wire, y: Wire, dx: Wire, dy: Wire, cell: Wire, steps: number}): RayHit {
  const {x, y, dx, dy, steps} = options
  const read = (terms: Terms, bias: number, candidates: Wire[]) => circuit.indexReadAffine(terms, bias, candidates, 'clamp', 'clamp')
  // A point's side: cross(d, p - o) = dx × py - dy × px - (dx × oy - dy × ox), right of the ray when negative.
  const originTerm = circuit.affine([[circuit.multiply(dx, y), 1], [circuit.multiply(dy, x), -1]])
  const right = (px: Wire, py: Wire) => emitPositiveBit(circuit, [[circuit.multiply(dy, px), 1], [circuit.multiply(dx, py), -1], [originTerm, 1]])
  let cell: Wire = options.cell
  let slot: Wire
  {
    const bits = Array.from({length: maxEdges}, (_, k) => right(read([[cell, maxEdges]], k, tables.scanX), read([[cell, maxEdges]], k, tables.scanY)))
    const exits = bits.map((bit, k) => emitReluSum(circuit, [[bit, 1], [bits[(k + 1) % maxEdges]!, -1]]))
    slot = read([[cell, maxEdges], ...exits.map((exit, k) => [exit, k] as const)], 0, tables.scanSlot)
  }
  const blocks: Wire[] = []
  const edgeIds: Terms[] = []
  for (let step = 0; step < steps; step++) {
    const edge: Terms = [[cell, maxEdges], [slot, 1]]
    edgeIds.push(edge)
    blocks.push(read(edge, 0, tables.closed))
    const nextCell = read(edge, 0, tables.nextCell)
    const nextSlot = read(edge, 0, tables.nextSlot)
    const base: Terms = [[nextCell, maxEdges * walkStride], [nextSlot, walkStride]]
    const m: (readonly [Wire, number])[] = []
    for (const stride of [8, 4, 2, 1]) {
      const at: Terms = [...base, ...m]
      m.push([right(read(at, 1 + stride, tables.walkX), read(at, 1 + stride, tables.walkY)), stride])
    }
    slot = read([...base, ...m], 1, tables.walkSlot)
    cell = nextCell
  }
  // The first blocking step, as a one-hot over the steps, and its edge.
  let before: Wire = circuit.constant(0)
  const firsts: Wire[] = []
  for (const block of blocks) {
    firsts.push(emitReluSum(circuit, [[block, 1], [before, -1]]))
    before = emitMax(circuit, before, block)
  }
  const edgeId: (readonly [Wire, number])[] = []
  firsts.forEach((first, step) => {
    for (const [wire, coefficient] of edgeIds[step]!) edgeId.push([circuit.reglu([[wire, coefficient]], 0, [[first, 1]], 0), 1])
  })
  const ex = read(edgeId, 0, tables.edgeDX)
  const ey = read(edgeId, 0, tables.edgeDY)
  const ax = circuit.affine([[read(edgeId, 0, tables.edgeAX), 1], [x, -1]])
  const ay = circuit.affine([[read(edgeId, 0, tables.edgeAY), 1], [y, -1]])
  // t = cross(e, a - o) / cross(e, d); the ray leaves a counterclockwise cell, so cross(e, d) < 0.
  const numerator = circuit.affine([[circuit.multiply(ex, ay), 1], [circuit.multiply(ey, ax), -1]])
  const denominator = circuit.affine([[circuit.multiply(ex, dy), 1], [circuit.multiply(ey, dx), -1]])
  // Without a blocking crossing, t is far: numerator -2^20 over denominator -1.
  const none = emitReluSum(circuit, [[before, -1]], 1)
  return {
    numerator: circuit.affine([[numerator, 1], [circuit.reglu([[numerator, -1]], -(2 ** 20), [[none, 1]], 0), 1]]),
    denominator: circuit.affine([[denominator, 1], [circuit.reglu([[denominator, -1]], -1, [[none, 1]], 0), 1]]),
  }
}

// [t < the ray's stop], for t given as a wire: t × denominator > numerator, since the denominator is negative.
export function emitBefore(circuit: Circuit, hit: RayHit, t: Wire): Wire {
  return emitPositiveBit(circuit, [[circuit.multiply(t, hit.denominator), 1], [hit.numerator, -1]], 0, 1024)
}

// [the ray reaches t = 1], a target at the end of the ray's direction vector: numerator < denominator.
export function emitReaches(circuit: Circuit, hit: RayHit): Wire {
  return emitPositiveBit(circuit, [[hit.denominator, 1], [hit.numerator, -1]], 0, 1024)
}
