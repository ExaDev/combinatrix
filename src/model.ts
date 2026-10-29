import type { ConstraintDefects, DimensionDefects, Refusal, RuleDefects } from "./checks";
import type { Condition, Mention } from "./condition";
import { conditionDependencies, conditionMentions } from "./condition";
import type { Constraint, ConstraintTools, PredicateValues, TypedPredicateDefinition } from "./constraint";
import { predicate } from "./constraint";
import type { Dimension, NameOf, TupleOf } from "./dimension";
import { ModelError } from "./errors";
import type { Rule, TypedRule } from "./rule";
import { ruleConditions, ruleConstraint } from "./rule";
import type { Value } from "./value";
import { describeValue, isScalar, valueKey } from "./value";

/**
 * The definition `defineModel` takes. `Ds`, `Rs` and `Cs` are the literal types of the dimensions, rules and constraints, inferred from a definition written in code, so that the compiler refuses what `defineModel` would refuse at runtime where the types can show it: a duplicated name, an activity condition or computed dimension reading a later or unknown dimension, a rule or constraint mentioning an unknown dimension or a value a dimension can never take, and a first-valid dimension constrained together with a later one. A refused part is reported as a missing `error` property naming each defect.
 */
export interface ModelDefinition<Ds extends readonly Dimension[], Rs extends readonly TypedRule<TupleOf<Ds>>[] = readonly TypedRule<TupleOf<Ds>>[], Cs extends readonly Constraint[] = readonly Constraint[]> {
  /** The dimensions, in enumeration order: the first varies slowest. */
  readonly dimensions: Ds & Refusal<DimensionDefects<Ds>>;
  /** Declarative constraints, as JSON-shaped data whose dimension names and compared values are checked against the dimensions at compile time. Rules read from JSON go through `parseRules` first, which checks them at runtime and returns them typed. `defineModel` checks every rule at runtime as well, since data can bypass the types. */
  readonly rules?: Rs & Refusal<RuleDefects<Ds, Rs>>;
  /**
   * Constraints given through the three-valued contract, such as `predicate` or another package's constraint language. Literal dependencies, such as `predicate`'s, are checked at compile time; dependencies typed `string` at runtime only. Given as a callback, it receives `ConstraintTools` bound to the dimensions, whose `predicate` types `test` with each read dimension's values.
   */
  readonly constraints?: (Cs & Refusal<ConstraintDefects<Ds, Cs>>) | ((tools: ConstraintTools<Ds>) => readonly Constraint[]);
}

/** The parts of a checked model that do not depend on the type of its combinations. */
export interface ModelParts {
  readonly dimensions: readonly Dimension[];
  readonly rules: readonly Rule[];
  /** The rules' constraints, in rule order, followed by the constraints given directly. */
  readonly constraints: readonly Constraint[];
  /** The rule each constraint states, at the same index, or `undefined` for one given directly. */
  readonly sources: readonly (Rule | undefined)[];
}

/** A checked model: the dimensions and every constraint, in the order they are evaluated. `T` is the type of one combination. */
export interface Model<T extends Readonly<Record<string, Value>>> extends ModelParts {
  /** Whether a record has the shape of a combination: exactly the model's dimensions as keys, each with a value its dimension can take. It does not check the constraints; `explain` does. */
  readonly isTuple: (values: Readonly<Record<string, Value>>) => values is T;
}

/** The type of one combination of a model: what `combinations` yields as `values` and what `explain` takes. */
export type CombinationOf<M> = M extends Model<infer T> ? T : never;

/**
 * Checks a model definition and returns the model. Throws `ModelError` listing every defect: a duplicated or empty name, an empty domain, a value that is not a JSON scalar or appears twice, a reference to an unknown or later dimension, a rule comparing a dimension against a value it cannot take (unset included), or a constraint on a first-valid dimension that mentions a dimension declared after it.
 */
export function defineModel<const Ds extends readonly Dimension[], const Rs extends readonly TypedRule<TupleOf<Ds>>[] = readonly TypedRule<TupleOf<Ds>>[], const Cs extends readonly Constraint[] = readonly Constraint[]>(definition: ModelDefinition<Ds, Rs, Cs>): Model<TupleOf<Ds>> {
  const { dimensions } = definition;
  const rules: readonly Rule[] = definition.rules ?? [];
  const possible = new Map(dimensions.map((dimension) => [dimension.name, possibleKeys(dimension)]));
  const given: readonly Constraint[] = typeof definition.constraints === "function" ? definition.constraints(constraintTools<Ds>(possible)) : (definition.constraints ?? []);
  const constraints = [...rules.map(ruleConstraint), ...given];
  const sources = [...rules, ...given.map(() => undefined)];
  const issues = checkModel(dimensions, rules, constraints);
  if (issues.length > 0) throw new ModelError(issues);

  const isTuple = (values: Readonly<Record<string, Value>>): values is TupleOf<Ds> => {
    const keys = Object.keys(values);
    if (keys.length !== dimensions.length) return false;

    return dimensions.every((dimension) => {
      if (!Object.hasOwn(values, dimension.name)) return false;

      const keysOf = possible.get(dimension.name);
      const value = values[dimension.name];

      return keysOf === undefined ? value === undefined || isScalar(value) : keysOf.has(valueKey(value));
    });
  };

  return { dimensions, rules, constraints, sources, isTuple };
}

/** The tools a `constraints` callback receives, over the possible value keys of each dimension by name (`undefined` for a computed one). */
function constraintTools<Ds extends readonly Dimension[]>(possible: ReadonlyMap<string, Set<string> | undefined>): ConstraintTools<Ds> {
  return {
    predicate: <const R extends NameOf<Ds>>(definition: TypedPredicateDefinition<TupleOf<Ds>, R>) => {
      const { reads } = definition;
      // Whether every read value is one its dimension can take, which is what `Pick<TupleOf<Ds>, R>` states: the type of each choice or first-valid dimension is its domain, and a computed one's is its compute function's return type, which is not known at runtime.
      const fits = (values: Readonly<PredicateValues<R>>): values is Readonly<PredicateValues<R>> & Pick<TupleOf<Ds>, R> =>
        reads.every((read) => {
          const keys = possible.get(read);

          return keys === undefined || keys.has(valueKey(values[read]));
        });
      const test = (values: Readonly<PredicateValues<R>>): boolean => fits(values) && definition.test(values);

      return definition.name === undefined ? predicate({ reads, test }) : predicate({ reads, test, name: definition.name });
    },
  };
}

/** The keys of every value a dimension can hold in a combination, or `undefined` when a function computes it and the set is not known ahead. */
export function possibleKeys(dimension: Dimension): Set<string> | undefined {
  if (dimension.kind === "computed") return undefined;

  const values = domainOf(dimension);
  const keys = new Set(values.map(valueKey));
  if (dimension.activeWhen !== undefined) keys.add(valueKey(undefined));

  return keys;
}

/** A free dimension's values or a first-valid dimension's candidates; empty for a computed one. */
export function domainOf(dimension: Dimension): readonly Value[] {
  if (dimension.kind === "choice") return dimension.values;
  if (dimension.kind === "first-valid") return dimension.candidates;

  return [];
}

function checkModel(dimensions: readonly Dimension[], rules: readonly Rule[], constraints: readonly Constraint[]): string[] {
  const issues: string[] = [];
  const position = new Map<string, number>();
  dimensions.forEach((dimension, index) => {
    issues.push(...checkDimension(dimension, position));
    if (position.has(dimension.name)) issues.push(`dimension "${dimension.name}" is declared more than once`);
    else position.set(dimension.name, index);
  });
  const byName = new Map(dimensions.map((dimension) => [dimension.name, dimension]));
  for (const dimension of dimensions) {
    if (dimension.activeWhen !== undefined) issues.push(...checkMentions(conditionMentions(dimension.activeWhen), byName, `the activity of dimension "${dimension.name}"`));
  }
  rules.forEach((rule, index) => {
    issues.push(...ruleIssues(rule, byName, `rule ${String(index)}`));
  });
  constraints.forEach((constraint, index) => {
    for (const dependency of constraint.dependencies) {
      if (!position.has(dependency)) issues.push(`constraint ${String(index)} depends on unknown dimension "${dependency}"`);
    }
  });
  dimensions.forEach((dimension, index) => {
    if (dimension.kind !== "first-valid") return;

    constraints.forEach((constraint, constraintIndex) => {
      if (!constraint.dependencies.includes(dimension.name)) return;

      const later = constraint.dependencies.filter((dependency) => {
        const at = position.get(dependency);

        return at !== undefined && at > index;
      });
      if (later.length > 0) issues.push(`constraint ${String(constraintIndex)} mentions first-valid dimension "${dimension.name}" and ${later.map((name) => `"${name}"`).join(", ")} declared after it, so its candidate could not be chosen from earlier values alone`);
    });
  });

  return issues;
}

function checkDimension(dimension: Dimension, earlier: ReadonlyMap<string, number>): string[] {
  const issues: string[] = [];
  const label = `dimension "${dimension.name}"`;
  if (dimension.name.length === 0) issues.push("a dimension has an empty name");
  if (dimension.kind === "computed") {
    for (const read of dimension.reads) {
      if (!earlier.has(read)) issues.push(`${label} reads "${read}", which is not a dimension declared before it`);
    }
  } else {
    const values = domainOf(dimension);
    if (values.length === 0) issues.push(`${label} has no values`);
    const seen = new Set<string>();
    for (const value of values) {
      if (value !== undefined && !isScalar(value)) issues.push(`${label} has value ${String(value)}, which is not a JSON scalar`);
      const key = valueKey(value);
      if (seen.has(key)) issues.push(`${label} lists ${describeValue(value)} more than once`);
      seen.add(key);
    }
  }
  if (dimension.activeWhen !== undefined) issues.push(...checkActivity(dimension.activeWhen, label, earlier));

  return issues;
}

function checkActivity(condition: Condition, label: string, earlier: ReadonlyMap<string, number>): string[] {
  return conditionDependencies(condition)
    .filter((dependency) => !earlier.has(dependency))
    .map((dependency) => `${label} is active depending on "${dependency}", which is not a dimension declared before it`);
}

/** Every defect in a rule's references to the dimensions: an unknown dimension, or a comparison with a value the dimension can never take (`unset` included). */
export function ruleIssues(rule: Rule, byName: ReadonlyMap<string, Dimension>, label: string): string[] {
  return ruleConditions(rule).flatMap((condition) => checkMentions(conditionMentions(condition), byName, label));
}

function checkMentions(mentions: readonly Mention[], byName: ReadonlyMap<string, Dimension>, label: string): string[] {
  const issues: string[] = [];
  for (const mention of mentions) {
    const dimension = byName.get(mention.dimension);
    if (dimension === undefined) {
      issues.push(`${label} mentions unknown dimension "${mention.dimension}"`);
      continue;
    }
    const keys = possibleKeys(dimension);
    if (keys === undefined) continue;

    for (const value of mention.values) {
      if (!keys.has(valueKey(value))) issues.push(`${label} compares "${mention.dimension}" with ${describeValue(value)}, which it can never take`);
    }
  }

  return issues;
}
