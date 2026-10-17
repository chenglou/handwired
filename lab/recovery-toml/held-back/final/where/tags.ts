// Which mistakes of the two held-back sets the 49 kinds of the training side hold (../../../kinds/README.md), as one
// reader's judgment. The rows 7 and 8 trained on those kinds, and the rows 4 to 6 did not.
//
// The judgment was made by reading: for the generator, the forms of each kind in ../../specific/mistakes/ against
// the variants of the training kinds in ../../../kinds/; for the written set, every broken payload with its `from:`
// line and the line of ../../written/kinds.txt. Nothing checks it. The three answers:
// - 'held': a training kind makes this mistake in the same form, e.g. `port: 8080` is a form of colonForEquals.
// - 'near': training kinds make the parts of the mistake and not the whole, or make it in another form. E.g. a
//   table as a block of YAML is a name with a colon and entries with colons. The training side has the name with a
//   colon (headerForm) and entries with colons (colonForEquals), and never the two as one mistake.
// - 'none': no training kind makes it.
export type Held = 'held' | 'near' | 'none'
export type Tag = {held: Held, kinds: string}

// The generator's 36 kinds.
export const generatorTags: Record<string, Tag> = {
  colonForEquals: {held: 'held', kinds: 'colonForEquals'},
  doubledEquals: {held: 'held', kinds: 'otherAssignment (== => :=); the form "= =" is not there'},
  missingEquals: {held: 'held', kinds: 'missingEquals'},
  missingCommaInArray: {held: 'held', kinds: 'missingComma'},
  commaAtLineEnd: {held: 'held', kinds: 'lineEndSeparator'},
  trailingCommaInInlineTable: {held: 'held', kinds: 'trailingCommaInInlineTable'},
  unquotedString: {held: 'held', kinds: 'unquotedString'},
  missingClosingQuote: {held: 'held', kinds: 'missingClosingQuote'},
  missingOpeningQuote: {held: 'held', kinds: 'missingOpeningQuote'},
  typographicQuotes: {held: 'held', kinds: 'foreignQuotes'},
  twoQuotesCloseMultiLine: {held: 'none', kinds: 'left out on purpose by the training side'},
  lineFeedInString: {held: 'held', kinds: 'rawLineFeedInString (one quote at each end of a string between three quotes)'},
  unescapedBackslash: {held: 'held', kinds: 'unescapedBackslash'},
  missingHeaderBracket: {held: 'held', kinds: 'headerBracket'},
  unbalancedDoubleBracket: {held: 'held', kinds: 'headerBracket'},
  missingArrayBracket: {held: 'held', kinds: 'missingCloser'},
  missingCloseBrace: {held: 'held', kinds: 'missingCloser'},
  inlineTableOnSeveralLines: {held: 'held', kinds: 'inlineTableOnLines'},
  keyWithSpace: {held: 'held', kinds: 'bareKeyCharacter (a space in a key), headerForm (a space in a header)'},
  valueLeftOut: {held: 'held', kinds: 'equalsWithoutValue, keyAlone'},
  headerWithTrailingDot: {held: 'held', kinds: 'headerForm (a dot before or after the name)'},
  foreignLiteral: {held: 'held', kinds: 'foreignLiteral'},
  numberWithUnit: {held: 'held', kinds: 'numberFormat (a unit after the number)'},
  numberInAnotherForm: {held: 'held', kinds: 'numberFormat'},
  dateInAnotherForm: {held: 'held', kinds: 'dateFormat'},
  templatePlaceholder: {held: 'held', kinds: 'placeholderValue'},
  jsonPastedIn: {held: 'near', kinds: 'colonForEquals and lineEndSeparator apart; quotes around a key only inside an inline table; no braces around entries'},
  yamlBlock: {held: 'near', kinds: 'headerForm (the name and a colon, entries indented, with their equals signs) and colonForEquals apart'},
  yamlListItems: {held: 'near', kinds: 'arrayWithoutBrackets (a dash before every value, after "key =", only for an array on several lines)'},
  semicolonComment: {held: 'held', kinds: 'foreignComment'},
  slashComment: {held: 'held', kinds: 'foreignComment'},
  cutInTheMiddle: {held: 'near', kinds: 'ellipsis (a mark on a line of its own); a span cut out of the text is what the neutral edit deleteRun makes'},
  conflictMarkers: {held: 'held', kinds: 'conflictMarkers'},
  proseAround: {held: 'held', kinds: 'proseAround'},
  codeFence: {held: 'held', kinds: 'codeFence'},
  invisibleCharacter: {held: 'held', kinds: 'invisibleCharacter'},
}

const tag = (held: Held, kinds: string): Tag => ({held, kinds})

// The 150 written cases, by the number in their id.
const handEditing: Tag[] = [
  tag('near', 'missingClosingQuote, with an apostrophe left in the quote\'s place'),
  tag('held', 'missingClosingQuote'), tag('held', 'missingOpeningQuote'),
  tag('near', 'arrayWithoutBrackets has both brackets missing, here only the opening one'),
  tag('held', 'missingCloser'), tag('held', 'missingComma'), tag('held', 'missingComma'), tag('held', 'extraComma'), tag('held', 'missingEquals'),
  tag('held', 'otherAssignment'), tag('held', 'equalsWithoutValue'), tag('held', 'keyAlone'), tag('held', 'headerBracket'), tag('held', 'headerBracket'),
  tag('held', 'doubledQuote'), tag('held', 'doubledQuote'), tag('held', 'dateFormat'), tag('held', 'unquotedString'), tag('held', 'unquotedString'),
  tag('held', 'bareKeyCharacter'), tag('held', 'bareKeyCharacter'),
  tag('near', 'bareKeyCharacter, in a header\'s name'),
  tag('held', 'entriesOnOneLine (a header and its first entry)'),
  tag('near', 'entriesOnOneLine has an entry after a header, here a header after an entry'),
  tag('none', 'the start of a line is deleted'),
  tag('held', 'strayCloser'),
  tag('near', 'doubledQuote: a second value right after the first'),
  tag('held', 'unescapedBackslash'), tag('held', 'unescapedQuote'),
  tag('near', 'rawLineFeedInString has one quote at the start, here two'),
  tag('held', 'missingClosingQuote'),
  tag('near', 'commentWithoutHash, with a 3 in the place of the #'),
  tag('held', 'commentWithoutHash'),
  tag('near', 'headerForm (other brackets around a header), here only the closing one'),
  tag('held', 'headerForm (another sign between the parts of the name)'),
  tag('near', 'strayLine has the editor command on a line of its own, here it stands after a value'),
  tag('held', 'strayLine (a command of an editor)'),
  tag('held', 'missingCloser'), tag('held', 'missingCloser'), tag('held', 'missingCloser'),
  tag('none', 'an entry among the values of an array'),
  tag('none', 'a value after the closing bracket of its array'),
  tag('near', 'headerBracket (no opening bracket), with the bracket left alone on an earlier line'),
  tag('near', 'entriesOnOneLine and strayCloser as one mistake'),
  tag('held', 'missingComma: the comma stands inside the string'),
  tag('near', 'unquotedString, with quotes around the first word'),
  tag('held', 'rawLineFeedInString'),
  tag('near', 'foreignLiteral and halfTypedValue have other words that are no literal'),
  tag('held', 'headerForm, bareKeyCharacter (two dots in a row)'),
  tag('held', 'missingCloser'),
]
const modelAndPaste: Tag[] = [
  tag('near', 'proseAround and codeFence, here with every line indented'),
  tag('none', 'line ends written as a backslash and an n'),
  tag('held', 'proseAround'),
  tag('near', 'proseAround has a sentence, here two lines of a web page'),
  tag('near', 'codeFence and proseAround, here in the middle of the document'),
  tag('near', 'codeFence, here twice, with a name in bold before each'),
  tag('held', 'codeFence (an opening fence alone), missingClosingQuote'),
  tag('none', 'the link form of a chat program inside a header'),
  tag('near', 'commentWithoutHash after a value, here with an arrow before the remark'),
  tag('none', 'the marks of bold text around an entry'),
  tag('none', 'a backslash before every bracket and underscore'),
  tag('held', 'commentWithoutHash'), tag('held', 'ellipsis'),
  tag('near', 'ellipsis has [...] on a line, here the brackets hold a sentence'),
  tag('held', 'foreignComment'), tag('held', 'ellipsis'), tag('held', 'ellipsis'),
  tag('near', 'placeholderValue has other placeholders, ellipsis has the dots in other places'),
  tag('near', 'missingClosingQuote and an ellipsis character as one mistake'),
  tag('held', 'foreignQuotes'), tag('held', 'foreignQuotes'), tag('held', 'foreignQuotes'), tag('held', 'foreignQuotes'),
  tag('near', 'foreignQuotes has strings of one line, here three typographic quotes around a string of several lines'),
  tag('none', 'the text is only cut off: nothing to recover'),
  tag('none', 'a cut line and the same line again'),
  tag('near', 'proseAround and codeFence inside a string that was cut'),
  tag('near', 'entriesOnOneLine has an entry after a header, here a header after an entry'),
  tag('held', 'entriesOnOneLine (nothing between two entries)'),
  tag('near', 'proseAround (a file name before the document), here in the form of the command head, and twice'),
  tag('held', 'linePrefix (the number of every line)'), tag('held', 'linePrefix (the number of every line)'),
  tag('near', 'linePrefix has a number before every line, here before two lines, with an arrow'),
  tag('near', 'linePrefix, with the frame of a terminal tool around it'),
  tag('near', 'embeddedInCode and proseAround have other lines before and after the document'),
  tag('near', 'embeddedInCode (a here-document) and linePrefix (> before every line) as one mistake'),
  tag('near', 'linePrefix (> before every line) and proseAround as one mistake'),
  tag('near', 'linePrefix has other marks, here the prompts of Python, inside a string'),
  tag('near', 'linePrefix (a + before every line), with the head of a diff before it'),
  tag('near', 'linePrefix has a space before the other lines, here they start as they are'),
  tag('held', 'linePrefix (the lines of a diff hunk)'),
  tag('none', 'the JSON of a tool call around the document'),
  tag('none', 'the printed list of lines of Python around every line'),
  tag('held', 'codeFence, proseAround (a file name before the document)'),
  tag('near', 'strayLine (a note without a #), here two such lines'),
  tag('none', 'the date and the sender of a chat message before a line'),
  tag('none', 'a line end inside a key between quotes'),
  tag('near', 'terminalCodes, without the escape character'),
  tag('near', 'lineEndSeparator has a comma, a semicolon or a backslash, here a dollar sign'),
  tag('held', 'conflictMarkers'),
]
const otherNotations: Tag[] = [
  tag('held', 'colonForEquals'),
  tag('near', 'arrayWithoutBrackets (a dash before every value), here after "key:"'),
  tag('held', 'headerForm (the name and a colon, the entries indented)'),
  tag('held', 'strayLine (--- as the first line), foreignLiteral'),
  tag('none', 'the | of YAML for a string of several lines'),
  tag('held', 'unquotedString'), tag('held', 'unquotedString'),
  tag('near', 'headerForm and arrayWithoutBrackets, here an item of a YAML list for a header in double brackets'),
  tag('near', 'colonForEquals and lineEndSeparator, here a whole JSON object as the file'),
  tag('held', 'inlineTableOnLines'),
  tag('held', 'colonForEquals (an inline table as a JSON object)'),
  tag('held', 'foreignLiteral'),
  tag('held', 'colonForEquals, lineEndSeparator'),
  tag('held', 'foreignComment, foreignLiteral'),
  tag('none', 'the word export before two keys'),
  tag('held', 'bareKeyCharacter and headerForm (a space in a name)'),
  tag('held', 'missingEquals'), tag('held', 'unquotedString'), tag('held', 'foreignLiteral'), tag('held', 'otherBrackets'), tag('held', 'foreignQuotes (backticks)'),
  tag('held', 'stringInTwoParts'), tag('held', 'numberFormat (a suffix of a type)'), tag('held', 'lineEndSeparator'),
  tag('near', 'inlineTableAsBlock writes the same text, with the labels of an inline table: depth 1. Here the repair is a table with a header: depth 0'),
  tag('held', 'foreignComment'), tag('held', 'foreignComment, trailingCommaInInlineTable'), tag('held', 'foreignQuotes (a letter before the opening quote)'),
  tag('held', 'headerForm (a space and quotes in the place of a dot)'),
  tag('none', 'a here-document of a shell for a string of several lines'),
  tag('held', 'unquotedString'),
  tag('near', 'rawLineFeedInString, here with a backslash before the line end'),
  tag('none', 'a product of numbers in the place of a number'),
  tag('near', 'unknownEscape has the backslash in a string between quotes, here between apostrophes'),
  tag('held', 'numberFormat'), tag('held', 'numberFormat'), tag('held', 'numberFormat (a unit)'), tag('held', 'dateFormat'), tag('held', 'dateFormat'),
  tag('held', 'equalsWithoutValue'), tag('held', 'keyAlone'), tag('held', 'missingClosingQuote'), tag('held', 'missingCloser'), tag('held', 'missingClosingQuote'),
  tag('held', 'headerBracket'),
  tag('near', 'missingCloser and halfTypedValue have other cuts, here an inline table stops inside a key'),
  tag('held', 'halfTypedValue'),
  tag('none', 'a string of several lines that is not closed: nothing to recover'),
  tag('held', 'missingClosingQuote'),
  tag('held', 'entriesOnOneLine (a comma between two entries)'),
]

export const writtenTags: Record<string, Tag> = Object.fromEntries([['hand-editing', handEditing], ['model-and-paste', modelAndPaste], ['other-notations', otherNotations]].flatMap(([file, tags]) => {
  if ((tags as Tag[]).length !== 50) throw new Error(`the file ${file as string} has 50 cases, and ${(tags as Tag[]).length} have a tag`)
  return (tags as Tag[]).map((caseTag, index) => [`${file as string}-${String(index + 1).padStart(2, '0')}`, caseTag] as const)
}))

// The training kinds that no kind of the generator has in any form, by the same reading. The written set has cases
// for most of them.
export const trainingKindsWithoutAGeneratorKind = [
  'entriesOnOneLine', 'inlineTableAsBlock', 'extraComma', 'halfTypedValue', 'otherBrackets', 'doubledQuote', 'unescapedQuote', 'unknownEscape', 'stringInTwoParts',
  'valueOnNextLine', 'strayCloser', 'wrongCloser', 'commentWithoutHash', 'frontMatter', 'embeddedInCode', 'linePrefix', 'terminalCodes', 'carriageReturnLineEnds', 'strayLine',
]
