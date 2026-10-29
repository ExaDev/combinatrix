import { describe, expect, it } from "vitest";

import type { Dimension, ModelDefinition } from "./index";
import { choice, computed, defineModel, firstValid, is, isSet, ModelError, oneOf, predicate, sampled } from "./index";

function issuesOf<Ds extends readonly Dimension[]>(definition: ModelDefinition<Ds>): readonly string[] {
  try {
    defineModel(definition);
  } catch (error) {
    if (error instanceof ModelError) return error.issues;
    throw error;
  }
  throw new Error("the model was accepted");
}

describe("defineModel", () => {
  it("accepts a model and exposes its constraints, rules first", () => {
    const rule = { requires: isSet("a") } as const;
    const custom = predicate({ reads: ["a"], test: () => true });
    const model = defineModel({ dimensions: [choice("a", [undefined, 1])], rules: [rule], constraints: [custom] });
    expect(model.constraints).toHaveLength(2);
    expect(model.constraints[1]).toBe(custom);
    expect(model.sources).toEqual([rule, undefined]);
  });

  it("takes a sampled dimension's points from its sampler", () => {
    const points = [Math.SQRT1_2, Math.LN2];
    const model = defineModel({ dimensions: [sampled("ratio", () => points)] });
    expect(model.dimensions[0]).toMatchObject({ kind: "choice", values: points });
  });

  it.each<[string, ModelDefinition<readonly Dimension[]>, string]>([
    ["a duplicate name", { dimensions: [choice("a", [1]), choice("a", [2])] }, 'dimension "a" is declared more than once'],
    ["an empty name", { dimensions: [choice("", [1])] }, "a dimension has an empty name"],
    // @ts-expect-error an empty domain is a compile error, and refused at runtime too
    ["an empty domain", { dimensions: [choice("a", [])] }, 'dimension "a" has no values'],
    ["an empty sampled domain", { dimensions: [sampled("a", () => [])] }, 'dimension "a" has no values'],
    ["a repeated value", { dimensions: [choice("a", [1, 1])] }, 'dimension "a" lists 1 more than once'],
    ["a non-finite number", { dimensions: [sampled("a", () => [Number.POSITIVE_INFINITY])] }, 'dimension "a" has value Infinity, which is not a JSON scalar'],
    ["a computed dimension reading a later one", { dimensions: [computed("a", { reads: ["b"], compute: () => 1 }), choice("b", [1])] }, 'dimension "a" reads "b", which is not a dimension declared before it'],
    ["activity depending on a later dimension", { dimensions: [choice("a", [1], { activeWhen: isSet("b") }), choice("b", [1])] }, 'dimension "a" is active depending on "b", which is not a dimension declared before it'],
    ["activity comparing with an impossible value", { dimensions: [choice("a", [1]), choice("b", [1], { activeWhen: is("a", 2) })] }, 'the activity of dimension "b" at $.right: compares "a" with 2, which it can never take'],
    ["a rule on an unknown dimension", { dimensions: [choice("a", [1])], rules: [{ requires: isSet("z") }] }, 'rule 0 at $.operand: mentions unknown dimension "z"'],
    ["a rule comparing with an impossible value", { dimensions: [choice("a", [1])], rules: [{ requires: oneOf("a", [1, "one"]) }] }, 'rule 0 at $.right: compares "a" with "one", which it can never take'],
    ["a constraint on an unknown dimension", { dimensions: [choice("a", [1])], constraints: [predicate({ reads: ["z"], test: () => true })] }, 'constraint 0 depends on unknown dimension "z"'],
    [
      "a first-valid dimension constrained with a later one",
      { dimensions: [firstValid("a", [1]), choice("b", [1])], rules: [{ requires: is("a", 1), when: isSet("b") }] },
      'constraint 0 mentions first-valid dimension "a" and "b" declared after it, so its candidate could not be chosen from earlier values alone',
    ],
  ])("refuses %s", (_, definition, issue) => {
    expect(issuesOf(definition)).toContain(issue);
  });

  it("lists every defect, not only the first", () => {
    // @ts-expect-error an empty domain is a compile error
    expect(issuesOf({ dimensions: [choice("a", []), choice("a", [1, 1])] })).toEqual(['dimension "a" has no values', 'dimension "a" lists 1 more than once', 'dimension "a" is declared more than once']);
  });

  describe("given data that never met its types", () => {
    /** Calls `defineModel` as untyped JavaScript would, and returns the issues it refused with. */
    function issuesOfData(definition: unknown): readonly string[] {
      try {
        Reflect.apply(defineModel, undefined, [definition]);
      } catch (error) {
        if (error instanceof ModelError) return error.issues;
        throw error;
      }
      throw new Error("the model was accepted");
    }

    const dimension = { kind: "choice", name: "a", values: [1, 2] };

    it.each<[string, unknown, string]>([
      ["a definition that is not an object", null, "the model definition is not an object"],
      ["a misspelt key of the definition", { dimensions: [dimension], rulez: [] }, 'the model definition has the unknown key "rulez"'],
      ["dimensions that are not a list", { dimensions: dimension }, "the dimensions are not a list"],
      ["rules that are not a list", { dimensions: [dimension], rules: { requires: isSet("a") } }, "the rules are not a list"],
      ["a dimension that is not an object", { dimensions: ["a"] }, "dimension 0 is not an object"],
      ["a dimension of an unknown kind", { dimensions: [{ ...dimension, kind: "free" }] }, 'dimension 0 has a kind that is not "choice", "first-valid" or "computed"'],
      ["a misspelt key of a dimension", { dimensions: [{ ...dimension, activeWen: isSet("a") }] }, 'dimension 0 has the unknown key "activeWen"'],
      ["the domain key of another kind", { dimensions: [{ kind: "first-valid", name: "a", values: [1] }] }, 'dimension 0 has the unknown key "values"'],
      ["a name that is not a string", { dimensions: [{ ...dimension, name: 1 }] }, "dimension 0 has a name that is not a string"],
      ["values that are not a list", { dimensions: [{ ...dimension, values: "ab" }] }, "dimension 0 has values that are not a list"],
      ["a missing domain", { dimensions: [{ kind: "first-valid", name: "a" }] }, "dimension 0 has candidates that are not a list"],
      ["an activity condition that is not well formed", { dimensions: [{ ...dimension, activeWhen: { is: ["a", 1, 2] } }] }, "dimension 0 has an activeWhen that is not a well-formed condition"],
      ["reads that are not names", { dimensions: [{ kind: "computed", name: "a", reads: [1], compute: () => 1 }] }, "dimension 0 has reads that are not a list of names"],
      ["a compute that is not a function", { dimensions: [{ kind: "computed", name: "a", reads: [], compute: 1 }] }, "dimension 0 has a compute that is not a function"],
      ["a rule that is not well formed", { dimensions: [dimension], rules: [{ requires: { kind: "exists" } }] }, "rule 0 is not a well-formed rule"],
      ["an object as a value", { dimensions: [{ kind: "choice", name: "a", values: [{ nested: true }] }] }, 'dimension "a" has a value of type object, which is not a JSON scalar'],
      ["a list as a value", { dimensions: [{ kind: "choice", name: "a", values: [[1]] }] }, 'dimension "a" has a value of type array, which is not a JSON scalar'],
    ])("refuses %s", (_, definition, issue) => {
      expect(issuesOfData(definition)).toContain(issue);
    });

    it("accepts a dimension whose activeWhen is explicitly undefined, as the builders never write one but JavaScript may", () => {
      expect(() => {
        Reflect.apply(defineModel, undefined, [{ dimensions: [{ ...dimension, activeWhen: undefined }] }]);
      }).not.toThrow();
    });
  });
});
