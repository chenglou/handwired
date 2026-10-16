// Independent float64 oracle. Production code never imports this file.
// Keep the equations explicit rather than sharing a stepping or loss helper.
import type {State} from '../../src/neural-lander/lander.ts'

export function reference(parameters: readonly number[], target: number) {
  let x = 0, y = 10, vx = 0, vy = -1, ground = 0, effort = 0
  const states: State[] = [{x, y, vx, vy, tx: 0, ty: 0}]
  for (let command = 0; command < 16; command++) {
    const tx = parameters[command * 2]!, ty = parameters[command * 2 + 1]!
    effort += (tx * tx + ty * ty) * 0.001 / 16
    for (let step = 0; step < 6; step++) {
      vx += tx * 4 / 16
      vy += (ty * 8 - 4) / 16
      x += vx / 16
      y += vy / 16
      ground += Math.max(0, -y) ** 2 * 20 / 96
      states.push({x, y, vx, vy, tx, ty})
    }
  }
  return {states, loss: 10 * ((x - target) ** 2 + y ** 2) + vx ** 2 + vy ** 2 + ground + effort}
}
