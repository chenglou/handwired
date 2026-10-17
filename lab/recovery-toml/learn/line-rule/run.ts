// One hand-written rule for the lines, then the recipe's training on every other cell. The rule: after an error, the
// rest of the line is skipped, and the line end starts the next line as a fresh line with no open container.
// README.md says why and what came out.
//
// The cells of the rule, set on the recipe's base (see lineCellsOn below for each of them):
// 1. Tokenizer cells of a line end: in every tokenizer state, an open cell of a line feed gives the event `newline`
//    and leads between tokens, and an open cell of a carriage return gives `newline` and leads into the state
//    `carriageReturn`. They are the cells of the hand-written rule "a line end ends a token" of
//    ../handwritten/rules.ts.
// 2. Grammar cells of a line end: the open cell of the token `newline` leads into the state `lineStart`, at depth 0
//    in every grammar state but `error`, and at depth 1 in every state whose cell leads into `error` today, where
//    the cell also closes the one open container. The hand-written rule "a line end at the top level" names 18 of
//    the cells of depth 0.
// 3. Grammar cells that wait for the line end: at depth 0 and at depth 1, an open cell that leads into the state
//    `error` today stays in its state and changes no depth. Without them the rule does nothing for an error in the
//    middle of a line: the grammar is in the state `error` at the line end, and the whole row of that state is one
//    of the recipe's kept settings, since a valid text with a value of more than 16 levels has to be shown as today.
// A cell can close one container, so an error at depth 2 or more is not covered. With the environment variable
// LINE_RULE_TOP_ONLY=1 the cells of depth 1 are left out: the first form of the rule, which no training ran with.
//
// --waiting-cells says what the training may do with the cells of 3: `fixed` keeps them out of the training as 1 and
// 2 are, and `trainable` sets them in the base and lets the training change them, from the recipe's share of 0.9 on
// the base's choice. The cells of 1 and 2 are kept out of the training and of the search in both.
//
// Every other step is the recipe's, called from ../recipe.ts with its settings: the classes of its rule, its kept
// grammar cells, no events of a text's end, 3 passes, the count, today's kinds in the state `error`, and for the
// second row its search before the count.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-toml/learn/line-rule/run.ts --base --folder <folder>                # the cells and the base's scores, no training
//   bun lab/recovery-toml/learn/line-rule/run.ts --seed 1 --waiting-cells fixed          # the training, the count, and the search
//   bun lab/recovery-toml/learn/line-rule/run.ts --seed 1 --waiting-cells trainable --no-search-after 16:36
// The files go to <RECOVERY_SCRATCH>/runs/line-rule/waiting-cells-<fixed or trainable>/, or to --folder, with the
// names and the record of ../runs/run.ts: row-4.seed-1 is the training then the count, row-5.seed-1 the same with
// the search. So ../runs/check.ts --folder checks them. --no-search-after 16:36 leaves the search out when the
// training ends after that time of the day. --base saves the base's tables as base.tables.json and
// base-with-count.tables.json.
import {existsSync, mkdirSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {displayKind} from '../../kinds.ts'
import {type Samples, codePointKept, codePointKindScored, datasetKey, loadSamples, standardRange, trainPart, validationPart} from '../data.ts'
import {optionOf, refuseUnknownOptions} from '../options.ts'
import {
  baseOfRecipe, cellsOfTooDeepValidTexts, classesChosenFromTrainSamples, describeRow, differencesOnTooDeepTexts, displayEntriesByCount, recipeSettings, ruleOutEndEvents, searchedCellsOf, tooDeepTextsOfTheCheck,
  trainableGrammarCellsOf, withTodaysKindsInErrorState,
} from '../recipe.ts'
import {type RecoveryTrace, createTrace} from '../recovery-parser.ts'
import {
  type RecoveryTables, actionNone, actionPop, asIsTables, cellCounts, classNames, copyTables, differencesOf, eventNames, grammarCellName, grammarCellOf, grammarChoiceName, grammarStateNames, lexerCellName, lexerCellOf,
  lexerChoiceName, lexerStateNames, saveTables, today, tokenNames,
} from '../recovery-tables.ts'
import {type Parser, type RunRecord, parserOfTables, recordFileNameOf, restartAtNextLine, scoreRowsOf, sha256OfFile, sourcesHash, stateOfTheWorktree, tablesFileNameOf} from '../runs/runs.ts'
import {cellCountsOf, wrongLabelsAt} from '../score.ts'
import {prepareSamples} from '../search/sample-runs.ts'
import {searchCells} from '../search/search.ts'
import {train} from '../soft/train.ts'
import {packForTwin, placesForTwin} from '../soft/twin-data.ts'
import {createModel} from '../soft/twin.ts'

export type LineCells = {
  // The recipe's base with the cells of the rule.
  base: RecoveryTables
  // Masks with 1 per cell that the rule names: the tokenizer cells of a line end, the grammar cells of a line end,
  // and the grammar cells that wait for the line end.
  lexerAtLineEnd: Uint8Array
  grammarAtLineEnd: Uint8Array
  grammarWaiting: Uint8Array
  // Per group, the cells that the rule changes, each as "cell: today's choice -> the rule's choice", and how many
  // open cells of the group hold the rule's choice already. Those are named by the rule too, so they are kept out
  // of the training.
  changed: {lexerAtLineEnd: string[], grammarAtLineEnd: string[], grammarWaiting: string[]}
  asToday: {lexerAtLineEnd: number, grammarAtLineEnd: number, grammarWaiting: number}
}

// The contexts of depth 0: without and with the bit "first on its line".
const topContexts = [0, today.contextCount] as const
// The contexts of depth 1, inside an array (2) and inside an inline table (3), without and with the bit.
const depthOneContexts = [2, 3, today.contextCount + 2, today.contextCount + 3] as const
const contextsOfTheRule: readonly number[] = process.env['LINE_RULE_TOP_ONLY'] === '1' ? topContexts : [...topContexts, ...depthOneContexts]
// After a carriage return, a line feed is the second half of the line end, and frozen cells read it.
const statesAfterCarriageReturn = ['carriageReturn', 'multiBasicCarriageReturn', 'multiLiteralCarriageReturn']

// The cells of the rule on the recipe's base. It never names a frozen cell or one of the recipe's kept grammar cells.
export function lineCellsOn(recipeBase: RecoveryTables): LineCells {
  const base = copyTables(recipeBase)
  const kept = cellsOfTooDeepValidTexts(recipeBase)
  const lexerAtLineEnd = new Uint8Array(base.lexerNext.length)
  const grammarAtLineEnd = new Uint8Array(base.grammarNext.length)
  const grammarWaiting = new Uint8Array(base.grammarNext.length)
  const changed = {lexerAtLineEnd: [] as string[], grammarAtLineEnd: [] as string[], grammarWaiting: [] as string[]}
  const asToday = {lexerAtLineEnd: 0, grammarAtLineEnd: 0, grammarWaiting: 0}
  const indexIn = (names: readonly string[], name: string) => {
    const index = names.indexOf(name)
    if (index === -1) throw new Error(`nothing is named ${name}`)
    return index
  }
  // 1. The tokenizer cells of a line end.
  const newlineEvent = indexIn(eventNames, 'newline')
  const lineEnds = [
    {characterClass: indexIn(classNames, 'lineFeed'), next: indexIn(lexerStateNames, 'between')},
    {characterClass: indexIn(classNames, 'carriageReturn'), next: indexIn(lexerStateNames, 'carriageReturn')},
  ]
  lexerStateNames.forEach((stateName, state) => {
    if (statesAfterCarriageReturn.includes(stateName)) return
    for (const {characterClass, next} of lineEnds) {
      const cell = lexerCellOf(base, state, characterClass)
      if (base.lexerOpen[cell] === 0) continue
      lexerAtLineEnd[cell] = 1
      if (base.lexerNext[cell] === next && base.lexerEvent[cell] === newlineEvent) {
        asToday.lexerAtLineEnd++
        continue
      }
      const before = lexerChoiceName(base, cell)
      base.lexerNext[cell] = next
      base.lexerEvent[cell] = newlineEvent
      changed.lexerAtLineEnd.push(`${lexerCellName(base, cell)}: ${before} -> ${lexerChoiceName(base, cell)}`)
    }
  })
  // 2 and 3. The grammar cells at depth 0 and at depth 1.
  const newlineToken = indexIn(tokenNames, 'newline')
  const endToken = indexIn(tokenNames, 'end')
  const lineStart = indexIn(grammarStateNames, 'lineStart')
  for (let state = 0; state < grammarStateNames.length; state++) {
    if (state === today.errorState) continue
    for (let token = 0; token < tokenNames.length; token++) {
      if (token === endToken) continue
      for (const context of contextsOfTheRule) {
        const cell = grammarCellOf(base, state, token, context)
        if (base.grammarOpen[cell] === 0 || kept[cell] === 1) continue
        const atLineEnd = token === newlineToken
        // A cell that waits for the line end is one that gives up the rest of the text today.
        if (!atLineEnd && base.grammarNext[cell] !== today.errorState) continue
        const group = atLineEnd ? 'grammarAtLineEnd' : 'grammarWaiting'
        const next = atLineEnd ? lineStart : state
        // At depth 1 the line end also closes the one open container, so that the next line is at depth 0.
        const action = atLineEnd && context % today.contextCount !== 0 ? actionPop : actionNone
        // A line end at depth 1 that leads on today, e.g. inside an array on several lines, is left alone.
        if (atLineEnd && context % today.contextCount !== 0 && base.grammarNext[cell] !== today.errorState) continue
        ;(atLineEnd ? grammarAtLineEnd : grammarWaiting)[cell] = 1
        if (base.grammarNext[cell] === next && base.grammarAction[cell] === action) {
          asToday[group]++
          continue
        }
        const before = grammarChoiceName(base, cell)
        base.grammarNext[cell] = next
        base.grammarAction[cell] = action
        changed[group].push(`${grammarCellName(base, cell)}: ${before} -> ${grammarChoiceName(base, cell)}`)
      }
    }
  }
  // The rule left the kept cells alone, so a too deep valid text reads the same cells with the new base.
  const keptWithTheRule = cellsOfTooDeepValidTexts(base)
  if (keptWithTheRule.some((bit, cell) => bit !== kept[cell])) throw new Error('the recipe\'s kept cells are not the same with the cells of the line rule')
  return {base, lexerAtLineEnd, grammarAtLineEnd, grammarWaiting, changed, asToday}
}

export type HeaderNames = {codePoints: number, kindRight: number, allRight: number}

// The code points at or after a sample's first error whose label is the name of a header, e.g. the `tls` of `[tls]`
// on a line after the error: how many there are, how many are shown as the name of a header, and how many also have
// their depth and their container right.
export function headerNamesAfterAnError(parser: Parser, samples: Samples): HeaderNames {
  const run = parser(samples)
  const trace: RecoveryTrace = createTrace()
  const result = {codePoints: 0, kindRight: 0, allRight: 0}
  for (let place = 0; place < samples.sampleCount; place++) {
    const firstError = samples.firstErrorPosition[place]!
    if (samples.firstDamage[place] === -1 || firstError === -1) continue
    const start = samples.start[place]!
    const length = samples.start[place + 1]! - start
    run(place, trace)
    for (let position = firstError; position < length; position++) {
      const flags = samples.flags[start + position]!
      if ((flags & codePointKept) === 0 || (flags & codePointKindScored) === 0 || samples.labelKind[start + position] !== displayKind.headerName) continue
      result.codePoints++
      if (trace.displayKind[position] === displayKind.headerName) result.kindRight++
      if (wrongLabelsAt(samples, start + position, trace, position) === 0) result.allRight++
    }
  }
  return result
}

export const describeHeaderNames = (headers: HeaderNames) => `header names after an error: ${(100 * headers.kindRight / headers.codePoints).toFixed(2)}% shown as a header name, ${(100 * headers.allRight / headers.codePoints).toFixed(2)}% with depth and container right too (${headers.codePoints} code points)`

// What a record of this folder holds on top of the record of ../runs/run.ts.
export type LineRuleRecord = RunRecord & {
  waitingCells: 'fixed' | 'trainable'
  lineCells: {changed: LineCells['changed'], asToday: LineCells['asToday'], keptOutOfTheTraining: {tokenizer: number, grammar: number}}
  headerNames: HeaderNames
  sha256OfRunTs: string
}

export const folderOf = (waitingCells: 'fixed' | 'trainable', option?: string) => {
  if (option !== undefined) return option
  const scratch = process.env['RECOVERY_SCRATCH']
  if (scratch === undefined || scratch === '') throw new Error('set RECOVERY_SCRATCH to a folder outside the repo, or name the folder with --folder')
  return join(scratch, 'runs', 'line-rule', `waiting-cells-${waitingCells}`)
}

if (import.meta.main) {
  refuseUnknownOptions('line-rule/run.ts', ['--base', '--seed', '--waiting-cells', '--folder', '--no-search-after', '--again'])
  const waitingCells = optionOf('--waiting-cells') ?? 'fixed'
  if (waitingCells !== 'fixed' && waitingCells !== 'trainable') throw new Error(`--waiting-cells takes fixed or trainable, and got ${waitingCells}`)
  const baseOnly = process.argv.includes('--base')
  const seed = Number(optionOf('--seed') ?? 1)
  if (!Number.isInteger(seed) || seed < 1) throw new Error(`--seed takes a whole number from 1 up, and got ${optionOf('--seed')}`)
  const folder = folderOf(waitingCells, optionOf('--folder'))
  mkdirSync(folder, {recursive: true})
  if (!baseOnly && !process.argv.includes('--again') && existsSync(join(folder, recordFileNameOf(4, seed)))) throw new Error(`${folder} has a record for seed ${seed}. Give --again to run the seed again from nothing.`)

  const commandStarted = performance.now()
  const startedAt = new Date().toISOString()
  const worktree = stateOfTheWorktree()
  const range = standardRange()
  const samples = loadSamples(range.seed, range.from, range.to)
  const trainSamples = trainPart(samples)
  const validation = validationPart(samples)
  const tooDeepTexts = tooDeepTextsOfTheCheck(2000)
  const classes = classesChosenFromTrainSamples(trainSamples)
  const recipeBase = baseOfRecipe(classes)
  const line = lineCellsOn(recipeBase)
  const {base} = line
  const sum = (mask: Uint8Array) => mask.reduce((total, bit) => total + bit, 0)
  const describe = (name: string, tables: RecoveryTables) => {
    console.log(describeRow(name, scoreRowsOf(parserOfTables(tables), validation)[0]!))
    console.log(`  ${describeHeaderNames(headerNamesAfterAnError(parserOfTables(tables), validation))}`)
    const tooDeep = differencesOnTooDeepTexts(tables, tooDeepTexts)
    console.log(`  too deep valid texts, ${tooDeep.codePoints} code points from the first error on: ${tooDeep.state} other grammar states, ${tooDeep.nesting} other depths or containers, ${tooDeep.kind} other display kinds, ${tooDeep.openTokenizerCells} open tokenizer cells read`)
  }
  console.log(`Dataset ${datasetKey()}: ${trainSamples.sampleCount} train samples, ${validation.sampleCount} validation samples. Commit ${worktree.commit}. The rule of the classes picks ${classes.length}.`)
  console.log(`The line rule names ${sum(line.lexerAtLineEnd)} tokenizer cells of a line end (${line.changed.lexerAtLineEnd.length} changed, ${line.asToday.lexerAtLineEnd} as today), ${sum(line.grammarAtLineEnd)} grammar cells of a line end (${line.changed.grammarAtLineEnd.length} changed, ${line.asToday.grammarAtLineEnd} as today) and ${sum(line.grammarWaiting)} grammar cells that wait for the line end (${line.changed.grammarWaiting.length} changed).`)

  if (baseOnly) {
    for (const group of ['lexerAtLineEnd', 'grammarAtLineEnd', 'grammarWaiting'] as const) {
      console.log(`\n${group}, ${line.changed[group].length} cells changed:`)
      for (const name of line.changed[group]) console.log(`  ${name}`)
    }
    console.log('')
    console.log(describeRow('The parser as it is', scoreRowsOf(parserOfTables(asIsTables()), validation)[0]!))
    console.log(`  ${describeHeaderNames(headerNamesAfterAnError(parserOfTables(asIsTables()), validation))}`)
    console.log(describeRow('The one rule, anew at the next line after an error', scoreRowsOf(restartAtNextLine, validation)[0]!))
    console.log(`  ${describeHeaderNames(headerNamesAfterAnError(restartAtNextLine, validation))}`)
    // The base with the cells of a line end alone, to show what the waiting cells are for.
    const withoutWaiting = copyTables(base)
    for (let cell = 0; cell < withoutWaiting.grammarNext.length; cell++) {
      if (line.grammarWaiting[cell] !== 1) continue
      withoutWaiting.grammarNext[cell] = recipeBase.grammarNext[cell]!
      withoutWaiting.grammarAction[cell] = recipeBase.grammarAction[cell]!
    }
    describe('The base with the cells of a line end alone, no training', withoutWaiting)
    describe('The base with every cell of the line rule, no training', base)
    describe('The same with the count and today\'s kinds in the state error', withTodaysKindsInErrorState(displayEntriesByCount(base, trainSamples)))
    saveTables(join(folder, 'base.tables.json'), base, 'the recipe\'s base with the cells of the line rule, no training')
    saveTables(join(folder, 'base-with-count.tables.json'), withTodaysKindsInErrorState(displayEntriesByCount(base, trainSamples)), 'the recipe\'s base with the cells of the line rule, the count, today\'s kinds in the state error, no training')
    console.log(`Saved base.tables.json and base-with-count.tables.json to ${folder}.`)
  } else {
    // The cells that the training and the search may not change: the recipe's own, the cells of a line end, and with
    // --waiting-cells fixed the cells that wait for the line end.
    const fixedGrammar = line.grammarAtLineEnd.map((bit, cell) => bit === 1 || (waitingCells === 'fixed' && line.grammarWaiting[cell] === 1) ? 1 : 0)
    const trainableLexer = base.lexerOpen.map((open, cell) => open === 1 && line.lexerAtLineEnd[cell] === 0 ? 1 : 0)
    const trainableGrammar = trainableGrammarCellsOf(base).map((bit, cell) => bit === 1 && fixedGrammar[cell] === 0 ? 1 : 0)
    const keptGrammarCells = cellCounts(base).grammarOpen - sum(trainableGrammarCellsOf(base))
    const model = createModel(base, {start: 'base', startShare: recipeSettings.startShare, trainable: {lexer: trainableLexer, grammar: trainableGrammar, display: 'open'}})
    ruleOutEndEvents(model)
    const data = packForTwin(samples, placesForTwin(samples, 'train'), base)
    console.log(`Seed ${seed}, waiting cells ${waitingCells}: ${sum(trainableLexer)} trainable tokenizer cells of ${sum(base.lexerOpen)} open ones, ${sum(trainableGrammar)} trainable grammar cells of ${cellCounts(base).grammarOpen} open ones (${keptGrammarCells} kept by the recipe, ${sum(fixedGrammar)} by the line rule). Training on ${data.sampleCount} train samples.`)
    let started = performance.now()
    const trainResult = await train(model, data, {
      seed, epochs: recipeSettings.passes, batchSize: recipeSettings.batchSize, learningRate: recipeSettings.learningRate, temperatureStart: recipeSettings.temperature, temperatureEnd: recipeSettings.temperature,
      sharpnessCost: recipeSettings.sharpnessCost, logEverySamples: 1e9, log: () => {},
    })
    const trainingSeconds = (performance.now() - started) / 1000
    const trained = trainResult.last
    console.log(`The training took ${trainingSeconds.toFixed(0)} s and changed ${differencesOf(base, trained).length} cells. ${new Date().toTimeString().slice(0, 8)}`)
    for (let cell = 0; cell < trained.lexerNext.length; cell++) if (trainableLexer[cell] === 0 && (trained.lexerNext[cell] !== base.lexerNext[cell] || trained.lexerEvent[cell] !== base.lexerEvent[cell])) throw new Error('the training changed a tokenizer cell that it may not change')
    for (let cell = 0; cell < trained.grammarNext.length; cell++) if (trainableGrammar[cell] === 0 && (trained.grammarNext[cell] !== base.grammarNext[cell] || trained.grammarAction[cell] !== base.grammarAction[cell])) throw new Error('the training changed a grammar cell that it may not change')

    const stepsOfTheBase = [`today's tables with the classes that the rule picks from the train samples, open display entries and the bit "first on its line"`, `the line rule: ${sum(line.lexerAtLineEnd)} tokenizer cells and ${sum(line.grammarAtLineEnd)} grammar cells of a line end, kept out of the training and the search, and ${sum(line.grammarWaiting)} grammar cells that wait for the line end, ${waitingCells === 'fixed' ? 'kept out too' : 'which the training and the search may change'}`]
    const stepOfTheTraining = `the training: ${recipeSettings.passes} passes over the train samples in batches of ${recipeSettings.batchSize}, learning rate ${recipeSettings.learningRate}, from a share of ${recipeSettings.startShare} on the base's choice, with the kept grammar cells and without the events of a text's end`
    const stepOfTheSearch = `the search: at most ${recipeSettings.searchPasses} passes over every open tokenizer cell and every grammar cell that is not kept, in a random order per pass`
    const stepOfTheCount = 'the count: every open display entry gets the kind that the most train code points want there'
    const lastStep = 'today\'s kinds in the display entries of the grammar state error'
    const save = (row: 4 | 5, tables: RecoveryTables, steps: string[], search: RunRecord['search'], searchSeconds: number) => {
      const tablesFile = join(folder, tablesFileNameOf(row, seed))
      const rowName = row === 4 ? 'the line rule, the training, the count, today\'s kinds in the state error' : 'the line rule, the training, the search, the count, today\'s kinds in the state error'
      saveTables(tablesFile, tables, `line rule with waiting cells ${waitingCells}, seed ${seed}: ${rowName}`)
      const validationRows = scoreRowsOf(parserOfTables(tables), validation)
      const cells = cellCountsOf(tables, base)
      const record: LineRuleRecord = {
        format: 'recovery-toml run record 1', row, rowName, seed,
        trainedOn: {datasetSeed: range.seed, from: range.from, to: range.to, trainSamples: trainSamples.sampleCount, validationSamples: validation.sampleCount},
        datasetKey: datasetKey(), commit: worktree.commit, uncommittedFiles: worktree.uncommittedFiles, sourcesHash: sourcesHash(),
        startedAt, finishedAt: new Date().toISOString(),
        seconds: {training: trainingSeconds, search: searchSeconds, command: (performance.now() - commandStarted) / 1000},
        settings: {...recipeSettings, orderSeedOfTheSearch: seed * 10 + recipeSettings.searchOrder, workerThreads: 4},
        steps, classes: classes.map(added => added.name), keptGrammarCells, search,
        tablesFile: tablesFileNameOf(row, seed), sha256: sha256OfFile(tablesFile),
        validation: validationRows, train: scoreRowsOf(parserOfTables(tables), trainSamples, 'train')[0]!,
        nextTo: {name: 'the tables after the training alone', validation: scoreRowsOf(parserOfTables(trained), validation)[0]!},
        tooDeepValidTexts: {texts: tooDeepTexts.length, ...differencesOnTooDeepTexts(tables, tooDeepTexts)},
        cellsChangedAgainstBase: cells.changedAgainstBase!, cellsThatDifferFromToday: cells.differFromToday,
        waitingCells, lineCells: {changed: line.changed, asToday: line.asToday, keptOutOfTheTraining: {tokenizer: sum(line.lexerAtLineEnd), grammar: sum(fixedGrammar)}},
        headerNames: headerNamesAfterAnError(parserOfTables(tables), validation), sha256OfRunTs: sha256OfFile(import.meta.path),
      }
      writeFileSync(join(folder, recordFileNameOf(row, seed)), `${JSON.stringify(record, null, 1)}\n`)
      describe(`Seed ${seed}, waiting cells ${waitingCells}, ${rowName}`, tables)
      console.log(`  Saved ${tablesFile}, sha256 ${record.sha256}. ${new Date().toTimeString().slice(0, 8)}`)
    }
    save(4, withTodaysKindsInErrorState(displayEntriesByCount(trained, trainSamples)), [...stepsOfTheBase, stepOfTheTraining, stepOfTheCount, lastStep], null, 0)

    // The search, unless the clock is past --no-search-after, e.g. 16:36.
    const noSearchAfter = optionOf('--no-search-after')
    const now = new Date().toTimeString().slice(0, 5)
    if (noSearchAfter !== undefined && now > noSearchAfter) {
      console.log(`It is ${now}, past ${noSearchAfter}: the search is not run.`)
    } else {
      const searched = searchedCellsOf(base).filter(({grammar, cell}) => grammar ? fixedGrammar[cell] === 0 : line.lexerAtLineEnd[cell] === 0)
      started = performance.now()
      const found = await searchCells(trained, searched, prepareSamples(trainSamples, base), seed * 10 + recipeSettings.searchOrder, recipeSettings.searchPasses)
      const searchSeconds = (performance.now() - started) / 1000
      console.log(`The search over ${searched.length} cells took ${searchSeconds.toFixed(0)} s: ${found.passes} passes, ${found.changes} changes of a cell, ${(found.runs / 1e6).toFixed(1)} million runs of a sample.`)
      save(5, withTodaysKindsInErrorState(displayEntriesByCount(found.tables, trainSamples)), [...stepsOfTheBase, stepOfTheTraining, stepOfTheSearch, stepOfTheCount, lastStep], {passes: found.passes, lastPassChangedNothing: found.lastPassChangedNothing, changes: found.changes, runs: found.runs}, searchSeconds)
    }
  }
}
