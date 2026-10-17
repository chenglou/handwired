// A small set of samples for the checks of learn/, made here without the dataset, which is built at the same time
// as this folder: valid TOML documents with one piece of damage that knows nothing of TOML. It is no training set of
// the experiment. The checks use it where the JSON checks use the standard set of the dataset.
//
// A sample is a document with one of four kinds of damage: one code point removed, one added, one replaced by
// another, or a few code points in a row removed. A kept code point has the label of its counterpart in the document,
// from ../reference.ts. From the first error on every value of a label is scored. Before it, a value that today's
// parser does not give is not scored, as in the dataset: up to its first error a text is the start of a valid text,
// e.g. in `name = tiny"`, where the value lost its opening quote, the `t` is read as the start of `true`. An added
// or a replaced code point has no label. One sample in 20 is a document without damage. A damaged text can still be
// valid, e.g. a comment that lost a letter: the set keeps it, as a sample with nothing to recover.
import {validDocument} from '../check-texts.ts'
import {labelReference} from '../reference.ts'
import {capacity, runTableParser} from '../table-parser.ts'
import {type Label, type LabeledText, type Samples, samplesOf} from './data.ts'
import {createRandom} from './random.ts'

// Short documents written by hand, next to the generated ones of ../check-texts.ts, which have up to 512 code points.
const shortDocuments = [
  'title = "TOML Example"\n\n[owner]\nname = "Tom"\ndob = 1979-05-27T07:32:00-08:00\n',
  '[database]\nenabled = true\nports = [ 8000, 8001, 8002 ]\ndata = [ ["delta", "phi"], [3.14] ]\ntemp_targets = { cpu = 79.5, case = 72.0 }\n',
  '# a comment\n[servers.alpha]\nip = "10.0.0.1"\nrole = \'frontend\'\n\n[servers.beta]\nip = "10.0.0.2"\nrole = "backend"\n',
  '[[products]]\nname = "Hammer"\nsku = 738594937\n\n[[products]]\nname = "Nail"\nsku = 284758393\ncolor = "gray"\n',
  'name = "demo"\nversion = "0.1.0"\nkeywords = [\n  "a",\n  "b", # the second\n]\n\n[dependencies]\nserde = { version = "1.0", features = ["derive"] }\n',
  'a.b.c = 1\n"quoted key" = \'literal\'\nhex = 0xDEADBEEF\nflt = 6.626e-34\ninfinite = -inf\ntext = """\nline one\nline two"""\n',
  'point = { x = 1, y = 2 }\nnested = [[1, 2], [3, [4, 5]], { k = [6] }]\nflag = false\ntime = 07:32:00\n',
]

const insertedCodePoints = Array.from(' \n\t"\'#=.,[]{}:+-_0159aeftnxTZ;!é')

// The text `index` of the check set of `seed`.
export function checkSampleAt(seed: number, index: number): LabeledText {
  const random = createRandom(seed, index)
  const original = random.chance(0.5) ? random.pick(shortDocuments) : validDocument(random.integer(0, 2_000_000_000))
  const reference = labelReference(original)
  if (!reference.valid) throw new Error(`the reference labeler rejects a document of the check set: ${JSON.stringify(original.slice(0, 80))}`)
  const split = index % 10 === 0 ? 'validation' : 'train'
  const codePoints = Array.from(original)
  const everyPosition = codePoints.map((_, position) => position)
  if (random.chance(0.05) || codePoints.length === 0) return {index, split, source: 'valid', kinds: [], broken: original, labels: reference.labels, firstDamage: -1, original, alignment: everyPosition}
  const roll = random.next()
  let at = random.integer(0, codePoints.length - 1)
  let kind: string
  // The alignment: for each code point of the broken text the index of its counterpart, or -1.
  let alignment: number[]
  let broken: string[]
  if (roll < 0.2 && codePoints.length < capacity) {
    kind = 'addedCodePoint'
    const added = random.pick(insertedCodePoints)
    // Of two readings that give the same text, the later code point is the added one.
    while (at < codePoints.length && codePoints[at] === added) at++
    broken = [...codePoints.slice(0, at), added, ...codePoints.slice(at)]
    alignment = [...everyPosition.slice(0, at), -1, ...everyPosition.slice(at)]
  } else if (roll < 0.3) {
    kind = 'replacedCodePoint'
    const others = insertedCodePoints.filter(codePoint => codePoint !== codePoints[at])
    broken = [...codePoints.slice(0, at), random.pick(others), ...codePoints.slice(at + 1)]
    alignment = [...everyPosition.slice(0, at), -1, ...everyPosition.slice(at + 1)]
  } else {
    kind = roll < 0.4 ? 'removedCodePoints' : 'removedCodePoint'
    const count = kind === 'removedCodePoint' ? 1 : Math.min(random.integer(2, 6), codePoints.length - at)
    // Of two readings that give the same text, the later code points are the removed ones.
    while (at + count < codePoints.length && codePoints[at + count] === codePoints[at]) at++
    broken = [...codePoints.slice(0, at), ...codePoints.slice(at + count)]
    alignment = [...everyPosition.slice(0, at), ...everyPosition.slice(at + count)]
  }
  // The labels, without the values that today's parser does not give before its first error.
  const trace = runTableParser(broken.join(''))
  const firstError = trace.firstErrorPosition === -1 ? broken.length : trace.firstErrorPosition
  const labels = alignment.map((counterpart, position): Label | undefined => {
    if (counterpart === -1) return undefined
    const label = reference.labels[counterpart]!
    if (position >= firstError) return label
    const nestingGiven = trace.depthAfter[position] === label.depth && trace.containerAfter[position] === label.container
    return {kind: trace.displayKind[position] === label.kind ? label.kind : undefined, depth: nestingGiven ? label.depth : undefined, container: nestingGiven ? label.container : undefined}
  })
  return {index, split, source: 'damage', kinds: [kind], broken: broken.join(''), labels, firstDamage: at, original, alignment}
}

// The check set: the texts 0 to count - 1 of a seed, a tenth of them in the validation split and none in the test split.
export function checkSamples(count: number, seed = 20261016): Samples {
  function* texts() {
    for (let index = 0; index < count; index++) yield checkSampleAt(seed, index)
  }
  return samplesOf(texts(), seed)
}
