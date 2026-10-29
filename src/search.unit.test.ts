import { describe, expect, it } from "vitest";

import { budgetFor, GENERATED_CANDIDATES } from "../test/budget";
import { randomModel, seeds } from "../test/random-model";
import type { ModelParts, Value } from "./index";
import { choice, defineModel, isNonEmpty, predicate } from "./index";
import { referenceCombinations } from "./reference";
import { countSearch, searchCombinations } from "./search";

/** The time a test may spend per candidate combination of the generated models, in milliseconds, whatever the number of times the test searches it or enumerates it by the reference: at least two hundred times what the heaviest of them takes on an idle machine, so a machine under heavy load still passes and only a search that stops terminating fails. */
const CANDIDATE_BUDGET_MS = 10;
/** The options of a test that visits every generated model. */
const GENERATED_MODELS = budgetFor(GENERATED_CANDIDATES, CANDIDATE_BUDGET_MS);

/** Whether a search agrees with the reference on a model: the same records in the same order. */
function agrees(search: (model: ModelParts) => Iterable<Record<string, Value>>, model: ModelParts, reference: ModelParts = model): boolean {
  const expected = JSON.stringify([...referenceCombinations(reference)].map((record) => Object.entries(record)));
  const actual = JSON.stringify([...search(model)].map((record) => Object.entries(record)));

  return expected === actual;
}

/** The model with every constraint answering `invalid` where it would answer `unknown`: an over-eager pruner, which the property must catch. */
function prunesOnUnknown(model: ModelParts): ModelParts {
  const constraints = model.constraints.map((constraint) => ({ ...constraint, evaluate: (assignment: ReadonlyMap<string, Value>) => (constraint.evaluate(assignment) === "unknown" ? "invalid" : constraint.evaluate(assignment)) }));

  return { ...model, constraints };
}


describe("searchCombinations", () => {
  it("yields exactly the reference's combinations, in the reference's order, for every generated model", GENERATED_MODELS, () => {
    const disagreements = seeds.filter((seed) => !agrees(searchCombinations, randomModel(seed)));
    expect(disagreements).toEqual([]);
  });

  it("generates models whose solution sets are neither all empty nor all full", GENERATED_MODELS, () => {
    const sizes = seeds.map((seed) => [...referenceCombinations(randomModel(seed))].length);
    expect(sizes.some((size) => size === 0)).toBe(true);
    expect(sizes.some((size) => size > 1)).toBe(true);
  });

  it("is caught by the property when its pruning is broken", GENERATED_MODELS, () => {
    const caught = seeds.filter((seed) => {
      const model = randomModel(seed);

      return !agrees((broken) => searchCombinations(broken), prunesOnUnknown(model), model);
    });
    expect(caught.length).toBeGreaterThan(0);
  });

  it("restricts each dimension a fixed assignment names to that value", GENERATED_MODELS, () => {
    for (const seed of seeds) {
      const model = randomModel(seed);
      const [first] = model.dimensions;
      if (first?.kind !== "choice") continue;

      for (const value of first.values) {
        const fixed = new Map([[first.name, value]]);
        const expected = [...referenceCombinations(model)].filter((record) => record[first.name] === value);
        expect([...searchCombinations(model, { fixed })]).toEqual(expected);
      }
    }
  });
});

describe("countSearch", () => {
  it("counts exactly the reference's combinations for every generated model", GENERATED_MODELS, () => {
    const disagreements = seeds.filter((seed) => {
      const model = randomModel(seed);

      return countSearch(model, Number.MAX_SAFE_INTEGER) !== [...referenceCombinations(model)].length;
    });
    expect(disagreements).toEqual([]);
  });

  it("reports going past the limit, and not reaching it", GENERATED_MODELS, () => {
    for (const seed of seeds) {
      const model = randomModel(seed);
      const size = [...referenceCombinations(model)].length;
      expect(countSearch(model, size)).toBe(size);
      if (size > 0) expect(countSearch(model, size - 1)).toBeUndefined();
    }
  });

  it("counts an unconstrained space as a product without visiting it", () => {
    const size = 10;
    const dimensionCount = 6;
    const evaluated: Value[] = [];
    const domain = Array.from({ length: size }, (_, value) => value);
    if (!isNonEmpty(domain)) throw new Error("the size is positive");
    const dimensions = Array.from({ length: dimensionCount }, (_, index) => choice(`d${String(index)}`, domain));
    const excludesZero = predicate({
      reads: ["d0"],
      test: ({ d0 }) => {
        evaluated.push(d0);

        return d0 !== 0;
      },
    });
    const model = defineModel({ dimensions, constraints: [excludesZero] });
    expect(countSearch(model, Number.MAX_SAFE_INTEGER)).toBe((size - 1) * size ** (dimensionCount - 1));
    expect(evaluated).toHaveLength(size);
  });
});
