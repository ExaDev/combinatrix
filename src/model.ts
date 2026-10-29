import type { ConstraintDefects, DimensionDefects, Refusal, RuleDefects } from "./checks";
import type { Condition } from "./condition";
import type { Constraint, ConstraintTools, PredicateValues, TypedPredicateDefinition } from "./constraint";
import { namedPredicate } from "./constraint";
import type { Dimension, NameOf, TupleOf } from "./dimension";
import { domainOf, possibleKeys } from "./dimension";
import { ModelError } from "./errors";
import type { Rule, TypedRule } from "./rule";
import { ruleConditions, ruleTree } from "./rule";
import { modelShapeIssues } from "./shape";
import { budgetIssues, comparisonCheck, surveyTree, treeConstraint } from "./trilean";
import type { Value } from "./value";
import { describeValue, isScalar, valueKey } from "./value";

/**
 * The definition `defineModel` takes. `Ds`, `Rs` and `Cs` are the literal types of the dimensions, rules and constraints, inferred from a definition written in code, so that the compiler refuses what `defineModel` would refuse at runtime where the types can show it: a duplicated name, an activity condition or computed dimension reading a later or unknown dimension, a rule or constraint mentioning an unknown dimension or a value a dimension can never take, and a first-valid dimension constrained together with a later one. A refused part is reported as a missing `error` property naming each defect.
 */
export interface ModelDefinition<Ds extends readonly Dimension[], Rs extends readonly TypedRule<TupleOf<Ds>>[] = readonly TypedRule<TupleOf<Ds>>[], Cs extends readonly Constraint[] = readonly Constraint[]> {
  /** The dimensions, in enumeration order: the first varies slowest. */
  readonly dimensions: Ds & Refusal<DimensionDefects<Ds>>;
  /** Declarative constraints, as JSON-shaped data whose conditions are trilean predicate trees. The dimension names and compared values of a condition written with the builders are checked against the dimensions at compile time. Rules read from JSON go through `parseRules` first, which checks them at runtime and returns them typed. `defineModel` checks every rule at runtime as well, since data can bypass the types. */
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
  /** For each dimension, at the same index, the constraint its `activeWhen` condition states, `valid` where the dimension is active, or `undefined` for a dimension that is always active. */
  readonly activity: readonly (Constraint | undefined)[];
}

/** A checked model: the dimensions and every constraint, in the order they are evaluated. `T` is the type of one combination. */
export interface Model<T extends Readonly<Record<string, Value>>> extends ModelParts {
  /** Whether a record has the shape of a combination: exactly the model's dimensions as keys, each with a value its dimension can take. It does not check the constraints; `explain` does. */
  readonly isTuple: (values: Readonly<Record<string, Value>>) => values is T;
}

/** The type of one combination of a model: what `combinations` yields as `values` and what `explain` takes. */
export type CombinationOf<M> = M extends Model<infer T> ? T : never;

/**
 * Checks a model definition and returns the model. Throws `ModelError` listing every defect: a definition, dimension or rule that is not well formed (an unknown key, a wrong type, a condition that is not a trilean predicate tree), a duplicated or empty name, an empty domain, a value that is not a JSON scalar or appears twice, a reference to an unknown or later dimension, a condition with a node kind an assignment of dimensions cannot resolve or that exceeds trilean's evaluation budget, a condition reading a dimension that can take `null` (which has no trilean value), comparing a dimension with a value it can never take (unset included) or across value kinds, or a constraint on a first-valid dimension that mentions a dimension declared after it.
 *
 * Every condition is checked, surveyed and bound to a trilean evaluator here, once, so evaluating the model's constraints repeats none of that work.
 */
export function defineModel<const Ds extends readonly Dimension[], const Rs extends readonly TypedRule<TupleOf<Ds>>[] = readonly TypedRule<TupleOf<Ds>>[], const Cs extends readonly Constraint[] = readonly Constraint[]>(definition: ModelDefinition<Ds, Rs, Cs>): Model<TupleOf<Ds>> {
  const shapeIssues = modelShapeIssues(definition);
  if (shapeIssues.length > 0) throw new ModelError(shapeIssues);

  const { dimensions } = definition;
  const rules: readonly Rule[] = definition.rules ?? [];
  const possible = new Map(dimensions.map((dimension) => [dimension.name, possibleKeys(dimension)]));
  const given: readonly Constraint[] = typeof definition.constraints === "function" ? definition.constraints(constraintTools<Ds>(possible)) : (definition.constraints ?? []);
  const byName = new Map(dimensions.map((dimension) => [dimension.name, dimension]));
  const activity = dimensions.map((dimension) => (dimension.activeWhen === undefined ? undefined : conditionCheck(dimension.activeWhen, byName, `the activity of dimension "${dimension.name}"`, true)));
  const ruleChecks = rules.map((rule, index) => ruleCheck(rule, byName, `rule ${String(index)}`));
  const issues = checkModel(dimensions, activity, ruleChecks, given);
  if (issues.length > 0) throw new ModelError(issues);

  const constraints = [...rules.map((rule, index) => compiledRule(rule, ruleChecks[index], byName, index)), ...given];
  const sources = [...rules, ...given.map(() => undefined)];
  const activityConstraints = dimensions.map((dimension, index) => {
    const check = activity[index];
    if (dimension.activeWhen === undefined || check === undefined) return undefined;

    return treeConstraint(dimension.activeWhen, check.references, byName, { label: `the activity of dimension "${dimension.name}"`, name: undefined });
  });

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

  return { dimensions, rules, constraints, sources, activity: activityConstraints, isTuple };
}

/** A condition's defects against the dimensions, each prefixed with `label`, and the dimensions it references, in the order it first mentions them. */
interface ConditionCheck {
  readonly issues: readonly string[];
  readonly references: readonly string[];
}

/** Checks one condition as written: the survey's defects and the comparisons `comparisonCheck` refuses, and, when `budgeted` because the condition is evaluated as it stands, trilean's evaluation budget. */
function conditionCheck(condition: Condition, byName: ReadonlyMap<string, Dimension>, label: string, budgeted: boolean): ConditionCheck {
  const survey = surveyTree(condition, byName, comparisonCheck(byName));

  return { issues: [...survey.issues.map((issue) => `${label} at ${issue}`), ...(budgeted ? budgetIssues(survey).map((issue) => `${label} ${issue}`) : [])], references: survey.references };
}

/**
 * Checks a rule: each of its conditions as written, then the one tree it states (`ruleTree`), which is what is evaluated, against trilean's evaluation budget. The conditions are checked one by one, before they are combined, so that `isUnset` and an impossible comparison are judged where they are written: the tree of an `implies` or `excludes` negates them. The references are the rule tree's, which are its constraint's dependencies.
 */
function ruleCheck(rule: Rule, byName: ReadonlyMap<string, Dimension>, label: string): ConditionCheck {
  const conditions = ruleConditions(rule).map((condition) => conditionCheck(condition, byName, label, false));
  const survey = surveyTree(ruleTree(rule), byName);

  return { issues: [...conditions.flatMap((check) => check.issues), ...budgetIssues(survey).map((issue) => `${label} ${issue}`)], references: survey.references };
}

/** The constraint a checked rule states, labelled by its name when it has one and by its position otherwise. */
function compiledRule(rule: Rule, check: ConditionCheck | undefined, byName: ReadonlyMap<string, Dimension>, index: number): Constraint {
  if (check === undefined) throw new Error(`unreachable: every rule was checked (rule ${String(index)})`);

  return treeConstraint(ruleTree(rule), check.references, byName, { label: rule.name === undefined ? `rule ${String(index)}` : `rule "${rule.name}"`, name: rule.name });
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

      return namedPredicate(reads, test, definition.name);
    },
  };
}

function checkModel(dimensions: readonly Dimension[], activity: readonly (ConditionCheck | undefined)[], ruleChecks: readonly ConditionCheck[], given: readonly Constraint[]): string[] {
  const issues: string[] = [];
  const position = new Map<string, number>();
  dimensions.forEach((dimension, index) => {
    issues.push(...checkDimension(dimension, activity[index], position));
    if (position.has(dimension.name)) issues.push(`dimension "${dimension.name}" is declared more than once`);
    else position.set(dimension.name, index);
  });
  for (const check of ruleChecks) issues.push(...check.issues);
  const dependencyLists = [...ruleChecks.map((check) => check.references), ...given.map((constraint) => constraint.dependencies)];
  given.forEach((constraint, offset) => {
    const index = ruleChecks.length + offset;
    for (const dependency of constraint.dependencies) {
      if (!position.has(dependency)) issues.push(`constraint ${String(index)} depends on unknown dimension "${dependency}"`);
    }
  });
  dimensions.forEach((dimension, index) => {
    if (dimension.kind !== "first-valid") return;

    dependencyLists.forEach((dependencies, constraintIndex) => {
      if (!dependencies.includes(dimension.name)) return;

      const later = dependencies.filter((dependency) => {
        const at = position.get(dependency);

        return at !== undefined && at > index;
      });
      if (later.length > 0) issues.push(`constraint ${String(constraintIndex)} mentions first-valid dimension "${dimension.name}" and ${later.map((name) => `"${name}"`).join(", ")} declared after it, so its candidate could not be chosen from earlier values alone`);
    });
  });

  return issues;
}

function checkDimension(dimension: Dimension, activity: ConditionCheck | undefined, earlier: ReadonlyMap<string, number>): string[] {
  const label = `dimension "${dimension.name}"`;
  const issues = dimension.kind === "computed" ? nameIssues(dimension.name) : domainIssues(dimension.name, domainOf(dimension));
  if (dimension.kind === "computed") {
    for (const read of dimension.reads) {
      if (!earlier.has(read)) issues.push(`${label} reads "${read}", which is not a dimension declared before it`);
    }
  }
  if (activity !== undefined) {
    issues.push(...activity.issues);
    for (const dependency of activity.references) {
      if (!earlier.has(dependency)) issues.push(`${label} is active depending on "${dependency}", which is not a dimension declared before it`);
    }
  }

  return issues;
}

/** The defects of a dimension's name alone: it must not be empty. */
function nameIssues(name: string): string[] {
  return name.length === 0 ? ["a dimension has an empty name"] : [];
}

/**
 * Every defect in a choice or first-valid dimension's name and domain that does not depend on the rest of the model: an empty name, an empty domain, a value that is not a JSON scalar (unset, `undefined`, is allowed) and a value listed twice. `defineModel` checks each dimension with it, and so does `isModelData`, which is what makes the two agree on the data a JSON Schema can state.
 */
export function domainIssues(name: string, values: readonly unknown[]): string[] {
  const issues = nameIssues(name);
  const label = `dimension "${name}"`;
  if (values.length === 0) issues.push(`${label} has no values`);
  const seen = new Set<string>();
  for (const value of values) {
    if (value !== undefined && !isScalar(value)) {
      issues.push(`${label} has ${typeof value === "number" ? `value ${String(value)}` : `a value of type ${Array.isArray(value) ? "array" : typeof value}`}, which is not a JSON scalar`);
      continue;
    }

    const key = valueKey(value);
    if (seen.has(key)) issues.push(`${label} lists ${describeValue(value)} more than once`);
    seen.add(key);
  }

  return issues;
}

/** Every defect in a rule's references to the dimensions: each the survey or the comparison checks find in its conditions, and an evaluation budget its tree exceeds. `parseRules` checks rules read from JSON with it. */
export function ruleIssues(rule: Rule, byName: ReadonlyMap<string, Dimension>, label: string): readonly string[] {
  return ruleCheck(rule, byName, label).issues;
}
