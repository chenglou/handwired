// The options of a command of learn/, e.g. `--tables <file.json>`.

// Throws when a command got an option that it does not have, e.g. `score.ts --split test`: a command that ignores an
// option runs as if the option were not there, and its output is then read as if it were. `known` are the command's
// options, e.g. ['--tables', '--split'].
export function refuseUnknownOptions(command: string, known: readonly string[], argv: readonly string[] = process.argv.slice(2)) {
  for (const argument of argv) {
    if (argument.startsWith('--') && !known.includes(argument)) throw new Error(`${command} has no option ${argument}. ${known.length === 0 ? 'It takes no option.' : `Its options: ${known.join(', ')}.`}`)
  }
}

// The value of a command's option, e.g. optionOf('--split') for `--split validation`.
export function optionOf(name: string, argv: readonly string[] = process.argv): string | undefined {
  const at = argv.indexOf(name)
  return at === -1 ? undefined : argv[at + 1]
}
