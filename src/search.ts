import { stepCheck } from "./cancellation";
import type { Step } from "./engine";
import { computeValue, firstCandidate, isActive, recordOf, stepsOf, unconditionalConstraints, verdictOf } from "./engine";
import type { ModelParts } from "./model";
import type { PartialAssignment, Value } from "./value";
import { sameValue } from "./value";

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
  if (unconditionalConstraints(model).some((constraint) => verdictOf(constraint, new Map()) === "invalid")) return;

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
 * The size of the solution set, by the same search as `searchCombinations` without building a record per combination. Where no remaining dimension is conditionally active, first-valid with constraints, or mentioned by a constraint, every combination of the remaining free values is a solution, so that subtree is counted as the product of their domain sizes. Returns `undefined` as soon as the count exceeds `limit`; with no limit it always returns the count. An aborted `signal` makes it throw the signal's reason, before its first step if it is already aborted and otherwise within `STEPS_PER_ABORT_CHECK` steps of the abort.
 */
export function countSearch(model: ModelParts, limit: undefined, signal?: AbortSignal): number;
export function countSearch(model: ModelParts, limit: number | undefined, signal?: AbortSignal): number | undefined;
export function countSearch(model: ModelParts, limit: number | undefined, signal?: AbortSignal): number | undefined {
  const checkStep = stepCheck(signal);
  if (unconditionalConstraints(model).some((constraint) => verdictOf(constraint, new Map()) === "invalid")) return 0;

  const steps = stepsOf(model);
  const unconstrainedFrom = suffixProducts(steps);
  const assignment = new Map<string, Value>();
  let total = 0;

  /** Adds the solutions below `depth` to the total; false once the total exceeds the limit, which ends the search. */
  function descend(depth: number): boolean {
    checkStep();
    const closed = unconstrainedFrom[depth];
    if (closed !== undefined) {
      total += closed;

      return limit === undefined || total <= limit;
    }
    const step = steps[depth];
    if (step === undefined) throw new Error(`unreachable: the depth past the last step always has a closed count (depth ${String(depth)})`);

    const { name } = step.dimension;
    try {
      for (const value of optionsAt(step, assignment)) {
        assignment.set(name, value);
        if (admissible(step, assignment) && !descend(depth + 1)) return false;
      }

      return true;
    } finally {
      assignment.delete(name);
    }
  }

  return descend(0) ? total : undefined;
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
