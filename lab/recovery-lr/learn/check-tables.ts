// Checks what recovery-tables.ts says about the tables:
// 1. The sizes: open cells, choices per cell, display entries, for the base and for each addition.
// 2. Every choice of every list can be applied, and leaves the stack a path of the automaton whatever lies below
//    the state: the check goes through every state that can lie below, by the automaton's transitions.
// 3. The base is the parser as it is, and the additions start as copies: the flag's second copy, an added
//    terminal's column, in either order of the two.
// 4. checkTables refuses what breaks the ground rules: every frozen cell and every frozen display entry changed,
//    a choice that is not in a cell's list, a file of another grammar. And it takes every choice of every list.
// 5. Tables are the same after saving and loading.
// 6. Every cell and every choice has words, and two choices of one cell never have the same words.
//
// Run from the repo root: bun lab/recovery-lr/learn/check-tables.ts
import {displayKind, displayKindCount, displayOfState} from '../labels.ts'
import {createRandom} from '../random.ts'
import {actionAccept, actionError, actionReduce, actionShift, itemDot, itemRule} from '../tables.ts'
import {
  type RecoveryTables, addFirstOnLineFlag, addTerminals, argumentOfChoice, badCharacter, baseTables, bison, bisonTerminalCount, cellCounts, cellName, cellOf, changeableCellsOf, choiceOf, choicePop, choiceSkip,
  choiceStop, choicesOf, copyTables, differencesOf, droppedOfEndEarly, effectOf, endEarlyOf, endOfInput, insertOf, isTextTerminal, keptCellsOf, kindAccept, kindEndEarly, kindInsert, kindOfChoice, kindPop,
  kindReadAs, kindReduce, kindShift, kindSkip, kindStop, nonterminalOfEndEarly, problemsOf, randomizeOpenCells, readAs, reduceBy, stateCount, stateOfCell, stopped, tablesFromJson, tablesToJson,
  terminalOfCell, withoutEndEarly,
} from './recovery-tables.ts'
import {cellInWords, choiceInWords, displayEntryInWords, stateInWords, terminalInWords} from './words.ts'

const problems: string[] = []
const problem = (text: string) => {
  problems.push(text)
  if (problems.length <= 30) console.log(`PROBLEM: ${text}`)
}
const expect = (holds: boolean, text: () => string) => {
  if (!holds) problem(text())
}
const ampersand = {name: 'ampersand', codePoint: 0x26}, bar = {name: 'bar', codePoint: 0x7c}
const sameTables = (left: RecoveryTables, right: RecoveryTables): boolean => tablesToJson(left) === tablesToJson(right)

// 1. The sizes.
{
  const base = baseTables()
  const counts = cellCounts(base)
  const stated = {cells: 3800, frozenCells: 1391, openCells: 2409, openCellsOfStopped: 38, keptCells: 58, changeableCells: 2351, choices: 39_082, fewestChoices: 2, mostChoices: 37, displayEntries: 3800, frozenDisplayEntries: 52, openDisplayEntries: 3748}
  for (const name of Object.keys(stated) as (keyof typeof stated)[]) expect(counts[name] === stated[name], () => `the base's ${name} is ${counts[name]}, and the README states ${stated[name]}`)
  expect(counts.openCells === bison.sizes.openCells + counts.openCellsOfStopped && counts.frozenCells === bison.sizes.frozenCells, () => 'the open cells are not the grammar\'s open cells and the row of the state stopped')
  let stops = 0, defaultReductions = 0, skips = 0
  for (let cell = 0; cell < base.choice.length; cell++) {
    if (base.open[cell] !== 1) continue
    const kind = kindOfChoice(base.choice[cell]!)
    if (kind === kindStop) stops++
    else if (kind === kindReduce) defaultReductions++
    else if (kind === kindSkip) skips++
    else problem(`the base holds ${base.choice[cell]} in the open cell ${cellName(base, cell)}`)
  }
  // The final state's 38 cells hold bison's default reduction by rule 0, which is no choice: they hold stop.
  expect(stops === bison.sizes.openErrors + 38 && defaultReductions === bison.sizes.openDefaultReductions - 38 && skips === 38, () => `the base holds stop in ${stops} open cells, a default reduction in ${defaultReductions} and skip in ${skips}`)
  const withoutEnd = cellCounts(withoutEndEarly(base)), flagged = cellCounts(addFirstOnLineFlag(base)), withTerminals = cellCounts(addTerminals(base, [ampersand, bar]))
  expect(withoutEnd.choices === 37_031 && withoutEnd.changeableCells === counts.changeableCells, () => `without "end an item early" the lists hold ${withoutEnd.choices} choices`)
  expect(flagged.openCells === 2 * counts.openCells && flagged.frozenCells === 2 * counts.frozenCells && flagged.choices === 2 * counts.choices && flagged.displayEntries === counts.displayEntries, () => 'the flag does not double the cells, or doubles the display table')
  expect(withTerminals.openCells === counts.openCells + 2 * stateCount && withTerminals.frozenCells === counts.frozenCells && withTerminals.openDisplayEntries === counts.openDisplayEntries + 2 * stateCount, () => 'an added terminal does not add one open cell and one open display entry per state')
  console.log(`1. ${counts.cells} cells of ${stateCount} states and ${bison.sizes.textTerminals} terminals: ${counts.frozenCells} frozen, ${counts.openCells} open (${bison.sizes.openCells} of the grammar's table and ${counts.openCellsOfStopped} of the state stopped). ${counts.keptCells} open cells are the end of input's, and the other ${counts.changeableCells} hold ${counts.choices} choices, ${(counts.choices / counts.changeableCells).toFixed(1)} per cell, from ${counts.fewestChoices} to ${counts.mostChoices}; without "end an item early" ${withoutEnd.choices}, ${(withoutEnd.choices / withoutEnd.changeableCells).toFixed(1)} per cell.`)
  console.log(`   The base holds stop in ${stops} open cells, bison's default reduction in ${defaultReductions} and skip in the ${skips} of the state stopped. The display table has ${counts.displayEntries} entries, ${counts.frozenDisplayEntries} frozen and ${counts.openDisplayEntries} open. The flag doubles the cells, and an added terminal adds ${stateCount} open cells and ${stateCount} open display entries.`)
}

// 2. Every choice can be applied, and keeps the stack a path of the automaton.
{
  // The states from which a transition leads into a state.
  const statesBelow: number[][] = Array.from({length: bison.stateCount}, () => [])
  for (let state = 0; state < bison.stateCount; state++) {
    for (let symbol = 0; symbol < bison.symbolCount; symbol++) {
      const target = bison.transition[state * bison.symbolCount + symbol]!
      if (target !== -1 && !statesBelow[target]!.includes(state)) statesBelow[target]!.push(state)
    }
  }
  // The states that can be on top after `dropped` states are dropped from a stack with `state` on top.
  const below = (state: number, dropped: number): number[] => {
    let states = [state]
    for (let level = 0; level < dropped; level++) states = [...new Set(states.flatMap(at => statesBelow[at]!))]
    return states
  }
  let choices = 0, gotosRead = 0
  for (const tables of [baseTables(), withoutEndEarly(baseTables())]) {
    for (let cell = 0; cell < tables.choice.length; cell++) {
      if (tables.open[cell] !== 1) continue
      const state = stateOfCell(tables, cell), terminal = terminalOfCell(tables, cell)
      const list = choicesOf(tables, cell)
      expect(new Set(list).size === list.length && list.includes(tables.choice[cell]!), () => `the list of ${cellName(tables, cell)} holds a choice twice, or not the base's choice`)
      for (const choice of list) {
        choices++
        const kind = kindOfChoice(choice), argument = argumentOfChoice(choice)
        const effect = effectOf(choice, state)
        if (state === stopped) {
          expect(choice === choiceSkip || choice === choicePop, () => `the state stopped has the choice ${choice}`)
          continue
        }
        if (kind === kindStop) expect(effect.pushedState === stopped && !effect.takesToken, () => 'stop does not enter the state stopped')
        else if (kind === kindSkip) expect(terminal !== endOfInput && effect.takesToken && effect.dropped === 0 && effect.pushedState === -1, () => `${cellName(tables, cell)} has a skip that it cannot have`)
        else if (kind === kindPop) expect(state !== bison.startState && effect.dropped === 1, () => `${cellName(tables, cell)} pops the start state`)
        else if (kind === kindReduce || kind === kindEndEarly) {
          if (kind === kindReduce) expect(argument !== 0 && bison.completeRules[state]!.includes(argument) && effect.dropped === bison.ruleLength[argument] && effect.gotoNonterminal === bison.ruleLhs[argument], () => `${cellName(tables, cell)} reduces by a rule that is not complete in its state`)
          else {
            const items = bison.stateKernel[state]!.filter(kernelItem => itemDot(kernelItem) === droppedOfEndEarly(choice) && bison.ruleLhs[itemRule(kernelItem)] === nonterminalOfEndEarly(choice))
            // The item is in the kernel, has symbols on both sides of its dot, and does what no reduction of the list does.
            expect(tables.endEarly && items.length > 0 && items.every(item => itemDot(item) > 0 && itemDot(item) < bison.ruleRhs[itemRule(item)]!.length) && effect.dropped === droppedOfEndEarly(choice), () => `${cellName(tables, cell)} ends an item early that its kernel does not have, or that is a reduction`)
          }
          // Whatever lies below: the state that is on top after the drop has a goto for the nonterminal.
          for (const stateBelow of below(state, effect.dropped)) {
            gotosRead++
            expect(bison.gotoState[stateBelow * bison.nonterminalCount + effect.gotoNonterminal - bisonTerminalCount] !== -1, () => `${cellName(tables, cell)}, choice ${choice}: no goto from state ${stateBelow}`)
          }
        } else if (kind === kindInsert || kind === kindReadAs) {
          expect(argument !== endOfInput && argument < bisonTerminalCount && effect.pushedState === bison.transition[state * bison.symbolCount + argument] && effect.pushedState !== -1 && effect.pushedState !== bison.finalState, () => `${cellName(tables, cell)} inserts or reads as a terminal that its state does not shift`)
          expect(effect.takesToken === (kind === kindReadAs) && (kind !== kindReadAs || terminal !== endOfInput), () => `${cellName(tables, cell)} reads the end of input as a terminal`)
        } else problem(`${cellName(tables, cell)} has the choice ${choice} of a kind that no open cell has`)
      }
    }
  }
  console.log(`2. ${choices} choices of the open cells, with and without "end an item early": each can be applied in its state, and each reduction and each item ended early finds a goto from every state that can lie below, ${gotosRead} gotos.`)
}

// 3. The base and the additions.
{
  const base = baseTables()
  expect(problemsOf(base).length === 0, () => `the base breaks the ground rules: ${problemsOf(base)[0]}`)
  let frozenChecked = 0
  for (let state = 0; state < bison.stateCount; state++) {
    for (let terminal = 0; terminal < bisonTerminalCount; terminal++) {
      if (!isTextTerminal(terminal)) continue
      const bisonCell = state * bisonTerminalCount + terminal
      const choice = base.choice[cellOf(base, state, terminal)]!
      const kind = bison.actionKind[bisonCell]!, argument = bison.actionArgument[bisonCell]!
      // What bison does in the cell, frozen or open. Rule 0 is the final state's, which holds stop.
      const expected = kind === actionShift ? choiceOf(kindShift, argument) : kind === actionAccept ? choiceOf(kindAccept) : kind === actionReduce && argument !== 0 ? reduceBy(argument) : choiceStop
      expect(choice === expected && (kind !== actionError || choice === choiceStop), () => `the base holds ${choice} in ${cellName(base, cellOf(base, state, terminal))}, and bison's action is ${kind} ${argument}`)
      expect(base.open[cellOf(base, state, terminal)] === 1 - bison.frozen[bisonCell]!, () => `the cell ${cellName(base, cellOf(base, state, terminal))} is open where the grammar's table is frozen, or the other way round`)
      if (bison.frozen[bisonCell] === 1) frozenChecked++
      const entry = cellOf(base, state, terminal)
      const shiftReadsEntry = displayOfState[state] !== -1 && bison.accessingSymbol[state] === terminal
      expect(base.displayOpen[entry] === (shiftReadsEntry ? 0 : 1) && base.display[entry] === (shiftReadsEntry ? displayOfState[state] : displayKind.error), () => `the display entry of state ${state} and terminal ${terminal}`)
    }
  }
  // Every frozen shift reads a frozen display entry.
  for (let cell = 0; cell < base.choice.length; cell++) {
    if (kindOfChoice(base.choice[cell]!) !== kindShift) continue
    expect(base.displayOpen[argumentOfChoice(base.choice[cell]!) * base.terminalCount + terminalOfCell(base, cell)] === 0, () => `the shift of ${cellName(base, cell)} reads an open display entry`)
  }
  const random = createRandom(31, 0)
  const changed = copyTables(base)
  randomizeOpenCells(changed, random)
  for (const start of [base, changed]) {
    const flagged = addFirstOnLineFlag(start)
    for (let cell = 0; cell < start.cellsPerCopy; cell++) expect(flagged.choice[cell] === start.choice[cell] && flagged.choice[cell + start.cellsPerCopy] === start.choice[cell] && flagged.open[cell + start.cellsPerCopy] === start.open[cell], () => `the second copy of ${cellName(start, cell)} is no copy`)
    const withTerminals = addTerminals(start, [ampersand, bar])
    for (let state = 0; state < stateCount; state++) {
      for (let terminal = 0; terminal < withTerminals.terminalCount; terminal++) {
        const from = cellOf(start, state, terminal < bisonTerminalCount ? terminal : badCharacter), to = cellOf(withTerminals, state, terminal)
        expect(withTerminals.choice[to] === start.choice[from] && withTerminals.display[to] === start.display[from], () => `the cell of state ${state} and terminal ${terminal} is no copy after two terminals were added`)
        if (terminal >= bisonTerminalCount) expect(withTerminals.open[to] === 1 && withTerminals.displayOpen[to] === 1, () => 'a cell of an added terminal is frozen')
      }
    }
    expect(sameTables(addTerminals(addFirstOnLineFlag(start), [ampersand, bar]), addFirstOnLineFlag(addTerminals(start, [ampersand, bar]))), () => 'the flag and the added terminals give other tables in the other order')
    expect(sameTables(addTerminals(addTerminals(start, [ampersand]), [bar]), withTerminals), () => 'two terminals added one by one give other tables than both at once')
    expect(problemsOf(addTerminals(addFirstOnLineFlag(start), [ampersand, bar])).length === 0, () => 'tables with the flag and added terminals break the ground rules')
  }
  const throws = (run: () => unknown): boolean => {
    try {
      run()
    } catch {
      return true
    }
    return false
  }
  expect(throws(() => addTerminals(base, [{name: 'letter', codePoint: 0x61}])) && throws(() => addTerminals(base, [ampersand, ampersand])) && throws(() => addTerminals(base, [{name: 'LET', codePoint: 0x26}])) && throws(() => addFirstOnLineFlag(addFirstOnLineFlag(base))), () => 'an addition that cannot be is taken')
  const endsEarly = copyTables(base)
  const cellWithEndEarly = changeableCellsOf(endsEarly).find(cell => choicesOf(endsEarly, cell).some(choice => kindOfChoice(choice) === kindEndEarly))!
  endsEarly.choice[cellWithEndEarly] = choicesOf(endsEarly, cellWithEndEarly).find(choice => kindOfChoice(choice) === kindEndEarly)!
  expect(throws(() => withoutEndEarly(endsEarly)) && problemsOf({...endsEarly, endEarly: false}).length === 1, () => 'tables without "end an item early" can hold such a choice')
  const kept = keptCellsOf(base), changeable = changeableCellsOf(base)
  expect(changeable.every(cell => kept[cell] === 0 && base.open[cell] === 1 && terminalOfCell(base, cell) !== endOfInput) && changeable.length + kept.reduce((sum, bit) => sum + bit, 0) === cellCounts(base).openCells, () => 'the kept cells and the changeable cells are not the open cells')
  const differences = differencesOf(base, addFirstOnLineFlag(changed))
  expect(differences.length > 4000 && differencesOf(base, addFirstOnLineFlag(addTerminals(base, [ampersand]))).length === 0, () => `differencesOf lists ${differences.length} differences of tables with a random choice in every open cell`)
  console.log(`3. The base holds bison's action in each of its ${frozenChecked} frozen cells and bison's step in every open one. The flag's second copy and an added terminal's column are copies, also of changed cells, in either order.`)
}

// 4. What checkTables refuses, and what it takes.
{
  let refused = 0, taken = 0
  const refusedHere = (tables: RecoveryTables, what: () => string) => {
    if (problemsOf(tables).length === 0) problem(`${what()} is not refused`)
    else refused++
  }
  for (const start of [baseTables(), addFirstOnLineFlag(addTerminals(baseTables(), [ampersand]))]) {
    const tables = copyTables(start)
    for (let cell = 0; cell < tables.choice.length; cell++) {
      const before = tables.choice[cell]!
      if (tables.open[cell] === 0) {
        // A frozen cell, or a cell of a terminal that no text holds: any other choice is refused.
        for (const choice of [choiceStop, choiceSkip, choicePop, reduceBy(5), insertOf(3)]) {
          if (choice === before) continue
          tables.choice[cell] = choice
          refusedHere(tables, () => `${choice} in the frozen cell ${cellName(tables, cell)}`)
        }
      } else {
        const list = choicesOf(tables, cell)
        for (const choice of list) {
          tables.choice[cell] = choice
          if (problemsOf(tables).length === 0) taken++
          else problem(`${choice}, which is in the list of ${cellName(tables, cell)}, is refused`)
          // One pass over the whole table per choice is slow: every 40th cell tries its whole list, the others one choice.
          if (cell % 40 !== 0) break
        }
        for (const choice of [choiceOf(kindShift, 4), choiceOf(kindAccept), reduceBy(0), readAs(endOfInput), insertOf(endOfInput), endEarlyOf(6, bisonTerminalCount + 7), 9 * 256]) {
          if (list.includes(choice)) continue
          tables.choice[cell] = choice
          refusedHere(tables, () => `${choice} in the open cell ${cellName(tables, cell)}`)
          if (cell % 40 !== 0) break
        }
      }
      tables.choice[cell] = before
    }
    for (let entry = 0; entry < tables.display.length; entry++) {
      const before = tables.display[entry]!
      for (const kind of tables.displayOpen[entry] === 1 ? [displayKindCount, -1] : [(before + 1) % displayKindCount]) {
        tables.display[entry] = kind
        refusedHere(tables, () => `the kind ${kind} in the display entry ${entry}`)
      }
      if (tables.displayOpen[entry] === 1 && entry % 40 === 0) {
        for (let kind = 0; kind < displayKindCount; kind++) {
          tables.display[entry] = kind
          if (problemsOf(tables).length === 0) taken++
          else problem(`the kind ${kind} in the open display entry ${entry} is refused`)
        }
      }
      tables.display[entry] = before
    }
    for (let cell = 0; cell < tables.open.length; cell += 7) {
      tables.open[cell] = 1 - tables.open[cell]!
      refusedHere(tables, () => `a changed bit of the mask of open cells`)
      tables.open[cell] = 1 - tables.open[cell]!
    }
    expect(problemsOf(tables).length === 0, () => 'the tables are not as they were after the changes')
  }
  const json = tablesToJson(baseTables(), 'a note')
  const refusesFile = (text: string): boolean => {
    try {
      tablesFromJson(text)
    } catch {
      return true
    }
    return false
  }
  expect(refusesFile(json.replace(/"grammarKey": "[0-9a-f]+"/, '"grammarKey": "0"')) && refusesFile(json.replace('recovery-lr tables 1', 'recovery tables 1')) && refusesFile(json.replace('"choice": [', '"choice": [40000,'))
    && refusesFile(json.replace('"choice": [', '"choice": [1.5,')) && refusesFile(json.replace('"endEarly": true', '"endEarly": 1')), () => 'a file of another grammar, of another format or with a number that is no choice is loaded')
  console.log(`4. checkTables refuses each of ${refused} changes of a frozen cell, of a frozen display entry, of a mask, and of an open cell or entry to something that is not in its list, and takes each of ${taken} choices and kinds of the lists. A file of another grammar or of another format is not loaded.`)
}

// 5. Saving and loading.
{
  let saved = 0
  for (let setting = 0; setting < 8; setting++) {
    let tables = baseTables()
    if ((setting & 1) !== 0) tables = withoutEndEarly(tables)
    if ((setting & 2) !== 0) tables = addTerminals(tables, [ampersand, bar])
    if ((setting & 4) !== 0) tables = addFirstOnLineFlag(tables)
    randomizeOpenCells(tables, createRandom(32, setting))
    const loaded = tablesFromJson(tablesToJson(tables, `setting ${setting}`))
    expect(loaded.note === `setting ${setting}` && sameTables(loaded.tables, tables) && loaded.tables.endEarly === tables.endEarly && loaded.tables.firstOnLineFlag === tables.firstOnLineFlag && loaded.tables.terminalCount === tables.terminalCount
      && loaded.tables.choice.every((choice, cell) => choice === tables.choice[cell]) && loaded.tables.display.every((kind, entry) => kind === tables.display[entry]) && loaded.tables.open.every((bit, cell) => bit === tables.open[cell]), () => `setting ${setting}: the loaded tables are not the saved ones`)
    saved++
  }
  console.log(`5. ${saved} tables with a random choice in every open cell, with and without the flag, added terminals and "end an item early", are the same after saving and loading.`)
}

// 6. The words.
{
  const tables = addFirstOnLineFlag(addTerminals(baseTables(), [ampersand]))
  let sentences = 0
  const statesWithWords = new Map<string, number[]>()
  for (let state = 0; state < stateCount; state++) {
    if (state === bison.finalState) continue
    const words = stateInWords(state)
    statesWithWords.set(words, [...(statesWithWords.get(words) ?? []), state])
  }
  for (let cell = 0; cell < tables.choice.length; cell++) {
    if (tables.open[cell] !== 1) continue
    const list = choicesOf(tables, cell)
    const words = list.map(choice => choiceInWords(tables, cell, choice))
    sentences += list.length
    expect(new Set(words).size === words.length && words.every(text => text !== '' && !text.includes('undefined')), () => `two choices of ${cellName(tables, cell)} have the same words, or one has none: ${words.join(' | ')}`)
    expect(!cellInWords(tables, cell).includes('undefined'), () => `the words of ${cellName(tables, cell)}`)
  }
  for (let entry = 0; entry < tables.display.length; entry++) if (isTextTerminal(entry % tables.terminalCount)) expect(!displayEntryInWords(tables, entry).includes('undefined'), () => `the words of the display entry ${entry}`)
  expect(terminalInWords(tables, bisonTerminalCount) === 'the character `&`', () => 'the words of an added terminal')
  const shared = [...statesWithWords].filter(([, states]) => states.length > 1)
  console.log(`6. ${sentences} choices of the open cells have words, and no two choices of one cell have the same. ${statesWithWords.size} wordings name the ${stateCount - 1} states that the parser enters${shared.length === 0 ? '' : `: ${shared.length} wordings stand for more than one state, e.g. ${JSON.stringify(shared[0]![0])}`}.`)
}

console.log(problems.length === 0 ? 'Every check passed.' : `${problems.length} problems.`)
if (problems.length > 0) process.exitCode = 1
