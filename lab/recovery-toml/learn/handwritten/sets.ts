// The two sets of samples that the hand-written rules are read and scored on, each with its train and validation
// splits and never with the test split:
//
// - 'neutral': the dataset's standard set, whose damage knows nothing of TOML, see ../data.ts.
// - 'mixed': the mixed set of ../../kinds/mixed.ts. Half of its samples are the dataset's and half are kinds of
//   mistakes written for TOML. In its arrays a sample of the dataset has the source `damage`, and a sample of the
//   kinds has the source `kinds`.
//
// The mixed set takes 13 seconds to make, so its arrays are kept in a file of the scratch folder, named by the
// dataset's key and the key of the kinds.
import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {kindsKey, mixedSet} from '../../kinds/mixed.ts'
import {type Samples, cacheFolderOf, datasetKey, loadStandardSamples} from '../data.ts'

export const setNames = ['neutral', 'mixed'] as const
export type SetName = typeof setNames[number]

const arrayTypes = {Int32Array, Int8Array, Uint8Array, Uint16Array}
type TypedArray = Int32Array | Int8Array | Uint8Array | Uint16Array
const isTypedArray = (value: unknown): value is TypedArray => value instanceof Int32Array || value instanceof Int8Array || value instanceof Uint8Array || value instanceof Uint16Array

type Header = {format: string, plain: Record<string, unknown>, sections: {field: string, type: string, length: number, offset: number}[]}
const format = 'mixed samples for the hand-written rules 1'
const align = (offset: number) => Math.ceil(offset / 8) * 8

function writeSamples(path: string, samples: Samples) {
  const header: Header = {format, plain: {}, sections: []}
  const arrays: TypedArray[] = []
  let offset = 0
  for (const [field, value] of Object.entries(samples)) {
    if (!isTypedArray(value)) {
      header.plain[field] = value
      continue
    }
    header.sections.push({field, type: value.constructor.name, length: value.length, offset})
    arrays.push(value)
    offset = align(offset + value.byteLength)
  }
  const headerBytes = new TextEncoder().encode(JSON.stringify(header))
  const bodyStart = align(8 + headerBytes.length)
  const bytes = new Uint8Array(bodyStart + offset)
  new DataView(bytes.buffer).setUint32(0, headerBytes.length, true)
  bytes.set(headerBytes, 8)
  header.sections.forEach((section, index) => {
    const values = arrays[index]!
    bytes.set(new Uint8Array(values.buffer, values.byteOffset, values.byteLength), bodyStart + section.offset)
  })
  const partial = `${path}.${process.pid}.partial`
  writeFileSync(partial, bytes)
  renameSync(partial, path)
}

function readSamples(path: string): Samples | undefined {
  const file = readFileSync(path)
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
  const headerLength = new DataView(buffer, 0, 8).getUint32(0, true)
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, headerLength))) as Header
  if (header.format !== format) return undefined
  const bodyStart = align(8 + headerLength)
  const samples: Record<string, unknown> = {...header.plain}
  for (const section of header.sections) {
    const type = arrayTypes[section.type as keyof typeof arrayTypes]
    samples[section.field] = new type(buffer, bodyStart + section.offset, section.length)
  }
  return samples as unknown as Samples
}

// The scratch folder of a command: its option --scratch, or the environment variable RECOVERY_SCRATCH.
export function scratchFolderOf(option: string | undefined): string | undefined {
  const folder = option ?? process.env['RECOVERY_SCRATCH']
  return folder === undefined || folder === '' ? undefined : folder
}

// The samples of a set, train and validation. Without a scratch folder they are made each time.
export function loadSet(name: SetName, scratchFolder: string | undefined): Samples {
  if (name === 'neutral') return loadStandardSamples(cacheFolderOf(scratchFolder))
  if (scratchFolder === undefined) return mixedSet()
  const folder = join(scratchFolder, 'cache')
  mkdirSync(folder, {recursive: true})
  const path = join(folder, `mixed-${datasetKey()}-${kindsKey()}.bin`)
  if (existsSync(path)) {
    const cached = readSamples(path)
    if (cached !== undefined) return cached
  }
  const samples = mixedSet()
  writeSamples(path, samples)
  return samples
}

// The sets that a command's --set names, e.g. ['neutral', 'mixed'] for `--set neutral,mixed`. Without the option,
// both.
export function setsOfOption(value: string | undefined): SetName[] {
  const named = (value ?? setNames.join(',')).split(',') as SetName[]
  for (const name of named) if (!setNames.includes(name)) throw new Error(`--set takes neutral or mixed, or both with a comma, and got ${name}`)
  return named
}
