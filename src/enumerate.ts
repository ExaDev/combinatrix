import { combinationId } from "./engine";
import { LimitExceededError, StrategyError } from "./errors";
import { explainRecord } from "./explain";
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
  /** A non-negative integer. Going past it throws `LimitExceededError` instead of carrying on. With no limit the operation runs to completion, however large the solution set. */
  readonly limit?: number;
}

/** Cooperative cancellation of a search. */
export interface CancellationOptions {
  /**
   * When it aborts, the operation stops and throws the signal's reason, as `signal.throwIfAborted()` does, leaving no partial result. A signal that is already aborted throws before any work. The signal is read at a bounded interval of search steps, so a little work can run after the abort, never an unbounded amount.
   */
  readonly signal?: AbortSignal;
}

/** Options for `combinations` and `collect`. */
export interface CombinationsOptions extends LimitOptions, CancellationOptions {
  /** Which combinations to produce. Defaults to `full`, the whole solution set. */
  readonly strategy?: Strategy;
}

/**
 * The model's combinations, lazily, in the order the strategy chooses (for `full`, lexicographic in declaration order, the first dimension varying slowest). Nothing is computed until the generator is advanced, and stopping early costs nothing further. Throws `StrategyError` if the strategy yields a record that is not a combination in the solution set, `LimitExceededError` rather than producing more than `limit`, and the signal's reason once `signal` aborts, which includes a signal already aborted when the generator is first advanced. The signal is passed to the strategy in its context and is also checked before each combination is produced.
 */
export function* combinations<T extends Readonly<Record<string, Value>>>(model: Model<T>, options: CombinationsOptions = {}): Generator<Combination<T>> {
  const strategy = options.strategy ?? full;
  const { limit, signal } = options;
  if (limit !== undefined) checkLimit(limit);
  signal?.throwIfAborted();

  let produced = 0;
  for (const values of strategy.select(strategyContext(model, signal))) {
    signal?.throwIfAborted();
    if (limit !== undefined && produced === limit) throw new LimitExceededError(limit);

    if (!model.isTuple(values)) throw new StrategyError(`strategy "${strategy.name}" produced a record without every dimension of the model, or with a value outside a domain`);

    produced += 1;
    yield { id: idOf(model, strategy, values), values };
  }
}

/**
 * A combination's id, checking first that a strategy other than `full` produced a combination in the solution set. `full` is the search itself, held to the reference enumeration by its tests, so its output is not explained a second time.
 */
function idOf(model: ModelParts, strategy: Strategy, values: Readonly<Record<string, Value>>): string {
  if (strategy === full) return combinationId(model.dimensions, values);

  const explanation = explainRecord(model, values);
  if (!explanation.valid) throw new StrategyError(`strategy "${strategy.name}" produced a record outside the solution set: ${explanation.reasons.map((reason) => reason.kind).join(", ")}`);

  return explanation.id;
}

/**
 * Every combination the strategy chooses, as an array. With a `limit` it refuses with `LimitExceededError` rather than materialising more than that; with none it materialises the whole selection, so the memory used grows with the size of the solution set. Throws the signal's reason, and returns nothing, if `signal` aborts.
 */
export function collect<T extends Readonly<Record<string, Value>>>(model: Model<T>, options: CombinationsOptions = {}): Combination<T>[] {
  return [...combinations(model, options)];
}

/**
 * The size of the solution set, counted without building the combinations. When a `limit` is given it throws `LimitExceededError` as soon as the count passes it, so a caller states how large a space it is prepared to have searched; with none it searches to the end. Throws the signal's reason if `signal` aborts.
 */
export function count(model: ModelParts, options: LimitOptions & CancellationOptions = {}): number {
  const { limit, signal } = options;
  if (limit === undefined) return countSearch(model, undefined, signal);

  checkLimit(limit);
  const total = countSearch(model, limit, signal);
  if (total === undefined) throw new LimitExceededError(limit);

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
 * Searches the whole solution set and reports whether it is empty, and otherwise its size and every dead value: a value in a free dimension's domain or a first-valid dimension's candidates that no combination takes. A computed dimension has no declared values, so it has none to report. Throws `LimitExceededError` past `limit` combinations when one is given, and the signal's reason if `signal` aborts.
 */
export function diagnose(model: ModelParts, options: LimitOptions & CancellationOptions = {}): Diagnosis {
  const { limit, signal } = options;
  if (limit !== undefined) checkLimit(limit);
  const seen = model.dimensions.map((dimension) => ({ dimension, keys: new Set<string>() }));
  let total = 0;
  for (const record of searchCombinations(model, { signal })) {
    total += 1;
    if (limit !== undefined && total > limit) throw new LimitExceededError(limit);

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
