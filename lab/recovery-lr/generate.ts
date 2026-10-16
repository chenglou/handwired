// A STAND-IN generator of valid miniml programs, good enough for the checks of this folder: programs with line
// breaks and indentation as a person would write them, 60 tokens and 267 code points on average. It is not the
// generator of the experiment: it does not write every construct, e.g. no `let` as a right operand without
// brackets, and 20,000 of its programs read 1,281 of the 1,391 frozen cells. The real generator replaces this file
// behind the same export.
//
// generateProgram(seed, index) must return a valid program of at most 512 code points, and the same one for the
// same seed and index. dataset.ts checks both for every program that it hands out.
import {maximumCodePoints} from './parser.ts'
import {type Random, createRandom} from './random.ts'

const names = [
  'x', 'y', 'n', 'acc', 'xs', 'ys', 'f', 'g', 'k', 'total', 'count', 'item', 'rest', 'left', 'right', 'value', 'result', 'index', 'limit', 'name', 'size', 'step', 'head', 'tail',
  'is_empty', 'max_depth', 'node', 'key', "x'", 'tmp1', 'go', 'loop', 'helper', 'compute', 'update', 'render', 'parse_line', 'fold', 'map', 'filter', 'length', 'print_int',
  'print_string', 'concat', 'reverse',
]
const words = ['hello', 'world', 'error', 'ok', 'not found', 'a b c', 'x = 1', 'done.', 'in', 'let it be', '(fine)', 'tab\\there', 'say \\"hi\\"', '', '42', 'path/to/file']
const operators = ['+', '-', '*', '/', '=', '<>', '<', '<=', '>', '>=', '&&', '||', '::', '^']

const below = (random: Random, count: number): number => random.integer(0, count - 1)

function atom(random: Random, budget: number): string {
  const choice = below(random, budget > 2 ? 12 : 8)
  if (choice < 3) return random.pick(names)
  if (choice < 5) return String(below(random, random.chance(0.7) ? 10 : 1000))
  if (choice === 5) return `"${random.pick(words)}"`
  if (choice === 6) return random.pick(['true', 'false', '()', '[]'])
  if (choice === 7) return random.pick(names)
  if (choice === 8) return `(${inline(random, budget - 1)})`
  if (choice === 9) return `(${inline(random, budget >> 1)}, ${inline(random, budget >> 1)}${random.chance(0.2) ? `, ${atom(random, 1)}` : ''})`
  if (choice === 10) return `[${Array.from({length: 1 + below(random, 4)}, () => inline(random, budget >> 2)).join('; ')}]`
  return `(${inline(random, budget - 1)})`
}

function parameters(random: Random, least: number): string {
  const list: string[] = []
  const count = least + below(random, 3)
  for (let parameter = 0; parameter < count; parameter++) list.push(random.chance(0.85) ? random.pick(names) : random.pick(['_', '()']))
  return list.join(' ')
}

// An expression on one line. Whatever is no application and no atom is in brackets when it is an operand.
function inline(random: Random, budget: number): string {
  if (budget <= 1) return atom(random, budget)
  const choice = below(random, 20)
  if (choice < 6) return `${random.pick(names)} ${Array.from({length: 1 + below(random, 3)}, () => atom(random, budget >> 1)).join(' ')}`
  if (choice < 12) return `${operand(random, budget >> 1)} ${random.pick(operators)} ${operand(random, budget >> 1)}`
  if (choice === 12) return `-${random.chance(0.5) ? ' ' : ''}${atom(random, budget >> 1)}`
  if (choice === 13) return `if ${inline(random, budget >> 2)} then ${inline(random, budget >> 2)} else ${inline(random, budget >> 2)}`
  if (choice === 14) return `fun ${parameters(random, 1)} -> ${inline(random, budget - 2)}`
  if (choice === 15) return `let ${random.pick(names)} = ${inline(random, budget >> 1)} in ${inline(random, budget >> 1)}`
  return atom(random, budget)
}
function operand(random: Random, budget: number): string {
  const choice = below(random, 10)
  if (choice < 4) return atom(random, budget)
  if (choice < 7) return `${random.pick(names)} ${atom(random, budget >> 1)}`
  if (choice < 9) return `${operand(random, budget >> 1)} ${random.pick(operators)} ${operand(random, budget >> 1)}`
  return `(${inline(random, budget)})`
}

// An expression over several lines, as a list of lines at the given indentation.
function block(random: Random, budget: number, indent: string): string[] {
  if (budget <= 6 || random.chance(0.25)) return [indent + inline(random, budget)]
  const choice = below(random, 10)
  if (choice < 4) {
    const lines: string[] = []
    const rec = random.chance(0.2) ? 'rec ' : ''
    const head = `${indent}let ${rec}${random.chance(0.3) ? `${random.pick(names)} ${parameters(random, 1)}` : random.pick(names)} =`
    if (random.chance(0.6)) lines.push(`${head} ${inline(random, budget >> 2)} in`)
    else lines.push(head, ...block(random, budget >> 1, `${indent}  `), `${indent}in`)
    lines.push(...block(random, budget >> 1, indent))
    return lines
  }
  if (choice < 7) {
    const condition = inline(random, budget >> 3)
    if (random.chance(0.5)) return [`${indent}if ${condition} then ${inline(random, budget >> 2)}`, `${indent}else ${inline(random, budget >> 2)}`]
    const lines = [`${indent}if ${condition} then`, ...block(random, budget >> 1, `${indent}  `)]
    if (random.chance(0.85)) lines.push(`${indent}else`, ...block(random, budget >> 1, `${indent}  `))
    return lines
  }
  if (choice < 8) return [`${indent}fun ${parameters(random, 1)} ->`, ...block(random, budget - 2, `${indent}  `)]
  if (choice < 9) {
    const count = 2 + below(random, 3)
    const lines = [`${indent}[`]
    for (let element = 0; element < count; element++) lines.push(`${indent}  ${inline(random, budget >> 2)}${element < count - 1 ? ';' : ''}`)
    lines.push(`${indent}]`)
    return lines
  }
  return [indent + inline(random, budget)]
}

function program(random: Random): string {
  const lines: string[] = []
  const definitions = 1 + below(random, 6)
  for (let definition = 0; definition < definitions; definition++) {
    if (random.chance(0.2)) lines.push(`(* ${random.pick(words)} ${random.pick(names)} *)`)
    const rec = random.chance(0.25) ? 'rec ' : ''
    const target = random.chance(0.1) ? random.pick(['()', '_']) : `${random.pick(names)}${random.chance(0.7) ? ` ${parameters(random, 1)}` : ''}`
    const budget = 2 + below(random, 40)
    if (budget < 8 && random.chance(0.6)) lines.push(`let ${rec}${target} = ${inline(random, budget)}${random.chance(0.1) ? `  (* ${random.pick(names)} *)` : ''}`)
    else lines.push(`let ${rec}${target} =`, ...block(random, budget, '  '))
    if (random.chance(0.7)) lines.push('')
  }
  return lines.join('\n') + (random.chance(0.8) ? '\n' : '')
}

export function generateProgram(seed: number, index: number): string {
  const random = createRandom(seed, index)
  // A program that is too long is drawn again, with the next numbers of the same sequence.
  for (;;) {
    const text = program(random)
    if (Array.from(text).length <= maximumCodePoints) return text
  }
}

if (import.meta.main) console.log(generateProgram(Number(process.argv[2] ?? 1), Number(process.argv[3] ?? 0)))
