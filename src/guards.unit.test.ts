import { describe, expect, expectTypeOf, it } from "vitest";

import { fnv1a64 } from "./hash";
import type { Model, ModelData, TupleOf, TypedRule, Value } from "./index";
import { choice, collect, count, defineModel, explainData, firstValid, isCondition, isModelData, isRule, ModelError, parseModel, parseRules } from "./index";

describe("isCondition", () => {
  it.each([{ is: ["a", "x"] }, { is: ["a", null] }, { in: ["a", ["x", 1, true, null]] }, { set: "a" }, { unset: "a" }, { all: [] }, { any: [{ set: "a" }] }, { not: { all: [{ set: "a" }, { unset: "b" }] } }])("accepts %j", (value) => {
    expect(isCondition(value)).toBe(true);
  });

  it.each([null, [], "a", { is: ["a"] }, { is: [1, "x"] }, { is: ["a", { nested: true }] }, { is: ["a", Number.NaN] }, { in: ["a", "x"] }, { in: ["a"] }, { set: 1 }, { all: [{ bogus: "a" }] }, { not: "a" }, { set: "a", unset: "a" }, {}])("refuses %j", (value) => {
    expect(isCondition(value)).toBe(false);
  });
});

const RULES_JSON = '[{"requires":{"set":"a"}},{"excludes":{"is":["a","x"]},"when":{"set":"a"},"name":"no x"},{"implies":[{"is":["a","x"]},{"unset":"a"}],"unless":{"unset":"a"}}]';

describe("isRule", () => {
  it("accepts every form read back from JSON", () => {
    const parsed: unknown = JSON.parse(RULES_JSON);
    expect(Array.isArray(parsed) && parsed.every(isRule)).toBe(true);
  });

  it.each([null, {}, { requires: { set: "a" }, excludes: { set: "a" } }, { requires: "a" }, { implies: [{ set: "a" }] }, { requires: { set: "a" }, when: "a" }, { requires: { set: "a" }, unless: 1 }, { requires: { set: "a" }, name: 1 }, { requires: { set: "a" }, extra: true }])("refuses %j", (value) => {
    expect(isRule(value)).toBe(false);
  });
});

describe("parseRules", () => {
  const dimensions = [choice("a", [undefined, "x"]), choice("b", [1, 2])] as const;

  it("returns rules read from JSON typed for the dimensions, and the model accepts them", () => {
    const rules = parseRules(dimensions, JSON.parse(RULES_JSON));
    expectTypeOf(rules).toEqualTypeOf<TypedRule<TupleOf<typeof dimensions>>[]>();
    expect(rules).toEqual(JSON.parse(RULES_JSON));
    expect(() => defineModel({ dimensions, rules })).not.toThrow();
  });

  it("refuses data that is not an array", () => {
    expect(() => parseRules(dimensions, { requires: { set: "a" } })).toThrow(new ModelError(["the rules are not an array"]));
  });

  it("lists every defect: a malformed rule, an unknown dimension, a value a dimension never takes and an unset one that is never unset", () => {
    const data: unknown = JSON.parse('[{"requires":"a"},{"requires":{"set":"z"}},{"requires":{"in":["b",[1,3]]}},{"excludes":{"unset":"b"}},{"requires":{"is":["a","x"]}}]');
    let issues: readonly string[] = [];
    try {
      parseRules(dimensions, data);
    } catch (error) {
      if (!(error instanceof ModelError)) throw error;
      ({ issues } = error);
    }
    expect(issues).toEqual(["rule 0 is not a well-formed rule", 'rule 1 mentions unknown dimension "z"', 'rule 2 compares "b" with 3, which it can never take', 'rule 3 compares "b" with unset, which it can never take']);
  });
});

/** The data of a model as a JSON file holds it: an unset runtime and a codec derived only when compressing, so unset appears only through `activeWhen`. */
const MODEL_JSON =
  '{"dimensions":[{"kind":"choice","name":"os","values":["linux","windows"]},{"kind":"choice","name":"compress","values":[true,false]},{"kind":"first-valid","name":"codec","candidates":["zstd","brotli"],"activeWhen":{"is":["compress",true]}}],"rules":[{"excludes":{"is":["codec","zstd"]},"when":{"is":["os","windows"]},"name":"windows has no zstd"}]}';

/** The issues `parseModel` refuses the data with. */
function parseModelIssues(data: unknown): readonly string[] {
  try {
    parseModel(data);
  } catch (error) {
    if (error instanceof ModelError) return error.issues;
    throw error;
  }

  return [];
}

describe("isModelData", () => {
  it("accepts a model read back from JSON, with or without rules", () => {
    const parsed: unknown = JSON.parse(MODEL_JSON);
    expect(isModelData(parsed)).toBe(true);
    expect(isModelData({ dimensions: [] })).toBe(true);
  });

  it("narrows to the data type", () => {
    const parsed: unknown = JSON.parse(MODEL_JSON);
    if (!isModelData(parsed)) throw new Error("the fixture is model data");
    expectTypeOf(parsed).toEqualTypeOf<ModelData>();
  });

  it.each([
    null,
    [],
    {},
    { dimensions: {} },
    { dimensions: [], rules: {} },
    { dimensions: [], extra: true },
    { dimensions: [], constraints: [] },
    { dimensions: [{ kind: "choice", name: "a", values: [] }] },
    { dimensions: [{ kind: "choice", name: "", values: ["x"] }] },
    { dimensions: [{ kind: "choice", name: "a", values: ["x", "x"] }] },
    { dimensions: [{ kind: "choice", name: "a", values: [{ nested: true }] }] },
    { dimensions: [{ kind: "choice", name: "a", values: ["x", undefined] }] },
    { dimensions: [{ kind: "first-valid", name: "a", candidates: [undefined] }] },
    { dimensions: [{ kind: "computed", name: "a", reads: [], compute: () => 1 }] },
    { dimensions: [{ kind: "choice", name: "a", candidates: ["x"] }] },
    { dimensions: [{ kind: "choice", name: "a", values: ["x"], activeWhen: "a" }] },
    { dimensions: [{ kind: "choice", name: "a", values: ["x"] }], rules: [{ requires: "a" }] },
  ])("refuses %j", (value) => {
    expect(isModelData(value)).toBe(false);
  });

  it("accepts what only `defineModel` can refuse: a repeated name and a mention of a dimension the model lacks", () => {
    const repeated = { dimensions: [{ kind: "choice", name: "a", values: ["x"] }, { kind: "choice", name: "a", values: ["x"] }] };
    const unknown = { dimensions: [{ kind: "choice", name: "a", values: ["x"] }], rules: [{ requires: { set: "z" } }] };
    expect(isModelData(repeated) && isModelData(unknown)).toBe(true);
    expect(parseModelIssues(repeated)).toEqual(['dimension "a" is declared more than once']);
    expect(parseModelIssues(unknown)).toEqual(['rule 0 mentions unknown dimension "z"', 'constraint 0 depends on unknown dimension "z"']);
  });
});

describe("parseModel", () => {
  it("returns the model the data describes, with unset only where `activeWhen` does not hold", () => {
    const model = parseModel(JSON.parse(MODEL_JSON));
    expectTypeOf(model).toEqualTypeOf<Model<Readonly<Record<string, Value>>>>();
    const expected = [
      { os: "linux", compress: true, codec: "zstd" },
      { os: "linux", compress: false, codec: undefined },
      { os: "windows", compress: true, codec: "brotli" },
      { os: "windows", compress: false, codec: undefined },
    ];
    expect(count(model)).toBe(expected.length);
    expect(collect(model).map(({ values }) => values)).toEqual(expected);
  });

  it("builds the same model `defineModel` builds from the same definition written in code", () => {
    const typed = defineModel({
      dimensions: [choice("os", ["linux", "windows"]), choice("compress", [true, false]), firstValid("codec", ["zstd", "brotli"], { activeWhen: { is: ["compress", true] } })],
      rules: [{ excludes: { is: ["codec", "zstd"] }, when: { is: ["os", "windows"] }, name: "windows has no zstd" }],
    });
    const parsed = parseModel(JSON.parse(MODEL_JSON));
    expect(parsed.dimensions).toEqual(typed.dimensions);
    expect(parsed.rules).toEqual(typed.rules);
    expect(collect(parsed)).toEqual(collect(typed));
  });

  it("checks a combination at runtime, since the compiler cannot", () => {
    const model = parseModel(JSON.parse(MODEL_JSON));
    expect(explainData(model, { os: "linux", compress: false, codec: undefined })).toMatchObject({ valid: true });
    expect(explainData(model, { os: "macos", compress: false, codec: undefined })).toMatchObject({ valid: false });
  });

  it("lists every defect in the data's shape, a computed dimension and constraints included", () => {
    const data: unknown = { dimensions: [{ kind: "choice", name: "a", values: ["x", undefined, "x"] }, { kind: "computed", name: "b", reads: [], compute: () => 1 }, { kind: "choice", name: "", values: [] }], rules: [{ requires: "a" }], constraints: [] };
    expect(parseModelIssues(data)).toEqual([
      "rule 0 is not a well-formed rule",
      "the model data has constraints, which are functions and not data",
      'dimension "a" lists "x" more than once',
      "dimension 0 has an unset value, which JSON cannot state: a dimension is unset only through activeWhen",
      "dimension 1 is computed, which is a function and not data",
      "a dimension has an empty name",
      'dimension "" has no values',
    ]);
  });

  it("refuses data that is not an object with the issue `defineModel` gives", () => {
    expect(parseModelIssues(null)).toEqual(["the model definition is not an object"]);
  });

  it("lists every defect the whole model has once the data is well formed", () => {
    const data: unknown = {
      dimensions: [{ kind: "choice", name: "a", values: ["x"] }, { kind: "choice", name: "b", values: [1], activeWhen: { is: ["c", 1] } }, { kind: "choice", name: "c", values: [1] }],
      rules: [{ requires: { is: ["a", "y"] } }, { excludes: { unset: "a" } }],
    };
    expect(parseModelIssues(data)).toEqual(['dimension "b" is active depending on "c", which is not a dimension declared before it', 'rule 0 compares "a" with "y", which it can never take', 'rule 1 compares "a" with unset, which it can never take']);
  });
});

describe("fnv1a64", () => {
  it("matches the published FNV-1a 64-bit test vectors", () => {
    expect(fnv1a64("")).toBe("cbf29ce484222325");
    expect(fnv1a64("a")).toBe("af63dc4c8601ec8c");
    expect(fnv1a64("foobar")).toBe("85944171f73967e8");
  });

  it("hashes the UTF-8 bytes of non-ASCII text", () => {
    expect(fnv1a64("é")).not.toBe(fnv1a64("e"));
    expect(fnv1a64("é")).toMatch(/^[0-9a-f]{16}$/u);
  });
});
