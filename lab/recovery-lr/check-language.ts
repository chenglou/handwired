// Checks every example of LANGUAGE.md with the parser:
// - A block that starts with ```miniml is one valid program.
// - Every line of a block that starts with ```miniml-invalid is a text that is no valid program.
// - A table with the header "| written | read as |" has two expressions per row, and the parser groups both the
//   same way: the trees are the same once the brackets around one expression are taken out.
// - A table with the header "| not a program | why |" has a text per row that is no valid program.
// - Every other piece of code in a sentence is a valid program or a valid expression, e.g. `let add x y = x + y`
//   and `f (g x) (-1)`, unless it is one of the parts of a program that are listed below, e.g. `->`.
//
// Run from the repo root: bun lab/recovery-lr/check-language.ts
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {type TreeNode, labelsOfValidText, treeOf} from './labels.ts'
import {isValid} from './parser.ts'
import {ruleText, tables} from './tables.ts'

const problems: string[] = []
const problem = (text: string) => {
  problems.push(text)
  console.log(`PROBLEM: ${text}`)
}

// How the parser groups a valid text, e.g. "(let x = (a + (b * c)))" for `let x = a + b * c`: every reduction of
// two or more symbols in brackets. A reduction of one symbol is left out, e.g. expr: application, and so are the
// brackets around one expression, atom: LPAREN expr RPAREN, so that `a + (b * c)` gives the same.
function groupingOf(text: string): string {
  const labels = labelsOfValidText(text)
  const textOfToken = (token: number): string => String.fromCodePoint(...labels.codePoints.slice(labels.tokens.start[token], labels.tokens.start[token]! + labels.tokens.length[token]!))
  const bracketed = tables.ruleRhs.findIndex((_, rule) => ruleText(rule) === 'atom: LPAREN expr RPAREN')
  if (bracketed === -1) throw new Error('the grammar has no rule atom: LPAREN expr RPAREN')
  const render = (node: TreeNode): string => {
    if (node.token !== -1) return textOfToken(node.token)
    if (node.rule === bracketed) return render(node.children[1]!)
    if (node.children.length === 1) return render(node.children[0]!)
    // An empty reduction has no text, e.g. an empty list of parameters.
    if (node.children.length === 0) return ''
    return `(${node.children.map(render).filter(part => part !== '').join(' ')})`
  }
  return render(treeOf(labels))
}

// The pieces of code in the sentences that are neither a program nor an expression: keywords, operators and other
// parts, characters that are errors, and the two that only show how tokens are cut.
const parts = new Set([
  'let', 'rec', 'in', 'if', 'then', 'else', 'fun', '=', '_', '-', ',', ';', ';;', '->', '(', '[', '<=', '<>', '::', '&&', '||', '(*', '*)', '(*)', '"', '\\', "'", '.', '!', ':', '|', '&', '#', '@',
  '%', '~', '{', '}', 'é', 'a', 'z', 'A', 'Z', 'let x', 'check-language.ts',
])

const lines = readFileSync(join(import.meta.dir, 'LANGUAGE.md'), 'utf8').split('\n')
let programs = 0, notPrograms = 0, pairs = 0, inSentences = 0
// The code of a table cell: the text between its first and its last backtick. A `|` in a table is written `\|`.
const codeOf = (cell: string): string | undefined => /`(.*)`/.exec(cell)?.[1]?.replaceAll('\\|', '|')
for (let index = 0; index < lines.length; index++) {
  const line = lines[index]!
  if (!line.startsWith('|') && !line.startsWith('```')) {
    for (const [, code] of line.matchAll(/`([^`]+)`/g)) {
      if (parts.has(code!)) continue
      inSentences++
      if (!isValid(code!) && !isValid(`let it = ${code}`)) problem(`line ${index + 1}: ${code} is neither a program nor an expression, and is not in the list of parts`)
    }
  }
  if (line.startsWith('```miniml')) {
    const kind = line.trim()
    const block: string[] = []
    for (index++; index < lines.length && lines[index] !== '```'; index++) block.push(lines[index]!)
    if (kind === '```miniml') {
      programs++
      if (!isValid(block.join('\n'))) problem(`the block at line ${index - block.length} is no valid program:\n${block.join('\n')}`)
    } else if (kind === '```miniml-invalid') {
      for (const text of block) {
        if (text.trim() === '') continue
        notPrograms++
        if (isValid(text)) problem(`line ${index}: ${text} is said to be no program, and the parser accepts it`)
      }
    } else problem(`line ${index - block.length}: a block of an unknown kind, ${kind}`)
    continue
  }
  const header = line.replaceAll(/\s+/g, ' ').trim()
  if (header !== '| written | read as |' && header !== '| not a program | why |') continue
  // The rows after the header and its line of dashes.
  for (index += 2; index < lines.length && lines[index]!.startsWith('|'); index++) {
    const cells = lines[index]!.split(' | ').map(cell => cell.replace(/^\|\s*/, '').replace(/\s*\|$/, ''))
    const first = codeOf(cells[0] ?? '')
    if (first === undefined) {
      problem(`line ${index + 1}: a row without code`)
      continue
    }
    if (header === '| not a program | why |') {
      notPrograms++
      if (isValid(first)) problem(`line ${index + 1}: ${first} is said to be no program, and the parser accepts it`)
      continue
    }
    const second = codeOf(cells[1] ?? '')
    if (second === undefined) {
      problem(`line ${index + 1}: a row with one expression`)
      continue
    }
    pairs++
    const written = `let it = ${first}`, readAs = `let it = ${second}`
    if (!isValid(written) || !isValid(readAs)) problem(`line ${index + 1}: ${!isValid(written) ? first : second} is no valid expression`)
    else if (groupingOf(written) !== groupingOf(readAs)) problem(`line ${index + 1}: ${first} is grouped as ${groupingOf(written)}, and ${second} as ${groupingOf(readAs)}`)
    // The brackets of the second column say everything: with brackets around other parts the grouping differs.
    else if (first === second) problem(`line ${index + 1}: both columns are the same text`)
  }
  index--
}
console.log(`LANGUAGE.md: ${programs} blocks are valid programs, ${inSentences} pieces of code in sentences are programs or expressions, ${notPrograms} texts are no programs, and ${pairs} pairs of expressions are grouped the same way.`)
if (programs < 5 || inSentences < 50 || notPrograms < 40 || pairs < 30) problem('LANGUAGE.md has fewer examples than this check expects, or the check no longer finds them')
console.log(problems.length === 0 ? 'Every check passed.' : `${problems.length} problems.`)
if (problems.length > 0) process.exitCode = 1
