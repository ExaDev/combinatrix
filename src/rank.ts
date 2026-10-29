import { combinationId } from "./engine";
import type { CancellationOptions, Combination } from "./enumerate";
import { checkNonNegativeInteger } from "./enumerate";
import type { ExactRecord } from "./explain";
import { explainRecord, isPlainRecord } from "./explain";
import type { Model, ModelParts } from "./model";
import { countSearch, exactCount, rankSearch, unrankSearch } from "./search";
import type { Value } from "./value";

/**
 * The combination at `index` in enumeration order: the one `combinations(model)` produces after `index` others, with the same id. It is found by counting the combinations under each choice on the way down rather than by producing the ones before it, so its memory does not grow with the solution set. Returns `undefined` when the solution set has `index` combinations or fewer. Throws `RangeError` when `index` is not a non-negative integer (negative indices do not count from the end), or when a count on the way exceeds `Number.MAX_SAFE_INTEGER` and so could not be exact; and the signal's reason if `signal` aborts.
 */
export function at<T extends Readonly<Record<string, Value>>>(model: Model<T>, index: number, options: CancellationOptions = {}): Combination<T> | undefined {
  checkNonNegativeInteger("index", index);
  const values = unrankSearch(model, index, { signal: options.signal });

  return values === undefined ? undefined : combinationOf(model, values);
}

/**
 * The position of a combination in enumeration order, so that `at(model, indexOf(model, values))` is that combination; `-1` when the record is not a combination in the solution set, exactly when `explain` answers `valid: false`, whose reasons say why. The record is typed as one of the model's combinations, as for `explain`; for a record that arrives untyped, use `indexOfData`. Counts as `at` does, with the same `RangeError` past `Number.MAX_SAFE_INTEGER` and the signal's reason if `signal` aborts.
 */
export function indexOf<T extends Readonly<Record<string, Value>>, R extends T>(model: Model<T>, values: ExactRecord<T, R>, options: CancellationOptions = {}): number {
  return rankOf(model, values, options.signal);
}

/**
 * The position of untyped data in enumeration order, or `-1` when it is not a combination in the solution set, exactly when `explainData` answers `valid: false`: data that is not a plain object, an unknown or missing dimension, a value outside its domain or not a value at all, as well as everything `indexOf` refuses. A derived dimension may be left out, in which case its derived value is used. Throws as `indexOf` does.
 */
export function indexOfData(model: ModelParts, data: unknown, options: CancellationOptions = {}): number {
  return isPlainRecord(data) ? rankOf(model, data, options.signal) : -1;
}

function rankOf(model: ModelParts, values: Readonly<Record<string, unknown>>, signal: AbortSignal | undefined): number {
  signal?.throwIfAborted();
  if (!explainRecord(model, values).valid) return -1;

  return rankSearch(model, values, { signal });
}

/** A source of randomness: an integer at least 0 and below `bound`, each such integer equally likely, for a positive safe integer `bound`. A seeded generator makes a sample reproducible. */
export type RandomIndex = (bound: number) => number;

/** Options for `samples`. */
export interface SampleOptions extends CancellationOptions {
  /** Where every random choice comes from; the library never calls `Math.random`. */
  readonly random: RandomIndex;
}

/**
 * Combinations drawn uniformly at random from the solution set, independently and with replacement, lazily and without end: each is `at(model, random(count(model)))`. The solution set is counted once, when the generator is first advanced, and each draw then costs one `at`, so memory does not grow with the solution set or with the number of draws; the caller stops when it has enough. An empty solution set yields nothing and never calls `random`. Throws `RangeError` when `random` returns anything but an integer at least 0 and below the bound it was given, or when the count exceeds `Number.MAX_SAFE_INTEGER`; and the signal's reason once `signal` aborts, which is also checked before each draw.
 */
export function* samples<T extends Readonly<Record<string, Value>>>(model: Model<T>, options: SampleOptions): Generator<Combination<T>> {
  const { random, signal } = options;
  const total = exactCount(countSearch(model, undefined, { signal }));
  if (total === 0) return;

  for (;;) {
    signal?.throwIfAborted();
    const index = random(total);
    if (!Number.isSafeInteger(index) || index < 0 || index >= total) throw new RangeError(`random must return an integer at least 0 and below ${String(total)}, not ${String(index)}`);

    const values = unrankSearch(model, index, { signal });
    if (values === undefined) throw new Error(`unreachable: an index below the count (${String(index)} of ${String(total)}) has a combination`);

    yield combinationOf(model, values);
  }
}

/** A record the search produced, as one of the model's combinations with its id. */
function combinationOf<T extends Readonly<Record<string, Value>>>(model: Model<T>, values: Readonly<Record<string, Value>>): Combination<T> {
  if (!model.isTuple(values)) throw new Error("unreachable: the search produced a record without every dimension of the model, or with a value outside a domain");

  return { id: combinationId(model.dimensions, values), values };
}
