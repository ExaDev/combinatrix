/** A value a dimension can take that survives a JSON round trip unchanged: a string, a finite number, a boolean or `null`. */
export type Scalar = string | number | boolean | null;

/** A dimension's value: a scalar, or `undefined` when the dimension is unset. Unset is a choice like any other, never a sentinel string. */
export type Value = Scalar | undefined;

/**
 * An assignment of values to some of a model's dimensions. A dimension absent from the map is unassigned (its value is not yet known); a dimension present with the value `undefined` is assigned and unset. Constraints evaluate against this shape, so the two cases stay distinct.
 */
export type PartialAssignment = ReadonlyMap<string, Value>;

/** A list with at least one element: the type of a domain, so an empty one is a compile error. */
export type NonEmpty<T> = readonly [T, ...T[]];

/** Whether a list has at least one element: the runtime route to `NonEmpty` for a domain built from data. */
export function isNonEmpty<T>(values: readonly T[]): values is NonEmpty<T> {
  return values.length > 0;
}

/** Whether a value is a scalar this library can store and compare: anything JSON-shaped except a non-finite number. */
export function isScalar(value: unknown): value is Scalar {
  if (typeof value === "number") return Number.isFinite(value);

  return value === null || typeof value === "string" || typeof value === "boolean";
}

/**
 * The canonical text of a value: `[]` for unset and a one-element JSON array for a scalar. Two values are the same value exactly when their keys are equal, so `0` and `-0` coincide (JSON writes both as `0`) and `null` never collides with unset.
 */
export function valueKey(value: Value): string {
  return value === undefined ? "[]" : JSON.stringify([value]);
}

/** Whether two values are the same value under `valueKey`. */
export function sameValue(left: Value, right: Value): boolean {
  return valueKey(left) === valueKey(right);
}

/** A value as text for messages: `unset` or its JSON form. */
export function describeValue(value: Value): string {
  return value === undefined ? "unset" : JSON.stringify(value);
}
