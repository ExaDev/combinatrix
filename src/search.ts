import { stepCheck } from "./cancellation";
import type { Step } from "./engine";
import { computeValue, firstCandidate, isActive, recordOf, stepsOf, unconditionalConstraints, verdictOf } from "./engine";
import type { ModelParts } from "./model";
import type { PartialAssignment, Value } from "./value";
import { isScalar, sameValue } from "./value";

/**
 * The values a step offers under the assignment of the steps before it: unset alone for an inactive dimension, a free dimension's whole domain, or a derived dimension's single value. Empty when a first-valid dimension has no acceptable candidate.
 */
function optionsAt(step: Step, assignment: Map<string, Value>): readonly Value[] {
  const { dimension } = step;
  if (!isActive(dimension, assignment)) return [undefined];

  if (dimension.kind === "choice") return dimension.values;
  if (dimension.kind === "computed") return [computeValue(dimension, assignment)];

  const found = firstCandidate(dimension, step.constraints, assignment);

  return found === undefined ? [] : [found.value];
}

/** Whether no constraint that mentions the step's dimension rejects the assignment as it stands. */
function admissible(step: Step, assignment: PartialAssignment): boolean {
  return step.constraints.every((constraint) => verdictOf(constraint, assignment) !== "invalid");
}

/** What restricts and interrupts `searchCombinations`; each may be absent. */
export interface SearchOptions {
  /** Restricts each dimension it names to that value. */
  readonly fixed?: PartialAssignment | undefined;
  /** Aborting it makes the search throw the signal's reason. */
  readonly signal?: AbortSignal | undefined;
}

/**
 * The model's solution set by depth-first search over the dimensions in declaration order, abandoning a branch as soon as a constraint that mentions an assigned dimension answers `invalid` on the partial assignment. Because every constraint is monotone, an abandoned branch holds no solution, and because an inactive dimension offers unset alone, no tuple is produced twice; so the sequence equals `referenceCombinations`. The `fixed` option restricts each dimension it names to that value. An aborted `signal` makes the generator throw the signal's reason, before its first step if it is already aborted and otherwise within `STEPS_PER_ABORT_CHECK` steps of the abort.
 */
export function* searchCombinations(model: ModelParts, options: SearchOptions = {}): Generator<Record<string, Value>> {
  const { fixed = new Map<string, Value>(), signal } = options;
  const checkStep = stepCheck(signal);
  if (rejectedOutright(model)) return;

  const steps = stepsOf(model);
  const assignment = new Map<string, Value>();

  function* descend(depth: number): Generator<Record<string, Value>> {
    checkStep();
    const step = steps[depth];
    if (step === undefined) {
      yield recordOf(model.dimensions, assignment);

      return;
    }
    const { name } = step.dimension;
    for (const value of optionsAt(step, assignment)) {
      if (fixed.has(name) && !sameValue(fixed.get(name), value)) continue;

      assignment.set(name, value);
      if (admissible(step, assignment)) yield* descend(depth + 1);
    }
    assignment.delete(name);
  }

  yield* descend(0);
}

/**
 * The size of the solution set, by the same search as `searchCombinations` without building a record per combination, through `countCompletions`. Returns `undefined` as soon as the count exceeds `limit`; with no limit it always returns the count. An aborted `signal` makes it throw the signal's reason, before its first step if it is already aborted and otherwise within `STEPS_PER_ABORT_CHECK` steps of the abort.
 */
export function countSearch(model: ModelParts, limit: undefined, signal?: AbortSignal): number;
export function countSearch(model: ModelParts, limit: number | undefined, signal?: AbortSignal): number | undefined;
export function countSearch(model: ModelParts, limit: number | undefined, signal?: AbortSignal): number | undefined {
  const search = countingSearch(model, signal);
  if (rejectedOutright(model)) return 0;

  return countCompletions(search, 0, new Map(), limit);
}

/** Whether a constraint that mentions no dimension rejects every combination, so the solution set is empty. */
function rejectedOutright(model: ModelParts): boolean {
  return unconditionalConstraints(model).some((constraint) => verdictOf(constraint, new Map()) === "invalid");
}

/** What counting needs besides the assignment it extends, built once per operation by `countingSearch`. */
export interface CountingSearch {
  /** The model's steps, in enumeration order. */
  readonly steps: readonly Step[];
  /** `suffixProducts(steps)`: the closed count of each depth whose remaining steps can neither reject nor collapse anything. */
  readonly unconstrainedFrom: readonly (number | undefined)[];
  /** Called once per visited node; throws the abort signal's reason. */
  readonly checkStep: () => void;
}

/** The counting context for a model. An already aborted `signal` throws its reason here, before any step. */
export function countingSearch(model: ModelParts, signal: AbortSignal | undefined): CountingSearch {
  const checkStep = stepCheck(signal);
  const steps = stepsOf(model);

  return { steps, unconstrainedFrom: suffixProducts(steps), checkStep };
}

/**
 * The number of solutions that extend an assignment of the steps before `depth`, an assignment the search reaches (every step before `depth` assigned with one of its options and admissible). It is the one function through which `countSearch` and ranking count, so a faster count, such as one memoised on the state of the constraints that still read an assigned dimension, replaces this function alone and keeps its contract. Where no remaining step is conditionally active, first-valid with constraints, or mentioned by a constraint, every combination of the remaining free values is a solution, so that subtree is counted as the product of their domain sizes without being visited. Returns `undefined` as soon as the count exceeds `limit`; with no limit it always returns the count. The assignment is left as it was found.
 */
export function countCompletions(search: CountingSearch, depth: number, assignment: Map<string, Value>, limit: undefined): number;
export function countCompletions(search: CountingSearch, depth: number, assignment: Map<string, Value>, limit: number | undefined): number | undefined;
export function countCompletions(search: CountingSearch, depth: number, assignment: Map<string, Value>, limit: number | undefined): number | undefined {
  search.checkStep();
  const closed = search.unconstrainedFrom[depth];
  if (closed !== undefined) return limit === undefined || closed <= limit ? closed : undefined;

  const step = search.steps[depth];
  if (step === undefined) throw new Error(`unreachable: the depth past the last step always has a closed count (depth ${String(depth)})`);

  const { name } = step.dimension;
  let total = 0;
  try {
    for (const value of optionsAt(step, assignment)) {
      assignment.set(name, value);
      if (!admissible(step, assignment)) continue;

      // The budget left for this subtree keeps `total` within `limit`, so it is never negative.
      const below = countCompletions(search, depth + 1, assignment, limit === undefined ? undefined : limit - total);
      if (below === undefined) return undefined;

      total += below;
    }

    return total;
  } finally {
    assignment.delete(name);
  }
}

/** Counts the completions of an assignment the search reaches below a depth, as `countCompletions` does with no limit: the seam ranking counts through. */
export type CompletionCount = (search: CountingSearch, depth: number, assignment: Map<string, Value>) => number;

/** `countCompletions` with no limit, refusing a count that a JavaScript number cannot hold exactly, since a rank built from it would be silently wrong. */
export const exactCompletions: CompletionCount = (search, depth, assignment) => exactCount(countCompletions(search, depth, assignment, undefined));

/** The count itself, or `RangeError` when it is not a safe integer and so may already have been rounded. */
export function exactCount(total: number): number {
  if (!Number.isSafeInteger(total)) throw new RangeError(`the solution set is too large to index exactly: a count reached ${String(total)}, past Number.MAX_SAFE_INTEGER`);

  return total;
}

/** What `unrankSearch` and `rankSearch` take besides the model; each may be absent. */
export interface RankingOptions {
  /** Aborting it makes the walk throw the signal's reason. */
  readonly signal?: AbortSignal | undefined;
  /** How a subtree is counted. Defaults to `exactCompletions`; a test injects a broken count to show the properties catch it. */
  readonly count?: CompletionCount | undefined;
}

/**
 * The combination at `index` in the order `searchCombinations` yields them, or `undefined` when the solution set has `index` combinations or fewer. It walks one path from the root: at each depth it counts the completions under each option in turn, through the `count` option, until the option whose subtree holds the index, so it assigns one value per step and counts at most one subtree per option of each step on the path. `index` is a non-negative safe integer.
 */
export function unrankSearch(model: ModelParts, index: number, options: RankingOptions = {}): Record<string, Value> | undefined {
  const { signal, count = exactCompletions } = options;
  const search = countingSearch(model, signal);
  if (rejectedOutright(model)) return undefined;

  const assignment = new Map<string, Value>();
  let remaining = index;
  for (const [depth, step] of search.steps.entries()) {
    search.checkStep();
    const { name } = step.dimension;
    let chosen = false;
    for (const value of optionsAt(step, assignment)) {
      assignment.set(name, value);
      if (!admissible(step, assignment)) continue;

      const below = count(search, depth + 1, assignment);
      if (remaining < below) {
        chosen = true;
        break;
      }
      remaining -= below;
    }
    if (chosen) continue;
    // Below the root the chosen option's count was the sum of these subtrees' counts and exceeded what remained, so only the root can run out: the index is past the end.
    if (depth === 0) return undefined;

    throw new Error(`unreachable: the subtree counts under dimension "${name}" do not add up to the count of the subtree that holds the index`);
  }

  // Each leaf counts one, so `remaining` is zero there, except for a model with no dimensions, whose single empty combination is the index 0 alone.
  return remaining === 0 ? recordOf(model.dimensions, assignment) : undefined;
}

/**
 * The position of a combination in the order `searchCombinations` yields them: the number of solutions before it, counted through the `count` option as the completions under each option that precedes the combination's own value at each step of its path. The record must be one `explainRecord` accepts; a dimension it leaves out takes its one option, which for a valid record is a derived or inactive dimension's value.
 */
export function rankSearch(model: ModelParts, values: Readonly<Record<string, unknown>>, options: RankingOptions = {}): number {
  const { signal, count = exactCompletions } = options;
  const search = countingSearch(model, signal);
  const assignment = new Map<string, Value>();
  let rank = 0;
  for (const [depth, step] of search.steps.entries()) {
    search.checkStep();
    const { name } = step.dimension;
    const given = Object.hasOwn(values, name);
    let found = false;
    for (const value of optionsAt(step, assignment)) {
      assignment.set(name, value);
      if (!admissible(step, assignment)) continue;

      if (!given || isSameValue(value, values[name])) {
        found = true;
        break;
      }
      rank = exactCount(rank + count(search, depth + 1, assignment));
    }
    if (!found) throw new Error(`unreachable: a record explainRecord accepts has a value of dimension "${name}" that the search offers at its depth`);
  }

  return rank;
}

/** Whether something taken from a record is a value, and the same value as `value`. */
function isSameValue(value: Value, given: unknown): boolean {
  return (given === undefined || isScalar(given)) && sameValue(value, given);
}

/**
 * For each depth, the number of completions of any assignment of the steps before it when no step from that depth on can reject or collapse anything, or `undefined` when one can. A derived dimension contributes one value; the depth past the last step contributes the one empty completion.
 */
function suffixProducts(steps: readonly Step[]): (number | undefined)[] {
  const products: (number | undefined)[] = [1];
  let product: number | undefined = 1;
  for (const step of steps.toReversed()) {
    const { dimension } = step;
    const inert = step.constraints.length === 0 && dimension.activeWhen === undefined;
    // A first-valid dimension no constraint mentions always takes its first candidate, and a computed one has one value, so only a free dimension multiplies.
    product = product !== undefined && inert ? product * (dimension.kind === "choice" ? dimension.values.length : 1) : undefined;
    products.unshift(product);
  }

  return products;
}
