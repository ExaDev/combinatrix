import { describe, expect, expectTypeOf, it } from "vitest";

import { fnv1a64 } from "./hash";
import type { TupleOf, TypedRule } from "./index";
import { choice, defineModel, isCondition, isRule, ModelError, parseRules } from "./index";

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
