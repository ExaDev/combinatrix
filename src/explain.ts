import type { Constraint } from "./constraint";
import { combinationId, computeValue, firstCandidate, isActive, recordOf, stepsOf, verdictOf } from "./engine";
import type { ModelParts } from "./model";
import { possibleKeys } from "./model";
import type { Rule } from "./rule";
import type { Value } from "./value";
import { sameValue, valueKey } from "./value";

/** One reason a record is not a combination in the solution set. */
export type Reason =
  /** The record has a key that is not a dimension of the model. */
  | { readonly kind: "unknown-dimension"; readonly dimension: string }
  /** The record has no key for a free dimension. */
  | { readonly kind: "missing"; readonly dimension: string }
  /** The record gives a dimension a value outside its domain. */
  | { readonly kind: "outside-domain"; readonly dimension: string; readonly value: Value }
  /** The record sets a dimension that is inactive for it, so the same combination with that dimension unset is the one in the solution set. */
  | { readonly kind: "inactive"; readonly dimension: string; readonly value: Value }
  /** The record gives a derived dimension a value other than the one derived from the rest of it. */
  | { readonly kind: "derived"; readonly dimension: string; readonly value: Value; readonly expected: Value }
  /** No candidate of a first-valid dimension is acceptable for the rest of the record. */
  | { readonly kind: "no-candidate"; readonly dimension: string }
  /** A constraint rejects the record. `rule` is the declarative rule it states, when it states one. */
  | { readonly kind: "constraint"; readonly index: number; readonly constraint: Constraint; readonly rule?: Rule };

/** Whether a record is a combination in the solution set: with its id when it is, with every reason it is not otherwise. */
export type Explanation = { readonly valid: true; readonly id: string } | { readonly valid: false; readonly reasons: readonly Reason[] };

/**
 * Explains whether a record is in the model's solution set, and if not, every reason why. A derived dimension may be left out of the record, in which case its derived value is used; one given is checked against it. Constraints are evaluated on the record as given, so a constraint that the given values reject is named even when other reasons apply too.
 */
export function explain(model: ModelParts, values: Readonly<Record<string, Value>>): Explanation {
  const reasons: Reason[] = [];
  const known = new Set(model.dimensions.map((dimension) => dimension.name));
  for (const key of Object.keys(values)) {
    if (!known.has(key)) reasons.push({ kind: "unknown-dimension", dimension: key });
  }
  const assignment = new Map<string, Value>();
  for (const step of stepsOf(model)) {
    const { dimension } = step;
    const { name } = dimension;
    const given = Object.hasOwn(values, name);
    const value = values[name];
    if (!isActive(dimension, assignment)) {
      if (given && value !== undefined) reasons.push({ kind: "inactive", dimension: name, value });
      assignment.set(name, undefined);
      continue;
    }
    let expected: { readonly value: Value } | undefined;
    switch (dimension.kind) {
      case "choice":
        if (!given) {
          reasons.push({ kind: "missing", dimension: name });
          continue;
        }
        break;
      case "computed":
        if (dimension.reads.every((read) => assignment.has(read))) expected = { value: computeValue(dimension, assignment) };
        break;
      case "first-valid":
        expected = firstCandidate(dimension, step.constraints, assignment);
        if (expected === undefined) reasons.push({ kind: "no-candidate", dimension: name });
        break;
    }
    if (given) {
      const keys = possibleKeys(dimension);
      if (keys !== undefined && !keys.has(valueKey(value))) reasons.push({ kind: "outside-domain", dimension: name, value });
      if (expected !== undefined && !sameValue(expected.value, value)) reasons.push({ kind: "derived", dimension: name, value, expected: expected.value });
      assignment.set(name, value);
    } else if (expected !== undefined) {
      assignment.set(name, expected.value);
    }
  }
  model.constraints.forEach((constraint, index) => {
    if (verdictOf(constraint, assignment) !== "invalid") return;

    const rule = model.sources[index];
    reasons.push(rule === undefined ? { kind: "constraint", index, constraint } : { kind: "constraint", index, constraint, rule });
  });
  if (reasons.length > 0) return { valid: false, reasons };

  return { valid: true, id: combinationId(model.dimensions, recordOf(model.dimensions, assignment)) };
}
