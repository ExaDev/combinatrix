import { ExpressionNodeSchema, PredicateNodeSchema } from "trilean";
import { describe, expect, it } from "vitest";

import { execute } from "./engine";
import type { Json } from "./json";
import {
  changeExpressionKind,
  changeFoldMode,
  changePredicateKind,
  classifyExpression,
  classifyPredicate,
  createExpression,
  createPredicate,
  EXPRESSION_KIND_LABELS,
  EXPRESSION_KINDS,
  PREDICATE_KIND_LABELS,
  PREDICATE_KINDS,
  REFUSED_EXPRESSION_KINDS,
  REFUSED_PREDICATE_KINDS,
} from "./nodes";

const NAMES = ["os", "arch"];
const REFERENCE_OS: Json = { kind: "reference", key: "os" };
const REFERENCE_ARCH: Json = { kind: "reference", key: "arch" };
const TEXT_X: Json = { kind: "textLiteral", value: "x" };

/** Every kind trilean's schemas define, read from the schemas themselves. */
function schemaPredicateKinds(): string[] {
  return PredicateNodeSchema.options.map((option) => option.shape.kind.value);
}

function schemaExpressionKinds(): string[] {
  const [core, complex] = ExpressionNodeSchema.options;

  return [...core.options.map((option) => option.shape.kind.value), ...complex.options.map((option) => option.shape.kind.value)];
}

describe("the kinds the form covers", () => {
  it("lists every predicate kind trilean's schema defines, and every expression kind", () => {
    expect([...PREDICATE_KINDS].toSorted()).toEqual([...new Set(schemaPredicateKinds())].toSorted());
    expect([...EXPRESSION_KINDS].toSorted()).toEqual([...new Set(schemaExpressionKinds())].toSorted());
  });

  it("has a menu label, and a way to create and to read, for each of them", () => {
    expect(Object.keys(PREDICATE_KIND_LABELS).toSorted()).toEqual([...PREDICATE_KINDS].toSorted());
    expect(Object.keys(EXPRESSION_KIND_LABELS).toSorted()).toEqual([...EXPRESSION_KINDS].toSorted());
  });

  it.each(PREDICATE_KINDS)("creates a %s predicate that trilean's schema accepts and the form reads as that kind, not as raw JSON", (kind) => {
    const node = createPredicate(kind, NAMES);

    expect(PredicateNodeSchema.safeParse(node).success).toBe(true);
    expect(classifyPredicate(node).kind).toBe(kind);
  });

  it.each(EXPRESSION_KINDS)("creates a %s expression that trilean's schema accepts and the form reads as that kind, not as raw JSON", (kind) => {
    const node = createExpression(kind, NAMES);

    expect(ExpressionNodeSchema.safeParse(node).success).toBe(true);
    expect(classifyExpression(node).kind).toBe(kind);
  });

  it("names, among the kinds the library refuses in a model, only kinds the schema defines", () => {
    for (const kind of REFUSED_PREDICATE_KINDS) expect(PREDICATE_KINDS).toContain(kind);
    for (const kind of REFUSED_EXPRESSION_KINDS) expect(EXPRESSION_KINDS).toContain(kind);
  });

  /** A model whose dimensions give each kind of node something it may compare with: text, including the empty text a new literal holds, and numbers. */
  const accepted = (node: Json): boolean =>
    execute({
      op: "validate",
      model: JSON.stringify({ dimensions: [{ kind: "choice", name: "os", values: ["linux", ""] }, { kind: "choice", name: "n", values: [0, 1] }], rules: [{ excludes: node }] }),
    }).ok;

  it.each(PREDICATE_KINDS)("is right about the library accepting or refusing a %s predicate in a model", (kind) => {
    expect(accepted(createPredicate(kind, kind === "compare" ? ["n"] : ["os"]))).toBe(!REFUSED_PREDICATE_KINDS.includes(kind));
  });

  it.each(EXPRESSION_KINDS)("is right about the library accepting or refusing a %s expression in a model", (kind) => {
    const inside: Json = { kind: "exists", operand: createExpression(kind, ["os"]) };

    expect(accepted(inside)).toBe(!REFUSED_EXPRESSION_KINDS.includes(kind));
  });
});

describe("classifyPredicate", () => {
  it("reads each structured kind's fields", () => {
    expect(classifyPredicate({ kind: "not", operand: TEXT_X })).toEqual({ kind: "not", operand: TEXT_X });
    expect(classifyPredicate({ kind: "and", left: REFERENCE_OS, right: REFERENCE_ARCH })).toEqual({ kind: "and", left: REFERENCE_OS, right: REFERENCE_ARCH });
    expect(classifyPredicate({ kind: "anyOf", operands: [REFERENCE_OS] })).toEqual({ kind: "anyOf", operands: [REFERENCE_OS] });
    expect(classifyPredicate({ kind: "compare", op: "gte", left: REFERENCE_OS, right: TEXT_X })).toEqual({ kind: "compare", op: "gte", left: REFERENCE_OS, right: TEXT_X });
    expect(classifyPredicate({ kind: "memberOf", op: "notIn", operand: REFERENCE_OS, candidates: [TEXT_X] })).toEqual({ kind: "memberOf", op: "notIn", operand: REFERENCE_OS, candidates: [TEXT_X] });
  });

  it("reads a quantifier with and without a filter, and a tree reference", () => {
    const item: Json = { kind: "exists", operand: REFERENCE_OS };

    expect(classifyPredicate({ kind: "some", collection: "things", item })).toEqual({ kind: "some", collection: "things", item, filter: undefined });
    expect(classifyPredicate({ kind: "every", collection: ["a"], item, filter: item })).toEqual({ kind: "every", collection: ["a"], item, filter: item });
    expect(classifyPredicate({ kind: "treeReference", key: { any: [1] } })).toEqual({ kind: "treeReference", key: { any: [1] } });
  });

  it("is raw for a kind the schema does not define, keeping the node", () => {
    const node: Json = { kind: "mystery", operand: REFERENCE_OS };

    expect(classifyPredicate(node)).toEqual({ kind: "raw", json: node, nodeKind: "mystery" });
  });

  it("is raw for a known kind with a key the form does not edit, or a field of the wrong type", () => {
    expect(classifyPredicate({ kind: "not", operand: TEXT_X, note: "kept" }).kind).toBe("raw");
    expect(classifyPredicate({ kind: "not" }).kind).toBe("raw");
    expect(classifyPredicate({ kind: "compare", op: "contains", left: TEXT_X, right: TEXT_X }).kind).toBe("raw");
    expect(classifyPredicate({ kind: "allOf", operands: "all" }).kind).toBe("raw");
  });

  it("is raw for what is not a node at all", () => {
    expect(classifyPredicate("text")).toEqual({ kind: "raw", json: "text", nodeKind: undefined });
    expect(classifyPredicate([1])).toMatchObject({ kind: "raw" });
    expect(classifyPredicate(null)).toMatchObject({ kind: "raw" });
    expect(classifyPredicate({ kind: 5 })).toEqual({ kind: "raw", json: { kind: 5 }, nodeKind: undefined });
  });
});

describe("classifyExpression", () => {
  it("reads each literal and operator", () => {
    expect(classifyExpression({ kind: "numberLiteral", value: 2.5 })).toEqual({ kind: "numberLiteral", value: 2.5 });
    expect(classifyExpression({ kind: "booleanLiteral", value: false })).toEqual({ kind: "booleanLiteral", value: false });
    expect(classifyExpression({ kind: "durationLiteral", value: 3, unit: "min" })).toEqual({ kind: "durationLiteral", value: 3, unit: "min" });
    expect(classifyExpression({ kind: "complexLiteral", re: 1, im: 2 })).toEqual({ kind: "complexLiteral", form: "rectangular", re: 1, im: 2 });
    expect(classifyExpression({ kind: "complexLiteral", magnitude: 1, phase: 2 })).toEqual({ kind: "complexLiteral", form: "polar", magnitude: 1, phase: 2 });
    expect(classifyExpression({ kind: "arithmetic", op: "power", left: REFERENCE_OS, right: REFERENCE_ARCH })).toMatchObject({ kind: "arithmetic", op: "power" });
  });

  it("reads a conditional with and without a hit policy", () => {
    const when: Json = { kind: "exists", operand: REFERENCE_OS };
    const cases = [{ when, then: TEXT_X }];

    expect(classifyExpression({ kind: "conditional", cases, fallback: TEXT_X })).toEqual({ kind: "conditional", hitPolicy: undefined, cases, fallback: TEXT_X });
    expect(classifyExpression({ kind: "conditional", hitPolicy: "unique", cases, fallback: TEXT_X })).toMatchObject({ hitPolicy: "unique" });
  });

  it("is raw for a conditional with a case that is not a when and a then, or a policy it does not know", () => {
    expect(classifyExpression({ kind: "conditional", cases: [{ when: TEXT_X }], fallback: TEXT_X }).kind).toBe("raw");
    expect(classifyExpression({ kind: "conditional", hitPolicy: "last", cases: [], fallback: TEXT_X }).kind).toBe("raw");
  });

  it("is raw for a duration with a unit the schema does not define", () => {
    expect(classifyExpression({ kind: "durationLiteral", value: 1, unit: "fortnight" }).kind).toBe("raw");
  });

  it("reads the kinds that need a collection, a table or another system", () => {
    const item: Json = { kind: "numberLiteral", value: 1 };

    expect(classifyExpression({ kind: "call", fn: "max", args: [item] })).toEqual({ kind: "call", fn: "max", args: [item] });
    expect(classifyExpression({ kind: "lookup", table: "prices", keys: [item] })).toEqual({ kind: "lookup", table: "prices", keys: [item] });
    expect(classifyExpression({ kind: "fold", collection: "xs", combiner: { mode: "max", item } })).toEqual({ kind: "fold", collection: "xs", filter: undefined, combiner: { mode: "max", item } });
    expect(classifyExpression({ kind: "fold", collection: "xs", filter: REFERENCE_OS, combiner: { mode: "reduce", initial: item, combine: item } })).toMatchObject({ kind: "fold", combiner: { mode: "reduce", initial: item, combine: item } });
    expect(classifyExpression({ kind: "accumulator" })).toEqual({ kind: "accumulator" });
    expect(classifyExpression({ kind: "delegate", system: "rules", payload: [1] })).toEqual({ kind: "delegate", system: "rules", payload: [1] });
    expect(classifyExpression({ kind: "treeReference", key: 3.5 })).toEqual({ kind: "treeReference", key: 3.5 });
  });

  it("reads a reference whose key is not text, and a unit on a number, a complex number and a reference", () => {
    expect(classifyExpression({ kind: "reference", key: ["a"] })).toEqual({ kind: "reference", key: ["a"], unit: undefined });
    expect(classifyExpression({ kind: "numberLiteral", value: 1, unit: { m: 1, s: -1 } })).toEqual({ kind: "numberLiteral", value: 1, unit: { m: 1, s: -1 } });
    expect(classifyExpression({ kind: "complexLiteral", re: 1, im: 2, unit: { V: 1 } })).toMatchObject({ form: "rectangular", unit: { V: 1 } });
    expect(classifyExpression({ kind: "complexLiteral", magnitude: 1, phase: 2, unit: { V: 1 } })).toMatchObject({ form: "polar", unit: { V: 1 } });
    expect(classifyExpression({ kind: "reference", key: "os", unit: { m: 1 } })).toEqual({ kind: "reference", key: "os", unit: { m: 1 } });
  });

  it("is raw for data the schema does not accept: a fold with no combiner mode, a unit whose exponent is not a number, a call without a function", () => {
    expect(classifyExpression({ kind: "fold", collection: "xs", combiner: { mode: "median", item: REFERENCE_OS } }).kind).toBe("raw");
    expect(classifyExpression({ kind: "numberLiteral", value: 1, unit: { m: "one" } }).kind).toBe("raw");
    expect(classifyExpression({ kind: "call", args: [] }).kind).toBe("raw");
    expect(classifyExpression({ kind: "accumulator", extra: 1 }).kind).toBe("raw");
  });
});

const TWELVE = 12;

describe("changing kind", () => {
  it("returns the same node when the kind is unchanged", () => {
    const node = createPredicate("and", NAMES);

    expect(changePredicateKind(node, "and", NAMES)).toBe(node);
  });

  it("keeps both operands between and, or, all of and any of", () => {
    const both: Json = { kind: "and", left: { kind: "exists", operand: REFERENCE_OS }, right: { kind: "exists", operand: REFERENCE_ARCH } };

    expect(changePredicateKind(both, "or", NAMES)).toEqual({ ...both, kind: "or" });
    expect(changePredicateKind(both, "allOf", NAMES)).toEqual({ kind: "allOf", operands: [both["left"], both["right"]] });
    expect(changePredicateKind(changePredicateKind(both, "anyOf", NAMES), "and", NAMES)).toEqual(both);
  });

  it("keeps the dimension an is-set test reads when it becomes a comparison", () => {
    const set: Json = { kind: "exists", operand: REFERENCE_ARCH };

    expect(changePredicateKind(set, "textCompare", NAMES)).toEqual({ kind: "textCompare", op: "equals", left: REFERENCE_ARCH, right: { kind: "textLiteral", value: "" } });
  });

  it("starts a node of a family with nothing to carry from defaults", () => {
    expect(changePredicateKind({ kind: "exists", operand: REFERENCE_ARCH }, "and", NAMES)).toEqual({ kind: "and", left: createPredicate("exists", NAMES), right: createPredicate("exists", NAMES) });
  });

  it("keeps the arguments of a call through a lookup, and the item of a fold through a change of mode", () => {
    const args: Json[] = [REFERENCE_OS, REFERENCE_ARCH];

    expect(changeExpressionKind({ kind: "call", fn: "f", args }, "lookup", NAMES)).toEqual({ kind: "lookup", table: "", keys: args });
    expect(changeFoldMode({ mode: "max", item: REFERENCE_OS }, "reduce", NAMES)).toMatchObject({ mode: "reduce", initial: REFERENCE_OS });
    expect(changeFoldMode({ mode: "reduce", initial: REFERENCE_OS, combine: REFERENCE_ARCH }, "min", NAMES)).toEqual({ mode: "min", item: REFERENCE_OS });
    expect(changeFoldMode({ mode: "min", item: REFERENCE_OS }, "min", NAMES)).toEqual({ mode: "min", item: REFERENCE_OS });
  });

  it("keeps the operands of arithmetic through negation", () => {
    const sum: Json = { kind: "arithmetic", op: "add", left: REFERENCE_OS, right: REFERENCE_ARCH };

    expect(changeExpressionKind(sum, "negate", NAMES)).toEqual({ kind: "negate", operand: REFERENCE_OS });
  });

  it("starts a reference on the first dimension, or on an empty key when there is none", () => {
    expect(createExpression("reference", ["first", "second"])).toEqual({ kind: "reference", key: "first" });
    expect(createExpression("reference", [])).toEqual({ kind: "reference", key: "" });
  });

  it("carries the value of a text, number or boolean literal to another of those kinds where it stays the same value", () => {
    const text = (value: string): Json => ({ kind: "textLiteral", value });
    const number = (value: number): Json => ({ kind: "numberLiteral", value });
    const boolean = (value: boolean): Json => ({ kind: "booleanLiteral", value });

    expect(changeExpressionKind(number(TWELVE), "textLiteral", NAMES)).toEqual(text("12"));
    expect(changeExpressionKind(text("12"), "numberLiteral", NAMES)).toEqual(number(TWELVE));
    expect(changeExpressionKind(boolean(true), "textLiteral", NAMES)).toEqual(text("true"));
    expect(changeExpressionKind(text("false"), "booleanLiteral", NAMES)).toEqual(boolean(false));
    expect(changeExpressionKind({ kind: "numberLiteral", value: TWELVE, unit: { m: 1 } }, "textLiteral", NAMES)).toEqual(text("12"));
  });

  it("starts the default of the new kind for a literal whose value would change", () => {
    expect(changeExpressionKind({ kind: "textLiteral", value: "windows" }, "numberLiteral", NAMES)).toEqual({ kind: "numberLiteral", value: 0 });
    expect(changeExpressionKind({ kind: "textLiteral", value: " 12" }, "numberLiteral", NAMES)).toEqual({ kind: "numberLiteral", value: 0 });
    expect(changeExpressionKind({ kind: "textLiteral", value: "yes" }, "booleanLiteral", NAMES)).toEqual({ kind: "booleanLiteral", value: true });
    expect(changeExpressionKind({ kind: "numberLiteral", value: 1 }, "booleanLiteral", NAMES)).toEqual({ kind: "booleanLiteral", value: true });
    expect(changeExpressionKind({ kind: "booleanLiteral", value: false }, "numberLiteral", NAMES)).toEqual({ kind: "numberLiteral", value: 0 });
  });

  it("changes a raw node to a built one, and every kind to every other without throwing", () => {
    for (const from of PREDICATE_KINDS) {
      for (const to of PREDICATE_KINDS) {
        const changed = changePredicateKind(createPredicate(from, NAMES), to, NAMES);

        expect(classifyPredicate(changed).kind).toBe(to);
        expect(PredicateNodeSchema.safeParse(changed).success).toBe(true);
      }
    }
    for (const from of EXPRESSION_KINDS) {
      for (const to of EXPRESSION_KINDS) {
        const changed = changeExpressionKind(createExpression(from, NAMES), to, NAMES);

        expect(classifyExpression(changed).kind).toBe(to);
        expect(ExpressionNodeSchema.safeParse(changed).success).toBe(true);
      }
    }
  });
});
