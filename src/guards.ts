import type { ChoiceDimension, Dimension, FirstValidDimension, TupleOf } from "./dimension";
import { ModelError } from "./errors";
import type { Model } from "./model";
import { defineModel, domainIssues, ruleIssues } from "./model";
import type { Rule, TypedRule } from "./rule";
import { isRecord, isRule, modelShapeIssues, ruleShapeIssues } from "./shape";
import type { Scalar, Value, ValueRecord } from "./value";

/**
 * Parses rules that arrive as data (parsed JSON, a configuration file) against the dimensions they are for, returning them typed so they can be passed to `defineModel` with no cast. Throws `ModelError` listing every defect: data that is not an array, an element that is not a well-formed rule (with where each of its trees fails trilean's schema), a mention of an unknown dimension or of one that can take `null`, a node kind an assignment of dimensions cannot resolve, a comparison with a value a dimension can never take or across value kinds, and a rule past trilean's evaluation budget. The dimensions' order and the first-valid restriction are checked by `defineModel`, which sees the whole model.
 */
export function parseRules<const Ds extends readonly Dimension[]>(dimensions: Ds, data: unknown): TypedRule<TupleOf<Ds>>[] {
  if (!Array.isArray(data)) throw new ModelError(["the rules are not an array"]);

  const byName = new Map(dimensions.map((dimension) => [dimension.name, dimension]));
  const issues: string[] = [];
  const rules: TypedRule<TupleOf<Ds>>[] = [];
  data.forEach((element: unknown, index) => {
    const label = `rule ${String(index)}`;
    if (!isRule(element)) issues.push(...ruleShapeIssues(element, label));
    else if (fitsDimensions<TupleOf<Ds>>(element, byName)) rules.push(element);
    else issues.push(...ruleIssues(element, byName, label));
  });
  if (issues.length > 0) throw new ModelError(issues);

  return rules;
}

/**
 * Whether a rule mentions only the given dimensions and compares each with values it can take, which is what `TypedRule<T>` states for the combination type `T` of those dimensions. A computed dimension's values are not known ahead, so any scalar compared with one is accepted, as `Model.isTuple` accepts any value for one.
 */
function fitsDimensions<T extends Readonly<Record<string, Value>>>(rule: Rule, byName: ReadonlyMap<string, Dimension>): rule is Rule & TypedRule<T> {
  return ruleIssues(rule, byName, "").length === 0;
}

/**
 * The data form of a model: what a JSON file holds and the JSON Schema describes. Its dimensions are choice or first-valid dimensions over literal values, and a dimension is unset only through `activeWhen`, since JSON has no `undefined`. Computed dimensions, `sampled` domains and constraints given through the constraint contract are functions and are not data.
 */
export interface ModelData {
  /** The URI of the JSON Schema the model is written against, which an editor reads to check the file. It has no effect on the model. */
  readonly $schema?: string;
  /** A durable identifier: it names the model across copies, edits and renames, and says nothing about its content. It has no effect on the model. */
  readonly id?: string;
  /** A short human-readable name for the model. It has no effect on the model. */
  readonly title?: string;
  /** What the model is for. It has no effect on the model. */
  readonly description?: string;
  /** The dimensions, in enumeration order: the first varies slowest. */
  readonly dimensions: readonly (ChoiceDimension<string, Scalar> | FirstValidDimension<string, Scalar>)[];
  /** Declarative constraints over the dimensions. */
  readonly rules?: readonly Rule[];
}

/** The keys of model data that describe the file and are not part of the definition `defineModel` takes. Each must be a string, and an `id` must not be empty. */
const METADATA_KEYS = ["$schema", "id", "title", "description"] as const;

/**
 * Every way a value fails to be well-formed model data, which is exactly the shape the published JSON Schema states for a model: a definition with only `dimensions` and `rules`, and optionally the string keys `$schema` (the JSON Schema it is written against), `id`, `title` and `description` (which name and describe the model, `id` not being empty); choice and first-valid dimensions only, each with a non-empty name and a non-empty list of distinct JSON scalars (never `undefined`, which JSON cannot carry); well-formed conditions and rules. Names, values and references that depend on the whole model are not shape and are checked by `defineModel`, which `parseModel` calls.
 */
function modelDataIssues(data: unknown): string[] {
  if (!isRecord(data)) return modelShapeIssues(data);

  // The metadata belongs to the file, not to the definition `defineModel` takes, so the definition's own check never sees it.
  const definition = Object.fromEntries(Object.entries(data).filter(([key]) => !isMetadataKey(key)));
  const issues = modelShapeIssues(definition);
  for (const key of METADATA_KEYS) {
    if (!Object.hasOwn(data, key)) continue;

    const value = data[key];
    if (typeof value !== "string") issues.push(`the model data has a "${key}" that is not a string`);
    else if (key === "id" && value === "") issues.push('the model data has an empty "id"');
  }

  if (Object.hasOwn(data, "constraints")) issues.push("the model data has constraints, which are functions and not data");
  const { dimensions } = data;
  if (!Array.isArray(dimensions)) return issues;

  dimensions.forEach((dimension: unknown, index) => {
    if (!isRecord(dimension)) return;

    const label = `dimension ${String(index)}`;
    const { kind, name } = dimension;
    if (kind === "computed") {
      issues.push(`${label} is computed, which is a function and not data`);

      return;
    }

    const domain: unknown = kind === "choice" ? dimension["values"] : dimension["candidates"];
    if (typeof name !== "string" || !Array.isArray(domain)) return;

    issues.push(...domainIssues(name, domain));
    if (domain.includes(undefined)) issues.push(`${label} has an unset value, which JSON cannot state: a dimension is unset only through activeWhen`);
  });

  return issues;
}

function isMetadataKey(key: string): boolean {
  return METADATA_KEYS.some((metadata) => metadata === key);
}

/**
 * Whether a value, read from JSON or anywhere else, has the shape of model data: what the published JSON Schema accepts for a model, and no more or less. It says nothing about what depends on the whole model (a repeated name, a rule naming a dimension or value the model lacks), which `parseModel` reports.
 */
export function isModelData(value: unknown): value is ModelData {
  return modelDataIssues(value).length === 0;
}

/**
 * Parses a whole model that arrives as data (parsed JSON, a configuration file) and returns it, the untyped route for models as `parseRules` is for rules. Throws `ModelError` listing every defect: first those of the data's shape (`isModelData`), then, once it has the shape, every refusal `defineModel` makes of the model it describes (a repeated name, an activity condition or rule naming an unknown or later dimension or one that can take `null`, a comparison with a value a dimension can never take or across value kinds, a first-valid dimension constrained together with a later one).
 *
 * The dimension names and values are known only at runtime, so the result is a `Model` of combinations that map every name to a scalar or `undefined`: `defineModel` with literals would type each name and each domain, so that `explain` refuses a misspelt dimension or an impossible value at compile time and `CombinationOf` gives each combination's exact type, where here every record of scalars is accepted by the compiler and checked by `isTuple` and `explainData` at runtime. Unset is not a JSON value: a dimension is unset only where its `activeWhen` does not hold, which is how `defineModel` treats a dimension with no `undefined` in its domain.
 *
 * The compile-time checks `defineModel` makes of a model written in code do not apply, since the dimensions are `Dimension[]` with string names and unknown domains: a non-empty domain, a unique name, a condition or rule naming only dimensions declared before it and values a dimension can take are all checked at runtime by `defineModel` instead, and reported in the `ModelError`.
 */
export function parseModel(data: unknown): Model<ValueRecord> {
  if (!isModelData(data)) throw new ModelError(modelDataIssues(data));

  // Typed as the widest dimension, so a rule may test for unset and compare with any value, as the data cannot say which dimension is conditional until `defineModel` has checked it.
  const dimensions: readonly Dimension[] = data.dimensions;

  return defineModel(data.rules === undefined ? { dimensions } : { dimensions, rules: data.rules });
}
