// The frame program: one evaluation per frame that turns the view (position, eye height, angle, cell) and the sectors'
// current heights and light into the tables that every column reads. It views every vertex from the eye, gives every
// line the 1/z of each column's ray at it as A + column × B, and projects every sector's floor and ceiling. The host
// copies its outputs into the column program's frame cells as one block, since frameSpec lays both out alike.
import {type CellWires, createSourceTable, input, inputBit, list} from '../runtime/cells.ts'
import {type Circuit, type Wire, emitCompare} from '../runtime/numeric-ui-core.ts'
import {emitAbs, emitFloorish, emitReluSum, constantTable} from './ops.ts'
import {type Scene} from './scene.ts'
import {emitPsprites, emitSprites, pspriteSpec, slotSpec} from './sprites.ts'
import {type SpriteCatalog, type StateTables} from './things.ts'
import {type ViewConfig, fineAngles, viewConstants} from './view.ts'

// The largest |h| the reciprocal covers, and the seed table's steps per map unit.
const maxDistance = 8192
const seedSteps = 4
// Projected heights are clamped here, so that a projection times 1/z <= 4 stays inside the rounding domain.
const projectionLimit = 2 ** 19

// The frame tables, as cells of the column program and outputs of the frame program, in this order.
export function frameSpec(scene: Scene, view: ViewConfig) {
  const sectors = scene.sectors.length
  return {
    cell: input([0, scene.cells.length - 1], {grid: 1}),
    angle: input([0, fineAngles - 1], {grid: 1}),
    viewX: input([-(2 ** 15), 2 ** 15]),
    viewY: input([-(2 ** 15), 2 ** 15]),
    cos: input([-1, 1]),
    sin: input([-1, 1]),
    vertexA: list(scene.vertices.length, () => input([-(2 ** 25), 2 ** 25])),
    vertexB: list(scene.vertices.length, () => input([-(2 ** 17), 2 ** 17])),
    lineA: list(scene.lines.length, () => input([-16, 16])),
    lineB: list(scene.lines.length, () => input([-1, 1])),
    // Distances from the eye to lines, within the map's extent.
    lineH: list(scene.lines.length, () => input([-(2 ** 14), 2 ** 14])),
    lineAbsH: list(scene.lines.length, () => input([0, 2 ** 14])),
    sideU0: list(scene.sides.length, () => input([-(2 ** 18), 2 ** 18])),
    projCeiling: list(sectors, () => input([-projectionLimit, projectionLimit])),
    projFloor: list(sectors, () => input([-projectionLimit, projectionLimit])),
    relCeiling: list(sectors, () => input([-(2 ** 14), 2 ** 14])),
    relFloor: list(sectors, () => input([-(2 ** 14), 2 ** 14])),
    absCeiling: list(sectors, () => input([0, 2 ** 14])),
    absFloor: list(sectors, () => input([0, 2 ** 14])),
    // Per sector and fake contrast -1, 0, +1: the row of scalelight, a multiple of 48.
    wallLightRow: list(sectors * 3, () => input([0, 15 * 48], {grid: 16})),
    // Per sector: the row of zlight, a multiple of 128.
    flatLightRow: list(sectors, () => input([0, 15 * 128], {grid: 128})),
    // Per sector: how far its animated floor and ceiling flats are from their group's first, in texels.
    floorShift: list(sectors, () => input([0, 3 * 4096], {grid: 4096})),
    ceilingShift: list(sectors, () => input([0, 3 * 4096], {grid: 4096})),
    // The nearest sprites on screen, nearest first.
    sprites: slotSpec(view),
    // The weapon and its flash.
    psprites: pspriteSpec(),
  }
}

type FrameSpec = ReturnType<typeof frameSpec>
type FrameWires = CellWires<FrameSpec>

export const frameInputSpec = (scene: Scene, thingCount: number, frameCount: number) => ({
  cell: input([0, scene.cells.length - 1], {grid: 1}),
  angle: input([0, fineAngles - 1], {grid: 1}),
  x: input([-(2 ** 14), 2 ** 14]),
  y: input([-(2 ** 14), 2 ** 14]),
  z: input([-4096, 4096]),
  floor: list(scene.sectors.length, () => input([-4096, 4096])),
  ceiling: list(scene.sectors.length, () => input([-4096, 4096])),
  light: list(scene.sectors.length, () => input([0, 255], {grid: 1})),
  things: list(thingCount, () => ({
    x: input([-(2 ** 14), 2 ** 14]),
    y: input([-(2 ** 14), 2 ** 14]),
    z: input([-4096, 4096]),
    sector: input([0, scene.sectors.length - 1], {grid: 1}),
    frame: input([0, frameCount - 1], {grid: 1}),
    bright: inputBit(),
    direction: input([0, 7], {grid: 1}),
    visible: inputBit(),
  })),
  // The player's weapon: its state, its flash's state, and its position in 320 × 200 coordinates.
  weapon: {
    state: input([0, frameCount * 64], {grid: 1}),
    flash: input([0, frameCount * 64], {grid: 1}),
    x: input([-64, 64]),
    y: input([0, 200]),
  },
  // Tics modulo 768, for animated flats and scrolling walls.
  time: input([0, 767], {grid: 1}),
})

// 1 / value for value within [1 / seedSteps, maxDistance]: a seed read from a table at floor(value × seedSteps), within
// a third of the answer, then 4 Newton steps, each squaring the relative error. 10 operations.
function emitReciprocal(circuit: Circuit, value: Wire, seeds: Wire[]): Wire {
  let estimate = circuit.indexReadAffine([[value, seedSteps]], 0, seeds, 'clamp', 'clamp')
  for (let step = 0; step < 4; step++) {
    const product = circuit.multiply(value, estimate)
    estimate = circuit.reglu([[estimate, 1]], 0, [[product, -1]], 2)
    // The seed for a value in i/seedSteps..(i + 1)/seedSteps is seedSteps / (i + 0.5), within a third of 1/value as i
    // is at least 1, and a step on an estimate with relative error e gives (1 - e²)/value: within 0..1/value, which is
    // at most seedSteps.
    circuit.assumeRange(estimate, 0, seedSteps * 1.5)
  }
  return estimate
}

export function buildFrameProgram(scene: Scene, view: ViewConfig, catalog: SpriteCatalog, thingCount: number, states: StateTables, scaleLight: Uint8Array) {
  const frameCount = states.frames.length
  const table = createSourceTable()
  const cells = table.declare(frameInputSpec(scene, thingCount, frameCount))
  const circuit = table.createCircuit()
  const {focalY} = viewConstants(view)
  const half = view.width / 2

  const angles = Array.from({length: fineAngles}, (_, angle) => angle * 2 * Math.PI / fineAngles)
  const cos = circuit.indexRead(cells.angle, constantTable(circuit, angles.map(Math.cos)))
  const sin = circuit.indexRead(cells.angle, constantTable(circuit, angles.map(Math.sin)))
  // Reads of tables of cosines and sines, all within -1..1.
  circuit.assumeRange(cos, -1, 1)
  circuit.assumeRange(sin, -1, 1)
  // The eye along the right and forward axes: right = (sin, -cos), forward = (cos, sin).
  const eyeRight = circuit.affine([[circuit.multiply(cells.x, sin), 1], [circuit.multiply(cells.y, cos), -1]])
  const eyeForward = circuit.affine([[circuit.multiply(cells.x, cos), 1], [circuit.multiply(cells.y, sin), 1]])

  // vx = x sin - y cos - eyeRight, vz = x cos + y sin - eyeForward, a = half × vx + (half - 0.5) × vz, b = vz.
  const vertexA = scene.vertices.map(({x, y}) => circuit.affine([
    [sin, half * x + (half - 0.5) * y],
    [cos, -half * y + (half - 0.5) * x],
    [eyeRight, -half],
    [eyeForward, -(half - 0.5)],
  ]))
  const vertexB = scene.vertices.map(({x, y}) => circuit.affine([[cos, x], [sin, y], [eyeForward, -1]]))

  const seeds = constantTable(circuit, Array.from({length: maxDistance * seedSteps + 1}, (_, index) => seedSteps / (Math.max(1, index) + 0.5)))
  const lineA: Wire[] = []
  const lineB: Wire[] = []
  const lineH: Wire[] = []
  const lineAbsH: Wire[] = []
  for (const line of scene.lines) {
    const length = Math.hypot(line.bx - line.ax, line.by - line.ay)
    const nx = (line.by - line.ay) / length
    const ny = -(line.bx - line.ax) / length
    // h = (a - eye) · n, and the normal in view space: (n · right, n · forward).
    const h = circuit.affine([[cells.x, -nx], [cells.y, -ny]], line.ax * nx + line.ay * ny)
    const normalRight = circuit.affine([[sin, nx], [cos, -ny]])
    const normalForward = circuit.affine([[cos, nx], [sin, ny]])
    const absH = emitAbs(circuit, h)
    // 1/h, as h / max(|h|, 1/4)², finite at h = 0.
    const clampedLow = circuit.affine([[emitReluSum(circuit, [[absH, 1]], -1 / seedSteps), 1]], 1 / seedSteps)
    const clamped = circuit.affine([[emitReluSum(circuit, [[clampedLow, -1]], maxDistance), -1]], maxDistance)
    circuit.assumeRange(clamped, 1 / seedSteps, maxDistance)
    const reciprocal = emitReciprocal(circuit, clamped, seeds)
    const inverseH = circuit.multiply(h, circuit.multiply(reciprocal, reciprocal))
    // 1/z = (normalRight × xs + normalForward) / h with xs = (column + 0.5 - half) / half.
    const numeratorA = circuit.affine([[normalForward, 1], [normalRight, (0.5 - half) / half]])
    lineA.push(circuit.multiply(numeratorA, inverseH))
    lineB.push(circuit.multiply(circuit.affine([[normalRight, 1 / half]]), inverseH))
    lineH.push(h)
    lineAbsH.push(absH)
  }

  // u at the foot of the perpendicular from the eye: (eye - start) · dir + xOffset, which a scrolling side moves by one
  // unit per tic.
  const sideU0 = scene.sides.map(side => circuit.affine([
    [cells.x, side.dirX], [cells.y, side.dirY], ...(side.scrolls ? [[cells.time, 1] as const] : []),
  ], side.xOffset - side.startX * side.dirX - side.startY * side.dirY))
  // An animated flat shows member (time / 8 + phase) mod frames of its group.
  const flatShift = (animation: Scene['sectors'][number]['floorAnimation']) => animation === null
    ? circuit.constant(0)
    : circuit.indexRead(cells.time, constantTable(circuit, Array.from({length: 768}, (_, time) => 4096 * ((Math.floor(time / 8) + animation.phase) % animation.frames))))

  const clampProjection = (terms: [Wire, number][]) => circuit.affine([
    [emitReluSum(circuit, terms, projectionLimit), 1],
    [emitReluSum(circuit, terms, -projectionLimit), -1],
  ], -projectionLimit)
  const relCeiling = cells.ceiling.map(ceiling => circuit.affine([[ceiling, 1], [cells.z, -1]]))
  const relFloor = cells.floor.map(floor => circuit.affine([[floor, 1], [cells.z, -1]]))
  const lightNumber = cells.light.map(light => {
    const number = emitFloorish(circuit, [[light, 1 / 16]])
    // light is a whole number within 0..255, so light / 16 is a multiple of 1/16, clear of the sliver below a whole
    // number where floorish is one more than floor, and its floor is within 0..15.
    circuit.assumeRange(number, 0, 15)
    return number
  })
  const wallLightRow = lightNumber.flatMap(number => [
    circuit.affine([[emitReluSum(circuit, [[number, 1]], -1), 48]]),
    circuit.affine([[number, 48]]),
    circuit.affine([[number, 48], [emitReluSum(circuit, [[number, 1]], -14), -48]], 48),
  ])
  const sprites = emitSprites(circuit, catalog, view, {x: cells.x, y: cells.y, z: cells.z, cos, sin},
    wallLightRow.filter((_, index) => index % 3 === 1), constantTable(circuit, scaleLight), cells.things)
  // The weapon is lit by the player's sector at the nearest scale, unless its frame is fullbright.
  const consts = (values: number[]) => constantTable(circuit, values)
  const playerSector = circuit.indexRead(cells.cell, consts(scene.cells.map(cell => cell.sector)))
  const weaponLight = circuit.indexReadAffine([[circuit.indexRead(playerSector, wallLightRow.filter((_, index) => index % 3 === 1)), 1]], 47, constantTable(circuit, scaleLight), 'clamp', 'clamp')
  const stateFrames = consts(states.frame)
  const nullState = states.state('NULL')
  const psprites = emitPsprites(circuit, catalog, view, {
    weaponFrame: circuit.indexRead(cells.weapon.state, stateFrames),
    flashFrame: circuit.indexRead(cells.weapon.flash, stateFrames),
    flashVisible: circuit.affine([[emitCompareEquals(circuit, cells.weapon.flash, nullState), -1]], 1),
    x: cells.weapon.x,
    y: cells.weapon.y,
    weaponBright: circuit.indexRead(cells.weapon.state, consts(states.bright)),
    level: weaponLight,
  })
  const output: FrameWires = {
    cell: cells.cell,
    angle: cells.angle,
    viewX: cells.x,
    viewY: cells.y,
    cos,
    sin,
    vertexA,
    vertexB,
    lineA,
    lineB,
    lineH,
    lineAbsH,
    sideU0,
    projCeiling: relCeiling.map(rel => clampProjection([[rel, focalY]])),
    projFloor: relFloor.map(rel => clampProjection([[rel, focalY]])),
    relCeiling,
    relFloor,
    absCeiling: relCeiling.map(rel => emitAbs(circuit, rel)),
    absFloor: relFloor.map(rel => emitAbs(circuit, rel)),
    wallLightRow,
    flatLightRow: lightNumber.map(number => circuit.affine([[number, 128]])),
    floorShift: scene.sectors.map(sector => flatShift(sector.floorAnimation)),
    ceilingShift: scene.sectors.map(sector => flatShift(sector.ceilingAnimation)),
    sprites,
    psprites,
  }
  return {cells, output, ...table.finish()}
}

function emitCompareEquals(circuit: Circuit, value: Wire, constant: number) {
  return emitCompare(circuit, value, '===', circuit.constant(constant))
}
