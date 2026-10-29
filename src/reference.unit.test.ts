import { describe, expect, it } from "vitest";

import { allOf, choice, computed, defineModel, firstValid, is, predicate } from "./index";
import { referenceCombinations } from "./reference";

describe("referenceCombinations", () => {
  it("lists the Cartesian product with the first dimension varying slowest", () => {
    const model = defineModel({ dimensions: [choice("a", [1, 2]), choice("b", ["x", "y"])] });
    expect([...referenceCombinations(model)]).toEqual([
      { a: 1, b: "x" },
      { a: 1, b: "y" },
      { a: 2, b: "x" },
      { a: 2, b: "y" },
    ]);
  });

  it("keeps unset as a choice of its own, distinct from null", () => {
    const model = defineModel({ dimensions: [choice("a", [undefined, null])] });
    expect([...referenceCombinations(model)]).toEqual([{ a: undefined }, { a: null }]);
  });

  it("drops the combinations a rule or predicate rejects", () => {
    const model = defineModel({
      dimensions: [choice("a", [1, 2]), choice("b", ["x", "y"])],
      rules: [{ excludes: allOf(is("a", 1), is("b", "y")) }],
      constraints: [predicate({ reads: ["a", "b"], test: ({ a, b }) => !(a === 2 && b === "x") })],
    });
    expect([...referenceCombinations(model)]).toEqual([
      { a: 1, b: "x" },
      { a: 2, b: "y" },
    ]);
  });

  it("collapses an inactive dimension to unset and lists the collapsed combination once", () => {
    const model = defineModel({ dimensions: [choice("on", [false, true]), choice("level", [1, 2], { activeWhen: is("on", true) })] });
    expect([...referenceCombinations(model)]).toEqual([
      { on: false, level: undefined },
      { on: true, level: 1 },
      { on: true, level: 2 },
    ]);
  });

  it("derives a first-valid dimension as the first candidate the rules accept, dropping a combination with none", () => {
    const model = defineModel({
      dimensions: [choice("feature", ["none", "beta-only", "stable-only"]), firstValid("channel", [undefined, "beta", "stable"])],
      rules: [
        { requires: is("channel", "beta"), when: is("feature", "beta-only") },
        { implies: [is("feature", "stable-only"), is("channel", "stable")] },
      ],
    });
    expect([...referenceCombinations(model)]).toEqual([
      { feature: "none", channel: undefined },
      { feature: "beta-only", channel: "beta" },
      { feature: "stable-only", channel: "stable" },
    ]);
    const impossible = defineModel({ dimensions: [choice("a", [1, 2]), firstValid("b", ["x"])], rules: [{ excludes: allOf(is("a", 2), is("b", "x")) }] });
    expect([...referenceCombinations(impossible)]).toEqual([{ a: 1, b: "x" }]);
  });

  it("computes a computed dimension from the dimensions it reads", () => {
    const model = defineModel({ dimensions: [choice("a", [1, 2]), computed("double", { reads: ["a"], compute: ({ a }) => (typeof a === "number" ? a * 2 : null) })] });
    expect([...referenceCombinations(model)]).toEqual([
      { a: 1, double: 2 },
      { a: 2, double: 4 },
    ]);
  });
});
