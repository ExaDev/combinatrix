import type { Constraint } from "./constraint";
import type { Dimension } from "./dimension";
import { canHold, possibleKeys } from "./dimension";
import { combinationId, computeValue, firstCandidate, isActive, recordOf, stepsOf, verdictOf } from "./engine";
import type { Model, ModelParts } from "./model";
import type { Rule } from "./rule";
import type { NamesIn, Value, ValueRecord } from "./value";
import { isScalar, sameValue, valueKey } from "./value";

/**
 * One reason a record of a model whose combinations have type `T` is not a combination in its solution set. Each reason about a dimension is a union keyed by that dimension, so testing `dimension` narrows `value` (and `expected`) to that dimension's own values. Over `ValueRecord`, a model whose dimensions are not known at compile time, a name is any string and a value any `Value`.
 */
export type Reason<T extends ValueRecord = ValueRecord> =
  /** The record sets a dimension that is inactive for it, so the same combination with that dimension unset is the one in the solution set. */
  | { readonly [K in NamesIn<T>]: { readonly kind: "inactive"; readonly dimension: K; readonly value: T[K] } }[NamesIn<T>]
  /** The record gives a dimension a value outside its domain. In a typed record that is only an active conditional dimension left unset when its values do not list unset, since the type of a conditional dimension includes `undefined`. */
  | { readonly [K in NamesIn<T>]: { readonly kind: "outside-domain"; readonly dimension: K; readonly value: T[K] } }[NamesIn<T>]
  /** The record gives a derived dimension a value other than the one derived from the rest of it. */
  | { readonly [K in NamesIn<T>]: { readonly kind: "derived"; readonly dimension: K; readonly value: T[K]; readonly expected: T[K] } }[NamesIn<T>]
  /** No candidate of a first-valid dimension is acceptable for the rest of the record. */
  | { readonly kind: "no-candidate"; readonly dimension: NamesIn<T> }
  /** A constraint rejects the record. `rule` is the declarative rule it states, when it states one. */
  | { readonly kind: "constraint"; readonly index: number; readonly constraint: Constraint; readonly rule?: Rule };

/**
 * One reason untyped data is not a combination in a model's solution set: every `Reason` over `ValueRecord`, and what only data the compiler did not check can have. A value outside its domain is still a `Value`, since anything else is reported as `not-a-value`.
 */
export type DataReason =
  | Reason
  /** The record has a key that is not a dimension of the model. */
  | { readonly kind: "unknown-dimension"; readonly dimension: string }
  /** The record has no key for a free dimension. */
  | { readonly kind: "missing"; readonly dimension: string }
  /** The data gives a dimension something that is not a value at all: neither a JSON scalar nor `undefined`. */
  | { readonly kind: "not-a-value"; readonly dimension: string; readonly value: unknown }
  /** The data is not a plain object keyed by dimension name, reported as the sole reason. */
  | { readonly kind: "not-a-record"; readonly value: unknown };

/** Whether a record of a model whose combinations have type `T` is a combination in the solution set: with its id when it is, with every reason it is not otherwise. */
export type Explanation<T extends ValueRecord = ValueRecord> = { readonly valid: true; readonly id: string } | { readonly valid: false; readonly reasons: readonly Reason<T>[] };

/** Whether untyped data is a combination in a model's solution set: with its id when it is, with every reason it is not otherwise, including those only untyped data can have. */
export type DataExplanation = { readonly valid: true; readonly id: string } | { readonly valid: false; readonly reasons: readonly DataReason[] };

/** The record type `explain` accepts for a model whose combinations have type `T`: exactly `T`, with any key `T` does not have refused even when the record comes from a variable rather than a literal. */
export type ExactRecord<T, R extends T> = R & Readonly<Record<Exclude<keyof R, keyof T>, never>>;

/**
 * Explains whether a combination is in the model's solution set, and if not, every reason why. The record is typed as one of the model's combinations, so a missing dimension, an unknown one or a value outside a domain is a compile error; what remains to report is an inactive dimension that is set, an active conditional dimension left unset when its values do not list unset (reported as `outside-domain`, since the type of a conditional dimension includes `undefined`), a derived value that differs from the derived one, a first-valid dimension with no acceptable candidate and each constraint that rejects the record. Each reason is typed by the model's dimensions. For a record that arrives untyped (parsed JSON, user input), use `explainData`; a record outside the combination type, which only a cast or untyped JavaScript can pass here, throws `TypeError` naming the first reason the types would have caught.
 */
export function explain<T extends ValueRecord, R extends T>(model: Model<T>, values: ExactRecord<T, R>): Explanation<T> {
  const explanation = explainRecord(model, values);
  if (explanation.valid) return explanation;

  const reasons: Reason<T>[] = [];
  for (const reason of explanation.reasons) {
    if (!isReasonOf(model, reason)) throw new TypeError(`explain was given a record that is not one of the model's combinations (${reason.kind}); explainData takes untyped data`);
    reasons.push(reason);
  }

  return { valid: false, reasons };
}

/**
 * Whether a reason is one a combination of the model can have: a kind that is not about untyped data, naming a dimension of the model with values that dimension can hold. That is what `Reason<T>` states, and what `explainRecord` gives for every record of the model's combination type.
 */
function isReasonOf<T extends ValueRecord>(model: Model<T>, reason: DataReason): reason is Reason<T> {
  if (reason.kind === "constraint") return true;
  if (reason.kind === "no-candidate") return dimensionOf(model, reason.dimension) !== undefined;
  if (reason.kind === "inactive" || reason.kind === "outside-domain") return holds(dimensionOf(model, reason.dimension), reason.value);
  if (reason.kind === "derived") return holds(dimensionOf(model, reason.dimension), reason.value) && holds(dimensionOf(model, reason.dimension), reason.expected);

  // What remains is about untyped data: an unknown or missing dimension, something that is not a value, or data that is not a record.
  return false;
}

/** The model's dimension of that name, if it has one. */
export function dimensionOf(model: ModelParts, name: string): Dimension | undefined {
  return model.dimensions.find((dimension) => dimension.name === name);
}

/** Whether there is a dimension and it can hold the value. */
function holds(dimension: Dimension | undefined, value: Value): boolean {
  return dimension !== undefined && canHold(dimension, value);
}

/**
 * Explains whether untyped data is a combination in the model's solution set: the route for a record parsed from JSON or taken from user input, which the compiler cannot check. Besides every reason `explain` reports, it reports data that is not a plain object (`not-a-record`), a key that is not a dimension (`unknown-dimension`), a free dimension with no key (`missing`), a value outside its domain (`outside-domain`) and a value that is not a JSON scalar or `undefined` (`not-a-value`). A derived dimension may be left out, in which case its derived value is used.
 */
export function explainData(model: ModelParts, data: unknown): DataExplanation {
  if (!isPlainRecord(data)) return { valid: false, reasons: [{ kind: "not-a-record", value: data }] };

  return explainRecord(model, data);
}

/** Whether data is a plain object, which is what a record keyed by dimension name must be. */
export function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The shared explanation of a record. A derived dimension may be left out of the record, in which case its derived value is used; one given is checked against it. A value outside its dimension's domain is reported and then treated as unassigned, so no constraint, condition or derivation is ever evaluated on a value the dimension cannot take: a typed predicate's `test` relies on that. Constraints are evaluated on the rest of the record as given, so a constraint that the given values reject is named even when other reasons apply too.
 */
export function explainRecord(model: ModelParts, values: Readonly<Record<string, unknown>>): DataExplanation {
  const reasons: DataReason[] = [];
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
    if (value !== undefined && !isScalar(value)) {
      reasons.push({ kind: "not-a-value", dimension: name, value });
      continue;
    }
    if (!isActive(step, assignment)) {
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
        // An active dimension takes one of its own values: unset is one only when they list it, although `possibleKeys` admits it for every conditional dimension because an inactive one is unset.
        if (value === undefined && !dimension.values.includes(undefined)) {
          reasons.push({ kind: "outside-domain", dimension: name, value });
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
      if (keys !== undefined && !keys.has(valueKey(value))) {
        reasons.push({ kind: "outside-domain", dimension: name, value });
        continue;
      }
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
