# combinatrix

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/combinatrix) [![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/combinatrix) [![Release](https://img.shields.io/github/v/release/ExaDev/combinatrix)](https://github.com/ExaDev/combinatrix/releases/latest) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/combinatrix/ci.yml?branch=main)](https://github.com/ExaDev/combinatrix/actions)

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

`predicate` states a constraint as a function, for what a rule cannot say, here that the two architectures must be equal. It must read only the dimensions it names, and it answers nothing until they are all assigned. `diagnose` counts the solution set and lists the values no combination takes: no native build reaches `riscv64`.

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

By default `count`, `collect` and `diagnose` run to the end, however large the solution set is. A `limit` states how large a result the caller will accept: reaching it is fine, and going past it throws `LimitExceededError` as soon as it is passed, so `collect` never materialises more than the limit and `count` stops searching. The error's `bound` says what the limit bounded, here the solution set, and its message is worded from it.

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

  console.log(error.bound);
  console.log(error.message);
}
/*
solution-set
the solution set has more than 5 combinations
*/
```

A limit says nothing about how long a search takes, which depends on how much the constraints prune. To bound that, pass an abort signal, such as an `AbortSignal`: the search stops and throws the signal's reason, and nothing partial is returned. This one aborts from inside a predicate, so the run does not depend on timing; a caller would more often pass `AbortSignal.timeout(ms)` or the signal of a request it serves.

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

The enumeration order is fixed, so a position in it is enough to find a combination without producing the ones before it. `at` returns the combination at an index, or `undefined` past the end, and `indexOf` gives the index of a combination, or `-1` for one `explain` would refuse. `samples` draws combinations uniformly at random through a function you pass, which returns an integer below the bound it is given, so a seeded generator makes the sample reproducible. None of them keeps more than one combination in memory, so they page through and sample a solution set too large to `collect`.

```ts
// examples/09-paging.ts
import { at, choice, count, defineModel, indexOf, samples } from "combinatrix";

const model = defineModel({
  dimensions: [
    choice("os", ["linux", "macos", "windows"]),
    choice("arch", ["x64", "arm64"]),
    choice("runtime", [undefined, "node", "bun"]),
  ],
  rules: [{ name: "bun is not offered on windows", excludes: { is: ["os", "windows"] }, when: { is: ["runtime", "bun"] } }],
});

const size = count(model);
console.log(at(model, size - 1)?.values);
/*
{ os: 'windows', arch: 'arm64', runtime: 'node' }
*/

console.log(at(model, size));
/*
undefined
*/

console.log(indexOf(model, { os: "macos", arch: "x64", runtime: "bun" }));
/*
8
*/

console.log(indexOf(model, { os: "windows", arch: "x64", runtime: "bun" }));
/*
-1
*/

// A seeded generator (Park and Miller's minimal standard), so the sample is the same every run.
const MODULUS = 2_147_483_647;
const MULTIPLIER = 48_271;
const SEED = 20_261_029;
let state = SEED;
const random = (bound: number): number => {
  state = (state * MULTIPLIER) % MODULUS;

  return Math.floor((state / MODULUS) * bound);
};

const SAMPLE_SIZE = 3;
let drawn = 0;
for (const { values } of samples(model, { random })) {
  console.log(values);
  drawn += 1;
  if (drawn === SAMPLE_SIZE) break;
}
/*
{ os: 'macos', arch: 'x64', runtime: undefined }
{ os: 'windows', arch: 'arm64', runtime: undefined }
{ os: 'macos', arch: 'arm64', runtime: undefined }
*/
```

A model's types reach its results as well as its inputs. A computed dimension given the dimensions it reads, rather than their names, receives each value with that dimension's own type, so `values.os` below can only be one of its three systems. Each reason `explain` gives is a union keyed by dimension, so testing `reason.dimension` narrows `reason.value` and `reason.expected` to that dimension's values, and the dead values `diagnose` lists narrow the same way.

```ts
// examples/10-typed.ts
import { choice, collect, computed, defineModel, explain } from "combinatrix";

const os = choice("os", ["linux", "macos", "windows"]);
const arch = choice("arch", ["x64", "arm64"]);

const model = defineModel({
  dimensions: [
    os,
    arch,
    // Given as the dimensions themselves, the reads arrive with their own value types.
    computed("target", { reads: [os, arch], compute: (values) => `${values.arch}-${values.os === "macos" ? "apple-darwin" : values.os}` }),
  ],
  rules: [{ name: "no arm64 on windows", excludes: { all: [{ is: ["os", "windows"] }, { is: ["arch", "arm64"] }] } }],
});

console.log(collect(model).map(({ values }) => values.target));
/*
[
  'x64-linux',
  'arm64-linux',
  'x64-apple-darwin',
  'arm64-apple-darwin',
  'x64-windows'
]
*/

const explanation = explain(model, { os: "windows", arch: "arm64", target: "x64-windows" });
if (!explanation.valid) {
  for (const reason of explanation.reasons) {
    // Testing the dimension narrows the value to that dimension's own values.
    if (reason.kind === "derived" && reason.dimension === "target") console.log(reason.expected);
    if (reason.kind === "constraint") console.log(reason.rule?.name);
  }
}
/*
arm64-windows
no arm64 on windows
*/
```

A model kept in a JSON file takes the untyped route: `parseModel` validates the data against the shape the JSON Schema describes, defines the model it states, and throws `ModelError` listing every defect, as `defineModel` does for one written in code. Unset is not a JSON value, so a dimension is unset only where its `activeWhen` does not hold; the dimension names and values are known only at runtime, so a combination's type is a record of scalars or `undefined` and `explainData` checks a record against the model.

```ts
// examples/11-json-model.ts
import { collect, ModelError, parseModel } from "combinatrix";

// The contents of a model file. JSON has no `undefined`, so a dimension is unset only where its `activeWhen` does not hold.
const text = `{
  "dimensions": [
    { "kind": "choice", "name": "os", "values": ["linux", "windows"] },
    { "kind": "choice", "name": "compress", "values": [true, false] },
    { "kind": "first-valid", "name": "codec", "candidates": ["zstd", "brotli"], "activeWhen": { "is": ["compress", true] } }
  ],
  "rules": [{ "name": "windows has no zstd", "excludes": { "is": ["codec", "zstd"] }, "when": { "is": ["os", "windows"] } }]
}`;

const data: unknown = JSON.parse(text);
const model = parseModel(data);

for (const { values } of collect(model)) console.log(values);
/*
{ os: 'linux', compress: true, codec: 'zstd' }
{ os: 'linux', compress: false, codec: undefined }
{ os: 'windows', compress: true, codec: 'brotli' }
{ os: 'windows', compress: false, codec: undefined }
*/

// A rule naming a dimension the model lacks is refused, with every such defect listed.
try {
  parseModel({ dimensions: [{ kind: "choice", name: "os", values: ["linux"] }], rules: [{ requires: { set: "arch" } }] });
} catch (error) {
  if (!(error instanceof ModelError)) throw error;

  for (const issue of error.issues) console.log(issue);
}
/*
rule 0 mentions unknown dimension "arch"
constraint 0 depends on unknown dimension "arch"
*/
```

A strategy chooses which combinations of the solution set to produce, and `coveringArray` chooses few: valid combinations such that every combination of values of any `strength` dimensions that some valid combination contains appears in at least one of them. At strength 2 that is every pair of values, so a test matrix needs far fewer rows than the whole solution set while still exercising each pair. Pairs no valid combination contains are not required, and `isCoveringArray` checks the result against the solution set by brute force.

```ts
// examples/12-covering-array.ts
import { choice, collect, count, coveringArray, defineModel, isCoveringArray } from "combinatrix";

const model = defineModel({
  dimensions: [
    choice("os", ["linux", "macos", "windows"]),
    choice("arch", ["x64", "arm64"]),
    choice("runtime", ["node", "bun", "deno"]),
  ],
  rules: [{ name: "bun is not offered on windows", excludes: { is: ["runtime", "bun"] }, when: { is: ["os", "windows"] } }],
});

const rows = collect(model, { strategy: coveringArray({ strength: 2 }) }).map(({ values }) => values);

console.log(count(model), rows.length);
/*
16 8
*/

for (const row of rows) console.log(row);
/*
{ os: 'linux', arch: 'x64', runtime: 'node' }
{ os: 'linux', arch: 'arm64', runtime: 'bun' }
{ os: 'macos', arch: 'x64', runtime: 'bun' }
{ os: 'macos', arch: 'arm64', runtime: 'node' }
{ os: 'windows', arch: 'x64', runtime: 'deno' }
{ os: 'windows', arch: 'arm64', runtime: 'node' }
{ os: 'linux', arch: 'arm64', runtime: 'deno' }
{ os: 'macos', arch: 'x64', runtime: 'deno' }
*/

console.log(isCoveringArray(rows, model, { strength: 2, limit: 16 }));
/*
true
*/
```

## API

### Typed and untyped routes

A model written in code is checked by the compiler as far as its types can show: domains are non-empty, dimension names are unique, every rule, condition, `activeWhen`, computed `reads` and `predicate` names only dimensions declared where it may (before it, or before a first-valid dimension it constrains) and compares each with values from that dimension's own domain, testing `unset` only where the dimension's type includes `undefined`, and `explain` takes exactly one of the model's combinations (`CombinationOf<typeof model>`). A refused `defineModel` argument names each defect in an `error` property it lacks.

The results are typed by the same dimensions. `explain`'s reasons and `diagnose`'s dead values are unions keyed by dimension, so testing `dimension` narrows `value`. A computed dimension's `compute` and a `predicate`'s `test` receive exactly the dimensions in `reads`, each with its own value type where `reads` gives the dimension itself, and as any `Value` where it gives only a name; `defineModel` refuses a `compute` whose parameter does not accept every value its reads can hold. A strategy typed `Strategy<CombinationOf<typeof model>>` passes typed assignments to `completions` and `test`, gets typed combinations back and must yield them, and is refused for a model of another type.

What the types cannot show stays a runtime check. Whether the rules can be satisfied and which values are dead needs a search, so that stays with `diagnose`. A strategy's assignment map types its keys and its values but cannot pair each key with its own dimension's values, so a value another dimension takes agrees with no combination; and every row a strategy yields is still checked against the model, typed or not. A dimension given to a standalone `predicate` as itself is held to its own values when the predicate is evaluated, since a strategy's `test` can pass anything. A record that bypasses the types of `explain` or `indexOf` (a cast, or untyped JavaScript) is refused at runtime rather than explained: `explain` throws `TypeError`.

Data the compiler cannot see takes the untyped route, checked at runtime with every defect reported: a whole model read from JSON goes through `parseModel(data)`, which throws `ModelError` or returns the model; rules parsed from JSON for dimensions written in code go through `parseRules(dimensions, data)`, which throws `ModelError` or returns them typed for `defineModel`; a record goes through `explainData(model, data)`, whose reasons name dimensions as strings and type what is not even a value as `unknown`; a domain built at runtime is narrowed with `isNonEmpty(values)`. A part typed only as `string`, `Condition` or a third-party `Constraint` is accepted by the compiler and checked by `defineModel` when the model is defined, which repeats every check at runtime because data can bypass the types.

### Dimensions

- `choice(name, values, options?)`: a free dimension over `values`, in order. Include `undefined` to make unset one of the choices.
- `sampled(name, sampler, options?)`: a free dimension whose values are the finite points `sampler()` returns, called once when the model is defined. This is the only way a continuous range enters a model.
- `firstValid(name, candidates, options?)`: a derived dimension resolved to the first candidate no constraint rejects. Every constraint that mentions it may otherwise mention only dimensions declared before it; a combination with no acceptable candidate is not in the solution set.
- `computed(name, { reads, compute, activeWhen? })`: a derived dimension computed by a pure function of the dimensions in `reads`, each declared before it and given by name or as the dimension itself. `compute` receives exactly those dimensions, each typed by its own values when given as itself.

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

`defineModel({ dimensions, rules?, constraints? })` checks the model and returns it, typed so that each combination's type is inferred from the dimensions. It throws `ModelError` listing every defect: data that is not well formed (an unknown or misspelt key, a wrong type, a malformed condition), duplicate or empty names, empty domains, repeated or non-JSON values, references to unknown or later dimensions, a rule comparing a dimension with a value it can never take, and a first-valid dimension constrained together with a dimension declared after it.

`parseModel(data)` is the same for a model that is JSON data: it throws `ModelError` for data that is not the shape the JSON Schema describes (`isModelData(value)` is that check as a guard for `ModelData`) and otherwise for every refusal `defineModel` makes. It returns a `Model` whose combinations map each name to a scalar or `undefined`. `defineModel` with literals gives a type to each name and domain, so `explain` refuses a misspelt dimension or an impossible value at compile time; the parsed model has only the runtime checks of `explainData` and `isTuple`.

### JSON Schema

The package ships `schemas/combinatrix.schema.json`, a JSON Schema (draft 2020-12) for the data a configuration file holds: a model with `choice` and `firstValid` dimensions over literal values, `activeWhen` conditions and rules; a list of rules; a single rule; or a single condition. Its `$id` names the package version it ships in, and each definition (`Model`, `Rules`, `Rule`, `Condition`) can be validated against on its own, such as `combinatrix.schema.json#/$defs/Rules`. A rules file for a model with `os`, `arch` and `runtime` dimensions looks like this:

```json
[
  { "excludes": { "is": ["os", "windows"] }, "when": { "is": ["runtime", "bun"] }, "name": "bun is not offered on windows" },
  { "implies": [{ "is": ["arch", "arm64"] }, { "not": { "is": ["os", "windows"] } }], "unless": { "is": ["runtime", "node"] } }
]
```

To have an editor check such files, map their names to the schema in its settings, for example VS Code's `json.schemas` with the `fileMatch` pattern `*.rules.json` and the `url` `./node_modules/combinatrix/schemas/combinatrix.schema.json`. To validate in code, import it through the package's `exports` (`combinatrix/schemas/combinatrix.schema.json`) and give it to a draft 2020-12 validator such as Ajv's `ajv/dist/2020`. To load a model file without a validator, give its parsed contents to `parseModel`, which needs no schema at runtime; `parseRules` loads a rules file for dimensions written in code.

The schema covers only what is data. Computed dimensions, `sampled` domains, `predicate` and every other constraint given through the constraint contract are functions and are not described, and unset is not a JSON value, so a dimension is unset only through `activeWhen`. It states the shape, not what depends on the whole model: that names are unique and that every condition names a dimension and a value the model has are checked by `defineModel`, and `parseModel` and `parseRules` check them for a model file and a rules file. A test requires the schema and `isCondition`, `isRule`, `isModelData`, `parseModel`, `parseRules` and `defineModel` to accept and refuse the same data, and `pnpm build` regenerates the file from the Zod definitions in `scripts/`, which are a development dependency only.

### Enumerating

- `combinations(model, { strategy?, limit?, signal? })`: a generator of `{ id, values }`, computing nothing until advanced. The order is deterministic: for `full`, lexicographic in declaration order with the first dimension varying slowest. The id is the 64-bit FNV-1a hash of the combination's canonical form, so equal combinations have equal ids whatever produced them. An aborted `signal` makes the next advance throw its reason.
- `collect(model, { strategy?, limit?, signal? })`: the same as an array. With a `limit` it throws `LimitExceededError` rather than materialising more than that; with none it materialises the whole selection, so memory grows with the size of the solution set.
- `count(model, { limit?, signal? })`: the size of the solution set without building it, throwing `LimitExceededError` as soon as the count passes `limit` when one is given. The count of the dimensions after a point depends only on the frontier there: the values of the dimensions before it that a constraint, condition or computed dimension after it still reads. Each frontier state is counted once and remembered for the rest of the call, so the work grows with the number of distinct frontier states rather than with the solution set, and loosely coupled constraints (a chain between neighbouring dimensions, say) are counted in work polynomial in the number of dimensions where the solution set is exponential. A suffix of dimensions that no constraint, condition or candidate list touches is counted as a product without being visited.

### Random access and sampling

The order `combinations` produces with `full` is fixed, so each combination has an index in it. These functions find one from the other by counting the combinations under each choice on one path from the root, never by producing the combinations before it, so their memory does not grow with the solution set. Each counts at most one subtree per option of each dimension on that path, and a subtree whose remaining dimensions no constraint, condition or candidate list touches is counted as a product without being visited, and any other subtree is counted as `count` counts it, with one memo of frontier states shared along the path. An index is exact only while counts stay within `Number.MAX_SAFE_INTEGER`, and a count past it throws `RangeError` rather than giving a rank that may have been rounded.

- `at(model, index, { signal? })`: the combination at `index` as `{ id, values }`, equal to the one `combinations(model)` produces there, or `undefined` when the solution set has `index` combinations or fewer. An index that is not a non-negative integer throws `RangeError`; a negative one does not count from the end.
- `indexOf(model, combination, { signal? })`: the index of a combination, so that `at` returns it, or `-1` when it is not in the solution set, exactly when `explain` answers `valid: false` (call it for the reasons). The combination is typed as for `explain`.
- `indexOfData(model, data, { signal? })`: the same for untyped data, `-1` exactly when `explainData` refuses it. Derived dimensions may be left out.
- `samples(model, { random, signal? })`: a generator of combinations drawn uniformly at random, independently and with replacement, without end; the caller stops it. `random(bound)` returns an integer at least 0 and below `bound`, and is the only source of randomness, so a seeded one makes the draws reproducible. The solution set is counted once, on the first advance, and each draw is one `at`. An empty solution set yields nothing, and a `random` that returns anything else throws `RangeError`.

### Diagnostics

- `explain(model, combination)`: `{ valid: true, id }`, or `{ valid: false, reasons }` with every reason the combination is not in the solution set: a value set on an inactive dimension, an active conditional dimension left unset when its values do not list unset, a derived value that differs from the derived one, a first-valid dimension with no acceptable candidate, and each constraint that rejects it (with the rule it states, when it is a rule). It returns `Explanation<CombinationOf<typeof model>>`, whose reasons are keyed by dimension.
- `explainData(model, data)`: the same for untyped data, also reporting data that is not an object, an unknown or missing dimension, a value outside its domain (never passed on to a constraint) and something that is not a value at all. Derived dimensions may be left out. It returns a `DataExplanation`, whose `DataReason`s name dimensions as strings.
- `diagnose(model, { limit?, signal? })`: `{ status: "empty" }` when nothing satisfies the model, otherwise `{ status: "satisfiable", count, deadValues }` listing every domain value and candidate that no combination takes, each a `DeadValue` keyed by dimension. It counts as `count` does and finds the dead values from the same remembered counts (a value is dead when nothing is counted under it wherever it is offered), so it costs about as much as `count` and never produces the combinations.

### Errors

Every error extends `CombinatrixError`: `ModelError`, `LimitExceededError` (with the `limit` and the `bound` it limited: `solution-set` for `count`, `diagnose` and `full`, `selection` for what another strategy selects, and `rows` or `steps` for a strategy's own cap, each with its own message), `ConstraintContractError` and `StrategyError`. A limit or index that is not a non-negative integer throws `RangeError`, as do a count past `Number.MAX_SAFE_INTEGER` where an exact index is needed and a `random` source that returns anything but an integer below its bound.

### Cancellation

`count`, `collect`, `diagnose`, `combinations`, `at`, `indexOf`, `indexOfData` and `samples` take an optional `signal`, typed `AbortSignalLike`: `aborted`, `reason` and `throwIfAborted()`, declared by the library so that a real `AbortSignal` satisfies it in every runtime and a consumer compiles without the DOM library or a runtime's type package. When it aborts they throw `signal.reason`, as `signal.throwIfAborted()` does, and return nothing: `collect` returns no array and `diagnose` no diagnosis. A signal that is already aborted throws before any work, on the first advance for `combinations` and `samples`. The search reads the signal at a fixed interval of steps, a step being one visit to a node of the search tree, so a bounded amount of work runs after the abort; `combinations` also checks it before producing each combination, and `samples` before each draw.

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

`predicate({ reads, test, name? })` is the built-in escape hatch: it answers `unknown` until every dimension in `reads` is assigned and then calls `test` with their values. It is sound for any function that reads only what it declared, but it is not serialisable and cannot prune early, so prefer rules where they can say it. Written as `constraints: ({ predicate }) => [predicate({ reads, test })]`, it is bound to the model and `test` receives each read dimension's own value type. The standalone form passes each dimension given in `reads` as itself with its own value type, answering `invalid` without calling `test` for a value it cannot hold, and each one given by name as a plain `Value`.

### Strategies

A strategy chooses which combinations to produce:

```ts
interface Strategy<T extends ValueRecord = ValueRecord> {
  readonly name: string;
  readonly select: (context: StrategyContext<T>) => Iterable<T>;
}
```

The context carries the model's `dimensions` and `constraints`, `test(assignment)` for the combined three-valued verdict of every constraint on a partial assignment, and `completions(assignment?)` for the solution set's combinations that agree with a partial assignment, lazily and in order. `full` yields every completion. The context also carries the caller's `signal`, when there is one: `completions` honours it already, and a strategy that searches in any other way calls `signal.throwIfAborted()` at a bounded interval of its own steps so that the throw carries the signal's reason. A strategy that caps what it holds or does throws `new LimitExceededError(limit, bound)` naming what it capped, `rows` or `steps`, so the message is about that and not the solution set. `coveringArray` is a strategy of this kind, and a sampling strategy from another package implements the same interface; every record it yields is checked with `explainData`, and one outside the solution set throws `StrategyError`.

`T` is the type of one combination of the model. `Strategy`, unparameterised, is written for any model: its assignments are `ReadonlyMap<string, Value>` and its rows `ValueRecord`. `Strategy<CombinationOf<typeof model>>` is written for one model: its assignments and rows are typed by that model's dimensions, and passing it with a model of another type is a compile error.

### Covering arrays

`coveringArray({ strength, limit? })` is a strategy yielding a covering array of the solution set: valid combinations such that every `strength`-way combination of dimension values that occurs in some valid combination occurs in some yielded row. A strength of 1 covers each value, 2 covers each pair and 3 each triple; a strength above the dimension count covers every dimension at once, which is the whole solution set. Every dimension is covered, derived ones and unset included, and coverage is defined against the solution set only, so a combination of values no valid combination contains is not required.

The construction is in-parameter-order (IPOG, Lei et al., 2007), with constraint handling done by the engine as in Yu et al. (2013): it never reads the solution set, but asks `completions` for the first combination agreeing with a partial assignment, so the constraints prune as they do for enumeration. Its memory is the rows under construction and one count per distinct `strength`-way combination of them, which is polynomial in the dimension count for a fixed strength and independent of the size of the solution set. The array is built in full before the first row is yielded, and the same model always gives the same rows in the same order. `limit` bounds the rows held, and the strategy throws `LimitExceededError` with the bound `rows` past it; a `strength` that is not a positive integer or a `limit` that is not a non-negative integer throws `RangeError` when the strategy is made.

`isCoveringArray(rows, model, { strength, limit })` is the brute-force definition, written apart from the construction so that it can check it: whether every row is a complete combination in the solution set and every `strength`-way combination of values the solution set contains occurs in some row. It enumerates the whole solution set, throwing `LimitExceededError` past `limit` combinations, so it is for tests and small models, not for the models the strategy exists to cover.

## Development

Node 22 or later, pnpm. ESM only.

| Script | |
| --- | --- |
| `pnpm lint` / `pnpm lint:check` | ESLint, fixing / check only |
| `pnpm typecheck` | `tsc` |
| `pnpm test` | Vitest, tests colocated as `*.unit.test.ts` |
| `pnpm build` | tsdown into `dist`, then `schemas/combinatrix.schema.json` from `scripts/generate-json-schema.ts` |

CI also runs `pnpm exec publint` and `pnpm exec attw --pack --profile esm-only` on the build, and installs the packed tarball into a scratch project on each supported Node line to exercise the public API and to compile a TypeScript consumer against it with no DOM library and no type packages, so the published types depend on neither.

## Releases

Commits follow Conventional Commits and are checked by commitlint. Releases are cut by semantic-release from `main` in CI and published to npm with provenance through trusted publishing.

`CLAUDE.md` and `AGENTS.md` are symlinks to this file.
