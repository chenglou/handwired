// The game program: one evaluation per Doom tic, 35 per second. It turns the held keys into the player's thrust, turn
// and move (Doom's P_MovePlayer, P_XYMovement with its wall checks, P_ZMovement and P_CalcHeight), finds the cell the
// player is in by walking the BSP, presses the lines the player uses or walks over, and moves the doors, lifts and
// floors those lines start. It runs the things' states, the pickups, the weapon and its shots, every monster
// (actors.ts), the fireballs and barrels, the player's damage and death, and the lights, and picks the palette, red
// after damage and gold after a pickup. Its `view` output is the frame program's input, in that program's layout, and
// `status` the status program's.
import {createSourceTable, inputBit, list, state, stateBit} from '../runtime/cells.ts'
import {type Terms, type Wire, emitCompare} from '../runtime/numeric-ui-core.ts'
import {type Level, cellContaining, sectorAt as mapSectorAt} from './level.ts'
import {type LevelThing, type StateTables, buildStateTables, levelThings} from './things.ts'
import {constantTable, emitAbs, emitFloorish, emitMax, emitMin, emitPositiveBit, emitReluSum} from './ops.ts'
import {type ActorWorld, type MonsterResult, type PlayerView, type Target, and, barrelSpec, bitOf, choose, emitBarrel, emitBlast, emitMonster, emitShots, emitWeapon, gate, hearingTable, monsterSpec, not, or, projectileSpec, randomSource, weaponKeys, weaponSpec} from './actors.ts'
import {type Mover as Blocker, bspTables, emitCheckPosition, emitLocate, lineTables, solidTables} from './physics.ts'
import {rayTables} from './raycast.ts'
import {fineAngles} from './view.ts'
import {type DoomMap} from './wad.ts'

const playerRadius = 16
const playerHeight = 56
const viewHeight = 41
const maxMove = 30
const friction = 0xe800 / 0x10000
const stopSpeed = 0x1000 / 0x10000
const useRange = 64

// Movers: the sectors whose floor or ceiling a line can move.
type MoverKind =
  // Doom's DR doors (1, 26, 27, 28, 117): open, wait, close; using a moving door turns it around.
  | 'door'
  // W1/D1 doors that open and stay open (2, 31..34).
  | 'open'
  // SR/WR lifts (62, 88): the floor lowers, waits and comes back.
  | 'lift'
  // S1/W1 floors that lower to the lowest neighbor and stay (23, 38).
  | 'floor'
  // W1 floors that lower fast to 8 above the highest neighbor and stay (36).
  | 'turbo'

export type Mover = {
  sector: number
  kind: MoverKind
  // Whether the mover moves the ceiling (doors) or the floor (lifts, floors).
  ceiling: boolean
  rest: number
  target: number
  speed: number
  wait: number
}

// A line the player presses by using it or by walking over it.
type Trigger = {
  line: number
  how: 'use' | 'walk'
  once: boolean
  // The movers it starts, the key it needs (0 none, 1 blue, 2 yellow, 3 red), and whether it ends the level.
  movers: number[]
  key: number
  exit: boolean
}

function neighbors(map: DoomMap, sector: number) {
  const result = new Set<number>()
  for (const linedef of map.linedefs) {
    if (linedef.back < 0) continue
    const front = map.sidedefs[linedef.front]!.sector
    const back = map.sidedefs[linedef.back]!.sector
    if (front === sector) result.add(back)
    if (back === sector) result.add(front)
  }
  result.delete(sector)
  return [...result]
}

function findMovers(map: DoomMap) {
  const movers: Mover[] = []
  const moverOf = new Map<number, number>()
  const addMover = (sector: number, kind: MoverKind, speed = 2) => {
    const existing = moverOf.get(sector)
    if (existing !== undefined) return existing
    const here = map.sectors[sector]!
    const around = neighbors(map, sector).map(index => map.sectors[index]!)
    let mover: Mover
    if (kind === 'door' || kind === 'open') {
      const top = Math.min(...around.map(neighbor => neighbor.ceiling)) - 4
      mover = {sector, kind, ceiling: true, rest: here.ceiling, target: top, speed, wait: kind === 'door' ? 150 : 0}
    } else if (kind === 'lift') {
      const low = Math.min(here.floor, ...around.map(neighbor => neighbor.floor))
      mover = {sector, kind, ceiling: false, rest: here.floor, target: low, speed: 4, wait: 105}
    } else if (kind === 'turbo') {
      // Doom's turboLower: the highest neighboring floor, 8 above it unless that is where the floor already is.
      const high = Math.max(...around.map(neighbor => neighbor.floor))
      mover = {sector, kind, ceiling: false, rest: here.floor, target: high === here.floor ? high : high + 8, speed: 4, wait: 0}
    } else {
      // P_FindLowestFloorSurrounding, which counts the sector's own floor too.
      const low = Math.min(here.floor, ...around.map(neighbor => neighbor.floor))
      mover = {sector, kind, ceiling: false, rest: here.floor, target: low, speed: 1, wait: 0}
    }
    moverOf.set(sector, movers.length)
    movers.push(mover)
    return movers.length - 1
  }
  const tagged = (tag: number) => map.sectors.flatMap((sector, index) => sector.tag === tag ? [index] : [])
  const triggers: Trigger[] = []
  map.linedefs.forEach((linedef, line) => {
    const back = linedef.back >= 0 ? map.sidedefs[linedef.back]!.sector : -1
    const add = (how: 'use' | 'walk', once: boolean, movers: number[], key = 0, exit = false) =>
      triggers.push({line, how, once, movers, key, exit})
    switch (linedef.special) {
      case 1: add('use', false, [addMover(back, 'door')]); break
      case 26: add('use', false, [addMover(back, 'door')], 1); break
      case 27: add('use', false, [addMover(back, 'door')], 2); break
      case 28: add('use', false, [addMover(back, 'door')], 3); break
      case 117: add('use', false, [addMover(back, 'door', 8)]); break
      case 31: add('use', true, [addMover(back, 'open')]); break
      case 2: add('walk', true, tagged(linedef.tag).map(sector => addMover(sector, 'open'))); break
      case 62: add('use', false, tagged(linedef.tag).map(sector => addMover(sector, 'lift'))); break
      case 88: add('walk', false, tagged(linedef.tag).map(sector => addMover(sector, 'lift'))); break
      case 23: add('use', true, tagged(linedef.tag).map(sector => addMover(sector, 'floor'))); break
      case 38: add('walk', true, tagged(linedef.tag).map(sector => addMover(sector, 'floor'))); break
      case 36: add('walk', true, tagged(linedef.tag).map(sector => addMover(sector, 'turbo'))); break
      case 11: add('use', true, [], 0, true); break
      default: break
    }
  })
  return {movers, triggers}
}

// The player's cells, the movers' and triggers' state, and the heights of every sector, which movers change.
function gameSpec(level: Level, states: StateTables, things: LevelThing[]) {
  const {map} = level
  const {movers, triggers} = findMovers(map)
  const start = map.things.find(thing => thing.type === 1)!
  const startSector = map.sectors[level.cells[cellContaining(level, start.x, start.y)]!.sector]!
  return {
    keys: {
      forward: inputBit(),
      back: inputBit(),
      turnLeft: inputBit(),
      turnRight: inputBit(),
      strafeLeft: inputBit(),
      strafeRight: inputBit(),
      run: inputBit(),
      use: inputBit(),
      ...weaponKeys(),
    },
    player: {
      x: state([-(2 ** 14), 2 ** 14], {initial: start.x}),
      y: state([-(2 ** 14), 2 ** 14], {initial: start.y}),
      z: state([-4096, 4096], {initial: startSector.floor}),
      momX: state([-maxMove, maxMove]),
      momY: state([-maxMove, maxMove]),
      momZ: state([-256, 64]),
      angle: state([0, fineAngles - 1], {grid: 1, initial: Math.round(start.angle / 360 * fineAngles) % fineAngles}),
      cell: state([0, level.cells.length - 1], {grid: 1, initial: cellContaining(level, start.x, start.y)}),
      floorZ: state([-4096, 4096], {initial: startSector.floor}),
      viewHeight: state([0, 64], {initial: viewHeight}),
      deltaViewHeight: state([-64, 64]),
      bobPhase: state([0, fineAngles - 1], {grid: 1}),
      usedLastTic: stateBit(),
      keys: list(3, () => stateBit()),
      exited: stateBit(),
      health: state([0, 200], {grid: 1, initial: 100}),
      armor: state([0, 200], {grid: 1}),
      bullets: state([0, 200], {grid: 1, initial: 50}),
      shells: state([0, 50], {grid: 1}),
      rockets: state([0, 50], {grid: 1}),
      energy: state([0, 300], {grid: 1}),
      shotgun: stateBit(),
      chainsaw: stateBit(),
      // Doom's damagecount, which reddens the screen, and bonuscount, which tints it gold after a pickup.
      damageCount: state([0, 100], {grid: 1}),
      bonusCount: state([0, 100], {grid: 1}),
      weapon: weaponSpec(states),
    },
    // The random table's index, the tic count modulo 32 for damaging floors, and modulo 768 for animations.
    random: state([0, 1023], {grid: 1}),
    clock: state([0, 31], {grid: 1}),
    time: state([0, 767], {grid: 1}),
    // Sectors whose light changes: Doom's flickering, glowing and strobing specials.
    lights: lightingSectors(level).map(lighting => ({
      level: state([0, 255], {grid: 1, initial: lighting.max}),
      count: state([0, 255], {grid: 1, initial: lighting.initialCount}),
      rising: stateBit(),
    })),
    monsters: things.filter(thing => thing.info.kind === 'monster').map(thing => monsterSpec(level, thing)),
    barrels: things.filter(thing => thing.info.kind === 'barrel').map(thing => barrelSpec(thing)),
    // One fireball per imp.
    projectiles: things.filter(thing => thing.type === 3001).map(() => projectileSpec(level, states)),
    // What a former human leaves where it dies: a clip from a zombieman, a shotgun from a shotgun guy.
    drops: things.filter(thing => dropOf(thing) !== null).map(() => ({
      present: stateBit(),
      x: state([-(2 ** 14), 2 ** 14]),
      y: state([-(2 ** 14), 2 ** 14]),
      z: state([-4096, 4096]),
      sector: state([0, level.map.sectors.length - 1], {grid: 1}),
    })),
    sectors: {
      floor: map.sectors.map(sector => state([-4096, 4096], {initial: sector.floor, grid: 1})),
      ceiling: map.sectors.map(sector => state([-4096, 4096], {initial: sector.ceiling, grid: 1})),
    },
    // Per mover, the phase as five exact bits (rest, going, waiting, coming back, done) and the wait's countdown.
    movers: movers.map(() => ({
      rest: stateBit(1),
      go: stateBit(),
      wait: stateBit(),
      back: stateBit(),
      done: stateBit(),
      timer: state([0, 255], {grid: 1}),
    })),
    // Per trigger that fires once, whether it has.
    fired: triggers.map(() => stateBit()),
    // Per thing: its state and the tics left in it, Doom's mobj->state and mobj->tics, and whether it is still there.
    things: things.map(thing => ({
      state: state([0, states.count - 1], {grid: 1, initial: thing.state}),
      tics: state([-1, 255], {grid: 1, initial: initialTics(states, thing)}),
      present: stateBit(1),
    })),
  }
}

// Doom's light specials: 1 flickers between the sector's light and its darkest neighbor's at random intervals; 8
// glows between them by 8 per tic; 2, 3, 4, 12 and 13 strobe, bright for 5 tics, dark for 15 or 35. Strobes that Doom
// synchronizes start together, the others at a step that the sector's index picks.
type Lighting = {sector: number, kind: 'flicker' | 'glow' | 'strobe', max: number, min: number, dark: number, initialCount: number}

function lightingSectors(level: Level): Lighting[] {
  const {map} = level
  return map.sectors.flatMap((sector, index): Lighting[] => {
    const around = neighbors(map, index).map(neighbor => map.sectors[neighbor]!.light)
    const min = Math.min(sector.light, ...around)
    const special = sector.special
    if (special === 1) return [{sector: index, kind: 'flicker', max: sector.light, min, dark: 0, initialCount: 1 + (index * 29) % 64}]
    if (special === 8) return [{sector: index, kind: 'glow', max: sector.light, min, dark: 0, initialCount: 0}]
    if ([2, 3, 4, 12, 13].includes(special)) {
      const dark = special === 3 || special === 12 ? 35 : 15
      const synchronized = special === 12 || special === 13
      return [{sector: index, kind: 'strobe', max: sector.light, min: min === sector.light ? 0 : min, dark, initialCount: synchronized ? 1 : 1 + (index * 13) % 8}]
    }
    return []
  })
}

// Doom's P_KillMobj drops: half a clip, 5 bullets, from a zombieman, and a shotgun with 4 shells from a shotgun guy.
function dropOf(thing: LevelThing) {
  if (thing.type === 3004) return {state: 'CLIP', bullets: 5, shells: 0, shotgun: false}
  if (thing.type === 9) return {state: 'SHOT', bullets: 0, shells: 4, shotgun: true}
  return null
}

// Doom starts a thing's first state at a random tic, 1 + P_Random() % tics, so that rows of the same item don't flash
// together; here the thing's index picks it.
function initialTics(states: StateTables, thing: LevelThing) {
  const tics = states.tics[thing.state]!
  return tics > 0 ? 1 + (thing.index * 37) % tics : tics
}


export function buildGameProgram(level: Level, states: StateTables = buildStateTables(), things: LevelThing[] = levelThings(level.map, states)) {
  const {map} = level
  const {movers, triggers} = findMovers(map)
  const table = createSourceTable()
  const spec = gameSpec(level, states, things)
  const cells = table.declare(spec)
  const circuit = table.createCircuit()
  const {keys, player, sectors} = cells
  const consts = (values: number[]) => constantTable(circuit, values)

  const angles = Array.from({length: fineAngles}, (_, angle) => angle * 2 * Math.PI / fineAngles)
  const cosTable = consts(angles.map(Math.cos))
  const sinTable = consts(angles.map(Math.sin))

  // Turn and thrust, P_MovePlayer. Running doubles the turn and the forward move. A dead player doesn't move.
  const alive = bitOf(circuit, [[player.health, 1]], -0.5)
  const live = (wire: Wire) => and(circuit, wire, alive)
  const moveKeys = {
    forward: live(keys.forward), back: live(keys.back), turnLeft: live(keys.turnLeft), turnRight: live(keys.turnRight),
    strafeLeft: live(keys.strafeLeft), strafeRight: live(keys.strafeRight), run: keys.run,
  }
  const fastForward = and(circuit, moveKeys.forward, moveKeys.run)
  const fastBack = and(circuit, moveKeys.back, moveKeys.run)
  const fastLeft = and(circuit, moveKeys.turnLeft, moveKeys.run)
  const fastRight = and(circuit, moveKeys.turnRight, moveKeys.run)
  const turned = circuit.affine([[player.angle, 1], [moveKeys.turnLeft, 80], [fastLeft, 80], [moveKeys.turnRight, -80], [fastRight, -80]])
  // The stored angle is a whole number, and each turn key's bit adds or takes a whole 80.
  circuit.assumeGrid(turned, 1)
  const wrapsDown = emitCompare(circuit, turned, '>=', circuit.constant(fineAngles))
  const wrapsUp = emitCompare(circuit, turned, '<', circuit.constant(0))
  const angle = circuit.affine([[turned, 1], [wrapsDown, -fineAngles], [wrapsUp, fineAngles]])
  // The turn moves the stored angle, 0..fineAngles - 1, by at most 160, so one wrap at either end brings it back.
  circuit.assumeRange(angle, 0, fineAngles - 1)
  const cos = circuit.indexRead(angle, cosTable)
  const sin = circuit.indexRead(angle, sinTable)
  // Both are read from tables of cosines and sines.
  circuit.assumeRange(cos, -1, 1)
  circuit.assumeRange(sin, -1, 1)
  const fastStrafeLeft = and(circuit, moveKeys.strafeLeft, moveKeys.run)
  const fastStrafeRight = and(circuit, moveKeys.strafeRight, moveKeys.run)
  // forwardmove 25 or 50 and sidemove 24 or 40, thrust move × 2048 / 65536 = move / 32 per tic.
  const forwardMove = circuit.affine([[moveKeys.forward, 25], [fastForward, 25], [moveKeys.back, -25], [fastBack, -25]])
  const sideMove = circuit.affine([[moveKeys.strafeRight, 24], [fastStrafeRight, 16], [moveKeys.strafeLeft, -24], [fastStrafeLeft, -16]])
  const clampMove = (terms: Terms) => {
    const low = emitMax(circuit, circuit.affine(terms), circuit.constant(-maxMove))
    return emitMin(circuit, low, circuit.constant(maxMove))
  }
  // Side thrust is along angle - 90°: (sin, -cos).
  const thrustX = clampMove([[player.momX, 1], [circuit.multiply(forwardMove, cos), 1 / 32], [circuit.multiply(sideMove, sin), 1 / 32]])
  const thrustY = clampMove([[player.momY, 1], [circuit.multiply(forwardMove, sin), 1 / 32], [circuit.multiply(sideMove, cos), -1 / 32]])

  // Move, P_TryMove with the stairstep fallbacks of P_SlideMove: the whole move, then x alone, then y alone.
  const bsp = bspTables(circuit, level)
  const lines = lineTables(circuit, level, sectors.floor, sectors.ceiling, playerRadius + maxMove)
  const sectorOfCell = consts(level.cells.map(cell => cell.sector))
  const monsterThings = things.filter(thing => thing.info.kind === 'monster')
  const barrelThings = things.filter(thing => thing.info.kind === 'barrel')
  const thingCellsOf = (thing: LevelThing) => cells.things[thing.index]!
  // Things that block and never move: solid decorations, and barrels until they are gone.
  const solidThings = things.filter(thing => thing.info.solid && thing.info.kind !== 'monster').map(thing => ({
    x: thing.x, y: thing.y, radius: thing.info.radius, present: thingCellsOf(thing).present,
  }))
  const solids = solidTables(circuit, level, solidThings, 64)
  const monsterBlockers: Blocker[] = monsterThings.map((thing, index) => ({
    x: cells.monsters[index]!.x, y: cells.monsters[index]!.y, radius: thing.info.radius, solid: cells.monsters[index]!.solid,
  }))
  const check = (x: Wire, y: Wire) => {
    const cell = emitLocate(circuit, bsp, x, y)
    const sector = circuit.indexRead(cell, sectorOfCell)
    const result = emitCheckPosition(circuit, lines, {
      x,
      y,
      z: player.z,
      radius: playerRadius,
      height: playerHeight,
      sectorFloor: circuit.indexRead(sector, sectors.floor),
      sectorCeiling: circuit.indexRead(sector, sectors.ceiling),
      player: true,
      solids,
      movers: monsterBlockers,
    })
    return {...result, cell}
  }
  const toX = circuit.affine([[player.x, 1], [thrustX, 1]])
  const toY = circuit.affine([[player.y, 1], [thrustY, 1]])
  const both = check(toX, toY)
  const alongX = check(toX, player.y)
  const alongY = check(player.x, toY)
  const movedBoth = not(circuit, both.blocked)
  const movedX = and(circuit, both.blocked, not(circuit, alongX.blocked))
  const movedY = and(circuit, both.blocked, alongX.blocked, not(circuit, alongY.blocked))
  const stuck = and(circuit, both.blocked, alongX.blocked, alongY.blocked)
  const usesX = circuit.affine([[movedBoth, 1], [movedX, 1]])
  const usesY = circuit.affine([[movedBoth, 1], [movedY, 1]])
  const x = circuit.affine([[player.x, 1], [gate(circuit, [[thrustX, 1]], usesX), 1]])
  const y = circuit.affine([[player.y, 1], [gate(circuit, [[thrustY, 1]], usesY), 1]])
  const pick = (values: [Wire, Wire][], fallback: Wire) => circuit.affine([
    ...values.map(([value, selected]) => [gate(circuit, [[value, 1]], selected), 1] as const),
    [gate(circuit, [[fallback, 1]], stuck), 1],
  ])
  const cell = pick([[both.cell, movedBoth], [alongX.cell, movedX], [alongY.cell, movedY]], player.cell)
  const floorZ = pick([[both.floor, movedBoth], [alongX.floor, movedX], [alongY.floor, movedY]], player.floorZ)

  // Friction, and stopping when slow with no keys held.
  const keptX = gate(circuit, [[thrustX, friction]], usesX)
  const keptY = gate(circuit, [[thrustY, friction]], usesY)
  const noMoveKeys = emitReluSum(circuit, [[keys.forward, -1], [keys.back, -1], [keys.strafeLeft, -1], [keys.strafeRight, -1]], 1)
  const slow = and(circuit,
    bitOf(circuit, [[emitAbs(circuit, keptX), -1]], stopSpeed),
    bitOf(circuit, [[emitAbs(circuit, keptY), -1]], stopSpeed),
    noMoveKeys)
  const momX = gate(circuit, [[keptX, 1]], not(circuit, slow))
  const momY = gate(circuit, [[keptY, 1]], not(circuit, slow))

  // P_ZMovement: step up at once and lower the view to smooth it, or fall with gravity.
  const above = bitOf(circuit, [[player.z, 1], [floorZ, -1]], -1 / 64)
  const stepUp = emitReluSum(circuit, [[floorZ, 1], [player.z, -1]])
  // Falling: momz starts at -2 and grows by -1 per tic.
  const startsFalling = bitOf(circuit, [[player.momZ, 1]], 0.5)
  const fallSpeed = circuit.affine([[player.momZ, 1], [startsFalling, -1]], -1)
  const fallen = circuit.affine([[player.z, 1], [fallSpeed, 1]])
  // Landed: the fall reaches the floor, within FP32 rounding of the heights.
  const landed = and(circuit, above, bitOf(circuit, [[floorZ, 1], [fallen, -1]], 1e-3))
  const falling = and(circuit, above, not(circuit, landed))
  const z = circuit.affine([[floorZ, 1], [gate(circuit, [[fallen, 1], [floorZ, -1]], falling), 1]])
  const momZ = gate(circuit, [[fallSpeed, 1]], falling)
  // momz is 0 except in a fall, where it starts at -2 and grows by -1 per tic. The longest fall, the 8192 units from
  // the highest z to the lowest floor, lands within 127 tics, before momz passes -128.
  circuit.assumeRange(momZ, -256, 64)
  // A hard landing squats the view by momz / 8.
  const hardLanding = and(circuit, landed, bitOf(circuit, [[player.momZ, -1]], -8))

  // P_CalcHeight: the view height eases back to 41, and the view bobs with speed.
  const loweredView = circuit.affine([[player.viewHeight, 1], [stepUp, -1]])
  const stepped = bitOf(circuit, [[stepUp, 1]], -1e-3)
  const delta0 = circuit.affine([
    [player.deltaViewHeight, 1],
    [gate(circuit, [[loweredView, -1 / 8], [player.deltaViewHeight, -1]], stepped, viewHeight / 8), 1],
    [gate(circuit, [[fallSpeed, 1 / 8], [player.deltaViewHeight, -1]], hardLanding), 1],
  ])
  const eased = circuit.affine([[loweredView, 1], [delta0, 1]])
  const tooHigh = bitOf(circuit, [[eased, 1]], -viewHeight)
  const tooLow = bitOf(circuit, [[eased, -1]], viewHeight / 2)
  const nextView = circuit.affine([
    [eased, 1],
    [gate(circuit, [[eased, -1]], tooHigh, viewHeight), 1],
    [gate(circuit, [[eased, -1]], tooLow, viewHeight / 2), 1],
  ])
  // The eased view is clamped to half the view height and the view height just above.
  circuit.assumeRange(nextView, viewHeight / 2, viewHeight)
  // A nonzero delta grows by 1/4 per tic until the view is back up. Doom keeps a delta that reaches 0 at 1/65536 so the
  // view keeps rising, here 2^-8, and a view pushed under half height rises from there, its delta at or below 0 set
  // to that smallest one. Deltas are multiples of 2^-8, so 1e-4 tells 0 from the rest.
  const moving = bitOf(circuit, [[emitAbs(circuit, delta0), 1]], -1e-4)
  const lifted = and(circuit, tooLow, not(circuit, bitOf(circuit, [[delta0, 1]], -1e-4)))
  const grown = circuit.affine([[delta0, 1], [gate(circuit, [[delta0, -1]], lifted), 1]], 0.25)
  const reachedZero = not(circuit, bitOf(circuit, [[emitAbs(circuit, grown), 1]], -1e-4))
  const keepsRising = circuit.affine([[and(circuit, moving, not(circuit, tooHigh)), 1], [and(circuit, tooLow, not(circuit, moving)), 1]])
  const nextDelta = gate(circuit, [[grown, 1], [reachedZero, 2 ** -8]], keepsRising)
  // A hard landing sets the delta to momz / 8, at least -16, and a step to (41 - the lowered view) / 8, under 8. It
  // grows by 1/4 per tic only while the view it eases, never under a dead player's 6, stays at or under 41, so it
  // stays under 36.
  circuit.assumeRange(nextDelta, -64, 64)
  // Bob: min(16, (momx² + momy²) / 4), times sin(409 × tic) / 2.
  const speedSquared = circuit.affine([[circuit.multiply(momX, momX), 1 / 4], [circuit.multiply(momY, momY), 1 / 4]])
  const bobAmount = emitMin(circuit, speedSquared, circuit.constant(16))
  const phaseStep = circuit.affine([[player.bobPhase, 1]], 409)
  // The stored phase and 409 are whole numbers.
  circuit.assumeGrid(phaseStep, 1)
  const bobPhase = circuit.affine([[phaseStep, 1], [emitCompare(circuit, phaseStep, '>=', circuit.constant(fineAngles)), -fineAngles]])
  // The stored phase, 0..fineAngles - 1, gains 409 and loses fineAngles once it reaches fineAngles.
  circuit.assumeRange(bobPhase, 0, fineAngles - 1)
  const bob = circuit.multiply(bobAmount, circuit.indexRead(bobPhase, sinTable))
  const sectorCeiling = circuit.indexRead(circuit.indexRead(cell, sectorOfCell), sectors.ceiling)
  const eye = emitMin(circuit, circuit.affine([[z, 1], [nextView, 1], [bob, 1 / 2]]), circuit.affine([[sectorCeiling, 1]], -4))

  // Using and crossing lines.
  const usePressed = and(circuit, keys.use, not(circuit, player.usedLastTic))
  // cross(dir, a - p) = cos × ay - sin × ax - (cos × py - sin × px), shared by every line's two ends.
  const facing: Terms = [[circuit.multiply(cos, player.y), -1], [circuit.multiply(sin, player.x), 1]]
  const triggered = triggers.map((trigger, index) => {
    const linedef = map.linedefs[trigger.line]!
    const a = map.vertices[linedef.v1]!
    const b = map.vertices[linedef.v2]!
    const dx = b.x - a.x
    const dy = b.y - a.y
    if (trigger.how === 'use') {
      // The player is on the line's front, right side: cross(d, p - a) = dx (py - ay) - dy (px - ax) < 0.
      const playerFront = bitOf(circuit, [[player.y, -dx], [player.x, dy]], dx * a.y - dy * a.x)
      // The far end of the use ray is behind the line.
      const reachBack = bitOf(circuit, [[player.y, dx], [player.x, -dy], [sin, dx * useRange], [cos, -dy * useRange]], -dx * a.y + dy * a.x)
      const endA = bitOf(circuit, [...facing, [cos, a.y], [sin, -a.x]])
      const endB = bitOf(circuit, [...facing, [cos, b.y], [sin, -b.x]])
      const between = circuit.affine([[emitReluSum(circuit, [[endA, 1], [endB, -1]]), 1], [emitReluSum(circuit, [[endB, 1], [endA, -1]]), 1]])
      let fires = and(circuit, usePressed, playerFront, reachBack, between)
      if (trigger.key > 0) fires = and(circuit, fires, player.keys[trigger.key - 1]!)
      if (trigger.once) fires = and(circuit, fires, not(circuit, cells.fired[index]!))
      return fires
    }
    // Walking: the center crossed from one side to the other, within the line's extent.
    const sideBefore = bitOf(circuit, [[player.y, -dx], [player.x, dy]], dx * a.y - dy * a.x)
    const sideAfter = bitOf(circuit, [[y, -dx], [x, dy]], dx * a.y - dy * a.x)
    const crossed = circuit.affine([[emitReluSum(circuit, [[sideBefore, 1], [sideAfter, -1]]), 1], [emitReluSum(circuit, [[sideAfter, 1], [sideBefore, -1]]), 1]])
    const length = Math.hypot(dx, dy)
    // The projection of the new center onto the line, within 0..length (± the radius).
    const projection: Terms = [[x, dx / length], [y, dy / length]]
    const offset = -(a.x * dx + a.y * dy) / length
    const within = and(circuit, bitOf(circuit, projection, offset + playerRadius), bitOf(circuit, projection.map(([wire, c]) => [wire, -c] as const), -offset + length + playerRadius))
    let fires = and(circuit, crossed, within)
    if (trigger.once) fires = and(circuit, fires, not(circuit, cells.fired[index]!))
    return fires
  })

  const nextFloor = [...sectors.floor]
  const nextCeiling = [...sectors.ceiling]
  const moverStates = movers.map((mover, index) => {
    const phase = cells.movers[index]!
    const activators = triggers.flatMap((trigger, triggerIndex) => trigger.movers.includes(index) ? [triggered[triggerIndex]!] : [])
    const act = activators.length === 0 ? circuit.constant(0) : emitPositiveBit(circuit, activators.map(wire => [wire, 1] as const), -0.5)
    const toggles = mover.kind === 'door'
    // Phases after this tic's activation: rest starts going; a door going or waiting comes back, and one coming back goes.
    const restA = and(circuit, phase.rest, not(circuit, act))
    const goA = toggles
      ? circuit.affine([[and(circuit, phase.go, not(circuit, act)), 1], [and(circuit, phase.rest, act), 1], [and(circuit, phase.back, act), 1]])
      : circuit.affine([[phase.go, 1], [and(circuit, phase.rest, act), 1]])
    const waitA = toggles ? and(circuit, phase.wait, not(circuit, act)) : phase.wait
    const backA = toggles
      ? circuit.affine([[and(circuit, phase.back, not(circuit, act)), 1], [and(circuit, phase.go, act), 1], [and(circuit, phase.wait, act), 1]])
      : phase.back
    const height = mover.ceiling ? sectors.ceiling[mover.sector]! : sectors.floor[mover.sector]!
    const floor = sectors.floor[mover.sector]!
    const up = mover.target > mover.rest ? 1 : -1
    // Toward the target, and back toward rest, by the speed, stopping there.
    const towardTarget = up > 0
      ? emitMin(circuit, circuit.affine([[height, 1]], mover.speed), circuit.constant(mover.target))
      : emitMax(circuit, circuit.affine([[height, 1]], -mover.speed), circuit.constant(mover.target))
    // A door comes back down to its floor; anything else comes back to where it rested.
    const restHeight = mover.ceiling ? floor : circuit.constant(mover.rest)
    const towardRest = up > 0
      ? emitMax(circuit, circuit.affine([[height, 1]], -mover.speed), restHeight)
      : emitMin(circuit, circuit.affine([[height, 1]], mover.speed), restHeight)
    // Heights, speeds, targets and rests are whole numbers, and emitMin and emitMax are exact on whole numbers.
    circuit.assumeGrid(towardTarget, 1, {allowExistingReaders: true})
    circuit.assumeGrid(towardRest, 1, {allowExistingReaders: true})
    const arrived = emitCompare(circuit, towardTarget, '===', circuit.constant(mover.target))
    const fromRest = circuit.affine([[towardRest, 1], [restHeight, -1]])
    // Both heights are whole numbers.
    circuit.assumeGrid(fromRest, 1, {allowExistingReaders: true})
    const returned = emitCompare(circuit, fromRest, '===', circuit.constant(0))
    // A closing door reverses on the player, Doom's crush check, here the player's box in the sector's bounds.
    let blocked: Wire = circuit.constant(0)
    if (mover.kind === 'door') {
      const box = sectorBounds(map, mover.sector)
      blocked = and(circuit,
        bitOf(circuit, [[x, 1]], playerRadius - box.left),
        bitOf(circuit, [[x, -1]], box.right + playerRadius),
        bitOf(circuit, [[y, 1]], playerRadius - box.bottom),
        bitOf(circuit, [[y, -1]], box.top + playerRadius))
    }
    const backBlocked = and(circuit, backA, blocked)
    const backMoves = and(circuit, backA, not(circuit, blocked))
    const timerDone = emitCompare(circuit, phase.timer, '<=', circuit.constant(1))
    const hasWait = mover.wait > 0
    const goArrived = and(circuit, goA, arrived)
    const next = {
      rest: circuit.affine([[restA, 1], [and(circuit, backMoves, returned), 1]]),
      go: circuit.affine([[and(circuit, goA, not(circuit, arrived)), 1], [backBlocked, 1]]),
      wait: hasWait ? circuit.affine([[goArrived, 1], [and(circuit, waitA, not(circuit, timerDone)), 1]]) : circuit.constant(0),
      back: circuit.affine([[and(circuit, waitA, timerDone), 1], [and(circuit, backMoves, not(circuit, returned)), 1]]),
      done: hasWait ? phase.done : circuit.affine([[phase.done, 1], [goArrived, 1]]),
      timer: circuit.affine([[gate(circuit, [], goArrived, mover.wait), 1], [gate(circuit, [[phase.timer, 1]], waitA, -1), 1]]),
    }
    const moved = circuit.affine([
      [height, 1],
      [gate(circuit, [[towardTarget, 1], [height, -1]], goA), 1],
      [gate(circuit, [[towardRest, 1], [height, -1]], backMoves), 1],
    ])
    if (mover.ceiling) nextCeiling[mover.sector] = moved
    else nextFloor[mover.sector] = moved
    return next
  })

  // Things: each state runs for its tics and then goes to the next; the player picks up what it touches.
  const stateNext = consts(states.next)
  const stateTics = consts(states.tics)
  const stateFrame = consts(states.frame)
  const stateBright = consts(states.bright)
  const thingStates = things.map((_, index) => {
    const wires = cells.things[index]!
    const advances = emitCompare(circuit, wires.tics, '===', circuit.constant(1))
    const nextState = circuit.indexRead(wires.state, stateNext)
    const counting = emitCompare(circuit, wires.tics, '>', circuit.constant(0))
    return {
      state: circuit.affine([[wires.state, 1], [gate(circuit, [[nextState, 1], [wires.state, -1]], advances), 1]]),
      tics: circuit.affine([[wires.tics, 1], [counting, -1], [gate(circuit, [[circuit.indexRead(nextState, stateTics), 1]], advances), 1]]),
    }
  })
  // Pickups, in the map's order, each against the counters as the ones before it left them, like Doom's one call of
  // P_TouchSpecialThing per touched thing. A thing is touched when the boxes overlap: |dx| and |dy| below the radii's sum.
  let health: Wire = player.health
  let armor: Wire = player.armor
  const ammo = {bullets: player.bullets, shells: player.shells, rockets: player.rockets, cells: player.energy}
  const ammoLimit = {bullets: 200, shells: 50, rockets: 50, cells: 300}
  const keysHeld: Wire[] = [...player.keys]
  let shotgun: Wire = player.shotgun
  let chainsaw: Wire = player.chainsaw
  // What the player took this tic, for the gold tint.
  const pickedUp: Wire[] = []
  const presence = things.map((thing, index) => {
    const wires = cells.things[index]!
    const pickup = thing.info.pickup
    if (pickup === undefined) return wires.present
    const reach = playerRadius + thing.info.radius
    const touched = and(circuit, wires.present,
      bitOf(circuit, [[x, 1]], reach - thing.x), bitOf(circuit, [[x, -1]], reach + thing.x),
      bitOf(circuit, [[y, 1]], reach - thing.y), bitOf(circuit, [[y, -1]], reach + thing.y))
    let taken: Wire = touched
    const raise = (value: Wire, amount: number, limit: number, onlyBelow: boolean) => {
      const below = bitOf(circuit, [[value, -1]], limit - 0.5)
      if (onlyBelow) taken = and(circuit, touched, below)
      const raised = emitMin(circuit, circuit.affine([[value, 1]], amount), circuit.constant(limit))
      return circuit.affine([[value, 1], [gate(circuit, [[raised, 1], [value, -1]], taken), 1]])
    }
    if ('health' in pickup) health = raise(health, pickup.health, pickup.limit, pickup.always !== true)
    else if ('armor' in pickup) armor = raise(armor, pickup.armor, pickup.limit, pickup.always !== true)
    else if ('ammo' in pickup) ammo[pickup.ammo] = raise(ammo[pickup.ammo], pickup.amount, ammoLimit[pickup.ammo], true)
    else if ('key' in pickup) keysHeld[pickup.key - 1] = circuit.affine([[keysHeld[pickup.key - 1]!, 1], [emitReluSum(circuit, [[touched, 1], [keysHeld[pickup.key - 1]!, -1]]), 1]])
    else if (pickup.weapon === 'shotgun') {
      shotgun = emitMax(circuit, shotgun, touched)
      ammo.shells = raise(ammo.shells, pickup.shells ?? 0, ammoLimit.shells, false)
    } else {
      chainsaw = emitMax(circuit, chainsaw, touched)
    }
    pickedUp.push(taken)
    return and(circuit, wires.present, not(circuit, taken))
  })

  // Actors: the weapon, shots, barrels, monsters and their fireballs.
  const random = randomSource(circuit, cells.random)
  const world: ActorWorld = {
    circuit, states, bsp, lines, solids, sectorOfCell, random,
    rays: rayTables(circuit, level, sectors.floor, sectors.ceiling),
    floor: sectors.floor,
    ceiling: sectors.ceiling,
    hearing: consts([...hearingTable(level)]),
  }
  const playerSector = circuit.indexRead(cell, sectorOfCell)
  const playerView: PlayerView = {
    x, y, cell, sector: playerSector, cos, sin, alive,
    bullets: ammo.bullets, shells: ammo.shells, hasShotgun: shotgun, moveBob: bobAmount,
  }
  const weapon = emitWeapon(world, player.weapon, {fire: live(keys.fire), fist: keys.fist, pistol: keys.pistol, shotgun: keys.shotgun}, playerView)
  const monsterAlive = monsterThings.map((_, index) => bitOf(circuit, [[cells.monsters[index]!.health, 1]], -0.5))
  const barrelAlive = barrelThings.map((thing, index) => and(circuit, thingCellsOf(thing).present, bitOf(circuit, [[cells.barrels[index]!.health, 1]], -0.5)))
  const targets: Target[] = [
    ...monsterThings.map((thing, index) => ({x: cells.monsters[index]!.x, y: cells.monsters[index]!.y, radius: thing.info.radius, shootable: monsterAlive[index]!})),
    ...barrelThings.map((thing, index) => ({x: circuit.constant(thing.x), y: circuit.constant(thing.y), radius: thing.info.radius, shootable: barrelAlive[index]!})),
  ]
  const shotDamage = emitShots(world, playerView, weapon, targets)
  // Barrels that explode this tic: in A_Explode's state, entered on the tic before.
  const exploding = states.state('BEXP4')
  const explodes = barrelThings.map(thing => and(circuit,
    emitCompare(circuit, thingCellsOf(thing).state, '===', circuit.constant(exploding)),
    emitCompare(circuit, thingCellsOf(thing).tics, '===', circuit.constant(states.tics[exploding]!))))
  const blastsOn = (tx: Wire, ty: Wire, radius: number, staticAt?: {x: number, y: number}) => circuit.affine(barrelThings.flatMap((barrel, index) => {
    if (staticAt !== undefined && Math.max(Math.abs(barrel.x - staticAt.x), Math.abs(barrel.y - staticAt.y)) - radius >= 128) return []
    return [[emitBlast(circuit, explodes[index]!, circuit.constant(barrel.x), circuit.constant(barrel.y), tx, ty, radius), 1] as const]
  }))
  const barrelResults = barrelThings.map((thing, index) => emitBarrel(world, thing, cells.barrels[index]!.health, thingCellsOf(thing),
    circuit.affine([[shotDamage[monsterThings.length + index]!, 1], [blastsOn(circuit.constant(thing.x), circuit.constant(thing.y), thing.info.radius, thing), 1]])))
  const playerBlocker: Blocker = {x, y, radius: playerRadius, solid: alive}
  const impSlots = new Map(things.filter(thing => thing.type === 3001).map((thing, slot) => [thing.index, slot]))
  const monsterResults: MonsterResult[] = monsterThings.map((thing, index) => {
    const others = [...monsterBlockers.filter((_, other) => other !== index), playerBlocker]
    const monster = cells.monsters[index]!
    const slot = impSlots.get(thing.index)
    const damageTaken = circuit.affine([[shotDamage[index]!, 1], [blastsOn(monster.x, monster.y, thing.info.radius), 1]])
    return emitMonster(world, {thing, cells: monster, thingCells: thingCellsOf(thing), projectile: slot === undefined ? null : cells.projectiles[slot]!},
      playerView, others, damageTaken, weapon.noise)
  })

  // Drops: appear where their monster dies, and are picked up like the map's items.
  const droppers = things.filter(thing => dropOf(thing) !== null)
  const dropNext = droppers.map((thing, index) => {
    const drop = cells.drops[index]!
    const result = monsterResults[monsterThings.indexOf(thing)]!
    const info = dropOf(thing)!
    const monster = cells.monsters[monsterThings.indexOf(thing)]!
    const reach = playerRadius + 20
    const touched = and(circuit, drop.present,
      bitOf(circuit, [[x, 1], [drop.x, -1]], reach), bitOf(circuit, [[x, -1], [drop.x, 1]], reach),
      bitOf(circuit, [[y, 1], [drop.y, -1]], reach), bitOf(circuit, [[y, -1], [drop.y, 1]], reach))
    let taken = touched
    if (info.bullets > 0) {
      taken = and(circuit, touched, bitOf(circuit, [[ammo.bullets, -1]], 199.5))
      ammo.bullets = circuit.affine([[ammo.bullets, 1], [circuit.reglu([[emitMin(circuit, circuit.affine([[ammo.bullets, 1]], info.bullets), circuit.constant(200)), 1], [ammo.bullets, -1]], 0, [[taken, 1]], 0), 1]])
    } else {
      ammo.shells = circuit.affine([[ammo.shells, 1], [circuit.reglu([[emitMin(circuit, circuit.affine([[ammo.shells, 1]], info.shells), circuit.constant(50)), 1], [ammo.shells, -1]], 0, [[taken, 1]], 0), 1]])
      shotgun = emitMax(circuit, shotgun, taken)
    }
    pickedUp.push(taken)
    const sectorNow = circuit.indexRead(monster.cell, sectorOfCell)
    return {
      present: circuit.affine([[and(circuit, drop.present, not(circuit, taken)), 1], [result.dies, 1]]),
      x: choose(circuit, result.dies, drop.x, monster.x),
      y: choose(circuit, result.dies, drop.y, monster.y),
      z: choose(circuit, result.dies, drop.z, circuit.indexRead(sectorNow, sectors.floor)),
      sector: choose(circuit, result.dies, drop.sector, sectorNow),
    }
  })

  // The player's damage: attacks, blasts, and damaging floors every 32 tics while alive, since P_DeathThink skips
  // P_PlayerInSpecialSector. Green armor takes a third.
  const floorDamage = consts(map.sectors.map(sector => sector.special === 7 ? 5 : sector.special === 5 ? 10 : sector.special === 16 || sector.special === 4 ? 20 : 0))
  const onFloor = not(circuit, bitOf(circuit, [[z, 1], [floorZ, -1]], -0.5))
  const clockTick = emitCompare(circuit, cells.clock, '===', circuit.constant(0))
  const damage = circuit.affine([
    ...monsterResults.map(result => [result.damage, 1] as const),
    [blastsOn(x, y, playerRadius), 1],
    [circuit.reglu([[circuit.indexRead(playerSector, floorDamage), 1]], 0, [[and(circuit, clockTick, onFloor, alive), 1]], 0), 1],
  ])
  const absorbed = emitMin(circuit, armor, emitFloorish(circuit, [[damage, 1 / 3]]))
  const healthAfter = emitReluSum(circuit, [[health, 1], [damage, -1], [absorbed, 1]])
  const armorAfter = circuit.affine([[armor, 1], [absorbed, -1]])
  const damageCount = emitMin(circuit, circuit.affine([[emitReluSum(circuit, [[player.damageCount, 1]], -1), 1], [damage, 1]]), circuit.constant(100))
  // Doom's BONUSADD: 6 more per item taken, a tic less every tic.
  const bonusCount = emitMin(circuit, circuit.affine([[emitReluSum(circuit, [[player.bonusCount, 1]], -1), 1], ...pickedUp.map(taken => [taken, 6] as const)]), circuit.constant(100))
  // ST_doPaletteStuff: a red palette 2..8 while damagecount lasts, else a gold one 10..12 while bonuscount does.
  const redPalette = circuit.indexRead(damageCount, consts(Array.from({length: 101}, (_, count) => count === 0 ? 0 : Math.min(7, (count + 7) >> 3) + 1)))
  const goldPalette = circuit.indexRead(bonusCount, consts(Array.from({length: 101}, (_, count) => count === 0 ? 0 : Math.min(3, (count + 7) >> 3) + 9)))
  const palette = circuit.affine([[redPalette, 1], [circuit.reglu([[goldPalette, 1]], 0, [[damageCount, -1]], 1), 1]])
  // Lights: Doom's T_LightFlash, T_Glow and T_StrobeFlash.
  const lightings = lightingSectors(level)
  const sectorLight: Wire[] = map.sectors.map(sector => circuit.constant(sector.light))
  const lightNext = lightings.map((lighting, index) => {
    const cell = cells.lights[index]!
    const done = emitCompare(circuit, cell.count, '<=', circuit.constant(1))
    const countDown = emitReluSum(circuit, [[cell.count, 1]], -1)
    let level: Wire
    let count: Wire
    let rising: Wire = cell.rising
    if (lighting.kind === 'glow') {
      const lowered = circuit.affine([[cell.level, 1]], -8)
      const raised = circuit.affine([[cell.level, 1]], 8)
      const bottoms = and(circuit, not(circuit, cell.rising), not(circuit, bitOf(circuit, [[lowered, 1]], -lighting.min - 0.5)))
      const tops = and(circuit, cell.rising, bitOf(circuit, [[raised, 1]], -lighting.max + 0.5))
      level = choose(circuit, cell.rising, choose(circuit, bottoms, lowered, cell.level), choose(circuit, tops, raised, cell.level))
      rising = circuit.affine([[cell.rising, 1], [bottoms, 1], [tops, -1]])
      count = cell.count
    } else {
      const atBright = emitCompare(circuit, cell.level, '===', circuit.constant(lighting.max))
      const bright = circuit.constant(lighting.max)
      const dim = circuit.constant(lighting.min)
      level = choose(circuit, done, cell.level, choose(circuit, atBright, bright, dim))
      // T_LightFlash's maxtime of 64 and mintime of 7: bright for 1 or 65 tics, dark for 1 to 8.
      const longWait = lighting.kind === 'flicker' ? random.next(byte => (byte & 64) + 1) : circuit.constant(5)
      const shortWait = lighting.kind === 'flicker' ? random.next(byte => (byte & 7) + 1) : circuit.constant(lighting.dark)
      count = choose(circuit, done, countDown, choose(circuit, atBright, longWait, shortWait))
    }
    sectorLight[lighting.sector] = level
    return {level, count, rising}
  })
  // Doom's extralight from the weapon's flash brightens every sector by 16 light levels per step.
  const light = sectorLight.map(level => emitMin(circuit, circuit.affine([[level, 1], [weapon.light, 16]]), circuit.constant(255)))

  // Next state. Using after death or after the exit starts the level over: every cell back to its initial value.
  const restart = and(circuit, usePressed, or(circuit, not(circuit, alive), player.exited))
  const initial = initialValues(spec)
  const fresh = <T>(stored: T, next: T): T => mapPairs(stored, next, (wire, nextWire) => {
    const start = initial[wire]!
    return circuit.affine([[nextWire, 1], [circuit.reglu([[nextWire, -1]], start, [[restart, 1]], 0), 1]])
  })
  const thingNext = things.map((thing, index) => {
    const monster = monsterThings.indexOf(thing)
    if (monster >= 0) return monsterResults[monster]!.thingNext
    const barrel = barrelThings.indexOf(thing)
    if (barrel >= 0) return barrelResults[barrel]!.thingNext
    return {...thingStates[index]!, present: presence[index]!}
  })
  table.next(cells.things, fresh(cells.things, thingNext))
  const exitTriggers = triggers.flatMap((trigger, index) => trigger.exit ? [triggered[index]!] : [])
  // A dead player's view sinks a unit per tic to 6 above the floor, as P_DeathThink lowers it.
  const deadView = emitMax(circuit, circuit.affine([[player.viewHeight, 1]], -1), circuit.constant(6))
  table.next(player, fresh(player, {
    x,
    y,
    z,
    momX,
    momY,
    momZ,
    angle,
    cell,
    floorZ,
    viewHeight: choose(circuit, alive, deadView, nextView),
    deltaViewHeight: nextDelta,
    bobPhase,
    usedLastTic: keys.use,
    keys: keysHeld,
    health: healthAfter,
    armor: armorAfter,
    bullets: circuit.affine([[ammo.bullets, 1], [weapon.firesPistol, -1]]),
    shells: circuit.affine([[ammo.shells, 1], [weapon.firesShotgun, -1]]),
    rockets: ammo.rockets,
    energy: ammo.cells,
    shotgun,
    chainsaw,
    exited: circuit.affine([[player.exited, 1], ...exitTriggers.map(wire => [wire, 1] as const)]),
    damageCount,
    bonusCount,
    weapon: weapon.next,
  }))
  table.next(sectors, fresh(sectors, {floor: nextFloor, ceiling: nextCeiling}))
  table.next(cells.movers, fresh(cells.movers, moverStates))
  table.next(cells.fired, fresh(cells.fired, triggers.map((trigger, index) => trigger.once ? circuit.affine([[cells.fired[index]!, 1], [triggered[index]!, 1]]) : cells.fired[index]!)))
  // The random table's index moves past this tic's draws, by an odd step so that it visits all 1024 entries before
  // it repeats.
  table.next(cells.random, circuit.indexReadAffine([[cells.random, 1]], (random.draws * 7 % 1024) | 1, consts(Array.from({length: 2048}, (_, index) => index % 1024)), 'clamp', 'clamp'))
  table.next(cells.clock, circuit.indexReadAffine([[cells.clock, 1]], 1, consts(Array.from({length: 33}, (_, index) => index % 32)), 'clamp', 'clamp'))
  const time = circuit.indexReadAffine([[cells.time, 1]], 1, consts(Array.from({length: 769}, (_, index) => index % 768)), 'clamp', 'clamp')
  table.next(cells.time, time)
  table.next(cells.lights, fresh(cells.lights, lightNext))
  table.next(cells.monsters, fresh(cells.monsters, monsterResults.map(result => result.next)))
  table.next(cells.barrels, fresh(cells.barrels, barrelResults.map(result => ({health: result.health}))))
  table.next(cells.projectiles, fresh(cells.projectiles, monsterResults.flatMap(result => result.projectileNext === null ? [] : [result.projectileNext])))
  table.next(cells.drops, fresh(cells.drops, dropNext))

  // The frame program's input: what the eye sees this tic, in frameInputSpec's order.
  const stateOf = (index: number) => thingNext[index]!.state
  const view = {
    cell,
    angle,
    x,
    y,
    z: choose(circuit, alive, circuit.affine([[z, 1], [deadView, 1]]), eye),
    floor: nextFloor,
    ceiling: nextCeiling,
    light,
    things: [
      ...things.map((thing, index) => {
        const monster = monsterThings.indexOf(thing)
        if (monster >= 0) {
          const next = monsterResults[monster]!.next
          const sector = circuit.indexRead(next.cell, sectorOfCell)
          return {
            x: next.x, y: next.y, z: circuit.indexRead(sector, nextFloor), sector,
            frame: circuit.indexRead(stateOf(index), stateFrame), bright: circuit.indexRead(stateOf(index), stateBright),
            direction: next.direction, visible: circuit.constant(1),
          }
        }
        const sector = sectorAt(level, thing.x, thing.y)
        return {
          x: circuit.constant(thing.x),
          y: circuit.constant(thing.y),
          z: thing.info.ceiling ? circuit.affine([[nextCeiling[sector]!, 1]], -thing.info.height) : nextFloor[sector]!,
          sector: circuit.constant(sector),
          frame: circuit.indexRead(stateOf(index), stateFrame),
          bright: circuit.indexRead(stateOf(index), stateBright),
          direction: circuit.constant(thing.direction),
          visible: thingNext[index]!.present,
        }
      }),
      ...monsterResults.flatMap(result => {
        const ball = result.projectileNext
        if (ball === null) return []
        return [{
          x: ball.x, y: ball.y, z: ball.z, sector: circuit.indexRead(ball.cell, sectorOfCell),
          frame: circuit.indexRead(ball.state, stateFrame), bright: circuit.indexRead(ball.state, stateBright),
          direction: circuit.constant(0),
          visible: not(circuit, emitCompare(circuit, ball.state, '===', circuit.constant(states.state('NULL')))),
        }]
      }),
      ...droppers.map((thing, index) => ({
        x: dropNext[index]!.x, y: dropNext[index]!.y, z: dropNext[index]!.z, sector: dropNext[index]!.sector,
        frame: circuit.constant(states.frame[states.state(dropOf(thing)!.state)]!), bright: circuit.constant(0),
        direction: circuit.constant(0), visible: dropNext[index]!.present,
      })),
    ],
    weapon: {state: weapon.next.state, flash: weapon.next.flash, x: weapon.sprite.x, y: weapon.sprite.y},
    time,
  }
  // The status bar's input, in statusSpec's order, after this tic.
  const bullets = circuit.affine([[ammo.bullets, 1], [weapon.firesPistol, -1]])
  const shells = circuit.affine([[ammo.shells, 1], [weapon.firesShotgun, -1]])
  const status = {
    health: healthAfter,
    armor: armorAfter,
    ammo: circuit.indexRead(weapon.next.weapon, [circuit.constant(1994), bullets, shells]),
    bullets,
    shells,
    rockets: ammo.rockets,
    cells: ammo.cells,
    shotgun,
    keys: keysHeld,
    alive: bitOf(circuit, [[healthAfter, 1]], -0.5),
  }
  return {cells, output: {view, exited: player.exited, status, palette}, movers, triggers, things, states, ...table.finish()}
}

// Every cell's initial value, by its position, from a spec in declaration order.
function initialValues(spec: unknown): number[] {
  const values: number[] = []
  const visit = (node: unknown) => {
    if (Array.isArray(node)) for (const element of node) visit(element)
    else if ((node as {kind?: string}).kind === 'cell') values.push((node as {initial: number}).initial)
    else for (const value of Object.values(node as Record<string, unknown>)) visit(value)
  }
  visit(spec)
  return values
}

// The same shape as `stored`, with each leaf from `make(stored leaf, next leaf)`.
function mapPairs<T>(stored: T, next: T, make: (stored: Wire, next: Wire) => Wire): T {
  if (typeof stored === 'number') return make(stored as unknown as Wire, next as unknown as Wire) as unknown as T
  if (Array.isArray(stored)) return (stored as unknown[]).map((element, index): unknown => mapPairs(element, (next as unknown[])[index], make)) as T
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(stored as object)) result[key] = mapPairs((stored as Record<string, unknown>)[key], (next as Record<string, unknown>)[key], make)
  return result as T
}

function sectorBounds(map: DoomMap, sector: number) {
  let left = Infinity
  let right = -Infinity
  let bottom = Infinity
  let top = -Infinity
  for (const linedef of map.linedefs) {
    const sides = [linedef.front, linedef.back].filter(side => side >= 0).map(side => map.sidedefs[side]!.sector)
    if (!sides.includes(sector)) continue
    for (const vertex of [map.vertices[linedef.v1]!, map.vertices[linedef.v2]!]) {
      left = Math.min(left, vertex.x)
      right = Math.max(right, vertex.x)
      bottom = Math.min(bottom, vertex.y)
      top = Math.max(top, vertex.y)
    }
  }
  return {left, right, bottom, top}
}

// The sector containing a point.
function sectorAt(level: Level, x: number, y: number) {
  return Math.max(0, mapSectorAt(level.map, x, y))
}
