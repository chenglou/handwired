// Random choices for the dataset and the checks, a copy of lab/recovery-parser/random.ts. Every choice is a hash of
// the seed, an index and a counter, and never Math.random or the clock. So sample 73,512 can be made without making
// the ones before it, and two runs make the same samples. Two seeds give unrelated samples.

function lowbias32(n: number) {
  n = Math.imul((n >>> 16) ^ n, 0x21f0aaad)
  n = Math.imul((n >>> 15) ^ n, 0xd35a2d97)
  return (n >>> 15) ^ n
}
// A number in [0, 1) from the seed, the sample's index and the counter. The counter is mixed with the seed before the
// index comes in, so that no single number stands for a pair of seed and index: with lowbias32(lowbias32(seed) ^ index)
// as the state, index i of one seed would give the same numbers as index i ^ d of another seed, for one d per pair of
// seeds.
function hash3(seed: number, index: number, counter: number) {
  return (lowbias32(lowbias32(lowbias32(seed) ^ lowbias32(counter)) ^ index) >>> 0) / 0x100000000
}

// A hash of a text as an unsigned 32-bit integer, e.g. for the split of a sample by its original program.
export function hashText(text: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) hash = lowbias32(hash ^ text.charCodeAt(index))
  return hash >>> 0
}

export type Random = {
  // A number in [0, 1).
  next: () => number
  // An integer from minimum to maximum, both included.
  integer: (minimum: number, maximum: number) => number
  chance: (probability: number) => boolean
  pick: <Item>(items: readonly Item[]) => Item
  // One of the items, each with its weight's share of the total, e.g. weighted([['a', 3], ['b', 1]]) is 'a' 3 times in 4.
  weighted: <Item>(items: readonly (readonly [item: Item, weight: number])[]) => Item
  // The items in a random order.
  shuffled: <Item>(items: readonly Item[]) => Item[]
}

export function createRandom(seed: number, index: number): Random {
  let counter = 0
  const next = () => hash3(seed, index, counter++)
  const integer = (minimum: number, maximum: number) => minimum + Math.floor(next() * (maximum - minimum + 1))
  const pick = <Item>(items: readonly Item[]): Item => {
    if (items.length === 0) throw new Error('pick from an empty list')
    return items[Math.floor(next() * items.length)]!
  }
  const weighted = <Item>(items: readonly (readonly [item: Item, weight: number])[]): Item => {
    let total = 0
    for (const [, weight] of items) total += weight
    let roll = next() * total
    for (const [item, weight] of items) {
      roll -= weight
      if (roll < 0) return item
    }
    return items.at(-1)![0]
  }
  const shuffled = <Item>(items: readonly Item[]): Item[] => {
    const result = [...items]
    for (let index = result.length - 1; index > 0; index--) {
      const other = integer(0, index)
      const item = result[index]!
      result[index] = result[other]!
      result[other] = item
    }
    return result
  }
  return {next, integer, chance: probability => next() < probability, pick, weighted, shuffled}
}
