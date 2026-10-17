// tree-sitter's trees for many texts: runs the compiled driver of build.ts on batches of texts and reads its output.
import {tables} from '../../../tables.ts'
import {buildDriver} from './build.ts'

// What a node's symbol is when it is no symbol of bison's grammar.
export const commentNode = -2, errorNode = -3

export type Tree = {
  nodeCount: number
  // Per node, parent before children and children in text order, so node 0 is the root, and the nodes of a
  // subtree follow their root without a gap:
  // - the symbol in bison's numbers, e.g. symbolOf('LET') for a token and symbolOf('binding') for an inner node,
  //   or commentNode, or errorNode for a node that holds what the parser could not place,
  symbol: Int16Array
  // - the first code point and the code point after the last one,
  start: Int32Array
  end: Int32Array
  // - the number of children, 0 for a token,
  childCount: Int32Array
  // - 1 for a token that the parser put in itself, which holds no text.
  missing: Uint8Array
}

// The symbols of the generated parser, by tree-sitter's numbers, as the numbers above.
let symbolOfDriver: Map<number, number> | undefined
function driverSymbols(driverPath: string): Map<number, number> {
  if (symbolOfDriver !== undefined) return symbolOfDriver
  const child = Bun.spawnSync([driverPath, 'symbols'], {stdout: 'pipe', stderr: 'pipe'})
  if (child.exitCode !== 0) throw new Error(`the driver failed: ${child.stderr.toString()}`)
  symbolOfDriver = new Map<number, number>()
  for (const line of child.stdout.toString().trim().split('\n')) {
    const [number, name] = line.split(' ') as [string, string]
    // `end` is tree-sitter's end of input, which is never a node.
    if (name === 'end') continue
    const symbol = name === 'COMMENT' ? commentNode : name === 'ERROR' ? errorNode : tables.symbolNames.indexOf(name)
    if (symbol === -1) throw new Error(`the generated parser has a symbol ${name} that bison's grammar does not have`)
    symbolOfDriver.set(Number(number), symbol)
  }
  return symbolOfDriver
}

function recordsOf(texts: readonly ArrayLike<number>[]): Uint8Array {
  let total = 0
  for (const codePoints of texts) total += 1 + codePoints.length
  const records = new Int32Array(total)
  let at = 0
  for (const codePoints of texts) {
    records[at++] = codePoints.length
    for (let index = 0; index < codePoints.length; index++) records[at++] = codePoints[index]!
  }
  return new Uint8Array(records.buffer)
}

function treeOfLine(line: string, symbols: Map<number, number>): Tree {
  const numbers = line.split(' ')
  const nodeCount = Number(numbers[0])
  if (numbers.length !== 1 + 5 * nodeCount) throw new Error('a line of the driver does not have five numbers per node')
  const tree: Tree = {nodeCount, symbol: new Int16Array(nodeCount), start: new Int32Array(nodeCount), end: new Int32Array(nodeCount), childCount: new Int32Array(nodeCount), missing: new Uint8Array(nodeCount)}
  for (let node = 0; node < nodeCount; node++) {
    const symbol = symbols.get(Number(numbers[1 + 5 * node]))
    if (symbol === undefined) throw new Error(`the driver names a symbol ${numbers[1 + 5 * node]} that it did not list`)
    const flags = Number(numbers[5 + 5 * node])
    tree.symbol[node] = symbol
    tree.start[node] = Number(numbers[2 + 5 * node])
    tree.end[node] = Number(numbers[3 + 5 * node])
    tree.childCount[node] = Number(numbers[4 + 5 * node])
    tree.missing[node] = flags & 1
    if (((flags & 4) !== 0) !== (symbol === errorNode)) throw new Error('an error node has another symbol than ERROR')
  }
  return tree
}

// How many texts one run of the driver gets.
const textsPerRun = 2000

// tree-sitter's tree for each of the texts, which are given as code points. Builds the driver when it has to.
export function treesOf(texts: readonly ArrayLike<number>[]): Tree[] {
  const driverPath = buildDriver()
  const symbols = driverSymbols(driverPath)
  const trees: Tree[] = []
  for (let from = 0; from < texts.length; from += textsPerRun) {
    const batch = texts.slice(from, from + textsPerRun)
    const child = Bun.spawnSync([driverPath, 'trees'], {stdin: recordsOf(batch), stdout: 'pipe', stderr: 'pipe'})
    if (child.exitCode !== 0) throw new Error(`the driver failed with exit code ${child.exitCode}: ${child.stderr.toString()}`)
    const lines = child.stdout.toString().split('\n')
    if (lines.length !== batch.length + 1 || lines[batch.length] !== '') throw new Error(`the driver printed ${lines.length - 1} trees for ${batch.length} texts`)
    for (let index = 0; index < batch.length; index++) trees.push(treeOfLine(lines[index]!, symbols))
  }
  return trees
}

// The trees as tree-sitter prints them, for a reader, e.g. "(program (definitions (definition (LET) ...".
export function printedTreesOf(texts: readonly ArrayLike<number>[]): string[] {
  const child = Bun.spawnSync([buildDriver(), 'text'], {stdin: recordsOf(texts), stdout: 'pipe', stderr: 'pipe'})
  if (child.exitCode !== 0) throw new Error(`the driver failed with exit code ${child.exitCode}: ${child.stderr.toString()}`)
  return child.stdout.toString().trimEnd().split('\n')
}

// Whether tree-sitter takes the text as a program: its tree has no error node and no token that the parser put in.
export function treeIsValid(tree: Tree): boolean {
  for (let node = 0; node < tree.nodeCount; node++) if (tree.symbol[node] === errorNode || tree.missing[node] === 1) return false
  return tree.symbol[0] === tables.symbolNames.indexOf('program')
}
