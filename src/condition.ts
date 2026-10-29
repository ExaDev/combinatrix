import type { PartialAssignment, Scalar, Value } from "./value";
import { sameValue } from "./value";

/**
 * A condition over dimension values, as plain JSON-shaped data with any string as a dimension name: the form a condition read from JSON has. `isCondition` checks data against it, and `defineModel` checks its names and values against the dimensions at runtime. A condition written in code is checked at compile time as a `TypedCondition` instead.
 *
 * - `{ is: [dimension, value] }`: the dimension is set to the value.
 * - `{ in: [dimension, values] }`: the dimension is set to one of the values.
 * - `{ unset: dimension }`: the dimension is unset.
 * - `{ set: dimension }`: the dimension is set to any value.
 * - `{ all: conditions }`, `{ any: conditions }`, `{ not: condition }`: conjunction, disjunction and negation. An empty `all` holds and an empty `any` does not.
 */
export type Condition =
  | { readonly is: readonly [string, Scalar] }
  | { readonly in: readonly [string, readonly Scalar[]] }
  | { readonly unset: string }
  | { readonly set: string }
  | { readonly all: readonly Condition[] }
  | { readonly any: readonly Condition[] }
  | { readonly not: Condition };

/** The names of the dimensions of a combination type. */
type NamesIn<T> = keyof T & string;

/** The names of the dimensions of a combination type that can be unset: those whose value type includes `undefined`. */
export type UnsettableIn<T> = { readonly [K in NamesIn<T>]: undefined extends T[K] ? K : never }[NamesIn<T>];

/**
 * A condition checked against the dimensions at compile time. `T` is the type of one combination (`CombinationOf<typeof model>`, or `TupleOf<typeof dimensions>`), and each form is correlated with it: `is` and `in` pair a dimension's name with that dimension's own values, `set` takes any dimension and `unset` only a dimension that can be unset. A typed condition is a `Condition`, so it evaluates as one. Over a combination type with plain string keys it accepts what `Condition` accepts.
 */
export type TypedCondition<T extends Readonly<Record<string, Value>>> =
  | { readonly is: { readonly [K in NamesIn<T>]: readonly [K, Extract<T[K], Scalar>] }[NamesIn<T>] }
  | { readonly in: { readonly [K in NamesIn<T>]: readonly [K, readonly Extract<T[K], Scalar>[]] }[NamesIn<T>] }
  | { readonly unset: UnsettableIn<T> }
  | { readonly set: NamesIn<T> }
  | { readonly all: readonly TypedCondition<T>[] }
  | { readonly any: readonly TypedCondition<T>[] }
  | { readonly not: TypedCondition<T> };

/** A three-valued truth: `true`, `false`, or `undefined` when the partial assignment does not yet decide it. */
export type Truth = boolean | undefined;

/**
 * Evaluates a condition with Kleene's strong three-valued logic. A test on an unassigned dimension is unknown; `all` is false as soon as one operand is false and `any` is true as soon as one is true, whatever the others are. The result is monotone: a definite answer on a partial assignment is the answer on every completion of it.
 */
export function evaluateCondition(condition: Condition, assignment: PartialAssignment): Truth {
  if ("is" in condition) {
    const [dimension, expected] = condition.is;

    return assignment.has(dimension) ? sameValue(assignment.get(dimension), expected) : undefined;
  }
  if ("in" in condition) {
    const [dimension, candidates] = condition.in;
    if (!assignment.has(dimension)) return undefined;

    const actual = assignment.get(dimension);

    return candidates.some((candidate) => sameValue(actual, candidate));
  }
  if ("unset" in condition) {
    return assignment.has(condition.unset) ? assignment.get(condition.unset) === undefined : undefined;
  }
  if ("set" in condition) {
    return assignment.has(condition.set) ? assignment.get(condition.set) !== undefined : undefined;
  }
  if ("all" in condition) {
    return conjunction(condition.all.map((operand) => evaluateCondition(operand, assignment)));
  }
  if ("any" in condition) {
    return negation(conjunction(condition.any.map((operand) => negation(evaluateCondition(operand, assignment)))));
  }

  return negation(evaluateCondition(condition.not, assignment));
}

/** Kleene conjunction: false if any operand is false, true if every operand is true, otherwise unknown. */
export function conjunction(operands: readonly Truth[]): Truth {
  if (operands.includes(false)) return false;

  return operands.every((operand) => operand === true) ? true : undefined;
}

/** Kleene negation: unknown stays unknown. */
export function negation(operand: Truth): Truth {
  return operand === undefined ? undefined : !operand;
}

/** Kleene implication, `not antecedent or consequent`. */
export function implication(antecedent: Truth, consequent: Truth): Truth {
  return negation(conjunction([antecedent, negation(consequent)]));
}

/** One mention of a dimension in a condition, with the values it is compared against: `undefined` alone for `unset`, and none for `set`, which holds for any value. */
export interface Mention {
  readonly dimension: string;
  readonly values: readonly Value[];
}

/** Every dimension a condition mentions, in the order written, with the values each mention compares against. */
export function conditionMentions(condition: Condition): Mention[] {
  if ("is" in condition) return [{ dimension: condition.is[0], values: [condition.is[1]] }];
  if ("in" in condition) return [{ dimension: condition.in[0], values: condition.in[1] }];
  if ("unset" in condition) return [{ dimension: condition.unset, values: [undefined] }];
  if ("set" in condition) return [{ dimension: condition.set, values: [] }];
  if ("all" in condition) return condition.all.flatMap(conditionMentions);
  if ("any" in condition) return condition.any.flatMap(conditionMentions);

  return conditionMentions(condition.not);
}

/** The distinct dimensions a condition mentions, in the order first mentioned. */
export function conditionDependencies(condition: Condition): string[] {
  return [...new Set(conditionMentions(condition).map((mention) => mention.dimension))];
}
