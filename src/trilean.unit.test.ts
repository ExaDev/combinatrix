import type { ExpressionNode, PredicateNode } from "trilean";
import { DEFAULT_MAX_EVALUATION_NODES, DEFAULT_MAX_NESTING_DEPTH } from "trilean/evaluator-budget";
import { describe, expect, it } from "vitest";

import type { Condition, Dimension, Value } from "./index";
import { choice, collect, computed, ConstraintContractError, defineModel, firstValid, is, isCondition, isSet, ModelError, UndecidedConstraintError, UnmappableValueError } from "./index";

const ref = (key: string): ExpressionNode => ({ kind: "reference", key });
const text = (value: string): ExpressionNode => ({ kind: "textLiteral", value });
const number = (value: number): ExpressionNode => ({ kind: "numberLiteral", value });
const exists = (key: string): PredicateNode => ({ kind: "exists", operand: ref(key) });

const LOW = 0.3;
const HIGH = 0.5;
const RATIOS = [LOW, HIGH] as const;
const dimensions: readonly Dimension[] = [choice("mode", [undefined, "fast", "safe"]), choice("ratio", [undefined, ...RATIOS]), choice("cache", [true, false])];

/** The issues `defineModel` refuses a rule with, the rule requiring the tree given, which is untyped data. */
function issuesOf(tree: unknown, over: readonly Dimension[] = dimensions): readonly string[] {
  try {
    Reflect.apply(defineModel, undefined, [{ dimensions: over, rules: [{ requires: tree }] }]);
  } catch (error) {
    if (error instanceof ModelError) return error.issues;
    throw error;
  }

  return [];
}

describe("a trilean tree as a rule's condition", () => {
  it("reads strings as text, numbers as numbers and booleans as booleans", () => {
    const model = defineModel({
      dimensions,
      rules: [{ requires: { kind: "or", left: { kind: "not", operand: exists("ratio") }, right: { kind: "compare", op: "gte", left: ref("ratio"), right: number(RATIOS[1]) } } }, { requires: { kind: "memberOf", op: "in", operand: ref("cache"), candidates: [{ kind: "booleanLiteral", value: true }] } }],
    });
    expect(collect(model).map(({ values }) => values["ratio"])).toEqual([undefined, RATIOS[1], undefined, RATIOS[1], undefined, RATIOS[1]]);
    expect(collect(model).every(({ values }) => values["cache"] === true)).toBe(true);
  });

  it("throws UndecidedConstraintError, a ConstraintContractError carrying trilean's reason, for a comparison of an unset dimension with no exists guard", () => {
    const model = defineModel({ dimensions, rules: [{ name: "fast", requires: { kind: "textCompare", op: "equals", left: ref("mode"), right: text("fast") } }] });
    const [constraint] = model.constraints;
    expect(constraint?.evaluate(new Map())).toBe("unknown");
    expect(() => collect(model)).toThrow(UndecidedConstraintError);
    let thrown: unknown;
    try {
      constraint?.evaluate(new Map([["mode", undefined]]));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(UndecidedConstraintError);
    expect(thrown).toMatchObject({ reason: { code: "not-found" } });
    expect(String(thrown)).toContain('rule "fast" is indeterminate');
    expect(new UndecidedConstraintError("rule 0", { code: "not-found", message: "absent" })).toBeInstanceOf(ConstraintContractError);
  });

  it("is definitely false on an unset dimension when the comparison is guarded with exists, as the builders guard theirs", () => {
    const [guarded] = defineModel({ dimensions, rules: [{ requires: is("mode", "fast") }] }).constraints;
    expect(guarded?.evaluate(new Map([["mode", undefined]]))).toBe("invalid");
    expect(guarded?.evaluate(new Map([["mode", "fast"]]))).toBe("valid");
    expect(guarded?.evaluate(new Map())).toBe("unknown");
  });

  it("throws UnmappableValueError when it reads a computed dimension whose function produced null, which the builders refuse at compile time", () => {
    const dimensionsWithNull = [choice("a", [1, 2]), computed("b", { reads: ["a"], compute: ({ a }): Value => (a === 1 ? null : "two") })] as const;
    // @ts-expect-error b can be null, which has no trilean value, so a builder may not mention it
    defineModel({ dimensions: dimensionsWithNull, rules: [{ requires: isSet("b") }] });
    // A bare tree records no mentions, so it reaches the runtime, which cannot know a computed dimension's values ahead.
    const model = defineModel({ dimensions: dimensionsWithNull, rules: [{ requires: exists("b") }] });
    expect(() => collect(model)).toThrow(UnmappableValueError);
  });

  it("evaluates an activity condition with trilean too", () => {
    const model = defineModel({ dimensions: [choice("os", ["linux", "macos"]), choice("libc", ["glibc", "musl"], { activeWhen: is("os", "linux") })] });
    expect(collect(model).map(({ values }) => values)).toEqual([
      { os: "linux", libc: "glibc" },
      { os: "linux", libc: "musl" },
      { os: "macos", libc: undefined },
    ]);
  });
});

describe("defineModel's refusal of a tree no assignment of dimensions can decide", () => {
  it.each<[string, unknown, string]>([
    ["a quantifier over a collection", { kind: "some", collection: "items", item: exists("mode") }, '$: "some" is not supported, because it quantifies over a collection'],
    ["a table lookup", { kind: "exists", operand: { kind: "lookup", table: "t", keys: [] } }, '$.operand: "lookup" is not supported, because it reads a table'],
    ["a reference to another tree", { kind: "treeReference", key: "other" }, '$: "treeReference" is not supported'],
    ["a delegate", { kind: "exists", operand: { kind: "delegate", system: "s", payload: null } }, '$.operand: "delegate" is not supported'],
    ["a function call", { kind: "exists", operand: { kind: "call", fn: "minimum", args: [] } }, '$.operand: calls "minimum", which the function registry does not hold'],
    ["a reference with a unit", { kind: "exists", operand: { kind: "reference", key: "ratio", unit: { m: 1 } } }, '$.operand: the reference to "ratio" carries a unit'],
    ["a reference key that is not a string", { kind: "exists", operand: { kind: "reference", key: 1 } }, "$.operand: the reference key 1 is not a string naming a dimension"],
    ["an unknown dimension", exists("kernel"), '$.operand: mentions unknown dimension "kernel"'],
    ["a value a dimension can never take", { kind: "memberOf", op: "in", operand: ref("mode"), candidates: [text("slow")] }, '$: compares "mode" with "slow", which it can never take'],
    ["text compared with a number dimension", { kind: "textCompare", op: "equals", left: ref("ratio"), right: text("fast") }, '$: compares "ratio" across value kinds (number, text), and trilean compares values of one kind only'],
    ["a number compared with a text dimension", { kind: "compare", op: "gt", left: ref("mode"), right: number(1) }, '$: compares "mode" across value kinds (text, number)'],
    ["membership across kinds", { kind: "memberOf", op: "in", operand: ref("cache"), candidates: [text("true")] }, '$: compares "cache" with "true", which it can never take'],
    ["a key trilean does not define", { kind: "exists", operand: ref("mode"), extra: 1 }, 'rule 0 requires at $: the key "extra" is not one trilean defines there (not a trilean predicate tree)'],
    ["something that is not a tree", { kind: "nope" }, "rule 0 requires at $.kind: "],
  ])("refuses %s", (_, tree, issue) => {
    expect(issuesOf(tree).some((each) => each.includes(issue))).toBe(true);
  });

  it("refuses a dimension that can take null, which has no trilean value, and one compared across the kinds of its own values", () => {
    expect(issuesOf(exists("n"), [choice("n", [null, 1])])).toEqual(['rule 0 at $.operand: dimension "n" can take null, which has no trilean value']);
    expect(issuesOf(is("m", "a"), [choice<"m", "a" | 1>("m", ["a", 1])])).toEqual(['rule 0 at $.right: compares "m" across value kinds (text, number), and trilean compares values of one kind only']);
    expect(issuesOf(isSet("m"), [choice<"m", "a" | 1>("m", ["a", 1])])).toEqual([]);
  });

  it("refuses a tree past trilean's evaluation budget, by node count and by depth", () => {
    const wide: Condition = { kind: "allOf", operands: Array.from({ length: DEFAULT_MAX_EVALUATION_NODES }, () => exists("mode")) };
    expect(issuesOf(wide)).toEqual([`rule 0 has ${String(DEFAULT_MAX_EVALUATION_NODES * 2 + 1)} nodes, more than the ${String(DEFAULT_MAX_EVALUATION_NODES)} one trilean evaluation may visit`]);
    let deep: Condition = exists("mode");
    for (let depth = 1; depth < DEFAULT_MAX_NESTING_DEPTH; depth += 1) deep = { kind: "not", operand: deep };
    expect(issuesOf(deep)).toEqual([`rule 0 nests to depth ${String(DEFAULT_MAX_NESTING_DEPTH)}, and trilean evaluation refuses depth ${String(DEFAULT_MAX_NESTING_DEPTH)} and deeper`]);
  });

  it("checks a rule's conditions where they are written, before its scope negates them", () => {
    const model = defineModel({ dimensions: [choice("os", ["linux"]), firstValid("libc", ["glibc"])], rules: [{ excludes: isSet("os"), when: isSet("libc") }] });
    expect(collect(model)).toEqual([]);
  });
});

describe("isCondition", () => {
  it("accepts a trilean predicate tree, whatever names and node kinds it uses, and refuses anything else", () => {
    expect(isCondition(is("anything", 1))).toBe(true);
    expect(isCondition({ kind: "some", collection: "items", item: exists("mode") })).toBe(true);
    expect(isCondition({ kind: "exists", operand: ref("mode"), extra: 1 })).toBe(false);
    expect(isCondition({ kind: "reference", key: "mode" })).toBe(false);
    expect(isCondition({ is: ["mode", "fast"] })).toBe(false);
  });
});
