// The graphics a level needs, laid out as flat tables of palette indices: what the programs read with index reads.
// Plain JavaScript that runs while building.
import {type DoomMap, type Wad, readColormaps, readFlats, readPalettes, readTextures} from './wad.ts'

type TextureInfo = {name: string, base: number, width: number, height: number}

export type Assets = {
  palette: Uint8Array
  // All 14 palettes: 0 normal, 1..8 the red ones of damage, 9..12 the yellow ones of pickups, 13 the radiation suit's.
  palettes: Uint8Array[]
  // 34 colormaps of 256 entries: 32 light levels from bright to dark, invulnerability, black.
  colormaps: Uint8Array
  // Every wall texture of the level, column-major: texel (u, v) is at base + u × height + v.
  texels: Uint8Array
  textures: Map<string, TextureInfo>
  // Middle textures of two-sided lines with their transparency: column-major texels, -1 where transparent.
  maskedTextures: Map<string, {width: number, height: number, texels: Int16Array}>
  // Every flat of the level, 64 × 64 row-major, at base + 64 × row + column.
  flatTexels: Uint8Array
  flats: Map<string, number>
  // Doom's light tables, as colormap levels 0..31: scalelight[16][48] for walls and sprites, zlight[16][128] for flats.
  scaleLight: Uint8Array
  zLight: Uint8Array
}

const LIGHTLEVELS = 16
export const MAXLIGHTSCALE = 48
export const MAXLIGHTZ = 128
const NUMCOLORMAPS = 32
const DISTMAP = 2

// R_InitLightTables and R_ExecuteSetViewSize for a full 320 column view.
function lightTables() {
  const scaleLight = new Uint8Array(LIGHTLEVELS * MAXLIGHTSCALE)
  const zLight = new Uint8Array(LIGHTLEVELS * MAXLIGHTZ)
  const clampLevel = (level: number) => Math.max(0, Math.min(NUMCOLORMAPS - 1, level))
  for (let light = 0; light < LIGHTLEVELS; light++) {
    const startMap = Math.trunc(((LIGHTLEVELS - 1 - light) * 2) * NUMCOLORMAPS / LIGHTLEVELS)
    for (let j = 0; j < MAXLIGHTZ; j++) {
      // FixedDiv(160 << 16, (j + 1) << 20) >> 12
      const scale = Math.floor(Math.floor(160 * 65536 * 65536 / ((j + 1) * 2 ** 20)) / 4096)
      zLight[light * MAXLIGHTZ + j] = clampLevel(startMap - Math.trunc(scale / DISTMAP))
    }
    for (let j = 0; j < MAXLIGHTSCALE; j++) {
      scaleLight[light * MAXLIGHTSCALE + j] = clampLevel(startMap - Math.trunc(j / DISTMAP))
    }
  }
  return {scaleLight, zLight}
}

export const skyFlat = 'F_SKY1'

// Doom's animated flats: each group cycles through its members, 8 tics each.
export const flatAnimations = [
  ['NUKAGE1', 'NUKAGE2', 'NUKAGE3'],
  ['FWATER1', 'FWATER2', 'FWATER3', 'FWATER4'],
  ['SWATER1', 'SWATER2', 'SWATER3', 'SWATER4'],
  ['LAVA1', 'LAVA2', 'LAVA3', 'LAVA4'],
  ['BLOOD1', 'BLOOD2', 'BLOOD3'],
  ['RROCK05', 'RROCK06', 'RROCK07', 'RROCK08'],
  ['SLIME01', 'SLIME02', 'SLIME03', 'SLIME04'],
  ['SLIME05', 'SLIME06', 'SLIME07', 'SLIME08'],
  ['SLIME09', 'SLIME10', 'SLIME11', 'SLIME12'],
]

export function loadAssets(wad: Wad, map: DoomMap, extraTextures: string[] = ['SKY1']): Assets {
  const palettes = readPalettes(wad)
  const palette = palettes[0]!
  const colormaps = new Uint8Array(readColormaps(wad).flatMap(colormap => [...colormap]))
  const allTextures = new Map(readTextures(wad).map(texture => [texture.name, texture]))
  const used = new Set<string>(extraTextures)
  for (const side of map.sidedefs) for (const name of [side.upper, side.lower, side.middle]) if (name !== '-') used.add(name)
  const textures = new Map<string, TextureInfo>()
  const texelParts: Uint8Array[] = []
  let base = 0
  for (const name of [...used].sort()) {
    const texture = allTextures.get(name)
    if (texture === undefined) throw new Error(`texture ${name} not found`)
    const texels = Uint8Array.from(texture.texels, texel => Math.max(0, texel))
    textures.set(name, {name, base, width: texture.width, height: texture.height})
    texelParts.push(texels)
    base += texels.length
  }
  const maskedTextures = new Map<string, {width: number, height: number, texels: Int16Array}>()
  for (const linedef of map.linedefs) {
    if (linedef.back < 0) continue
    for (const side of [linedef.front, linedef.back]) {
      const name = map.sidedefs[side]!.middle
      const texture = allTextures.get(name)
      if (name !== '-' && texture !== undefined) maskedTextures.set(name, {width: texture.width, height: texture.height, texels: texture.texels})
    }
  }
  const allFlats = readFlats(wad)
  const flats = new Map<string, number>()
  const flatParts: Uint8Array[] = []
  const usedFlats = new Set<string>()
  for (const sector of map.sectors) {
    usedFlats.add(sector.floorPic)
    usedFlats.add(sector.ceilingPic)
  }
  // Every member of a used flat's animation, so that a group's members sit 4096 apart in order.
  const ordered: string[] = []
  for (const name of [...usedFlats].sort()) {
    const group = flatAnimations.find(members => members.includes(name))
    for (const member of group?.filter(member => allFlats.has(member)) ?? [name]) if (!ordered.includes(member)) ordered.push(member)
  }
  for (const name of ordered) {
    const flat = allFlats.get(name)
    if (flat === undefined) throw new Error(`flat ${name} not found`)
    flats.set(name, flatParts.length * 4096)
    flatParts.push(flat)
  }
  return {
    palette,
    palettes,
    colormaps,
    texels: concat(texelParts),
    textures,
    maskedTextures,
    flatTexels: concat(flatParts),
    flats,
    ...lightTables(),
  }
}

function concat(parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    result.set(part, at)
    at += part.length
  }
  return result
}
