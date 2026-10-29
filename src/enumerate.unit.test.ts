import { describe, expect, it } from "vitest";

import type { Constraint, Strategy } from "./index";
import { choice, collect, combinations, ConstraintContractError, count, defineModel, diagnose, explain, firstValid, full, LimitExceededError, predicate, StrategyError } from "./index";

const SIDE = 3;
const DIMENSION_COUNT = 4;
const SPACE = SIDE ** DIMENSION_COUNT;

const cube = defineModel({ dimensions: Array.from({ length: DIMENSION_COUNT }, (_, index) => choice(`d${String(index)}`, Array.from({ length: SIDE }, (_unused, value) => value))) });

describe("combinations", () => {
  it("is lazy: advancing it once computes one combination", () => {
    let calls = 0;
    const counting = predicate({
      reads: ["d0"],
      test: () => {
        calls += 1;

        return true;
      },
    });
    const model = defineModel({ dimensions: cube.dimensions, constraints: [counting] });
    const iterator = combinations(model);
    expect(calls).toBe(0);
    iterator.next();
    expect(calls).toBe(1);
  });

  it("gives equal combinations the same id across models with the same dimensions and different ids otherwise", () => {
    const ids = collect(cube, { limit: SPACE }).map((combination) => combination.id);
    expect(new Set(ids).size).toBe(SPACE);
    expect(collect(cube, { limit: SPACE }).map((combination) => combination.id)).toEqual(ids);
    expect(ids.every((id) => /^[0-9a-f]{16}$/u.test(id))).toBe(true);
  });

  it("refuses to produce more than the limit, and produces exactly the limit", () => {
    expect(collect(cube, { limit: SPACE })).toHaveLength(SPACE);
    expect(() => collect(cube, { limit: SPACE - 1 })).toThrow(LimitExceededError);
    expect(() => [...combinations(cube, { limit: -1 })]).toThrow(RangeError);
  });

  it("checks every combination a strategy yields against the model", () => {
    const outside: Strategy = { name: "outside", select: () => [{ d0: 0, d1: 0, d2: 0, d3: SIDE }] };
    expect(() => [...combinations(cube, { strategy: outside })]).toThrow(StrategyError);
    const partial: Strategy = { name: "partial", select: () => [{ d0: 0 }] };
    expect(() => [...combinations(cube, { strategy: partial })]).toThrow(StrategyError);
  });

  it("gives a strategy the dimensions, constraints, a three-valued test and the completions of a partial assignment", () => {
    const model = defineModel({ dimensions: [choice("a", [1, 2]), choice("b", [1, 2])], rules: [{ excludes: { all: [{ is: ["a", 1] }, { is: ["b", 1] }] } }] });
    const firstPerA: Strategy = {
      name: "first per a",
      select: (context) => {
        expect(context.dimensions).toBe(model.dimensions);
        expect(context.constraints).toBe(model.constraints);
        expect(context.test(new Map([["a", 1]]))).toBe("unknown");
        expect(context.test(new Map([["a", 1], ["b", 1]]))).toBe("invalid");
        expect(context.test(new Map([["a", 2], ["b", 1]]))).toBe("valid");

        return [1, 2].flatMap((a) => {
          const [first] = context.completions(new Map([["a", a]]));

          return first === undefined ? [] : [first];
        });
      },
    };
    expect(collect(model, { strategy: firstPerA, limit: 2 }).map((combination) => combination.values)).toEqual([
      { a: 1, b: 2 },
      { a: 2, b: 1 },
    ]);
    const solutions = 3;
    expect(collect(model, { strategy: full, limit: solutions })).toHaveLength(solutions);
  });

  it("throws when a constraint answers unknown with every dependency assigned", () => {
    const broken: Constraint = { name: "broken", dependencies: ["d0"], evaluate: () => "unknown" };
    const model = defineModel({ dimensions: cube.dimensions, constraints: [broken] });
    expect(() => [...combinations(model)]).toThrow(ConstraintContractError);
  });
});

describe("count", () => {
  it("counts without enumerating and refuses past the limit", () => {
    expect(count(cube, { limit: SPACE })).toBe(SPACE);
    expect(() => count(cube, { limit: SPACE - 1 })).toThrow(new LimitExceededError(SPACE - 1));
  });

  it("counts an empty solution set as zero, including one emptied by a constraint on no dimension", () => {
    const never: Constraint = { dependencies: [], evaluate: () => "invalid" };
    expect(count(defineModel({ dimensions: cube.dimensions, constraints: [never] }), { limit: 0 })).toBe(0);
    expect(count(defineModel({ dimensions: [choice("a", [1])], rules: [{ excludes: { is: ["a", 1] } }] }), { limit: 0 })).toBe(0);
  });
});

describe("diagnose", () => {
  it("reports an empty solution set distinctly", () => {
    const model = defineModel({ dimensions: [choice("a", [1, 2])], rules: [{ requires: { unset: "a" } }] });
    expect(diagnose(model, { limit: 1 })).toEqual({ status: "empty" });
  });

  it("reports the values no combination takes, candidates included", () => {
    const model = defineModel({
      dimensions: [choice("a", ["one", "two", "three"]), choice("b", ["x", "y"]), firstValid("c", ["low", "high", "never"])],
      rules: [{ excludes: { is: ["a", "three"] } }, { requires: { is: ["b", "x"] }, when: { is: ["a", "two"] } }, { requires: { is: ["c", "high"] }, when: { is: ["b", "y"] } }],
    });
    const solutions = 3;
    expect(diagnose(model, { limit: solutions })).toEqual({
      status: "satisfiable",
      count: solutions,
      deadValues: [
        { dimension: "a", value: "three" },
        { dimension: "c", value: "never" },
      ],
    });
    expect(() => diagnose(model, { limit: solutions - 1 })).toThrow(LimitExceededError);
  });
});

describe("explain", () => {
  const model = defineModel({
    dimensions: [choice("a", [1, 2]), choice("b", [undefined, "x"], { activeWhen: { is: ["a", 2] } }), firstValid("c", ["low", "high"])],
    rules: [{ name: "two needs high", requires: { is: ["c", "high"] }, when: { is: ["a", 2] } }],
    constraints: [predicate({ name: "not x", reads: ["b"], test: ({ b }) => b !== "x" })],
  });

  it("accepts a combination with or without its derived values and gives the id enumeration gives", () => {
    const [first] = collect(model, { limit: 3 });
    expect(first?.values).toEqual({ a: 1, b: undefined, c: "low" });
    expect(explain(model, { a: 1, b: undefined, c: "low" })).toEqual({ valid: true, id: first?.id });
    expect(explain(model, { a: 1, b: undefined })).toEqual({ valid: true, id: first?.id });
  });

  it("names every reason a record is excluded", () => {
    const explanation = explain(model, { a: 2, b: "x", c: "low", z: 1 });
    expect(explanation).toEqual({
      valid: false,
      reasons: [
        { kind: "unknown-dimension", dimension: "z" },
        { kind: "derived", dimension: "c", value: "low", expected: "high" },
        { kind: "constraint", index: 0, constraint: model.constraints[0], rule: model.rules[0] },
        { kind: "constraint", index: 1, constraint: model.constraints[1] },
      ],
    });
  });

  it("reports a missing free dimension, a value outside its domain and a set inactive dimension", () => {
    expect(explain(model, { b: undefined })).toMatchObject({ valid: false, reasons: [{ kind: "missing", dimension: "a" }] });
    expect(explain(model, { a: "one", b: undefined })).toMatchObject({ valid: false, reasons: [{ kind: "outside-domain", dimension: "a", value: "one" }] });
    expect(explain(model, { a: 1, b: "x" })).toMatchObject({ valid: false, reasons: [{ kind: "inactive", dimension: "b", value: "x" }] });
  });

  it("reports a first-valid dimension with no acceptable candidate", () => {
    const stuck = defineModel({ dimensions: [choice("a", [1]), firstValid("c", ["low"])], rules: [{ excludes: { is: ["c", "low"] } }] });
    expect(explain(stuck, { a: 1 })).toEqual({ valid: false, reasons: [{ kind: "no-candidate", dimension: "c" }] });
  });
});
