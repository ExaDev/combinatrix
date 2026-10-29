import { describe, expect, it } from "vitest";

import { hashTest, Random, randomModel, seeds, VALUE_POOL } from "../test/random-model";
import type { Constraint, Diagnosis, Dimension, Model, ModelParts, Value } from "./index";
import { at, choice, computed, count, defineModel, diagnose, firstValid, indexOf, isNonEmpty, LimitExceededError, predicate } from "./index";
import { domainOf } from "./dimension";
import type { CompletionCount, CountingSearch } from "./search";
import { countCompletions, countingSearch, countSearch, naiveCompletions, rankSearch, searchCombinations, unrankSearch } from "./search";
import { valueKey } from "./value";

type AnyModel = Model<Readonly<Record<string, Value>>>;

/** The most free dimensions a late-constrained model has. */
const MAX_LATE_DIMENSIONS = 5;
/** The largest domain a late-constrained model's free dimension has. */
const MAX_LATE_DOMAIN = 3;
/** The most predicates a late-constrained model has. */
const MAX_LATE_PREDICATES = 3;

/** `naiveCompletions` with no limit, as the ranking seam takes it. */
const naiveExact: CompletionCount = (search, depth, assignment) => {
  const total = naiveCompletions(search, depth, assignment, undefined);
  if (total === undefined) throw new Error("unreachable: a count with no limit always finishes");

  return total;
};

/**
 * A random model whose constraints are all decided at its last free dimension or after it: every predicate on the free dimensions reads the last one together with a random selection of the earlier ones, so every depth carries a wide frontier to the end. It also has conditionally active dimensions that may be unset, and may end with a computed dimension that a constraint reads and a first-valid dimension constrained by the free ones.
 */
function lateModel(seed: number): AnyModel {
  const random = new Random(seed);
  const dimensions: Dimension[] = [];
  const names: string[] = [];
  const freeCount = random.int(2, MAX_LATE_DIMENSIONS);
  for (let index = 0; index < freeCount; index += 1) {
    const name = `d${String(index)}`;
    const values = random.subset(VALUE_POOL, random.int(1, MAX_LATE_DOMAIN));
    dimensions.push(names.length > 0 && random.chance() ? choice(name, values, { activeWhen: { set: random.pick(names) } }) : choice(name, values));
    names.push(name);
  }
  const last = names.at(-1);
  if (last === undefined) throw new Error("unreachable: a late-constrained model has at least two free dimensions");

  const constraints: Constraint[] = Array.from({ length: random.int(1, MAX_LATE_PREDICATES) }, (_, index) => predicate({ reads: [...new Set([...random.subset(names, random.int(1, names.length)), last])], test: hashTest(seed + index) }));
  if (random.chance()) {
    dimensions.push(computed("sum", { reads: random.subset(names, random.int(1, names.length)), compute: (values) => Object.values(values).filter((value) => value !== undefined).length }));
    // A constraint on the computed value makes the values it is computed from matter after it, so a frontier that left one of its reads out would be caught.
    constraints.push(predicate({ reads: ["sum", last], test: hashTest(seed + MAX_LATE_PREDICATES) }));
  }
  if (random.chance()) {
    dimensions.push(firstValid("derived", random.subset(VALUE_POOL, random.int(1, MAX_LATE_DOMAIN))));
    constraints.push(predicate({ reads: [...random.subset(names, random.int(1, names.length)), "derived"], test: hashTest(seed - 1) }));
  }

  return defineModel({ dimensions, constraints });
}

/** Every model the equivalence properties are checked against: the generated models of every feature, and the late-constrained ones. */
const models: readonly { readonly label: string; readonly model: AnyModel }[] = [...seeds.map((seed) => ({ label: `random ${String(seed)}`, model: randomModel(seed) })), ...seeds.map((seed) => ({ label: `late ${String(seed)}`, model: lateModel(seed) }))];

/** The diagnosis by the plain search: every combination produced and its values collected, as `diagnose` worked before it counted through the memo. `"limit"` when the solution set has more than `limit` combinations. */
function referenceDiagnosis(model: ModelParts, limit?: number): Diagnosis | "limit" {
  const seen = model.dimensions.map((dimension) => ({ dimension, keys: new Set<string>() }));
  let total = 0;
  for (const record of searchCombinations(model)) {
    total += 1;
    if (limit !== undefined && total > limit) return "limit";

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

/** `diagnose`, with a refusal at the limit reported as `"limit"`. */
function diagnosisOf(model: AnyModel, limit?: number): Diagnosis | "limit" {
  try {
    return diagnose(model, limit === undefined ? {} : { limit });
  } catch (error) {
    if (error instanceof LimitExceededError) return "limit";

    throw error;
  }
}

/** The labels of the models on which the memoised count, given the search to count through, disagrees with the naive one. */
function countDisagreements(searchOf: (model: ModelParts) => CountingSearch): string[] {
  return models.filter(({ model }) => countCompletions(searchOf(model), 0, new Map(), undefined) !== naiveCompletions(countingSearch(model, undefined), 0, new Map(), undefined)).map(({ label }) => label);
}

describe("the memoised count", () => {
  it("generates late-constrained models whose solution sets are neither all empty nor all full", () => {
    const sizes = seeds.map((seed) => count(lateModel(seed)));
    expect(sizes.some((size) => size === 0)).toBe(true);
    expect(sizes.some((size) => size > 1)).toBe(true);
  });

  it("counts what the naive search counts, and refuses past a limit at the same boundary, on every model", () => {
    const disagreements = models.filter(({ model }) => {
      const size = countSearch(model, undefined, { completions: naiveCompletions });

      return countSearch(model, undefined) !== size || countSearch(model, size) !== size || (size > 0 && (countSearch(model, size - 1) !== undefined || countSearch(model, size - 1, { completions: naiveCompletions }) !== undefined));
    });
    expect(disagreements).toEqual([]);
  });

  it("diagnoses what the naive search diagnoses, the status, count and dead values alike, and refuses past a limit where it does", () => {
    const disagreements = models.filter(({ model }) => {
      const expected = referenceDiagnosis(model);
      const size = expected === "limit" || expected.status === "empty" ? 0 : expected.count;

      return JSON.stringify(diagnosisOf(model)) !== JSON.stringify(expected) || JSON.stringify(diagnosisOf(model, size)) !== JSON.stringify(referenceDiagnosis(model, size)) || (size > 0 && diagnosisOf(model, size - 1) !== "limit");
    });
    expect(disagreements).toEqual([]);
  });

  it("ranks and unranks as the naive count does, at every index and for every combination", () => {
    const disagreements = models.filter(({ model }) => {
      const size = count(model);
      for (let index = 0; index <= size; index += 1) {
        const found = unrankSearch(model, index);
        if (JSON.stringify(found) !== JSON.stringify(unrankSearch(model, index, { count: naiveExact }))) return true;
        if (found !== undefined && (rankSearch(model, found) !== index || rankSearch(model, found, { count: naiveExact }) !== index)) return true;
      }

      return false;
    });
    expect(disagreements).toEqual([]);
  });

  it("is caught by the equivalence property when the frontier leaves out a dimension it reads", () => {
    const dropFirst = (model: ModelParts): CountingSearch => {
      const search = countingSearch(model, undefined);

      return { ...search, frontiers: search.frontiers.map((frontier) => frontier.slice(1)) };
    };
    expect(countDisagreements((model) => countingSearch(model, undefined))).toEqual([]);
    expect(countDisagreements(dropFirst).length).toBeGreaterThan(0);
  });
});

describe("the work of the memoised count", () => {
  const DOMAIN = 5;
  const STEPS = 20;
  /** Each step is mentioned by at most two constraints of a chain: the one to the dimension before it and the one to the dimension after it. */
  const CONSTRAINTS_PER_STEP = 2;

  class WorkBoundExceeded extends Error {}

  /**
   * A chain of `STEPS` dimensions over `DOMAIN` values, each constraint requiring a dimension to differ from the one `span` places after it, wrapped to count its evaluations and throw past `bound`. The frontier at every depth is at most the `span` dimensions before it, so its width is `span`, while the solution set grows as a power of the domain size in the number of dimensions.
   */
  function chainModel(span: number, bound: number): { readonly model: AnyModel; readonly reset: () => number } {
    let work = 0;
    const domain = Array.from({ length: DOMAIN }, (_, value) => value);
    if (!isNonEmpty(domain)) throw new Error("the domain size is positive");
    const names = Array.from({ length: STEPS }, (_, index) => `c${String(index)}`);
    const constraints = names.slice(span).map((name, index): Constraint => {
      const before = names[index];
      if (before === undefined) throw new Error("unreachable: every dimension past the span has one span places before it");
      const differ = predicate({ reads: [before, name], test: (values) => values[before] !== values[name] });

      return {
        dependencies: differ.dependencies,
        evaluate: (assignment) => {
          work += 1;
          if (work > bound) throw new WorkBoundExceeded(`more than ${String(bound)} constraint evaluations`);

          return differ.evaluate(assignment);
        },
      };
    });
    const model = defineModel({ dimensions: names.map((name) => choice(name, domain)), constraints });

    return {
      model,
      reset: () => {
        const done = work;
        work = 0;

        return done;
      },
    };
  }

  /** The size of a chain's solution set: the first `span` dimensions take any value and each later one any value but one. */
  function chainSize(span: number): number {
    return DOMAIN ** span * (DOMAIN - 1) ** (STEPS - span);
  }

  for (const span of [1, 2]) {
    /** The frontier at a depth holds at most `span` dimensions of `DOMAIN` values, so there are at most `DOMAIN ** span` states per depth; each is counted once, trying each of `DOMAIN` options against at most `CONSTRAINTS_PER_STEP` constraints. */
    const BOUND = STEPS * DOMAIN ** (span + 1) * CONSTRAINTS_PER_STEP;
    /** The nodes one count visits: the root, then one per option of each state counted, a revisit of a counted state being one of those. */
    const NODES = 1 + STEPS * DOMAIN ** (span + 1);

    describe(`over a chain of span ${String(span)}`, () => {
      it("counts within the bound set by the dimensions, domain size and frontier width, where the naive search needs the product", () => {
        const { model, reset } = chainModel(span, BOUND);
        expect(count(model)).toBe(chainSize(span));
        expect(reset()).toBeLessThanOrEqual(BOUND);

        let nodes = 0;
        const search = { ...countingSearch(model, undefined), checkStep: () => {
            nodes += 1;
          },
        };
        expect(countCompletions(search, 0, new Map(), undefined)).toBe(chainSize(span));
        expect(nodes).toBeLessThanOrEqual(NODES);
        reset();

        expect(() => countSearch(model, undefined, { completions: naiveCompletions })).toThrow(WorkBoundExceeded);
      });

      it("diagnoses within twice the bound: the count, then a walk that admits each option of each counted state once more", () => {
        const { model, reset } = chainModel(span, 2 * BOUND);
        expect(diagnose(model)).toEqual({ status: "satisfiable", count: chainSize(span), deadValues: [] });
        expect(reset()).toBeLessThanOrEqual(2 * BOUND);
      });

      it("ranks and unranks within twice the bound: one count's memo, shared along the walk, and the walk's own admissions", () => {
        const { model, reset } = chainModel(span, 2 * BOUND);
        for (const index of [0, Math.floor(chainSize(span) / 2), chainSize(span) - 1]) {
          const found = at(model, index);
          expect(reset()).toBeLessThanOrEqual(2 * BOUND);
          if (found === undefined) throw new Error("the index is below the count");
          expect(indexOf(model, found.values)).toBe(index);
          expect(reset()).toBeLessThanOrEqual(2 * BOUND);
        }
      });
    });
  }
});
