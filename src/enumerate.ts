import { LimitExceededError, StrategyError } from "./errors";
import { explain } from "./explain";
import type { Model, ModelParts } from "./model";
import { domainOf } from "./model";
import { countSearch, searchCombinations } from "./search";
import type { Strategy } from "./strategy";
import { full, strategyContext } from "./strategy";
import type { Value } from "./value";
import { valueKey } from "./value";

/** One combination in the solution set, with its stable id. */
export interface Combination<T extends Readonly<Record<string, Value>>> {
  /** The hash of the combination's canonical form: equal for equal combinations of the same model, whatever strategy produced them or in what order. */
  readonly id: string;
  readonly values: T;
}

/** The largest number of combinations a caller accepts. */
export interface LimitOptions {
  /** A non-negative integer. Going past it throws `LimitExceededError` instead of carrying on. */
  readonly limit: number;
}

/** Options for `combinations`. */
export interface CombinationsOptions {
  /** Which combinations to produce. Defaults to `full`, the whole solution set. */
  readonly strategy?: Strategy;
  /** When given, throws `LimitExceededError` instead of producing more combinations than this. */
  readonly limit?: number;
}

/**
 * The model's combinations, lazily, in the order the strategy chooses (for `full`, lexicographic in declaration order, the first dimension varying slowest). Nothing is computed until the generator is advanced, and stopping early costs nothing further. Throws `StrategyError` if the strategy yields a record that is not a combination in the solution set.
 */
export function* combinations<T extends Readonly<Record<string, Value>>>(model: Model<T>, options: CombinationsOptions = {}): Generator<Combination<T>> {
  const strategy = options.strategy ?? full;
  const { limit } = options;
  if (limit !== undefined) checkLimit(limit);

  let produced = 0;
  for (const values of strategy.select(strategyContext(model))) {
    if (limit !== undefined && produced === limit) throw new LimitExceededError(limit);

    const explanation = explain(model, values);
    if (!explanation.valid) throw new StrategyError(`strategy "${strategy.name}" produced a record outside the solution set: ${explanation.reasons.map((reason) => reason.kind).join(", ")}`);
    if (!model.isTuple(values)) throw new StrategyError(`strategy "${strategy.name}" produced a record without every dimension of the model`);

    produced += 1;
    yield { id: explanation.id, values };
  }
}

/** Every combination the strategy chooses, as an array, refusing with `LimitExceededError` rather than materialising more than `limit`. */
export function collect<T extends Readonly<Record<string, Value>>>(model: Model<T>, options: LimitOptions & Pick<CombinationsOptions, "strategy">): Combination<T>[] {
  return [...combinations(model, options)];
}

/**
 * The size of the solution set, counted without building the combinations. Throws `LimitExceededError` as soon as the count passes `limit`, so a caller states how large a space it is prepared to have searched.
 */
export function count(model: ModelParts, options: LimitOptions): number {
  checkLimit(options.limit);
  const total = countSearch(model, options.limit);
  if (total === undefined) throw new LimitExceededError(options.limit);

  return total;
}

/** A value of a dimension that appears in no combination of the solution set. */
export interface DeadValue {
  readonly dimension: string;
  readonly value: Value;
}

/** What `diagnose` finds: an empty solution set, reported on its own because every value is then dead, or the count with the values that never appear. */
export type Diagnosis = { readonly status: "empty" } | { readonly status: "satisfiable"; readonly count: number; readonly deadValues: readonly DeadValue[] };

/**
 * Searches the whole solution set and reports whether it is empty, and otherwise its size and every dead value: a value in a free dimension's domain or a first-valid dimension's candidates that no combination takes. A computed dimension has no declared values, so it has none to report. Throws `LimitExceededError` past `limit` combinations.
 */
export function diagnose(model: ModelParts, options: LimitOptions): Diagnosis {
  checkLimit(options.limit);
  const seen = model.dimensions.map((dimension) => ({ dimension, keys: new Set<string>() }));
  let total = 0;
  for (const record of searchCombinations(model)) {
    total += 1;
    if (total > options.limit) throw new LimitExceededError(options.limit);

    for (const { dimension, keys } of seen) keys.add(valueKey(record[dimension.name]));
  }
  if (total === 0) return { status: "empty" };

  const deadValues = seen.flatMap(({ dimension, keys }) =>
    domainOf(dimension)
      .filter((value) => !keys.has(valueKey(value)))
      .map((value) => ({ dimension: dimension.name, value })),
  );

  return { status: "satisfiable", count: total, deadValues };
}

function checkLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError(`limit must be a non-negative integer, not ${String(limit)}`);
}
