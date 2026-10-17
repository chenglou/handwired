// The view's geometry and the constant tables that the reference renderer and the column program share. Angles are
// Doom's fine angles, 8192 to a turn, and the view angle is a whole number of them.
export const fineAngles = 8192

export type ViewConfig = {
  // Columns and rows of the 3D view, e.g. 320 × 168 for Doom's view above its status bar, or 160 × 168 in Doom's
  // low detail mode, where each column is drawn 2 pixels wide.
  width: number
  height: number
  // Unrolled portal steps per column: a ray that crosses more portals than this shows black past the last one.
  steps: number
}

export const defaultView: ViewConfig = {width: 160, height: 168, steps: 32}

export function viewConstants(view: ViewConfig) {
  const centerX = view.width / 2
  const centerY = view.height / 2
  // Rows per unit of slope: Doom's 160 for a 168 row view, scaled with the row count.
  const focalY = 160 * view.height / 168
  // xs: the slope of each column's ray, right positive. colFine: Doom's xtoviewangle, left positive, in fine angles.
  const xs = Array.from({length: view.width}, (_, column) => (column + 0.5 - centerX) / centerX)
  const colFine = xs.map(slope => Math.round(-Math.atan(slope) * fineAngles / (2 * Math.PI)))
  const cosPhi = xs.map(slope => 1 / Math.sqrt(1 + slope * slope))
  // Depth per unit of plane height above or below the eye, per row: Doom's yslope.
  const rowFactor = Array.from({length: view.height}, (_, row) => focalY / Math.abs(row + 0.5 - centerY))
  return {centerX, centerY, focalY, xs, colFine, cosPhi, rowFactor}
}

// Secant and tangent per fine angle difference, for differences within ±angleSpan, read at difference + angleSpan.
export const angleSpan = fineAngles + 1024
// Secants and tangents are clamped here: within 0.9° of grazing a line, textures stop stretching.
const angleLimit = 64

export function angleTables() {
  const length = 2 * angleSpan + 1
  const secant = new Float64Array(length)
  const tangent = new Float64Array(length)
  for (let index = 0; index < length; index++) {
    const angle = (index - angleSpan) * 2 * Math.PI / fineAngles
    const clamp = (value: number) => Math.max(-angleLimit, Math.min(angleLimit, value))
    secant[index] = Math.fround(Math.min(angleLimit, Math.abs(1 / Math.cos(angle))))
    tangent[index] = Math.fround(clamp(Math.tan(angle)))
  }
  return {secant, tangent}
}

// The fine angle of a line's right-hand normal, for a line from a to b.
export function normalFine(ax: number, ay: number, bx: number, by: number) {
  const angle = Math.atan2(-(bx - ax), by - ay)
  const fine = Math.round(angle * fineAngles / (2 * Math.PI))
  return ((fine % fineAngles) + fineAngles) % fineAngles
}
