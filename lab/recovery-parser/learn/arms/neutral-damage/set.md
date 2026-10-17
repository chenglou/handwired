# The neutral set: train samples whose damage knows nothing of JSON

The trained tables of `../combined/` recover from broken JSON, and one place where knowledge of JSON went into them is the training damage: 55 kinds written by hand, e.g. single quotes and keys without quotes. This folder makes a train set with the same originals and with damage that knows nothing of the language, so that the same recipe can be trained on it and scored on the validation split, whose 55 kinds were then never written into the training damage. Some of them are still in the set by chance, see "Kinds of the dataset by chance" below. This file is about the set: the generator, its check and its numbers. `README.md` says what was trained on the set and what came out.

## The damage

An edit works on a text as a list of code points and reads three things: how long the text is, which of its code points are equal, and where its line feeds are. The ten edits, each with the same weight (`neutral-edits.ts`):

1. delete one code point
2. insert one code point, the one at a uniform place of the same text, so a frequent code point is drawn more often
3. replace one code point with another one, drawn the same way among the places that hold another code point
4. swap two neighbours that differ
5. delete a run of 2 to 20 code points
6. duplicate a run of 2 to 20 code points in place: the copy follows the run
7. copy a run of 2 to 20 code points to a uniform place outside the run. The run's two ends are left out too, since a copy there is edit 6
8. delete one line with its line feed
9. duplicate one line: the copy follows the line
10. cut the tail at a uniform place, so that at least one code point stays and one goes

Places and lengths are uniform. A run's length is drawn among the lengths that the text has room for, e.g. 2 to 9 in a text of 9 code points. A line runs up to and including its line feed, and the last line of a text that does not end with a line feed has none: its copy stands right after it.

A sample gets one edit with probability 0.6, two with 0.3 and three with 0.1, applied one after another, each to the text that the edit before it left. A draw is thrown away, and the sample is drawn again from the same original, when the text has no place for an edit (e.g. a swap in `11`), when the text is unchanged, longer than 512 code points, still valid JSON, or nested deeper than 16 levels as the parser as it is counts, and when no code point is left to score. All of it was fixed before any score existed, and nothing here is tuned.

**The edits read no JSON, and the choice of which draws are kept does**: "still valid JSON" and "something left to score" are questions about JSON. They move the set away from the weights, e.g. a tail that is cut leaves nothing after the first error, so edit 10 is in a sample only next to another edit.

## The labels

They follow the dataset (`../../../README.md`): a kept code point has the label of its counterpart in the original, an added code point has none, and what is not scored is decided by the dataset's rules, e.g. the depth after a removed bracket up to the next kept bracket. What the dataset leaves to a kind of damage is settled here in one way for every edit:

- **A replacing code point and the two swapped ones are added code points.** The dataset gives a replacing code point the label of the one it stands for only where a person judged that it plays the same part, e.g. `'` for `"`, and a neutral edit cannot judge that.
- **Of a run and its copy, the copy is the added one**, also when the run is the start of the text. E.g. in `{"a":1}{"a":1}`, the only line duplicated, the first document is the kept one, nothing is left to score, and the draw is thrown away. Read the other way round, such a text would be labeled as two documents in one text, which is one of the dataset's kinds.
- **The edits are in the dataset's canonical form**: what stands between two kept code points is one insertion and then one removal, each moved to the right as far as the text stays the same (`canonicalEdits`).
- **Nothing is declared as not scored**, where a kind of the dataset can say that no reading gives a display kind, e.g. for a comma inside a string that is open at its line end.

The dataset's judgments about a kind are not known for a neutral sample: `reachable`, `needsRules`, `needsClass` and `debatable` hold `'yes'`, nothing and `false`, and say nothing. So the groups "out of reach", "needs a character class" and "needs a line rule" cannot be worked out. The two proofs about the plain table parser and its bound are made as for any sample.

## The originals and the size

Neutral sample k damages the original of the k-th broken sample of the train split of the standard set, so the two sets have the same documents and the same number of broken samples, 40,457. Of a text of several documents, e.g. one document per line, the original is the first document. 37 originals give no sample in 300 draws, lone numbers and the empty string `""`, and their samples take the original of the next sample.

**The dataset's typing replays are not in the set, and there is no second set with them.** They hold knowledge of JSON: what is not typed yet is the rest of one member, of one item or of the whole document, found by the dataset's scan of the JSON structure, and 42.1% of the 9,029 typing texts of the standard train set come from an editor that closes quotes and brackets. 71.9% of them are the original without one run of code points, which a neutral edit can make too, but where the run ends is what the scan chose. A set "neutral plus typing" would be 31,428 neutral samples and those 9,029 texts.

## Make the set

```sh
export RECOVERY_SCRATCH=<a folder outside the repo>
bun lab/recovery-parser/learn/arms/neutral-damage/neutral.ts    # makes the set and its cache file, about 10 s once
bun lab/recovery-parser/learn/arms/neutral-damage/check.ts      # about half a minute
bun lab/recovery-parser/learn/arms/neutral-damage/stats.ts      # the numbers below, about 25 s
bun lab/recovery-parser/learn/arms/neutral-damage/dump.ts <folder outside the repo>   # samples.txt and standard-samples.txt for reading
```

`loadNeutralSet()` of `neutral.ts` gives `{samples, originalOf, editStart, editList, thrownAway, originalsGivenUp}`. `samples` are the arrays of `../../data.ts`, every sample of the train split, which the recipe's steps take in the place of the train part of the standard set:

```ts
// `base` are the tables that a run starts from, and `tables` the ones that its search ended with.
const {samples} = loadNeutralSet()
const classes = classesChosenFromTrainSamples(samples)
const trainData = packForTwin(samples, placesForTwin(samples, 'train'), undefined, base)
const searchSamples = prepareSamples(samples, base)
const counted = displayEntriesByCount(tables, samples)
```

`samples.seed` is the neutral seed, 20261016, and `samples.index` the neutral index, so a function that makes a sample of the arrays again from the dataset does not fit, e.g. `loadIntendedObjects`. `neutralSampleAt(seed, index).sample` is the sample as the dataset's type. The cache file is in `<RECOVERY_SCRATCH>/neutral-damage/cache`, 139 MB, and its name holds a key of the dataset's sources and of the generator's two files.

## What the check proves

`check.ts` makes all 40,457 samples itself and ends with "Every check passed.":

- **The label of every kept code point is the original's.** 10,113,389 kept code points are each the code point of the original that they are aligned with, in the original's order, and 29,823,160 scored values of their labels are what `ownLabels` of the dataset's `check-samples.ts` gives, a JSON parser that shares no code with the labels. None of the 386,334 added code points has a label.
- **What is not scored is what the dataset's rules say**, by the dataset's second derivation (`sampleProblems`), which also finds every sample's edits, alignment, first damage and first error right. In 628 samples it reads a copy after the text's start as text before the whole original, see "The labels", and that one sentence is not counted. The two pieces of code that `neutral.ts` copies, since the dataset and `data.ts` do not export them, give the same as the originals on samples of the standard set.
- **Every sample has a first error inside its text and something to score**, is rejected by `JSON.parse` and by the parser as it is, and keeps the dataset's limits.
- **No original belongs to the validation or test split or to the held-out template.** Each is one valid document of the train split, the first document of a broken train sample of the standard set, and none is a document of a validation sample or has the tokens of one. The test split is never read: a document's split is a function of its tokens, so a train document is the original of no test sample.
- **Nothing in the edits reads JSON.** `neutral-edits.ts` imports nothing but the type of the random source, and with every code point but the line feed renamed, the same draws give the same edits and the same kept code points, for 20,000 originals.
- **The set has the form that the trainer and the search take**: all 40,457 samples pack for the twin and prepare for the search.

## The set next to the standard train set

The standard train set has 40,457 broken samples, 31,428 damaged documents and 9,029 typing texts. 37,381 of them have something to score, and those are the second column: a sample with nothing to score trains nothing.

| | the neutral set | the standard train set |
| --- | --- | --- |
| samples | 40,457 | 37,381 |
| scored code points | 5,204,180 | 5,545,145 |
| scored code points per sample: mean, and what a half of the samples stay at or below | 128.6, 108 | 148.3, 133 |
| code points from the first damage to the first error: mean, a half, nine tenths | 17.3, 1, 51 | 1.5, 0, 4 |
| no run of the plain table parser has every scored depth and container right | 17.0% | 5.9% |
| the same for every scored display kind | 6.5% | 2.9% |
| the bound of the plain table parser: scored code points, whole samples | 89.05%, 77.9% | 97.80%, 91.9% |
| the damage adds or removes an odd number of quotes, by a rough count | 42.2% | 14.5% |
| the damage adds or removes more opening than closing brackets, or the other way round, by a rough count | 23.7% | 5.9% |
| character classes that the recipe's rule picks from the set | none | 11 |

20,926 samples have one edit (51.7%), 14,288 two (35.3%) and 5,243 three (13.0%). 83,737 draws made them and 43,280 were thrown away (51.7%): 22,556 were still valid JSON, 16,585 left nothing to score, 2,135 were too long, 1,910 had no place for an edit, 51 were unchanged and 43 too deep. The 300 draws of each of the 37 originals that gave no sample are not among them.

| edit | share of the 65,231 edits in the samples | a draw of this one edit alone is kept |
| --- | --- | --- |
| delete one code point | 8.6% | 27.1% |
| insert one code point | 10.4% | 42.6% |
| replace one code point | 12.0% | 53.3% |
| swap two neighbours | 9.0% | 31.0% |
| delete a run | 13.9% | 70.0% |
| duplicate a run | 13.8% | 70.0% |
| copy a run to another place | 15.2% | 80.2% |
| delete one line | 6.2% | 22.5% |
| duplicate one line | 7.0% | 20.5% |
| cut the tail | 3.9% | 0.0% |

**Kinds of the dataset by chance.** By a rough rule (`kindByChance` in `stats.ts`), 36.5% of the samples with one edit are also a text of one of the dataset's kinds, which is 18.9% of the set: `middleCutOut` 20.5%, since a deleted run or line is that kind's form "a short span with nothing in its place", `typingSlip` 4.7%, `unescapedQuote` 1.7%, `missingOpeningQuote` 1.6%, `headMissing` 1.5%, `openStringMidLine` 1.4%, `missingColon` 1.0%, `missingComma` 0.8%, `numberFormat` 0.8%, `missingCloser` 0.6%, and ten more kinds with 0.4% or less each. The dataset's most frequent kinds are rare here, e.g. `trailingComma` is 5 samples.

## What a reader sees

From a close reading of the samples 0 to 115 of `samples.txt`:

- **No label mistake.** Every labeled code point is one of the original with that label, the blanks are exactly the inserted, replacing, swapped and copied code points, and a `?` stands where a rule of the dataset says so.
- **More than a half of the samples ask for labels that a reader from the left cannot give.** A copied or deleted run with one quote in it turns every later quote of the line around, and in a text on one line every later quote of the text, e.g. `"port": 9229," "skipFiles": [` after an inserted quote, with 259 scored code points behind it. An inserted `[`, or a duplicated line that ends with `{`, puts every later depth one off. By the two rough counts of the table, one of the two holds for 58.0% of the neutral samples and 19.4% of the standard ones. The dataset flags such forms as out of reach or leaves their display kinds out of the score, and here they are scored.
- **The first error often comes late.** A copy can leave a text that reads as valid JSON for a long stretch, e.g. the line `"dependencies": {` twice opens a nested object, and the first error is 111 code points later. What the parser as it is reads otherwise before that error is not scored, as in the dataset.
- **The rule that picks character classes picks none from this set**, where it picks 11 from the standard train set, e.g. the apostrophe. The rule looks for a code point that is something else after an error than the rest of its class, as the apostrophe is when it stands for a quote, and no neutral edit makes a code point stand for another one.

## Files

- `neutral-edits.ts`: the ten edits and the draw of a sample's edits.
- `neutral.ts`: `neutralSampleAt`, `loadNeutralSet`, the originals, the labels and the arrays.
- `check.ts`, `stats.ts`, `dump.ts`: the check, the numbers and the text files for reading.
- `recipe.ts`, `run.ts`, `check-recipe.ts`: what is trained on the set, see `README.md`.
