import { describe, expect, it } from "vitest";

import type { Condition, Constraint, Rule, Value, Verdict } from "./index";
import { allOf, anyOf, choice, defineModel, is, isSet, isUnset, not, oneOf, ruleTree } from "./index";

const DIMENSIONS = ["a", "b", "c"] as const;
const VALUES: readonly Value[] = [undefined, "x", "y"];
const dimensions = DIMENSIONS.map((name) => choice(name, [undefined, "x", "y"]));

/** The constraint a condition states as `{ requires: condition }`, built by the model, so the condition is evaluated as the engine evaluates it. */
function constraintOf(condition: Condition): Constraint {
  const [constraint] = defineModel({ dimensions, rules: [{ requires: condition }] }).constraints;
  if (constraint === undefined) throw new Error("a model with one rule has one constraint");

  return constraint;
}

function verdict(condition: Condition, assignment: ReadonlyMap<string, Value>): Verdict {
  return constraintOf(condition).evaluate(assignment);
}

/** Every condition up to the given nesting depth over the fixed dimensions and values, each builder at least once. */
function conditions(depth: number): Condition[] {
  const leaves: Condition[] = DIMENSIONS.flatMap((dimension) => [is(dimension, "x"), oneOf(dimension, ["x", "y"]), oneOf(dimension, []), isSet(dimension), isUnset(dimension)]);
  if (depth === 0) return leaves;

  // Every few conditions of the level below, so the operand pairs stay few enough to check every assignment of each.
  const smaller = conditions(depth - 1).filter((_, index) => index % (DIMENSIONS.length * depth) === 0);

  return [...leaves, ...smaller.map((condition) => not(condition)), ...smaller.flatMap((left) => smaller.map((right) => allOf(left, right))), ...smaller.flatMap((left) => smaller.map((right) => anyOf(left, right)))];
}

/** Every assignment of the dimensions, each unassigned or assigned one of the values. */
function partialAssignments(): Map<string, Value>[] {
  return DIMENSIONS.reduce<Map<string, Value>[]>((assignments, dimension) => assignments.flatMap((assignment) => [assignment, ...VALUES.map((value) => new Map<string, Value>([...assignment, [dimension, value]]))]), [new Map<string, Value>()]);
}

/** Every complete assignment extending a partial one. */
function completions(assignment: ReadonlyMap<string, Value>): Map<string, Value>[] {
  return DIMENSIONS.reduce<Map<string, Value>[]>((partials, dimension) => (assignment.has(dimension) ? partials : partials.flatMap((partial) => VALUES.map((value) => new Map<string, Value>([...partial, [dimension, value]])))), [new Map(assignment)]);
}

describe("the condition builders", () => {
  it("write trilean predicate trees, plain JSON with nothing but the tree in them", () => {
    const reference = { kind: "reference", key: "a" };
    expect(isSet("a")).toEqual({ kind: "exists", operand: reference });
    expect(isUnset("a")).toEqual({ kind: "not", operand: { kind: "exists", operand: reference } });
    expect(is("a", "x")).toEqual({ kind: "and", left: { kind: "exists", operand: reference }, right: { kind: "memberOf", op: "in", operand: reference, candidates: [{ kind: "textLiteral", value: "x" }] } });
    expect(oneOf("a", [1, true])).toMatchObject({ right: { candidates: [{ kind: "numberLiteral", value: 1 }, { kind: "booleanLiteral", value: true }] } });
    expect(allOf(isSet("a"), isSet("b"))).toEqual({ kind: "allOf", operands: [isSet("a"), isSet("b")] });
    expect(anyOf()).toEqual({ kind: "anyOf", operands: [] });
    expect(not(isSet("a"))).toEqual(isUnset("a"));
    const condition = allOf(is("a", "x"), not(oneOf("b", ["y"])));
    expect(JSON.parse(JSON.stringify(condition))).toEqual(condition);
    expect(Object.getOwnPropertySymbols(condition)).toEqual([]);
  });

  it("refuse null, which has no trilean literal, when untyped JavaScript passes it", () => {
    expect(() => {
      Reflect.apply(is, undefined, ["a", null]);
    }).toThrow(TypeError);
  });
});

describe("a condition evaluated by the engine", () => {
  it("distinguishes unset from unassigned: a comparison is false on an unset dimension and unknown on an unassigned one", () => {
    expect(verdict(is("a", "x"), new Map())).toBe("unknown");
    expect(verdict(is("a", "x"), new Map([["a", undefined]]))).toBe("invalid");
    expect(verdict(not(is("a", "x")), new Map([["a", undefined]]))).toBe("valid");
    expect(verdict(isUnset("a"), new Map())).toBe("unknown");
    expect(verdict(isUnset("a"), new Map([["a", undefined]]))).toBe("valid");
    expect(verdict(isSet("a"), new Map([["a", "x"]]))).toBe("valid");
  });

  it("compares as a combination's values compare: strings, numbers and booleans by value, 0 and -0 alike, and no value of another kind", () => {
    const numbers = choice("n", [-0, 1]);
    const flags = choice("f", [true, false]);
    const evaluate = (condition: Condition, assignment: ReadonlyMap<string, Value>): Verdict => {
      const [constraint] = defineModel({ dimensions: [numbers, flags], rules: [{ requires: condition }] }).constraints;
      if (constraint === undefined) throw new Error("a model with one rule has one constraint");

      return constraint.evaluate(assignment);
    };
    expect(evaluate(is("n", 0), new Map([["n", -0]]))).toBe("valid");
    expect(evaluate(is("n", 1), new Map([["n", -0]]))).toBe("invalid");
    expect(evaluate(is("f", false), new Map([["f", false]]))).toBe("valid");
    expect(evaluate(is("f", false), new Map([["f", true]]))).toBe("invalid");
    expect(evaluate(oneOf("f", []), new Map([["f", true]]))).toBe("invalid");
  });

  it("answers invalid for a value its dimension can never take, which only a strategy's own test assignment can supply, rather than comparing across kinds", () => {
    expect(verdict(is("a", "x"), new Map([["a", 1]]))).toBe("invalid");
    expect(verdict(not(is("a", "x")), new Map([["a", 1]]))).toBe("invalid");
  });

  it("decides allOf and anyOf as soon as one operand does, whatever the others are", () => {
    const partial = new Map([["a", "x"]]);
    expect(verdict(allOf(is("a", "y"), is("b", "x")), partial)).toBe("invalid");
    expect(verdict(anyOf(is("a", "x"), is("b", "x")), partial)).toBe("valid");
    expect(verdict(allOf(is("a", "x"), is("b", "x")), partial)).toBe("unknown");
    expect(verdict(allOf(), new Map())).toBe("valid");
    expect(verdict(anyOf(), new Map())).toBe("invalid");
  });

  it("is monotone: a definite answer on a partial assignment is the answer on every completion", () => {
    const violations: string[] = [];
    const cases = partialAssignments().map((assignment) => ({ assignment, completions: completions(assignment) }));
    for (const condition of conditions(2)) {
      const constraint = constraintOf(condition);
      for (const { assignment, completions: everyCompletion } of cases) {
        const answer = constraint.evaluate(assignment);
        for (const complete of everyCompletion) {
          const final = constraint.evaluate(complete);
          if (final === "unknown" || (answer !== "unknown" && answer !== final)) violations.push(JSON.stringify({ condition, assignment: [...assignment], complete: [...complete] }));
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("is checked for monotonicity in a way that can fail: reading an unassigned dimension as unset breaks it", () => {
    const constraint = constraintOf(isUnset("a"));
    const unsound = (assignment: ReadonlyMap<string, Value>): Verdict => constraint.evaluate(new Map([...DIMENSIONS.map((name) => [name, undefined] as const), ...assignment]));
    expect(unsound(new Map())).toBe("valid");
    expect(completions(new Map()).map(unsound)).toContain("invalid");
  });
});

describe("a rule", () => {
  const body = is("b", "x");
  const scope = is("a", "x");
  const holds = (rule: Rule, a: Value, b: Value): Verdict => {
    const [constraint] = defineModel({ dimensions, rules: [rule] }).constraints;
    if (constraint === undefined) throw new Error("a model with one rule has one constraint");

    return constraint.evaluate(
      new Map([
        ["a", a],
        ["b", b],
      ]),
    );
  };

  it.each<{ readonly label: string; readonly rule: Rule; readonly a: Value; readonly b: Value; readonly holds: Verdict }>([
    { label: "requires holds", rule: { requires: body }, a: "y", b: "x", holds: "valid" },
    { label: "requires fails", rule: { requires: body }, a: "y", b: "y", holds: "invalid" },
    { label: "excludes fails", rule: { excludes: body }, a: "y", b: "x", holds: "invalid" },
    { label: "implies holds without its antecedent", rule: { implies: [scope, body] }, a: "y", b: "y", holds: "valid" },
    { label: "implies fails with its antecedent", rule: { implies: [scope, body] }, a: "x", b: "y", holds: "invalid" },
    { label: "when out of scope", rule: { requires: body, when: scope }, a: "y", b: "y", holds: "valid" },
    { label: "when in scope", rule: { requires: body, when: scope }, a: "x", b: "y", holds: "invalid" },
    { label: "unless in its exception", rule: { requires: body, unless: scope }, a: "x", b: "y", holds: "valid" },
    { label: "unless outside its exception", rule: { requires: body, unless: scope }, a: "y", b: "y", holds: "invalid" },
    { label: "when and unless both in force", rule: { requires: body, when: isSet("a"), unless: scope }, a: "y", b: "y", holds: "invalid" },
  ])("$label", ({ rule, a, b, holds: expected }) => {
    expect(holds(rule, a, b)).toBe(expected);
  });

  it("is unknown until its scope or body is decided", () => {
    const [constraint] = defineModel({ dimensions, rules: [{ requires: body, when: scope }] }).constraints;
    expect(constraint?.evaluate(new Map([["a", "x"]]))).toBe("unknown");
    expect(constraint?.evaluate(new Map([["a", "y"]]))).toBe("valid");
  });

  it("states one trilean tree, scope implies body, mentioning the dimensions scope first", () => {
    expect(ruleTree({ requires: body })).toBe(body);
    expect(ruleTree({ excludes: body })).toEqual(not(body));
    expect(ruleTree({ implies: [scope, body] })).toEqual({ kind: "or", left: not(scope), right: body });
    expect(ruleTree({ requires: body, when: scope, unless: isSet("c") })).toEqual({ kind: "or", left: not({ kind: "and", left: scope, right: not(isSet("c")) }), right: body });
    expect(defineModel({ dimensions, rules: [{ requires: body, when: isSet("c") }] }).constraints[0]?.dependencies).toEqual(["c", "b"]);
  });
});
