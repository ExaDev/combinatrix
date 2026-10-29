// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { execute } from "./engine";
import { EXAMPLES } from "./examples";
import { Harness } from "./formHarness";
import type { Json, JsonObject } from "./json";
import { isJsonObject, parseJson } from "./json";

/** The example the page starts with: a dimension of three operating systems and a rule that excludes one of them. */
const STARTING_EXAMPLE = 1;
const LINUX = "dimensions.0.values.0";
const RIGHT = "rules.0.excludes.right";

/** Numbers the tests write into values. */
const FIVE = 5;
const SEVEN = 7;
const TWELVE = 12;
const ANSWER = 42;
const NINE = 9;
const FRACTION = -2.5;


/** A model the page can show, read from JSON text so it shares nothing with the one a test edits. */
function modelOf(value: unknown): JsonObject {
  const parsed = parseJson(JSON.stringify(value));
  if (!isJsonObject(parsed)) throw new Error("not a model");

  return parsed;
}

function startingHarness(): Harness {
  return new Harness(modelOf(EXAMPLES[STARTING_EXAMPLE]?.model));
}

const OS: Json = { kind: "reference", key: "os" };
const ARCH: Json = { kind: "reference", key: "arch" };
const exists = (operand: Json): Json => ({ kind: "exists", operand });

/** A model with two dimensions and one rule that excludes the given condition. */
function ruleModel(condition: Json): JsonObject {
  return modelOf({
    dimensions: [
      { kind: "choice", name: "os", values: ["linux", "windows"] },
      { kind: "choice", name: "arch", values: ["x64", "arm64"] },
    ],
    rules: [{ excludes: condition }],
  });
}

describe("a value of a dimension's domain", () => {
  it("is the same text after it is switched to a number and back", () => {
    const harness = startingHarness();
    harness.choose(`${LINUX}:type`, "number");
    expect(harness.at(["dimensions", 0, "values", 0])).toBe(0);
    harness.choose(`${LINUX}:type`, "text");

    expect(harness.at(["dimensions", 0, "values", 0])).toBe("linux");
    expect(harness.model).toEqual(modelOf(EXAMPLES[STARTING_EXAMPLE]?.model));
    expect(execute({ op: "validate", model: harness.state.text }).ok).toBe(true);
    harness.destroy();
  });

  it("is restored exactly, including the spacing of text that is not a number", () => {
    const harness = new Harness(modelOf({ dimensions: [{ kind: "choice", name: "d", values: [" 12 ", "1e3"] }] }));
    for (const position of [0, 1]) {
      harness.choose(`dimensions.0.values.${String(position)}:type`, "number");
      harness.choose(`dimensions.0.values.${String(position)}:type`, "text");
    }

    expect(harness.at(["dimensions", 0, "values"])).toEqual([" 12 ", "1e3"]);
    harness.destroy();
  });

  it("carries a number as its text, and text that is a canonical number as that number", () => {
    const harness = new Harness(modelOf({ dimensions: [{ kind: "choice", name: "d", values: ["12", SEVEN, "-2.5"] }] }));
    harness.choose("dimensions.0.values.0:type", "number");
    harness.choose("dimensions.0.values.1:type", "text");
    harness.choose("dimensions.0.values.2:type", "number");

    expect(harness.at(["dimensions", 0, "values"])).toEqual([TWELVE, "7", FRACTION]);
    harness.destroy();
  });

  it("carries true and false as text and exactly those two texts back", () => {
    const harness = new Harness(modelOf({ dimensions: [{ kind: "choice", name: "d", values: [true, false, "true", "false", "yes"] }] }));
    harness.choose("dimensions.0.values.0:type", "text");
    harness.choose("dimensions.0.values.1:type", "text");
    harness.choose("dimensions.0.values.2:type", "boolean");
    harness.choose("dimensions.0.values.3:type", "boolean");
    harness.choose("dimensions.0.values.4:type", "boolean");

    expect(harness.at(["dimensions", 0, "values"])).toEqual(["true", "false", true, false, false]);
    harness.destroy();
  });

  it("returns to the start through every type", () => {
    const harness = startingHarness();
    const types = ["number", "boolean", "null", "text"];
    const along = types.map((type) => {
      harness.choose(`${LINUX}:type`, type);

      return harness.at(["dimensions", 0, "values", 0]);
    });

    expect(along).toEqual([0, false, null, "linux"]);
    harness.destroy();
  });

  it("gives a type the value last held in it, so a number typed while it was a number comes back", () => {
    const harness = startingHarness();
    harness.choose(`${LINUX}:type`, "number");
    harness.type(`${LINUX}:value`, "42");
    harness.choose(`${LINUX}:type`, "text");
    expect(harness.at(["dimensions", 0, "values", 0])).toBe("linux");
    harness.type(`${LINUX}:value`, "ubuntu");
    harness.choose(`${LINUX}:type`, "number");
    expect(harness.at(["dimensions", 0, "values", 0])).toBe(ANSWER);
    harness.choose(`${LINUX}:type`, "text");

    expect(harness.at(["dimensions", 0, "values", 0])).toBe("ubuntu");
    harness.destroy();
  });

  it("keeps focus on the menu that was used, and says what happened", () => {
    const harness = startingHarness();
    harness.field(`${LINUX}:type`).focus();
    harness.choose(`${LINUX}:type`, "number");

    expect(document.activeElement).toBe(harness.field(`${LINUX}:type`));
    expect(harness.announced.at(-1)).toContain("number");
    harness.destroy();
  });

  it("keeps what is remembered out of the model and its text", () => {
    const harness = startingHarness();
    harness.choose(`${LINUX}:type`, "number");

    const expected = modelOf(EXAMPLES[STARTING_EXAMPLE]?.model);
    expect(harness.at(["dimensions", 0, "values"])).toEqual([0, "macos", "windows"]);
    expect(Object.keys(harness.model)).toEqual(Object.keys(expected));
    expect(JSON.parse(harness.state.text)).toEqual(harness.model);
    expect(harness.state.text).not.toContain("linux");
    harness.destroy();
  });
});

describe("what is remembered of a value", () => {
  it("survives adding items and typing, which move nothing", () => {
    const harness = startingHarness();
    harness.choose(`${LINUX}:type`, "number");
    harness.click("dimensions.0.values:add");
    harness.click("dimensions:add");
    harness.click("rules:add");
    harness.choose(`${LINUX}:type`, "text");

    expect(harness.at(["dimensions", 0, "values", 0])).toBe("linux");
    harness.destroy();
  });

  it("is dropped when the list the value is in is reordered, because the value at its place is then another's", () => {
    const harness = new Harness(modelOf({ dimensions: [{ kind: "choice", name: "d", values: ["linux", SEVEN] }] }));
    harness.choose("dimensions.0.values.0:type", "number");
    harness.click("dimensions.0.values.1:up");
    expect(harness.at(["dimensions", 0, "values"])).toEqual([SEVEN, 0]);
    harness.choose("dimensions.0.values.0:type", "text");

    expect(harness.at(["dimensions", 0, "values", 0])).toBe("7");
    harness.destroy();
  });

  it("is dropped when a value before it is removed, because the value at its place is then another's", () => {
    const harness = new Harness(modelOf({ dimensions: [{ kind: "choice", name: "d", values: ["a", FIVE, "c"] }] }));
    harness.choose("dimensions.0.values.1:type", "text");
    harness.click("dimensions.0.values.0:remove");
    harness.choose("dimensions.0.values.1:type", "number");

    expect(harness.at(["dimensions", 0, "values"])).toEqual(["5", 0]);
    harness.destroy();
  });

  it("is kept for values in other lists when one list is reordered", () => {
    const harness = new Harness(modelOf({ dimensions: [{ kind: "choice", name: "a", values: ["x", "y"] }, { kind: "choice", name: "b", values: ["p", "q"] }] }));
    harness.choose("dimensions.1.values.0:type", "number");
    harness.click("dimensions.0.values.1:up");
    harness.choose("dimensions.1.values.0:type", "text");

    expect(harness.at(["dimensions", 1, "values", 0])).toBe("p");
    harness.destroy();
  });

  it("is dropped when a dimension is renamed, because a remembered node may refer to it by its old name", () => {
    const harness = new Harness(ruleModel(exists(OS)));
    const operand = "rules.0.excludes.operand";
    harness.choose(`${operand}:kind`, "numberLiteral");
    harness.type("dimensions.0:name", "platform");
    harness.choose(`${operand}:kind`, "reference");

    expect(harness.at(["rules", 0, "excludes", "operand"])).toEqual({ kind: "reference", key: "platform" });
    harness.destroy();
  });

  it("is dropped when the dimension it is in is moved, because the value at its place is then another's", () => {
    const harness = new Harness(modelOf({ dimensions: [{ kind: "choice", name: "a", values: ["x"] }, { kind: "choice", name: "b", values: [SEVEN] }] }));
    harness.choose("dimensions.0.values.0:type", "number");
    harness.click("dimensions.0:down");
    harness.choose("dimensions.0.values.0:type", "text");

    expect(harness.at(["dimensions", 0, "values", 0])).toBe("7");
    harness.destroy();
  });
});

describe("a literal of a rule's expression", () => {
  it("is the same after its kind is switched to a number and back", () => {
    const harness = startingHarness();
    harness.choose(`${RIGHT}:kind`, "numberLiteral");
    expect(harness.at(["rules", 0, "excludes", "right"])).toEqual({ kind: "numberLiteral", value: 0 });
    harness.choose(`${RIGHT}:kind`, "textLiteral");

    expect(harness.at(["rules", 0, "excludes", "right"])).toEqual({ kind: "textLiteral", value: "windows" });
    expect(harness.model).toEqual(modelOf(EXAMPLES[STARTING_EXAMPLE]?.model));
    expect(execute({ op: "validate", model: harness.state.text }).ok).toBe(true);
    harness.destroy();
  });

  it("keeps the text box filled and the focus on the kind menu", () => {
    const harness = startingHarness();
    harness.field(`${RIGHT}:kind`).focus();
    harness.choose(`${RIGHT}:kind`, "numberLiteral");
    harness.choose(`${RIGHT}:kind`, "textLiteral");

    expect(harness.field(`${RIGHT}.value:value`)).toHaveProperty("value", "windows");
    expect(document.activeElement).toBe(harness.field(`${RIGHT}:kind`));
    harness.destroy();
  });

  it("returns to the start through a chain of kinds", () => {
    const harness = startingHarness();
    for (const kind of ["numberLiteral", "booleanLiteral", "instantLiteral", "durationLiteral", "complexLiteral", "textLiteral"]) harness.choose(`${RIGHT}:kind`, kind);

    expect(harness.at(["rules", 0, "excludes", "right"])).toEqual({ kind: "textLiteral", value: "windows" });
    harness.destroy();
  });

  it("is restored with the unit and every other key it had", () => {
    const harness = new Harness(ruleModel({ kind: "compare", op: "eq", left: { kind: "numberLiteral", value: FIVE, unit: { m: 1, s: -1 } }, right: { kind: "numberLiteral", value: 0 } }));
    const left = "rules.0.excludes.left";
    harness.choose(`${left}:kind`, "textLiteral");
    expect(harness.at(["rules", 0, "excludes", "left"])).toEqual({ kind: "textLiteral", value: "5" });
    harness.choose(`${left}:kind`, "numberLiteral");

    expect(harness.at(["rules", 0, "excludes", "left"])).toEqual({ kind: "numberLiteral", value: FIVE, unit: { m: 1, s: -1 } });
    harness.destroy();
  });

  it("carries a number as its text and canonical numeric text as the number", () => {
    const harness = new Harness(ruleModel({ kind: "compare", op: "eq", left: { kind: "textLiteral", value: "12" }, right: { kind: "booleanLiteral", value: true } }));
    harness.choose("rules.0.excludes.left:kind", "numberLiteral");
    harness.choose("rules.0.excludes.right:kind", "textLiteral");

    expect(harness.at(["rules", 0, "excludes", "left"])).toEqual({ kind: "numberLiteral", value: TWELVE });
    expect(harness.at(["rules", 0, "excludes", "right"])).toEqual({ kind: "textLiteral", value: "true" });
    harness.destroy();
  });

  it("is restored when the complex literal is given in the other form and back", () => {
    const harness = new Harness(ruleModel({ kind: "compare", op: "eq", left: { kind: "complexLiteral", re: 3, im: 4, unit: { m: 1 } }, right: { kind: "numberLiteral", value: 0 } }));
    const left = "rules.0.excludes.left";
    harness.choose(`${left}:form`, "polar");
    expect(harness.at(["rules", 0, "excludes", "left"])).toEqual({ kind: "complexLiteral", magnitude: 0, phase: 0, unit: { m: 1 } });
    harness.choose(`${left}:form`, "rectangular");

    expect(harness.at(["rules", 0, "excludes", "left"])).toEqual({ kind: "complexLiteral", re: 3, im: 4, unit: { m: 1 } });
    harness.destroy();
  });

  it("is restored when a reference's key is made not to name a dimension and back", () => {
    const harness = new Harness(ruleModel(exists(OS)));
    const key = "rules.0.excludes.operand.key";
    harness.click("rules.0.excludes.operand:not-text");
    expect(harness.at(["rules", 0, "excludes", "operand", "key"])).toBeNull();
    harness.choose(`${key}:type`, "text");

    expect(harness.at(["rules", 0, "excludes", "operand", "key"])).toBe("os");
    harness.destroy();
  });
});

describe("an expression with operands", () => {
  const SUM: Json = { kind: "arithmetic", op: "subtract", left: OS, right: ARCH };

  it("gets its second operand back after it is switched to a kind with one and back", () => {
    const harness = new Harness(ruleModel({ kind: "compare", op: "eq", left: SUM, right: { kind: "numberLiteral", value: 0 } }));
    const left = "rules.0.excludes.left";
    harness.choose(`${left}:kind`, "negate");
    expect(harness.at(["rules", 0, "excludes", "left"])).toEqual({ kind: "negate", operand: OS });
    harness.choose(`${left}:kind`, "arithmetic");

    expect(harness.at(["rules", 0, "excludes", "left"])).toEqual(SUM);
    harness.destroy();
  });

  it("gets back what was remembered of its operands when it comes back itself", () => {
    const harness = new Harness(ruleModel({ kind: "compare", op: "eq", left: { kind: "arithmetic", op: "add", left: { kind: "textLiteral", value: "keep" }, right: { kind: "numberLiteral", value: 1 } }, right: { kind: "numberLiteral", value: 0 } }));
    const left = "rules.0.excludes.left";
    harness.choose(`${left}.left:kind`, "numberLiteral");
    harness.choose(`${left}:kind`, "negate");
    harness.choose(`${left}:kind`, "arithmetic");
    expect(harness.at(["rules", 0, "excludes", "left", "left"])).toEqual({ kind: "numberLiteral", value: 0 });
    harness.choose(`${left}.left:kind`, "textLiteral");

    expect(harness.at(["rules", 0, "excludes", "left", "left"])).toEqual({ kind: "textLiteral", value: "keep" });
    harness.destroy();
  });

  it("gets its second item back in a fold that combines with a starting value", () => {
    const reduce: Json = { mode: "reduce", initial: { kind: "numberLiteral", value: 1 }, combine: { kind: "numberLiteral", value: 2 } };
    const harness = new Harness(ruleModel({ kind: "compare", op: "gt", left: { kind: "fold", collection: "xs", combiner: reduce }, right: { kind: "numberLiteral", value: 0 } }));
    const mode = "rules.0.excludes.left.combiner:mode";
    harness.choose(mode, "max");
    expect(harness.at(["rules", 0, "excludes", "left", "combiner"])).toEqual({ mode: "max", item: { kind: "numberLiteral", value: 1 } });
    harness.choose(mode, "reduce");

    expect(harness.at(["rules", 0, "excludes", "left", "combiner"])).toEqual(reduce);
    harness.destroy();
  });
});

describe("an edit made to a child while the item is in another kind", () => {
  const LINUX_IS: Json = { kind: "textCompare", op: "equals", left: OS, right: { kind: "textLiteral", value: "linux" } };

  it("is kept when the item is switched back: the first operand of all of, edited as both's first side", () => {
    const harness = new Harness(ruleModel({ kind: "allOf", operands: [LINUX_IS, exists(ARCH), exists(OS)] }));
    harness.choose("rules.0.excludes:kind", "and");
    harness.type("rules.0.excludes.left.right.value:value", "macos");
    harness.choose("rules.0.excludes:kind", "allOf");

    expect(harness.at(["rules", 0, "excludes", "operands"])).toEqual([{ ...LINUX_IS, right: { kind: "textLiteral", value: "macos" } }, exists(ARCH), exists(OS)]);
    harness.destroy();
  });

  it("is kept for an arithmetic's left operand edited as the operand of a negation", () => {
    const sum: Json = { kind: "arithmetic", op: "add", left: { kind: "numberLiteral", value: 1 }, right: { kind: "numberLiteral", value: 2 } };
    const harness = new Harness(ruleModel({ kind: "compare", op: "eq", left: sum, right: { kind: "numberLiteral", value: 0 } }));
    const left = "rules.0.excludes.left";
    harness.choose(`${left}:kind`, "negate");
    harness.type(`${left}.operand.value:value`, "9");
    harness.choose(`${left}:kind`, "arithmetic");

    expect(harness.at(["rules", 0, "excludes", "left"])).toEqual({ ...sum, left: { kind: "numberLiteral", value: NINE } });
    harness.destroy();
  });

  it("is kept when it was made two levels down, and the operand it is in is still the one that is carried", () => {
    const nested: Json = { kind: "not", operand: LINUX_IS };
    const harness = new Harness(ruleModel({ kind: "allOf", operands: [nested, exists(ARCH), exists(OS)] }));
    harness.choose("rules.0.excludes:kind", "and");
    harness.type("rules.0.excludes.left.operand.right.value:value", "macos");
    harness.choose("rules.0.excludes:kind", "allOf");

    expect(harness.at(["rules", 0, "excludes", "operands", 0, "operand", "right", "value"])).toBe("macos");
    expect(harness.at(["rules", 0, "excludes", "operands", 2])).toEqual(exists(OS));
    harness.destroy();
  });

  it("is kept through a kind that has room for fewer operands, and the operand it has no room for survives", () => {
    const harness = new Harness(ruleModel({ kind: "allOf", operands: [LINUX_IS, exists(ARCH), exists(OS)] }));
    harness.choose("rules.0.excludes:kind", "not");
    harness.type("rules.0.excludes.operand.right.value:value", "macos");
    harness.choose("rules.0.excludes:kind", "and");
    harness.choose("rules.0.excludes:kind", "allOf");

    expect(harness.at(["rules", 0, "excludes", "operands", 0, "right", "value"])).toBe("macos");
    expect(harness.at(["rules", 0, "excludes", "operands", 1])).toEqual(exists(ARCH));
    expect(harness.at(["rules", 0, "excludes", "operands", 2])).toEqual(exists(OS));
    harness.destroy();
  });

  it("brings what was remembered of its own items with it, so a type switched inside the child can be undone", () => {
    const sum: Json = { kind: "arithmetic", op: "add", left: { kind: "textLiteral", value: "keep" }, right: { kind: "numberLiteral", value: 2 } };
    const harness = new Harness(ruleModel({ kind: "compare", op: "eq", left: sum, right: { kind: "numberLiteral", value: 0 } }));
    const left = "rules.0.excludes.left";
    harness.choose(`${left}:kind`, "negate");
    harness.choose(`${left}.operand:kind`, "numberLiteral");
    harness.choose(`${left}:kind`, "arithmetic");
    expect(harness.at(["rules", 0, "excludes", "left", "left"])).toEqual({ kind: "numberLiteral", value: 0 });
    harness.choose(`${left}.left:kind`, "textLiteral");

    expect(harness.at(["rules", 0, "excludes", "left", "left"])).toEqual({ kind: "textLiteral", value: "keep" });
    harness.destroy();
  });

  it("is kept for the antecedent of a rule edited as its condition, with the consequent from memory", () => {
    const pair: Json = [LINUX_IS, exists(ARCH)];
    const harness = new Harness(modelOf({ dimensions: [{ kind: "choice", name: "os", values: ["linux"] }, { kind: "choice", name: "arch", values: ["x64"] }], rules: [{ implies: pair }] }));
    harness.choose("rules.0:form", "excludes");
    harness.type("rules.0.excludes.right.value:value", "macos");
    harness.choose("rules.0:form", "implies");

    expect(harness.at(["rules", 0, "implies"])).toEqual([{ ...LINUX_IS, right: { kind: "textLiteral", value: "macos" } }, exists(ARCH)]);
    harness.destroy();
  });

  it("is kept for a complex literal's unit added in the other form", () => {
    const harness = new Harness(ruleModel({ kind: "compare", op: "eq", left: { kind: "complexLiteral", re: 3, im: 4 }, right: { kind: "numberLiteral", value: 0 } }));
    const left = "rules.0.excludes.left";
    harness.choose(`${left}:form`, "polar");
    harness.click(`${left}.unit:add`);
    harness.choose(`${left}:form`, "rectangular");

    expect(harness.at(["rules", 0, "excludes", "left"])).toEqual({ kind: "complexLiteral", re: 3, im: 4, unit: {} });
    harness.destroy();
  });
});

describe("a predicate", () => {
  it("gets all its operands back after it is switched to a kind with two and back", () => {
    const condition: Json = { kind: "allOf", operands: [exists(OS), exists(ARCH), { kind: "textCompare", op: "equals", left: OS, right: { kind: "textLiteral", value: "linux" } }] };
    const harness = new Harness(ruleModel(condition));
    harness.choose("rules.0.excludes:kind", "and");
    expect(harness.at(["rules", 0, "excludes", "kind"])).toBe("and");
    harness.choose("rules.0.excludes:kind", "allOf");

    expect(harness.at(["rules", 0, "excludes"])).toEqual(condition);
    harness.destroy();
  });

  it("gets its second operand back after it is switched to not and back", () => {
    const condition: Json = { kind: "and", left: exists(OS), right: exists(ARCH) };
    const harness = new Harness(ruleModel(condition));
    harness.choose("rules.0.excludes:kind", "not");
    harness.choose("rules.0.excludes:kind", "and");

    expect(harness.at(["rules", 0, "excludes"])).toEqual(condition);
    harness.destroy();
  });
});

describe("a rule's form", () => {
  const IMPLIES: Json = [exists(OS), { kind: "textCompare", op: "equals", left: ARCH, right: { kind: "textLiteral", value: "x64" } }];

  it("gets its consequent back after it is switched from implies and back", () => {
    const harness = new Harness(modelOf({ dimensions: [{ kind: "choice", name: "os", values: ["linux"] }, { kind: "choice", name: "arch", values: ["x64"] }], rules: [{ name: "r", implies: IMPLIES }] }));
    harness.choose("rules.0:form", "excludes");
    expect(harness.at(["rules", 0, "excludes"])).toEqual(exists(OS));
    harness.choose("rules.0:form", "implies");

    expect(harness.at(["rules", 0])).toEqual({ name: "r", implies: IMPLIES });
    harness.destroy();
  });

  it("keeps an edit of the condition through requires and excludes, which state the same condition", () => {
    const harness = new Harness(ruleModel(exists(OS)));
    harness.choose("rules.0:form", "requires");
    harness.choose("rules.0.requires:kind", "not");
    harness.choose("rules.0:form", "excludes");

    expect(harness.at(["rules", 0])).toEqual({ excludes: { kind: "not", operand: exists(OS) } });
    harness.destroy();
  });

  it("gets back the pair it had after a trip through both single forms", () => {
    const harness = new Harness(modelOf({ dimensions: [{ kind: "choice", name: "os", values: ["linux"] }, { kind: "choice", name: "arch", values: ["x64"] }], rules: [{ implies: IMPLIES }] }));
    harness.choose("rules.0:form", "excludes");
    harness.choose("rules.0:form", "requires");
    harness.choose("rules.0:form", "implies");

    expect(harness.at(["rules", 0])).toEqual({ implies: IMPLIES });
    harness.destroy();
  });

  it("does not keep a rule's label or scope in what it remembers of its form", () => {
    const harness = new Harness(modelOf({ dimensions: [{ kind: "choice", name: "os", values: ["linux"] }], rules: [{ name: "first", excludes: exists(OS) }] }));
    harness.choose("rules.0:form", "implies");
    harness.type("rules.0:name", "renamed");
    harness.choose("rules.0:form", "excludes");

    expect(harness.at(["rules", 0, "name"])).toBe("renamed");
    harness.destroy();
  });
});
