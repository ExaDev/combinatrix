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

/** Thrown instead of enumerating, counting or collecting past the limit a caller stated. */
export class LimitExceededError extends CombinatrixError {
  /** The limit the caller stated: the largest number of combinations it accepted. */
  readonly limit: number;

  constructor(limit: number) {
    super(`the solution set has more than ${String(limit)} combinations`);
    this.name = "LimitExceededError";
    this.limit = limit;
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
