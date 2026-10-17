// Runs the Doom port's shaders on the CPU from their WGSL text, so that the tests can check what src/doom/wgsl.ts
// writes against what the programs compute. It reads the subset of WGSL that wgsl.ts writes, one statement per line:
// storage and uniform bindings, a guard on the invocation's index, `let` and `var` declarations, arrays of f32 built
// from values, the probe shader's switch, and writes into a buffer, with f32, i32 and u32 arithmetic, comparisons, and
// max, floor, clamp, round, select, the conversions and bitcast<u32>. Anything else is an error, and so is a read or a
// write outside a buffer, where a GPU would clamp it or read 0.
//
// Every f32 operation rounds on its own, which is what WGSL means when no compiler fuses or regroups them: the values
// are the ones the runtime's evaluator computes in the same order, and a GPU compiler that fuses a product into a sum
// can differ from them in the last bits (wgsl.ts's header). The shader becomes one JavaScript function, run once per
// invocation; tests/json-search/wgsl-interpreter.ts does the same for JSON search's shaders, which have other buffers
// and statements.
import {invariant} from '../../src/runtime/numeric-ui-core.ts'

type Type = 'f32' | 'i32' | 'u32' | 'int' | 'bool'
type Expression = {code: string, type: Type}
export type ShaderBuffers = Partial<Record<'statics' | 'constants' | 'records', Float32Array> & Record<'positions' | 'output', Uint32Array>>

const tokenPattern = /\s*(0x[0-9a-fA-F]+\.[0-9a-fA-F]*p[+-]?\d+f|\d+\.\d+f|\d+[ui]?|[A-Za-z_]\w*|>=|<=|==|!=|[-+*/%()[\],.<>{}:;=])/y

function tokenize(text: string): string[] {
  const tokens: string[] = []
  tokenPattern.lastIndex = 0
  while (tokenPattern.lastIndex < text.length) {
    const at = tokenPattern.lastIndex
    const match = tokenPattern.exec(text)
    if (match === null) {
      invariant(text.slice(at).trim() === '', `can't read "${text.slice(at, at + 20)}" in: ${text}`)
      break
    }
    tokens.push(match[1]!)
  }
  return tokens
}

// An f32 literal's value, which must be a float32 value exactly, as wgsl.ts writes them.
function f32Literal(token: string) {
  let value: number
  const hex = /^0x([0-9a-f]+)\.([0-9a-f]*)p([+-]?\d+)f$/i.exec(token)
  if (hex !== null) {
    const [, whole = '', fraction = '', exponent = '0'] = hex
    value = (Number.parseInt(whole, 16) + (fraction === '' ? 0 : Number.parseInt(fraction, 16) / 16 ** fraction.length)) * 2 ** Number(exponent)
  } else {
    value = Number(token.slice(0, -1))
  }
  invariant(Math.fround(value) === value, `the literal ${token} isn't a float32 value`)
  return value
}

// The variables' types, by name, which the declarations give.
type Scope = Map<string, Type>

function parseExpression(tokens: string[], scope: Scope): Expression {
  let at = 0
  const peek = () => tokens[at]
  const take = (expected?: string) => {
    const token = tokens[at++]
    invariant(token !== undefined && (expected === undefined || token === expected), `expected ${expected ?? 'a token'}, got ${token} in ${tokens.join(' ')}`)
    return token
  }
  // An abstract int, e.g. a bare index, takes the type of the other operand.
  const unify = (left: Expression, right: Expression): Type => {
    if (left.type === 'int') return right.type
    if (right.type === 'int' || left.type === right.type) return left.type
    invariant(false, `mixed types ${left.type} and ${right.type} in ${tokens.join(' ')}`)
  }
  const arithmetic = (operator: string, left: Expression, right: Expression): Expression => {
    const type = unify(left, right)
    const code = `(${left.code} ${operator} ${right.code})`
    if (type === 'f32') return {type, code: `F${code}`}
    if (type === 'u32') return {type, code: operator === '%' ? code : `(${operator === '/' ? `Math.trunc${code}` : code} >>> 0)`}
    if (type === 'i32') return {type, code: operator === '%' ? code : `(${operator === '/' ? `Math.trunc${code}` : code} | 0)`}
    invariant(type === 'int', `arithmetic on ${type}`)
    return {type, code}
  }
  const call = (name: string, args: Expression[]): Expression => {
    const [a, b, c] = args
    switch (name) {
      case 'max':
        invariant(args.length === 2 && unify(a!, b!) === 'f32', 'max takes two f32 values')
        return {type: 'f32', code: `Math.max(${a!.code}, ${b!.code})`}
      case 'floor':
        invariant(args.length === 1 && a!.type === 'f32', 'floor takes an f32 value')
        return {type: 'f32', code: `Math.floor(${a!.code})`}
      case 'round':
        invariant(args.length === 1 && a!.type === 'f32', 'round takes an f32 value')
        return {type: 'f32', code: `R(${a!.code})`}
      case 'clamp': {
        invariant(args.length === 3, 'clamp takes three values')
        const type = unify({code: '', type: unify(a!, b!)}, c!)
        return {type, code: `Math.min(Math.max(${a!.code}, ${b!.code}), ${c!.code})`}
      }
      case 'select':
        invariant(args.length === 3 && c!.type === 'bool', 'select takes two values and a bool')
        return {type: unify(a!, b!), code: `(${c!.code} ? ${b!.code} : ${a!.code})`}
      case 'f32':
        return {type: 'f32', code: a!.type === 'f32' ? a!.code : `F(${a!.code})`}
      case 'i32':
        return {type: 'i32', code: a!.type === 'f32' ? `I(${a!.code})` : `(${a!.code} | 0)`}
      case 'u32':
        return {type: 'u32', code: a!.type === 'f32' ? `U(${a!.code})` : `(${a!.code} >>> 0)`}
      default:
        invariant(false, `unknown function ${name}`)
    }
  }
  const primary = (): Expression => {
    const token = take()
    if (token === '(') {
      const inner = comparison()
      take(')')
      return inner
    }
    if (token === '-') {
      const operand = primary()
      return {type: operand.type, code: `(-${operand.code})`}
    }
    if (/^0x|^\d+\.\d+f$/.test(token)) return {type: 'f32', code: String(f32Literal(token))}
    if (/^\d+u$/.test(token)) return {type: 'u32', code: token.slice(0, -1)}
    if (/^\d+i$/.test(token)) return {type: 'i32', code: token.slice(0, -1)}
    if (/^\d+$/.test(token)) return {type: 'int', code: token}
    if (token === 'bitcast') {
      take('<')
      take('u32')
      take('>')
      const [value] = argumentsOf()
      invariant(value!.type === 'f32', 'bitcast<u32> takes an f32 value')
      return {type: 'u32', code: `B(${value!.code})`}
    }
    if (token === 'id') {
      take('.')
      take('x')
      return {type: 'u32', code: 'x'}
    }
    if (peek() === '(') return call(token, argumentsOf())
    // A read of an array: a buffer, or an array the shader built.
    const element = scope.get(`${token}[]`)
    if (element !== undefined) {
      take('[')
      const index = comparison()
      take(']')
      invariant(index.type === 'u32' || index.type === 'i32' || index.type === 'int', `an index must be an integer, got ${index.type}`)
      return {type: element, code: `A(${token}, ${index.code})`}
    }
    const type = scope.get(token)
    invariant(type !== undefined, `unknown name ${token}`)
    return {type, code: token}
  }
  const argumentsOf = () => {
    take('(')
    const args: Expression[] = []
    while (peek() !== ')') {
      args.push(comparison())
      if (peek() === ',') take(',')
    }
    take(')')
    return args
  }
  const multiplicative = (): Expression => {
    let left = primary()
    while (peek() === '*' || peek() === '/' || peek() === '%') left = arithmetic(take(), left, primary())
    return left
  }
  const additive = (): Expression => {
    let left = multiplicative()
    while (peek() === '+' || peek() === '-') left = arithmetic(take(), left, multiplicative())
    return left
  }
  const comparison = (): Expression => {
    const left = additive()
    const operator = peek()
    if (operator !== '>=' && operator !== '<=' && operator !== '<' && operator !== '>' && operator !== '==' && operator !== '!=') return left
    take()
    const right = additive()
    unify(left, right)
    return {type: 'bool', code: `(${left.code} ${operator === '==' ? '===' : operator === '!=' ? '!==' : operator} ${right.code})`}
  }
  const expression = comparison()
  invariant(at === tokens.length, `left over: ${tokens.slice(at).join(' ')}`)
  return expression
}

const scalarType = (name: string): Type => {
  invariant(name === 'f32' || name === 'u32' || name === 'i32', `unknown type ${name}`)
  return name
}

// Rounds to the nearest whole number, ties to even, as WGSL's round does.
function roundHalfEven(value: number) {
  const floor = Math.floor(value)
  const difference = value - floor
  if (difference < 0.5) return floor
  if (difference > 0.5) return floor + 1
  return floor % 2 === 0 ? floor : floor + 1
}

// f32 to i32 and to u32: toward zero, held to the type's range.
const toI32 = (value: number) => Number.isNaN(value) ? 0 : Math.max(-(2 ** 31), Math.min(2 ** 31 - 1, Math.trunc(value)))
const toU32 = (value: number) => Number.isNaN(value) ? 0 : Math.max(0, Math.min(2 ** 32 - 1, Math.trunc(value)))
const bitsOf = new DataView(new ArrayBuffer(4))
const bitcast = (value: number) => {
  bitsOf.setFloat32(0, value)
  return bitsOf.getUint32(0)
}
const read = (array: ArrayLike<number>, index: number) => {
  invariant(index >= 0 && index < array.length, `a read at ${index} of an array of ${array.length}`)
  return array[index]!
}
const write = (array: Float32Array | Uint32Array, index: number, value: number) => {
  invariant(index >= 0 && index < array.length, `a write at ${index} of a buffer of ${array.length}`)
  array[index] = value
}

export type Shader = (buffers: ShaderBuffers, invocations: number, probe?: number) => void

// The shader as a function that runs `invocations` invocations over the buffers, each array as its binding's name.
export function createShaderInterpreter(code: string): Shader {
  const scope: Scope = new Map([['probe', 'u32']])
  const bufferNames: string[] = []
  const body: string[] = []
  const lines = code.split('\n').map(line => line.trim()).filter(line => line !== '')
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    let match: RegExpExecArray | null
    if ((match = /^@group\(0\) @binding\(\d+\) var<(storage, read|storage, read_write|uniform)> (\w+): (array<(\w+)>|u32);$/.exec(line)) !== null) {
      const [, , name = '', , element] = match
      if (element !== undefined) {
        scope.set(`${name}[]`, scalarType(element))
        bufferNames.push(name)
      }
    } else if (line === '@compute @workgroup_size(64)' || line === 'fn main(@builtin(global_invocation_id) id: vec3<u32>) {' || line === '}') {
      // The entry point's frame.
    } else if ((match = /^if \((.*)\) \{ return; \}$/.exec(line)) !== null) {
      const condition = parseExpression(tokenize(match[1]!), scope)
      invariant(condition.type === 'bool', 'an if needs a bool')
      body.push(`if (${condition.code}) return`)
    } else if ((match = /^(let|var) (\w+): (\w+) = (.*);$/.exec(line)) !== null) {
      const [, keyword, name = '', typeName = '', text = ''] = match
      const type = scalarType(typeName)
      const value = parseExpression(tokenize(text), scope)
      invariant(value.type === type || value.type === 'int', `${name} is a ${type}, its value a ${value.type}`)
      scope.set(name, type)
      body.push(`${keyword === 'let' ? 'const' : 'let'} ${name} = ${value.code}`)
    } else if ((match = /^var (\w+) = array<f32, (\d+)>\((.*)\);$/.exec(line)) !== null) {
      const [, name = '', length = '', text = ''] = match
      const values = text.split(',').map(element => parseExpression(tokenize(element), scope))
      invariant(values.length === Number(length) && values.every(value => value.type === 'f32'), `${name} needs ${length} f32 values`)
      scope.set(`${name}[]`, 'f32')
      body.push(`const ${name} = [${values.map(value => value.code).join(', ')}]`)
    } else if ((match = /^switch (\w+) \{$/.exec(line)) !== null) {
      const selector = parseExpression([match[1]!], scope)
      const cases: string[] = []
      for (index++; lines[index] !== '}'; index++) {
        const branch = lines[index]!
        const caseMatch = /^case (\d+)u: \{ (\w+) = (.*); \}$/.exec(branch)
        if (caseMatch !== null) {
          const [, label, target = '', text = ''] = caseMatch
          const value = parseExpression(tokenize(text), scope)
          invariant(scope.get(target) === value.type, `case ${label} writes a ${value.type} into ${target}`)
          cases.push(`case ${label}: ${target} = ${value.code}; break`)
        } else {
          invariant(branch === 'default: {}', `can't read "${branch}" in a switch`)
        }
      }
      body.push(`switch (${selector.code}) { ${cases.join('; ')} }`)
    } else if ((match = /^(\w+)\[(.*)\] = (.*);$/.exec(line)) !== null) {
      const [, name = '', indexText = '', text = ''] = match
      const element = scope.get(`${name}[]`)
      const target = parseExpression(tokenize(indexText), scope)
      const value = parseExpression(tokenize(text), scope)
      invariant(element !== undefined && value.type === element, `a ${value.type} written into ${name}, an array of ${element}`)
      invariant(target.type === 'u32' || target.type === 'int', `an index must be a u32, got ${target.type}`)
      body.push(`W(${name}, ${target.code}, ${value.code})`)
    } else {
      invariant(false, `can't read the statement "${line.slice(0, 80)}"`)
    }
  }
  // The Function constructor compiles the translated source, as src/json-search/generated-js.ts does.
  const run = Reflect.construct(Function, ['x', 'probe', 'F', 'R', 'I', 'U', 'B', 'A', 'W', ...bufferNames, body.join('\n')]) as (...args: unknown[]) => void
  return (buffers, invocations, probe = 0) => {
    const arrays = bufferNames.map(name => {
      const array = buffers[name as keyof ShaderBuffers]
      invariant(array !== undefined, `the shader reads ${name}, which isn't given`)
      return array
    })
    for (let x = 0; x < invocations; x++) run(x, probe, Math.fround, roundHalfEven, toI32, toU32, bitcast, read, write, ...arrays)
  }
}
