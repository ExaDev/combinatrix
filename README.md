# combinatrix

Lazily enumerates every valid combination of option dimensions: a typed set of choices, declarative constraints between them, values derived from the others and dimensions that only matter when another is set, with a stable id for each combination and a reason for each one left out.

It has no runtime dependencies and imports nothing runtime-specific, so it runs in Node, Deno, Bun, workers and browsers alike.

```sh
pnpm add combinatrix
```

## The idea

A model is a finite-domain constraint model. Each dimension has a finite domain, the Cartesian product of the domains is every conceivable combination, and the constraints restrict it. What `combinations` enumerates is the solution set of that model: the subset of the product (a relation, in the mathematical sense) that satisfies every constraint.

Three things make the solution set the one you mean rather than the raw product:

- Unset is a value like any other. A dimension that may be left out lists `undefined` in its domain, and a combination then has the key with the value `undefined`, never a sentinel string.
- A derived dimension is part of every combination without being a free choice: it is the first of an ordered list of candidates that the constraints accept, or a function of dimensions before it.
- A dimension can be active only under a condition. While inactive it is collapsed to unset, so combinations that would differ only in a value that has no effect are listed once.

Constraints are evaluated three-valued on partial assignments, answering valid, invalid or unknown. The search assigns dimensions in declaration order and abandons a branch as soon as a constraint answers invalid, which is sound because every constraint is monotone: a definite answer on a partial assignment is the answer on every completion of it. A naive generate-then-filter enumeration is kept as the reference, and the search is tested to produce exactly its output, in the same order.

## Example

```ts
import { choice, collect, count, defineModel, explain, firstValid } from "combinatrix";

const model = defineModel({
  dimensions: [
    choice("mode", [undefined, "token"]),
    choice("targetRatio", [undefined, 0.5, 0.3]),
    choice("interceptors", [undefined, true]),
    choice("maturation", [undefined, true]),
    // Only needed when a feature is on, then the least channel that unlocks it.
    firstValid("channel", [undefined, "beta", "canary", "dev"], { activeWhen: { any: [{ set: "interceptors" }, { set: "maturation" }] } }),
  ],
  rules: [
    { name: "interceptors need canary or dev", requires: { in: ["channel", ["canary", "dev"]] }, when: { is: ["interceptors", true] } },
    { name: "maturation needs beta or dev", requires: { in: ["channel", ["beta", "dev"]] }, when: { is: ["maturation", true] } },
  ],
});

count(model, { limit: 1000 }); // 24
for (const { id, values } of collect(model, { limit: 1000 })) {
  values.channel; // "beta" | "canary" | "dev" | undefined, inferred from the dimensions
}
explain(model, { mode: "token", targetRatio: undefined, interceptors: true, maturation: undefined, channel: "beta" });
// { valid: false, reasons: [{ kind: "derived", dimension: "channel", value: "beta", expected: "canary" }, { kind: "constraint", rule: { name: "interceptors need canary or dev", ... }, ... }] }
```

## API

### Dimensions

- `choice(name, values, options?)`: a free dimension over `values`, in order. Include `undefined` to make unset one of the choices.
- `sampled(name, sampler, options?)`: a free dimension whose values are the finite points `sampler()` returns, called once when the model is defined. This is the only way a continuous range enters a model.
- `firstValid(name, candidates, options?)`: a derived dimension resolved to the first candidate no constraint rejects. Every constraint that mentions it may otherwise mention only dimensions declared before it; a combination with no acceptable candidate is not in the solution set.
- `computed(name, { reads, compute, activeWhen? })`: a derived dimension computed by a pure function of the dimensions in `reads`, each declared before it.

`options.activeWhen` is a condition on dimensions declared before this one. Where it does not hold, the dimension is unset, and its type gains `undefined`.

Values are JSON scalars (string, finite number, boolean, `null`) or `undefined` for unset. Two values are equal when their JSON forms are, so `0` and `-0` are one value and `null` is never unset.

### Conditions and rules

A condition is JSON-shaped data:

| Condition | Holds when |
| --- | --- |
| `{ is: [dimension, value] }` | the dimension is set to the value |
| `{ in: [dimension, values] }` | the dimension is set to one of the values |
| `{ set: dimension }` | the dimension is set to anything |
| `{ unset: dimension }` | the dimension is unset |
| `{ all: [...] }`, `{ any: [...] }`, `{ not: condition }` | conjunction, disjunction, negation |

A rule is one of `{ requires: condition }`, `{ excludes: condition }` or `{ implies: [antecedent, consequent] }`, optionally scoped with `when` and `unless` conditions and labelled with `name`. Rules and conditions are evaluated with Kleene's three-valued logic, so a test on an unassigned dimension is unknown and an `any` with one true operand is true whatever the others are. `isRule(value)` and `isCondition(value)` check data read from JSON before it is passed to `defineModel`.

### Models

`defineModel({ dimensions, rules?, constraints? })` checks the model and returns it, typed so that each combination's type is inferred from the dimensions. It throws `ModelError` listing every defect: duplicate or empty names, empty domains, repeated or non-JSON values, references to unknown or later dimensions, a rule comparing a dimension with a value it can never take, and a first-valid dimension constrained together with a dimension declared after it.

### Enumerating

- `combinations(model, { strategy?, limit? })`: a generator of `{ id, values }`, computing nothing until advanced. The order is deterministic: for `full`, lexicographic in declaration order with the first dimension varying slowest. The id is the 64-bit FNV-1a hash of the combination's canonical form, so equal combinations have equal ids whatever produced them.
- `collect(model, { limit, strategy? })`: the same as an array, throwing `LimitExceededError` rather than materialising more than `limit`.
- `count(model, { limit })`: the size of the solution set without building it, throwing `LimitExceededError` as soon as the count passes `limit`. A suffix of dimensions that no constraint, condition or candidate list touches is counted as a product without being visited.

### Diagnostics

- `explain(model, record)`: `{ valid: true, id }`, or `{ valid: false, reasons }` with every reason the record is not in the solution set: an unknown or missing dimension, a value outside its domain, a value set on an inactive dimension, a derived value that differs from the derived one, a first-valid dimension with no acceptable candidate, and each constraint that rejects it (with the rule it states, when it is a rule). Derived dimensions may be left out of the record.
- `diagnose(model, { limit })`: `{ status: "empty" }` when nothing satisfies the model, otherwise `{ status: "satisfiable", count, deadValues }` listing every domain value and candidate that no combination takes.

### Errors

Every error extends `CombinatrixError`: `ModelError`, `LimitExceededError` (with the `limit`), `ConstraintContractError` and `StrategyError`. A limit that is not a non-negative integer throws `RangeError`.

## Extending

### The constraint contract

Another constraint language plugs in by implementing `Constraint`:

```ts
interface Constraint {
  readonly dependencies: readonly string[];
  readonly evaluate: (assignment: ReadonlyMap<string, Value>) => "valid" | "invalid" | "unknown";
  readonly name?: string;
}
```

The assignment maps each assigned dimension to its value; a dimension absent from the map is unassigned, and one mapped to `undefined` is set to unset. An implementation names every dimension it reads in `dependencies`, is pure, and is monotone: a `valid` or `invalid` answer on a partial assignment must hold for every extension of it, so answering `unknown` is always safe before every dependency is assigned. Once every dependency is assigned it must answer `valid` or `invalid`; `unknown` then throws `ConstraintContractError`. Pass implementations as `constraints` to `defineModel`.

`predicate({ reads, test, name? })` is the built-in escape hatch: it answers `unknown` until every dimension in `reads` is assigned and then calls `test` with their values. It is sound for any function that reads only what it declared, but it is not serialisable and cannot prune early, so prefer rules where they can say it.

### Strategies

A strategy chooses which combinations to produce:

```ts
interface Strategy {
  readonly name: string;
  readonly select: (context: StrategyContext) => Iterable<Readonly<Record<string, Value>>>;
}
```

The context carries the model's `dimensions` and `constraints`, `test(assignment)` for the combined three-valued verdict of every constraint on a partial assignment, and `completions(assignment?)` for the solution set's combinations that agree with a partial assignment, lazily and in order. `full` yields every completion. A covering-array or sampling strategy from another package implements the same interface; every record it yields is checked with `explain`, and one outside the solution set throws `StrategyError`.

## Development

Node 22 or later, pnpm. ESM only.

| Script | |
| --- | --- |
| `pnpm lint` / `pnpm lint:check` | ESLint, fixing / check only |
| `pnpm typecheck` | `tsc` |
| `pnpm test` | Vitest, tests colocated as `*.unit.test.ts` |
| `pnpm build` | tsdown into `dist` |

CI also runs `pnpm exec publint` and `pnpm exec attw --pack --profile esm-only` on the build, and installs the packed tarball into a scratch project on each supported Node line to exercise the public API.

## Releases

Commits follow Conventional Commits and are checked by commitlint. Releases are cut by semantic-release from `main` in CI and published to npm with provenance through trusted publishing.

`CLAUDE.md` and `AGENTS.md` are symlinks to this file.
