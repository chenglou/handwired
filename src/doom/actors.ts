// The things that act, as builder code for the game program: the player's weapon and its shots, the monsters'
// thinking (Doom's A_Look, A_Chase, A_FaceTarget and their attacks), the imps' fireballs, and the barrels. Every
// monster thinks at every tic, as the same operations: what Doom decides with branches is computed for every case
// and selected, and what it loops over (lines a move touches, things a shot can hit) is a fixed list.
//
// Simplifications against Doom, each noted where it is made: a monster tries one direction per A_Chase and the next
// candidate at its next A_Chase, rather than up to nine in one call; hitscans ignore heights; explosions see through
// walls; sound reaches every sector connected by open lines, whatever the doors' state.
import {inputBit, state, stateBit} from '../runtime/cells.ts'
import {type Circuit, type Terms, type Wire, emitArgmax, emitCompare} from '../runtime/numeric-ui-core.ts'
import {type Level, cellContaining} from './level.ts'
import {constantTable, emitAbs, emitClampZeroTo, emitMax, emitMin, emitPositiveBit, emitReluSum} from './ops.ts'
import {type BspTables, type LineTables, type Mover, type SolidTables, emitCheckPosition, emitLocate} from './physics.ts'
import {type RayTables, emitBefore, emitRay, emitReaches} from './raycast.ts'
import {type LevelThing, type StateTables} from './things.ts'
import {ML_SOUNDBLOCK, ML_TWOSIDED} from './wad.ts'

export const weaponKeys = () => ({fire: inputBit(), fist: inputBit(), pistol: inputBit(), shotgun: inputBit()})

export function monsterSpec(level: Level, thing: LevelThing) {
  const cell = cellContaining(level, thing.x, thing.y)
  return {
    x: state([-(2 ** 14), 2 ** 14], {initial: thing.x}),
    y: state([-(2 ** 14), 2 ** 14], {initial: thing.y}),
    cell: state([0, level.cells.length - 1], {grid: 1, initial: cell}),
    direction: state([0, 7], {grid: 1, initial: thing.direction}),
    health: state([-1024, 1024], {grid: 1, initial: thing.info.health ?? 0}),
    moveCount: state([0, 15], {grid: 1}),
    reaction: state([0, 8], {grid: 1, initial: 8}),
    justAttacked: stateBit(),
    attempt: state([0, 4], {grid: 1}),
    solid: stateBit(1),
    // Whether a noise has reached its sector, Doom's soundtarget, which stays until the level starts over. A monster
    // only stands in one sector while it looks, so a bit of its own is its sector's.
    heard: stateBit(),
  }
}

export function barrelSpec(thing: LevelThing) {
  return {health: state([-1024, 1024], {grid: 1, initial: thing.info.health ?? 20})}
}

export const projectileSpec = (level: Level, states: StateTables) => ({
  x: state([-(2 ** 14), 2 ** 14]),
  y: state([-(2 ** 14), 2 ** 14]),
  z: state([-4096, 4096]),
  cell: state([0, level.cells.length - 1], {grid: 1}),
  momX: state([-16, 16]),
  momY: state([-16, 16]),
  state: state([0, states.count - 1], {grid: 1, initial: states.state('NULL')}),
  tics: state([-1, 255], {grid: 1, initial: -1}),
})

export const weaponSpec = (states: StateTables) => ({
  weapon: state([0, 2], {grid: 1, initial: 1}),
  pending: state([0, 2], {grid: 1, initial: 1}),
  state: state([0, states.count - 1], {grid: 1, initial: states.state('PISTOL')}),
  tics: state([-1, 255], {grid: 1, initial: 1}),
  flash: state([0, states.count - 1], {grid: 1, initial: states.state('NULL')}),
  flashTics: state([-1, 255], {grid: 1, initial: -1}),
  y: state([0, 128], {initial: 32}),
  refire: state([0, 255], {grid: 1}),
  phase: state([0, 8191], {grid: 1}),
})

type Pair = readonly [Wire, number]
export const bitOf = (circuit: Circuit, terms: Terms, bias = 0) => emitPositiveBit(circuit, terms, bias, 1024)
export const and = (circuit: Circuit, ...bits: Wire[]) => emitReluSum(circuit, bits.map(wire => [wire, 1] as const), 1 - bits.length)
export const or = (circuit: Circuit, ...bits: Wire[]) => emitPositiveBit(circuit, bits.map(wire => [wire, 1] as const), -0.5)
export const not = (circuit: Circuit, wire: Wire) => circuit.affine([[wire, -1]], 1)
// terms + bias when the exact bit is 1, else 0.
export const gate = (circuit: Circuit, value: Terms, bit: Wire, bias = 0) => circuit.reglu(value, bias, [[bit, 1]], 0)
// on when the exact bit is 1, else off: one index read, which copies either exactly.
export const choose = (circuit: Circuit, bit: Wire, off: Wire, on: Wire) => circuit.indexRead(bit, [off, on])
// [value === constant] for a whole-number wire with a declared range.
const equals = (circuit: Circuit, value: Wire, constant: number) => {
  circuit.assumeGrid(value, 1, {allowExistingReaders: true})
  return emitCompare(circuit, value, '===', circuit.constant(constant))
}

// Random bytes: one table, read at the tic's random index plus a number each draw gets while building. The index
// moves on by the number of draws every tic. Not Doom's table: no demo compatibility is attempted.
export function randomSource(circuit: Circuit, index: Wire) {
  let seed = 0x2545f491
  const bytes = Array.from({length: 1024}, () => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return (seed >>> 0) % 256
  })
  const table = constantTable(circuit, [...bytes, ...bytes])
  let draws = 0
  return {
    // A random whole number in 0..255, or a value from a table indexed by it.
    next(values?: (byte: number) => number) {
      const at = (draws++ * 7) % 1024
      if (values === undefined) return circuit.indexReadAffine([[index, 1]], at, table, 'clamp', 'clamp')
      return circuit.indexReadAffine([[index, 1]], at, constantTable(circuit, [...bytes, ...bytes].map(values)), 'clamp', 'clamp')
    },
    get draws() {
      return draws
    },
  }
}

// The octant of (dx, dy) to the nearest 45°: 0 east, 2 north, 4 west, 6 south. The vector is turned by 22.5°, and
// then the signs of its components and which is larger give the octant.
const octantOfBits = [5, 4, 2, 3, 6, 7, 1, 0]
function emitDirection(circuit: Circuit, dx: Wire, dy: Wire) {
  const c = Math.cos(Math.PI / 8)
  const s = Math.sin(Math.PI / 8)
  const u = circuit.affine([[dx, c], [dy, -s]])
  const v = circuit.affine([[dx, s], [dy, c]])
  return circuit.indexReadAffine([
    [bitOf(circuit, [[u, 1]]), 4],
    [bitOf(circuit, [[v, 1]]), 2],
    [bitOf(circuit, [[emitAbs(circuit, u), 1], [emitAbs(circuit, v), -1]]), 1],
  ], 0, constantTable(circuit, octantOfBits), 'clamp', 'clamp')
}

// Doom's P_AproxDistance: |dx| + |dy| - min(|dx|, |dy|) / 2.
function emitDistance(circuit: Circuit, dx: Wire, dy: Wire) {
  const ax = emitAbs(circuit, dx)
  const ay = emitAbs(circuit, dy)
  return circuit.affine([[ax, 1], [ay, 1], [emitMin(circuit, ax, ay), -0.5]])
}

// Sound: which sectors hear a noise made in which.
// Doom's P_RecursiveSound: a noise floods through two-sided lines, through at most one sound-blocking line. Doors are
// taken as open.
export function hearingTable(level: Level) {
  const {map} = level
  const count = map.sectors.length
  const links: {to: number, block: boolean}[][] = Array.from({length: count}, () => [])
  for (const linedef of map.linedefs) {
    if ((linedef.flags & ML_TWOSIDED) === 0 || linedef.back < 0) continue
    const front = map.sidedefs[linedef.front]!.sector
    const back = map.sidedefs[linedef.back]!.sector
    const block = (linedef.flags & ML_SOUNDBLOCK) !== 0
    links[front]!.push({to: back, block})
    links[back]!.push({to: front, block})
  }
  const hears = new Uint8Array(count * count)
  for (let source = 0; source < count; source++) {
    // Breadth first over (sector, sound blocks passed), keeping the fewest blocks per sector.
    const blocks = new Int8Array(count).fill(9)
    const queue: [number, number][] = [[source, 0]]
    blocks[source] = 0
    while (queue.length > 0) {
      const [sector, passed] = queue.shift()!
      for (const link of links[sector]!) {
        const next = passed + (link.block ? 1 : 0)
        if (next > 1 || next >= blocks[link.to]!) continue
        blocks[link.to] = next
        queue.push([link.to, next])
      }
    }
    for (let sector = 0; sector < count; sector++) hears[source * count + sector] = blocks[sector]! <= 1 ? 1 : 0
  }
  return hears
}

// The actors, once per tic.
type MonsterCells = {
  x: Wire, y: Wire, cell: Wire, direction: Wire, health: Wire, moveCount: Wire, reaction: Wire, justAttacked: Wire, attempt: Wire, solid: Wire
  heard: Wire
}
type ThingCells = {state: Wire, tics: Wire, present: Wire}
type ProjectileCells = {x: Wire, y: Wire, z: Wire, cell: Wire, momX: Wire, momY: Wire, state: Wire, tics: Wire}
type WeaponCells = {weapon: Wire, pending: Wire, state: Wire, tics: Wire, flash: Wire, flashTics: Wire, y: Wire, refire: Wire, phase: Wire}

export type ActorWorld = {
  circuit: Circuit
  states: StateTables
  bsp: BspTables
  lines: LineTables
  rays: RayTables
  solids: SolidTables
  sectorOfCell: Wire[]
  floor: readonly Wire[]
  ceiling: readonly Wire[]
  random: ReturnType<typeof randomSource>
  hearing: Wire[]
}

export type PlayerView = {
  x: Wire, y: Wire, cell: Wire, sector: Wire, cos: Wire, sin: Wire
  alive: Wire, bullets: Wire, shells: Wire, hasShotgun: Wire, moveBob: Wire
}

const weaponStates = [
  {ready: 'PUNCH', down: 'PUNCHDOWN', up: 'PUNCHUP', attack: 'PUNCH1'},
  {ready: 'PISTOL', down: 'PISTOLDOWN', up: 'PISTOLUP', attack: 'PISTOL1'},
  {ready: 'SGUN', down: 'SGUNDOWN', up: 'SGUNUP', attack: 'SGUN1'},
]

// A state table of 0/1 per state: whether its action is `action`.
function actionTable(world: ActorWorld, action: string) {
  const id = world.states.actions.indexOf(action)
  return constantTable(world.circuit, world.states.action.map(value => value === id ? 1 : 0))
}

// Doom's state machine step: the tics count down, and at 1 the next state starts. Returns the state the countdown
// reaches and whether it started this tic.
function emitAdvance(world: ActorWorld, cells: {state: Wire, tics: Wire}) {
  const {circuit, states} = world
  const started = equals(circuit, cells.tics, 1)
  const next = circuit.indexRead(cells.state, constantTable(circuit, states.next))
  return {started, state: choose(circuit, started, cells.state, next)}
}

// The tics of the state that holds after a tic: a fresh state's own tics, else one less while counting.
function emitTics(world: ActorWorld, cells: {state: Wire, tics: Wire}, state: Wire, fresh: Wire) {
  const {circuit, states} = world
  const counting = emitCompare(circuit, cells.tics, '>', circuit.constant(0))
  const own = circuit.indexRead(state, constantTable(circuit, states.tics))
  return choose(circuit, fresh, circuit.affine([[cells.tics, 1], [counting, -1]]), own)
}

// A state chosen among the stored one, its next state from the table and named ones is a whole number within the
// table, as each of them is.
function stateIndex(world: ActorWorld, wire: Wire) {
  world.circuit.assumeRange(wire, 0, world.states.count - 1, {allowExistingReaders: true})
  world.circuit.assumeGrid(wire, 1, {allowExistingReaders: true})
  return wire
}

// The player's weapon: Doom's psprites.
export function emitWeapon(world: ActorWorld, cells: WeaponCells, keys: {fire: Wire, fist: Wire, pistol: Wire, shotgun: Wire}, player: PlayerView) {
  const {circuit, states} = world
  const consts = (values: number[]) => constantTable(circuit, values)
  // The weapon asked for: a number key, or the best one with ammo when the current one has none.
  const owned = [circuit.constant(1), circuit.constant(1), player.hasShotgun]
  const hasAmmo = [circuit.constant(1), bitOf(circuit, [[player.bullets, 1]], -0.5), bitOf(circuit, [[player.shells, 1]], -0.5)]
  const ammoOfCurrent = circuit.indexRead(cells.weapon, hasAmmo)
  const best = circuit.affine([[hasAmmo[1]!, 1], [and(circuit, hasAmmo[2]!, owned[2]!), 2], [and(circuit, hasAmmo[1]!, hasAmmo[2]!, owned[2]!), -1]])
  let pending: Wire = cells.pending
  pending = choose(circuit, and(circuit, keys.fire, not(circuit, ammoOfCurrent)), pending, best)
  pending = choose(circuit, keys.fist, pending, circuit.constant(0))
  pending = choose(circuit, keys.pistol, pending, circuit.constant(1))
  pending = choose(circuit, and(circuit, keys.shotgun, owned[2]!), pending, circuit.constant(2))
  // Every candidate is a weapon, 0, 1 or 2: the stored one, the keys' constants, and best, which is 2 with the shotgun
  // and its shells, and otherwise whether there are bullets.
  circuit.assumeRange(pending, 0, 2, {allowExistingReaders: true})
  circuit.assumeGrid(pending, 1, {allowExistingReaders: true})

  const advance = emitAdvance(world, cells)
  const acts = (action: string) => and(circuit, advance.started, circuit.indexRead(advance.state, actionTable(world, action)))
  const ready = acts('WeaponReady')
  const lower = acts('Lower')
  const raise = acts('Raise')
  const refire = acts('ReFire')
  const firesPistol = acts('FirePistol')
  const firesShotgun = acts('FireShotgun')
  const punches = acts('Punch')
  const stateOf = (field: 'ready' | 'down' | 'up' | 'attack', weapon: Wire) => circuit.indexRead(weapon, consts(weaponStates.map(entry => states.state(entry[field]))))
  // A_WeaponReady: lower to change weapons or when dead, else fire when the trigger is held and there is ammo.
  const changes = or(circuit, not(circuit, equalsWire(circuit, pending, cells.weapon)), not(circuit, player.alive))
  const readyLowers = and(circuit, ready, changes)
  const readyFires = and(circuit, ready, not(circuit, changes), keys.fire, ammoOfCurrent)
  // A_ReFire: fire again while the trigger is held.
  const refires = and(circuit, refire, keys.fire, player.alive, ammoOfCurrent)
  // A_Lower and A_Raise move the weapon 6 units per tic between 32 and 128.
  const lowered = circuit.affine([[cells.y, 1]], 6)
  const raised = circuit.affine([[cells.y, 1]], -6)
  // A dead player's weapon stays down, as A_Lower leaves it, instead of coming back up.
  const lowerDone = and(circuit, lower, player.alive, bitOf(circuit, [[lowered, 1]], -127.5))
  const raiseDone = and(circuit, raise, bitOf(circuit, [[raised, -1]], 32.5))
  const weapon = choose(circuit, lowerDone, cells.weapon, pending)
  let next: Wire = advance.state
  next = choose(circuit, readyLowers, next, stateOf('down', cells.weapon))
  next = choose(circuit, or(circuit, readyFires, refires), next, stateOf('attack', cells.weapon))
  next = choose(circuit, lowerDone, next, stateOf('up', pending))
  next = choose(circuit, raiseDone, next, stateOf('ready', cells.weapon))
  const forced = or(circuit, readyLowers, readyFires, refires, lowerDone, raiseDone)
  let y: Wire = cells.y
  y = choose(circuit, lower, y, emitMin(circuit, lowered, circuit.constant(128)))
  y = choose(circuit, raise, y, emitMax(circuit, raised, circuit.constant(32)))
  // The stored y is within 0..128, lowering stops at 128, and raising stops at 32.
  circuit.assumeRange(y, 0, 128, {allowExistingReaders: true})
  // The flash: fire starts it, then it runs its own states; S_LIGHTDONE, a 0-tic state, counts as no flash.
  const flashAdvance = emitAdvance(world, {state: cells.flash, tics: cells.flashTics})
  const lightDone = states.state('LIGHTDONE')
  const nullState = states.state('NULL')
  let flash = choose(circuit, equals(circuit, flashAdvance.state, lightDone), flashAdvance.state, circuit.constant(nullState))
  const flashFresh = or(circuit, firesPistol, firesShotgun, flashAdvance.started)
  flash = choose(circuit, firesPistol, flash, circuit.constant(states.state('PISTOLFLASH')))
  flash = stateIndex(world, choose(circuit, firesShotgun, flash, circuit.constant(states.state('SGUNFLASH1'))))
  const flashTics = emitTics(world, {state: cells.flash, tics: cells.flashTics}, flash, flashFresh)
  // Doom's extralight: 1 or 2 while the flash shows.
  const light = circuit.indexRead(flash, consts(states.names.map(name => name === 'PISTOLFLASH' || name === 'SGUNFLASH1' ? 1 : name === 'SGUNFLASH2' ? 2 : 0)))
  const nextRefire = choose(circuit, refire, cells.refire, choose(circuit, refires, circuit.constant(0), emitMin(circuit, circuit.affine([[cells.refire, 1]], 1), circuit.constant(255))))
  // The weapon's bob while ready: sx = 1 + bob × cos(128 × tic), sy = 32 + bob × sin(128 × tic mod 180°).
  const phase = circuit.affine([[cells.phase, 1]], 128)
  // The stored phase and 128 are whole numbers.
  circuit.assumeGrid(phase, 1, {allowExistingReaders: true})
  const wrapped = circuit.affine([[phase, 1], [emitCompare(circuit, phase, '>=', circuit.constant(8192)), -8192]])
  // The stored phase, 0..8191, gains 128 and loses 8192 once it reaches 8192.
  circuit.assumeRange(wrapped, 0, 8191, {allowExistingReaders: true})
  const angles = Array.from({length: 8192}, (_, angle) => angle * 2 * Math.PI / 8192)
  const bobbing = and(circuit, ready, not(circuit, changes))
  const sx = circuit.affine([[gate(circuit, [[circuit.multiply(player.moveBob, circuit.indexRead(wrapped, consts(angles.map(Math.cos)))), 1]], bobbing), 1]], 1)
  const sy = circuit.affine([[y, 1], [gate(circuit, [[circuit.multiply(player.moveBob, circuit.indexRead(wrapped, consts(angles.map(angle => Math.abs(Math.sin(angle)))))), 1]], bobbing), 1]])
  return {
    next: {
      weapon,
      pending,
      state: next,
      tics: emitTics(world, cells, next, or(circuit, forced, advance.started)),
      flash,
      flashTics,
      y,
      refire: nextRefire,
      phase: wrapped,
    },
    firesPistol,
    firesShotgun,
    punches,
    accurate: equals(circuit, cells.refire, 0),
    noise: or(circuit, firesPistol, firesShotgun),
    light,
    sprite: {x: sx, y: sy},
  }
}

function equalsWire(circuit: Circuit, a: Wire, b: Wire) {
  const difference = circuit.affine([[a, 1], [b, -1]])
  // Its one use compares the weapon asked for with the one held, both whole numbers, so their difference is one too.
  circuit.assumeGrid(difference, 1, {allowExistingReaders: true})
  return emitCompare(circuit, difference, '===', circuit.constant(0))
}

export type Target = {x: Wire, y: Wire, radius: number, shootable: Wire}

// Pistol, shotgun and fist against every target: per pellet, the nearest target whose radius the pellet passes within,
// before the first wall along the view. Returns each target's damage.
export function emitShots(world: ActorWorld, player: PlayerView, weapon: ReturnType<typeof emitWeapon>, targets: Target[]): Wire[] {
  const {circuit, rays, random} = world
  const wall = emitRay(circuit, rays, {x: player.x, y: player.y, dx: player.cos, dy: player.sin, cell: player.cell, steps: 32})
  const relative = targets.map(target => {
    const relX = circuit.affine([[target.x, 1], [player.x, -1]])
    const relY = circuit.affine([[target.y, 1], [player.y, -1]])
    const along = circuit.affine([[circuit.multiply(relX, player.cos), 1], [circuit.multiply(relY, player.sin), 1]])
    const across = circuit.affine([[circuit.multiply(relY, player.cos), 1], [circuit.multiply(relX, player.sin), -1]])
    // It is at most the distance between the player and the target, both inside the level, and no E1 map's diagonal
    // reaches 2^14 units.
    circuit.assumeRange(along, -(2 ** 15), 2 ** 15, {allowExistingReaders: true})
    const usable = and(circuit, target.shootable, bitOf(circuit, [[along, 1]]), emitBefore(circuit, wall, along))
    return {along, across, usable}
  })
  // Doom's spread, (P_Random() - P_Random()) << 18 of a turn, as the tangent of a triangular draw.
  const spread = (byte: number) => {
    const u = byte / 255
    const triangle = u < 0.5 ? Math.sqrt(2 * u) - 1 : 1 - Math.sqrt(2 * (1 - u))
    return Math.tan(triangle * 255 * 2 ** 18 * 2 * Math.PI / 2 ** 32)
  }
  const damages = targets.map(() => [] as Pair[])
  const unit = circuit.constant(1)
  for (let pellet = 0; pellet < 7; pellet++) {
    const tangent = random.next(spread)
    let fires: Wire
    let effective: Wire = tangent
    let amount: Wire = random.next(byte => 5 * (byte % 3 + 1))
    if (pellet === 0) {
      fires = or(circuit, weapon.firesPistol, weapon.firesShotgun, weapon.punches)
      // The pistol's first shot and the fist are accurate.
      const straight = or(circuit, and(circuit, weapon.firesPistol, weapon.accurate), weapon.punches)
      effective = choose(circuit, straight, tangent, circuit.constant(0))
      amount = choose(circuit, weapon.punches, amount, random.next(byte => 2 * (byte % 10 + 1)))
    } else {
      fires = weapon.firesShotgun
    }
    const scores = relative.map(({along, across, usable}, index) => {
      const offset = circuit.affine([[across, 1], [circuit.multiply(along, effective), -1]])
      const radius = targets[index]!.radius
      let hit = and(circuit, usable, bitOf(circuit, [[emitAbs(circuit, offset), -1]], radius))
      // The fist reaches 64 units.
      if (pellet === 0) hit = and(circuit, hit, or(circuit, not(circuit, weapon.punches), bitOf(circuit, [[along, -1]], 64 + radius)))
      const score = gate(circuit, [[along, -1 / 2 ** 16]], hit, 0.5)
      // With along within ±2^15, a hit scores 0.5 - along / 2^16, within 0..1, and a miss 0.
      circuit.assumeRange(score, 0, 1, {allowExistingReaders: true})
      return {score, hit}
    })
    const {selected} = emitArgmax(circuit, scores.map(entry => entry.score), unit)
    selected.forEach((chosen, index) => {
      const lands = and(circuit, chosen, scores[index]!.hit, fires)
      damages[index]!.push([gate(circuit, [[amount, 1]], lands), 1])
    })
  }
  return damages.map(terms => circuit.affine(terms))
}

type MonsterInfo = {
  thing: LevelThing
  cells: MonsterCells
  thingCells: ThingCells
  projectile: ProjectileCells | null
}

export type MonsterResult = {
  next: Record<keyof MonsterCells, Wire>
  thingNext: Record<keyof ThingCells, Wire>
  projectileNext: Record<keyof ProjectileCells, Wire> | null
  // Damage the monster and its fireball deal the player this tic.
  damage: Wire
  // Whether it died this tic, which drops its item.
  dies: Wire
}

export function emitMonster(
  world: ActorWorld,
  monster: MonsterInfo,
  player: PlayerView,
  others: Mover[],
  damageTaken: Wire,
  noise: Wire,
): MonsterResult {
  const {circuit, states, random} = world
  const consts = (values: number[]) => constantTable(circuit, values)
  const {thing, cells} = monster
  const info = thing.info
  const sectorCount = world.floor.length
  const alive = bitOf(circuit, [[cells.health, 1]], -0.5)
  const dx = circuit.affine([[player.x, 1], [cells.x, -1]])
  const dy = circuit.affine([[player.y, 1], [cells.y, -1]])
  const distance = emitDistance(circuit, dx, dy)
  // A dead player is no target, as Doom's P_LookForPlayers skips it: no sight of it, and so no attack on it.
  const sight = and(circuit, player.alive, emitReaches(circuit, emitRay(circuit, world.rays, {x: cells.x, y: cells.y, dx, dy, cell: cells.cell, steps: 24})))
  const toward = emitDirection(circuit, dx, dy)
  // In front: the player's direction within 90° of the monster's facing.
  const facingDelta = circuit.indexReadAffine([[toward, 1], [cells.direction, -1]], 8, consts([1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1]), 'clamp', 'clamp')
  const sector = circuit.indexRead(cells.cell, world.sectorOfCell)

  // Damage: Doom's P_DamageMobj, death before pain before waking.
  const health = circuit.affine([[cells.health, 1], [damageTaken, -1]])
  const dies = and(circuit, alive, bitOf(circuit, [[health, -1]], 0.5))
  const extreme = info.extremeDeath === undefined ? circuit.constant(0) : and(circuit, dies, bitOf(circuit, [[health, -1]], -(info.health ?? 0) - 0.5))
  const hurt = and(circuit, alive, not(circuit, dies), bitOf(circuit, [[damageTaken, 1]], -0.5))
  const pains = and(circuit, hurt, bitOf(circuit, [[random.next(), -1]], (info.painChance ?? 0) - 0.5))

  const advance = emitAdvance(world, monster.thingCells)
  const acts = (action: string) => and(circuit, advance.started, circuit.indexRead(advance.state, actionTable(world, action)))
  const looks = acts('Look')
  const chases = acts('Chase')
  const faces = acts('FaceTarget')
  const falls = acts('Fall')
  const posAttack = acts('PosAttack')
  const sposAttack = acts('SPosAttack')
  const troopAttack = acts('TroopAttack')
  const sargAttack = acts('SargAttack')
  const spawnStates = consts(states.names.map(name => name === `${info.spawn}` || name === `${info.spawn}2` ? 1 : 0))

  // A_Look: the player in sight and in front, or near, or a noise that has reached this sector, with the player in
  // sight too for a monster in ambush.
  const heard = or(circuit, cells.heard, and(circuit, noise, circuit.indexReadAffine([[player.sector, sectorCount], [sector, 1]], 0, world.hearing, 'clamp', 'clamp')))
  const sees = and(circuit, sight, or(circuit, facingDelta, bitOf(circuit, [[distance, -1]], 64)))
  const wakes = and(circuit, looks, or(circuit, sees, thing.ambush ? and(circuit, heard, sight) : heard))
  const wakesHurt = and(circuit, hurt, not(circuit, pains), circuit.indexRead(monster.thingCells.state, spawnStates))

  // A_Chase.
  const reaction = choose(circuit, chases, cells.reaction, emitReluSum(circuit, [[cells.reaction, 1]], -1))
  // The stored count is a whole number within 0..8, and a chase takes 1 from it but not below 0.
  circuit.assumeRange(reaction, 0, 8, {allowExistingReaders: true})
  circuit.assumeGrid(reaction, 1, {allowExistingReaders: true})
  const inMelee = and(circuit, sight, bitOf(circuit, [[distance, -1]], 60))
  const fresh = not(circuit, cells.justAttacked)
  const melee = info.melee === undefined ? circuit.constant(0) : and(circuit, chases, fresh, inMelee)
  let missile: Wire = circuit.constant(0)
  if (info.missile !== undefined) {
    // P_CheckMissileRange: in sight, ready, and a draw at least the distance less 64, less 128 more without melee.
    const factor = emitClampZeroTo(circuit, [[distance, 1]], -64 - (info.melee === undefined ? 128 : 0), 200)
    const ready = and(circuit, sight, equals(circuit, reaction, 0), equals(circuit, cells.moveCount, 0))
    missile = and(circuit, chases, fresh, not(circuit, melee), ready, bitOf(circuit, [[random.next(), 1], [factor, -1]], 0.5))
  }
  // With the player dead, A_Chase finds no target and goes back to the spawn state, to look again.
  const givesUp = and(circuit, chases, not(circuit, player.alive))
  const moving = and(circuit, chases, player.alive, not(circuit, melee), not(circuit, missile))
  // A new direction when the count runs out, after an attack, or after a blocked move: toward the player, then 45°
  // to one side, the other, 90°, and anywhere.
  const needNew = or(circuit, equals(circuit, cells.moveCount, 0), cells.justAttacked, bitOf(circuit, [[cells.attempt, 1]], -0.5))
  const side = circuit.affine([[random.next(byte => byte & 1), 2]], -1)
  const wrap8 = consts(Array.from({length: 24}, (_, index) => index % 8))
  const turned = (terms: Terms) => circuit.indexReadAffine([[toward, 1], ...terms], 8, wrap8, 'clamp', 'clamp')
  const candidates = [toward, turned([[side, 1]]), turned([[side, -1]]), turned([[side, 2]]), random.next(byte => byte & 7)]
  const chosen = circuit.indexRead(cells.attempt, candidates)
  const direction = choose(circuit, needNew, cells.direction, chosen)
  const speed = info.speed ?? 8
  const angle8 = Array.from({length: 8}, (_, index) => index * Math.PI / 4)
  const tryX = circuit.affine([[cells.x, 1], [circuit.indexRead(direction, consts(angle8.map(angle => speed * Math.cos(angle)))), 1]])
  const tryY = circuit.affine([[cells.y, 1], [circuit.indexRead(direction, consts(angle8.map(angle => speed * Math.sin(angle)))), 1]])
  const tryCell = emitLocate(circuit, world.bsp, tryX, tryY)
  const trySector = circuit.indexRead(tryCell, world.sectorOfCell)
  const floorHere = circuit.indexRead(sector, world.floor)
  const check = emitCheckPosition(circuit, world.lines, {
    x: tryX,
    y: tryY,
    z: floorHere,
    radius: info.radius,
    height: info.height,
    sectorFloor: circuit.indexRead(trySector, world.floor),
    sectorCeiling: circuit.indexRead(trySector, world.ceiling),
    player: false,
    solids: world.solids,
    movers: others,
  })
  const moved = and(circuit, moving, not(circuit, check.blocked))
  const stuck = and(circuit, moving, check.blocked)
  const nextAttempt = choose(circuit, moved, choose(circuit, stuck, cells.attempt, circuit.indexReadAffine([[cells.attempt, 1]], 1, consts([0, 1, 2, 3, 4, 0]), 'clamp', 'clamp')), circuit.constant(0))
  let moveCount: Wire = cells.moveCount
  moveCount = choose(circuit, moved, moveCount, choose(circuit, needNew, emitReluSum(circuit, [[cells.moveCount, 1]], -1), random.next(byte => byte & 15)))
  moveCount = choose(circuit, stuck, moveCount, circuit.constant(0))
  let facing: Wire = choose(circuit, moving, cells.direction, direction)
  facing = choose(circuit, or(circuit, faces, posAttack, sposAttack, troopAttack, sargAttack), facing, toward)

  // Attacks on the player, each as damage this tic.
  // |P_Random() - P_Random()| as a triangular draw.
  const accuracy = (byte: number) => {
    const u = byte / 255
    return Math.abs(u < 0.5 ? Math.sqrt(2 * u) - 1 : 1 - Math.sqrt(2 * (1 - u))) * 255
  }
  // A monster's hitscan turns by that difference << 20 of a turn, 2π / 4096 radians per unit, and hits when the
  // spread at the player's distance stays within its radius of 16: |difference| × distance < 16 × 4096 / 2π.
  const hitLimit = 16 * 4096 / (2 * Math.PI)
  const bullet = (damage: (byte: number) => number) => {
    const misses = bitOf(circuit, [[circuit.multiply(random.next(accuracy), distance), 1]], -hitLimit)
    return gate(circuit, [[random.next(damage), 1]], and(circuit, sight, not(circuit, misses)))
  }
  const damageTerms: Pair[] = []
  if (info.missile !== undefined && info.melee === undefined) {
    // A_PosAttack: one bullet of 3..15; A_SPosAttack: three.
    const shots = thing.type === 9 ? 3 : 1
    const attack = thing.type === 9 ? sposAttack : posAttack
    for (let shot = 0; shot < shots; shot++) damageTerms.push([gate(circuit, [[bullet(byte => (byte % 5 + 1) * 3), 1]], attack), 1])
  }
  if (thing.type === 3001) damageTerms.push([gate(circuit, [[random.next(byte => (byte % 8 + 1) * 3), 1]], and(circuit, troopAttack, inMelee)), 1])
  if (thing.type === 3002) damageTerms.push([gate(circuit, [[random.next(byte => (byte % 10 + 1) * 4), 1]], and(circuit, sargAttack, inMelee)), 1])

  // The fireball: launched by A_TroopAttack out of melee range, flying 10 units per tic, exploding on a wall or the
  // player.
  let projectileNext: MonsterResult['projectileNext'] = null
  if (monster.projectile !== null) {
    const ball = monster.projectile
    const launches = and(circuit, troopAttack, not(circuit, inMelee))
    const flying = circuit.indexRead(ball.state, consts(states.names.map(name => name === 'TBALL1' || name === 'TBALL2' ? 1 : 0)))
    const ballAdvance = emitAdvance(world, {state: ball.state, tics: ball.tics})
    const wall = emitRay(circuit, world.rays, {x: ball.x, y: ball.y, dx: ball.momX, dy: ball.momY, cell: ball.cell, steps: 4})
    const toX = circuit.affine([[ball.x, 1], [ball.momX, 1]])
    const toY = circuit.affine([[ball.y, 1], [ball.momY, 1]])
    const reach = 6 + 16
    // A dead player's corpse isn't solid, so fireballs fly through it.
    const hitsPlayer = and(circuit, flying, player.alive,
      bitOf(circuit, [[toX, 1], [player.x, -1]], reach), bitOf(circuit, [[toX, -1], [player.x, 1]], reach),
      bitOf(circuit, [[toY, 1], [player.y, -1]], reach), bitOf(circuit, [[toY, -1], [player.y, 1]], reach))
    const explodes = and(circuit, flying, or(circuit, hitsPlayer, not(circuit, emitReaches(circuit, wall))))
    const flies = and(circuit, flying, not(circuit, explodes))
    damageTerms.push([gate(circuit, [[random.next(byte => (byte % 8 + 1) * 3), 1]], hitsPlayer), 1])
    // A unit vector toward the player from the approximate distance, times the fireball's speed of 10: 1 / distance
    // from a seed at 16-unit steps, within a third of it, and 3 Newton steps, each squaring the relative error, to
    // under 2 × 10^-4.
    const clamped = circuit.affine([[emitClampZeroTo(circuit, [[distance, 1]], -16, 8192), 1]], 16)
    // The distance less 16 is clamped to 0..8192 just above, and the 16 is added back.
    circuit.assumeRange(clamped, 16, 8208, {allowExistingReaders: true})
    let inverse = circuit.indexReadAffine([[clamped, 1 / 16]], 0, consts(Array.from({length: 514}, (_, index) => 1 / (Math.max(1, index) * 16 + 8))), 'clamp', 'clamp')
    for (let step = 0; step < 3; step++) {
      inverse = circuit.reglu([[inverse, 1]], 0, [[circuit.multiply(clamped, inverse), -1]], 2)
      // A Newton step y × (2 - clamped × y) is at most 1 / clamped, its largest value over y, and the ReLU keeps it at
      // 0 or more, from a positive seed. clamped is at least 16.
      circuit.assumeRange(inverse, 0, 1 / 16, {allowExistingReaders: true})
    }
    let ballState = ballAdvance.state
    ballState = choose(circuit, explodes, ballState, circuit.constant(states.state('TBALLX1')))
    ballState = stateIndex(world, choose(circuit, launches, ballState, circuit.constant(states.state('TBALL1'))))
    // Each is dx or dy times 10 × inverse, at most 10 / clamped, and clamped is at least |dx| and |dy|: P_AproxDistance
    // is at least the larger, and every E1 map spans less than the clamp's 8208 units. So each is at most 10.
    const clampMomentum = (wire: Wire) => {
      circuit.assumeRange(wire, -16, 16, {allowExistingReaders: true})
      return wire
    }
    projectileNext = {
      x: choose(circuit, launches, choose(circuit, flies, ball.x, toX), cells.x),
      y: choose(circuit, launches, choose(circuit, flies, ball.y, toY), cells.y),
      z: choose(circuit, launches, ball.z, circuit.affine([[floorHere, 1]], 32)),
      cell: choose(circuit, launches, choose(circuit, flies, ball.cell, emitLocate(circuit, world.bsp, toX, toY)), cells.cell),
      momX: choose(circuit, launches, ball.momX, clampMomentum(circuit.multiply(dx, circuit.affine([[inverse, 10]])))),
      momY: choose(circuit, launches, ball.momY, clampMomentum(circuit.multiply(dy, circuit.affine([[inverse, 10]])))),
      state: ballState,
      tics: emitTics(world, {state: ball.state, tics: ball.tics}, ballState, or(circuit, ballAdvance.started, explodes, launches)),
    }
  }

  // The state: death, pain, waking, attacks, or where the tics led.
  const named = (name: string | undefined) => circuit.constant(name === undefined ? 0 : states.state(name))
  let next: Wire = advance.state
  next = choose(circuit, or(circuit, wakes, wakesHurt), next, named(info.see))
  next = choose(circuit, givesUp, next, named(info.spawn))
  next = choose(circuit, melee, next, named(info.melee))
  next = choose(circuit, missile, next, named(info.missile))
  next = choose(circuit, pains, next, named(info.pain))
  next = choose(circuit, dies, next, named(info.death))
  next = stateIndex(world, choose(circuit, extreme, next, named(info.extremeDeath)))
  const forced = or(circuit, wakes, wakesHurt, givesUp, melee, missile, pains, dies)
  return {
    next: {
      x: choose(circuit, moved, cells.x, tryX),
      y: choose(circuit, moved, cells.y, tryY),
      cell: choose(circuit, moved, cells.cell, tryCell),
      direction: facing,
      health: choose(circuit, alive, cells.health, emitMax(circuit, health, circuit.constant(-1024))),
      moveCount,
      reaction,
      // Set by a missile attack and cleared by the next A_Chase, Doom's MF_JUSTATTACKED.
      justAttacked: choose(circuit, chases, cells.justAttacked, missile),
      attempt: nextAttempt,
      solid: and(circuit, cells.solid, not(circuit, falls)),
      heard,
    },
    thingNext: {
      state: next,
      tics: emitTics(world, monster.thingCells, next, or(circuit, forced, advance.started)),
      present: monster.thingCells.present,
    },
    projectileNext,
    damage: circuit.affine(damageTerms),
    dies,
  }
}

export function emitBarrel(world: ActorWorld, thing: LevelThing, health: Wire, thingCells: ThingCells, damageTaken: Wire) {
  const {circuit, states} = world
  const alive = bitOf(circuit, [[health, 1]], -0.5)
  const dies = and(circuit, alive, not(circuit, bitOf(circuit, [[health, 1], [damageTaken, -1]], -0.5)))
  const advance = emitAdvance(world, thingCells)
  const next = stateIndex(world, choose(circuit, dies, advance.state, circuit.constant(states.state(thing.info.death ?? 'NULL'))))
  return {
    health: choose(circuit, alive, health, circuit.affine([[health, 1], [damageTaken, -1]])),
    thingNext: {
      state: next,
      tics: emitTics(world, thingCells, next, or(circuit, dies, advance.started)),
      present: not(circuit, equals(circuit, next, states.state('NULL'))),
    },
  }
}

// Doom's P_RadiusAttack of 128 at an explosion, against a target of `radius`: 128 less the larger of |dx| and |dy|
// beyond the radius, when below 128.
export function emitBlast(circuit: Circuit, explodes: Wire, bx: Wire, by: Wire, tx: Wire, ty: Wire, radius: number) {
  const ax = emitAbs(circuit, circuit.affine([[tx, 1], [bx, -1]]))
  const ay = emitAbs(circuit, circuit.affine([[ty, 1], [by, -1]]))
  const reach = emitReluSum(circuit, [[emitMax(circuit, ax, ay), 1]], -radius)
  return gate(circuit, [[emitReluSum(circuit, [[reach, -1]], 128), 1]], explodes)
}
