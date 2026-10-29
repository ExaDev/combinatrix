import { describe, expect, it } from "vitest";

import { execute } from "./engine";
import type { Json, JsonObject } from "./json";
import { getIn, isJsonObject } from "./json";
import type { RuleView } from "./modelEdit";
import { addDimension, addListItem, addRule, addValue, classifyDimension, classifyRule, displayProblem, EMPTY_MODEL, dimensionNames, moveDimension, moveListItem, moveRule, moveValue, removeDimension, removeListItem, removeRule, removeValue, renameDimension, restate, ruleStatement, setRuleStatement, statementShape, statementSlots, setActiveWhen, setDimensionKind, setNode, setRuleForm, setRuleName, setRuleScope, setValue, uniqueName, updateNode, viewOfModel } from "./modelEdit";

/** Numbers the tests write into values, and how often a renamed reference is expected to occur in the two trees that hold them. */
const NUMBER_VALUE = 3;
const REFERENCES_IN_STRANGE_RULES = 3;
const REFERENCES_IN_EVERY_KIND = 7;
const RENAMED_REFERENCES_IN_FOLDING_RULES = 5;
const KEPT_KEYS_IN_FOLDING_RULES = 2;

const OS: Json = { kind: "reference", key: "os" };
const WINDOWS: Json = { kind: "textLiteral", value: "windows" };
const IS_WINDOWS: Json = { kind: "textCompare", op: "equals", left: OS, right: WINDOWS };

const MODEL: JsonObject = {
  dimensions: [
    { kind: "choice", name: "os", values: ["linux", "windows"] },
    { kind: "choice", name: "arch", values: ["x64", "arm64"] },
    { kind: "first-valid", name: "codec", candidates: ["zstd", "brotli"], activeWhen: IS_WINDOWS },
  ],
  rules: [{ name: "no zstd on windows", excludes: { kind: "exists", operand: { kind: "reference", key: "codec" } }, when: IS_WINDOWS }],
};

/** The names of the dimensions of a model, in order. */
function names(model: JsonObject): string[] {
  return dimensionNames(model);
}

function dimensionAt(model: JsonObject, index: number): Json {
  const item = getIn(model, ["dimensions", index]);
  if (item === undefined) throw new Error("no such dimension");

  return item;
}

function domainOf(model: JsonObject, index: number): Json {
  const item = dimensionAt(model, index);
  if (!isJsonObject(item)) throw new Error("no such dimension");

  return item["values"] ?? item["candidates"] ?? null;
}

function ruleAt(model: JsonObject, index: number): Json {
  const rule = getIn(model, ["rules", index]);
  if (rule === undefined) throw new Error("no such rule");

  return rule;
}

describe("viewOfModel", () => {
  it("shows structured dimensions and rules", () => {
    const view = viewOfModel(MODEL);

    expect(view.dimensions.map((dimension) => (dimension.kind === "dimension" ? dimension.name : "raw"))).toEqual(["os", "arch", "codec"]);
    expect(view.rules?.map((rule) => rule.kind)).toEqual(["rule"]);
    expect(view.otherKeys).toEqual([]);
  });

  it("lists top-level keys it does not show, and has no rules when the key is absent", () => {
    const view = viewOfModel({ dimensions: [], note: "kept" });

    expect(view.rules).toBeUndefined();
    expect(view.otherKeys).toEqual(["note"]);
  });

  it("shows a dimension of a kind the library does not take as data as raw", () => {
    const computed: Json = { kind: "computed", name: "target", reads: ["os"] };

    expect(classifyDimension(computed)).toEqual({ kind: "raw", json: computed, nodeKind: "computed" });
  });

  it("shows a dimension with an extra key, a missing name or a value that is not a scalar as raw", () => {
    expect(classifyDimension({ kind: "choice", name: "a", values: ["x"], note: 1 }).kind).toBe("raw");
    expect(classifyDimension({ kind: "choice", values: ["x"] }).kind).toBe("raw");
    expect(classifyDimension({ kind: "choice", name: "a", values: [["x"]] }).kind).toBe("raw");
    expect(classifyDimension({ kind: "choice", name: "a", candidates: ["x"] }).kind).toBe("raw");
    expect(classifyDimension("text").kind).toBe("raw");
  });

  it("shows a rule with none of the forms, two of them, a stray key or a bad tuple as raw", () => {
    expect(classifyRule({ name: "x" }).kind).toBe("raw");
    expect(classifyRule({ requires: IS_WINDOWS, excludes: IS_WINDOWS }).kind).toBe("raw");
    expect(classifyRule({ requires: IS_WINDOWS, because: "x" }).kind).toBe("raw");
    expect(classifyRule({ implies: [IS_WINDOWS] }).kind).toBe("raw");
    expect(classifyRule({ implies: IS_WINDOWS }).kind).toBe("raw");
    expect(classifyRule({ requires: IS_WINDOWS, name: NUMBER_VALUE }).kind).toBe("raw");
  });

  it("reads each rule form with its scope", () => {
    const view: RuleView | { kind: "raw" } = classifyRule({ implies: [IS_WINDOWS, WINDOWS], name: "n", when: IS_WINDOWS, unless: OS });

    expect(view).toEqual({ kind: "rule", body: { form: "implies", antecedent: IS_WINDOWS, consequent: WINDOWS }, name: "n", when: IS_WINDOWS, unless: OS });
  });

  it("says why a value cannot be shown as a model", () => {
    expect(displayProblem([])).toContain("not an object");
    expect(displayProblem({})).toContain("dimensions");
    expect(displayProblem({ dimensions: {} })).toContain("dimensions");
    expect(displayProblem({ dimensions: [], rules: NUMBER_VALUE })).toContain("rules");
    expect(displayProblem({ dimensions: [], rules: [] })).toBeUndefined();
  });
});

describe("dimensions", () => {
  it("adds a choice dimension with a name no other has, and a value to start from", () => {
    const once = addDimension(EMPTY_MODEL);
    const twice = addDimension(once);

    expect(names(twice)).toEqual(["dimension", "dimension2"]);
    expect(domainOf(twice, 0)).toEqual(["value"]);
  });

  it("adds a first-valid dimension with its candidates under the right key", () => {
    expect(addDimension(EMPTY_MODEL, "first-valid")).toEqual({ dimensions: [{ kind: "first-valid", name: "dimension", candidates: ["value"] }] });
  });

  it("removes and moves a dimension", () => {
    expect(names(removeDimension(MODEL, 1))).toEqual(["os", "codec"]);
    expect(names(moveDimension(MODEL, 2, "earlier"))).toEqual(["os", "codec", "arch"]);
    expect(names(moveDimension(MODEL, 0, "later"))).toEqual(["arch", "os", "codec"]);
    expect(moveDimension(MODEL, 0, "earlier")).toEqual(MODEL);
  });

  it("does not change the model it is given", () => {
    const before = structuredClone(MODEL);

    removeDimension(MODEL, 0);
    renameDimension(MODEL, 0, "system");
    addValue(MODEL, 0);

    expect(MODEL).toEqual(before);
  });

  it("changes the kind, moving the domain to the key the new kind uses and keeping everything else", () => {
    const changed = setDimensionKind(MODEL, 2, "choice");
    const dimension = classifyDimension(dimensionAt(changed, 2));

    expect(dimension).toEqual({ kind: "dimension", dimensionKind: "choice", name: "codec", values: ["zstd", "brotli"], activeWhen: IS_WINDOWS });
    expect(setDimensionKind(MODEL, 0, "choice")).toEqual(MODEL);
  });

  it("round-trips a kind change", () => {
    expect(setDimensionKind(setDimensionKind(MODEL, 0, "first-valid"), 0, "choice")).toEqual(MODEL);
  });

  it("refuses to change a name or kind of a dimension it cannot show", () => {
    const model: JsonObject = { dimensions: [{ kind: "computed", name: "x" }] };

    expect(() => renameDimension(model, 0, "y")).toThrow("no name to change");
    expect(() => setDimensionKind(model, 0, "choice")).toThrow("no kind to change");
    expect(() => addValue(model, 0)).toThrow("no domain");
  });

  it("sets and removes the activity condition", () => {
    const set = setActiveWhen(MODEL, 0, IS_WINDOWS);

    expect(viewOfModel(set).dimensions[0]).toMatchObject({ activeWhen: IS_WINDOWS });
    expect(setActiveWhen(set, 0, undefined)).toEqual(MODEL);
    expect(dimensionAt(setActiveWhen(MODEL, 2, undefined), 2)).toEqual({ kind: "first-valid", name: "codec", candidates: ["zstd", "brotli"] });
  });
});

describe("renaming a dimension", () => {
  it("renames every reference to it in rules and in activity conditions, and no other", () => {
    const renamed = renameDimension(MODEL, 0, "system");
    const text = JSON.stringify(renamed);

    expect(names(renamed)).toEqual(["system", "arch", "codec"]);
    expect(text).not.toContain('"key":"os"');
    expect(text.match(/"key":"system"/g)).toHaveLength(2);
    expect(text).toContain('"key":"codec"');
  });

  it("produces a model the library accepts, which the unrenamed references would not be", () => {
    const check = (model: JsonObject): boolean => execute({ op: "validate", model: JSON.stringify(model) }).ok;

    expect(check(MODEL)).toBe(true);
    expect(check(renameDimension(MODEL, 0, "system"))).toBe(true);
    expect(check(setNode(MODEL, ["dimensions", 0, "name"], "system"))).toBe(false);
  });

  it("renames inside nested conditions, but leaves a node it cannot edit exactly as it is", () => {
    const opaque: Json = { kind: "mystery", collection: "os", item: { kind: "exists", operand: OS } };
    const model: JsonObject = {
      dimensions: [{ kind: "choice", name: "os", values: ["a"] }],
      rules: [
        { requires: { kind: "not", operand: { kind: "and", left: IS_WINDOWS, right: { kind: "anyOf", operands: [IS_WINDOWS, opaque] } } }, unless: IS_WINDOWS },
        { requires: IS_WINDOWS, because: "a rule with a key the form does not know" },
      ],
    };

    const renamed = renameDimension(model, 0, "system");

    expect(JSON.stringify(renamed["rules"]).match(/"key":"system"/g)).toHaveLength(REFERENCES_IN_STRANGE_RULES);
    expect(JSON.stringify(renamed["rules"])).toContain(JSON.stringify(opaque));
    expect(ruleAt(renamed, 1)).toEqual(ruleAt(model, 1));
  });

  it("renames inside the kinds that quantify, call, look up and fold, and leaves the keys of tree references alone", () => {
    const n: Json = { kind: "reference", key: "n", unit: { m: 1 } };
    const model: JsonObject = {
      dimensions: [{ kind: "choice", name: "n", values: [1] }],
      rules: [
        {
          requires: {
            kind: "some",
            collection: "n",
            item: { kind: "exists", operand: n },
            filter: {
              kind: "compare",
              op: "gt",
              left: { kind: "call", fn: "f", args: [n] },
              right: { kind: "fold", collection: "n", filter: { kind: "exists", operand: n }, combiner: { mode: "reduce", initial: n, combine: { kind: "lookup", table: "n", keys: [n, { kind: "treeReference", key: "n" }] } } },
            },
          },
        },
        { requires: { kind: "treeReference", key: "n" } },
      ],
    };

    const text = JSON.stringify(renameDimension(model, 0, "m")["rules"]);

    expect(text.match(/"key":"m"/g)).toHaveLength(RENAMED_REFERENCES_IN_FOLDING_RULES);
    expect(text.match(/"key":"n"/g)).toHaveLength(KEPT_KEYS_IN_FOLDING_RULES);
    expect(text).toContain('"unit":{"m":1}');
    expect(text).toContain('"collection":"n"');
  });

  it("renames inside every expression kind that holds a reference", () => {
    const model: JsonObject = {
      dimensions: [{ kind: "choice", name: "n", values: [1] }],
      rules: [
        {
          requires: {
            kind: "compare",
            op: "gt",
            left: { kind: "negate", operand: { kind: "arithmetic", op: "add", left: { kind: "reference", key: "n" }, right: { kind: "reference", key: "n" } } },
            right: { kind: "conditional", cases: [{ when: { kind: "exists", operand: { kind: "reference", key: "n" } }, then: { kind: "reference", key: "n" } }], fallback: { kind: "reference", key: "n" } },
          },
        },
        { requires: { kind: "memberOf", op: "in", operand: { kind: "reference", key: "n" }, candidates: [{ kind: "reference", key: "n" }] } },
      ],
    };

    expect(JSON.stringify(renameDimension(model, 0, "m")["rules"])).not.toContain('"n"');
    expect(JSON.stringify(renameDimension(model, 0, "m")["rules"]).match(/"key":"m"/g)).toHaveLength(REFERENCES_IN_EVERY_KIND);
  });
});

describe("values", () => {
  it("adds a value that is new, removes one and moves one", () => {
    const added = addValue(MODEL, 0);

    expect(domainOf(added, 0)).toEqual(["linux", "windows", "value"]);
    expect(domainOf(addValue(added, 0), 0)).toEqual(["linux", "windows", "value", "value2"]);
    expect(domainOf(removeValue(MODEL, 0, 0), 0)).toEqual(["windows"]);
    expect(domainOf(moveValue(MODEL, 0, 1, "earlier"), 0)).toEqual(["windows", "linux"]);
    expect(domainOf(moveValue(MODEL, 0, 1, "later"), 0)).toEqual(["linux", "windows"]);
  });

  it("edits a value of any scalar type, and writes a first-valid dimension's candidates", () => {
    const edited = setValue(setValue(setValue(setValue(MODEL, 0, 0, NUMBER_VALUE), 0, 1, true), 1, 0, null), 2, 1, "z");

    expect(domainOf(edited, 0)).toEqual([NUMBER_VALUE, true]);
    expect(domainOf(edited, 1)).toEqual([null, "arm64"]);
    expect(domainOf(edited, 2)).toEqual(["zstd", "z"]);
  });

  it("makes a new text value no other is", () => {
    expect(uniqueName(["value", "value2"], "value")).toBe("value3");
    expect(uniqueName([], "value")).toBe("value");
  });
});

describe("rules", () => {
  it("adds a rule, creating the list the first time, and removes and moves rules", () => {
    const first = addRule(EMPTY_MODEL, ["os"]);
    const second = addRule(first, ["os"]);

    expect(first["rules"]).toEqual([{ excludes: { kind: "exists", operand: OS } }]);
    expect(second["rules"]).toEqual([ruleAt(first, 0), ruleAt(first, 0)]);
    expect(removeRule(second, 0)["rules"]).toEqual(first["rules"]);
    expect(removeRule(first, 0)["rules"]).toEqual([]);
    const two = addRule(MODEL, ["os"]);
    expect(moveRule(two, 1, "earlier")["rules"]).toEqual([ruleAt(two, 1), ruleAt(two, 0)]);
  });

  it("changes a rule's form, keeping its condition between requires and excludes", () => {
    const required = setRuleForm(MODEL, 0, "requires");
    const rule = classifyRule(ruleAt(required, 0));

    expect(rule).toMatchObject({ kind: "rule", body: { form: "requires" }, name: "no zstd on windows", when: IS_WINDOWS });
    expect(setRuleForm(required, 0, "excludes")).toEqual(MODEL);
    expect(setRuleForm(MODEL, 0, "excludes")).toEqual(MODEL);
  });

  it("changes a rule to implies, with the condition as antecedent, and back", () => {
    const implies = setRuleForm(MODEL, 0, "implies");
    const view = classifyRule(ruleAt(implies, 0));

    expect(view).toMatchObject({ body: { form: "implies", antecedent: { kind: "exists" }, consequent: { kind: "exists" } } });
    expect(setRuleForm(implies, 0, "excludes")).toEqual(MODEL);
  });

  it("keeps the order of a rule's keys through a change of form", () => {
    expect(Object.keys(objectOf(ruleAt(setRuleForm(MODEL, 0, "requires"), 0)))).toEqual(["name", "requires", "when"]);
  });

  it("reads what a rule states, whatever its form", () => {
    const codecIsSet: Json = { kind: "exists", operand: { kind: "reference", key: "codec" } };

    expect(ruleStatement(MODEL, 0)).toEqual(codecIsSet);
    expect(ruleStatement(setRuleForm(MODEL, 0, "implies"), 0)).toEqual([codecIsSet, { kind: "exists", operand: OS }]);
  });

  it("sets what a rule states under another form, in the place of the key it stated itself under", () => {
    const pair: Json = [{ kind: "exists", operand: OS }, { kind: "exists", operand: { kind: "reference", key: "arch" } }];
    const implied = setRuleStatement(MODEL, 0, "implies", pair);

    expect(Object.keys(objectOf(ruleAt(implied, 0)))).toEqual(["name", "implies", "when"]);
    expect(ruleStatement(implied, 0)).toEqual(pair);
  });

  it("restates a statement in another form, keeping the condition and starting a consequent", () => {
    const dimensions = ["os", "arch"];

    expect(restate(IS_WINDOWS, "excludes", "requires", dimensions)).toBe(IS_WINDOWS);
    expect(restate(IS_WINDOWS, "requires", "implies", dimensions)).toEqual([IS_WINDOWS, { kind: "exists", operand: OS }]);
    expect(restate([IS_WINDOWS, OS], "implies", "excludes", dimensions)).toBe(IS_WINDOWS);
  });

  it("names where the children of a statement are: the condition, or the antecedent and the consequent", () => {
    expect(statementSlots(IS_WINDOWS)).toEqual([[[]]]);
    expect(statementSlots([IS_WINDOWS, OS])).toEqual([[[0], [1]]]);
  });

  it("names the two shapes a statement has", () => {
    expect([statementShape("requires"), statementShape("excludes"), statementShape("implies")]).toEqual(["condition", "condition", "pair"]);
  });

  it("sets and removes a rule's name, when and unless", () => {
    const named = setRuleName(MODEL, 0, "renamed");
    const scoped = setRuleScope(named, 0, "unless", IS_WINDOWS);

    expect(classifyRule(ruleAt(scoped, 0))).toMatchObject({ name: "renamed", unless: IS_WINDOWS, when: IS_WINDOWS });
    expect(setRuleScope(setRuleScope(setRuleName(scoped, 0, undefined), 0, "unless", undefined), 0, "when", undefined)["rules"]).toEqual([{ excludes: { kind: "exists", operand: { kind: "reference", key: "codec" } } }]);
  });

  it("refuses to change the form of a rule it cannot show", () => {
    expect(() => setRuleForm({ dimensions: [], rules: [{ name: "x" }] }, 0, "requires")).toThrow("no form to change");
  });
});

describe("conditions", () => {
  const path = ["rules", 0, "when"];

  it("replaces and updates a node at a path", () => {
    expect(setNode(MODEL, path, OS)["rules"]).toEqual([{ ...objectOf(ruleAt(MODEL, 0)), when: OS }]);
    expect(updateNode(MODEL, [...path, "op"], () => "notEquals")["rules"]).toMatchObject([{ when: { op: "notEquals" } }]);
  });

  it("adds, removes and moves an item of a list of operands", () => {
    const model: JsonObject = { dimensions: [], rules: [{ requires: { kind: "allOf", operands: [IS_WINDOWS] } }] };
    const operands = ["rules", 0, "requires", "operands"];
    const added = addListItem(model, operands, OS);

    expect(JSON.stringify(added)).toContain('"operands":[' + JSON.stringify(IS_WINDOWS) + "," + JSON.stringify(OS) + "]");
    expect(removeListItem(added, operands, 1)).toEqual(model);
    expect(JSON.stringify(moveListItem(added, operands, 1, "earlier"))).toContain('"operands":[' + JSON.stringify(OS) + ",");
  });
});

function objectOf(json: Json): JsonObject {
  if (!isJsonObject(json)) throw new Error("expected an object");

  return json;
}
