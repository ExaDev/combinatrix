import { evaluateCondition } from "./condition";
import type { Constraint, Verdict } from "./constraint";
import type { ComputedDimension, Dimension, FirstValidDimension } from "./dimension";
import { ConstraintContractError } from "./errors";
import { fnv1a64 } from "./hash";
import type { ModelParts } from "./model";
import type { PartialAssignment, Value } from "./value";

/**
 * A constraint's verdict, holding it to the contract: `unknown` once every dependency is assigned is a broken constraint, reported by throwing `ConstraintContractError` rather than treated as either answer.
 */
export function verdictOf(constraint: Constraint, assignment: PartialAssignment): Verdict {
  const verdict = constraint.evaluate(assignment);
  if (verdict === "unknown" && constraint.dependencies.every((dependency) => assignment.has(dependency))) {
    throw new ConstraintContractError(`constraint ${constraint.name === undefined ? "" : `"${constraint.name}" `}answered unknown with every dimension it depends on (${constraint.dependencies.join(", ")}) assigned`);
  }

  return verdict;
}

/** The combined verdict of several constraints: `invalid` if any is invalid, `valid` if all are valid, otherwise `unknown`. */
export function combinedVerdict(constraints: readonly Constraint[], assignment: PartialAssignment): Verdict {
  let combined: Verdict = "valid";
  for (const constraint of constraints) {
    const verdict = verdictOf(constraint, assignment);
    if (verdict === "invalid") return "invalid";
    if (verdict === "unknown") combined = "unknown";
  }

  return combined;
}

/** Whether a dimension is active under the assignment of the dimensions before it. A condition the assignment cannot decide counts as active; that happens only when a dimension it mentions is missing, which is reported on its own. */
export function isActive(dimension: Dimension, assignment: PartialAssignment): boolean {
  return dimension.activeWhen === undefined || evaluateCondition(dimension.activeWhen, assignment) !== false;
}

/** One dimension in enumeration order, with the constraints that mention it. */
export interface Step {
  readonly dimension: Dimension;
  readonly constraints: readonly Constraint[];
}

/** A model's dimensions in enumeration order, each with the constraints that mention it. */
export function stepsOf(model: ModelParts): Step[] {
  return model.dimensions.map((dimension) => ({ dimension, constraints: model.constraints.filter((constraint) => constraint.dependencies.includes(dimension.name)) }));
}

/** The constraints that mention no dimension, so no step checks them. */
export function unconditionalConstraints(model: ModelParts): Constraint[] {
  return model.constraints.filter((constraint) => constraint.dependencies.length === 0);
}

/**
 * The first candidate of a first-valid dimension that none of the given constraints rejects, with the dimension assigned to each candidate in turn. `undefined` when every candidate is rejected. The assignment is left as it was found.
 */
export function firstCandidate(dimension: FirstValidDimension<string, Value>, constraints: readonly Constraint[], assignment: Map<string, Value>): { readonly value: Value } | undefined {
  try {
    for (const candidate of dimension.candidates) {
      assignment.set(dimension.name, candidate);
      if (constraints.every((constraint) => verdictOf(constraint, assignment) !== "invalid")) return { value: candidate };
    }

    return undefined;
  } finally {
    assignment.delete(dimension.name);
  }
}

/** A computed dimension's value from the assignment of the dimensions it reads. */
export function computeValue(dimension: ComputedDimension<string, Value>, assignment: PartialAssignment): Value {
  const values: Record<string, Value> = {};
  for (const read of dimension.reads) values[read] = assignment.get(read);

  return dimension.compute(values);
}

/** A complete assignment as a record keyed by dimension name, in declaration order. */
export function recordOf(dimensions: readonly Dimension[], assignment: PartialAssignment): Record<string, Value> {
  const record: Record<string, Value> = {};
  for (const dimension of dimensions) record[dimension.name] = assignment.get(dimension.name);

  return record;
}

/**
 * The canonical form of a combination: a JSON array with one entry per dimension in declaration order, `[name]` when unset and `[name, value]` when set. Two combinations of one model have the same canonical form exactly when they are the same combination.
 */
export function canonicalForm(dimensions: readonly Dimension[], values: Readonly<Record<string, Value>>): string {
  return JSON.stringify(
    dimensions.map((dimension) => {
      const value = values[dimension.name];

      return value === undefined ? [dimension.name] : [dimension.name, value];
    }),
  );
}

/** A combination's stable id: the FNV-1a hash of its canonical form. */
export function combinationId(dimensions: readonly Dimension[], values: Readonly<Record<string, Value>>): string {
  return fnv1a64(canonicalForm(dimensions, values));
}
