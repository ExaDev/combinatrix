import fc from "fast-check";
import { PredicateNodeSchema } from "trilean";
import { describe, expect, it } from "vitest";

import { execute } from "./engine";
import { unreachable } from "./exhaustive";
import { stateFromModel, stateFromText } from "./editorState";
import type { Json, JsonObject } from "./json";
import { getIn, isJsonArray, isJsonObject } from "./json";
import { budgetFor } from "../../test/budget";
import { anyPredicateArb, jsonArb, MAX_DOMAIN, MAX_NAME, MAX_TEXT, NUMBER_RANGE } from "./treeArbitraries";
import type { DimensionKind, RuleForm } from "./modelEdit";
import { addDimension, addRule, addValue, classifyDimension, classifyRule, EMPTY_MODEL, moveDimension, moveRule, moveValue, removeDimension, removeRule, renameDimension, setActiveWhen, setDimensionKind, setRuleForm, setRuleName, setRuleScope, setValue, viewOfModel } from "./modelEdit";
import { classifyExpression, classifyPredicate } from "./nodes";

/** How many generated models each property is checked against, and the seed that makes a failure reproducible. */
const RUNS = 150;
/** The time one generated case may take a test, in milliseconds: at least two hundred times what the slowest test takes per case on an idle machine, so a machine under heavy load still passes and only a case that stops terminating fails. */
const CASE_BUDGET_MS = 100;
/** The options of a test that checks `RUNS` generated cases. */
const EVERY_CASE = budgetFor(RUNS, CASE_BUDGET_MS);
const SEED = 20_261_029;
const MAX_DIMENSIONS = 4;
const MAX_DEPTH = 3;
const MAX_RULES = 3;
const MAX_STEPS = 12;

type DomainType = "text" | "number" | "boolean";

interface GeneratedDimension {
  readonly name: string;
  readonly type: DomainType;
  readonly values: readonly (string | number | boolean)[];
}

const reference = (key: string): Json => ({ kind: "reference", key });

function domainArb(type: DomainType): fc.Arbitrary<readonly (string | number | boolean)[]> {
  if (type === "text") return fc.uniqueArray(fc.string({ minLength: 1, maxLength: MAX_TEXT }), { minLength: 1, maxLength: MAX_DOMAIN });
  if (type === "number") return fc.uniqueArray(fc.integer({ min: -NUMBER_RANGE, max: NUMBER_RANGE }), { minLength: 1, maxLength: MAX_DOMAIN });

  return fc.uniqueArray(fc.boolean(), { minLength: 1, maxLength: 2 });
}

/** Dimensions named d0, d1 and so on, each with a domain of one type. */
const dimensionsArb: fc.Arbitrary<readonly GeneratedDimension[]> = fc
  .array(fc.constantFrom<DomainType>("text", "number", "boolean"), { minLength: 1, maxLength: MAX_DIMENSIONS })
  .chain((types) => fc.tuple(...types.map((type) => domainArb(type))).map((domains) => types.map((type, index) => ({ name: `d${String(index)}`, type, values: domains[index] ?? [] }))));

function literal(value: string | number | boolean): Json {
  if (typeof value === "string") return { kind: "textLiteral", value };

  return typeof value === "number" ? { kind: "numberLiteral", value } : { kind: "booleanLiteral", value };
}

/** A test of one dimension's value that the library accepts: it compares only values the dimension can take. */
function leafArb(dimension: GeneratedDimension): fc.Arbitrary<Json> {
  const value = fc.constantFrom(...dimension.values);
  const exists = fc.constant<Json>({ kind: "exists", operand: reference(dimension.name) });
  const member = fc.tuple(fc.constantFrom("in", "notIn"), fc.array(value, { minLength: 1, maxLength: MAX_DOMAIN })).map(([op, candidates]): Json => ({ kind: "memberOf", op, operand: reference(dimension.name), candidates: candidates.map(literal) }));
  if (dimension.type === "text") return fc.oneof(exists, member, fc.tuple(fc.constantFrom("equals", "notEquals"), value).map(([op, chosen]): Json => ({ kind: "textCompare", op, left: reference(dimension.name), right: literal(chosen) })));
  if (dimension.type === "number") return fc.oneof(exists, member, fc.tuple(fc.constantFrom("gt", "gte", "lt", "lte", "eq", "neq"), value).map(([op, chosen]): Json => ({ kind: "compare", op, left: reference(dimension.name), right: literal(chosen) })));

  return fc.oneof(exists, member);
}

function predicateArb(dimensions: readonly GeneratedDimension[], depth: number): fc.Arbitrary<Json> {
  const leaf = fc.constantFrom(...dimensions).chain(leafArb);
  if (depth === 0) return leaf;
  const child = predicateArb(dimensions, depth - 1);

  return fc.oneof(
    leaf,
    child.map((operand): Json => ({ kind: "not", operand })),
    fc.tuple(fc.constantFrom("and", "or"), child, child).map(([kind, left, right]): Json => ({ kind, left, right })),
    fc.tuple(fc.constantFrom("allOf", "anyOf"), fc.array(child, { minLength: 1, maxLength: MAX_DOMAIN })).map(([kind, operands]): Json => ({ kind, operands })),
  );
}

function ruleArb(dimensions: readonly GeneratedDimension[]): fc.Arbitrary<Json> {
  const condition = predicateArb(dimensions, MAX_DEPTH);
  const scope = fc.record({ name: fc.option(fc.string({ maxLength: MAX_TEXT }), { nil: undefined }), when: fc.option(condition, { nil: undefined }), unless: fc.option(condition, { nil: undefined }) });
  const body = fc.oneof(
    fc.tuple(fc.constantFrom("requires", "excludes"), condition).map(([form, stated]): [string, Json] => [form, stated]),
    fc.tuple(condition, condition).map(([antecedent, consequent]): [string, Json] => ["implies", [antecedent, consequent]]),
  );

  return fc.tuple(body, scope).map(([[form, stated], extras]): Json => ({ [form]: stated, ...Object.fromEntries(Object.entries(extras).filter((entry): entry is [string, Json] => entry[1] !== undefined)) }));
}

/** Models the library accepts: free dimensions first, then conditional ones whose activity depends on those, and rules about the free ones. */
const validModelArb: fc.Arbitrary<JsonObject> = dimensionsArb.chain((free) => {
  const conditional = fc.array(fc.tuple(fc.constantFrom<DimensionKind>("choice", "first-valid"), predicateArb(free, 1), domainArb("text")), { maxLength: MAX_DIMENSIONS - 1 });

  return fc.tuple(conditional, fc.array(ruleArb(free), { maxLength: MAX_RULES }), fc.boolean()).map(([extra, rules, includeRules]): JsonObject => {
    const freeDimensions: Json[] = free.map((dimension) => ({ kind: "choice", name: dimension.name, values: dimension.values }));
    const conditionalDimensions: Json[] = extra.map(([kind, activeWhen, values], index) => ({ kind, name: `c${String(index)}`, [kind === "choice" ? "values" : "candidates"]: values, activeWhen }));

    return includeRules || rules.length > 0 ? { dimensions: [...freeDimensions, ...conditionalDimensions], rules } : { dimensions: [...freeDimensions, ...conditionalDimensions] };
  });
});

/** Whether every node of a tree is one the form builds. */
function structuredPredicate(node: Json): boolean {
  const view = classifyPredicate(node);
  switch (view.kind) {
    case "not":
      return structuredPredicate(view.operand);
    case "and":
    case "or":
      return structuredPredicate(view.left) && structuredPredicate(view.right);
    case "allOf":
    case "anyOf":
      return view.operands.every(structuredPredicate);
    case "compare":
    case "textCompare":
      return structuredExpression(view.left) && structuredExpression(view.right);
    case "memberOf":
      return structuredExpression(view.operand) && view.candidates.every(structuredExpression);
    case "exists":
      return structuredExpression(view.operand);
    case "some":
    case "every":
      return structuredPredicate(view.item) && (view.filter === undefined || structuredPredicate(view.filter));
    case "treeReference":
      return true;
    case "raw":
      return false;
    default:
      return unreachable(view);
  }
}

function structuredExpression(node: Json): boolean {
  const view = classifyExpression(node);
  switch (view.kind) {
    case "arithmetic":
      return structuredExpression(view.left) && structuredExpression(view.right);
    case "negate":
      return structuredExpression(view.operand);
    case "conditional":
      return view.cases.every((item) => structuredPredicate(item.when) && structuredExpression(item.then)) && structuredExpression(view.fallback);
    case "call":
      return view.args.every(structuredExpression);
    case "lookup":
      return view.keys.every(structuredExpression);
    case "fold":
      return (view.filter === undefined || structuredPredicate(view.filter)) && (view.combiner.mode === "reduce" ? structuredExpression(view.combiner.initial) && structuredExpression(view.combiner.combine) : structuredExpression(view.combiner.item));
    case "raw":
      return false;
    case "accumulator":
    case "delegate":
    case "treeReference":
    case "textLiteral":
    case "instantLiteral":
    case "numberLiteral":
    case "booleanLiteral":
    case "durationLiteral":
    case "complexLiteral":
    case "reference":
      return true;
    default:
      return unreachable(view);
  }
}

function everythingStructured(model: JsonObject): boolean {
  const view = viewOfModel(model);
  const dimensions = view.dimensions.every((dimension) => dimension.kind === "dimension" && (dimension.activeWhen === undefined || structuredPredicate(dimension.activeWhen)));
  const rules = (view.rules ?? []).every((rule) => {
    if (rule.kind === "raw") return false;
    const conditions = rule.body.form === "implies" ? [rule.body.antecedent, rule.body.consequent] : [rule.body.condition];

    return [...conditions, ...[rule.when, rule.unless].filter((condition) => condition !== undefined)].every(structuredPredicate);
  });

  return dimensions && rules;
}

/** A model through its text and back, as the editor does between the form and the JSON view. */
function throughText(model: JsonObject): JsonObject {
  return stateFromText(stateFromModel(model).text, stateFromModel(EMPTY_MODEL)).model;
}

describe("trees of every kind the schema defines", () => {
  it("are accepted by trilean's schema, which keeps the properties below about real trees", EVERY_CASE, () => {
    fc.assert(
      fc.property(anyPredicateArb(MAX_DEPTH), (tree) => {
        expect(PredicateNodeSchema.safeParse(tree).success).toBe(true);
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });

  it("are read by the form with no raw node anywhere in them, and survive the text round trip unchanged", EVERY_CASE, () => {
    fc.assert(
      fc.property(anyPredicateArb(MAX_DEPTH), (tree) => {
        expect(structuredPredicate(tree)).toBe(true);
        const model: JsonObject = { dimensions: [], rules: [{ excludes: tree }] };

        expect(throughText(model)).toEqual(model);
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });

  it("are unchanged by renaming a dimension and then renaming it back", EVERY_CASE, () => {
    fc.assert(
      fc.property(anyPredicateArb(MAX_DEPTH), (tree) => {
        const model: JsonObject = { dimensions: [{ kind: "choice", name: "a", values: ["x"] }], rules: [{ excludes: tree }] };

        expect(renameDimension(renameDimension(model, 0, "b"), 0, "a")).toEqual(model);
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });
});

describe("generated models", () => {
  it("are accepted by the library, which keeps the properties below about real models", EVERY_CASE, () => {
    fc.assert(
      fc.property(validModelArb, (model) => {
        expect(execute({ op: "validate", model: JSON.stringify(model) })).toMatchObject({ ok: true });
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });

  it("are shown by the form with nothing raw, and are unchanged by form state to model to JSON to parseModel to form state", EVERY_CASE, () => {
    fc.assert(
      fc.property(validModelArb, (model) => {
        const text = stateFromModel(model).text;
        const reread = stateFromText(text, stateFromModel(EMPTY_MODEL));

        expect(reread.problem).toBeUndefined();
        expect(reread.model).toEqual(model);
        expect(everythingStructured(model)).toBe(true);
        expect(viewOfModel(reread.model)).toEqual(viewOfModel(model));
        expect(execute({ op: "validate", model: text })).toMatchObject({ ok: true });
        expect(stateFromModel(reread.model).text).toBe(text);
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });
});

describe("changing the kind of a part", () => {
  it("keeps a rule's label, when and unless, and its condition between requires and excludes", EVERY_CASE, () => {
    fc.assert(
      fc.property(validModelArb, fc.constantFrom<RuleForm>("requires", "excludes", "implies"), (model, form) => {
        for (const [index, before] of (viewOfModel(model).rules ?? []).entries()) {
          const after = (viewOfModel(setRuleForm(model, index, form)).rules ?? [])[index];
          if (before.kind !== "rule" || after?.kind !== "rule") throw new Error("the generated rules are all structured");

          expect({ name: after.name, when: after.when, unless: after.unless }).toEqual({ name: before.name, when: before.when, unless: before.unless });
          expect(after.body.form).toBe(form);
          if (before.body.form !== "implies" && after.body.form !== "implies") expect(after.body.condition).toEqual(before.body.condition);
        }
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });

  it("keeps a dimension's name, activity condition and values", EVERY_CASE, () => {
    fc.assert(
      fc.property(validModelArb, fc.constantFrom<DimensionKind>("choice", "first-valid"), (model, kind) => {
        for (const [index, before] of viewOfModel(model).dimensions.entries()) {
          const after = viewOfModel(setDimensionKind(model, index, kind)).dimensions[index];
          if (before.kind !== "dimension" || after?.kind !== "dimension") throw new Error("the generated dimensions are all structured");

          expect({ name: after.name, activeWhen: after.activeWhen, values: after.values }).toEqual({ name: before.name, activeWhen: before.activeWhen, values: before.values });
          expect(after.dimensionKind).toBe(kind);
        }
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });
});

describe("constructs the form cannot show", () => {
  /** A model with a dimension, a rule and a top-level key, each of arbitrary JSON, among the parts the form does edit. */
  const strangeModelArb: fc.Arbitrary<JsonObject> = fc.tuple(jsonArb, jsonArb, jsonArb, jsonArb).map(([dimension, rule, extra, node]) => ({
    dimensions: [{ kind: "choice", name: "a", values: ["x"] }, dimension, { kind: "computed", name: "c", reads: ["a"] }],
    rules: [rule, { excludes: { kind: "and", left: node, right: { kind: "mystery", collection: "a", item: { kind: "reference", key: "a" } } } }, { requires: { kind: "exists", operand: reference("a") }, because: extra }],
    extra,
  }));

  it("survive the text round trip deep-equal", EVERY_CASE, () => {
    fc.assert(
      fc.property(strangeModelArb, (model) => {
        const state = stateFromText(JSON.stringify(model), stateFromModel(EMPTY_MODEL));

        expect(state.problem).toBeUndefined();
        expect(state.model).toEqual(model);
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });

  it("survive every edit of the parts around them", EVERY_CASE, () => {
    fc.assert(
      fc.property(strangeModelArb, (model) => {
        const dimensions = viewOfModel(model).dimensions.length;
        const rules = viewOfModel(model).rules?.length ?? 0;
        const grown = addRule(addDimension(model));

        expect(removeRule(removeDimension(grown, dimensions), rules)).toEqual(model);
        for (let index = 0; index < dimensions - 1; index += 1) expect(moveDimension(moveDimension(model, index, "later"), index + 1, "earlier")).toEqual(model);
        for (let index = 0; index < rules - 1; index += 1) expect(moveRule(moveRule(model, index, "later"), index + 1, "earlier")).toEqual(model);
        expect(renameDimension(model, 0, "z")).toMatchObject({ extra: model["extra"] });
        expect(addValue(model, 0)["rules"]).toEqual(model["rules"]);
        expect(setActiveWhen(model, 0, undefined)["dimensions"]).toEqual(model["dimensions"]);
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });
});

/** One edit the form can make, by the position it applies to, which is taken modulo the length of what it applies to. */
type Step =
  | { readonly op: "addDimension"; readonly kind: DimensionKind }
  | { readonly op: "moveDimension"; readonly at: number; readonly later: boolean }
  | { readonly op: "setKind"; readonly at: number; readonly kind: DimensionKind }
  | { readonly op: "rename"; readonly at: number; readonly name: string }
  | { readonly op: "addValue"; readonly at: number }
  | { readonly op: "setValue"; readonly at: number; readonly position: number; readonly value: string | number | boolean | null }
  | { readonly op: "moveValue"; readonly at: number; readonly position: number; readonly later: boolean }
  | { readonly op: "setActiveWhen"; readonly at: number; readonly node: Json | undefined }
  | { readonly op: "addRule" }
  | { readonly op: "moveRule"; readonly at: number; readonly later: boolean }
  | { readonly op: "setRuleForm"; readonly at: number; readonly form: RuleForm }
  | { readonly op: "setRuleName"; readonly at: number; readonly name: string | undefined }
  | { readonly op: "setRuleScope"; readonly at: number; readonly scope: "when" | "unless"; readonly node: Json | undefined };

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ op: fc.constant("addDimension" as const), kind: fc.constantFrom<DimensionKind>("choice", "first-valid") }),
  fc.record({ op: fc.constant("moveDimension" as const), at: fc.nat(), later: fc.boolean() }),
  fc.record({ op: fc.constant("setKind" as const), at: fc.nat(), kind: fc.constantFrom<DimensionKind>("choice", "first-valid") }),
  fc.record({ op: fc.constant("rename" as const), at: fc.nat(), name: fc.stringMatching(new RegExp(`^[a-z]{1,${String(MAX_NAME)}}$`)) }),
  fc.record({ op: fc.constant("addValue" as const), at: fc.nat() }),
  fc.record({ op: fc.constant("setValue" as const), at: fc.nat(), position: fc.nat(), value: fc.oneof(fc.string({ maxLength: MAX_TEXT }), fc.integer(), fc.boolean(), fc.constant(null)) }),
  fc.record({ op: fc.constant("moveValue" as const), at: fc.nat(), position: fc.nat(), later: fc.boolean() }),
  fc.record({ op: fc.constant("setActiveWhen" as const), at: fc.nat(), node: fc.option(jsonArb, { nil: undefined }) }),
  fc.record({ op: fc.constant("addRule" as const) }),
  fc.record({ op: fc.constant("moveRule" as const), at: fc.nat(), later: fc.boolean() }),
  fc.record({ op: fc.constant("setRuleForm" as const), at: fc.nat(), form: fc.constantFrom<RuleForm>("requires", "excludes", "implies") }),
  fc.record({ op: fc.constant("setRuleName" as const), at: fc.nat(), name: fc.option(fc.string({ maxLength: MAX_TEXT }), { nil: undefined }) }),
  fc.record({ op: fc.constant("setRuleScope" as const), at: fc.nat(), scope: fc.constantFrom("when" as const, "unless" as const), node: fc.option(jsonArb, { nil: undefined }) }),
);

/** The positions in a model's dimensions the form can edit, or in its rules. */
function editable(model: JsonObject, part: "dimensions" | "rules"): number[] {
  const items = model[part];
  if (items === undefined || !isJsonArray(items)) return [];

  return items.flatMap((item, index) => ((part === "dimensions" ? classifyDimension(item) : classifyRule(item)).kind === "raw" ? [] : [index]));
}

function pick(positions: readonly number[], at: number): number | undefined {
  return positions.length === 0 ? undefined : positions[at % positions.length];
}

/** Applies a step to the part of the model it names, or leaves the model alone when it names nothing the form can edit. */
function apply(model: JsonObject, step: Step): JsonObject {
  const dimension = "at" in step ? pick(editable(model, "dimensions"), step.at) : undefined;
  const rule = "at" in step ? pick(editable(model, "rules"), step.at) : undefined;
  const direction = (later: boolean): "later" | "earlier" => (later ? "later" : "earlier");
  switch (step.op) {
    case "addDimension":
      return addDimension(model, step.kind);
    case "addRule":
      return addRule(model);
    case "moveDimension":
      return dimension === undefined ? model : moveDimension(model, dimension, direction(step.later));
    case "setKind":
      return dimension === undefined ? model : setDimensionKind(model, dimension, step.kind);
    case "rename":
      return dimension === undefined ? model : renameDimension(model, dimension, step.name);
    case "addValue":
      return dimension === undefined ? model : addValue(model, dimension);
    case "setValue":
    case "moveValue": {
      const shown = dimension === undefined ? undefined : classifyDimension(getIn(model, ["dimensions", dimension]) ?? null);
      if (dimension === undefined || shown?.kind !== "dimension" || shown.values.length === 0) return model;
      const position = step.position % shown.values.length;

      return step.op === "setValue" ? setValue(model, dimension, position, step.value) : moveValue(model, dimension, position, direction(step.later));
    }
    case "setActiveWhen":
      return dimension === undefined ? model : setActiveWhen(model, dimension, step.node);
    case "moveRule":
      return rule === undefined ? model : moveRule(model, rule, direction(step.later));
    case "setRuleForm":
      return rule === undefined ? model : setRuleForm(model, rule, step.form);
    case "setRuleName":
      return rule === undefined ? model : setRuleName(model, rule, step.name);
    case "setRuleScope":
      return rule === undefined ? model : setRuleScope(model, rule, step.scope, step.node);
    default:
      return unreachable(step);
  }
}

describe("edit sequences", () => {
  const OPAQUE: Json = { kind: "some", collection: "os", item: { kind: "exists", operand: reference("os") } };
  const START: JsonObject = {
    dimensions: [
      { kind: "computed", name: "target", reads: ["os"] },
      { kind: "choice", name: "os", values: ["linux", "windows"] },
      { kind: "choice", name: "arch", values: ["x64"] },
    ],
    rules: [
      { requires: { kind: "and", left: OPAQUE, right: { kind: "exists", operand: reference("os") } }, unrecognised: 1 },
      { excludes: { kind: "and", left: OPAQUE, right: { kind: "exists", operand: reference("os") } } },
    ],
  };

  it("leave a model whose text reads back to the same model and the same form, with every construct the form cannot show still in it", EVERY_CASE, () => {
    fc.assert(
      fc.property(fc.array(stepArb, { maxLength: MAX_STEPS }), (steps) => {
        let model = START;
        for (const step of steps) {
          model = apply(model, step);
          const reread = throughText(model);

          expect(reread).toEqual(model);
          expect(viewOfModel(reread)).toEqual(viewOfModel(model));
        }
        const text = JSON.stringify(model);

        expect(text).toContain(JSON.stringify({ kind: "computed", name: "target", reads: ["os"] }));
        expect(text).toContain(JSON.stringify(OPAQUE));
        expect(text).toContain('"unrecognised":1');
        expect(isJsonObject(model)).toBe(true);
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });
});

describe("sanity of the generators", () => {
  it("produce models with every kind of dimension and rule form across a sample", EVERY_CASE, () => {
    const sample = fc.sample(validModelArb, { numRuns: RUNS, seed: SEED });
    const forms = new Set(sample.flatMap((model) => (viewOfModel(model).rules ?? []).map((rule) => (rule.kind === "rule" ? rule.body.form : "raw"))));
    const kinds = new Set(sample.flatMap((model) => viewOfModel(model).dimensions.map((dimension) => (dimension.kind === "dimension" ? dimension.dimensionKind : "raw"))));

    expect([...forms].toSorted()).toEqual(["excludes", "implies", "requires"]);
    expect([...kinds].toSorted()).toEqual(["choice", "first-valid"]);
  });
});
