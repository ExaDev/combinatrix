import type { AbortSignalLike } from "./cancellation";
import { combinationId } from "./engine";
import { LimitExceededError, StrategyError } from "./errors";
import { dimensionOf, explainRecord } from "./explain";
import { canHold, domainOf } from "./dimension";
import type { Model, ModelParts } from "./model";
import { countSearch, diagnoseSearch, searchCombinations } from "./search";
import type { Strategy } from "./strategy";
import { full, strategyContext } from "./strategy";
import type { DimensionValue, ValueRecord } from "./value";
import { valueKey } from "./value";

/** One combination in the solution set, with its stable id. */
export interface Combination<T extends ValueRecord> {
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
  readonly signal?: AbortSignalLike;
}

/** Options for `combinations` and `collect` on a model whose combinations have type `T`. */
export interface CombinationsOptions<T extends ValueRecord = ValueRecord> extends LimitOptions, CancellationOptions {
  /** Which combinations to produce: a strategy written for this model's combination type, or one written for any model. A strategy written for another model's type is a compile error. Defaults to `full`, the whole solution set. */
  readonly strategy?: Strategy<T> | Strategy;
}

/**
 * The model's combinations, lazily, in the order the strategy chooses (for `full`, lexicographic in declaration order, the first dimension varying slowest). Nothing is computed until the generator is advanced, and stopping early costs nothing further. Throws `StrategyError` if the strategy yields a record that is not a combination in the solution set, `LimitExceededError` rather than producing more than `limit` (bounding the solution set for `full` and the selection for any other strategy), and the signal's reason once `signal` aborts, which includes a signal already aborted when the generator is first advanced. The signal is passed to the strategy in its context and is also checked before each combination is produced.
 */
export function* combinations<T extends ValueRecord>(model: Model<T>, options: CombinationsOptions<T> = {}): Generator<Combination<T>> {
  const strategy = options.strategy ?? full;
  const { limit, signal } = options;
  if (limit !== undefined) checkNonNegativeInteger("limit", limit);
  signal?.throwIfAborted();

  let produced = 0;
  for (const values of selected(model, strategy, signal)) {
    signal?.throwIfAborted();
    if (limit !== undefined && produced === limit) throw new LimitExceededError(limit, strategy === full ? "solution-set" : "selection");

    if (!model.isTuple(values)) throw new StrategyError(`strategy "${strategy.name}" produced a record without every dimension of the model, or with a value outside a domain`);

    produced += 1;
    yield { id: idOf(model, strategy, values), values };
  }
}

/** What the strategy selects. `full` selects what the search produces, so the search is read directly rather than through a context, whose `completions` checks each record's type a second time. */
function selected<T extends ValueRecord>(model: Model<T>, strategy: Strategy<T> | Strategy, signal: AbortSignalLike | undefined): Iterable<ValueRecord> {
  return strategy === full ? searchCombinations(model, { signal }) : strategy.select(strategyContext(model, signal));
}

/**
 * A combination's id, checking first that a strategy other than `full` produced a combination in the solution set. `full` is the search itself, held to the reference enumeration by its tests, so its output is not explained a second time.
 */
function idOf<T extends ValueRecord>(model: ModelParts, strategy: Strategy<T> | Strategy, values: ValueRecord): string {
  if (strategy === full) return combinationId(model.dimensions, values);

  const explanation = explainRecord(model, values);
  if (!explanation.valid) throw new StrategyError(`strategy "${strategy.name}" produced a record outside the solution set: ${explanation.reasons.map((reason) => reason.kind).join(", ")}`);

  return explanation.id;
}

/**
 * Every combination the strategy chooses, as an array. With a `limit` it refuses with `LimitExceededError` rather than materialising more than that; with none it materialises the whole selection, so the memory used grows with the size of the solution set. Throws the signal's reason, and returns nothing, if `signal` aborts.
 */
export function collect<T extends ValueRecord>(model: Model<T>, options: CombinationsOptions<T> = {}): Combination<T>[] {
  return [...combinations(model, options)];
}

/**
 * The size of the solution set, counted without building the combinations. When a `limit` is given it throws `LimitExceededError` as soon as the count passes it, so a caller states how large a space it is prepared to have searched; with none it searches to the end. Throws the signal's reason if `signal` aborts.
 */
export function count(model: ModelParts, options: LimitOptions & CancellationOptions = {}): number {
  const { limit, signal } = options;
  if (limit === undefined) return countSearch(model, undefined, { signal });

  checkNonNegativeInteger("limit", limit);
  const total = countSearch(model, limit, { signal });
  if (total === undefined) throw new LimitExceededError(limit);

  return total;
}

/** A value of a dimension of a model whose combinations have type `T` that appears in no combination of the solution set: a union keyed by dimension, so testing `dimension` narrows `value`. */
export type DeadValue<T extends ValueRecord = ValueRecord> = DimensionValue<T>;

/** What `diagnose` finds for a model whose combinations have type `T`: an empty solution set, reported on its own because every value is then dead, or the count with the values that never appear. */
export type Diagnosis<T extends ValueRecord = ValueRecord> = { readonly status: "empty" } | { readonly status: "satisfiable"; readonly count: number; readonly deadValues: readonly DeadValue<T>[] };

/**
 * Reports whether the solution set is empty, and otherwise its size and every dead value: a value in a free dimension's domain or a first-valid dimension's candidates that no combination takes. A computed dimension has no declared values, so it has none to report. It counts as `count` does, memoised on the constraints' frontier, and a value is dead when the count of completions under it is zero wherever the search offers it, so the combinations themselves are never produced. Throws `LimitExceededError` past `limit` combinations when one is given, and the signal's reason if `signal` aborts.
 */
export function diagnose<T extends ValueRecord>(model: Model<T>, options: LimitOptions & CancellationOptions = {}): Diagnosis<T> {
  const { limit, signal } = options;
  if (limit !== undefined) checkNonNegativeInteger("limit", limit);
  const found = diagnoseSearch(model, limit, signal);
  if (found === undefined) {
    if (limit === undefined) throw new Error("unreachable: a search with no limit always finishes with a count");

    throw new LimitExceededError(limit);
  }
  if (found.count === 0) return { status: "empty" };

  const deadValues: DeadValue<T>[] = [];
  model.dimensions.forEach((dimension, index) => {
    const live = found.live[index];
    if (live === undefined) throw new Error(`unreachable: the search reports the live values of every dimension, "${dimension.name}" included`);

    for (const value of domainOf(dimension)) {
      if (live.has(valueKey(value))) continue;

      const dead = { dimension: dimension.name, value };
      if (!isEntryOf(model, dead)) throw new Error(`unreachable: dimension "${dimension.name}" can hold every value of its domain`);
      deadValues.push(dead);
    }
  });

  return { status: "satisfiable", count: found.count, deadValues };
}

/** Whether an entry names a dimension of the model with a value it can hold, which is what `DimensionValue<T>` states. */
function isEntryOf<T extends ValueRecord>(model: Model<T>, entry: DimensionValue): entry is DimensionValue<T> {
  const dimension = dimensionOf(model, entry.dimension);

  return dimension !== undefined && canHold(dimension, entry.value);
}

/** Throws `RangeError`, naming the option by `label`, unless `value` is a non-negative safe integer. */
export function checkNonNegativeInteger(label: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative integer, not ${String(value)}`);
}
