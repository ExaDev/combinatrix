import type { Constraint, Verdict } from "./constraint";
import type { Dimension } from "./dimension";
import { combinedVerdict } from "./engine";
import type { ModelParts } from "./model";
import { searchCombinations } from "./search";
import type { PartialAssignment, Value } from "./value";

/** What a strategy is given: the model's parts and two ways to query its solution set. */
export interface StrategyContext {
  /** The dimensions, in enumeration order. */
  readonly dimensions: readonly Dimension[];
  /** Every constraint, rules first, through the three-valued contract. */
  readonly constraints: readonly Constraint[];
  /** The combined verdict of every constraint on a partial assignment: `invalid` if any rejects it, `valid` if all accept it, otherwise `unknown`. It reads the assignment as given and does not derive or collapse anything. */
  readonly test: (assignment: PartialAssignment) => Verdict;
  /** Every combination in the solution set that agrees with the assignment on each dimension it names, lazily and in enumeration order. With no assignment it is the whole solution set. */
  readonly completions: (assignment?: PartialAssignment) => Generator<Readonly<Record<string, Value>>>;
}

/**
 * Chooses which combinations of the solution set to produce, and in what order. `full` produces all of them; a covering-array or sampling strategy from another package implements the same interface. Every combination a strategy yields is checked against the model, and one outside the solution set throws `StrategyError`.
 */
export interface Strategy {
  /** A label for messages. */
  readonly name: string;
  /** The combinations to produce, each a complete record with every dimension of the model. */
  readonly select: (context: StrategyContext) => Iterable<Readonly<Record<string, Value>>>;
}

/** Every combination in the solution set, in enumeration order. */
export const full: Strategy = {
  name: "full",
  select: (context) => context.completions(),
};

/** The context a strategy is given for a model. */
export function strategyContext(model: ModelParts): StrategyContext {
  return {
    dimensions: model.dimensions,
    constraints: model.constraints,
    test: (assignment) => combinedVerdict(model.constraints, assignment),
    completions: (assignment) => searchCombinations(model, assignment),
  };
}
