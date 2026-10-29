// @vitest-environment jsdom
import fc from "fast-check";
import { ExpressionNodeSchema, PredicateNodeSchema } from "trilean";
import { describe, expect, it } from "vitest";

import { ChoiceDimensionSchema, FirstValidDimensionSchema, ModelSchema, RuleSchema } from "../../scripts/json-schema";
import type { TreeContext } from "./controls";
import { ModelForm } from "./form";
import type { Json, JsonObject } from "./json";
import { getIn, isJsonObject } from "./json";
import { DIMENSION_KINDS, DOMAIN_KEYS } from "./modelEdit";
import { createExpression, createPredicate, EXPRESSION_KINDS, PREDICATE_KINDS } from "./nodes";
import { anyExpressionArb, anyPredicateArb } from "./treeArbitraries";
import { expressionNode, predicateNode } from "./treeForm";

/** How many trees are generated to find nodes of each kind, how many of a kind are drawn (drawing costs a DOM per node), how deep the trees go, and the seed that makes a failure reproducible. */
const SAMPLES = 600;
const NODES_PER_KIND = 10;
const DEPTH = 1;
const SEED = 20_261_029;

/** Applies each edit to a model and draws the form again, as the page does. */
class Harness {
  model: JsonObject;

  readonly container = document.createElement("div");

  readonly form: ModelForm;

  constructor(model: JsonObject) {
    this.model = model;
    document.body.append(this.container);
    this.form = new ModelForm(this.container, {
      edit: (change, options) => {
        this.model = change(this.model);
        this.form.render(this.model, options?.focus);
      },
      editQuietly: (change) => {
        this.model = change(this.model);
      },
    });
    this.form.render(this.model);
  }

  /** The control with a field id. */
  field(id: string): HTMLElement {
    const found = [...this.container.querySelectorAll<HTMLElement>("[data-field]")].find((element) => element.dataset["field"] === id);
    if (found === undefined) throw new Error(`no control ${id}; the controls are ${this.fields().join(", ")}`);

    return found;
  }

  fields(): string[] {
    return [...this.container.querySelectorAll<HTMLElement>("[data-field]")].map((element) => element.dataset["field"] ?? "");
  }

  click(id: string): void {
    this.field(id).click();
  }

  choose(id: string, value: string): void {
    const element = this.field(id);
    if (!(element instanceof HTMLSelectElement)) throw new Error(`${id} is not a menu`);
    element.value = value;
    element.dispatchEvent(new Event("change"));
  }

  type(id: string, text: string): void {
    const element = this.field(id);
    if (!(element instanceof HTMLInputElement)) throw new Error(`${id} is not a text box`);
    element.value = text;
    element.dispatchEvent(new Event("input"));
    element.dispatchEvent(new Event("change"));
  }

  at(path: readonly (string | number)[]): Json | undefined {
    return getIn(this.model, path);
  }

  destroy(): void {
    this.container.remove();
  }
}

function contextOf(): TreeContext {
  return { names: ["os", "arch"], host: { edit: () => undefined, editQuietly: () => undefined } };
}

/** Whether some control of a node at `base` is for the schema key `key`: its own field (`base:key`), or one of a part of it (`base.key:` and `base.key.`). */
function covers(fields: readonly string[], base: string, key: string): boolean {
  return fields.some((field) => field === `${base}:${key}` || field.startsWith(`${base}.${key}:`) || field.startsWith(`${base}.${key}.`));
}

/** The keys of a schema object, with whether each may be absent: zod says so by accepting `undefined`. */
function keysOfShape(shape: Readonly<Record<string, { safeParse: (value: unknown) => { success: boolean } }>>): { key: string; optional: boolean }[] {
  return Object.entries(shape).map(([key, schema]) => ({ key, optional: schema.safeParse(undefined).success }));
}

/** The keys of the schema option of a kind that a node has the form of; a kind with two forms (the complex literal) has two options, and the node is held to the one whose keys include its own. */
function optionsFor(options: readonly { readonly shape: Readonly<Record<string, never>> & { readonly kind: { readonly value: string } } }[], kind: string, node: Json): readonly { key: string; optional: boolean }[] {
  const forms = options.filter((option) => option.shape.kind.value === kind).map((option) => keysOfShape(option.shape as never));
  const own = typeof node === "object" && node !== null && !Array.isArray(node) ? Object.keys(node) : [];
  const [first] = forms.filter((keys) => own.every((key) => keys.some((entry) => entry.key === key)));
  if (first === undefined) throw new Error(`the schema has no form of ${kind} for ${JSON.stringify(node)}`);

  return first;
}

/** The nodes of each kind among generated trees: the root of every sampled tree that has the kind. */
function sampleByKind(arbitrary: fc.Arbitrary<Json>, kinds: readonly string[]): Map<string, Json[]> {
  const byKind = new Map<string, Json[]>(kinds.map((kind) => [kind, []]));
  for (const node of fc.sample(arbitrary, { numRuns: SAMPLES, seed: SEED })) {
    const kind = isJsonObject(node) ? node["kind"] : undefined;
    const found = typeof kind === "string" ? byKind.get(kind) : undefined;
    if (found !== undefined && found.length < NODES_PER_KIND) found.push(node);
  }

  return byKind;
}

describe("every predicate kind of the schema has a widget", () => {
  const byKind = sampleByKind(anyPredicateArb(DEPTH), PREDICATE_KINDS);

  it.each(PREDICATE_KINDS)("%s: is drawn with its kind chosen, every control its schema keys need and no raw JSON box", (kind) => {
    const nodes = [createPredicate(kind, ctxNames()), ...(byKind.get(kind) ?? [])];
    expect(nodes.length).toBeGreaterThan(1);
    for (const node of nodes) {
      const drawn = predicateNode(contextOf(), { path: ["n"], node, label: "n" });
      document.body.append(drawn);
      const fields = [...drawn.querySelectorAll<HTMLElement>("[data-field]")].map((element) => element.dataset["field"] ?? "");
      const chosen = drawn.querySelector<HTMLSelectElement>('[data-field="n:kind"]');

      expect(chosen?.value).toBe(kind);
      expect(drawn.querySelector("textarea.raw-json")).toBeNull();
      expect(drawn.textContent).not.toContain("Not a node the schema accepts");
      expect(new Set(fields).size).toBe(fields.length);
      for (const { key, optional } of optionsFor(PredicateNodeSchema.options as never, kind, node)) {
        if (key === "kind") continue;
        const present = isJsonObject(node) && key in node;
        if (present || !optional) expect(covers(fields, "n", key), `${kind}: a control for ${key} in ${JSON.stringify(node)}`).toBe(true);
        else expect(covers(fields, "n", key) || fields.includes(`n.${key}:add`), `${kind}: a way to set or add ${key}`).toBe(true);
      }
      drawn.remove();
    }
  });

  it("offers each kind in the menu of a node, and every kind of the schema is in the sampled set", () => {
    const drawn = predicateNode(contextOf(), { path: ["n"], node: createPredicate("exists", ctxNames()), label: "n" });
    const options = [...(drawn.querySelector<HTMLSelectElement>('[data-field="n:kind"]')?.options ?? [])].map((option) => option.value);

    expect(options.toSorted()).toEqual([...new Set(PredicateNodeSchema.options.map((option) => option.shape.kind.value))].toSorted());
  });
});

describe("every expression kind of the schema has a widget", () => {
  const byKind = sampleByKind(anyExpressionArb(DEPTH), EXPRESSION_KINDS);
  const [core, complex] = ExpressionNodeSchema.options;
  const schemaOptions = [...core.options, ...complex.options];

  it.each(EXPRESSION_KINDS)("%s: is drawn with its kind chosen, every control its schema keys need and no raw JSON box", (kind) => {
    const nodes = [createExpression(kind, ctxNames()), ...(byKind.get(kind) ?? [])];
    expect(nodes.length).toBeGreaterThan(1);
    for (const node of nodes) {
      const drawn = expressionNode(contextOf(), { path: ["n"], node, label: "n" });
      document.body.append(drawn);
      const fields = [...drawn.querySelectorAll<HTMLElement>("[data-field]")].map((element) => element.dataset["field"] ?? "");

      expect(drawn.querySelector<HTMLSelectElement>('[data-field="n:kind"]')?.value).toBe(kind);
      expect(drawn.querySelector("textarea.raw-json")).toBeNull();
      expect(drawn.textContent).not.toContain("Not a node the schema accepts");
      expect(new Set(fields).size).toBe(fields.length);
      for (const { key, optional } of optionsFor(schemaOptions as never, kind, node)) {
        if (key === "kind") continue;
        const present = isJsonObject(node) && key in node;
        if (present || !optional) expect(covers(fields, "n", key), `${kind}: a control for ${key} in ${JSON.stringify(node)}`).toBe(true);
        else expect(covers(fields, "n", key) || fields.includes(`n.${key}:add`), `${kind}: a way to set or add ${key}`).toBe(true);
      }
      drawn.remove();
    }
  });
});

describe("every dimension kind and rule form of the schema has a widget", () => {
  const dimensionOptions = [ChoiceDimensionSchema, FirstValidDimensionSchema];

  it("lists the dimension kinds the model schema defines, and no other", () => {
    expect([...DIMENSION_KINDS].toSorted()).toEqual(dimensionOptions.map((option) => option.shape.kind.value).toSorted());
    const modelKinds = ModelSchema.shape.dimensions.element.options.map((option) => option.shape.kind.value);

    expect([...DIMENSION_KINDS].toSorted()).toEqual([...modelKinds].toSorted());
  });

  it.each(DIMENSION_KINDS)("%s: is drawn with every control its schema keys need and no raw JSON box", (kind) => {
    const option = dimensionOptions.find((candidate) => candidate.shape.kind.value === kind);
    if (option === undefined) throw new Error(`the schema has no ${kind} dimension`);
    expect(Object.keys(option.shape)).toContain(DOMAIN_KEYS[kind]);
    for (const withActivity of [false, true]) {
      const dimension: JsonObject = { kind, name: "d", [DOMAIN_KEYS[kind]]: ["x"], ...(withActivity ? { activeWhen: createPredicate("exists", ["d"]) } : {}) };
      const harness = new Harness({ dimensions: [dimension] });
      const fields = harness.fields();

      expect(harness.field("dimensions.0:kind")).toHaveProperty("value", kind);
      expect(harness.container.querySelector("textarea.raw-json")).toBeNull();
      for (const { key, optional } of keysOfShape(option.shape)) {
        if (key === "kind") continue;
        if (!optional || withActivity) expect(covers(fields, "dimensions.0", key), `${kind}: a control for ${key}`).toBe(true);
        else expect(fields).toContain(`dimensions.0.${key}:add`);
      }
      harness.destroy();
    }
  });

  it("draws each rule form of the schema, with the keys it has and the scope that can be added", () => {
    for (const option of RuleSchema.options) {
      const form = Object.keys(option.shape).find((key) => key === "requires" || key === "excludes" || key === "implies");
      if (form === undefined) throw new Error("a rule form of the schema has none of requires, excludes, implies");
      const stated: Json = form === "implies" ? [createPredicate("exists", ["d"]), createPredicate("exists", ["d"])] : createPredicate("exists", ["d"]);
      const harness = new Harness({ dimensions: [{ kind: "choice", name: "d", values: ["x"] }], rules: [{ [form]: stated }] });
      const fields = harness.fields();

      expect(harness.container.querySelector("textarea.raw-json")).toBeNull();
      for (const { key, optional } of keysOfShape(option.shape)) {
        if (!optional) expect(covers(fields, "rules.0", key), `${form}: a control for ${key}`).toBe(true);
        else expect(covers(fields, "rules.0", key), `${form}: a way to set ${key}`).toBe(true);
      }
      harness.destroy();
    }
  });
});

function ctxNames(): string[] {
  return ["os", "arch"];
}

describe("editing a JSON value", () => {
  const MODEL: JsonObject = {
    dimensions: [{ kind: "choice", name: "d", values: ["x"] }],
    rules: [{ requires: { kind: "some", collection: ["a", { b: 1 }], item: { kind: "exists", operand: { kind: "reference", key: "d" } } } }],
  };
  const COLLECTION = "rules.0.requires.collection";

  it("draws a list and an object as nested editors, not JSON text", () => {
    const harness = new Harness(MODEL);

    expect(harness.field(`${COLLECTION}:type`)).toHaveProperty("value", "list");
    expect(harness.field(`${COLLECTION}.0:type`)).toHaveProperty("value", "text");
    expect(harness.field(`${COLLECTION}.1:type`)).toHaveProperty("value", "object");
    expect(harness.field(`${COLLECTION}.1.b:type`)).toHaveProperty("value", "number");
    expect(harness.container.querySelector("textarea")).toBeNull();
    harness.destroy();
  });

  it("adds, edits, moves and removes list items", () => {
    const harness = new Harness(MODEL);
    harness.click(`${COLLECTION}:add`);
    harness.type(`${COLLECTION}.2:value`, "c");
    harness.click(`${COLLECTION}.2:up`);

    expect(harness.at(["rules", 0, "requires", "collection"])).toEqual(["a", "c", { b: 1 }]);
    harness.click(`${COLLECTION}.0:remove`);

    expect(harness.at(["rules", 0, "requires", "collection"])).toEqual(["c", { b: 1 }]);
    harness.destroy();
  });

  it("changes the type of a value to the nearest value of the new type", () => {
    const harness = new Harness(MODEL);
    harness.choose(`${COLLECTION}.1.b:type`, "text");

    expect(harness.at(["rules", 0, "requires", "collection", 1, "b"])).toBe("1");
    harness.choose(`${COLLECTION}.1.b:type`, "boolean");
    harness.choose(`${COLLECTION}.1.b:value`, "true");

    expect(harness.at(["rules", 0, "requires", "collection", 1, "b"])).toBe(true);
    harness.choose(`${COLLECTION}:type`, "null");

    expect(harness.at(["rules", 0, "requires", "collection"])).toBeNull();
    harness.destroy();
  });

  it("adds, renames, moves and removes object entries, and refuses a key another entry has", () => {
    const harness = new Harness(MODEL);
    const object = `${COLLECTION}.1`;
    harness.click(`${object}:add`);

    expect(harness.at(["rules", 0, "requires", "collection", 1])).toEqual({ b: 1, key: "" });
    harness.type(`${object}.key:key`, "c");

    expect(harness.at(["rules", 0, "requires", "collection", 1])).toEqual({ b: 1, c: "" });
    harness.click(`${object}.c:up`);

    expect(Object.keys(getIn(harness.model, ["rules", 0, "requires", "collection", 1]) as object)).toEqual(["c", "b"]);
    harness.type(`${object}.c:key`, "b");

    expect(harness.at(["rules", 0, "requires", "collection", 1])).toEqual({ c: "", b: 1 });
    expect(harness.container.textContent).toContain("already used by another entry");
    harness.click(`${object}.c:remove`);

    expect(harness.at(["rules", 0, "requires", "collection", 1])).toEqual({ b: 1 });
    harness.destroy();
  });

  it("keeps a key with a dot apart from a path through two keys", () => {
    const harness = new Harness({ dimensions: [], rules: [{ requires: { kind: "treeReference", key: { "a.b": 1, a: { b: 2 } } } }] });
    const fields = harness.fields();

    expect(new Set(fields).size).toBe(fields.length);
    harness.destroy();
  });
});

describe("editing a unit", () => {
  it("adds a unit to a number, edits its symbols and exponents, and removes it", () => {
    const harness = new Harness({ dimensions: [], rules: [{ requires: { kind: "compare", op: "gt", left: { kind: "numberLiteral", value: 1 }, right: { kind: "numberLiteral", value: 2 } } }] });
    const unit = "rules.0.requires.left.unit";
    harness.click(`${unit}:add`);

    expect(harness.at(["rules", 0, "requires", "left"])).toEqual({ kind: "numberLiteral", value: 1, unit: {} });
    harness.click(`${unit}:add`);
    harness.type(`${unit}.symbol:key`, "m");
    harness.type(`${unit}.m:exponent`, "2");
    harness.click(`${unit}:add`);

    expect(harness.at(["rules", 0, "requires", "left", "unit"])).toEqual({ m: 2, symbol: 1 });
    harness.click(`${unit}:remove-unit`);

    expect(harness.at(["rules", 0, "requires", "left"])).toEqual({ kind: "numberLiteral", value: 1 });
    harness.destroy();
  });
});

describe("building the kinds the library refuses", () => {
  it("builds a fold with a filter and each combiner, a call with arguments and a lookup, all through controls", () => {
    const harness = new Harness({ dimensions: [{ kind: "choice", name: "d", values: [1] }], rules: [{ requires: { kind: "exists", operand: { kind: "reference", key: "d" } } }] });
    const operand = "rules.0.requires.operand";
    harness.choose(`${operand}:kind`, "fold");
    harness.type(`${operand}.collection:value`, "xs");
    harness.click(`${operand}.filter:add`);
    harness.choose(`${operand}.combiner:mode`, "reduce");

    expect(harness.at(["rules", 0, "requires", "operand"])).toMatchObject({ kind: "fold", collection: "xs", filter: { kind: "exists" }, combiner: { mode: "reduce", initial: { kind: "numberLiteral" }, combine: { kind: "numberLiteral" } } });
    harness.choose(`${operand}:kind`, "call");
    harness.type(`${operand}.fn:value`, "max");
    harness.click(`${operand}.args:add`);
    harness.choose(`${operand}:kind`, "lookup");

    // The call had the two expressions of the reduce, and one argument was added; the lookup keeps all three.
    expect(harness.at(["rules", 0, "requires", "operand"])).toMatchObject({ kind: "lookup", table: "", keys: [{ kind: "numberLiteral" }, { kind: "numberLiteral" }, { kind: "numberLiteral" }] });
    expect(harness.container.textContent).toContain("The library refuses this kind in a model");
    harness.destroy();
  });
});
