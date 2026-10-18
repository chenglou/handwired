# Handwired

Turn your regular JavaScript code into a neural net; no training, exact, yet also fully differentiable!

## How It Works

A program's made of if-else, loops, and state. Handwired transforms them into matrix multiplication + reglu over floats. For example:

```ts
const a = 5
const result = (a > 4) ? 10 : 12
```

The above can be expressed as basic arithmetic:

```ts
const a = 5
// Math.max(0, x) is ReLU. For an integer a, above4 is 1 if a > 4, and 0 otherwise
const above4 = Math.max(0, a - 4) - Math.max(0, a - 5)
// Both branches compute, and above4 picks one
const result = above4 * 10 + (1 - above4) * 12
```

You can calculate that by hand and see that both arrive at the same result.

We then collect the + and * and relu into a giant matmul, and either run it on JS or WebGPU, for fun.

Because we basically only use these 2 primitives:
- the full program stays differentiable
- the weights don't need training since they're written manually
- existing gpu techniques, such as fusion, sparsity, reordering, have a great time optimizing such minimal primitives

This unlocks lots of funny use-cases, like:
- unfreezing the weights and training them (what does that even do? Let's find out!)
- attaching a specific frozen program to a generic neural net and training end-to-end (now a nanoGPT can do both Shakespeare and your particular UI?)
- achieving GPU-level of parallelism with JS code that was written in a traditional single-threaded way (see the JSON search demo that runs in milliseconds over 100k documents)

## Play With It

Try the demos live: https://chenglou.me/handwired/

`git clone && bun install`, then `bun start` to run them locally. Check `docs/`, `src/` and `template/` to get started! (`lab/` is a bunch of old experiments you can check or ignore)

![HandwiredOS](assets/demos-handwiredos.webp)
