## [2.0.1](https://github.com/ExaDev/combinatrix/compare/v2.0.0...v2.0.1) (2026-10-29)

### Bug Fixes

* build before testing in prepublishOnly ([268c962](https://github.com/ExaDev/combinatrix/commit/268c962b1fb36fe2e0791502e0456b5a84675fea))

### Tests

* derive the rank test's timeout from its operation count ([a4d3da1](https://github.com/ExaDev/combinatrix/commit/a4d3da1fcf044471ee830171dbf8792f6fe9508d))

## [2.0.0](https://github.com/ExaDev/combinatrix/compare/v1.0.1...v2.0.0) (2026-10-29)

### ⚠ BREAKING CHANGES

* the object conditions ({ is }, { in }, { set },
{ unset }, { all }, { any }, { not }) are replaced by trilean trees
written with is, oneOf, isSet, isUnset, allOf, anyOf and not; JSON
model and rules files hold trilean trees. A condition can no longer
read a dimension that can take null or compare values of a dimension
of mixed kinds; predicate is the route for those. UnsettableIn and the
schema's Condition definition are removed, and a constraint answers
invalid for an assignment giving a dimension a value it never takes.
* Explanation, Reason, DeadValue and Diagnosis take the
model's combination type, and explainData returns DataExplanation, whose
DataReason holds the reasons only untyped data can have. explain throws
TypeError for a record outside the combination type. diagnose takes a
Model. PredicateDefinition and ComputedDefinition take the reads list
type instead of the union of read names, and ComputedDimension's compute
is a Bivariant function of its read values. CancellationOptions and
StrategyContext take an AbortSignalLike. LimitExceededError has a bound
field, and combinations with a strategy other than full reports a limit
it passes as bound "selection".
* ChoiceDimension, FirstValidDimension and ComputedDimension take the activity
condition type as a further parameter (and ComputedDimension the read names), defaulting to
the untyped forms, and ConditionalOptions and ComputedDefinition are generic likewise.
ModelDefinition takes the rule and constraint tuple types as defaulted parameters.
predicate returns Predicate<R>, which is still a Constraint.
A definition that only failed at runtime before may now fail to compile.
* choice and firstValid no longer accept a plain array type.
A literal list or an as-const tuple compiles unchanged; a list typed T[] (from map, filter,
a spread without as const, or data) is narrowed with isNonEmpty first, or written as const,
for example [undefined, ...values] as const.
* Rule and Condition lose their name parameter and describe untyped data
only; write Rule<NameOf<...>> as TypedRule<TupleOf<typeof dimensions>> or
TypedRule<CombinationOf<typeof model>>.
Rules typed as Rule[] (from isRule or JSON) no longer compile as defineModel's rules: pass
them through parseRules(dimensions, data) first.
A rule testing { unset: name } on a dimension that can never be unset is now refused.
* explain accepts only a complete combination of the model's type.
Pass a record that may be partial, carry extra keys or come from JSON to explainData
instead, which keeps the runtime missing and outside-domain reasons and lets derived
dimensions be left out.

### Features

* bind predicates to the model so their test sees each dimension's type ([6e74c87](https://github.com/ExaDev/combinatrix/commit/6e74c87ee3a38c9525caec69e06eedc0298895fc))
* build covering arrays over the valid combinations ([d3d2473](https://github.com/ExaDev/combinatrix/commit/d3d2473a9a426a88b70cccbf90ecec6b99a50046))
* check rules' names and values against the dimensions at compile time ([d685b5d](https://github.com/ExaDev/combinatrix/commit/d685b5d738b06b74b1eb2428cc027836eb8b6f2b))
* count and diagnose by memoised search over the constraints' frontier ([8dac322](https://github.com/ExaDev/combinatrix/commit/8dac3224929de733b958ca43ad4a7d6946a32a43))
* generate a JSON Schema for conditions, rules and data models at build ([ba53bf7](https://github.com/ExaDev/combinatrix/commit/ba53bf76d90d15ffa59a035a2fa8938e0a61cbf2))
* load a model from JSON data with a guard and a parser ([c73d88f](https://github.com/ExaDev/combinatrix/commit/c73d88f542c98c3f5e5a655db16dbfeec9bb1e38))
* make the limit optional and let callers cancel the search ([9101e2f](https://github.com/ExaDev/combinatrix/commit/9101e2fa33b9c5c4106bddf9c917d3c7fbd2bf60))
* rank and unrank the solution set, and sample it uniformly through an injected source ([97d6c3b](https://github.com/ExaDev/combinatrix/commit/97d6c3bff13c4279872c62354331343654e3d7bd))
* refuse an empty choice or first-valid domain at compile time ([d55b4ce](https://github.com/ExaDev/combinatrix/commit/d55b4ce353d94beb33e3886a2f13d16811ac7461))
* refuse duplicate names and out-of-order references at compile time ([9668fc3](https://github.com/ExaDev/combinatrix/commit/9668fc33ffd83a178a1e8ad947be8711b4da49eb))
* type diagnostics, computed reads and strategies by the model ([859f069](https://github.com/ExaDev/combinatrix/commit/859f069a4bc5de40c4f487161303e368c9e63d19))
* type explain's record as one of the model's combinations ([bd65d95](https://github.com/ExaDev/combinatrix/commit/bd65d9559299e4ac4a26c163dcc2922e8600ee14))
* write conditions and rules as trilean predicate trees ([5560669](https://github.com/ExaDev/combinatrix/commit/55606692cbe783ac70fc2489f9d17e545ff691e4))

### Bug Fixes

* list every commit type in the release notes ([934e055](https://github.com/ExaDev/combinatrix/commit/934e05502589bb1c3499b2cfaa11b689d9ab21fc))
* refuse a model definition whose data is malformed ([905a6fe](https://github.com/ExaDev/combinatrix/commit/905a6fec3222be89572d747bcae5ad7332c09ed6))
* refuse an active conditional choice left unset when unset is not one of its values ([e6f6a7d](https://github.com/ExaDev/combinatrix/commit/e6f6a7dfdbe44d477e3edbe03f2e9bcd1bb81511))

### Performance Improvements

* make a condition's resolvers and domain sets once per constraint ([239217f](https://github.com/ExaDev/combinatrix/commit/239217f91577588457ed80dbc64fb82ff203f92c))

### Code Refactoring

* port trilean's evaluation over an assignment of dimensions ([f060681](https://github.com/ExaDev/combinatrix/commit/f06068127fba9bf2914fee08f1354c49638c636b))
* share a domain's checks between defineModel and the data guard ([65dd23c](https://github.com/ExaDev/combinatrix/commit/65dd23cfd7ca43e9f6c6f8097a7ecaf029989dbe))

### Documentation

* add the standard badge row to the README ([04988e0](https://github.com/ExaDev/combinatrix/commit/04988e0049aa1f6de0ebb0bb42961369539f8d23))
* describe counting by frontier state and diagnose from the same counts ([dab4a9b](https://github.com/ExaDev/combinatrix/commit/dab4a9bcb63c163309eae1dcbfcebff3cd891827))
* describe the typed and untyped routes through the API ([efa8c30](https://github.com/ExaDev/combinatrix/commit/efa8c301bf4e6b32b2efbc518b6c6569e9e9f939))
* document the JSON Schema and build before testing in CI ([3aeb611](https://github.com/ExaDev/combinatrix/commit/3aeb611ef25fe343f6f7a36298f16175b3d6a7bb))
* list the commits behind each release that had an empty changelog entry ([f30a349](https://github.com/ExaDev/combinatrix/commit/f30a34930ce259075126db3d11455afbc8ba709e))
* name parseModel in the schema's description of a model ([b840aef](https://github.com/ExaDev/combinatrix/commit/b840aef425db4d35d0124387b26683dd0fcbb0d8))
* say the rules example's explain takes a typed combination ([fc02f02](https://github.com/ExaDev/combinatrix/commit/fc02f029bceebbd78ffa7a03a8329d454f49b5e7))
* say which compile-time checks parseModel leaves to runtime ([c8d1838](https://github.com/ExaDev/combinatrix/commit/c8d18388d7ad5489510f017e01d5b7f7dfe6fc15))
* show loading a model from JSON and name parseModel as the loader ([585c0dd](https://github.com/ExaDev/combinatrix/commit/585c0dd6805d8a63c95161e01c15b350db667f99))
* show paging, ranking and sampling in the README with a tested example ([8194a83](https://github.com/ExaDev/combinatrix/commit/8194a834a2cbc8a382f8d7deafada7be1253197c))
* show pairwise coverage of a constrained model ([4317f84](https://github.com/ExaDev/combinatrix/commit/4317f84673e8851df3b8c7d1355fdbb1dbf41389))
* show the optional limit and cancellation in the README examples ([789872f](https://github.com/ExaDev/combinatrix/commit/789872f7e8d827b7fa15a451ddd39841cac15698))
* show typed results, computed reads and the limit's bound in the README ([94425a9](https://github.com/ExaDev/combinatrix/commit/94425a9554841952766598110a7ef4bbef5e5412))

### Tests

* index the linear-scan reference once per generated model ([37a7f36](https://github.com/ExaDev/combinatrix/commit/37a7f367b1787f70d9f8c8cbcb65c0eb3723f2d0))
* move the seeded random model generator into a test-support file ([fa48d70](https://github.com/ExaDev/combinatrix/commit/fa48d7012e049684a7843352882cdaa7cba413e7))
* prove the JSON Schema agrees with the guards and the data types ([4cf165f](https://github.com/ExaDev/combinatrix/commit/4cf165f39ed0fd8ae742440348e37df143f625ed))
* share the JSON Schema generators and agreement check between suites ([b704248](https://github.com/ExaDev/combinatrix/commit/b704248ba0590c8e114d9c4398f9217e99a96433))

### Continuous Integration

* compile a consumer of the packed tarball with no DOM library or type packages ([ae9b62f](https://github.com/ExaDev/combinatrix/commit/ae9b62f37b9f087f728e63c29947fe05eb35119c))
* exercise the covering array through the packed package ([894e307](https://github.com/ExaDev/combinatrix/commit/894e3076875078db0af0a5ac40f77ebed6b8bf1d))

### Chores

* **deps-dev:** bump the minor-and-patch group across 1 directory with 9 updates ([ce1ce00](https://github.com/ExaDev/combinatrix/commit/ce1ce0098ca14cbddfd551387ae538e1a5bcbc57))
* **deps:** bump the minor-and-patch group across 1 directory with 3 updates ([303f75d](https://github.com/ExaDev/combinatrix/commit/303f75d8f72ade9f55a8aeda0fd46a42e5182c94))

## [1.0.1](https://github.com/ExaDev/combinatrix/compare/v1.0.0...v1.0.1) (2026-10-29)

### Documentation

* explain the library with a progression of examples that are tested ([136811d](https://github.com/ExaDev/combinatrix/commit/136811dc89bf3e97b2098587d5e686aa5eba0223))

### Tests

* resolve the package name to its source in tests and typechecking ([4dd37f6](https://github.com/ExaDev/combinatrix/commit/4dd37f630f5d60f1daa5cf3024b9ee0a5ea5b9f4))

# 1.0.0 (2026-10-29)


### Bug Fixes

* accept rules read from JSON with plain string dimension names ([e01ee11](https://github.com/ExaDev/combinatrix/commit/e01ee1194bf5a995bf79e7cbb0379571051c0bd5))


### Features

* enumerate the valid combinations of option dimensions ([6f3dcb4](https://github.com/ExaDev/combinatrix/commit/6f3dcb46069c551154dcda5c9b0021e552e0b331))


### Performance Improvements

* skip re-explaining the combinations the full strategy yields ([5d38840](https://github.com/ExaDev/combinatrix/commit/5d388406cc7f699f7bfb8ffe6eb0d57f23e0496c))
