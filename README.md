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

## Examples

Each example is a file in `examples/` that the test suite runs, and the block comment after each statement that prints is what it printed, so the output shown is always the real output.

A model is a list of dimensions. With only `choice` dimensions the solution set is the Cartesian product of their domains, and `combinations` produces it lazily: nothing is computed past the combination you stop at, and the first dimension varies slowest.

```ts
// examples/01-combinations.ts
import { choice, combinations, count, defineModel } from "combinatrix";

const model = defineModel({
  dimensions: [
    choice("os", ["linux", "macos", "windows"]),
    choice("arch", ["x64", "arm64"]),
  ],
});

console.log(count(model));
/*
6
*/

for (const { values } of combinations(model)) console.log(values);
/*
{ os: 'linux', arch: 'x64' }
{ os: 'linux', arch: 'arm64' }
{ os: 'macos', arch: 'x64' }
{ os: 'macos', arch: 'arm64' }
{ os: 'windows', arch: 'x64' }
{ os: 'windows', arch: 'arm64' }
*/
```

Putting `undefined` in a domain lets a dimension be left out. A combination then has the key with the value `undefined`: it means "left out" and is a value like any other, never a sentinel string.

```ts
// examples/02-unset.ts
import { choice, collect, count, defineModel } from "combinatrix";

const model = defineModel({
  dimensions: [
    choice("os", ["linux", "macos", "windows"]),
    choice("arch", ["x64", "arm64"]),
    choice("runtime", [undefined, "node", "bun"]),
  ],
});

console.log(count(model));
/*
18
*/

const [first] = collect(model);
console.log(first?.values);
/*
{ os: 'linux', arch: 'x64', runtime: undefined }
*/
```

A rule removes combinations. This one excludes the Windows combinations, but only when the runtime is `bun` (`requires` states what must hold instead, and `implies` links two conditions). `explain` takes a combination of the model (a misspelt dimension or a value outside a domain does not compile; `explainData` takes untyped data) and says whether it is in the solution set, and if not, why: `constraint` is the compiled constraint and `rule` is the rule as written.

```ts
// examples/03-rules.ts
import { choice, count, defineModel, explain } from "combinatrix";

const model = defineModel({
  dimensions: [
    choice("os", ["linux", "macos", "windows"]),
    choice("arch", ["x64", "arm64"]),
    choice("runtime", [undefined, "node", "bun"]),
  ],
  rules: [{ name: "bun is not offered on windows", excludes: { is: ["os", "windows"] }, when: { is: ["runtime", "bun"] } }],
});

console.log(count(model));
/*
16
*/

console.dir(explain(model, { os: "windows", arch: "x64", runtime: "bun" }), { depth: null });
/*
{
  valid: false,
  reasons: [
    {
      kind: 'constraint',
      index: 0,
      constraint: {
        dependencies: [ 'runtime', 'os' ],
        evaluate: [Function: evaluate],
        name: 'bun is not offered on windows'
      },
      rule: {
        name: 'bun is not offered on windows',
        excludes: { is: [ 'os', 'windows' ] },
        when: { is: [ 'runtime', 'bun' ] }
      }
    }
  ]
}
*/
```

`firstValid` declares a derived dimension: not a free choice but the first candidate that no rule rejects, so the preferred codec comes first. `activeWhen` makes it take part only when `compress` is set, and otherwise it is unset, so an uncompressed build is listed once and not once per codec. Windows rejects `zstd`, so the codec derived there is `brotli`.

```ts
// examples/04-derived.ts
import { choice, collect, defineModel, firstValid } from "combinatrix";

const model = defineModel({
  dimensions: [
    choice("os", ["linux", "windows"]),
    choice("compress", [undefined, true]),
    // The preferred codec first; the one chosen is the first that no rule rejects.
    firstValid("codec", ["zstd", "brotli", "gzip"], { activeWhen: { set: "compress" } }),
  ],
  rules: [{ name: "windows has no zstd", excludes: { is: ["codec", "zstd"] }, when: { is: ["os", "windows"] } }],
});

for (const { values } of collect(model)) console.log(values);
/*
{ os: 'linux', compress: undefined, codec: undefined }
{ os: 'linux', compress: true, codec: 'zstd' }
{ os: 'windows', compress: undefined, codec: undefined }
{ os: 'windows', compress: true, codec: 'brotli' }
*/
```

`predicate` states a constraint as a function, for what a rule cannot say, here that the two architectures must be equal. It must read only the dimensions it names, and it answers nothing until they are all assigned. `diagnose` searches the whole solution set and lists the values no combination takes: no native build reaches `riscv64`.

```ts
// examples/05-predicate.ts
import { choice, count, defineModel, diagnose, predicate } from "combinatrix";

const model = defineModel({
  dimensions: [choice("buildArch", ["x64", "arm64"]), choice("targetArch", ["x64", "arm64", "riscv64"])],
  constraints: [
    predicate({
      reads: ["buildArch", "targetArch"],
      name: "builds are native",
      test: ({ buildArch, targetArch }) => buildArch === targetArch,
    }),
  ],
});

console.log(count(model));
/*
2
*/

console.log(diagnose(model));
/*
{
  status: 'satisfiable',
  count: 2,
  deadValues: [ { dimension: 'targetArch', value: 'riscv64' } ]
}
*/
```

The last example puts all of it together in the shape of a measurement matrix: unset values, a `channel` that is derived and only takes part when one of two features is on, and two rules that restrict it. The record given to `explain` names the weakest channel, `beta`, for a feature that needs `canary` or `dev`, so there are two reasons: `beta` is not the channel derived for those settings, and it breaks the rule.

```ts
// examples/06-advanced.ts
import { choice, count, defineModel, explain, firstValid } from "combinatrix";

const model = defineModel({
  dimensions: [
    choice("mode", [undefined, "token"]),
    choice("ratio", [undefined, "moderate", "aggressive"]),
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

console.log(count(model));
/*
24
*/

console.dir(explain(model, { mode: "token", ratio: undefined, interceptors: true, maturation: undefined, channel: "beta" }), { depth: null });
/*
{
  valid: false,
  reasons: [
    {
      kind: 'derived',
      dimension: 'channel',
      value: 'beta',
      expected: 'canary'
    },
    {
      kind: 'constraint',
      index: 0,
      constraint: {
        dependencies: [ 'interceptors', 'channel' ],
        evaluate: [Function: evaluate],
        name: 'interceptors need canary or dev'
      },
      rule: {
        name: 'interceptors need canary or dev',
        requires: { in: [ 'channel', [ 'canary', 'dev' ] ] },
        when: { is: [ 'interceptors', true ] }
      }
    }
  ]
}
*/
```

By default `count`, `collect` and `diagnose` run to the end, however large the solution set is. A `limit` states how large a result the caller will accept: reaching it is fine, and going past it throws `LimitExceededError` as soon as it is passed, so `collect` never materialises more than the limit and `count` stops searching.

```ts
// examples/07-limit.ts
import { choice, collect, count, defineModel, LimitExceededError } from "combinatrix";

const model = defineModel({
  dimensions: [
    choice("os", ["linux", "macos", "windows"]),
    choice("arch", ["x64", "arm64"]),
  ],
});

console.log(count(model, { limit: 6 }));
/*
6
*/

try {
  collect(model, { limit: 5 });
} catch (error) {
  if (!(error instanceof LimitExceededError)) throw error;

  console.log(error.message);
}
/*
the solution set has more than 5 combinations
*/
```

A limit says nothing about how long a search takes, which depends on how much the constraints prune. To bound that, pass an `AbortSignal`: the search stops and throws the signal's reason, and nothing partial is returned. This one aborts from inside a predicate, so the run does not depend on timing; a caller would more often pass `AbortSignal.timeout(ms)` or the signal of a request it serves.

```ts
// examples/08-cancellation.ts
import { choice, count, defineModel, isNonEmpty, predicate } from "combinatrix";

const SIZE = 1000;
const ABORT_AT = 10;
const values = Array.from({ length: SIZE }, (_, index) => index);
// A list built at runtime is typed number[], so it is narrowed to a non-empty domain first.
if (!isNonEmpty(values)) throw new Error("SIZE is positive");
const controller = new AbortController();
let evaluations = 0;

const model = defineModel({
  dimensions: [choice("n", values)],
  constraints: [
    predicate({
      reads: ["n"],
      test: () => {
        evaluations += 1;
        // Abort from inside the search, so the run is the same every time.
        if (evaluations === ABORT_AT) controller.abort(new Error("enough"));

        return true;
      },
    }),
  ],
});

try {
  count(model, { signal: controller.signal });
} catch (error) {
  console.log(error === controller.signal.reason);
}
/*
true
*/

console.log(evaluations < SIZE);
/*
true
*/
```

## API

### Typed and untyped routes

A model written in code is checked by the compiler as far as its types can show: domains are non-empty, dimension names are unique, every rule, condition, `activeWhen`, computed `reads` and `predicate` names only dimensions declared where it may (before it, or before a first-valid dimension it constrains) and compares each with values from that dimension's own domain, testing `unset` only where the dimension's type includes `undefined`, and `explain` takes exactly one of the model's combinations (`CombinationOf<typeof model>`). A refused `defineModel` argument names each defect in an `error` property it lacks. Whether the rules can be satisfied and which values are dead needs a search, so that stays with `diagnose` at runtime.

Data the compiler cannot see takes the untyped route, checked at runtime with every defect reported: rules parsed from JSON go through `parseRules(dimensions, data)`, which throws `ModelError` or returns them typed for `defineModel`; a record goes through `explainData(model, data)`; a domain built at runtime is narrowed with `isNonEmpty(values)`. A part typed only as `string`, `Condition` or a third-party `Constraint` is accepted by the compiler and checked by `defineModel` when the model is defined, which repeats every check at runtime because data can bypass the types.

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

A rule is one of `{ requires: condition }`, `{ excludes: condition }` or `{ implies: [antecedent, consequent] }`, optionally scoped with `when` and `unless` conditions and labelled with `name`. Rules and conditions are evaluated with Kleene's three-valued logic, so a test on an unassigned dimension is unknown and an `any` with one true operand is true whatever the others are. `{ unset: dimension }` is refused for a dimension that can never be unset. A rule written apart from the model is typed `TypedRule<CombinationOf<typeof model>>` (or `TypedRule<TupleOf<typeof dimensions>>`); `isRule(value)` and `isCondition(value)` check only the shape of data.

### Models

`defineModel({ dimensions, rules?, constraints? })` checks the model and returns it, typed so that each combination's type is inferred from the dimensions. It throws `ModelError` listing every defect: duplicate or empty names, empty domains, repeated or non-JSON values, references to unknown or later dimensions, a rule comparing a dimension with a value it can never take, and a first-valid dimension constrained together with a dimension declared after it.

### Enumerating

- `combinations(model, { strategy?, limit?, signal? })`: a generator of `{ id, values }`, computing nothing until advanced. The order is deterministic: for `full`, lexicographic in declaration order with the first dimension varying slowest. The id is the 64-bit FNV-1a hash of the combination's canonical form, so equal combinations have equal ids whatever produced them. An aborted `signal` makes the next advance throw its reason.
- `collect(model, { strategy?, limit?, signal? })`: the same as an array. With a `limit` it throws `LimitExceededError` rather than materialising more than that; with none it materialises the whole selection, so memory grows with the size of the solution set.
- `count(model, { limit?, signal? })`: the size of the solution set without building it, throwing `LimitExceededError` as soon as the count passes `limit` when one is given. A suffix of dimensions that no constraint, condition or candidate list touches is counted as a product without being visited.

### Diagnostics

- `explain(model, combination)`: `{ valid: true, id }`, or `{ valid: false, reasons }` with every reason the combination is not in the solution set: a value set on an inactive dimension, an active conditional dimension left unset when its values do not list unset, a derived value that differs from the derived one, a first-valid dimension with no acceptable candidate, and each constraint that rejects it (with the rule it states, when it is a rule).
- `explainData(model, data)`: the same for untyped data, also reporting data that is not an object, an unknown or missing dimension, a value outside its domain (never passed on to a constraint) and something that is not a value at all. Derived dimensions may be left out.
- `diagnose(model, { limit?, signal? })`: `{ status: "empty" }` when nothing satisfies the model, otherwise `{ status: "satisfiable", count, deadValues }` listing every domain value and candidate that no combination takes.

### Errors

Every error extends `CombinatrixError`: `ModelError`, `LimitExceededError` (with the `limit`), `ConstraintContractError` and `StrategyError`. A limit that is not a non-negative integer throws `RangeError`.

### Cancellation

`count`, `collect`, `diagnose` and `combinations` take an optional `signal: AbortSignal`. When it aborts they throw `signal.reason`, as `signal.throwIfAborted()` does, and return nothing: `collect` returns no array and `diagnose` no diagnosis. A signal that is already aborted throws before any work, on the first advance for `combinations`. The search reads the signal at a fixed interval of steps, a step being one visit to a node of the search tree, so a bounded amount of work runs after the abort; `combinations` also checks it before producing each combination.

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

`predicate({ reads, test, name? })` is the built-in escape hatch: it answers `unknown` until every dimension in `reads` is assigned and then calls `test` with their values. It is sound for any function that reads only what it declared, but it is not serialisable and cannot prune early, so prefer rules where they can say it. Written as `constraints: ({ predicate }) => [predicate({ reads, test })]`, it is bound to the model and `test` receives each read dimension's own value type; the standalone form passes plain `Value`s.

### Strategies

A strategy chooses which combinations to produce:

```ts
interface Strategy {
  readonly name: string;
  readonly select: (context: StrategyContext) => Iterable<Readonly<Record<string, Value>>>;
}
```

The context carries the model's `dimensions` and `constraints`, `test(assignment)` for the combined three-valued verdict of every constraint on a partial assignment, and `completions(assignment?)` for the solution set's combinations that agree with a partial assignment, lazily and in order. `full` yields every completion. The context also carries the caller's `signal`, when there is one: `completions` honours it already, and a strategy that searches in any other way calls `signal.throwIfAborted()` at a bounded interval of its own steps so that the throw carries the signal's reason. A covering-array or sampling strategy from another package implements the same interface; every record it yields is checked with `explainData`, and one outside the solution set throws `StrategyError`.

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
