import type { IndeterminateReason } from "trilean";

import type { Scalar } from "./value";

/** The base class of every error this library throws, so a caller can catch the library's failures without catching unrelated ones. */
export class CombinatrixError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CombinatrixError";
  }
}

/** Thrown by `defineModel` when the dimensions, rules or constraints do not form a valid model. Every defect found is listed, not only the first. */
export class ModelError extends CombinatrixError {
  /** One message per defect, in the order the model declares the offending parts. */
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`invalid model:\n${issues.map((issue) => `  ${issue}`).join("\n")}`);
    this.name = "ModelError";
    this.issues = issues;
  }
}

/**
 * What a limit bounded, which is what `LimitExceededError` reports going past:
 * - `solution-set`: the combinations in the model's solution set, the bound `count`, `diagnose` and a `full` enumeration apply.
 * - `selection`: the combinations a strategy other than `full` selected, the bound `combinations` and `collect` apply to such a strategy's output.
 * - `rows`: the rows a strategy holds while it constructs its selection, such as a covering array's candidate rows.
 * - `steps`: the work a strategy does, counted in steps of its own search.
 */
export type LimitBound = "solution-set" | "selection" | "rows" | "steps";

/** The message for going past a limit, by what the limit bounded, from the limit written out. */
const LIMIT_MESSAGES: Readonly<Record<LimitBound, (amount: string) => string>> = {
  "solution-set": (amount) => `the solution set has more than ${amount} combinations`,
  selection: (amount) => `the strategy selected more than ${amount} combinations`,
  rows: (amount) => `the strategy would hold more than ${amount} rows`,
  steps: (amount) => `the strategy would take more than ${amount} steps`,
};

/** Thrown instead of going past a limit a caller stated: enumerating, counting or collecting past it, or a strategy holding or doing more than it. `bound` says what was limited and the message is worded from it. */
export class LimitExceededError extends CombinatrixError {
  /** The limit the caller stated: the largest amount of what `bound` names that it accepted. */
  readonly limit: number;

  /** What the limit bounded. */
  readonly bound: LimitBound;

  /** `bound` is `solution-set` when not given, the bound of the library's own `limit` option on the solution set. A strategy applying its own cap names what it caps, such as `rows`. */
  constructor(limit: number, bound: LimitBound = "solution-set") {
    super(LIMIT_MESSAGES[bound](String(limit)));
    this.name = "LimitExceededError";
    this.limit = limit;
    this.bound = bound;
  }
}

/** Thrown when a constraint breaks the three-valued contract: it answered `unknown` once every dimension it depends on was assigned. */
export class ConstraintContractError extends CombinatrixError {
  constructor(message: string) {
    super(message);
    this.name = "ConstraintContractError";
  }
}

/** Thrown when a strategy yields a combination that is not in the model's solution set. */
export class StrategyError extends CombinatrixError {
  constructor(message: string) {
    super(message);
    this.name = "StrategyError";
  }
}

/**
 * Thrown by `trileanConstraint` when a tree cannot be a constraint over the given dimensions: it does not parse as a trilean predicate tree, uses a node kind whose resolver the adapter cannot provide, references a key that is not a string or names no dimension, calls a function the registry does not hold, tags a reference with a unit, or reads a dimension that can take a value with no trilean counterpart. Every defect found is listed, not only the first.
 */
export class PredicateTreeError extends CombinatrixError {
  /** One message per defect, each naming where in the tree it is (`$` is the root). */
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      `invalid trilean constraint:\n${issues.map((issue) => `  ${issue}`).join("\n")}`,
    );
    this.name = "PredicateTreeError";
    this.issues = issues;
  }
}

/**
 * Thrown by `trileanConstraint` when evaluating the tree could exhaust trilean's default evaluation budget. A tree accepted by the adapter visits each of its nodes at most once per evaluation, so its node count and its depth are exactly what an evaluation can spend, and checking them when the constraint is defined means the budget is never met partway through an evaluation.
 */
export class EvaluationBudgetError extends CombinatrixError {
  /** Which of the evaluator's two budgets the tree exceeds: `nodes` is its node count against `maxNodes`, `depth` its deepest node's nesting depth (the root is at 0) against `maxNestingDepth`. */
  readonly budget: "nodes" | "depth";

  /** The tree's own node count or deepest nesting depth. */
  readonly actual: number;

  /** The evaluator's default for that budget: the largest node count it accepts, or the first nesting depth it refuses. */
  readonly limit: number;

  constructor(budget: "nodes" | "depth", actual: number, limit: number) {
    super(
      budget === "nodes"
        ? `the tree has ${String(actual)} nodes, more than the ${String(limit)} one evaluation may visit`
        : `the tree nests to depth ${String(actual)}, and evaluation refuses depth ${String(limit)} and deeper`,
    );
    this.name = "EvaluationBudgetError";
    this.budget = budget;
    this.actual = actual;
    this.limit = limit;
  }
}

/**
 * Thrown by a trilean constraint that is still indeterminate once every dimension it reads is assigned, which combinatrix's contract forbids: there is nothing left to wait for, so the tree has no answer for that combination. The usual cause is reading a dimension that is unset there without guarding it with `exists`, which leaves a `compare` indeterminate with `not-found`; `and(exists(reference), compare(...))` is definitely false when the dimension is unset, because a definite false absorbs. It extends `ConstraintContractError`, the error combinatrix raises for the same breach, and carries trilean's own reason.
 */
export class UndecidedConstraintError extends ConstraintContractError {
  /** Trilean's reason the evaluation stayed indeterminate. */
  readonly reason: IndeterminateReason;

  constructor(label: string, reason: Readonly<IndeterminateReason>) {
    super(
      `${label} is indeterminate with every dimension it reads assigned (${reason.code}: ${reason.message})`,
    );
    this.name = "UndecidedConstraintError";
    this.reason = reason;
  }
}

/**
 * Thrown when a trilean constraint reads a computed dimension whose function produced `null`, which has no trilean value: trilean's values are text, numbers, booleans and its own richer kinds, and its absence is a resolver's report rather than a value. A choice or first-valid dimension that can take `null` is refused earlier, by `trileanConstraint` itself, since its domain is known when the constraint is defined.
 */
export class UnmappableValueError extends CombinatrixError {
  /** The dimension whose value could not be mapped. */
  readonly dimension: string;

  /** The value it held. */
  readonly value: Scalar;

  constructor(dimension: string, value: Scalar) {
    super(
      `dimension "${dimension}" holds ${JSON.stringify(value)}, which has no trilean value`,
    );
    this.name = "UnmappableValueError";
    this.dimension = dimension;
    this.value = value;
  }
}
