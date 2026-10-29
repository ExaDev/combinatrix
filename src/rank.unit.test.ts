import { describe, expect, it } from "vitest";

import { MAX_FREE_DIMENSIONS, Random, randomModel, seeds, VALUE_POOL } from "../test/random-model";
import type { Combination, Model, Value } from "./index";
import { at, choice, combinations, computed, count, defineModel, explainData, firstValid, indexOf, indexOfData, isNonEmpty, predicate, samples } from "./index";
import type { CompletionCount } from "./search";
import { exactCompletions, rankSearch, unrankSearch } from "./search";
import { valueKey } from "./value";

type AnyModel = Model<Readonly<Record<string, Value>>>;

/** How many draws each sampling property takes from a generated model. */
const DRAWS = 8;
/** The values a generated computed dimension's function, which counts the set free dimensions it reads, can return. */
const COUNTS = Array.from({ length: MAX_FREE_DIMENSIONS + 1 }, (_, set) => set);
/** The values a computed dimension of a generated model is given in a candidate record: every count it can compute, and values it never computes. */
const COMPUTED_POOL: readonly Value[] = [undefined, ...COUNTS, COUNTS.length, "x"];
/** An index that is not an integer. */
const FRACTION = 1.5;

/** The reference: the whole solution set in enumeration order, materialised. */
function expectedOf(model: AnyModel): Combination<Readonly<Record<string, Value>>>[] {
  return [...combinations(model)];
}

/** A record's values in dimension order, as text, so two records compare by value. */
function keyOf(model: AnyModel, values: Readonly<Record<string, Value>>): string {
  return JSON.stringify(model.dimensions.map((dimension) => (Object.hasOwn(values, dimension.name) ? valueKey(values[dimension.name]) : "absent")));
}

/** The reference rank: the position of a record in the materialised solution set by linear scan, or `-1`. */
function scanIndex(model: AnyModel, expected: readonly Combination<Readonly<Record<string, Value>>>[], values: Readonly<Record<string, Value>>): number {
  const key = keyOf(model, values);

  return expected.findIndex((combination) => keyOf(model, combination.values) === key);
}

/** Every record that differs from a combination in one dimension, over each dimension's possible values and some it can never take. */
function nearMisses(model: AnyModel, values: Readonly<Record<string, Value>>): Record<string, Value>[] {
  return model.dimensions.flatMap((dimension) => (dimension.kind === "computed" ? COMPUTED_POOL : VALUE_POOL).filter((value) => valueKey(value) !== valueKey(values[dimension.name])).map((value) => ({ ...values, [dimension.name]: value })));
}

/** The first `size` items of an iterable. */
function take<T>(items: Readonly<Iterable<T>>, size: number): T[] {
  const taken: T[] = [];
  if (size === 0) return taken;

  for (const item of items) {
    taken.push(item);
    if (taken.length === size) break;
  }

  return taken;
}

/** A seeded random source that records each bound it is given and each index it returns. */
function recordingRandom(seed: number): { readonly random: (bound: number) => number; readonly bounds: number[]; readonly drawn: number[] } {
  const source = new Random(seed);
  const bounds: number[] = [];
  const drawn: number[] = [];

  return {
    bounds,
    drawn,
    random: (bound) => {
      bounds.push(bound);
      const index = source.int(0, bound - 1);
      drawn.push(index);

      return index;
    },
  };
}

/** A subtree count one too high wherever it is not zero: the defect a ranking property must catch. */
const offByOne: CompletionCount = (search, depth, assignment) => {
  const total = exactCompletions(search, depth, assignment);

  return total === 0 ? 0 : total + 1;
};

describe("at", () => {
  it("is the combination combinations produces at each index, with its id, for every index of every generated model", () => {
    const disagreements = seeds.filter((seed) => {
      const model = randomModel(seed);
      const expected = expectedOf(model);

      return JSON.stringify(expected.map((_, index) => at(model, index))) !== JSON.stringify(expected);
    });
    expect(disagreements).toEqual([]);
  });

  it("reports an index at or past the end as undefined, the end being count(model)", () => {
    for (const seed of seeds) {
      const model = randomModel(seed);
      const size = count(model);
      expect(size).toBe(expectedOf(model).length);
      expect(at(model, size)).toBeUndefined();
      expect(at(model, size + 1)).toBeUndefined();
    }
  });

  it("refuses an index that is not a non-negative integer", () => {
    const model = randomModel(seeds[0] ?? 0);
    for (const index of [-1, FRACTION, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) expect(() => at(model, index)).toThrow(RangeError);
  });

  it("is caught by the property when a subtree count is off by one", () => {
    const caught = seeds.filter((seed) => {
      const model = randomModel(seed);
      const expected = expectedOf(model);
      try {
        return expected.some((combination, index) => keyOf(model, unrankSearch(model, index, { count: offByOne }) ?? {}) !== keyOf(model, combination.values));
      } catch {
        return true;
      }
    });
    expect(caught.length).toBeGreaterThan(0);
  });

  it("gives a model with no dimensions its one empty combination at index 0 alone", () => {
    const empty = defineModel({ dimensions: [] });
    expect(at(empty, 0)?.values).toEqual({});
    expect(at(empty, 1)).toBeUndefined();
    expect(indexOf(empty, {})).toBe(0);
  });
});

describe("indexOf and indexOfData", () => {
  it("invert at: the index of the combination at each index is that index, for every generated model", () => {
    const disagreements = seeds.filter((seed) => {
      const model = randomModel(seed);

      return expectedOf(model).some((combination, index) => indexOf(model, combination.values) !== index || indexOfData(model, combination.values) !== index);
    });
    expect(disagreements).toEqual([]);
  });

  it("are the linear-scan index of every near miss of every combination, -1 exactly when explainData says it is not valid", () => {
    const disagreements = seeds.filter((seed) => {
      const model = randomModel(seed);
      const expected = expectedOf(model);

      return expected.some((combination) =>
        nearMisses(model, combination.values).some((record) => {
          const index = indexOfData(model, record);

          return index !== scanIndex(model, expected, record) || (index === -1) !== !explainData(model, record).valid;
        }),
      );
    });
    expect(disagreements).toEqual([]);
  });

  it("accept data that leaves out the derived dimensions, as explainData does", () => {
    for (const seed of seeds) {
      const model = randomModel(seed);
      const derived = model.dimensions.filter((dimension) => dimension.kind !== "choice").map((dimension) => dimension.name);
      expectedOf(model).forEach((combination, index) => {
        const data = Object.fromEntries(Object.entries(combination.values).filter(([name]) => !derived.includes(name)));
        expect(indexOfData(model, data)).toBe(index);
      });
    }
  });

  it("report data that is not a record of the model as -1", () => {
    const model = randomModel(seeds[0] ?? 0);
    const [first] = expectedOf(model);
    for (const data of [null, undefined, 1, "text", [], [first?.values]]) expect(indexOfData(model, data)).toBe(-1);
    if (first !== undefined) {
      expect(indexOfData(model, { ...first.values, unknown: 1 })).toBe(-1);
      expect(indexOfData(model, { ...first.values, d0: { nested: true } })).toBe(-1);
    }
  });

  it("are caught by the property when a subtree count is off by one", () => {
    const caught = seeds.filter((seed) => {
      const model = randomModel(seed);

      return expectedOf(model).some((combination, index) => rankSearch(model, combination.values, { count: offByOne }) !== index);
    });
    expect(caught.length).toBeGreaterThan(0);
  });
});

describe("samples", () => {
  it("draws the combinations at the indices a seeded source returns, each bounded by count(model)", () => {
    for (const seed of seeds) {
      const model = randomModel(seed);
      const expected = expectedOf(model);
      const { random, bounds, drawn } = recordingRandom(seed);
      const drawnCombinations = take(samples(model, { random }), DRAWS);
      expect(drawnCombinations).toEqual(drawn.map((index) => expected[index]));
      expect(drawnCombinations).toHaveLength(expected.length === 0 ? 0 : DRAWS);
      expect(bounds.every((bound) => bound === count(model))).toBe(true);
    }
  });

  it("refuses a source that returns anything but an integer below the bound", () => {
    const model = defineModel({ dimensions: [choice("a", ["x", "y", "z"])] });
    for (const index of [-1, count(model), FRACTION, Number.NaN]) expect(() => take(samples(model, { random: () => index }), 1)).toThrow(RangeError);
  });

  it("computes nothing until advanced, and throws an aborted signal's reason", () => {
    const model = defineModel({ dimensions: [choice("a", ["x", "y", "z"])] });
    const reason = new Error("stop");
    const iterator = samples(model, { random: () => 0, signal: AbortSignal.abort(reason) });
    expect(() => iterator.next()).toThrow(reason);
    expect(() => at(model, 0, { signal: AbortSignal.abort(reason) })).toThrow(reason);
    expect(() => indexOf(model, { a: "x" }, { signal: AbortSignal.abort(reason) })).toThrow(reason);
  });
});

describe("derived, conditionally active and unset dimensions", () => {
  const model = defineModel({
    dimensions: [
      choice("os", ["linux", "windows"]),
      choice("compress", [undefined, true]),
      firstValid("codec", ["zstd", "brotli", "gzip"], { activeWhen: { set: "compress" } }),
      choice("level", ["fast", "best"], { activeWhen: { set: "compress" } }),
      computed("label", { reads: ["os", "codec"], compute: (values) => `${String(values["os"])}-${String(values["codec"] ?? "none")}` }),
    ],
    rules: [{ excludes: { is: ["codec", "zstd"] }, when: { is: ["os", "windows"] } }],
  });
  const expected = [...combinations(model)];

  it("ranks and unranks every combination, the inactive dimensions collapsed to unset once", () => {
    expect(expected.map((combination) => combination.values)).toEqual([
      { os: "linux", compress: undefined, codec: undefined, level: undefined, label: "linux-none" },
      { os: "linux", compress: true, codec: "zstd", level: "fast", label: "linux-zstd" },
      { os: "linux", compress: true, codec: "zstd", level: "best", label: "linux-zstd" },
      { os: "windows", compress: undefined, codec: undefined, level: undefined, label: "windows-none" },
      { os: "windows", compress: true, codec: "brotli", level: "fast", label: "windows-brotli" },
      { os: "windows", compress: true, codec: "brotli", level: "best", label: "windows-brotli" },
    ]);
    expected.forEach((combination, index) => {
      expect(at(model, index)).toEqual(combination);
      expect(indexOf(model, combination.values)).toBe(index);
    });
    expect(at(model, expected.length)).toBeUndefined();
  });

  it("refuses a set inactive dimension, a derived value other than the derived one and a wrong computed value", () => {
    expect(indexOf(model, { os: "linux", compress: undefined, codec: undefined, level: "best", label: "linux-none" })).toBe(-1);
    expect(indexOf(model, { os: "windows", compress: true, codec: "zstd", level: "fast", label: "windows-zstd" })).toBe(-1);
    expect(indexOf(model, { os: "linux", compress: true, codec: "gzip", level: "fast", label: "linux-gzip" })).toBe(-1);
    expect(indexOf(model, { os: "linux", compress: true, codec: "zstd", level: "fast", label: "linux-gzip" })).toBe(-1);
  });

  it("takes the derived and inactive dimensions from the rest when data leaves them out", () => {
    expect(indexOfData(model, { os: "windows", compress: true, level: "best" })).toBe(expected.length - 1);
    expect(indexOfData(model, { os: "windows", compress: undefined })).toBe(expected.findIndex((combination) => combination.values.os === "windows"));
  });
});

describe("work", () => {
  const DOMAIN = 10;
  const FREE = 15;
  /** The steps of the model below: the free dimensions and the computed one. */
  const STEPS = FREE + 1;
  /** One walk from the root assigns each step once and asks for one subtree count per option of each step on its path, so its work is bounded by the steps times the largest number of options a step offers. */
  const BOUND = STEPS * DOMAIN;

  class WorkBoundExceeded extends Error {}

  /** A model of 9 times 10 to the 14 combinations whose predicate and computed dimension count each call, throwing once a single operation has made more than `BOUND`. */
  function largeModel(): { readonly model: AnyModel; readonly reset: () => number } {
    let work = 0;
    const tally = (): void => {
      work += 1;
      if (work > BOUND) throw new WorkBoundExceeded(`more than ${String(BOUND)} evaluations`);
    };
    const domain = Array.from({ length: DOMAIN }, (_, value) => value);
    if (!isNonEmpty(domain)) throw new Error("the domain size is positive");
    const names = Array.from({ length: FREE }, (_, index) => `d${String(index)}`);
    const model = defineModel({
      dimensions: [
        ...names.map((name) => choice(name, domain)),
        computed("total", {
          reads: names,
          compute: (values) => {
            tally();

            return Object.values(values).reduce<number>((sum, value) => sum + (typeof value === "number" ? value : 0), 0);
          },
        }),
      ],
      constraints: [
        predicate({
          reads: ["d0"],
          test: ({ d0 }) => {
            tally();

            return d0 !== 0;
          },
        }),
      ],
    });

    return {
      model,
      reset: () => {
        const done = work;
        work = 0;

        return done;
      },
    };
  }

  it("ranks, unranks and samples a large model within the bound for each operation, where materialising trips it", () => {
    const { model, reset } = largeModel();
    const size = count(model);
    reset();
    expect(size).toBe((DOMAIN - 1) * DOMAIN ** (FREE - 1));
    for (const index of [0, Math.floor(size / 2), size - 1]) {
      const found = at(model, index);
      expect(reset()).toBeLessThanOrEqual(BOUND);
      if (found === undefined) throw new Error("the index is below the count");
      expect(indexOf(model, found.values)).toBe(index);
      expect(reset()).toBeLessThanOrEqual(BOUND);
    }
    const { random } = recordingRandom(seeds[0] ?? 0);
    for (const drawn of take(samples(model, { random }), DRAWS)) {
      expect(model.isTuple(drawn.values)).toBe(true);
      expect(reset()).toBeLessThanOrEqual(BOUND);
    }

    reset();
    expect(() => take(combinations(model), BOUND + 1)).toThrow(WorkBoundExceeded);
  });

  it("asks for at most one subtree count per option of each step on the path", () => {
    const { model } = largeModel();
    let counts = 0;
    const counting: CompletionCount = (search, depth, assignment) => {
      counts += 1;

      return exactCompletions(search, depth, assignment);
    };
    const last = unrankSearch(model, count(model) - 1, { count: counting });
    expect(counts).toBeLessThanOrEqual(BOUND);
    counts = 0;
    if (last === undefined) throw new Error("the last index is below the count");
    rankSearch(model, last, { count: counting });
    expect(counts).toBeLessThanOrEqual(BOUND);
  });
});
