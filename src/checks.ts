import type { TypedCondition } from "./condition";
import type { Constraint } from "./constraint";
import type { Dimension, TupleOf } from "./dimension";
import type { Value } from "./value";

/**
 * Compile-time counterparts of the checks `defineModel` makes at runtime, over the literal types of a definition written in code. Each yields a union of messages, `never` when there is nothing to report. A part whose type is not literal (a name typed `string`, a condition typed `Condition`, a rule typed `TypedRule<T>`) is data whose content the compiler cannot see, so it yields nothing and is left to the runtime checks.
 */

/** Whether a condition type is wide, such as `Condition` or `TypedCondition<T>`, rather than the literal type of one condition: only a wide type admits an `all` of any length. */
type IsWide<C> = { readonly all: readonly never[] } extends C ? true : false;

/** The dimension names a condition type mentions, or `string` when any of it is wide. */
export type MentionedNames<C> =
  IsWide<C> extends true
    ? string
    : C extends { readonly is: readonly [infer N extends string, unknown] }
      ? N
      : C extends { readonly in: readonly [infer N extends string, unknown] }
        ? N
        : C extends { readonly set: infer N extends string }
          ? N
          : C extends { readonly unset: infer N extends string }
            ? N
            : C extends { readonly all: readonly (infer S)[] }
              ? MentionedNames<S>
              : C extends { readonly any: readonly (infer S)[] }
                ? MentionedNames<S>
                : C extends { readonly not: infer S }
                  ? MentionedNames<S>
                  : never;

/** The defect in a dimension's activity condition against the combination type `Before` of the dimensions declared before it. */
type ActivityDefect<H extends Dimension, Before extends Readonly<Record<string, Value>>> =
  H extends { readonly activeWhen?: infer C }
    ? string extends MentionedNames<NonNullable<C>>
      ? never
      : [Exclude<MentionedNames<NonNullable<C>>, keyof Before>] extends [never]
        ? NonNullable<C> extends TypedCondition<Before>
          ? never
          : `the activity of dimension "${H["name"]}" compares a dimension with a value it can never take`
        : `dimension "${H["name"]}" is active depending on "${Exclude<MentionedNames<NonNullable<C>>, keyof Before>}", which is not a dimension declared before it`
    : never;

/** The defect in a computed dimension's reads against the dimensions declared before it. */
type ReadsDefect<H extends Dimension, Before extends Readonly<Record<string, Value>>> = H extends { readonly kind: "computed"; readonly reads: readonly (infer R extends string)[] } ? (string extends R ? never : [Exclude<R, keyof Before>] extends [never] ? never : `dimension "${H["name"]}" reads "${Exclude<R, keyof Before>}", which is not a dimension declared before it`) : never;

/**
 * Every defect in a tuple of dimensions, walked in declaration order with `Earlier` the dimensions already passed: a name declared twice, an activity condition on a later or unknown dimension or comparing with a value it can never take, and a computed dimension reading a later or unknown one. A dimension whose name is not literal ends the walk, since the names after it can no longer be told apart; an array that is not a tuple is not walked at all.
 */
export type DimensionDefects<Ds extends readonly Dimension[], Earlier extends readonly Dimension[] = readonly []> = Ds extends readonly [infer H extends Dimension, ...infer Rest extends readonly Dimension[]]
  ? string extends H["name"]
    ? never
    : (H["name"] extends Earlier[number]["name"] ? `dimension "${H["name"]}" is declared more than once` : never) | ActivityDefect<H, TupleOf<Earlier>> | ReadsDefect<H, TupleOf<Earlier>> | DimensionDefects<Rest, readonly [...Earlier, H]>
  : never;

/** The names of the dimensions declared after the one named `F`. */
type NamesAfter<Ds extends readonly Dimension[], F extends string> = Ds extends readonly [infer H extends Dimension, ...infer Rest extends readonly Dimension[]] ? (H["name"] extends F ? Rest[number]["name"] : NamesAfter<Rest, F>) : never;

/** The defect in a constraint mentioning the names `M`: a first-valid dimension among them with another declared after it, since its candidate must be chosen from earlier values alone. */
type OrderDefect<Ds extends readonly Dimension[], M extends string, Label extends string> = Extract<Ds[number], { readonly kind: "first-valid" }>["name"] extends infer F extends string
  ? F extends M
    ? [Extract<M, NamesAfter<Ds, F>>] extends [never]
      ? never
      : `${Label} mentions first-valid dimension "${F}" and "${Extract<M, NamesAfter<Ds, F>>}" declared after it`
    : never
  : never;

/** Every condition a rule type contains. */
type RuleConditions<R> = (R extends { readonly when: infer C } ? C : never) | (R extends { readonly unless: infer C } ? C : never) | (R extends { readonly requires: infer C } ? C : never) | (R extends { readonly excludes: infer C } ? C : never) | (R extends { readonly implies: readonly [infer A, infer B] } ? A | B : never);

/** Every defect in a tuple of rules that their own types cannot express: a first-valid dimension mentioned with one declared after it. Names and values are checked by the rules' type, `TypedRule`. */
export type RuleDefects<Ds extends readonly Dimension[], Rs extends readonly unknown[]> = Rs[number] extends infer R ? (R extends unknown ? (string extends MentionedNames<RuleConditions<R>> ? never : OrderDefect<Ds, MentionedNames<RuleConditions<R>>, "a rule">) : never) : never;

/** Every defect in a tuple of constraints whose dependencies are literal, such as `predicate`'s: an unknown dimension, or a first-valid dimension with one declared after it. A constraint whose dependencies are typed `string` is checked at runtime only. */
export type ConstraintDefects<Ds extends readonly Dimension[], Cs extends readonly Constraint[]> = Cs[number] extends infer K extends Constraint ? (K extends unknown ? ConstraintDefect<Ds, K["dependencies"][number]> : never) : never;

/** The defects of one constraint depending on the names `D`. */
type ConstraintDefect<Ds extends readonly Dimension[], D extends string> = string extends D ? never : (D extends Ds[number]["name"] ? never : `a constraint depends on unknown dimension "${D}"`) | OrderDefect<Ds, D, "a constraint">;

/** A parameter type that accepts its argument only when there are no defects, and otherwise names them in an `error` property the argument lacks. */
export type Refusal<D extends string> = [D] extends [never] ? unknown : { readonly error: D };
