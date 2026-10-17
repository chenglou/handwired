# Neural Lander

A two-axis rocket optimizes a six-second flight by differentiating through its own physics. The demo starts from 32 random thrust values; it has no pretrained controller or saved trajectory. Open it from the [Handwired demos page](https://chenglou.me/handwired/neural-lander/), run `bun ./assets/neural-lander.html` for a standalone development page, or run `bun start` to serve the full site.

## The circuit

The source table holds 16 pairs of bounded thrust commands and a horizontal target. Each command pair controls six of the 96 unrolled simulation steps (`dt = 1/16 s`). Initial position is `(0, 10 m)` and velocity is `(0, −1 m/s)`. The craft remains upright, with separate vertical and lateral thrust. Attitude and fuel mass are outside this model.

```text
ax = 4 ux                 ux ∈ [-1, 1]
ay = 8 uy − 4             uy ∈ [0, 1]
vx_next = vx + ax dt
vy_next = vy + ay dt
x_next  = x + vx_next dt
y_next  = y + vy_next dt
```

Gravity, thrust, integration, effort, ground penetration, and landing loss are Handwired operations. Semi-implicit Euler integration uses explicit FP32 boundaries. A squared loss penalizes final position and velocity, any path below ground, and unnecessary thrust:

```text
10 ((x_final − target)² + y_final²)
+ vx_final² + vy_final²
+ 20 mean(max(0, −y_step)²)
+ 0.001 mean(ux_command² + uy_command²)
```

Training calls `circuit.evaluateReference` and `circuit.backpropagateReference`. A TypeScript Adam optimizer updates only the 32 command inputs, with norm clipping and projection to their declared bounds. Moving the target keeps the same circuit, preserves the current commands, and resets the optimizer's moments.

The page reports operation, fixed-weight, and trainable-input counts from the compiled program. Its trajectory renderer reads circuit states and never performs a separate physics step.

## Outcomes and tests

Ground contact is classified outside the differentiable circuit at the first crossing of `y = 0`. Landing requires at most 0.25 m position error and 0.5 m/s impact speed. The loss penalizes steps below ground, but the physics graph itself remains differentiable. Airborne and crashed outcomes stay visible as failures.

Run the focused tests with `bun test --timeout 60000 ./tests/neural-lander/lander.test.ts`. They compare every circuit state with an independent float64 TypeScript physics reference, compare all 32 gradients with numerical differences, and exercise convergence across fixed seeds and target positions. They also cover retargeting, command bounds, first-impact classification, and reset behavior.
