import { describe, expect, it } from "vitest";

import { budgetFor, candidateCount, subsetCount } from "../test/budget";
import { greedyCoveringArray } from "../test/greedy-reference";
import { randomModel, seeds } from "../test/random-model";
import type { Model, Strategy, Value } from "./index";
import { allOf, choice, collect, count, coveringArray, defineModel, firstValid, is, isCoveringArray, isSet, LimitExceededError, StrategyError } from "./index";
import { subsetsOf, tupleKey } from "./tuples";

/** How many generated models each property is checked against. */
const MODELS = seeds.length;
/** Bounds every solution set the tests read; the generated models are far smaller. */
const LIMIT = 10_000;
/** The strongest coverage the property tests check: three-wise. */
const MAX_STRENGTH = 3;
/** Each value, pairwise and three-wise. */
const STRENGTHS = Array.from({ length: MAX_STRENGTH }, (_, index) => index + 1);
/** The share of the generated models the slower whole-model checks run on. */
const SAMPLE_DIVISOR = 10;
/** How many generated models the slower whole-model checks run on. */
const SAMPLE = MODELS / SAMPLE_DIVISOR;
/** The strength of the pairwise checks. */
const PAIRWISE = 2;
const SIZES = ["small", "medium", "large"] as const;

/** The tuples a test of the given strength observes in the first `models` generated models at most: each combination any of them could take, once for every set of that many dimensions it holds a tuple of. */
function tupleObservations(strength: number, models = MODELS): number {
  return generated().slice(0, models).reduce((total, { model }) => total + candidateCount(model) * subsetCount(model.dimensions.length, Math.min(strength, model.dimensions.length)), 0);
}

/** The time a test may spend per tuple observed, in milliseconds: at least two hundred times what the heaviest of them takes on an idle machine, so a machine under heavy load still passes and only a construction that stops terminating fails. */
const OBSERVATION_BUDGET_MS = 4;

type Row = Readonly<Record<string, Value>>;

function rowsOf(model: Model<Row>, strategy: Strategy): Row[] {
  return collect(model, { strategy, limit: LIMIT }).map(({ values }) => values);
}

function generated(): { readonly model: Model<Row>; readonly seed: number }[] {
  return seeds.map((seed) => ({ model: randomModel(seed), seed }));
}

describe("coveringArray", () => {
  it("yields each value once over, earliest first, at strength 1", () => {
    const model = defineModel({
      dimensions: [choice("size", SIZES), choice("shape", ["x", "y"])],
    });
    expect(rowsOf(model, coveringArray({ strength: 1, limit: LIMIT }))).toEqual(
      [
        { size: "small", shape: "x" },
        { size: "medium", shape: "y" },
        { size: "large", shape: "x" },
      ],
    );
  });

  it("yields every pair of an unconstrained two-dimensional model at strength 2", () => {
    const model = defineModel({
      dimensions: [choice("a", [undefined, true]), choice("b", ["x", "y"])],
    });
    expect(rowsOf(model, coveringArray({ strength: 2, limit: LIMIT }))).toEqual(
      [
        { a: undefined, b: "x" },
        { a: undefined, b: "y" },
        { a: true, b: "x" },
        { a: true, b: "y" },
      ],
    );
  });

  it("covers pairs of a three-by-three-by-three model in fewer rows than the product", () => {
    const values = [0, 1, 2] as const;
    const model = defineModel({
      dimensions: [
        choice("a", values),
        choice("b", values),
        choice("c", values),
      ],
    });
    const rows = rowsOf(model, coveringArray({ strength: 2, limit: LIMIT }));
    expect(isCoveringArray(rows, model, { strength: 2, limit: LIMIT })).toBe(
      true,
    );
    expect(rows.length).toBeLessThan(values.length ** model.dimensions.length);
  });

  it("does not require a tuple no valid combination contains", () => {
    const model = defineModel({
      dimensions: [choice("a", [1, 2]), choice("b", ["x", "y"])],
      rules: [{ excludes: allOf(is("a", 1), is("b", "y")) }],
    });
    const rows = rowsOf(model, coveringArray({ strength: 2, limit: LIMIT }));
    expect(rows).toEqual([
      { a: 1, b: "x" },
      { a: 2, b: "x" },
      { a: 2, b: "y" },
    ]);
  });

  it("covers derived values and unset from inactivity like any other value", () => {
    const model = defineModel({
      dimensions: [
        choice("feature", [undefined, "on"]),
        choice("tuning", [1, 2], { activeWhen: isSet("feature") }),
        firstValid("channel", ["stable", "beta"]),
      ],
      rules: [
        { requires: is("channel", "beta"), when: is("tuning", 2) },
      ],
    });
    const rows = rowsOf(model, coveringArray({ strength: 2, limit: LIMIT }));
    expect(rows).toEqual(
      expect.arrayContaining([
        { feature: undefined, tuning: undefined, channel: "stable" },
        { feature: "on", tuning: 2, channel: "beta" },
      ]),
    );
    expect(isCoveringArray(rows, model, { strength: 2, limit: LIMIT })).toBe(
      true,
    );
  });

  it("yields nothing for an empty solution set", () => {
    const model = defineModel({
      dimensions: [choice("a", [1])],
      rules: [{ excludes: is("a", 1) }],
    });
    expect(rowsOf(model, coveringArray({ strength: 2, limit: LIMIT }))).toEqual(
      [],
    );
    expect(isCoveringArray([], model, { strength: 2, limit: LIMIT })).toBe(
      true,
    );
  });

  it("refuses to hold more rows than its limit, and needs no limit", () => {
    // Every pair of two unconstrained dimensions is a whole combination, so the array is the product and needs that many rows.
    const model = defineModel({
      dimensions: [choice("a", SIZES), choice("b", SIZES)],
    });
    const rows = SIZES.length ** 2;
    expect(() =>
      rowsOf(model, coveringArray({ strength: 2, limit: rows - 1 })),
    ).toThrow(expect.objectContaining({ name: "LimitExceededError", bound: "rows", limit: rows - 1 }));
    expect(
      rowsOf(model, coveringArray({ strength: 2, limit: rows })),
    ).toHaveLength(rows);
    expect(rowsOf(model, coveringArray({ strength: 2 }))).toHaveLength(rows);
  });

  it("refuses a strength that is not a positive integer and a limit that is not a non-negative integer", () => {
    expect(() => coveringArray({ strength: 0 })).toThrow(RangeError);
    expect(() => coveringArray({ strength: 1.5 })).toThrow(RangeError);
    expect(() => coveringArray({ strength: 2, limit: -1 })).toThrow(RangeError);
    expect(() => coveringArray({ strength: 2, limit: 1.5 })).toThrow(
      RangeError,
    );
  });

  // Unconstrained, so the solution set is the full product of the domains while the pairs grow only with the square of the dimension count.
  const dimensionCount = 14;
  const domain = [0, 1, 2] as const;
  const strength = 2;
  const tupleCount = subsetCount(dimensionCount, strength) * domain.length ** strength;
  // The construction's engine queries, from its structure: one per candidate tuple when the tuples are listed (the first t dimensions' included), and per later dimension at most one per row and value plus one fallback in horizontal growth and one per row and uncovered tuple in vertical growth, plus one completion per row. Every row holds a tuple no earlier row did, so there are at most tupleCount rows.
  const queryBound = tupleCount + dimensionCount * tupleCount * (domain.length + 1) + tupleCount * tupleCount + tupleCount;
  /** The time one engine query may take, in milliseconds: at least two hundred times what the construction spends per query of the bound on an idle machine, so a machine under heavy load still passes and only a construction that stops terminating fails. */
  const QUERY_BUDGET_MS = 0.1;

  it("never reads the solution set: the combinations it asks the engine for are bounded by the t-tuple count", budgetFor(queryBound, QUERY_BUDGET_MS), () => {
    const model = defineModel({
      dimensions: Array.from({ length: dimensionCount }, (_, index) =>
        choice(`d${String(index)}`, domain),
      ),
    });
    const solutions = count(model, { limit: Number.MAX_SAFE_INTEGER });
    expect(queryBound).toBeLessThan(solutions);

    const work = { queries: 0, combinations: 0 };
    const counted: Strategy = {
      name: "counted",
      select: (context) =>
        coveringArray({ strength }).select({
          ...context,
          completions: function* (assignment) {
            work.queries += 1;
            for (const combination of context.completions(assignment)) {
              work.combinations += 1;
              yield combination;
            }
          },
        }),
    };
    const rows = rowsOf(model, counted);
    expect(rows.length).toBeLessThanOrEqual(tupleCount);
    expect(work.queries).toBeLessThanOrEqual(queryBound);
    // Each query stops at its first combination, so no more combinations pass through than queries are made.
    expect(work.combinations).toBeLessThanOrEqual(work.queries);
    // The greedy reference, by contrast, holds the whole solution set before its first row, so even as many combinations as there are tuples is too few for it.
    expect(() =>
      rowsOf(model, greedyCoveringArray({ strength, limit: tupleCount })),
    ).toThrow(LimitExceededError);
  });
});

describe("coveringArray against the greedy reference", () => {
  for (const strength of STRENGTHS) {
    it(
      `is no larger in total than the greedy reference over the generated models at strength ${String(strength)}, and never more rows than coverable tuples`,
      budgetFor(tupleObservations(strength), OBSERVATION_BUDGET_MS),
      () => {
        let rowsTotal = 0;
        let referenceTotal = 0;
        for (const { model, seed } of generated()) {
          const rows = rowsOf(model, coveringArray({ strength }));
          const reference = rowsOf(
            model,
            greedyCoveringArray({ strength, limit: LIMIT }),
          );
          rowsTotal += rows.length;
          referenceTotal += reference.length;
          expect(rows.length, `seed ${String(seed)}`).toBeLessThanOrEqual(
            coverableTupleCount(model, strength),
          );
        }
        expect(rowsTotal).toBeLessThanOrEqual(referenceTotal);
      },
    );
  }
});

/** The number of distinct t-tuples the model's solution set contains, read from the whole solution set. */
function coverableTupleCount(model: Model<Row>, strength: number): number {
  const names = model.dimensions.map((dimension) => dimension.name);
  const subsets = subsetsOf(names, Math.min(strength, names.length));
  const tuples = new Set<string>();
  for (const { values } of collect(model, { limit: LIMIT })) {
    for (const subset of subsets) {
      tuples.add(tupleKey(subset.map((name) => [name, values[name]])));
    }
  }

  return tuples.size;
}

describe("coveringArray against the isCoveringArray oracle", () => {
  for (const strength of STRENGTHS) {
    it(
      `is a covering array of strength ${String(strength)} on every generated model, of valid, distinct rows`,
      budgetFor(tupleObservations(strength), OBSERVATION_BUDGET_MS),
      () => {
        for (const { model, seed } of generated()) {
          const rows = rowsOf(model, coveringArray({ strength, limit: LIMIT }));
          expect(
            isCoveringArray(rows, model, { strength, limit: LIMIT }),
            `seed ${String(seed)}`,
          ).toBe(true);
          // `tupleKey` keeps unset and `null` apart, which `JSON.stringify` of an `undefined` value would not.
          expect(
            new Set(rows.map((row) => tupleKey(Object.entries(row)))).size,
            `seed ${String(seed)}`,
          ).toBe(rows.length);
          expect(rows.length).toBeLessThanOrEqual(count(model, { limit: LIMIT }));
        }
      },
    );
  }

  it("yields the same rows in the same order every time", budgetFor(tupleObservations(PAIRWISE, SAMPLE), OBSERVATION_BUDGET_MS), () => {
    for (const { model } of generated().slice(0, SAMPLE)) {
      const strategy = coveringArray({ strength: 2, limit: LIMIT });
      expect(rowsOf(model, strategy)).toEqual(rowsOf(model, strategy));
    }
  });

  // A strength equal to the dimension count observes each combination once, at most what the strongest strength checked does.
  it("yields the whole solution set at a strength of at least the dimension count", budgetFor(tupleObservations(MAX_STRENGTH, SAMPLE), OBSERVATION_BUDGET_MS), () => {
    for (const { model } of generated().slice(0, SAMPLE)) {
      const strength = model.dimensions.length;
      expect(
        rowsOf(model, coveringArray({ strength, limit: LIMIT })),
      ).toHaveLength(count(model, { limit: LIMIT }));
    }
  });

  it("the oracle refuses the strategy's output with any one row dropped", budgetFor(tupleObservations(PAIRWISE, SAMPLE), OBSERVATION_BUDGET_MS), () => {
    let checked = 0;
    for (const { model, seed } of generated().slice(0, SAMPLE)) {
      const rows = rowsOf(model, coveringArray({ strength: 2, limit: LIMIT }));
      // Redundant rows are removed, so every row holds a tuple no other row does, and without it that tuple is uncovered.
      for (const [index] of rows.entries()) {
        checked += 1;
        expect(
          isCoveringArray(rows.toSpliced(index, 1), model, {
            strength: 2,
            limit: LIMIT,
          }),
          `seed ${String(seed)}, row ${String(index)}`,
        ).toBe(false);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("the oracle refuses a row outside the solution set, and combinatrix refuses a strategy yielding one", () => {
    const model = defineModel({
      dimensions: [choice("a", [1, 2]), choice("b", ["x", "y"])],
      rules: [{ excludes: allOf(is("a", 1), is("b", "y")) }],
    });
    const rows = rowsOf(model, coveringArray({ strength: 2, limit: LIMIT }));
    const invalid = { a: 1, b: "y" };
    expect(
      isCoveringArray([...rows, invalid], model, { strength: 2, limit: LIMIT }),
    ).toBe(false);
    expect(
      isCoveringArray([...rows, { a: 1 }], model, {
        strength: 2,
        limit: LIMIT,
      }),
    ).toBe(false);
    const broken: Strategy = {
      name: "broken",
      select: (context) => [
        ...coveringArray({ strength: 2, limit: LIMIT }).select(context),
        invalid,
      ],
    };
    expect(() => rowsOf(model, broken)).toThrow(StrategyError);
  });
});
