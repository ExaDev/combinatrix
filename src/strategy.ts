import type { AbortSignalLike } from "./cancellation";
import type { Constraint, Verdict } from "./constraint";
import type { Dimension } from "./dimension";
import { combinedVerdict } from "./engine";
import type { Model } from "./model";
import { searchCombinations } from "./search";
import type { PartialAssignment, ValueRecord } from "./value";

/**
 * What a strategy is given: the model's parts and two ways to query its solution set. `T` is the type of one combination of the model, which types the assignments a strategy passes and the combinations it gets back; unparameterised it is `ValueRecord`, for a strategy written for any model.
 */
export interface StrategyContext<T extends ValueRecord = ValueRecord> {
  /** The dimensions, in enumeration order. */
  readonly dimensions: readonly Dimension[];
  /** Every constraint, rules first, through the three-valued contract. */
  readonly constraints: readonly Constraint[];
  /** The combined verdict of every constraint on a partial assignment: `invalid` if any rejects it, `valid` if all accept it, otherwise `unknown`. It reads the assignment as given and does not derive or collapse anything. */
  readonly test: (assignment: PartialAssignment<T>) => Verdict;
  /** Every combination in the solution set that agrees with the assignment on each dimension it names, lazily and in enumeration order. With no assignment it is the whole solution set. A value its dimension cannot take agrees with no combination, so it yields nothing. */
  readonly completions: (assignment?: PartialAssignment<T>) => Generator<T>;
  /** The caller's abort signal, when it gave one. `completions` already honours it; a strategy that searches in any other way should call `signal.throwIfAborted()` at a bounded interval of its own steps so that the throw carries the signal's reason. */
  readonly signal?: AbortSignalLike;
}

/**
 * Chooses which combinations of the solution set to produce, and in what order. `full` produces all of them, `coveringArray` a covering array of them, and a sampling strategy from another package implements the same interface. Every combination a strategy yields is checked against the model, and one outside the solution set throws `StrategyError`.
 *
 * `T` is the type of one combination of the model the strategy is for. A strategy written for one model's type is refused, at compile time, for a model of another; unparameterised it is `ValueRecord` and works for any model, its rows checked at runtime only.
 *
 * A strategy that caps what it holds or does throws `LimitExceededError` naming what it caps, such as `new LimitExceededError(limit, "rows")` past the rows it would hold, so the message says what was bounded.
 */
export interface Strategy<T extends ValueRecord = ValueRecord> {
  /** A label for messages. */
  readonly name: string;
  /** The combinations to produce, each a complete record with every dimension of the model. */
  readonly select: (context: StrategyContext<T>) => Iterable<T>;
}

/** Every combination in the solution set, in enumeration order. */
export const full: Strategy = {
  name: "full",
  select: (context) => context.completions(),
};

/** The context a strategy is given for a model, carrying `signal` when one is given. It is a context for the model's own combination type and for `ValueRecord` at once, so a strategy written for either can be given it. */
export function strategyContext<T extends ValueRecord>(model: Model<T>, signal?: AbortSignalLike): StrategyContext<T> & StrategyContext {
  return {
    ...(signal === undefined ? {} : { signal }),
    dimensions: model.dimensions,
    constraints: model.constraints,
    test: (assignment: PartialAssignment) => combinedVerdict(model.constraints, assignment),
    completions: function* (assignment?: PartialAssignment) {
      for (const values of searchCombinations(model, { fixed: assignment, signal })) {
        if (!model.isTuple(values)) throw new Error("unreachable: the search produced a record without every dimension of the model, or with a value outside a domain");

        yield values;
      }
    },
  };
}
