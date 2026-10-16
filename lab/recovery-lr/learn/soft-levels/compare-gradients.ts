// The gradients of the twins at the start of the recipe's training, cell by cell, for the open cells that the
// parser as it is reads most: do two twins agree in the sign of a logit's gradient, and in the choice that they
// favour? And which twin favours the change that helps the exact parser most? It prints two lists of cells: the
// most read ones, and the most read ones outside the row of the state `stopped`.
//
// The start is the recipe's: the base tables with the flag and the picked terminals, 0.9 on the base's choice in
// every mix. A gradient is the one of the summed loss of the train samples by the logits of a cell. The choice
// that a twin favours in a cell is the one whose logit the gradient raises most, i.e. the most negative entry.
// The exact parser's best change of a cell is the choice that gives the tables the highest score on the same
// samples when only that cell is changed, by the search's order: the code points with all three right first,
// then the labels that are right one by one.
//
// Run from the repo root, with RECOVERY_LR_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-lr/learn/soft-levels/compare-gradients.ts [--train 10000] [--cells 40] [--wide 2000]
// --wide is the width of a second run of the twin of exact stacks, which keeps more of the weight than 48 stacks do.
import {numberOf, refuseUnknownOptions} from '../options.ts'
import {prepareRecipe, recipeSettings} from '../recipe.ts'
import {type RecoveryTables, choicesOf, copyTables, stateOfCell, stopped} from '../recovery-tables.ts'
import {runSample, scorePack, scoreTables} from '../score.ts'
import {createModel} from '../soft/model.ts'
import {createBatchRunner} from '../soft/train.ts'
import {type TwinChoice, referenceTwin} from '../soft/twin.ts'
import {cellInWords, choiceInWords} from '../words.ts'
import {twinsByName} from './smoke.ts'

refuseUnknownOptions('soft-levels/compare-gradients.ts', ['--train', '--cells', '--wide'])
const trainSamples = numberOf('--train', 10_000)
const cellsShown = numberOf('--cells', 40)
const wide = numberOf('--wide', 2000)
const prepared = prepareRecipe(trainSamples)
const {base, train} = prepared
const model = createModel(base, {start: 'base', startShare: recipeSettings.startShare})
const {layout} = model
const places = Int32Array.from({length: train.sampleCount}, (_, place) => place)

const twins: {name: string, choice: TwinChoice}[] = [
  {name: 'stacks, 48', choice: referenceTwin},
  {name: `stacks, ${wide}`, choice: {module: referenceTwin.module, options: {width: wide}}},
  {name: 'levels', choice: twinsByName['levels']!},
  {name: 'levels, pusherBelow', choice: twinsByName['levels-pusher-below']!},
]
const gradients: Float64Array[] = []
for (const {name, choice} of twins) {
  const started = performance.now()
  const batches = await createBatchRunner(layout, train, 4, choice)
  batches.logits.set(model.logits)
  const tally = await batches.run(places, true)
  gradients.push(batches.gradient.slice())
  await batches.close()
  console.log(`${name}: a loss of ${(tally.loss / tally.codePoints).toFixed(4)} per code point at the start, ${(100 * tally.labelsWithoutShare / (3 * tally.codePoints)).toFixed(1)}% of the labels without a share, the gradient of ${train.sampleCount} samples in ${((performance.now() - started) / 1000).toFixed(0)} s on 4 worker threads`)
}

// The trainable cells that the most train samples read with the parser as it is: all of them, and the ones that
// are not of the state `stopped`, whose row has two choices and is read by every sample.
const readers = new Int32Array(base.choice.length)
scoreTables(base, train, {readers})
const readCells = Array.from(readers.keys()).filter(cell => readers[cell]! > 0 && layout.cellOffset[cell] !== -1).sort((left, right) => readers[right]! - readers[left]! || left - right)
const lists = [
  {title: `The ${cellsShown} trainable cells that the most of the ${train.sampleCount} train samples read with the parser as it is`, cells: readCells.slice(0, cellsShown)},
  {title: `The ${cellsShown} such cells that are not of the state stopped`, cells: readCells.filter(cell => stateOfCell(base, cell) !== stopped).slice(0, cellsShown)},
]
const allCells = [...new Set(lists.flatMap(list => list.cells))]
const placeOfCell = new Map(allCells.map((cell, place) => [cell, place]))

// The exact parser's best change of each of these cells: the samples that read the cell are run again with every
// choice of its list in the cell.
const samplesOfCell: number[][] = allCells.map(() => [])
{
  const cellsRead = new Uint8Array(Math.ceil(base.choice.length / 8))
  for (let sample = 0; sample < train.sampleCount; sample++) {
    cellsRead.fill(0)
    runSample(train, sample, base, cellsRead)
    for (const cell of allCells) if ((cellsRead[cell >> 3]! & (1 << (cell & 7))) !== 0) samplesOfCell[placeOfCell.get(cell)!]!.push(sample)
  }
}
type Change = {choice: number, allThree: number, labels: number}
function bestChangeOf(cell: number): {best: Change, ofBase: Change} {
  const tables: RecoveryTables = copyTables(base)
  const samples = samplesOfCell[placeOfCell.get(cell)!]!
  const scoreWith = (choice: number): Change => {
    tables.choice[cell] = choice
    let allThree = 0, labels = 0
    for (const sample of samples) {
      const score = runSample(train, sample, tables)
      allThree += Math.floor(score / scorePack)
      labels += score % scorePack
    }
    return {choice, allThree, labels}
  }
  const ofBase = scoreWith(base.choice[cell]!)
  let best = ofBase
  for (const choice of choicesOf(base, cell)) {
    const change = scoreWith(choice)
    if (change.allThree > best.allThree || (change.allThree === best.allThree && change.labels > best.labels)) best = change
  }
  return {best, ofBase}
}
const bestChanges = allCells.map(bestChangeOf)

// Per cell and twin: the logits' gradients, in the order of the cell's list.
const gradientOf = (twin: number, cell: number): Float64Array => {
  const offset: number = layout.cellOffset[cell]!
  return gradients[twin]!.subarray(offset, offset + choicesOf(base, cell).length)
}
const favouredBy = (twin: number, cell: number): number => {
  const gradient = gradientOf(twin, cell)
  let favoured = 0
  for (let place = 1; place < gradient.length; place++) if (gradient[place]! < gradient[favoured]!) favoured = place
  return choicesOf(base, cell)[favoured]!
}
const cosineOf = (left: Float64Array, right: Float64Array): number => {
  let dot = 0, leftSquares = 0, rightSquares = 0
  for (let place = 0; place < left.length; place++) {
    dot += left[place]! * right[place]!
    leftSquares += left[place]! * left[place]!
    rightSquares += right[place]! * right[place]!
  }
  return leftSquares === 0 || rightSquares === 0 ? NaN : dot / Math.sqrt(leftSquares * rightSquares)
}

for (const {title, cells} of lists) {
  console.log('')
  console.log(`${title}. Per cell: the samples that read it, what the exact parser's best change of the cell alone is and what it adds (code points with all three right, labels right), and what each twin's gradient favours.`)
  for (const cell of cells) {
    const {best, ofBase} = bestChanges[placeOfCell.get(cell)!]!
    console.log(`- ${String(readers[cell]).padStart(5)}  ${cellInWords(base, cell)}`)
    console.log(`         the exact parser's best change: ${best.choice === base.choice[cell] ? 'none, the base is best' : `${choiceInWords(base, cell, best.choice)} (+${best.allThree - ofBase.allThree} all three, ${best.labels >= ofBase.labels ? '+' : ''}${best.labels - ofBase.labels} labels)`}`)
    twins.forEach(({name}, twin) => {
      const favoured = favouredBy(twin, cell)
      const atBest = gradientOf(twin, cell)[choicesOf(base, cell).indexOf(best.choice)]!
      console.log(`         ${name.padEnd(20)} favours: ${choiceInWords(base, cell, favoured)}${favoured === best.choice ? ' (the best change)' : ''}; the gradient at the best change's logit is ${atBest.toExponential(2)}`)
    })
  }

  console.log('')
  const changeable = cells.filter(cell => bestChanges[placeOfCell.get(cell)!]!.best.choice !== base.choice[cell])
  console.log(`In ${changeable.length} of the ${cells.length} cells the exact parser's best change is another choice than the base's.`)
  console.log(`| twin | of those ${changeable.length} cells: raising the logit of the best change lowers the twin's loss | the twin favours the best change |`)
  console.log('| --- | --- | --- |')
  twins.forEach(({name}, twin) => {
    let lowers = 0, favours = 0
    for (const cell of changeable) {
      const best = bestChanges[placeOfCell.get(cell)!]!.best.choice
      if (gradientOf(twin, cell)[choicesOf(base, cell).indexOf(best)]! < 0) lowers++
      if (favouredBy(twin, cell) === best) favours++
    }
    console.log(`| ${name} | ${lowers} | ${favours} |`)
  })
  console.log('')
  console.log(`Two twins against each other, over the ${cells.length} cells: the cells in which both favour the same choice, the logits whose gradients have the same sign (of the logits where neither gradient is 0), and the mean over the cells of the cosine of the two gradients of a cell.`)
  console.log('| twins | same favoured choice | same sign | mean cosine |')
  console.log('| --- | --- | --- | --- |')
  for (const [left, right] of [[2, 0], [2, 1], [3, 0], [3, 1], [0, 1], [2, 3]] as const) {
    let sameFavoured = 0, sameSign = 0, compared = 0, cosines = 0, cosinesCounted = 0
    for (const cell of cells) {
      if (favouredBy(left, cell) === favouredBy(right, cell)) sameFavoured++
      const leftGradient = gradientOf(left, cell), rightGradient = gradientOf(right, cell)
      for (let place = 0; place < leftGradient.length; place++) {
        if (leftGradient[place] === 0 || rightGradient[place] === 0) continue
        compared++
        if (leftGradient[place]! > 0 === rightGradient[place]! > 0) sameSign++
      }
      const cosine = cosineOf(leftGradient, rightGradient)
      if (!Number.isNaN(cosine)) {
        cosines += cosine
        cosinesCounted++
      }
    }
    console.log(`| ${twins[left]!.name} and ${twins[right]!.name} | ${sameFavoured} of ${cells.length} | ${sameSign} of ${compared} (${(100 * sameSign / compared).toFixed(1)}%) | ${(cosines / cosinesCounted).toFixed(3)} |`)
  }
}
