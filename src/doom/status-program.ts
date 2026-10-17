// The status bar program: at most one evaluation per tic, which draws Doom's 320 × 32 status bar from the player's
// counters. What never changes, the bar, the arms panel, the weapons E1M1 never gives and the maximum ammo, is composed
// while building into constant pixels. Every number, the face, the keys and the shotgun's arms digit is a widget: per
// pixel of its box, a read of the glyph its value picks from a table of glyphs, and that texel or the background behind
// it.
import {createSourceTable, input, inputBit, list} from '../runtime/cells.ts'
import {type Wire} from '../runtime/numeric-ui-core.ts'
import {constantTable, emitReluSum} from './ops.ts'
import {type Picture, type Wad, namedLump, readPicture} from './wad.ts'

export const statusWidth = 320
export const statusHeight = 32
const top = 168

export const statusSpec = () => ({
  health: input([0, 200], {grid: 1}),
  armor: input([0, 200], {grid: 1}),
  // The ready weapon's ammo, or 1994 for the fist, which Doom's status bar leaves blank.
  ammo: input([0, 1994], {grid: 1}),
  bullets: input([0, 200], {grid: 1}),
  shells: input([0, 50], {grid: 1}),
  rockets: input([0, 50], {grid: 1}),
  cells: input([0, 300], {grid: 1}),
  shotgun: inputBit(),
  keys: list(3, () => inputBit()),
  alive: inputBit(),
})

const picture = (wad: Wad, name: string): Picture => readPicture(name, namedLump(wad, name))

export function buildStatusProgram(wad: Wad) {
  const table = createSourceTable()
  const cells = table.declare(statusSpec())
  const circuit = table.createCircuit()

  // The constant background: palette indices, row-major, 320 × 32.
  const background = new Int16Array(statusWidth * statusHeight)
  const draw = (into: Int16Array, image: Picture, x: number, y: number) => {
    const left = x - image.leftOffset
    const upper = y - image.topOffset - top
    for (let column = 0; column < image.width; column++) {
      for (let row = 0; row < image.height; row++) {
        const texel = image.texels[column * image.height + row]!
        const px = left + column
        const py = upper + row
        if (texel >= 0 && px >= 0 && px < statusWidth && py >= 0 && py < statusHeight) into[py * statusWidth + px] = texel
      }
    }
  }
  draw(background, picture(wad, 'STBAR'), 0, top)
  draw(background, picture(wad, 'STARMS'), 104, 168)
  const percent = picture(wad, 'STTPRCNT')
  draw(background, percent, 90, 171)
  draw(background, percent, 221, 171)
  // Arms 2..7: the pistol always owned, the shotgun a widget, the rest never owned in E1M1.
  for (let index = 0; index < 6; index++) {
    if (index === 1) continue
    draw(background, picture(wad, index === 0 ? 'STYSNUM2' : `STGNUM${index + 2}`), 111 + (index % 3) * 12, 172 + Math.floor(index / 3) * 10)
  }
  const smallDigits = Array.from({length: 10}, (_, digit) => picture(wad, `STYSNUM${digit}`))
  const bigDigits = Array.from({length: 10}, (_, digit) => picture(wad, `STTNUM${digit}`))
  // Doom's STlib_drawNum: digits right to left from x, none for a leading zero, and one 0 for zero.
  const drawNumber = (into: Int16Array, digits: Picture[], value: number, x: number, y: number) => {
    const width = digits[0]!.width
    if (value === 0) draw(into, digits[0]!, x - width, y)
    let rest = value
    let at = x
    while (rest > 0) {
      at -= width
      draw(into, digits[rest % 10]!, at, y)
      rest = Math.floor(rest / 10)
    }
  }
  const maximum = [200, 50, 300, 50]
  const ammoRows = [173, 179, 191, 185]
  maximum.forEach((value, index) => drawNumber(background, smallDigits, value, 314, ammoRows[index]!))

  // Widgets: each a box and a list of glyphs, each glyph drawn into a box-sized image where -1 is transparent.
  const pixels: Wire[] = Array.from(background, value => circuit.constant(value))
  const widget = (glyph: Wire, glyphs: ((into: Int16Array) => void)[]) => {
    const images = glyphs.map(paint => {
      const image = new Int16Array(statusWidth * statusHeight).fill(-1)
      paint(image)
      return image
    })
    const covered: number[] = []
    for (let pixel = 0; pixel < statusWidth * statusHeight; pixel++) if (images.some(image => image[pixel]! >= 0)) covered.push(pixel)
    // Per glyph, its texels over the covered pixels, as palette index + 1 and 0 where transparent.
    const texels = constantTable(circuit, images.flatMap(image => covered.map(pixel => image[pixel]! + 1)))
    covered.forEach((pixel, slot) => {
      const texel = circuit.indexReadAffine([[glyph, covered.length]], slot, texels, 'clamp', 'clamp')
      const opaque = circuit.affine([[texel, 1], [emitReluSum(circuit, [[texel, 1]], -1), -1]])
      const behind = background[pixel]!
      pixels[pixel] = circuit.affine([[circuit.reglu([[texel, 1]], -1 - behind, [[opaque, 1]], 0), 1]], behind)
    })
  }
  const blank = () => {}
  // A number's digit at a place (0 ones, 1 tens, 2 hundreds) as a glyph, 10 for none.
  const digitGlyph = (value: Wire, place: number, limit: number) => circuit.indexRead(value, constantTable(circuit, Array.from({length: limit + 1}, (_, number) => {
    if (number === 1994) return 10
    if (number === 0) return place === 0 ? 0 : 10
    const digit = Math.floor(number / 10 ** place)
    return digit === 0 ? 10 : digit % 10
  })))
  const number = (value: Wire, limit: number, digits: Picture[], x: number, y: number, places: number) => {
    const width = digits[0]!.width
    for (let place = 0; place < places; place++) {
      widget(digitGlyph(value, place, limit), [...digits.map(digit => (into: Int16Array) => draw(into, digit, x - (place + 1) * width, y)), blank])
    }
  }
  number(cells.ammo, 1994, bigDigits, 44, 171, 3)
  number(cells.health, 200, bigDigits, 90, 171, 3)
  number(cells.armor, 200, bigDigits, 221, 171, 3)
  const counts = [cells.bullets, cells.shells, cells.cells, cells.rockets]
  counts.forEach((count, index) => number(count, maximum[index]!, smallDigits, 288, ammoRows[index]!, 3))
  widget(cells.shotgun, [
    into => draw(into, picture(wad, 'STGNUM3'), 123, 172),
    into => draw(into, picture(wad, 'STYSNUM3'), 123, 172),
  ])
  cells.keys.forEach((held, index) => widget(held, [blank, into => draw(into, picture(wad, `STKEYS${index}`), 239, 171 + index * 10)]))
  // The face: Doom's pain level, floor((100 - health) × 5 / 101) for health up to 100, looking ahead, or dead.
  const level = circuit.indexRead(cells.health, constantTable(circuit, Array.from({length: 201}, (_, health) => Math.floor((100 - Math.min(100, health)) * 5 / 101))))
  const face = circuit.affine([[level, 1], [circuit.reglu([[level, -1]], 5, [[cells.alive, -1]], 1), 1]])
  widget(face, [0, 1, 2, 3, 4].map(pain => (into: Int16Array) => draw(into, picture(wad, `STFST${pain}1`), 143, 168))
    .concat([into => draw(into, picture(wad, 'STFDEAD0'), 143, 168)]))
  return {cells, output: {pixels}, ...table.finish()}
}
