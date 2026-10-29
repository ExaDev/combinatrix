import type { AbortSignalLike } from "./cancellation";
import { stepCheck } from "./cancellation";
import type { Step } from "./engine";
import { computeValue, firstCandidate, isActive, recordOf, stepsOf, unconditionalConstraints, verdictOf } from "./engine";
import type { ModelParts } from "./model";
import type { PartialAssignment, Value } from "./value";
import { isScalar, sameValue, valueKey } from "./value";

/**
 * The values a step offers under the assignment of the steps before it: unset alone for an inactive dimension, a free dimension's whole domain, or a derived dimension's single value. Empty when a first-valid dimension has no acceptable candidate.
 */
function optionsAt(step: Step, assignment: Map<string, Value>): readonly Value[] {
  const { dimension } = step;
  if (!isActive(step, assignment)) return [undefined];

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
  readonly signal?: AbortSignalLike | undefined;
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

/** Counts the completions of an assignment the search reaches below a depth, returning `undefined` as soon as the count exceeds `limit`: the contract `countCompletions` and `naiveCompletions` share. */
export type LimitedCompletionCount = (search: CountingSearch, depth: number, assignment: Map<string, Value>, limit: number | undefined) => number | undefined;

/** What `countSearch` takes besides the model and limit; each may be absent. */
export interface CountSearchOptions {
  /** Aborting it makes the count throw the signal's reason. */
  readonly signal?: AbortSignalLike | undefined;
  /** How the solution set is counted. Defaults to the memoised `countCompletions`; a test passes `naiveCompletions` to compare the two. */
  readonly completions?: LimitedCompletionCount | undefined;
}

/**
 * The size of the solution set, by the same search as `searchCombinations` without building a record per combination, through the `completions` option. Returns `undefined` as soon as the count exceeds `limit`; with no limit it always returns the count. An aborted `signal` makes it throw the signal's reason, before its first step if it is already aborted and otherwise within `STEPS_PER_ABORT_CHECK` steps of the abort.
 */
export function countSearch(model: ModelParts, limit: undefined, options?: CountSearchOptions): number;
export function countSearch(model: ModelParts, limit: number | undefined, options?: CountSearchOptions): number | undefined;
export function countSearch(model: ModelParts, limit: number | undefined, options: CountSearchOptions = {}): number | undefined {
  const { signal, completions = countCompletions } = options;
  const search = countingSearch(model, signal);
  if (rejectedOutright(model)) return 0;

  return completions(search, 0, new Map(), limit);
}

/** What `diagnoseSearch` finds in a solution set within its limit. */
export interface SearchDiagnosis {
  /** The size of the solution set. */
  readonly count: number;
  /** For each dimension, in declaration order, the `valueKey` of every value some combination of the solution set gives it. */
  readonly live: readonly ReadonlySet<string>[];
}

/**
 * The size of the solution set and the values each dimension takes in it, from the memoised suffix counts rather than from the combinations: a value is live exactly when some assignment the search reaches offers it, admits it, and leaves a positive count of completions under it. The walk visits each frontier state of each depth once and descends only into states with a positive count, so it costs no more than the count itself plus one memoised lookup per option of each visited state. Returns `undefined` as soon as the count exceeds `limit`, at the same boundary as `countSearch`; an aborted `signal` throws its reason as `countSearch` does.
 */
export function diagnoseSearch(model: ModelParts, limit: number | undefined, signal?: AbortSignalLike): SearchDiagnosis | undefined {
  const search = countingSearch(model, signal);
  const live = search.steps.map(() => new Set<string>());
  if (rejectedOutright(model)) return { count: 0, live };

  const total = countCompletions(search, 0, new Map(), limit);
  if (total === undefined) return undefined;

  const visited = search.steps.map(() => new Set<string>());
  const assignment = new Map<string, Value>();
  let closedMarked = false;

  /** Marks the values each step from `depth` on takes, when every step from there is inert: a free dimension takes each of its values and an inert first-valid one its first candidate, since no constraint can reject it. */
  function markClosed(depth: number): void {
    if (closedMarked) return;

    closedMarked = true;
    search.steps.slice(depth).forEach(({ dimension }, offset) => {
      const keys = live[depth + offset];
      if (keys === undefined) throw new Error("unreachable: there is a set of live values per step");
      if (dimension.kind === "choice") for (const value of dimension.values) keys.add(valueKey(value));
      if (dimension.kind === "first-valid") keys.add(valueKey(dimension.candidates[0]));
    });
  }

  function visit(depth: number): void {
    search.checkStep();
    // Every depth from the first closed one on is closed too, and the walk enters a depth only under a positive count, so a closed depth's product is positive and every value it offers is taken.
    if (search.unconstrainedFrom[depth] !== undefined) {
      markClosed(depth);

      return;
    }
    const { step, frontier, seen, keys } = layerOf(search, depth, visited, live);
    const key = frontierKey(frontier, assignment);
    if (seen.has(key)) return;

    seen.add(key);
    const { name } = step.dimension;
    try {
      for (const value of optionsAt(step, assignment)) {
        assignment.set(name, value);
        if (!admissible(step, assignment) || countCompletions(search, depth + 1, assignment, undefined) === 0) continue;

        keys.add(valueKey(value));
        visit(depth + 1);
      }
    } finally {
      assignment.delete(name);
    }
  }

  if (total > 0) visit(0);

  return { count: total, live };
}

/** The step, frontier, visited frontier states and live value keys of an unclosed depth of a diagnosis walk. */
function layerOf(search: CountingSearch, depth: number, visited: readonly Set<string>[], live: readonly Set<string>[]): { readonly step: Step; readonly frontier: readonly string[]; readonly seen: Set<string>; readonly keys: Set<string> } {
  const step = search.steps[depth];
  const frontier = search.frontiers[depth];
  const seen = visited[depth];
  const keys = live[depth];
  if (step === undefined || frontier === undefined || seen === undefined || keys === undefined) throw new Error(`unreachable: the depth past the last step always has a closed count (depth ${String(depth)})`);

  return { step, frontier, seen, keys };
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
  /** `frontiersOf(steps)`: for each depth, the dimensions before it whose values the steps from it on read, in declaration order. */
  readonly frontiers: readonly (readonly string[])[];
  /** For each depth, the number of completions of each frontier state counted so far, keyed by `frontierKey`. It is the only state a count keeps, and it is created per operation, so it never outlives the model value it was counted from. */
  readonly completions: readonly Map<string, number>[];
  /** Called once per visited node; throws the abort signal's reason. */
  readonly checkStep: () => void;
}

/** The counting context for one operation on a model, with an empty memo. An already aborted `signal` throws its reason here, before any step. */
export function countingSearch(model: ModelParts, signal: AbortSignalLike | undefined): CountingSearch {
  const checkStep = stepCheck(signal);
  const steps = stepsOf(model);

  return { steps, unconstrainedFrom: suffixProducts(steps), frontiers: frontiersOf(steps), completions: steps.map(() => new Map<string, number>()), checkStep };
}

/**
 * The number of solutions that extend an assignment of the steps before `depth`, an assignment the search reaches (every step before `depth` assigned with one of its options and admissible), memoised on the assignment's frontier state at that depth: the values of the dimensions before it that a step from it on still reads. It is the one function through which `countSearch`, `diagnoseSearch` and ranking count.
 *
 * Everything below `depth` is a function of the frontier state alone. The steps from `depth` on read an assigned dimension only through a constraint that mentions them, which by the `Constraint` contract reads exactly its declared `dependencies`; through an `activeWhen` condition, which reads the dimensions it mentions; and through a computed dimension's `reads`, which `compute` receives and nothing else. `frontiersOf` collects exactly those. The set of assigned dimensions is the same at a given depth on every path, so whether a read dimension is assigned never differs between two states either. Two assignments that agree on the frontier therefore offer the same options, admit the same values and derive the same values at every step below, and have the same number of completions; so the first count of a frontier state is stored and every later visit to that state returns it. A constraint whose `evaluate` reads a dimension it does not declare breaks the contract, and the search's pruning already depends on the declaration being complete, since it evaluates a constraint only at the steps of its declared dependencies.
 *
 * The memo holds at most one entry per distinct frontier state reached at each depth, so its size is bounded by the sum over depths of the product, over that depth's frontier, of the number of values each frontier dimension can hold, however large the solution set is; and each entry is counted once, visiting one node per option of its step. A chain of constraints between adjacent dimensions has a frontier of one dimension at every depth, so it is counted in work linear in the number of dimensions and quadratic in the domain size, where a search without the memo visits every solution.
 *
 * Where no remaining step is conditionally active, first-valid with constraints, or mentioned by a constraint, every combination of the remaining free values is a solution, so that subtree is counted as the product of their domain sizes without being visited. Returns `undefined` as soon as the count exceeds `limit`, at the same boundary as `naiveCompletions`; with no limit it always returns the count. A subtree abandoned at the limit is not stored, so every stored count is exact. The assignment is left as it was found.
 */
export function countCompletions(search: CountingSearch, depth: number, assignment: Map<string, Value>, limit: undefined): number;
export function countCompletions(search: CountingSearch, depth: number, assignment: Map<string, Value>, limit: number | undefined): number | undefined;
export function countCompletions(search: CountingSearch, depth: number, assignment: Map<string, Value>, limit: number | undefined): number | undefined {
  search.checkStep();
  const closed = search.unconstrainedFrom[depth];
  if (closed !== undefined) return withinLimit(closed, limit);

  const step = search.steps[depth];
  const frontier = search.frontiers[depth];
  const memo = search.completions[depth];
  if (step === undefined || frontier === undefined || memo === undefined) throw new Error(`unreachable: the depth past the last step always has a closed count (depth ${String(depth)})`);

  const key = frontierKey(frontier, assignment);
  const known = memo.get(key);
  if (known !== undefined) return withinLimit(known, limit);

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
    memo.set(key, total);

    return total;
  } finally {
    assignment.delete(name);
  }
}

/**
 * The reference for `countCompletions`: the same search without the memo, visiting every node of the subtree under the assignment, so its work grows with the number of solutions. Only the tests use it, to hold the memoised count to it. Same contract, closed products and limit boundary as `countCompletions`.
 */
export const naiveCompletions: LimitedCompletionCount = (search, depth, assignment, limit) => {
  search.checkStep();
  const closed = search.unconstrainedFrom[depth];
  if (closed !== undefined) return withinLimit(closed, limit);

  const step = search.steps[depth];
  if (step === undefined) throw new Error(`unreachable: the depth past the last step always has a closed count (depth ${String(depth)})`);

  const { name } = step.dimension;
  let total = 0;
  try {
    for (const value of optionsAt(step, assignment)) {
      assignment.set(name, value);
      if (!admissible(step, assignment)) continue;

      // The budget left for this subtree keeps `total` within `limit`, so it is never negative.
      const below = naiveCompletions(search, depth + 1, assignment, limit === undefined ? undefined : limit - total);
      if (below === undefined) return undefined;

      total += below;
    }

    return total;
  } finally {
    assignment.delete(name);
  }
};

/** The count, or `undefined` when it exceeds `limit`. */
function withinLimit(total: number, limit: number | undefined): number | undefined {
  return limit === undefined || total <= limit ? total : undefined;
}

/**
 * The memo key of an assignment's frontier state: the `valueKey` of each frontier dimension's value, concatenated in frontier order. Each `valueKey` is a complete JSON array, which no proper prefix of another JSON array is, so the concatenation splits back into the same values one way only, and two states have the same key exactly when they give every frontier dimension the same value.
 */
function frontierKey(frontier: readonly string[], assignment: PartialAssignment): string {
  let key = "";
  for (const name of frontier) key += valueKey(assignment.get(name));

  return key;
}

/** The dimensions a step reads besides its own: every dependency of a constraint that mentions it, the dimensions its `activeWhen` mentions, and a computed dimension's `reads`. */
function readsOf(step: Step): string[] {
  const { dimension, activity } = step;

  return [...step.constraints.flatMap((constraint) => constraint.dependencies), ...(activity === undefined ? [] : activity.dependencies), ...(dimension.kind === "computed" ? dimension.reads : [])];
}

/**
 * For each depth from 0 to the number of steps, the frontier: the dimensions declared before that depth that some step at or after it reads (see `readsOf`), in declaration order. A dimension is in the frontier of every depth after its own up to and including the last step that reads it, so a constraint whose dependencies are all assigned leaves the frontier once its last dependency is, having been decided there.
 */
function frontiersOf(steps: readonly Step[]): string[][] {
  const lastRead = new Map<string, number>();
  // Steps are visited in increasing depth, so each dimension ends mapped to the deepest step that reads it.
  steps.forEach((step, depth) => {
    for (const name of readsOf(step)) lastRead.set(name, depth);
  });

  return Array.from({ length: steps.length + 1 }, (_, depth) =>
    steps
      .slice(0, depth)
      .map((step) => step.dimension.name)
      .filter((name) => {
        const last = lastRead.get(name);

        return last !== undefined && last >= depth;
      }),
  );
}

/** Counts the completions of an assignment the search reaches below a depth, as `countCompletions` does with no limit: the seam ranking counts through, so a test can rank through `naiveCompletions` or a broken count instead. */
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
  readonly signal?: AbortSignalLike | undefined;
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
