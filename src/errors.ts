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
