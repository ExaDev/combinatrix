import type { ExpressionNode, PredicateNode } from "trilean";

import type { NamesIn, Scalar, Value, ValueRecord } from "./value";

/**
 * A condition over dimension values: a trilean predicate tree whose `reference` nodes name dimensions, as plain JSON-shaped data. It is evaluated by trilean with Kleene's strong three-valued logic over a partial assignment, where an unassigned dimension is not yet known and an unset one is known to be absent. `isCondition` checks data against trilean's schema; `defineModel` checks its dimension names and values against the model at runtime. A condition written with the builders (`is`, `oneOf`, `isSet`, `isUnset`, `allOf`, `anyOf`, `not`) is checked at compile time too, as a `ConditionOf<M>`.
 */
export type Condition = PredicateNode;

/** A value a condition can compare a dimension with: a scalar trilean has a literal for. `null` has none, so it is not one. */
export type Comparable = Exclude<Scalar, null>;

/** One dimension a condition mentions, with the values it compares that dimension against: none for `isSet`, which holds for any value, and `undefined` alone for `isUnset`. Exists only in types. */
export interface Mention {
  readonly dimension: string;
  readonly values: Value;
}

/** The key of the phantom property that carries a condition's mentions. It is declared and never assigned, so no condition has it at runtime and a condition serialises as the bare tree. */
declare const MENTIONS: unique symbol;

/** Something carrying the mentions `M` in its type alone: the phantom part of `ConditionOf<M>`. */
export interface Mentioning<M> {
  readonly [MENTIONS]?: M;
}

/**
 * A condition whose type records the dimensions and values it mentions, which is what the builders return so that `defineModel` can check a condition written in code against the dimensions at compile time. At runtime it is exactly a `Condition`: the record is a phantom property no condition has. A `Condition` with no record, such as a tree parsed from JSON, is assignable to every `ConditionOf<M>` and so is accepted by the compiler and checked by `defineModel` at runtime.
 */
export type ConditionOf<M extends Mention> = Condition & Mentioning<M>;

/** The mentions a condition type records, or `never` for one that records none, such as a bare `Condition`. */
export type MentionsOf<C> = C extends Mentioning<infer M extends Mention> ? M : never;

/** Whether the values of a dimension, unset aside, are all of one kind trilean can compare: all text, all numbers or all booleans. */
type IsOneKind<V> = [V] extends [never] ? true : [V] extends [string] ? true : [V] extends [number] ? true : [V] extends [boolean] ? true : false;

/**
 * Every mention a condition may make of the dimensions of the combination type `T`: each dimension with values it can take, `undefined` included only where it can be unset. trilean has no value for `null` and compares only values of one kind, so a dimension that can take `null` cannot be mentioned at all, and one whose values are of more than one kind only by `isSet` and `isUnset`. Over a combination type with plain string keys it is any mention, left to the runtime checks.
 */
export type MentionOf<T extends ValueRecord> = string extends NamesIn<T>
  ? Mention
  : { readonly [K in NamesIn<T>]: null extends T[K] ? never : { readonly dimension: K; readonly values: IsOneKind<Exclude<T[K], undefined>> extends true ? T[K] : Extract<T[K], undefined> } }[NamesIn<T>];

/**
 * A condition checked against the dimensions of the combination type `T` (`CombinationOf<typeof model>`, or `TupleOf<typeof dimensions>`) at compile time: every dimension a builder mentions in it is one of `T`'s, compared only with values it can take, and tested for unset only where it can be unset. A bare `Condition` records no mentions, so it is accepted and left to the runtime checks.
 */
export type TypedCondition<T extends ValueRecord> = ConditionOf<MentionOf<T>>;

/** A reference to a dimension by name. */
function reference(dimension: string): ExpressionNode {
  return { kind: "reference", key: dimension };
}

/** The trilean literal of a comparable value. A `null`, which only untyped JavaScript can pass, has no literal and throws `TypeError`. */
function literal(value: Comparable): ExpressionNode {
  if (typeof value === "string") return { kind: "textLiteral", value };
  if (typeof value === "number") return { kind: "numberLiteral", value };
  if (typeof value === "boolean") return { kind: "booleanLiteral", value };

  throw new TypeError(`${JSON.stringify(value)} has no trilean literal: a condition compares a dimension only with a string, a number or a boolean`);
}

/**
 * The dimension is set to one of the values: `exists(d) and d in values`. The `exists` guard makes the condition false where the dimension is unset, as a trilean comparison on an absent value is indeterminate rather than false. Equality is trilean's `memberOf`, under which `0` and `-0` are one value as they are in a combination. With no values it never holds.
 */
export function oneOf<const N extends string, const V extends Comparable>(dimension: N, values: readonly V[]): ConditionOf<{ readonly dimension: N; readonly values: V }> {
  return { kind: "and", left: isSet(dimension), right: { kind: "memberOf", op: "in", operand: reference(dimension), candidates: values.map(literal) } };
}

/** The dimension is set to the value: `oneOf(dimension, [value])`. */
export function is<const N extends string, const V extends Comparable>(dimension: N, value: V): ConditionOf<{ readonly dimension: N; readonly values: V }> {
  return oneOf(dimension, [value]);
}

/** The dimension is set to any value: trilean's `exists`. */
export function isSet<const N extends string>(dimension: N): ConditionOf<{ readonly dimension: N; readonly values: never }> {
  return { kind: "exists", operand: reference(dimension) };
}

/** The dimension is unset: `not(exists(d))`. Its type refuses it, in `defineModel`, for a dimension that is never unset; at runtime the tree is `not(isSet(d))`, simply false there, so it is not refused. */
export function isUnset<const N extends string>(dimension: N): ConditionOf<{ readonly dimension: N; readonly values: undefined }> {
  return not(isSet(dimension));
}

/** Every condition holds: trilean's `allOf`. With none it holds. */
export function allOf<const Cs extends readonly Condition[]>(...conditions: Cs): ConditionOf<MentionsOf<Cs[number]>> {
  return { kind: "allOf", operands: [...conditions] };
}

/** At least one condition holds: trilean's `anyOf`. With none it does not hold. */
export function anyOf<const Cs extends readonly Condition[]>(...conditions: Cs): ConditionOf<MentionsOf<Cs[number]>> {
  return { kind: "anyOf", operands: [...conditions] };
}

/** The condition does not hold: trilean's `not`. Unknown stays unknown. */
export function not<const C extends Condition>(condition: C): ConditionOf<MentionsOf<C>> {
  return { kind: "not", operand: condition };
}
