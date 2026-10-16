// What the commands of this folder share: their options, and the scratch folder for tables and logs.
import {mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {scratchFolder} from '../grammar/build.ts'

// The value of an option of the command line, e.g. optionOf('--tables') for `--tables file.json`, or undefined.
export function optionOf(name: string): string | undefined {
  const at = process.argv.indexOf(name)
  if (at === -1) return undefined
  const value = process.argv[at + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`the option ${name} needs a value`)
  return value
}
// A whole number that an option gives, e.g. numberOf('--train', 40_000).
export function numberOf(name: string, otherwise: number): number {
  const value = optionOf(name)
  if (value === undefined) return otherwise
  const number = Number(value)
  if (!Number.isInteger(number) || number < 0) throw new Error(`the option ${name} needs a whole number, and got ${value}`)
  return number
}
// Whether an option without a value is given, e.g. flagOf('--flag').
export const flagOf = (name: string): boolean => process.argv.includes(name)

// Makes a command fail for an option that it does not have, where it would otherwise run as if the option were not
// there. `withValue` are the options that take a value, and `withoutValue` the ones that take none.
export function refuseUnknownOptions(command: string, withValue: readonly string[], withoutValue: readonly string[] = []) {
  const given = process.argv.slice(2)
  for (let index = 0; index < given.length; index++) {
    const option = given[index]!
    if (withValue.includes(option)) index++
    else if (!withoutValue.includes(option)) throw new Error(`${command} has no option ${option}. Its options: ${[...withValue.map(name => `${name} <value>`), ...withoutValue].join(', ')}`)
  }
}

// The folder under RECOVERY_LR_SCRATCH for the tables and logs of this folder's commands.
export function learnFolder(...parts: string[]): string {
  const folder = join(scratchFolder(), 'learn', ...parts)
  mkdirSync(folder, {recursive: true})
  return folder
}

// The sizes of the train and validation sets that a command loads unless it is told otherwise: the JSON side's.
export const standardTrainCount = 40_000
export const standardValidationCount = 5_000
