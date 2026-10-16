// The second process of part 8 of check-train.ts: train throws inside its first log point, when its worker threads
// are already there. This script catches the error and has nothing more to do. It ends by itself when train closed
// its threads. With a thread left alive it would not end, and check-train.ts would stop it after a minute and fail.
//
// Run from the repo root: bun lab/recovery-toml/learn/soft/error-inside-train.ts
import {checkSamples} from '../check-set.ts'
import {asIsTables} from '../recovery-tables.ts'
import {train} from './train.ts'
import {packForTwin, placesForTwin} from './twin-data.ts'
import {createModel} from './twin.ts'

const samples = checkSamples(300)
const data = packForTwin(samples, placesForTwin(samples, 'train').subarray(0, 96))
let message = 'no error'
try {
  await train(createModel(asIsTables()), data, {workers: 4, log: () => { throw new Error('thrown by the log of the check') }})
} catch (error) {
  message = error instanceof Error ? error.message : String(error)
}
// No process.exit here: the script has to end because nothing is left running.
console.log(`The error inside train was caught: ${message}`)
