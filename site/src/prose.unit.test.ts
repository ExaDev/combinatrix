import { describe, expect, it } from "vitest";

import type { Json } from "./json";
import { classifyRule } from "./modelEdit";
import { describeCondition, describeRule } from "./prose";

/** A number the tests compare with. */
const NODE_VERSION = 22;

const ref = (key: string): Json => ({ kind: "reference", key });
const text = (value: string): Json => ({ kind: "textLiteral", value });
const num = (value: number): Json => ({ kind: "numberLiteral", value });
const is = (key: string, value: string): Json => ({ kind: "textCompare", op: "equals", left: ref(key), right: text(value) });

function ruleOf(json: Json): ReturnType<typeof describeRule> {
  const view = classifyRule(json);
  if (view.kind === "raw") throw new Error("the form reads this rule");

  return describeRule(view);
}

describe("describeCondition", () => {
  it("reads comparisons with a dimension on the left, in words", () => {
    expect(describeCondition(is("os", "windows"))).toBe('os is "windows"');
    expect(describeCondition({ kind: "textCompare", op: "notEquals", left: ref("os"), right: text("linux") })).toBe('os is not "linux"');
    for (const [op, words] of [["gt", "is greater than"], ["gte", "is at least"], ["lt", "is less than"], ["lte", "is at most"], ["eq", "is"], ["neq", "is not"]] as const) {
      expect(describeCondition({ kind: "compare", op, left: ref("node"), right: num(NODE_VERSION) })).toBe(`node ${words} ${String(NODE_VERSION)}`);
    }
  });

  it("reads membership, set-ness and negation", () => {
    expect(describeCondition({ kind: "memberOf", op: "in", operand: ref("os"), candidates: [text("linux"), text("macos")] })).toBe('os is one of "linux", "macos"');
    expect(describeCondition({ kind: "memberOf", op: "notIn", operand: ref("os"), candidates: [text("windows")] })).toBe('os is not one of "windows"');
    expect(describeCondition({ kind: "exists", operand: ref("codec") })).toBe("codec is set");
    expect(describeCondition({ kind: "not", operand: is("os", "windows") })).toBe('not os is "windows"');
  });

  it("joins conditions, and brackets one that joins several inside another", () => {
    expect(describeCondition({ kind: "allOf", operands: [is("os", "windows"), is("arch", "arm64")] })).toBe('os is "windows" and arch is "arm64"');
    expect(describeCondition({ kind: "anyOf", operands: [is("a", "x"), is("b", "y"), is("c", "z")] })).toBe('a is "x", b is "y" or c is "z"');
    expect(describeCondition({ kind: "and", left: is("a", "x"), right: { kind: "or", left: is("b", "y"), right: is("c", "z") } })).toBe('a is "x" and (b is "y" or c is "z")');
    expect(describeCondition({ kind: "not", operand: { kind: "anyOf", operands: [is("a", "x"), is("b", "y")] } })).toBe('not (a is "x" or b is "y")');
  });

  it("reads arithmetic between its sides, and boolean literals", () => {
    expect(describeCondition({ kind: "compare", op: "gt", left: { kind: "arithmetic", op: "add", left: ref("a"), right: num(1) }, right: { kind: "negate", operand: ref("b") } })).toBe("(a plus 1) is greater than minus b");
    expect(describeCondition({ kind: "memberOf", op: "in", operand: ref("tls"), candidates: [{ kind: "booleanLiteral", value: true }] })).toBe("tls is one of true");
  });

  it("names a kind it has no reading for, rather than guessing at it", () => {
    expect(describeCondition({ kind: "some", collection: ref("c"), item: "i", filter: { kind: "not", operand: ref("x") } })).toBe("a some condition");
    expect(describeCondition({ kind: "compare", op: "gt", left: { kind: "call", fn: "f", args: [] }, right: num(1) })).toBe("a call expression is greater than 1");
    expect(describeCondition({ kind: "compare", op: "gt", left: { kind: "numberLiteral", value: 1, unit: [] }, right: num(1) })).toBe("a numberLiteral expression is greater than 1");
    expect(describeCondition(NODE_VERSION)).toBe("a condition");
    expect(describeCondition({ kind: "allOf", operands: [] })).toBe("nothing is required");
  });
});

describe("describeRule", () => {
  it("states each form, with the condition it applies when and the one it does not apply unless", () => {
    expect(ruleOf({ excludes: is("os", "windows"), when: is("runtime", "bun") })).toBe('No combination may satisfy: os is "windows", when runtime is "bun".');
    expect(ruleOf({ requires: is("tls", "yes") })).toBe('Every combination must satisfy: tls is "yes".');
    expect(ruleOf({ implies: [is("http2", "on"), is("tls", "on")], unless: is("mode", "test") })).toBe('If http2 is "on", then tls is "on", unless mode is "test".');
  });
});
