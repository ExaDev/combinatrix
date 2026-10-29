import { describe, expect, expectTypeOf, it } from "vitest";

import type { CombinationOf, Constraint, Strategy } from "./index";
import { allOf, choice, collect, combinations, ConstraintContractError, count, defineModel, diagnose, explain, explainData, firstValid, full, is, isNonEmpty, isSet, LimitExceededError, predicate, StrategyError } from "./index";

const SIDE = 3;
const DIMENSION_COUNT = 4;
const SPACE = SIDE ** DIMENSION_COUNT;

const SIDE_VALUES = Array.from({ length: SIDE }, (_, value) => value);
if (!isNonEmpty(SIDE_VALUES)) throw new Error("a side has at least one value");
const cube = defineModel({ dimensions: Array.from({ length: DIMENSION_COUNT }, (_, index) => choice(`d${String(index)}`, SIDE_VALUES)) });

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

  it("says the limit bounded the solution set for full and the selection for any other strategy", () => {
    const limit = SPACE - 1;
    expect(() => collect(cube, { limit })).toThrow(expect.objectContaining({ bound: "solution-set", limit, message: `the solution set has more than ${String(limit)} combinations` }));
    const all: Strategy = { name: "all", select: (context) => context.completions() };
    expect(() => collect(cube, { strategy: all, limit })).toThrow(expect.objectContaining({ bound: "selection", limit, message: `the strategy selected more than ${String(limit)} combinations` }));
  });

  it("passes on a strategy's own limit with what it bounded", () => {
    const rows = 2;
    const capped: Strategy = {
      name: "capped",
      select: function* (context) {
        let held = 0;
        for (const row of context.completions()) {
          if (held === rows) throw new LimitExceededError(rows, "rows");
          held += 1;
          yield row;
        }
      },
    };
    expect(() => collect(cube, { strategy: capped })).toThrow(expect.objectContaining({ bound: "rows", limit: rows, message: `the strategy would hold more than ${String(rows)} rows` }));
  });

  it("runs to completion with no limit, and a limit equal to the size gives the same result", () => {
    expect(collect(cube)).toHaveLength(SPACE);
    expect(collect(cube, {})).toEqual(collect(cube, { limit: SPACE }));
    expect([...combinations(cube)]).toHaveLength(SPACE);
  });

  it("checks every combination a strategy yields against the model", () => {
    const outside: Strategy = { name: "outside", select: () => [{ d0: 0, d1: 0, d2: 0, d3: SIDE }] };
    expect(() => [...combinations(cube, { strategy: outside })]).toThrow(StrategyError);
    const partial: Strategy = { name: "partial", select: () => [{ d0: 0 }] };
    expect(() => [...combinations(cube, { strategy: partial })]).toThrow(StrategyError);
  });

  it("gives a strategy the dimensions, constraints, a three-valued test and the completions of a partial assignment", () => {
    const model = defineModel({ dimensions: [choice("a", [1, 2]), choice("b", [1, 2])], rules: [{ excludes: allOf(is("a", 1), is("b", 1)) }] });
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

describe("LimitExceededError", () => {
  it("words its message from what the limit bounded, the solution set when not told otherwise", () => {
    const limit = 1;
    expect(new LimitExceededError(limit)).toMatchObject({ bound: "solution-set", limit, message: "the solution set has more than 1 combinations" });
    expect(new LimitExceededError(limit, "selection").message).toBe("the strategy selected more than 1 combinations");
    expect(new LimitExceededError(limit, "rows").message).toBe("the strategy would hold more than 1 rows");
    expect(new LimitExceededError(limit, "steps").message).toBe("the strategy would take more than 1 steps");
  });
});

describe("count", () => {
  it("counts without enumerating and refuses past the limit", () => {
    expect(count(cube, { limit: SPACE })).toBe(SPACE);
    expect(() => count(cube, { limit: SPACE - 1 })).toThrow(new LimitExceededError(SPACE - 1));
  });

  it("searches to the end with no limit, however it is called", () => {
    expect(count(cube)).toBe(SPACE);
    expect(count(cube, {})).toBe(SPACE);
    expect(count(defineModel({ dimensions: cube.dimensions, constraints: [predicate({ reads: ["d0"], test: () => true })] }))).toBe(SPACE);
  });

  it("refuses at the same boundary when a limit is given, and validates it", () => {
    expect(count(cube, { limit: SPACE })).toBe(SPACE);
    expect(() => count(cube, { limit: SPACE - 1 })).toThrow(new LimitExceededError(SPACE - 1));
    expect(() => count(cube, { limit: 1.5 })).toThrow(RangeError);
  });

  it("counts an empty solution set as zero, including one emptied by a constraint on no dimension", () => {
    const never: Constraint = { dependencies: [], evaluate: () => "invalid" };
    expect(count(defineModel({ dimensions: cube.dimensions, constraints: [never] }), { limit: 0 })).toBe(0);
    expect(count(defineModel({ dimensions: [choice("a", [1])], rules: [{ excludes: is("a", 1) }] }), { limit: 0 })).toBe(0);
  });
});

describe("diagnose", () => {
  it("reports an empty solution set distinctly", () => {
    const model = defineModel({ dimensions: [choice("a", [1, 2])], rules: [{ excludes: isSet("a") }] });
    expect(diagnose(model, { limit: 1 })).toEqual({ status: "empty" });
  });

  it("reports the values no combination takes, candidates included", () => {
    const model = defineModel({
      dimensions: [choice("a", ["one", "two", "three"]), choice("b", ["x", "y"]), firstValid("c", ["low", "high", "never"])],
      rules: [{ excludes: is("a", "three") }, { requires: is("b", "x"), when: is("a", "two") }, { requires: is("c", "high"), when: is("b", "y") }],
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

describe("diagnose without a limit", () => {
  it("searches the whole solution set, and a given limit still refuses at the same boundary", () => {
    const model = defineModel({ dimensions: [choice("a", ["x", "y", "z"]), choice("b", [1, 2])] });
    const solutions = 6;
    expect(diagnose(model)).toEqual({ status: "satisfiable", count: solutions, deadValues: [] });
    expect(diagnose(model, {})).toEqual(diagnose(model, { limit: solutions }));
    expect(() => diagnose(model, { limit: solutions - 1 })).toThrow(new LimitExceededError(solutions - 1));
    expect(() => diagnose(model, { limit: -1 })).toThrow(RangeError);
  });
});

describe("explain", () => {
  const model = defineModel({
    dimensions: [choice("a", [1, 2]), choice("b", [undefined, "x"], { activeWhen: is("a", 2) }), firstValid("c", ["low", "high"])],
    rules: [{ name: "two needs high", requires: is("c", "high"), when: is("a", 2) }],
    constraints: [predicate({ name: "not x", reads: ["b"], test: ({ b }) => b !== "x" })],
  });

  it("accepts a combination and gives the id enumeration gives", () => {
    const [first] = collect(model, { limit: 3 });
    expect(first?.values).toEqual({ a: 1, b: undefined, c: "low" });
    expect(explain(model, { a: 1, b: undefined, c: "low" })).toEqual({ valid: true, id: first?.id });
  });

  it("names every reason a combination is excluded", () => {
    expect(explain(model, { a: 2, b: "x", c: "low" })).toEqual({
      valid: false,
      reasons: [
        { kind: "derived", dimension: "c", value: "low", expected: "high" },
        { kind: "constraint", index: 0, constraint: model.constraints[0], rule: model.rules[0] },
        { kind: "constraint", index: 1, constraint: model.constraints[1] },
      ],
    });
  });

  it("reports a set inactive dimension", () => {
    expect(explain(model, { a: 1, b: "x", c: "low" })).toEqual({ valid: false, reasons: [{ kind: "inactive", dimension: "b", value: "x" }] });
  });

  it("reports an active conditional dimension left unset when its values do not list unset, as a value outside its domain", () => {
    const conditional = defineModel({ dimensions: [choice("a", [1, 2]), choice("b", ["x", "y"], { activeWhen: is("a", 2) })] });
    expect(explain(conditional, { a: 2, b: undefined })).toEqual({ valid: false, reasons: [{ kind: "outside-domain", dimension: "b", value: undefined }] });
    expect(explain(conditional, { a: 1, b: undefined }).valid).toBe(true);
    const unsetWhileActive: Strategy = { name: "unset while active", select: () => [{ a: 2, b: undefined }] };
    expect(() => [...combinations(conditional, { strategy: unsetWhileActive })]).toThrow(StrategyError);
  });

  it("reports a first-valid dimension with no acceptable candidate, and the constraint the given candidate breaks", () => {
    const stuck = defineModel({ dimensions: [choice("a", [1]), firstValid("c", ["low"])], rules: [{ excludes: is("c", "low") }] });
    expect(explain(stuck, { a: 1, c: "low" })).toEqual({ valid: false, reasons: [{ kind: "no-candidate", dimension: "c" }, { kind: "constraint", index: 0, constraint: stuck.constraints[0], rule: stuck.rules[0] }] });
    expect(explainData(stuck, { a: 1 })).toEqual({ valid: false, reasons: [{ kind: "no-candidate", dimension: "c" }] });
  });

  it("refuses at compile time a value outside a domain, a missing dimension and an extra one, even from a variable, and throws TypeError when the types are bypassed", () => {
    // @ts-expect-error "one" is not a value of a
    expect(() => explain(model, { a: "one", b: undefined, c: "low" })).toThrow(TypeError);
    // @ts-expect-error a is missing
    expect(() => explain(model, { b: undefined, c: "low" })).toThrow(TypeError);
    // @ts-expect-error z is not a dimension
    expect(() => explain(model, { a: 1, b: undefined, c: "low", z: 1 })).toThrow(TypeError);
    const extra = { a: 1, b: undefined, c: "low", z: 1 } as const;
    // @ts-expect-error z is not a dimension, and the record is not a literal, so only the exactness check catches it
    expect(() => explain(model, extra)).toThrow("explainData takes untyped data");
    expectTypeOf<CombinationOf<typeof model>>().toEqualTypeOf<{ readonly a: 1 | 2; readonly b: "x" | undefined; readonly c: "low" | "high" }>();
  });
});

describe("explainData", () => {
  const model = defineModel({
    dimensions: [choice("a", [1, 2]), choice("b", [undefined, "x"], { activeWhen: is("a", 2) }), firstValid("c", ["low", "high"])],
    rules: [{ name: "two needs high", requires: is("c", "high"), when: is("a", 2) }],
    constraints: [predicate({ name: "not x", reads: ["b"], test: ({ b }) => b !== "x" })],
  });

  it("accepts parsed data with or without its derived values, with the id enumeration gives", () => {
    const [first] = collect(model, { limit: 3 });
    expect(explainData(model, JSON.parse('{"a":1,"c":"low"}'))).toEqual({ valid: true, id: first?.id });
    expect(explainData(model, { a: 1, b: undefined })).toEqual({ valid: true, id: first?.id });
  });

  it("names every reason data is excluded, an unknown key included", () => {
    expect(explainData(model, { a: 2, b: "x", c: "low", z: 1 })).toEqual({
      valid: false,
      reasons: [
        { kind: "unknown-dimension", dimension: "z" },
        { kind: "derived", dimension: "c", value: "low", expected: "high" },
        { kind: "constraint", index: 0, constraint: model.constraints[0], rule: model.rules[0] },
        { kind: "constraint", index: 1, constraint: model.constraints[1] },
      ],
    });
  });

  it("reports a missing free dimension, a value outside its domain, something that is not a value and data that is not a record", () => {
    expect(explainData(model, { b: undefined })).toEqual({ valid: false, reasons: [{ kind: "missing", dimension: "a" }] });
    expect(explainData(model, { a: "one", b: undefined })).toEqual({ valid: false, reasons: [{ kind: "outside-domain", dimension: "a", value: "one" }] });
    const nested = { deep: true };
    expect(explainData(model, { a: nested, b: undefined })).toEqual({ valid: false, reasons: [{ kind: "not-a-value", dimension: "a", value: nested }] });
    expect(explainData(model, [1])).toEqual({ valid: false, reasons: [{ kind: "not-a-record", value: [1] }] });
    expect(explainData(model, null)).toEqual({ valid: false, reasons: [{ kind: "not-a-record", value: null }] });
  });

  it("never evaluates a constraint on a value outside its dimension's domain", () => {
    const seen: unknown[] = [];
    const watched = defineModel({ dimensions: [choice("a", [1, 2])], constraints: [predicate({ reads: ["a"], test: ({ a }) => seen.push(a) > 0 })] });
    expect(explainData(watched, { a: 3 })).toEqual({ valid: false, reasons: [{ kind: "outside-domain", dimension: "a", value: 3 }] });
    expect(seen).toEqual([]);
  });
});
