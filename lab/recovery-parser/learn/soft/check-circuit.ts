// Checks that one step of the twin is a program that Handwired can express: step-circuit.ts builds the step with the
// repo's runtime, and on random mixes the circuit's values and its gradients from backpropagateReference have to be
// the values and gradients of twin.ts.
//
// Run from the repo root:
//   bun lab/recovery-parser/learn/soft/check-circuit.ts [trials, default 6]
//
// The circuit has the full size: 26 tokenizer states, 33 classes, 8 grammar states, the depths -8 to 24. Per trial,
// every cell's mixes and the state before the step are random, the class is a random one, and every output gets a
// random gradient. The circuit computes in 32-bit floats and the twin in 64-bit floats on the same inputs, so they
// agree to the accuracy of 32-bit floats: the check allows a difference of 1e-4 times the larger of 1 and the value.
//
// Then the same for the step of tables with added structure, see ../structure/README.md: with added classes, an
// added grammar state, open entries of the display table, whose mixes are random too, and the bit "first on its
// line", which is a random share. The first trial of that step is at a line feed, which sets the bit.
import {createRandom} from '../../random.ts'
import {defaultSeed} from '../../samples.ts'
import {capacity, maximumDepth} from '../recovery-parser.ts'
import {classesOfTheChecks} from '../check-texts.ts'
import {refuseUnknownOptions} from '../data.ts'
import {type RecoveryTables, actionCount, actionNone, addClasses, addFirstOnLineBit, addStates, asIsTables, className, classNames, grammarStateNames, openDisplayEntries} from '../recovery-tables.ts'
import {buildStepCircuit} from './step-circuit.ts'
import {createCellArrays, createTwinRunner, defaultDepthHigh, defaultDepthLow, groupNames, groupWidths, shapeOf} from './twin.ts'

refuseUnknownOptions('soft/check-circuit.ts', [])
const trials = Number(process.argv[2] ?? 6)
const tolerance = 1e-4
let failures = 0
// The largest differences of the steps since the last summary line.
let worst = {value: 0, gradient: 0}
const summary = (steps: string) => {
  console.log(`${steps}: the largest difference of a value is ${worst.value.toExponential(2)} and of a gradient ${worst.gradient.toExponential(2)}.`)
  worst = {value: 0, gradient: 0}
}

// `firstClass` is the class of the first trial's code point. The other trials, and all without it, draw a class.
function checkStep(name: string, tables: RecoveryTables, readsObjects: boolean, trialCount: number, seedOffset: number, firstClass?: number) {
  const shape = shapeOf(tables)
  const widths = groupWidths(shape)
  const buildStarted = performance.now()
  const built = buildStepCircuit(shape, defaultDepthLow, defaultDepthHigh, readsObjects)
  const {circuit, sources, outputs, depthCount} = built
  const reglus = circuit.operations.filter(operation => operation.kind === 'reglu').length
  // The four groups of the cells' mixes, and the display table's when the shape has open entries.
  const groups = groupNames.filter(group => group !== 'display' || shape.displayMixed.includes(1))
  console.log(`The step ${name}${readsObjects ? 'at a code point' : 'at position 512, which reads no object'}: ${built.sourceSize} source cells and ${circuit.operations.length} operations, `
    + `${reglus} of them products and ${circuit.operations.length - reglus} sums, ${Math.max(...circuit.depths)} operations deep. Built in ${((performance.now() - buildStarted) / 1000).toFixed(1)} s.`)
  // The twin runs the step at position 0, or at position 512 for the step that reads no object.
  const position = readsObjects ? 0 : capacity
  const runner = createTwinRunner(shape)
  const mixes = createCellArrays(shape)
  const gradients = createCellArrays(shape)
  runner.setMixes(mixes)

  for (let trial = 0; trial < trialCount; trial++) {
    const random = createRandom(defaultSeed + seedOffset, trial)
    const sourceValues = new Float32Array(built.sourceSize)
    // Random shares that add up to 1, some of them exactly 0 in every other trial.
    const randomMix = (first: number, count: number) => {
      let total = 0
      for (let entry = 0; entry < count; entry++) {
        const share = trial % 2 === 1 && random.chance(0.4) ? 0 : random.next() ** 3
        sourceValues[first + entry] = share
        total += share
      }
      if (total === 0) {
        sourceValues[first] = 1
        total = 1
      }
      for (let entry = 0; entry < count; entry++) sourceValues[first + entry] = sourceValues[first + entry]! / total
    }
    randomMix(sources.lexerBefore, shape.lexerStateCount)
    randomMix(sources.grammarBefore, shape.grammarStateCount)
    randomMix(sources.depthBefore, depthCount)
    for (let level = 0; level < maximumDepth; level++) sourceValues[sources.objectsBefore + level] = random.next()
    const drawnClass = random.integer(0, shape.classCount - 1)
    const characterClass = trial === 0 && firstClass !== undefined ? firstClass : drawnClass
    sourceValues[sources.characterClass + characterClass] = 1
    const hasFirstOnLine = outputs.firstOnLineAfter.length > 0
    if (hasFirstOnLine) sourceValues[sources.firstOnLineBefore] = random.next()
    for (const group of groups) {
      const cells = group === 'display' ? shape.displayEntries : group === 'lexerNext' || group === 'lexerEvent' ? shape.lexerCells : shape.grammarCells
      for (let cell = 0; cell < cells; cell++) randomMix(sources[group] + cell * widths[group], widths[group])
    }

    // The twin on the same numbers.
    const base = {lexer: position * shape.lexerStateCount, grammar: position * shape.grammarStateCount, depth: position * depthCount, objects: position * (maximumDepth + 1), event: position * shape.eventCount,
      token: position * shape.tokenCount, context: position * shape.contextCount, action: position * actionCount, kind: position * shape.displayKindCount, container: position * 3}
    for (const group of groups) mixes[group].set(sourceValues.subarray(sources[group], sources[group] + mixes[group].length))
    for (let state = 0; state < shape.lexerStateCount; state++) runner.lexerBefore[base.lexer + state] = sourceValues[sources.lexerBefore + state]!
    for (let state = 0; state < shape.grammarStateCount; state++) runner.grammarBefore[base.grammar + state] = sourceValues[sources.grammarBefore + state]!
    for (let index = 0; index < depthCount; index++) runner.depthBefore[base.depth + index] = sourceValues[sources.depthBefore + index]!
    for (let level = 1; level <= maximumDepth; level++) runner.objectsBefore[base.objects + level] = sourceValues[sources.objectsBefore + level - 1]!
    if (hasFirstOnLine) runner.firstOnLineBefore[position] = sourceValues[sources.firstOnLineBefore]!
    runner.stepForward(position, characterClass)

    // Values.
    const values = circuit.evaluateReference(sourceValues)
    let compared = 0
    let trialValue = 0
    const compareValue = (name: string, wire: number, twinValue: number) => {
      compared++
      const difference = Math.abs(values[wire]! - twinValue)
      trialValue = Math.max(trialValue, difference)
      if (!(difference <= tolerance * Math.max(1, Math.abs(twinValue)))) {
        failures++
        if (failures <= 20) console.log(`FAILED: trial ${trial}, ${name}: the circuit has ${values[wire]}, and the twin ${twinValue}`)
      }
    }
    outputs.events.forEach((wire, entry) => compareValue(`event ${entry}`, wire, runner.events[base.event + entry]!))
    outputs.tokens.forEach((wire, entry) => compareValue(`token ${entry}`, wire, runner.tokens[base.token + entry]!))
    outputs.contexts.forEach((wire, entry) => compareValue(`context ${entry}`, wire, runner.contexts[base.context + entry]!))
    outputs.lexerAfter.forEach((wire, entry) => compareValue(`tokenizer state after ${entry}`, wire, runner.lexerAfter[base.lexer + entry]!))
    outputs.grammarAfter.forEach((wire, entry) => compareValue(`grammar state after ${entry}`, wire, runner.grammarAfter[base.grammar + entry]!))
    outputs.actions.forEach((wire, entry) => compareValue(`stack action ${entry + actionNone}`, wire, runner.actions[base.action + entry + actionNone]!))
    outputs.depthAfter.forEach((wire, entry) => compareValue(`depth after ${entry}`, wire, runner.depthAfter[base.depth + entry]!))
    outputs.objectsAfter.forEach((wire, entry) => compareValue(`level ${entry + 1} after`, wire, runner.objectsAfter[base.objects + entry + 1]!))
    outputs.firstOnLineAfter.forEach(wire => compareValue('the bit "first on its line" after', wire, runner.firstOnLineAfter[position]!))
    outputs.kinds.forEach((wire, entry) => compareValue(`display kind ${entry}`, wire, runner.kinds[base.kind + entry]!))
    outputs.containers.forEach((wire, entry) => compareValue(`container ${entry}`, wire, runner.containers[base.container + entry]!))

    // Gradients: a random gradient from -1 to 1 by every output that the twin's backward pass starts from.
    const seeds = new Float32Array(values.length)
    runner.clearStateGradients()
    runner.clearOutputGradients()
    const seed = (wire: number) => {
      const gradient = Math.fround(2 * random.next() - 1)
      seeds[wire] = gradient
      return gradient
    }
    const stateSeeds = runner.stateGradients()
    const outputSeeds = runner.outputGradients()
    outputs.events.forEach((wire, entry) => { outputSeeds.events[entry] = seed(wire) })
    outputs.kinds.forEach((wire, entry) => { outputSeeds.kinds[entry] = seed(wire) })
    outputs.containers.forEach((wire, entry) => { outputSeeds.containers[entry] = seed(wire) })
    outputs.lexerAfter.forEach((wire, entry) => { stateSeeds.lexer[entry] = seed(wire) })
    outputs.grammarAfter.forEach((wire, entry) => { stateSeeds.grammar[entry] = seed(wire) })
    outputs.depthAfter.forEach((wire, entry) => { stateSeeds.depth[entry] = seed(wire) })
    outputs.objectsAfter.forEach((wire, entry) => { stateSeeds.objects[entry + 1] = seed(wire) })
    outputs.firstOnLineAfter.forEach(wire => { stateSeeds.firstOnLine[0] = seed(wire) })
    gradients.all.fill(0)
    runner.stepBackward(position, characterClass, gradients)
    const circuitGradients = circuit.backpropagateReference(values, seeds)
    const twinGradients = runner.stateGradients()
    let comparedGradients = 0
    let notZero = 0
    let trialGradient = 0
    const compareGradient = (name: string, sourceCell: number, twinGradient: number) => {
      comparedGradients++
      if (twinGradient !== 0) notZero++
      const difference = Math.abs(circuitGradients[sourceCell]! - twinGradient) / Math.max(1, Math.abs(twinGradient))
      trialGradient = Math.max(trialGradient, difference)
      if (!(difference <= tolerance)) {
        failures++
        if (failures <= 20) console.log(`FAILED: trial ${trial}, the gradient by ${name}: the circuit has ${circuitGradients[sourceCell]}, and the twin ${twinGradient}`)
      }
    }
    for (const group of groups) {
      const twinGroup = gradients[group]
      for (let entry = 0; entry < twinGroup.length; entry++) compareGradient(`${group} ${entry}`, sources[group] + entry, twinGroup[entry]!)
    }
    for (let state = 0; state < shape.lexerStateCount; state++) compareGradient(`the tokenizer state before ${state}`, sources.lexerBefore + state, twinGradients.lexer[state]!)
    for (let state = 0; state < shape.grammarStateCount; state++) compareGradient(`the grammar state before ${state}`, sources.grammarBefore + state, twinGradients.grammar[state]!)
    for (let index = 0; index < depthCount; index++) compareGradient(`the depth before ${index}`, sources.depthBefore + index, twinGradients.depth[index]!)
    for (let level = 1; level <= maximumDepth; level++) compareGradient(`level ${level} before`, sources.objectsBefore + level - 1, twinGradients.objects[level]!)
    if (hasFirstOnLine) compareGradient('the bit "first on its line" before', sources.firstOnLineBefore, twinGradients.firstOnLine[0]!)
    worst.value = Math.max(worst.value, trialValue)
    worst.gradient = Math.max(worst.gradient, trialGradient)
    console.log(`  trial ${trial}, class ${className(tables, characterClass)}: ${compared} values, the largest difference ${trialValue.toExponential(2)}. ${comparedGradients} gradients, ${notZero} of them not 0, the largest difference ${trialGradient.toExponential(2)} of the larger of 1 and the gradient.`)
  }
}

checkStep('', asIsTables(), true, trials, 200)
checkStep('', asIsTables(), false, 2, 300)
summary('The step of today\'s tables')
const withStructure = addFirstOnLineBit(openDisplayEntries(addStates(addClasses(asIsTables(), classesOfTheChecks), 0, [grammarStateNames.indexOf('colon')])))
const structureName = `of tables with ${classesOfTheChecks.length} added classes, an added grammar state, open entries of the display table and the bit "first on its line", `
checkStep(structureName, withStructure, true, 3, 400, classNames.indexOf('lineFeed'))
checkStep(structureName, withStructure, false, 1, 500)
summary('The step with added structure')
// The last line says whether the check passed, as in every check of learn/.
if (failures > 0) {
  console.log(`A difference above ${tolerance} counts as a failure.`)
  console.log(`${failures} checks FAILED.`)
  process.exitCode = 1
} else {
  console.log(`Every value and every gradient of the circuit is the twin's within ${tolerance}.`)
  console.log('Every check passed.')
}
