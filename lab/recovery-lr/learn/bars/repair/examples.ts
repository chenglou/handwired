// Five broken programs by the author of the two bars of this folder and of ../tree-sitter, each with the program
// that was meant, to show a bar's output beside the wanted labels. They chose nothing: the search has no number
// that was set on samples, and tree-sitter's mapping was compared on train samples only.
import {type Sample, alignmentOfTexts, makeSample} from '../../../sample.ts'

const pairs: {name: string, original: string, broken: string}[] = [
  {
    name: 'a missing `in`',
    original: 'let area w h =\n  let twice = 2 * w in\n  twice * h\nlet unit = area 1 1\n',
    broken: 'let area w h =\n  let twice = 2 * w\n  twice * h\nlet unit = area 1 1\n',
  },
  {
    name: 'a missing `then`',
    original: 'let sign n = if n < 0 then 0 - 1 else 1\n',
    broken: 'let sign n = if n < 0 0 - 1 else 1\n',
  },
  {
    name: 'a bracket that is not closed',
    original: 'let total = add (mul 2 3) 4\nlet next = total + 1\n',
    broken: 'let total = add (mul 2 3 4\nlet next = total + 1\n',
  },
  {
    name: 'a bracket too many',
    original: 'let scale k v = k * (v + 1)\nlet zero = scale 0 0\n',
    broken: 'let scale k v = k * (v + 1))\nlet zero = scale 0 0\n',
  },
  {
    name: '`==` for `=` and `thn` for `then`',
    original: 'let rec fact n = if n = 0 then 1 else n * fact (n - 1)\n',
    broken: 'let rec fact n = if n == 0 thn 1 else n * fact (n - 1)\n',
  },
]

export function exampleSamples(): {name: string, sample: Sample}[] {
  return pairs.map(({name, original, broken}) => {
    const sample = makeSample({id: name, original, broken, alignment: alignmentOfTexts(original, broken)})
    if (typeof sample === 'string') throw new Error(`the example "${name}" is no sample: ${sample}`)
    return {name, sample}
  })
}
