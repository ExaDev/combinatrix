import { describe, expect, it } from "vitest";

import type { Condition } from "./condition";
import { evaluateCondition } from "./condition";
import type { Rule, Value } from "./index";
import { evaluateRule } from "./rule";

const DIMENSIONS = ["a", "b", "c"] as const;
const VALUES: readonly Value[] = [undefined, "x", "y"];

/** Every condition up to the given nesting depth over the fixed dimensions and values, each leaf form at least once. */
function conditions(depth: number): Condition[] {
  const leaves: Condition[] = DIMENSIONS.flatMap((dimension) => [{ is: [dimension, "x"] }, { in: [dimension, ["x", "y"]] }, { set: dimension }, { unset: dimension }]);
  if (depth === 0) return leaves;

  // Every few conditions of the level below, so the operand pairs stay few enough to check every assignment of each.
  const smaller = conditions(depth - 1).filter((_, index) => index % (DIMENSIONS.length * depth) === 0);

  return [...leaves, ...smaller.map((condition) => ({ not: condition })), ...smaller.flatMap((left) => smaller.map((right) => ({ all: [left, right] }))), ...smaller.flatMap((left) => smaller.map((right) => ({ any: [left, right] })))];
}

/** Every assignment of the dimensions, each unassigned or assigned one of the values. */
function partialAssignments(): Map<string, Value>[] {
  return DIMENSIONS.reduce<Map<string, Value>[]>((assignments, dimension) => assignments.flatMap((assignment) => [assignment, ...VALUES.map((value) => new Map<string, Value>([...assignment, [dimension, value]]))]), [new Map<string, Value>()]);
}

/** Every complete assignment extending a partial one. */
function completions(assignment: ReadonlyMap<string, Value>): Map<string, Value>[] {
  return DIMENSIONS.reduce<Map<string, Value>[]>((partials, dimension) => (assignment.has(dimension) ? partials : partials.flatMap((partial) => VALUES.map((value) => new Map<string, Value>([...partial, [dimension, value]])))), [new Map(assignment)]);
}

describe("evaluateCondition", () => {
  it("distinguishes unset from unassigned and from null", () => {
    expect(evaluateCondition({ unset: "a" }, new Map())).toBeUndefined();
    expect(evaluateCondition({ unset: "a" }, new Map([["a", undefined]]))).toBe(true);
    expect(evaluateCondition({ unset: "a" }, new Map([["a", null]]))).toBe(false);
    expect(evaluateCondition({ is: ["a", null] }, new Map([["a", undefined]]))).toBe(false);
    expect(evaluateCondition({ set: "a" }, new Map([["a", null]]))).toBe(true);
  });

  it("decides all and any as soon as one operand does, whatever the others are", () => {
    const partial = new Map([["a", "x"]]);
    expect(evaluateCondition({ all: [{ is: ["a", "y"] }, { is: ["b", "x"] }] }, partial)).toBe(false);
    expect(evaluateCondition({ any: [{ is: ["a", "x"] }, { is: ["b", "x"] }] }, partial)).toBe(true);
    expect(evaluateCondition({ all: [{ is: ["a", "x"] }, { is: ["b", "x"] }] }, partial)).toBeUndefined();
    expect(evaluateCondition({ all: [] }, new Map())).toBe(true);
    expect(evaluateCondition({ any: [] }, new Map())).toBe(false);
  });

  it("is monotone: a definite answer on a partial assignment is the answer on every completion", () => {
    const violations: string[] = [];
    const cases = partialAssignments().map((assignment) => ({ assignment, completions: completions(assignment) }));
    for (const condition of conditions(2)) {
      for (const { assignment, completions: everyCompletion } of cases) {
        const answer = evaluateCondition(condition, assignment);
        for (const complete of everyCompletion) {
          const final = evaluateCondition(condition, complete);
          if (final === undefined || (answer !== undefined && answer !== final)) violations.push(JSON.stringify({ condition, assignment: [...assignment], complete: [...complete] }));
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("evaluateRule", () => {
  const body: Condition = { is: ["b", "x"] };
  const scope: Condition = { is: ["a", "x"] };

  it.each<{ readonly label: string; readonly rule: Rule; readonly a: Value; readonly b: Value; readonly holds: boolean }>([
    { label: "requires holds", rule: { requires: body }, a: "y", b: "x", holds: true },
    { label: "requires fails", rule: { requires: body }, a: "y", b: "y", holds: false },
    { label: "excludes fails", rule: { excludes: body }, a: "y", b: "x", holds: false },
    { label: "implies holds without its antecedent", rule: { implies: [scope, body] }, a: "y", b: "y", holds: true },
    { label: "implies fails with its antecedent", rule: { implies: [scope, body] }, a: "x", b: "y", holds: false },
    { label: "when out of scope", rule: { requires: body, when: scope }, a: "y", b: "y", holds: true },
    { label: "when in scope", rule: { requires: body, when: scope }, a: "x", b: "y", holds: false },
    { label: "unless in its exception", rule: { requires: body, unless: scope }, a: "x", b: "y", holds: true },
    { label: "unless outside its exception", rule: { requires: body, unless: scope }, a: "y", b: "y", holds: false },
  ])("$label", ({ rule, a, b, holds }) => {
    expect(evaluateRule(rule, new Map([["a", a], ["b", b]]))).toBe(holds);
  });

  it("is unknown until its scope or body is decided", () => {
    expect(evaluateRule({ requires: body, when: scope }, new Map([["a", "x"]]))).toBeUndefined();
    expect(evaluateRule({ requires: body, when: scope }, new Map([["a", "y"]]))).toBe(true);
  });
});
