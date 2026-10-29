import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { Condition } from "../src/condition";
import { choice, defineModel, firstValid, isCondition, isRule, parseRules } from "../src/index";
import type { Rule } from "../src/rule";
import type { Scalar } from "../src/value";
import { valueKey } from "../src/value";
import type { Mentionable, Mutation } from "./json-schema.fixtures";
import { accepts, BEYOND_A_SCHEMA, condition, expectAgreement, MAX_OPERANDS, model, MUTATIONS, nearMiss, RUNS, refusalsOf, rule, ruleOver, rules, schema, SEED } from "./json-schema.fixtures";
import { PACKAGE_VERSION } from "./json-schema";

/**
 * The published JSON Schema and the runtime guards describe the same data, so they must accept and refuse the same values. Each property draws seeded random values from the shape the schema describes and near misses of them (a valid value with one node removed, retyped, wrapped, extended or given an unknown key), and requires the guard and a JSON Schema validator to agree on every one. The schema is converted in process, so the suite needs no prior build.
 */

/** The dimensions `parseRules` is given below, with the values each can take, unset included for the one with an activity condition. */
const DOMAINS: ReadonlyMap<string, readonly (Scalar | undefined)[]> = new Map([
  ["a", ["x", "y"]],
  ["b", [true, null]],
  ["c", ["y", undefined]],
]);

/** Whether a well-formed condition mentions only the dimensions above and compares each with a value it can take: the part of `parseRules` that is about the model, written here independently of the library. */
function fitsDomains(operand: Condition): boolean {
  const takes = (dimension: string, value: Scalar | undefined): boolean => DOMAINS.get(dimension)?.some((candidate) => valueKey(candidate) === valueKey(value)) ?? false;
  if ("is" in operand) return takes(operand.is[0], operand.is[1]);
  if ("in" in operand) return DOMAINS.has(operand.in[0]) && operand.in[1].every((value) => takes(operand.in[0], value));
  if ("unset" in operand) return takes(operand.unset, undefined);
  if ("set" in operand) return DOMAINS.has(operand.set);
  if ("all" in operand) return operand.all.every(fitsDomains);
  if ("any" in operand) return operand.any.every(fitsDomains);

  return fitsDomains(operand.not);
}

function ruleFitsDomains(candidate: Rule): boolean {
  const body = "requires" in candidate ? [candidate.requires] : "excludes" in candidate ? [candidate.excludes] : candidate.implies;

  return [candidate.when, candidate.unless, ...body].every((operand) => operand === undefined || fitsDomains(operand));
}

describe("the JSON Schema and the runtime guards", () => {
  it("agree on every condition and near miss", () => {
    expectAgreement(condition, isCondition, accepts("Condition"));
  });

  it("agree on every rule and near miss", () => {
    expectAgreement(rule, isRule, accepts("Rule"));
  });

  it("agree on a list of rules: the guard accepts an array of rules exactly when the schema does", () => {
    expectAgreement(rules, (value) => Array.isArray(value) && value.every(isRule), accepts("Rules"));
  });

  it("agree on a list of rules with `parseRules`, which refuses what the schema refuses and, of what the schema accepts, exactly what names a dimension or value the model lacks", () => {
    const dimensions = [choice("a", ["x", "y"]), choice("b", [true, null]), firstValid("c", ["y"], { activeWhen: { set: "a" } })] as const;
    const known: Mentionable[] = [
      { name: "a", domain: ["x", "y"], unsettable: false },
      { name: "b", domain: [true, null], unsettable: false },
      { name: "c", domain: ["y"], unsettable: true },
    ];
    const parses = (value: unknown): boolean => {
      try {
        parseRules(dimensions, value);

        return true;
      } catch {
        return false;
      }
    };
    const fits = (value: unknown): boolean => Array.isArray(value) && value.every((element: unknown) => isRule(element) && ruleFitsDomains(element));
    expectAgreement(fc.array(ruleOver(known), { maxLength: MAX_OPERANDS }), parses, accepts("Rules"), fits);
  });

  it("accept every model `defineModel` accepts and refuse only models it refuses, and `defineModel` refuses what the schema accepts only for what a schema cannot state", () => {
    const valid = accepts("Model");
    fc.assert(
      fc.property(model, (data) => {
        expect(valid(data), JSON.stringify(data)).toBe(true);
      }),
      { seed: SEED, numRuns: RUNS },
    );

    let accepted = 0;
    const refused = new Set<Mutation>();
    fc.assert(
      fc.property(nearMiss(model), ({ value, mutation }) => {
        const verdict = valid(value);
        // The schema cannot state that names are unique or that every mention names a dimension and a value the model has, so it may accept what `defineModel` refuses for those reasons and no other. It must never refuse what `defineModel` accepts.
        const refusals = refusalsOf(value);
        const message = JSON.stringify(value);
        if (refusals.length === 0) expect(verdict, message).toBe(true);
        else if (verdict) expect(refusals.filter((issue) => !BEYOND_A_SCHEMA.some((pattern) => pattern.test(issue))), message).toEqual([]);
        if (verdict) accepted += 1;
        else {
          refused.add(mutation);
          expect(refusals.length, message).toBeGreaterThan(0);
        }
      }),
      { seed: SEED, numRuns: RUNS },
    );
    expect(accepted).toBeGreaterThan(0);
    expect([...refused].sort()).toEqual([...MUTATIONS].sort());
  });

  it("accept at the root exactly what one of the four definitions accepts", () => {
    const root = accepts(undefined);
    const definitions = [accepts("Model"), accepts("Rules"), accepts("Rule"), accepts("Condition")];
    const anything = fc.oneof(condition, rule, rules, model, nearMiss(fc.oneof(condition, rule, rules, model)).map(({ value }) => value), fc.jsonValue());
    fc.assert(
      fc.property(anything, (value) => {
        expect(root(value)).toBe(definitions.some((valid) => valid(value)));
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });
});

describe("the JSON Schema document", () => {
  it("is a draft 2020-12 schema with a stable, version-pinned $id and a description that says what is out of scope", () => {
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.$id).toBe(`https://cdn.jsdelivr.net/npm/combinatrix@${PACKAGE_VERSION}/schemas/combinatrix.schema.json`);
    expect(schema.description).toContain("Computed dimensions");
    expect(schema.description).toContain("predicates");
  });

  it("describes the recursion of a condition with a reference to its own definition", () => {
    const text = JSON.stringify(schema);
    expect(text).toContain('"$ref":"#/$defs/Condition"');
    expect(Object.keys(schema.$defs ?? {}).sort()).toEqual(["ChoiceDimension", "Condition", "FirstValidDimension", "Model", "Rule", "Rules", "Scalar"]);
  });

  it("describes every definition", () => {
    const undescribed = Object.entries(schema.$defs ?? {}).filter(([, definition]) => typeof definition === "object" && typeof definition.description !== "string");
    expect(undescribed.map(([key]) => key)).toEqual([]);
  });

  it("is what the build wrote, when the build has run", () => {
    const built = join(import.meta.dirname, "..", "schemas", "combinatrix.schema.json");
    if (!existsSync(built)) {
      // A build always precedes the tests in CI, so a missing file there is a defect; locally the tests do not require a build.
      expect(process.env["CI"]).toBeUndefined();

      return;
    }

    const written: unknown = JSON.parse(readFileSync(built, "utf8"));
    expect(written).toEqual(schema);
  });
});

describe("the README's rules file", () => {
  const readme = readFileSync(join(import.meta.dirname, "..", "README.md"), "utf8");
  const section = readme.slice(readme.indexOf("### JSON Schema"));
  const example: unknown = JSON.parse(/^```json\n(?<json>[\s\S]*?)\n```$/mu.exec(section)?.groups?.["json"] ?? "null");

  it("is valid against the schema, and `parseRules` accepts it for the dimensions it is written for", () => {
    expect(accepts("Rules")(example)).toBe(true);
    const dimensions = [choice("os", ["linux", "macos", "windows"]), choice("arch", ["x64", "arm64"]), choice("runtime", ["node", "bun"])] as const;
    expect(() => defineModel({ dimensions, rules: parseRules(dimensions, example) })).not.toThrow();
  });
});
