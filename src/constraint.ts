import type { ConstraintDefect, Refusal } from "./checks";
import type { Dimension, NameOf, Read, ReadName, ReadValues, TupleOf } from "./dimension";
import { readNames, readsHold } from "./dimension";
import type { PartialAssignment, Value, ValueRecord } from "./value";

/** A constraint's answer on a partial assignment: every completion satisfies it (`valid`), none does (`invalid`), or the assignment does not decide it yet (`unknown`). */
export type Verdict = "valid" | "invalid" | "unknown";

/**
 * The three-valued constraint contract. Any constraint language plugs into this library by implementing it; the declarative rules, whose conditions are trilean predicate trees, and `predicate` are two implementations.
 *
 * The contract an implementation keeps:
 * - `dependencies` names every dimension `evaluate` reads, and nothing it does not read.
 * - `evaluate` is pure and monotone: when it answers `valid` or `invalid` for a partial assignment, it gives the same answer for every extension of that assignment. Answering `unknown` is always sound before every dependency is assigned.
 * - Once every dependency is assigned, `evaluate` answers `valid` or `invalid`, never `unknown`; the engine throws `ConstraintContractError` if it does.
 */
export interface Constraint {
  /** The dimensions the constraint reads. */
  readonly dependencies: readonly string[];
  /** Decides the constraint on a partial assignment, where a dimension absent from the map is unassigned and one mapped to `undefined` is unset. */
  readonly evaluate: (assignment: PartialAssignment) => Verdict;
  /** A label for diagnostics, such as `explain`'s report. Optional because the contract itself needs only `dependencies` and `evaluate`. */
  readonly name?: string;
}

/** A constraint built by `predicate`: the `Constraint` contract with its dependencies typed as the literal names it reads, so `defineModel` can check them against the dimensions at compile time. */
export interface Predicate<R extends string> extends Constraint {
  readonly dependencies: readonly R[];
}

/** The values a predicate reads: exactly the dimensions it declared, each set or unset. */
export type PredicateValues<R extends string> = Readonly<Record<R, Value>>;

/** The definition of a predicate constraint. `Rs` is its `reads` list, which types the values `test` receives. */
export interface PredicateDefinition<Rs extends readonly Read[]> {
  /** Every dimension `test` reads, by name or as the dimension itself. The engine calls `test` only once all of them are assigned. A dimension given as itself is read with its own value type; one given by name is read as any `Value`. */
  readonly reads: Rs;
  /** Whether a combination satisfies the constraint, from the values of the dimensions it declared. */
  readonly test: (values: Readonly<ReadValues<Rs>>) => boolean;
  /** A label for diagnostics. */
  readonly name?: string;
}

/** The definition of a predicate bound to a model whose combinations have type `T`: `reads` names only the model's dimensions, and `test` receives each one's own value type. */
export interface TypedPredicateDefinition<T, R extends keyof T & string> {
  /** Every dimension `test` reads, each a dimension of the model. */
  readonly reads: readonly R[];
  /** Whether a combination satisfies the constraint, from the values of the dimensions it declared, each typed as that dimension's values. */
  readonly test: (values: Readonly<Pick<T, R>>) => boolean;
  /** A label for diagnostics. */
  readonly name?: string;
}

/** What a `constraints` callback given to `defineModel` receives: builders bound to the model's dimensions `Ds`. */
export interface ConstraintTools<Ds extends readonly Dimension[]> {
  /**
   * `predicate` with `reads` checked against the dimensions and `test` typed with each read dimension's values. A value outside its dimension's domain can never be in a combination, so a read of one (which only a strategy's own test assignment can supply) answers `invalid` without calling `test`. A computed dimension's values are not known ahead, so its value is passed as computed.
   */
  readonly predicate: <const R extends NameOf<Ds>>(definition: TypedPredicateDefinition<TupleOf<Ds>, R> & Refusal<ConstraintDefect<Ds, R>>) => Predicate<R>;
}

/**
 * A constraint from an arbitrary function: the escape hatch for a rule the declarative forms cannot state. It answers `unknown` until every dimension in `reads` is assigned and then calls `test`, so a function that reads only what it declared is a sound constraint. It is not serialisable; the declarative rules are.
 *
 * A dimension given in `reads` as itself is read with its own value type, so a value it can never hold (which only a strategy's own test assignment can supply) answers `invalid` without calling `test`, as the predicate bound to the model does.
 */
export function predicate<const Rs extends readonly Read[]>(definition: PredicateDefinition<Rs>): Predicate<ReadName<Rs[number]>> {
  const { reads, test } = definition;

  return namedPredicate(readNames(reads), (values) => holdsReads(values, reads) && test(values), definition.name);
}

/**
 * A predicate over the dimensions named in `reads`: it answers `unknown` until every one is assigned, then `valid` or `invalid` as `test` answers on their values. Both `predicate` and the predicate bound to a model are built on it.
 */
export function namedPredicate<R extends string>(reads: readonly R[], test: (values: Readonly<PredicateValues<R>>) => boolean, name: string | undefined): Predicate<R> {
  const evaluate = (assignment: PartialAssignment): Verdict => {
    if (!reads.every((dimension) => assignment.has(dimension))) return "unknown";

    const values: Record<string, Value> = {};
    for (const dimension of reads) values[dimension] = assignment.get(dimension);

    return test(readValues(values, reads)) ? "valid" : "invalid";
  };

  return name === undefined ? { dependencies: reads, evaluate } : { dependencies: reads, evaluate, name };
}

/** Narrows a record built from exactly the declared keys to the predicate's value type. */
function readValues<R extends string>(values: ValueRecord, reads: readonly R[]): PredicateValues<R> {
  if (!hasKeys(values, reads)) throw new Error("unreachable: every declared dimension was copied");

  return values;
}

function hasKeys<R extends string>(values: ValueRecord, keys: readonly R[]): values is PredicateValues<R> {
  return keys.every((key) => Object.hasOwn(values, key));
}

/** Whether every dimension the `reads` list gives as itself can hold the value under its name, which with the keys `namedPredicate` guarantees is what `ReadValues` states. */
function holdsReads<Rs extends readonly Read[]>(values: ValueRecord, reads: Rs): values is ValueRecord & ReadValues<Rs> {
  return readsHold(reads, values);
}
