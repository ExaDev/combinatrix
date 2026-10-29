import { computeValue, firstCandidate, isActive, recordOf, stepsOf, verdictOf } from "./engine";
import type { ModelParts } from "./model";
import type { Value } from "./value";
import { valueKey } from "./value";

/**
 * The reference enumeration, written for obviousness rather than speed: every combination of the free dimensions' values in lexicographic order (the first dimension varying slowest), each completed by collapsing inactive dimensions to unset and deriving the derived ones, kept when every constraint holds, and dropped when an earlier combination already produced the same tuple. The pruning search must yield exactly this sequence.
 */
export function* referenceCombinations(model: ModelParts): Generator<Record<string, Value>> {
  const steps = stepsOf(model);
  const free = model.dimensions.filter((dimension) => dimension.kind === "choice");
  const seen = new Set<string>();
  for (const raw of cartesian(free.map((dimension) => dimension.values))) {
    const chosen = new Map(free.map((dimension, index) => [dimension.name, raw[index]]));
    const assignment = new Map<string, Value>();
    let derivable = true;
    for (const { dimension, constraints } of steps) {
      if (!derivable) break;

      if (!isActive(dimension, assignment)) {
        assignment.set(dimension.name, undefined);
        continue;
      }
      switch (dimension.kind) {
        case "choice":
          assignment.set(dimension.name, chosen.get(dimension.name));
          break;
        case "computed":
          assignment.set(dimension.name, computeValue(dimension, assignment));
          break;
        case "first-valid": {
          const found = firstCandidate(dimension, constraints, assignment);
          if (found === undefined) derivable = false;
          else assignment.set(dimension.name, found.value);
          break;
        }
      }
    }
    if (!derivable || model.constraints.some((constraint) => verdictOf(constraint, assignment) !== "valid")) continue;

    const record = recordOf(model.dimensions, assignment);
    const key = model.dimensions.map((dimension) => valueKey(record[dimension.name])).join(",");
    if (seen.has(key)) continue;

    seen.add(key);
    yield record;
  }
}

/** Every tuple of the Cartesian product of the lists, in lexicographic order with the first list varying slowest. One empty tuple for no lists. */
function* cartesian(lists: readonly (readonly Value[])[]): Generator<Value[]> {
  const [head, ...tail] = lists;
  if (head === undefined) {
    yield [];

    return;
  }
  for (const value of head) {
    for (const rest of cartesian(tail)) yield [value, ...rest];
  }
}
