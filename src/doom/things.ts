// What the things of a level are, while building: their types, their states as tables, and the sprites those states
// show, as tables of texels. Plain JavaScript; the game program runs the states, and the frame and column programs draw
// the sprites.
import {stateRows} from './states.ts'
import {type DoomMap, type Picture, type Wad, readSprites} from './wad.ts'

type ThingKind = 'monster' | 'pickup' | 'barrel' | 'decoration'

// What touching an item gives. Doom picks up bonuses always, and anything else only while it would raise a counter.
type Pickup =
  | {health: number, limit: number, always?: boolean}
  | {armor: number, limit: number, always?: boolean}
  | {ammo: 'bullets' | 'shells' | 'rockets' | 'cells', amount: number}
  | {key: number}
  | {weapon: 'shotgun' | 'chainsaw', shells?: number}

type ThingType = {
  kind: ThingKind
  spawn: string
  radius: number
  height: number
  solid: boolean
  // Hangs from the ceiling instead of standing on the floor.
  ceiling?: boolean
  pickup?: Pickup
  // Monsters and barrels.
  health?: number
  speed?: number
  painChance?: number
  see?: string
  pain?: string
  melee?: string
  missile?: string
  death?: string
  extremeDeath?: string
}

const decoration = (spawn: string, radius = 16, solid = true): ThingType => ({kind: 'decoration', spawn, radius, height: 16, solid})
const item = (spawn: string, pickup: Pickup): ThingType => ({kind: 'pickup', spawn, radius: 20, height: 16, solid: false, pickup})
const monster = (name: string, health: number, speed: number, radius: number, painChance: number, attacks: {melee?: boolean, missile?: boolean, extreme?: boolean}): ThingType => ({
  kind: 'monster',
  spawn: `${name}_STND`,
  radius,
  height: 56,
  solid: true,
  health,
  speed,
  painChance,
  see: `${name}_RUN1`,
  pain: `${name}_PAIN`,
  ...(attacks.melee ? {melee: `${name}_ATK1`} : {}),
  ...(attacks.missile ? {missile: `${name}_ATK1`} : {}),
  death: `${name}_DIE1`,
  ...(attacks.extreme ? {extremeDeath: `${name}_XDIE1`} : {}),
})

// Doom's thing types that E1M1 uses, by editor number, with info.c's mobjinfo[] values from linuxdoom-1.10, GPL-2.0:
// sizes, health, speeds, pain chances and states.
const thingTypes: Record<number, ThingType> = {
  3004: monster('POSS', 20, 8, 20, 200, {missile: true, extreme: true}),
  9: monster('SPOS', 30, 8, 20, 170, {missile: true, extreme: true}),
  3001: monster('TROO', 60, 8, 20, 200, {melee: true, missile: true, extreme: true}),
  3002: monster('SARG', 150, 10, 30, 180, {melee: true}),
  2035: {kind: 'barrel', spawn: 'BAR1', radius: 10, height: 42, solid: true, health: 20, death: 'BEXP'},
  2014: item('BON1', {health: 1, limit: 200, always: true}),
  2015: item('BON2', {armor: 1, limit: 200, always: true}),
  2011: item('STIM', {health: 10, limit: 100}),
  2012: item('MEDI', {health: 25, limit: 100}),
  2023: item('PSTR', {health: 100, limit: 100}),
  2018: item('ARM1', {armor: 100, limit: 100}),
  2019: item('ARM2', {armor: 200, limit: 200}),
  2007: item('CLIP', {ammo: 'bullets', amount: 10}),
  2048: item('AMMO', {ammo: 'bullets', amount: 50}),
  2008: item('SHEL', {ammo: 'shells', amount: 4}),
  2049: item('SBOX', {ammo: 'shells', amount: 20}),
  2010: item('ROCK', {ammo: 'rockets', amount: 1}),
  2047: item('CELL', {ammo: 'cells', amount: 20}),
  5: item('BKEY', {key: 1}),
  2005: item('CSAW', {weapon: 'chainsaw'}),
  2001: item('SHOT', {weapon: 'shotgun', shells: 8}),
  2028: decoration('COLU'),
  35: decoration('CANDELABRA'),
  43: decoration('TORCHTREE'),
  47: decoration('STALAGTITE'),
  48: decoration('TECHPILLAR'),
  54: decoration('BIGTREE', 32),
  26: decoration('LIVESTICK'),
  60: {kind: 'decoration', spawn: 'MEAT4', radius: 20, height: 68, solid: false, ceiling: true},
  15: decoration('PLAY_DIE7', 20, false),
  18: decoration('POSS_DIE5', 20, false),
  19: decoration('SPOS_DIE5', 20, false),
  20: decoration('TROO_DIE5', 20, false),
  21: decoration('SARG_DIE6', 20, false),
  10: decoration('PLAY_XDIE9', 20, false),
  12: decoration('PLAY_XDIE9', 20, false),
  24: decoration('GIBS', 20, false),
}

export type StateTables = ReturnType<typeof buildStateTables>

export function buildStateTables() {
  const index = new Map(stateRows.map((row, position) => [row[0], position]))
  const state = (name: string) => {
    const position = index.get(name)
    if (position === undefined) throw new Error(`state ${name} is not in the table`)
    return position
  }
  // One frame id per distinct sprite frame that a state shows.
  const frameIds = new Map<string, number>()
  const frames: {sprite: string, frame: number}[] = []
  const frameOf = stateRows.map(([, sprite, frame]) => {
    const key = `${sprite}${frame}`
    let id = frameIds.get(key)
    if (id === undefined) {
      id = frames.length
      frameIds.set(key, id)
      frames.push({sprite, frame})
    }
    return id
  })
  const actions = [...new Set(stateRows.map(row => row[5]))]
  return {
    count: stateRows.length,
    state,
    names: stateRows.map(row => row[0]),
    frame: frameOf,
    bright: stateRows.map(row => row[3]),
    tics: stateRows.map(row => row[4]),
    next: stateRows.map(row => state(row[6])),
    action: stateRows.map(row => actions.indexOf(row[5])),
    actions,
    frames,
  }
}

type SpriteLump = {name: string, width: number, height: number, left: number, top: number, base: number}

export type SpriteCatalog = {
  lumps: SpriteLump[]
  // Column-major, texel (u, v) at base + u × (height + 1) + v, as palette index + 1, and 0 where the sprite is
  // transparent. Each column ends in a transparent texel, and so does the table's first, so that a row read a texel
  // past either end of a column shows nothing: an FP32 sum of an address near 2^19 and a fractional row keeps a
  // sixteenth of a texel, and can round to the row past the last.
  texels: Uint16Array
  // Per frame id and rotation 0..7 (0 faces the viewer, then counterclockwise around the thing): the lump and
  // whether it is drawn mirrored.
  rotations: {lump: number, flip: boolean}[]
}

export function buildSpriteCatalog(wad: Wad, frames: {sprite: string, frame: number}[]): SpriteCatalog {
  const sprites = readSprites(wad)
  const lumps: SpriteLump[] = []
  const pictures: Picture[] = []
  const lumpIds = new Map<string, number>()
  const lumpOf = (name: string) => {
    let id = lumpIds.get(name)
    if (id === undefined) {
      const picture = sprites.get(name)!
      id = lumps.length
      lumpIds.set(name, id)
      lumps.push({name, width: picture.width, height: picture.height, left: picture.leftOffset, top: picture.topOffset, base: 0})
      pictures.push(picture)
    }
    return id
  }
  const rotations: {lump: number, flip: boolean}[] = []
  for (const {sprite, frame} of frames) {
    const letter = String.fromCharCode(65 + frame)
    const found = Array.from({length: 8}, (): {lump: number, flip: boolean} | undefined => undefined)
    for (const name of sprites.keys()) {
      if (!name.startsWith(sprite)) continue
      // A lump names one frame and rotation, and optionally a second one that shows it mirrored, e.g. TROOA2A8.
      for (const [at, flip] of [[4, false], [6, true]] as const) {
        if (name[at] !== letter || name.length < at + 2) continue
        const rotation = Number(name[at + 1])
        if (rotation === 0) for (let r = 0; r < 8; r++) found[r] ??= {lump: lumpOf(name), flip}
        else found[rotation - 1] = {lump: lumpOf(name), flip}
      }
    }
    // A frame that no lump has, e.g. SHTGE of Doom's S_LIGHTDONE, which no thing ever shows, gets the first lump.
    rotations.push(...found.map(entry => entry ?? {lump: 0, flip: false}))
  }
  let size = 1
  for (const lump of lumps) {
    lump.base = size
    size += lump.width * (lump.height + 1)
  }
  const texels = new Uint16Array(size)
  pictures.forEach((picture, id) => {
    const {base, height} = lumps[id]!
    for (let index = 0; index < picture.texels.length; index++) {
      texels[base + Math.floor(index / height) * (height + 1) + index % height] = picture.texels[index]! + 1
    }
  })
  return {lumps, texels, rotations}
}

export type LevelThing = {
  index: number
  type: number
  info: ThingType
  x: number
  y: number
  // Facing, as one of 8 directions counterclockwise from east.
  direction: number
  state: number
  // Doom's ambush flag, "deaf": a noise alone doesn't wake it, only a noise with the player in sight.
  ambush: boolean
}

// The things that a single player game on Hurt Me Plenty spawns.
export function levelThings(map: DoomMap, states: StateTables): LevelThing[] {
  const things: LevelThing[] = []
  for (const thing of map.things) {
    if ((thing.flags & 2) === 0 || (thing.flags & 16) !== 0) continue
    const info = thingTypes[thing.type]
    if (info === undefined) continue
    things.push({
      index: things.length,
      type: thing.type,
      info,
      x: thing.x,
      y: thing.y,
      direction: Math.round(((thing.angle % 360) + 360) % 360 / 45) % 8,
      ambush: (thing.flags & 8) !== 0,
      state: states.state(info.spawn),
    })
  }
  return things
}
