// HELD BACK. Whoever builds the tables, the train data, the recovery parser, the twins or the bars does not read
// this file, see ../README.md.
//
// What the valid programs of this set are written from: 16 sorts of small programs, each a list of pieces. A piece
// is one or more definitions in plain miniml, the way one person might write them, e.g. the price of a line of an
// order. programs.ts draws pieces of one sort, changes them and lays them out.
//
// Two things in a piece are not miniml:
// - `{a|b|c}` stands for one of the texts a, b and c, drawn anew for every program, e.g. `{8|19|21}`.
// - Two pieces are separated by an empty line, so a piece has none.
// Nothing checks names in miniml, so the pieces call `first`, `rest`, `isEmpty`, `toString` and others as if a
// library had them.
//
// None of the pieces is taken from the train data's generator: its sorts are functions over lists, arithmetic
// helpers, settings, tests and so on, and its names are short ones in lower case with `_`. The sorts here are
// about a shop, shapes, dates, a text report, a board game, functions that take functions, a bank account,
// sensors, roads, a cipher, tasks, the fields of a form, vectors, a search tree, a recipe and a vending machine.

export const sortNames = [
  'shop', 'shapes', 'dates', 'textReport', 'boardGame', 'functionPipes', 'account', 'sensors', 'roads', 'cipher', 'tasks', 'form', 'vectors', 'searchTree', 'recipe',
  'vendingMachine',
] as const
export type SortName = typeof sortNames[number]

export const piecesOfSort: Record<SortName, string> = {
  shop: `
let taxPercent = {8|19|21|7}

let unitPrices = [("apple", {40|35}); ("pear", {55|60}); ("plum", {25|30})]

let lineTotal quantity unitPrice = quantity * unitPrice

let withTax amount = amount + amount * taxPercent / 100

let discountFor quantity =
  if quantity >= {100|50} then {15|20}
  else if quantity >= {20|10} then {5|8}
  else 0

let priceAfterDiscount amount percent = amount - amount * percent / 100

let rec cartTotal cart =
  if isEmpty cart then 0
  else
    let entry = first cart in
    let cost = lineTotal (fst entry) (snd entry) in
    cost + cartTotal (rest cart)

let receiptLine name amount = name ^ ": " ^ toString amount ^ {" EUR"|" USD"|" kr"|" €"}

let isFreeShipping total = total >= {5000|2500} || total = 0

let cheapest left right = if snd left <= snd right then left else right

let orderSummary cart =
  let total = cartTotal cart in
  let taxed = withTax total in
  ("total", total, "with tax", taxed)

let applyCoupon code amount =
  if code = "HALF" then amount / 2
  else if code = "TEN" then amount - 10
  else amount

let basket = [(2, 40); (1, 55); ({3|6}, 25)]

let shippingCost weight distance =
  let base = {250|300|199} in
  let perKilo = weight * {40|35} in
  if distance > {100|500} then base + perKilo * 2 else base + perKilo

let () = printLine (receiptLine "total" (withTax (cartTotal basket)))

let inStock name stock = lookup name stock 0 > 0

let restock amount entry = (fst entry, snd entry + amount)
`,
  shapes: `
let origin = (0, 0)

let makePoint x y = (x, y)

let squaredDistance p q =
  let dx = fst p - fst q in
  let dy = snd p - snd q in
  dx * dx + dy * dy

let rectangleArea width height = width * height

let perimeter width height = 2 * (width + height)

let isSquare width height = width = height

let insideBox point corner size =
  fst point >= fst corner && fst point < fst corner + size && snd point >= snd corner && snd point < snd corner + size

let translate offset point = (fst point + fst offset, snd point + snd offset)

let scale factor point = (factor * fst point, factor * snd point)

let corners left top width height =
  [(left, top); (left + width, top); (left + width, top + height); (left, top + height)]

let manhattan p q = abs (fst p - fst q) + abs (snd p - snd q)

let quadrant point =
  if fst point >= 0 then (if snd point >= 0 then 1 else 4)
  else if snd point >= 0 then 2
  else 3

let boundingBox points =
  let xs = map fst points in
  let ys = map snd points in
  (minimum xs, minimum ys, maximum xs, maximum ys)

let midpoint p q = ((fst p + fst q) / 2, (snd p + snd q) / 2)

let triangleArea base height = base * height / 2

let unitSquare = corners 0 0 1 1

let mirror point = (-fst point, snd point)

let overlaps a b = fst a < snd b && fst b < snd a

let describeShape sides =
  if sides = 3 then "triangle"
  else if sides = 4 then "rectangle"
  else if sides > 4 then "polygon"
  else "line"
`,
  dates: `
let daysInWeek = 7

let isLeapYear year =
  (year / 4 * 4 = year && year / 100 * 100 <> year) || year / 400 * 400 = year

let daysInMonth year month =
  if month = 2 then (if isLeapYear year then 29 else 28)
  else if month = 4 || month = 6 || month = 9 || month = 11 then 30
  else 31

let monthNames = ["Jan"; "Feb"; "Mar"; "Apr"; "May"; "Jun"; "Jul"; "Aug"; "Sep"; "Oct"; "Nov"; "Dec"]

let monthName month = nth monthNames (month - 1)

let rec daysBefore year month =
  if month <= 1 then 0
  else daysInMonth year (month - 1) + daysBefore year (month - 1)

let dayOfYear year month day = daysBefore year month + day

let isWeekend weekday = weekday = 6 || weekday = 7

let pad2 number = if number < 10 then "0" ^ toString number else toString number

let formatDate year month day = toString year ^ "-" ^ pad2 month ^ "-" ^ pad2 day

let nextDay year month day =
  if day < daysInMonth year month then (year, month, day + 1)
  else if month < 12 then (year, month + 1, 1)
  else (year + 1, 1, 1)

let minutesSinceMidnight hour minute = hour * 60 + minute

let season month =
  if month <= 2 || month = 12 then "winter"
  else if month <= 5 then "spring"
  else if month <= 8 then "summer"
  else "autumn"

let weekdayNames = ["Mon"; "Tue"; "Wed"; "Thu"; "Fri"; "Sat"; "Sun"]

let formatTime hour minute = pad2 hour ^ ":" ^ pad2 minute

let isBefore earlier later =
  let earlierDay = dayOfYear (first3 earlier) (second earlier) (third earlier) in
  let laterDay = dayOfYear (first3 later) (second later) (third later) in
  earlierDay < laterDay

let launchDay = ({2024|2025|1999}, {3|11}, {14|28})
`,
  textReport: `
let columnWidth = {12|16|20}

let rec repeat text times = if times <= 0 then "" else text ^ repeat text (times - 1)

let padRight text width =
  let missing = width - stringLength text in
  if missing > 0 then text ^ repeat " " missing else text

let padLeft text width = repeat " " (width - stringLength text) ^ text

let heading title = title ^ "\\n" ^ repeat {"="|"-"|"~"} (stringLength title)

let row label value = padRight label columnWidth ^ padLeft (toString value) 8

let bullet text = {" - "|" * "|"   "} ^ text

let quoted text = "\\"" ^ text ^ "\\""

let rec joinWith separator pieces =
  if isEmpty pieces then ""
  else if isEmpty (rest pieces) then first pieces
  else first pieces ^ separator ^ joinWith separator (rest pieces)

let footer pageNumber pageCount = "page " ^ toString pageNumber ^ " of " ^ toString pageCount

let table rows = joinWith "\\n" (map (fun entry -> row (fst entry) (snd entry)) rows)

let report = [heading {"Totals"|"Summary"|"Résumé"}; row "apples" {12|40}; row "pears" 7; footer 1 1]

let () = printLine (joinWith "\\n" report)

let truncate text limit =
  if stringLength text <= limit then text
  else substring text 0 (limit - 3) ^ "..."

let centered text width =
  let space = (width - stringLength text) / 2 in
  repeat " " space ^ text

let separatorLine = repeat "-" (columnWidth + 8)

let plural count word = if count = 1 then word else word ^ "s"

let countLabel count word = toString count ^ " " ^ plural count word
`,
  boardGame: `
let boardSize = {3|8|10}

let emptyBoard = [[0; 0; 0]; [0; 0; 0]; [0; 0; 0]]

let otherPlayer player = if player = 1 then 2 else 1

let cellAt board rowIndex columnIndex = nth (nth board rowIndex) columnIndex

let isFree board rowIndex columnIndex = cellAt board rowIndex columnIndex = 0

let allEqual a b c = a = b && b = c && a <> 0

let rowWinner cells = if allEqual (nth cells 0) (nth cells 1) (nth cells 2) then nth cells 0 else 0

let scoreFor roll =
  if roll = 6 then 10
  else if roll = 1 then -5
  else roll

let rec totalScore rolls = if isEmpty rolls then 0 else scoreFor (first rolls) + totalScore (rest rolls)

let nextTurn state =
  let player = fst state in
  let turn = snd state in
  (otherPlayer player, turn + 1)

let isGameOver turn winner = winner <> 0 || turn >= boardSize * boardSize

let describeWinner winner = if winner = 0 then "draw" else "player " ^ toString winner ^ " wins"

let clampToBoard position =
  if position < 0 then 0
  else if position >= boardSize then boardSize - 1
  else position

let move position step = clampToBoard (position + step)

let startingHand = [("hearts", 7); ("spades", 12); ("clubs", 3)]

let cardValue card = if snd card > 10 then 10 else snd card

let rolls = [{4; 6; 1|2; 2; 5; 6|3; 1}]

let bonus streak = if streak >= 3 then streak * {50|100} else 0

let _ = printLine (describeWinner (rowWinner [1; 1; 1]))
`,
  functionPipes: `
let identity value = value

let compose outer inner = fun value -> outer (inner value)

let twice step = compose step step

let flip combine = fun right left -> combine left right

let pipeline = [(fun value -> value + 1); (fun value -> value * 2); (fun value -> value - 3)]

let rec applyAll steps value =
  if isEmpty steps then value else applyAll (rest steps) ((first steps) value)

let constant value = fun _ -> value

let onBoth transform pair = (transform (fst pair), transform (snd pair))

let whenPositive handler = fun amount -> if amount > 0 then handler amount else ()

let counterFrom start = fun () -> start + 1

let curry combine = fun left right -> combine (left, right)

let uncurry combine = fun pair -> combine (fst pair) (snd pair)

let increment = fun value -> value + 1

let adder amount = fun value -> value + amount

let result = applyAll pipeline {5|10|42}

let withDefault fallback find key =
  let found = find key in
  if found = none then fallback else found

let rec iterate step times value = if times = 0 then value else iterate step (times - 1) (step value)

let both check other = fun value -> check value && other value

let either check other = fun value -> check value || other value

let tap effect = fun value -> let () = effect value in value
`,
  account: `
let openingBalance = {1000|250|0}

let deposit amount balance = balance + amount

let withdraw amount balance = if amount > balance then balance else balance - amount

let fee amount = if amount > {500|1000} then amount / 100 else 1

let transactions = [("deposit", 200); ("withdraw", 50); ("deposit", {75|80})]

let applyTransaction balance entry =
  let kind = fst entry in
  let amount = snd entry in
  if kind = "deposit" then deposit amount balance
  else if kind = "withdraw" then withdraw amount balance
  else balance

let rec settle balance entries =
  if isEmpty entries then balance
  else settle (applyTransaction balance (first entries)) (rest entries)

let isOverdrawn balance = balance < 0

let interest balance ratePercent = balance * ratePercent / 100

let statementLine entry = fst entry ^ " " ^ toString (snd entry)

let closingBalance = settle openingBalance transactions

let transfer amount source target =
  let taken = source - withdraw amount source in
  (source - taken, deposit taken target)

let _ = printLine ("balance: " ^ toString closingBalance)

let monthlyRate yearlyPercent = yearlyPercent / 12

let rec compound balance ratePercent months =
  if months = 0 then balance
  else compound (balance + interest balance ratePercent) ratePercent (months - 1)

let canAfford price balance = price <= balance && balance - price >= {0|100}

let owner = ("{Ada|Grace|Linus}", "{DE12|NO93|GB29}", openingBalance)
`,
  sensors: `
let alarmThreshold = {75|90|120}

let readings = [{21; 23; 22; 80; 19|18; 18; 95; 20|40; 41; 39}]

let clamp low high value = if value < low then low else if value > high then high else value

let rec sumOf values = if isEmpty values then 0 else first values + sumOf (rest values)

let average values =
  let count = listLength values in
  if count = 0 then 0 else sumOf values / count

let isAlarm value = value > alarmThreshold

let rec countAlarms values =
  if isEmpty values then 0
  else (if isAlarm (first values) then 1 else 0) + countAlarms (rest values)

let toFahrenheit celsius = celsius * 9 / 5 + 32

let status value =
  if value > alarmThreshold then "alarm"
  else if value > alarmThreshold - 10 then "warning"
  else "ok"

let rec largest values =
  if isEmpty (rest values) then first values
  else
    let candidate = largest (rest values) in
    if first values > candidate then first values else candidate

let smoothed previous current = (previous * 3 + current) / 4

let label index value = "sensor " ^ toString index ^ ": " ^ status value

let withUnit value = toString value ^ {"°C"|" C"|" degrees"}

let isStable previous current = abs (previous - current) <= {2|5}

let calibrate offset values = map (fun value -> value + offset) values

let () = printLine (label 1 (average readings))
`,
  roads: `
let roads = [("north", "mill"); ("mill", "bridge"); ("bridge", "market")]

let startsAt place road = fst road = place

let rec neighbours place remaining =
  if isEmpty remaining then []
  else if startsAt place (first remaining) then snd (first remaining) :: neighbours place (rest remaining)
  else neighbours place (rest remaining)

let rec contains wanted places =
  if isEmpty places then false
  else first places = wanted || contains wanted (rest places)

let rec pathLength path = if isEmpty path then 0 else 1 + pathLength (rest path)

let extend path place = place :: path

let isLoop path = contains (first path) (rest path)

let shorter left right = if pathLength left <= pathLength right then left else right

let describeRoad road = fst road ^ " -> " ^ snd road

let distances = [("mill", {4|6}); ("bridge", 9); ("market", {15|21})]

let rec lookup key table fallback =
  if isEmpty table then fallback
  else if fst (first table) = key then snd (first table)
  else lookup key (rest table) fallback

let tripCost fromPlace toPlace = abs (lookup toPlace distances 0 - lookup fromPlace distances 0)

let reversed road = (snd road, fst road)

let isDeadEnd place = isEmpty (neighbours place roads)

let home = "{north|harbour|mill}"

let fuelNeeded distance = distance * {7|8} / 100 + 1
`,
  cipher: `
let alphabetSize = 26

let shiftBy = {3|13|5}

let wrap code =
  if code >= alphabetSize then code - alphabetSize
  else if code < 0 then code + alphabetSize
  else code

let encodeLetter code = wrap (code + shiftBy)

let decodeLetter code = wrap (code - shiftBy)

let rec encodeAll codes = if isEmpty codes then [] else encodeLetter (first codes) :: encodeAll (rest codes)

let rec runLength symbol count remaining =
  if isEmpty remaining then [(symbol, count)]
  else if first remaining = symbol then runLength symbol (count + 1) (rest remaining)
  else (symbol, count) :: runLength (first remaining) 1 (rest remaining)

let checksum codes = sumOf codes - sumOf codes / 97 * 97

let isVowel letter = letter = "a" || letter = "e" || letter = "i" || letter = "o" || letter = "u"

let mask secret = repeat "*" (stringLength secret)

let rec pairUp left right =
  if isEmpty left || isEmpty right then []
  else (first left, first right) :: pairUp (rest left) (rest right)

let parity bits = sumOf bits - sumOf bits / 2 * 2

let secretMessage = [7; 4; 11; 11; 14]

let key = ("{rot|caesar}", shiftBy)

let roundTrip code = decodeLetter (encodeLetter code) = code

let xorBit left right = if left = right then 0 else 1
`,
  tasks: `
let tasks = [("backup", 3, false); ("email", 1, true); ("report", 2, false)]

let priorityOf task = second task

let isDone task = third task

let nameOf task = first3 task

let moreUrgent left right = if priorityOf left <= priorityOf right then left else right

let rec mostUrgent pending =
  if isEmpty (rest pending) then first pending
  else moreUrgent (first pending) (mostUrgent (rest pending))

let rec insertByPriority task queue =
  if isEmpty queue then [task]
  else if priorityOf task <= priorityOf (first queue) then task :: queue
  else first queue :: insertByPriority task (rest queue)

let markDone task = (nameOf task, priorityOf task, true)

let rec remaining queue =
  if isEmpty queue then 0
  else (if isDone (first queue) then 0 else 1) + remaining (rest queue)

let estimate task = priorityOf task * {15|30|45}

let deadlineLabel hoursLeft =
  if hoursLeft < 0 then "overdue"
  else if hoursLeft < 24 then "today"
  else if hoursLeft < 48 then "tomorrow"
  else "later"

let schedule queue task = insertByPriority task queue

let () = printLine (nameOf (mostUrgent tasks))

let newTask name = (name, {5|9}, false)

let workload queue = sumOf (map estimate queue)

let isUrgent task = priorityOf task <= 1 && isDone task = false
`,
  form: `
let minimumLength = {8|6|12}

let isBlank text = stringLength text = 0

let tooShort text = stringLength text < minimumLength

let checkName name = if isBlank name then Error "name is required" else Ok name

let checkAge age =
  if age < 0 then Error "age cannot be negative"
  else if age > 150 then Error "age is too high"
  else Ok age

let checkPassword password confirmation =
  if tooShort password then Error "password is too short"
  else if password <> confirmation then Error "passwords differ"
  else Ok password

let bothValid left right = if isOk left && isOk right then Ok (left, right) else Error "invalid form"

let messages = ["required"; "too short"; "too long"; "not a number"]

let describe outcome = if isOk outcome then "valid" else "invalid: " ^ reason outcome

let rec firstError checks =
  if isEmpty checks then none
  else if isOk (first checks) then firstError (rest checks)
  else first checks

let validateForm name age password =
  let nameCheck = checkName name in
  let ageCheck = checkAge age in
  let passwordCheck = checkPassword password password in
  firstError [nameCheck; ageCheck; passwordCheck]

let inRange low high value = low <= value && value <= high

let fields = [("name", true); ("email", true); ("phone", false)]

let isRequired field = snd field

let errorCount checks = listLength checks - countOk checks
`,
  vectors: `
let zeroVector = [0; 0; 0]

let identityMatrix = [[1; 0; 0]; [0; 1; 0]; [0; 0; 1]]

let rec dot left right =
  if isEmpty left then 0
  else first left * first right + dot (rest left) (rest right)

let rec addVectors left right =
  if isEmpty left then []
  else (first left + first right) :: addVectors (rest left) (rest right)

let rec scaleVector factor vector =
  if isEmpty vector then [] else factor * first vector :: scaleVector factor (rest vector)

let normSquared vector = dot vector vector

let rec transformBy matrix vector =
  if isEmpty matrix then [] else dot (first matrix) vector :: transformBy (rest matrix) vector

let isZero vector = normSquared vector = 0

let cross2 a b = fst a * snd b - snd a * fst b

let lerp start finish percent = start + (finish - start) * percent / 100

let negateVector vector = scaleVector (-1) vector

let trace matrix = cellAt matrix 0 0 + cellAt matrix 1 1 + cellAt matrix 2 2

let unitX = [1; 0; 0]

let weights = [{2; 3; 5|1; 1; 2|10; 20}]

let weightedSum values = dot weights values / sumOf weights
`,
  searchTree: `
let leaf = ("leaf", 0)

let node left value right = ("node", left, value, right)

let isLeaf tree = tagOf tree = "leaf"

let rec size tree =
  if isLeaf tree then 0
  else 1 + size (leftOf tree) + size (rightOf tree)

let rec height tree =
  if isLeaf tree then 0
  else
    let leftHeight = height (leftOf tree) in
    let rightHeight = height (rightOf tree) in
    1 + (if leftHeight > rightHeight then leftHeight else rightHeight)

let rec insert value tree =
  if isLeaf tree then node leaf value leaf
  else if value < valueOf tree then node (insert value (leftOf tree)) (valueOf tree) (rightOf tree)
  else node (leftOf tree) (valueOf tree) (insert value (rightOf tree))

let rec member value tree =
  if isLeaf tree then false
  else if value = valueOf tree then true
  else if value < valueOf tree then member value (leftOf tree)
  else member value (rightOf tree)

let rec toList tree =
  if isLeaf tree then [] else append (toList (leftOf tree)) (valueOf tree :: toList (rightOf tree))

let rec fromList values = if isEmpty values then leaf else insert (first values) (fromList (rest values))

let sample = fromList [{5; 2; 8; 1|7; 3|10; 4; 6}]

let singleton value = node leaf value leaf

let rec smallest tree = if isLeaf (leftOf tree) then valueOf tree else smallest (leftOf tree)

let isBalanced tree = abs (height (leftOf tree) - height (rightOf tree)) <= 1
`,
  recipe: `
let gramsPerOunce = 28

let millilitresPerCup = {240|250}

let ouncesToGrams ounces = ounces * gramsPerOunce

let cupsToMillilitres cups = cups * millilitresPerCup

let servings = {4|6|2}

let ingredients = [("flour", 500, "g"); ("milk", 300, "ml"); ("eggs", 3, "")]

let scaleAmount amount wanted = amount * wanted / servings

let describeIngredient item wanted =
  let amount = scaleAmount (second item) wanted in
  toString amount ^ third item ^ " " ^ first3 item

let ovenFahrenheit celsius = celsius * 9 / 5 + 32

let cookingMinutes weightInGrams = 20 + weightInGrams / 100 * {12|15}

let isMetric unit = unit = "g" || unit = "ml" || unit = "kg"

let roundTo step amount = (amount + step / 2) / step * step

let shoppingList wanted = map (fun item -> describeIngredient item wanted) ingredients

let title = "{Pancakes|Flatbread|Crêpes}"

let restMinutes = {30|45}

let totalMinutes weightInGrams = restMinutes + cookingMinutes weightInGrams

let () = printLine (title ^ ", ready in " ^ toString (totalMinutes 400) ^ " min")
`,
  vendingMachine: `
let initialState = ("idle", 0)

let price = {120|150|80}

let step state event =
  let mode = fst state in
  let credit = snd state in
  if event = "coin" then ("ready", credit + 50)
  else if event = "select" && credit >= price then ("vending", credit - price)
  else if event = "cancel" then ("idle", 0)
  else (mode, credit)

let rec run state events = if isEmpty events then state else run (step state (first events)) (rest events)

let changeFor credit = if credit > 0 then credit else 0

let display state = fst state ^ " (" ^ toString (snd state) ^ ")"

let nextLight colour =
  if colour = "red" then "green"
  else if colour = "green" then "amber"
  else "red"

let waitSeconds colour = if colour = "amber" then 3 else if colour = "red" then 30 else 25

let events = ["coin"; "coin"; "coin"; "select"]

let () =
  let final = run initialState events in
  printLine (display final)

let isIdle state = fst state = "idle"

let coins = [{10; 20; 50; 100|5; 10; 25}]

let accepts coin = contains coin coins

let refund state = ("idle", 0, changeFor (snd state))
`,
}

// Remarks for comments, per sort and for any sort. A remark holds no `*)`.
export const remarksOfSort: Record<SortName, readonly string[]> = {
  shop: ['prices are in cents', 'tax is added last', 'one entry per line of the order', 'rounded down'],
  shapes: ['points are pairs (x, y)', 'no square roots here', 'the top left corner comes first', 'sizes in pixels'],
  dates: ['months count from 1', 'Gregorian rules', 'Monday is day 1', 'no time zones'],
  textReport: ['columns are padded with spaces', 'one string per line', 'used by the weekly report', 'width in characters'],
  boardGame: ['0 is an empty cell', 'players are 1 and 2', 'rows first, then columns', 'a six counts double'],
  functionPipes: ['small helpers for functions', 'applied from left to right', 'nothing is evaluated twice', 'point-free on purpose'],
  account: ['amounts in cents', 'never below zero', 'fees are charged per transfer', 'the newest entry comes last'],
  sensors: ['degrees Celsius', 'one reading per minute', 'anything above the threshold rings', 'integer arithmetic only'],
  roads: ['one-way roads', 'places are plain names', 'distances from the north gate', 'no cycles expected'],
  cipher: ['letters are numbers from 0 to 25', 'not safe, only a puzzle', 'the same key both ways', 'short runs stay as they are'],
  tasks: ['1 is the most urgent', '(name, priority, done)', 'kept sorted', 'minutes, not hours'],
  form: ['shown under the field', 'checked in this order', 'the first failure wins', 'empty means missing'],
  vectors: ['rows of a matrix are lists', 'three dimensions', 'integer coordinates', 'no bounds checks'],
  searchTree: ['smaller values go left', 'duplicates go right', 'a leaf holds nothing', 'not rebalanced'],
  recipe: ['for four people', 'metric first', 'rounded to whole grams', 'the oven needs ten minutes more'],
  vendingMachine: ['credit in cents', 'one event at a time', 'unknown events change nothing', 'amber is short'],
}
export const remarksOfAnySort = [
  'TODO: handle the empty case', 'helper', 'see the notes', 'do not change without asking', 'temporary', 'entry point', 'defaults', 'kept for old callers', 'FIXME',
  'checked by hand', 'the order matters', 'same as above', 'returns a pair', 'main part', 'constants',
] as const
