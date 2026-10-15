// Fills the open cells by votes, without gradients and without a search: every train sample is walked with the
// parser forced onto the intended state (intended.ts) after every kept code point. Where the walk knows the state
// before a kept code point and the cell that the code point reads is open, the sample votes for the choice that
// gives the intended state after the code point: a tokenizer cell's next state and event, a grammar cell's next
// state and stack action. Each cell takes its most voted choice, and a cell without votes keeps today's.
//
// Run from the repo root:
//   bun lab/recovery-parser/learn/search/votes.ts [--follow] [--stay] [--out <tables.json>] [--scratch <folder>]
// Without --out the tables go to <scratch>/search/votes.json, with -follow and -stay in the name for the options.
//
// What gives no vote, in the walk without options:
// - A code point that the damage added: there is no intended state after it.
// - A kept code point right after an added one: the state between the added code points is anyone's guess, so the
//   walk does not know which cell the kept code point reads. The walk goes on from the intended state after it.
// - A kept code point that reads a frozen cell. A frozen cell can also give another state than the intended one, e.g.
//   the space after the 1 of {"a": 1 "b": 2} keeps the grammar in commaOrClose, and the intended state after it is
//   `key`, since the original has a comma there. The walk goes on from the intended state all the same, so it reads
//   (key, string) at the quote, which is frozen, and the cell that the parser reads there, (commaOrClose, string), gets
//   no vote from this sample.
// - A grammar cell where no single stack action turns the stack before into the intended one, e.g. after a removed
//   part that closed two containers.
//
// The two options change the walk, and with it what votes:
// --follow  After a frozen cell the walk goes on from what the frozen cell gives, not from the intended state, since
//           no choice of the open cells changes what a frozen cell gives. In the example, the quote then reads
//           (commaOrClose, string), and votes for the next state `colon`. An added code point that reads two frozen
//           cells is followed the same way, e.g. the added comma of [1,].
// --stay    An added code point that reads an open cell votes for the choice that leaves the state as it is: the same
//           tokenizer state with an event that the grammar does not read as a token, and the same grammar state
//           with the stack action `none`. This is one guess of many for a stretch of added code points, e.g. it is
//           right for a comment and wrong for the first quote of a string that the damage quoted.
import {mkdirSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {type Samples, cacheFolderOf, codePointKept, loadStandardSamples, optionOf, refuseUnknownOptions, splitNames, trainPart, validationPart} from '../data.ts'
import {containerArray, containerNone, containerObject, maximumDepth} from '../recovery-parser.ts'
import {
  type RecoveryTables, actionByToken, actionCount, actionNames, actionNone, actionOfToken, actionPop, actionPushArray, actionPushObject, asIsTables, cellCounts, differencesOf,
  eventNames, grammarCellName, grammarStateName, lexerCellName, lexerStateName, saveTables, today,
} from '../recovery-tables.ts'
import {scoreTables, sharesOf} from '../score.ts'

// `alsoOtherSplits` lets samples vote that are not of the train split. Without it countVotes throws for such a
// sample, so that a caller who passes a whole set does not let the validation split vote.
export type VoteOptions = {follow: boolean, stay: boolean, alsoOtherSplits?: boolean}

export type Votes = {
  // Votes per tokenizer cell and choice, [cell × lexerStateCount × eventCount + next state × eventCount + event], and
  // per grammar cell and choice, [cell × grammarStateCount × actionCount + next state × actionCount + action].
  lexer: Int32Array
  grammar: Int32Array
  // Code points at or after the first damage of the broken samples, by what the walk did with them.
  counts: Record<string, number>
}

// The event that a tokenizer state's stay vote names: the event without a token that today's row of the state holds
// most often, e.g. stringContent for the state string, and whitespace where the row has none.
function stayEvents(tables: RecoveryTables): Uint8Array {
  const noToken = tables.tokenOfEvent[eventNames.indexOf('whitespace')]!
  return Uint8Array.from({length: tables.lexerStateCount}, (_, state) => {
    const held = new Int32Array(tables.eventCount)
    for (let characterClass = 0; characterClass < tables.classCount; characterClass++) {
      const event = today.lexerEvent[Math.min(state, today.lexerStateCount - 1) * tables.classCount + characterClass]!
      if (tables.tokenOfEvent[event] === noToken) held[event]!++
    }
    const most = held.indexOf(Math.max(...held))
    return held[most] === 0 ? eventNames.indexOf('whitespace') : most
  })
}

// Walks the broken samples of `samples` and counts their votes. Every broken sample of the set votes, so the set is
// the train split, e.g. trainPart(samples).
export function countVotes(samples: Samples, options: VoteOptions): Votes {
  const trainSplit = splitNames.indexOf('train')
  const other = options.alsoOtherSplits === true ? -1 : samples.split.findIndex((split, place) => split !== trainSplit && samples.firstDamage[place] !== -1)
  if (other !== -1) throw new Error(`countVotes got the sample ${samples.index[other]} of the dataset, which is in the ${splitNames[samples.split[other]!]} split: the votes are counted on the train split only, e.g. on trainPart(samples)`)
  const tables = asIsTables()
  const {classCount, lexerStateCount, eventCount, tokenCount, contextCount, grammarStateCount, tokenOfEvent, classOfCodePoint, lexerOpen, grammarOpen} = tables
  const lexerChoices = lexerStateCount * eventCount
  const grammarChoices = grammarStateCount * actionCount
  const votes: Votes = {lexer: new Int32Array(tables.lexerNext.length * lexerChoices), grammar: new Int32Array(tables.grammarNext.length * grammarChoices), counts: {}}
  const count = (what: string) => { votes.counts[what] = (votes.counts[what] ?? 0) + 1 }
  const stayEvent = stayEvents(tables)
  const lastClassEntry = classOfCodePoint.length - 1
  const kindAtLevel = new Uint8Array(maximumDepth + 2)
  for (let place = 0; place < samples.sampleCount; place++) {
    const firstDamage = samples.firstDamage[place]!
    if (firstDamage === -1) continue
    const first = samples.start[place]!
    const length = samples.start[place + 1]! - first
    let known = true
    let lexerState = 0
    let grammarState = 0
    let depth = 0
    // Puts the walk on the intended state after the code point at `at`. Of the stack, the intended states hold the
    // depth and the kind of the innermost container, which is all that a step reads.
    const force = (at: number) => {
      lexerState = samples.intendedLexerAfter[at]!
      grammarState = samples.intendedGrammarAfter[at]!
      depth = samples.intendedDepthAfter[at]!
      if (depth >= 1) kindAtLevel[depth] = samples.intendedContainerAfter[at]!
      known = true
    }
    for (let position = 0; position < length; position++) {
      const at = first + position
      const kept = (samples.flags[at]! & codePointKept) !== 0
      const counted = position >= firstDamage
      if (!known) {
        if (counted) count(kept ? 'kept, the state before is not known' : 'added, the state before is not known')
        if (kept) force(at)
        continue
      }
      const characterClass = classOfCodePoint[Math.min(samples.codePoints[at]! + 1, lastClassEntry)]!
      const lexerCell = lexerState * classCount + characterClass
      const lexerIsOpen = lexerOpen[lexerCell] === 1
      const containerBefore = depth <= 0 ? containerNone : kindAtLevel[depth]!
      const contextOf = () => today.depthClass[depth < 0 ? 0 : depth]! * 2 + (containerBefore === containerObject ? 1 : 0)
      if (!kept) {
        // An added code point.
        const event = lexerIsOpen ? stayEvent[lexerState]! : today.lexerEvent[lexerCell]!
        const grammarCell = (grammarState * tokenCount + tokenOfEvent[event]!) * contextCount + contextOf()
        const grammarIsOpen = grammarOpen[grammarCell] === 1
        if (options.stay) {
          if (lexerIsOpen) votes.lexer[lexerCell * lexerChoices + lexerState * eventCount + event]!++
          if (grammarIsOpen) votes.grammar[grammarCell * grammarChoices + grammarState * actionCount + (actionOfToken[tokenOfEvent[event]!] === actionNone ? actionByToken : actionNone)]!++
          if (counted) count(lexerIsOpen || grammarIsOpen ? 'added, a vote to stay' : 'added, both cells frozen')
        } else if (counted) {
          count(lexerIsOpen || grammarIsOpen ? 'added, no vote' : 'added, both cells frozen')
        }
        if (options.follow) {
          // Frozen cells give what they give. An open cell leaves the state as it is with --stay, and without it the
          // state after is not known.
          if ((lexerIsOpen || grammarIsOpen) && !options.stay) known = false
          if (!lexerIsOpen) lexerState = today.lexerNext[lexerCell]!
          if (!grammarIsOpen) {
            grammarState = today.grammarNext[grammarCell]!
            const action = actionOfToken[tokenOfEvent[event]!]!
            if (action === actionPushObject || action === actionPushArray) kindAtLevel[++depth] = action === actionPushObject ? containerObject : containerArray
            else if (action === actionPop) depth--
            if (depth < 0 || depth > maximumDepth) known = false
          }
        } else if (!options.stay) {
          known = false
        }
        continue
      }
      // A kept code point. The tokenizer's cell first.
      const intendedLexerAfter = samples.intendedLexerAfter[at]!
      const intendedEvent = samples.intendedEvent[at]!
      let event = intendedEvent
      let lexerAfter = intendedLexerAfter
      if (lexerIsOpen) {
        votes.lexer[lexerCell * lexerChoices + intendedLexerAfter * eventCount + intendedEvent]!++
        if (counted) count('kept, a vote for its tokenizer cell')
      } else {
        event = today.lexerEvent[lexerCell]!
        lexerAfter = today.lexerNext[lexerCell]!
        if (counted) count(event === intendedEvent && lexerAfter === intendedLexerAfter ? 'kept, its tokenizer cell is frozen and gives the intended state' : 'kept, its tokenizer cell is frozen and gives another state')
      }
      // The grammar's cell, for the token of the event that the tokenizer's cell gives.
      const token = tokenOfEvent[event]!
      const grammarCell = (grammarState * tokenCount + token) * contextCount + contextOf()
      const intendedGrammarAfter = samples.intendedGrammarAfter[at]!
      const intendedDepth = samples.intendedDepthAfter[at]!
      const intendedContainer = samples.intendedContainerAfter[at]!
      let grammarAfter = intendedGrammarAfter
      let reached = true
      if (grammarOpen[grammarCell] === 1) {
        // The one stack action that turns the stack before into the intended one, if there is one. After a pop the
        // walk takes the container below to be the intended one.
        const action = intendedDepth === depth + 1 ? (intendedContainer === containerObject ? actionPushObject : actionPushArray)
          : intendedDepth === depth - 1 ? actionPop
          : intendedDepth === depth && intendedContainer === containerBefore ? actionNone : -1
        if (action === -1) {
          reached = false
          if (counted) count('kept, no single stack action gives the intended stack')
        } else {
          votes.grammar[grammarCell * grammarChoices + intendedGrammarAfter * actionCount + (action === actionOfToken[token] ? actionByToken : action)]!++
          if (counted) count('kept, a vote for its grammar cell')
        }
      } else {
        grammarAfter = today.grammarNext[grammarCell]!
        const action = actionOfToken[token]!
        const depthAfter = depth + (action === actionPushObject || action === actionPushArray ? 1 : action === actionPop ? -1 : 0)
        const containerAfter = action === actionPushObject ? containerObject : action === actionPushArray ? containerArray : depthAfter <= 0 ? containerNone : kindAtLevel[depthAfter]!
        const same = grammarAfter === intendedGrammarAfter && depthAfter === intendedDepth && containerAfter === intendedContainer
        if (counted) count(same ? 'kept, its grammar cell is frozen and gives the intended state' : 'kept, its grammar cell is frozen and gives another state')
        if (options.follow) {
          lexerState = lexerAfter
          grammarState = grammarAfter
          if (action === actionPushObject || action === actionPushArray) kindAtLevel[depthAfter] = containerAfter
          depth = depthAfter
          continue
        }
      }
      if (options.follow && reached) {
        // The grammar cell is open and has this sample's vote: the walk takes the intended state as reached. The
        // tokenizer state is the intended one after an open cell and today's after a frozen one.
        force(at)
        lexerState = lexerAfter
      } else if (options.follow) {
        known = false
      } else {
        force(at)
      }
    }
  }
  return votes
}

export type VotedTables = {
  tables: RecoveryTables
  // Open cells with one vote or more, and how many of them hold another choice than today's after the votes.
  lexerCellsWithVotes: number
  grammarCellsWithVotes: number
  lexerCellsChanged: number
  grammarCellsChanged: number
  // All votes, and the votes for the choice that their cell took.
  votes: number
  votesForTheWinner: number
}

// Today's tables with the most voted choice in every open cell that has votes. Of several choices with the same
// votes, today's wins, and then the first.
export function tablesOfVotes(votes: Votes): VotedTables {
  const tables = asIsTables()
  const result: VotedTables = {tables, lexerCellsWithVotes: 0, grammarCellsWithVotes: 0, lexerCellsChanged: 0, grammarCellsChanged: 0, votes: 0, votesForTheWinner: 0}
  const winnerOf = (counts: Int32Array, cell: number, choices: number, choiceToday: number) => {
    let winner = -1
    let most = 0
    let all = 0
    for (let choice = 0; choice < choices; choice++) {
      const votesOfChoice = counts[cell * choices + choice]!
      all += votesOfChoice
      if (votesOfChoice > most || (votesOfChoice === most && most > 0 && choice === choiceToday)) {
        winner = choice
        most = votesOfChoice
      }
    }
    result.votes += all
    result.votesForTheWinner += most
    return winner
  }
  const lexerChoices = tables.lexerStateCount * tables.eventCount
  for (let cell = 0; cell < tables.lexerNext.length; cell++) {
    if (tables.lexerOpen[cell] === 0) continue
    const choiceToday = tables.lexerNext[cell]! * tables.eventCount + tables.lexerEvent[cell]!
    const winner = winnerOf(votes.lexer, cell, lexerChoices, choiceToday)
    if (winner === -1) continue
    result.lexerCellsWithVotes++
    if (winner !== choiceToday) result.lexerCellsChanged++
    tables.lexerNext[cell] = Math.floor(winner / tables.eventCount)
    tables.lexerEvent[cell] = winner % tables.eventCount
  }
  const grammarChoices = tables.grammarStateCount * actionCount
  for (let cell = 0; cell < tables.grammarNext.length; cell++) {
    if (tables.grammarOpen[cell] === 0) continue
    const choiceToday = tables.grammarNext[cell]! * actionCount + tables.grammarAction[cell]!
    const winner = winnerOf(votes.grammar, cell, grammarChoices, choiceToday)
    if (winner === -1) continue
    result.grammarCellsWithVotes++
    if (winner !== choiceToday) result.grammarCellsChanged++
    tables.grammarNext[cell] = Math.floor(winner / actionCount)
    tables.grammarAction[cell] = winner % actionCount
  }
  return result
}

if (import.meta.main) {
  refuseUnknownOptions('search/votes.ts', ['--follow', '--stay', '--cells', '--out', '--scratch'])
  const options: VoteOptions = {follow: process.argv.includes('--follow'), stay: process.argv.includes('--stay')}
  const scratchFolder = optionOf('--scratch') ?? process.env['RECOVERY_SCRATCH']
  const outFile = optionOf('--out') ?? (scratchFolder === undefined ? undefined : join(scratchFolder, 'search', `votes${options.follow ? '-follow' : ''}${options.stay ? '-stay' : ''}.json`))
  const samples = loadStandardSamples(cacheFolderOf(scratchFolder))
  const train = trainPart(samples)
  const started = performance.now()
  const votes = countVotes(train, options)
  const voted = tablesOfVotes(votes)
  const milliseconds = performance.now() - started
  const {tables} = voted
  const cells = cellCounts(tables)
  const walk = `the walk ${options.follow ? 'follows frozen cells' : 'is forced after every kept code point'}${options.stay ? ', and added code points vote to stay' : ''}`
  console.log(`Votes of the train split, ${walk}. Counted in ${milliseconds.toFixed(0)} ms.`)
  console.log(`${voted.votes} votes, ${voted.votesForTheWinner} of them (${(100 * voted.votesForTheWinner / voted.votes).toFixed(1)}%) for the choice that their cell took.`)
  console.log(`Tokenizer: ${voted.lexerCellsWithVotes} of ${cells.lexerOpen} open cells have votes, and ${voted.lexerCellsChanged} of them take another choice than today's.`)
  console.log(`Grammar: ${voted.grammarCellsWithVotes} of ${cells.grammarOpen} open cells have votes, and ${voted.grammarCellsChanged} of them take another choice than today's.`)
  console.log('')
  console.log('The code points at or after the first damage of the broken train samples, by what the walk did with them. A kept code point is counted twice, once per cell:')
  const total = Object.values(votes.counts).reduce((sum, value) => sum + value, 0)
  for (const [what, value] of Object.entries(votes.counts).sort((left, right) => left[0] < right[0] ? -1 : 1)) console.log(`  ${String(value).padStart(9)}  ${(100 * value / total).toFixed(1).padStart(5)}%  ${what}`)
  console.log('')
  if (process.argv.includes('--cells')) {
    // The cells with the most votes, and how the votes are split.
    const lexerChoices = tables.lexerStateCount * tables.eventCount
    const grammarChoices = tables.grammarStateCount * actionCount
    const lines: {votes: number, line: string}[] = []
    const describe = (name: string, counts: Int32Array, cell: number, choices: number, choiceName: (choice: number) => string) => {
      const split = Array.from(counts.subarray(cell * choices, (cell + 1) * choices), (votesOfChoice, choice) => ({votesOfChoice, choice})).filter(entry => entry.votesOfChoice > 0).sort((left, right) => right.votesOfChoice - left.votesOfChoice)
      const all = split.reduce((sum, entry) => sum + entry.votesOfChoice, 0)
      if (all > 0) lines.push({votes: all, line: `  ${String(all).padStart(8)}  ${name}: ${split.slice(0, 4).map(entry => `${choiceName(entry.choice)} ${entry.votesOfChoice}`).join(' | ')}${split.length > 4 ? ` | ${split.length - 4} more` : ''}`})
    }
    for (let cell = 0; cell < tables.lexerNext.length; cell++) describe(`tokenizer ${lexerCellName(tables, cell)}`, votes.lexer, cell, lexerChoices, choice => `(${lexerStateName(Math.floor(choice / tables.eventCount))}, ${eventNames[choice % tables.eventCount]})`)
    for (let cell = 0; cell < tables.grammarNext.length; cell++) describe(`grammar ${grammarCellName(tables, cell)}`, votes.grammar, cell, grammarChoices, choice => `(${grammarStateName(Math.floor(choice / actionCount))}, ${actionNames[choice % actionCount]})`)
    console.log('The cells with votes, most voted first, with their four most voted choices:')
    for (const {line} of lines.sort((left, right) => right.votes - left.votes)) console.log(line)
    console.log('')
  }
  for (const [split, part] of [['train', train], ['validation', validationPart(samples)]] as const) {
    const before = sharesOf(scoreTables(asIsTables(), part, {splits: [split], breakdowns: false}).rows[0]!)
    const after = sharesOf(scoreTables(tables, part, {splits: [split], breakdowns: false}).rows[0]!)
    const line = (shares: typeof before) => `all three ${(100 * shares.allThree).toFixed(2)}%, kind ${(100 * shares.kind).toFixed(2)}%, depth ${(100 * shares.depth).toFixed(2)}%, container ${(100 * shares.container).toFixed(2)}%, whole samples ${(100 * shares.whole).toFixed(2)}%`
    console.log(`${split.padEnd(10)} today's tables: ${line(before)}`)
    console.log(`${''.padEnd(10)} the votes:      ${line(after)}`)
  }
  if (outFile !== undefined) {
    mkdirSync(dirname(outFile), {recursive: true})
    saveTables(outFile, tables, `votes of the train split, ${walk}: ${differencesOf(asIsTables(), tables).length} cells changed against today's tables, which the votes start from`)
    console.log(`Tables: ${outFile}`)
  }
}
