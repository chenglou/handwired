// Builder code for where things are and where they may go: the BSP walk that finds the cell containing a point, and
// Doom's P_CheckPosition for a box at a new position, against the lines that the blockmap lists near it. Every piece
// runs in full for every thing at every tick: a walk is the tree's depth in steps, and a position check reads a
// fixed number of lines per block, padding blocks with fewer.
import {type Terms, type Wire, type Circuit} from '../runtime/numeric-ui-core.ts'
import {type Level} from './level.ts'
import {constantTable, emitMax, emitMin, emitPositiveBit, emitReluSum} from './ops.ts'
import {ML_BLOCKING, ML_BLOCKMONSTERS, ML_TWOSIDED} from './wad.ts'

export type BspTables = ReturnType<typeof bspTables>

// Nodes, then leaves, as one list of places: a node's children are places, and a leaf's children are itself, with a
// partition through the origin that every point is in front of.
export function bspTables(circuit: Circuit, level: Level) {
  const nodeCount = level.nodes.length
  const placeOf = (child: number) => child >= 0 ? child : nodeCount + ~child
  const places = nodeCount + level.leafCell.length
  const x: number[] = []
  const y: number[] = []
  const dx: number[] = []
  const dy: number[] = []
  const children: number[] = []
  for (let place = 0; place < places; place++) {
    const node = level.nodes[place]
    if (node === undefined) {
      x.push(0)
      y.push(0)
      dx.push(0)
      dy.push(0)
      children.push(place, place)
    } else {
      // A unit direction, so that side values are distances.
      const length = Math.hypot(node.dx, node.dy)
      x.push(node.x)
      y.push(node.y)
      dx.push(node.dx / length)
      dy.push(node.dy / length)
      children.push(placeOf(node.front), placeOf(node.back))
    }
  }
  let depth = 0
  const measure = (place: number, level_: number): void => {
    depth = Math.max(depth, level_)
    if (place < nodeCount) {
      measure(children[2 * place]!, level_ + 1)
      measure(children[2 * place + 1]!, level_ + 1)
    }
  }
  measure(0, 0)
  // c = dx × y0 - dy × x0, so that the side value is dx × py - dy × px - c.
  return {
    depth,
    nodeCount,
    dx: constantTable(circuit, dx),
    dy: constantTable(circuit, dy),
    offset: constantTable(circuit, x.map((x0, place) => dx[place]! * y[place]! - dy[place]! * x0)),
    children: constantTable(circuit, children),
    leafCell: constantTable(circuit, level.leafCell.map(cell => Math.max(0, cell))),
    cells: level.leafCell.length,
  }
}

// The cell containing (x, y): the BSP walked from the root for the tree's depth. About 15 operations per level.
export function emitLocate(circuit: Circuit, tables: BspTables, x: Wire, y: Wire): Wire {
  let place: Wire = circuit.constant(0)
  for (let level = 0; level < tables.depth; level++) {
    const at: Terms = [[place, 1]]
    const read = (candidates: Wire[]) => circuit.indexReadAffine(at, 0, candidates, 'clamp', 'clamp')
    const dx = read(tables.dx)
    const dy = read(tables.dy)
    const offset = read(tables.offset)
    // Back when dx × y - dy × x - c > 0, Doom's R_PointOnSide.
    const back = emitPositiveBit(circuit, [[circuit.multiply(dx, y), 1], [circuit.multiply(dy, x), -1], [offset, -1]], 0, 1024)
    place = circuit.indexReadAffine([[place, 2], [back, 1]], 0, tables.children, 'clamp', 'clamp')
    // A read of the children, each a place: a node, or a leaf after the nodes.
    circuit.assumeRange(place, 0, tables.nodeCount + tables.cells - 1, {allowExistingReaders: true})
  }
  return circuit.indexReadAffine([[place, 1]], -tables.nodeCount, tables.leafCell, 'clamp', 'clamp')
}

// The lines a box of radius up to `margin` centered in each 128-unit block can touch, padded with a line that touches
// nothing.
function blockLists(level: Level, margin: number) {
  const {map} = level
  const {blockmap} = map
  const lists: number[][] = []
  for (let row = 0; row < blockmap.rows; row++) {
    for (let column = 0; column < blockmap.columns; column++) {
      const x0 = blockmap.originX + column * 128 - margin
      const x1 = x0 + 128 + 2 * margin
      const y0 = blockmap.originY + row * 128 - margin
      const y1 = y0 + 128 + 2 * margin
      const list: number[] = []
      map.linedefs.forEach((linedef, index) => {
        const a = map.vertices[linedef.v1]!
        const b = map.vertices[linedef.v2]!
        let t0 = 0
        let t1 = 1
        const dx = b.x - a.x
        const dy = b.y - a.y
        const clip = (p: number, q: number) => {
          if (p === 0) return q >= 0
          const r = q / p
          if (p < 0) {
            if (r > t1) return false
            if (r > t0) t0 = r
          } else {
            if (r < t0) return false
            if (r < t1) t1 = r
          }
          return true
        }
        if (clip(-dx, a.x - x0) && clip(dx, x1 - a.x) && clip(-dy, a.y - y0) && clip(dy, y1 - a.y)) list.push(index)
      })
      lists.push(list)
    }
  }
  const width = Math.max(...lists.map(list => list.length))
  return {lists, width}
}

export type LineTables = ReturnType<typeof lineTables>

// Per linedef, and one last line that nothing touches: what a position check reads about each line it considers.
// Heights are wires of the current tick, through the sector each side faces.
export function lineTables(circuit: Circuit, level: Level, floor: readonly Wire[], ceiling: readonly Wire[], margin: number) {
  const {map} = level
  const {lists, width} = blockLists(level, margin)
  const dummy = map.linedefs.length
  const lines = [...map.linedefs.map((linedef, index) => {
    const a = map.vertices[linedef.v1]!
    const b = map.vertices[linedef.v2]!
    const twoSided = (linedef.flags & ML_TWOSIDED) !== 0 && linedef.back >= 0
    return {
      index,
      ax: a.x,
      ay: a.y,
      dx: b.x - a.x,
      dy: b.y - a.y,
      left: Math.min(a.x, b.x),
      right: Math.max(a.x, b.x),
      bottom: Math.min(a.y, b.y),
      top: Math.max(a.y, b.y),
      front: map.sidedefs[linedef.front]!.sector,
      back: twoSided ? map.sidedefs[linedef.back]!.sector : -1,
      blocksPlayers: !twoSided || (linedef.flags & ML_BLOCKING) !== 0,
      blocksMonsters: !twoSided || (linedef.flags & (ML_BLOCKING | ML_BLOCKMONSTERS)) !== 0,
    }
  }), {index: dummy, ax: 0, ay: 0, dx: 1, dy: 0, left: -1e5, right: -1e5 + 1, bottom: -1e5, top: -1e5, front: 0, back: 0, blocksPlayers: false, blocksMonsters: false}]
  const consts = (values: number[]) => constantTable(circuit, values)
  // The opening each line leaves: Doom's P_LineOpening, from this tick's heights.
  const openTop = lines.map(line => line.back < 0 ? circuit.constant(0) : emitMin(circuit, ceiling[line.front]!, ceiling[line.back]!))
  const openBottom = lines.map(line => line.back < 0 ? circuit.constant(0) : emitMax(circuit, floor[line.front]!, floor[line.back]!))
  const lowFloor = lines.map(line => line.back < 0 ? circuit.constant(0) : emitMin(circuit, floor[line.front]!, floor[line.back]!))
  return {
    width,
    blockmap: map.blockmap,
    blockLines: consts(lists.flatMap(list => [...list, ...new Array<number>(width - list.length).fill(dummy)])),
    dx: consts(lines.map(line => line.dx)),
    dy: consts(lines.map(line => line.dy)),
    left: consts(lines.map(line => line.left)),
    right: consts(lines.map(line => line.right)),
    bottom: consts(lines.map(line => line.bottom)),
    top: consts(lines.map(line => line.top)),
    // cross(d, corner - a) = dx × y - dy × x + base + radius × corner, where Doom's P_BoxOnLineSide picks two corners
    // by the line's slope, here as offsets from the box's center in units of the radius.
    base: consts(lines.map(line => line.dy * line.ax - line.dx * line.ay)),
    corner1: consts(lines.map(line => {
      const [cx, cy] = line.dy === 0 ? [0, 1] : line.dx === 0 ? [1, 0] : line.dx * line.dy > 0 ? [-1, 1] : [1, 1]
      return line.dx * cy - line.dy * cx
    })),
    corner2: consts(lines.map(line => {
      const [cx, cy] = line.dy === 0 ? [0, -1] : line.dx === 0 ? [-1, 0] : line.dx * line.dy > 0 ? [1, -1] : [-1, -1]
      return line.dx * cy - line.dy * cx
    })),
    blocksPlayers: consts(lines.map(line => line.blocksPlayers ? 1 : 0)),
    blocksMonsters: consts(lines.map(line => line.blocksMonsters ? 1 : 0)),
    twoSided: consts(lines.map(line => line.back >= 0 ? 1 : 0)),
    openTop,
    openBottom,
    lowFloor,
  }
}

const big = 65536

// Things that never move and block: per block, the ones a box centered in it can touch, padded with one that touches
// nothing. Each has a presence wire, e.g. a barrel's, 0 once it has exploded.
export type SolidTables = ReturnType<typeof solidTables>

export function solidTables(circuit: Circuit, level: Level, things: {x: number, y: number, radius: number, present: Wire}[], margin: number) {
  const {blockmap} = level.map
  const lists: number[][] = []
  for (let row = 0; row < blockmap.rows; row++) {
    for (let column = 0; column < blockmap.columns; column++) {
      const x0 = blockmap.originX + column * 128 - margin
      const y0 = blockmap.originY + row * 128 - margin
      lists.push(things.flatMap((thing, index) => thing.x + thing.radius >= x0 && thing.x - thing.radius <= x0 + 128 + 2 * margin
        && thing.y + thing.radius >= y0 && thing.y - thing.radius <= y0 + 128 + 2 * margin ? [index] : []))
    }
  }
  const width = Math.max(1, ...lists.map(list => list.length))
  const dummy = things.length
  const all = [...things, {x: -1e5, y: -1e5, radius: 0, present: circuit.constant(0)}]
  return {
    width,
    blockThings: constantTable(circuit, lists.flatMap(list => [...list, ...new Array<number>(width - list.length).fill(dummy)])),
    x: constantTable(circuit, all.map(thing => thing.x)),
    y: constantTable(circuit, all.map(thing => thing.y)),
    radius: constantTable(circuit, all.map(thing => thing.radius)),
    present: all.map(thing => thing.present),
  }
}

// A thing that moves and blocks, e.g. a monster: its position, radius, and whether it blocks now.
export type Mover = {x: Wire, y: Wire, radius: number, solid: Wire}

type PositionCheck = {
  // 1 when the box can't be at the position.
  blocked: Wire
  // Doom's tmfloorz and tmceilingz: the highest floor and lowest ceiling the box touches.
  floor: Wire
  ceiling: Wire
}

// P_CheckPosition for a box of `radius` and `height` whose feet are at z, centered at (x, y), with the floor and ceiling
// of the sector its center is in: blocked by any line it touches that blocks it, or by an opening too low for its
// height, a step up of more than 24, or a ceiling under its head.
export function emitCheckPosition(
  circuit: Circuit,
  tables: LineTables,
  options: {
    x: Wire, y: Wire, z: Wire, radius: number, height: number, sectorFloor: Wire, sectorCeiling: Wire, player: boolean
    solids?: SolidTables
    movers?: Mover[]
  },
): PositionCheck {
  const {x, y, z, radius, height, player} = options
  const {blockmap} = tables
  // The block the center is in, clamped to the blockmap.
  const blockColumn = blockColumnOf(circuit, x, blockmap)
  const blockRow = blockRowOf(circuit, y, blockmap)
  const block: Terms = [[blockRow, blockmap.columns * tables.width], [blockColumn, tables.width]]
  const floors: Wire[] = [options.sectorFloor]
  const ceilings: Wire[] = [options.sectorCeiling]
  // Doom's tmdropoffz: the lowest floor among the lines the box touches, for monsters that won't step off a ledge.
  const dropoffs: Wire[] = [options.sectorFloor]
  const hardContacts: Wire[] = []
  // Things: blocked when |dx| and |dy| are both below the radii's sum, Doom's PIT_CheckThing.
  const touches = (thingX: Terms, thingY: Terms, reach: Terms, reachBias: number) => [
    emitPositiveBit(circuit, [[x, 1], ...thingX.map(([wire, c]) => [wire, -c] as const), ...reach], reachBias),
    emitPositiveBit(circuit, [[x, -1], ...thingX, ...reach], reachBias),
    emitPositiveBit(circuit, [[y, 1], ...thingY.map(([wire, c]) => [wire, -c] as const), ...reach], reachBias),
    emitPositiveBit(circuit, [[y, -1], ...thingY, ...reach], reachBias),
  ]
  if (options.solids !== undefined) {
    const solids = options.solids
    const block: Terms = [[blockRowOf(circuit, y, blockmap), blockmap.columns * solids.width], [blockColumnOf(circuit, x, blockmap), solids.width]]
    for (let slot = 0; slot < solids.width; slot++) {
      const thing = circuit.indexReadAffine(block, slot, solids.blockThings, 'clamp', 'clamp')
      const read = (candidates: Wire[]) => circuit.indexReadAffine([[thing, 1]], 0, candidates, 'clamp', 'clamp')
      const sides = touches([[read(solids.x), 1]], [[read(solids.y), 1]], [[read(solids.radius), 1]], radius)
      hardContacts.push(emitReluSum(circuit, [...sides.map(side => [side, 1] as const), [read(solids.present), 1]], -4))
    }
  }
  for (const mover of options.movers ?? []) {
    const sides = touches([[mover.x, 1]], [[mover.y, 1]], [], radius + mover.radius)
    hardContacts.push(emitReluSum(circuit, [...sides.map(side => [side, 1] as const), [mover.solid, 1]], -4))
  }
  for (let slot = 0; slot < tables.width; slot++) {
    const line = circuit.indexReadAffine(block, slot, tables.blockLines, 'clamp', 'clamp')
    const read = (candidates: Wire[]) => circuit.indexReadAffine([[line, 1]], 0, candidates, 'clamp', 'clamp')
    const dx = read(tables.dx)
    const dy = read(tables.dy)
    // The box's bounding box against the line's, strictly overlapping.
    const overlap = [
      emitPositiveBit(circuit, [[x, 1], [read(tables.left), -1]], radius),
      emitPositiveBit(circuit, [[read(tables.right), 1], [x, -1]], radius),
      emitPositiveBit(circuit, [[y, 1], [read(tables.bottom), -1]], radius),
      emitPositiveBit(circuit, [[read(tables.top), 1], [y, -1]], radius),
    ]
    // The two corners' sides: cross(d, corner - a) = dx × (cy - ay) - dy × (cx - ax).
    const across: Terms = [[circuit.multiply(dx, y), 1], [circuit.multiply(dy, x), -1], [read(tables.base), 1]]
    const side1 = emitPositiveBit(circuit, [...across, [read(tables.corner1), radius]])
    const side2 = emitPositiveBit(circuit, [...across, [read(tables.corner2), radius]])
    const straddles = circuit.affine([[emitReluSum(circuit, [[side1, 1], [side2, -1]]), 1], [emitReluSum(circuit, [[side2, 1], [side1, -1]]), 1]])
    const contact = emitReluSum(circuit, [...overlap.map(bit => [bit, 1] as const), [straddles, 1]], -4)
    hardContacts.push(emitReluSum(circuit, [[contact, 1], [read(player ? tables.blocksPlayers : tables.blocksMonsters), 1]], -1))
    // A touched two-sided line limits the opening; any other line limits nothing.
    const counts = emitReluSum(circuit, [[contact, 1], [read(tables.twoSided), 1]], -1)
    floors.push(circuit.affine([[read(tables.openBottom), 1], [counts, big]], -big))
    ceilings.push(circuit.affine([[read(tables.openTop), 1], [counts, -big]], big))
    dropoffs.push(circuit.affine([[read(tables.lowFloor), 1], [counts, -big]], big))
  }
  const floor = reduce(floors, (a, b) => emitMax(circuit, a, b))
  const ceiling = reduce(ceilings, (a, b) => emitMin(circuit, a, b))
  const hard = emitPositiveBit(circuit, hardContacts.map(contact => [contact, 1] as const), -0.5)
  // Too low an opening, a head in the ceiling, or a step up of more than 24.
  const tooLow = emitPositiveBit(circuit, [[ceiling, -1], [floor, 1]], height, 1024)
  const headHit = emitPositiveBit(circuit, [[ceiling, -1], [z, 1]], height, 1024)
  const stepTooHigh = emitPositiveBit(circuit, [[floor, 1], [z, -1]], -24, 1024)
  const reasons: (readonly [Wire, number])[] = [[hard, 1], [tooLow, 1], [headHit, 1], [stepTooHigh, 1]]
  if (!player) {
    const dropoff = reduce(dropoffs, (a, b) => emitMin(circuit, a, b))
    reasons.push([emitPositiveBit(circuit, [[floor, 1], [dropoff, -1]], -24, 1024), 1])
  }
  const blocked = emitPositiveBit(circuit, reasons, -0.5)
  return {blocked, floor, ceiling}
}

type Blockmap = {originX: number, originY: number, columns: number, rows: number}
const blockColumnOf = (circuit: Circuit, x: Wire, blockmap: Blockmap) => clampedFloor(circuit, [[x, 1 / 128]], -blockmap.originX / 128, blockmap.columns - 1)
const blockRowOf = (circuit: Circuit, y: Wire, blockmap: Blockmap) => clampedFloor(circuit, [[y, 1 / 128]], -blockmap.originY / 128, blockmap.rows - 1)

// floor(terms + bias) clamped to 0..limit, for a block coordinate. Exact for positions on a grid finer than the block.
function clampedFloor(circuit: Circuit, terms: Terms, bias: number, limit: number): Wire {
  // Round of (value - 0.5 + 2^-12); the clamp keeps far positions inside the table.
  const value = circuit.roundAffine([...terms], bias - 0.5 + 2 ** -12)
  const clampedLow = emitReluSum(circuit, [[value, 1]])
  const clamped = circuit.affine([[emitReluSum(circuit, [[clampedLow, -1]], limit), -1]], limit)
  // min(limit, clampedLow), with clampedLow at least 0.
  circuit.assumeRange(clamped, 0, limit)
  const shifted = circuit.roundAffine([[clamped, 1]], 2 ** 23 + 2 ** 22)
  const rounded = circuit.roundAffine([[shifted, 1]], -(2 ** 23 + 2 ** 22))
  // clamped rounded to the nearest whole number, as emitRound in ops.ts rounds, which stays within 0..limit since both
  // ends are whole.
  circuit.assumeRange(rounded, 0, limit)
  return rounded
}

function reduce(values: Wire[], combine: (a: Wire, b: Wire) => Wire): Wire {
  let level = values
  while (level.length > 1) {
    const next: Wire[] = []
    for (let index = 0; index < level.length; index += 2) next.push(index + 1 < level.length ? combine(level[index]!, level[index + 1]!) : level[index]!)
    level = next
  }
  return level[0]!
}
