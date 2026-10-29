import { ExpressionNodeSchema, PredicateNodeSchema } from "trilean";
import { describe, expect, it } from "vitest";

import type { Json } from "./json";
import { changeExpressionKind, changePredicateKind, classifyExpression, classifyPredicate, createExpression, createPredicate, EXPRESSION_KINDS, PREDICATE_KINDS, RAW_EXPRESSION_KINDS, RAW_PREDICATE_KINDS } from "./nodes";

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
  it("builds or shows raw every predicate kind trilean's schema defines, and nothing else", () => {
    expect([...PREDICATE_KINDS, ...RAW_PREDICATE_KINDS].toSorted()).toEqual([...new Set(schemaPredicateKinds())].toSorted());
  });

  it("builds or shows raw every expression kind trilean's schema defines, and nothing else", () => {
    expect([...EXPRESSION_KINDS, ...RAW_EXPRESSION_KINDS].toSorted()).toEqual([...new Set(schemaExpressionKinds())].toSorted());
  });

  it.each(PREDICATE_KINDS)("creates a %s predicate that trilean's schema accepts and the form can edit", (kind) => {
    const node = createPredicate(kind, NAMES);

    expect(PredicateNodeSchema.safeParse(node).success).toBe(true);
    expect(classifyPredicate(node).kind).toBe(kind);
  });

  it.each(EXPRESSION_KINDS)("creates a %s expression that trilean's schema accepts and the form can edit", (kind) => {
    const node = createExpression(kind, NAMES);

    expect(ExpressionNodeSchema.safeParse(node).success).toBe(true);
    expect(classifyExpression(node).kind).toBe(kind);
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

  it("is raw for a kind the form has no controls for, keeping the node", () => {
    const node: Json = { kind: "some", collection: "things", item: { kind: "exists", operand: REFERENCE_OS } };

    expect(classifyPredicate(node)).toEqual({ kind: "raw", json: node, nodeKind: "some" });
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

  it("is raw for a literal or reference that carries a unit, a reference whose key is not text, and a duration with an unknown unit", () => {
    expect(classifyExpression({ kind: "numberLiteral", value: 1, unit: { m: 1 } }).kind).toBe("raw");
    expect(classifyExpression({ kind: "reference", key: "os", unit: { m: 1 } }).kind).toBe("raw");
    expect(classifyExpression({ kind: "reference", key: ["os"] }).kind).toBe("raw");
    expect(classifyExpression({ kind: "durationLiteral", value: 1, unit: "fortnight" }).kind).toBe("raw");
  });

  it.each(RAW_EXPRESSION_KINDS)("is raw for a %s node", (kind) => {
    expect(classifyExpression({ kind })).toMatchObject({ kind: "raw", nodeKind: kind });
  });
});

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

  it("keeps the operands of arithmetic through negation", () => {
    const sum: Json = { kind: "arithmetic", op: "add", left: REFERENCE_OS, right: REFERENCE_ARCH };

    expect(changeExpressionKind(sum, "negate", NAMES)).toEqual({ kind: "negate", operand: REFERENCE_OS });
  });

  it("starts a reference on the first dimension, or on an empty key when there is none", () => {
    expect(createExpression("reference", ["first", "second"])).toEqual({ kind: "reference", key: "first" });
    expect(createExpression("reference", [])).toEqual({ kind: "reference", key: "" });
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
