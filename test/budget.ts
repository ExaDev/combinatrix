import { domainOf } from "../src/dimension";
import type { ModelParts } from "../src/index";
import { randomModel, seeds } from "./random-model";

/**
 * The options argument of `it` for a test that does `operations` units of work, each allowed `perOperationMs`: a timeout derived from the work, so that a loaded machine passes and only a test that does far more work per unit than its budget names, such as a search that stops terminating, fails.
 *
 * A timeout of zero disables vitest's timeout, so an operation count or budget that is not positive is refused rather than turned into a test that never times out.
 */
export function budgetFor(operations: number, perOperationMs: number): { readonly timeout: number } {
  const timeout = Math.ceil(operations * perOperationMs);
  if (!(timeout > 0) || !Number.isFinite(timeout)) throw new RangeError(`a test budget needs a positive, finite number of operations and milliseconds each, not ${String(operations)} and ${String(perOperationMs)}`);

  return { timeout };
}

/** The number of ways to choose `size` of `total` items. */
export function subsetCount(total: number, size: number): number {
  let result = 1;
  for (let chosen = 0; chosen < size; chosen += 1) {
    result = (result * (total - chosen)) / (chosen + 1);
  }

  return result;
}

/**
 * The combinations the model's dimensions could take with every constraint ignored: the product of the options each dimension offers, unset counted for one that is conditionally active and a derived-by-function dimension counted once. An upper bound on the leaves any search of the model reaches, and so on the combinations it yields.
 */
export function candidateCount(model: ModelParts): number {
  return model.dimensions.reduce((total, dimension) => total * Math.max(1, domainOf(dimension).length + (dimension.activeWhen === undefined ? 0 : 1)), 1);
}

/** The candidates of every model `randomModel` generates, summed: the work of a test that visits each generated model once, for a test that visits it more than once to scale by its own passes. */
export const GENERATED_CANDIDATES = seeds.reduce((total, seed) => total + candidateCount(randomModel(seed)), 0);
