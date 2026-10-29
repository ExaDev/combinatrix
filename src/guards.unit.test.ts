import { describe, expect, it } from "vitest";

import { fnv1a64 } from "./hash";
import { choice, defineModel, isCondition, isRule } from "./index";

describe("isCondition", () => {
  it.each([{ is: ["a", "x"] }, { is: ["a", null] }, { in: ["a", ["x", 1, true, null]] }, { set: "a" }, { unset: "a" }, { all: [] }, { any: [{ set: "a" }] }, { not: { all: [{ set: "a" }, { unset: "b" }] } }])("accepts %j", (value) => {
    expect(isCondition(value)).toBe(true);
  });

  it.each([null, [], "a", { is: ["a"] }, { is: [1, "x"] }, { is: ["a", { nested: true }] }, { is: ["a", Number.NaN] }, { in: ["a", "x"] }, { in: ["a"] }, { set: 1 }, { all: [{ bogus: "a" }] }, { not: "a" }, { set: "a", unset: "a" }, {}])("refuses %j", (value) => {
    expect(isCondition(value)).toBe(false);
  });
});

describe("isRule", () => {
  it("accepts every form read back from JSON, and the model accepts it", () => {
    const text = '[{"requires":{"set":"a"}},{"excludes":{"is":["a","x"]},"when":{"set":"a"},"name":"no x"},{"implies":[{"is":["a","x"]},{"unset":"a"}],"unless":{"unset":"a"}}]';
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed) || !parsed.every(isRule)) throw new Error("the rules were refused");
    expect(() => defineModel({ dimensions: [choice("a", [undefined, "x"])], rules: parsed })).not.toThrow();
  });

  it.each([null, {}, { requires: { set: "a" }, excludes: { set: "a" } }, { requires: "a" }, { implies: [{ set: "a" }] }, { requires: { set: "a" }, when: "a" }, { requires: { set: "a" }, unless: 1 }, { requires: { set: "a" }, name: 1 }, { requires: { set: "a" }, extra: true }])("refuses %j", (value) => {
    expect(isRule(value)).toBe(false);
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
