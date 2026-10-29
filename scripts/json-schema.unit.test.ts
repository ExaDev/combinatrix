import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import Ajv2020 from "ajv/dist/2020";
import type { ValidateFunction } from "ajv/dist/2020";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { Condition } from "../src/condition";
import { choice, defineModel, firstValid, isCondition, isRule, ModelError, parseRules } from "../src/index";
import type { Rule } from "../src/rule";
import type { Scalar } from "../src/value";
import { valueKey } from "../src/value";
import { buildJsonSchema, PACKAGE_VERSION } from "./json-schema";

/**
 * The published JSON Schema and the runtime guards describe the same data, so they must accept and refuse the same values. Each property draws seeded random values from the shape the schema describes and near misses of them (a valid value with one node removed, retyped, wrapped, extended or given an unknown key), and requires the guard and a JSON Schema validator to agree on every one. The schema is converted in process, so the suite needs no prior build.
 */

/** Fixed, so a failure reproduces. */
const SEED = 20_261_029;
/** Runs per property: enough for every mutation to meet every form of a condition and a rule many times over. */
const RUNS = 600;

const schema = buildJsonSchema(PACKAGE_VERSION);
const ajv = new Ajv2020({ strict: true, allowUnionTypes: true });
ajv.addSchema(schema);

/** The validator for one definition of the schema, or for the whole document when no name is given. */
function validatorFor(definition?: "Condition" | "Rule" | "Rules" | "Model" | "ChoiceDimension" | "FirstValidDimension"): ValidateFunction {
  const id = typeof schema.$id === "string" ? schema.$id : "";
  const validate = ajv.getSchema(definition === undefined ? id : `${id}#/$defs/${definition}`);
  if (validate === undefined) throw new Error(`the schema has no ${definition ?? "root"} to validate against`);

  return validate;
}

const accepts = (definition: Parameters<typeof validatorFor>[0]): ((value: unknown) => boolean) => {
  const validate = validatorFor(definition);

  return (value) => validate(value);
};

/** Draws of JSON-shaped data: the valid shapes, with the names and values a rule or condition mentions kept to a small pool so that they collide as they do in practice. */
const NAMES = ["a", "b", "c"] as const;
const name = fc.oneof(fc.constantFrom(...NAMES), fc.string());
const scalar: fc.Arbitrary<Scalar> = fc.oneof(fc.string(), fc.double({ noNaN: true, noDefaultInfinity: true }), fc.integer(), fc.boolean(), fc.constant(null));
const MAX_OPERANDS = 3;
const MAX_DEPTH = 3;

/** Conditions of every form, nested to a bounded depth, with leaves first so the depth bound has one to fall back on. */
const condition = fc.letrec<{ condition: Condition }>((tie) => ({
  condition: fc.oneof(
    { maxDepth: MAX_DEPTH, depthSize: "small" },
    fc.record({ is: fc.tuple(name, scalar) }),
    fc.record({ in: fc.tuple(name, fc.array(scalar, { maxLength: MAX_OPERANDS })) }),
    fc.record({ unset: name }),
    fc.record({ set: name }),
    fc.record({ all: fc.array(tie("condition"), { maxLength: MAX_OPERANDS }) }),
    fc.record({ any: fc.array(tie("condition"), { maxLength: MAX_OPERANDS }) }),
    fc.record({ not: tie("condition") }),
  ),
})).condition;

/** The optional keys every rule form shares, each present or absent. */
const scope = fc.record({ when: condition, unless: condition, name: fc.string() }, { requiredKeys: [] });

const rule: fc.Arbitrary<Rule> = fc.oneof(
  fc.tuple(condition, scope).map(([body, rest]): Rule => ({ requires: body, ...rest })),
  fc.tuple(condition, scope).map(([body, rest]): Rule => ({ excludes: body, ...rest })),
  fc.tuple(condition, condition, scope).map(([antecedent, consequent, rest]): Rule => ({ implies: [antecedent, consequent], ...rest })),
);

const rules = fc.array(rule, { maxLength: MAX_OPERANDS });

/** A condition that mentions only the given dimensions, each compared only with values it can take, unset included where it can be unset. */
interface Mentionable {
  readonly name: string;
  readonly domain: readonly Scalar[];
  readonly unsettable: boolean;
}

function conditionOver(known: readonly Mentionable[]): fc.Arbitrary<Condition> {
  const [first, ...others] = known;
  if (first === undefined) return fc.constantFrom<Condition>({ all: [] }, { any: [] });

  const dimension = fc.constantFrom(first, ...others);
  const [firstUnsettable, ...otherUnsettable] = known.filter((candidate) => candidate.unsettable);
  const unsetLeaves = firstUnsettable === undefined ? [] : [fc.constantFrom(firstUnsettable, ...otherUnsettable).map((d): Condition => ({ unset: d.name }))];

  return fc.letrec<{ condition: Condition }>((tie) => ({
    condition: fc.oneof(
      { maxDepth: MAX_DEPTH, depthSize: "small" },
      dimension.chain((d) => fc.constantFrom(...d.domain).map((value): Condition => ({ is: [d.name, value] }))),
      dimension.chain((d) => fc.subarray([...d.domain]).map((values): Condition => ({ in: [d.name, values] }))),
      dimension.map((d): Condition => ({ set: d.name })),
      ...unsetLeaves,
      fc.array(tie("condition"), { maxLength: MAX_OPERANDS }).map((all): Condition => ({ all })),
      fc.array(tie("condition"), { maxLength: MAX_OPERANDS }).map((any): Condition => ({ any })),
      tie("condition").map((not): Condition => ({ not })),
    ),
  })).condition;
}

function ruleOver(known: readonly Mentionable[]): fc.Arbitrary<Rule> {
  const over = conditionOver(known);
  const optional = fc.record({ when: over, unless: over, name: fc.string() }, { requiredKeys: [] });

  return fc.oneof(
    fc.tuple(over, optional).map(([body, rest]): Rule => ({ requires: body, ...rest })),
    fc.tuple(over, optional).map(([body, rest]): Rule => ({ excludes: body, ...rest })),
    fc.tuple(over, over, optional).map(([antecedent, consequent, rest]): Rule => ({ implies: [antecedent, consequent], ...rest })),
  );
}

/** The data of a model that `defineModel` accepts: unique names, non-empty duplicate-free domains, activity conditions that mention only earlier dimensions, and rules that mention only dimensions and values the model has. */
interface ModelData {
  readonly dimensions: readonly Record<string, unknown>[];
  readonly rules?: readonly Rule[];
}

const MAX_DIMENSIONS = 4;
const MAX_DOMAIN = 3;

/** What each dimension of a model is before its conditions are drawn: its kind, its domain, and whether it has an activity condition (never the first, which has no earlier dimension to mention). */
interface Skeleton {
  readonly kind: "choice" | "first-valid";
  readonly domain: readonly Scalar[];
  readonly conditional: boolean;
}

const skeleton = fc.array(fc.record({ kind: fc.constantFrom("choice", "first-valid"), domain: fc.uniqueArray(scalar, { minLength: 1, maxLength: MAX_DOMAIN, selector: (value) => valueKey(value) }), conditional: fc.boolean() }), { minLength: 1, maxLength: MAX_DIMENSIONS }).map((dimensions): Skeleton[] => dimensions.map((dimension, index) => ({ ...dimension, conditional: index > 0 && dimension.conditional })));

const model: fc.Arbitrary<ModelData> = skeleton
  .chain((shape) => {
    const known: Mentionable[] = shape.map((dimension, index) => ({ name: `d${String(index)}`, domain: dimension.domain, unsettable: dimension.conditional }));
    // `defineModel` refuses a rule that mentions a first-valid dimension together with one declared after it, so rules mention the choice dimensions and, as the latest, a final first-valid one.
    const constrainable = known.filter((_candidate, index) => shape[index]?.kind === "choice" || index === known.length - 1);
    const activity = shape.map((dimension, index) => (dimension.conditional ? conditionOver(known.slice(0, index)) : fc.constant(undefined)));

    return fc.tuple(fc.tuple(...activity), fc.option(fc.array(ruleOver(constrainable), { maxLength: MAX_OPERANDS }), { nil: undefined })).map(([conditions, rulesData]): ModelData => {
      const dimensions = shape.map((dimension, index) => ({ kind: dimension.kind, name: `d${String(index)}`, [dimension.kind === "choice" ? "values" : "candidates"]: dimension.domain, ...(conditions[index] === undefined ? {} : { activeWhen: conditions[index] }) }));

      return rulesData === undefined ? { dimensions } : { dimensions, rules: rulesData };
    });
  })
  .filter((data) => definesModel(data));

/** Calls `defineModel` as untyped JavaScript would, with data that never met its types. */
function defineAs(definition: unknown): unknown {
  return Reflect.apply(defineModel, undefined, [definition]);
}

/** The issues `defineModel` refuses the definition with: empty when it accepts, and a single entry for a failure that is not a `ModelError`, which no data should cause. */
function refusalsOf(definition: unknown): readonly string[] {
  try {
    defineAs(definition);

    return [];
  } catch (error) {
    return error instanceof ModelError ? error.issues : [`not a ModelError: ${String(error)}`];
  }
}

function definesModel(definition: unknown): boolean {
  return refusalsOf(definition).length === 0;
}

/** The refusals that depend on the whole model, which a JSON Schema cannot state: a repeated dimension name, and a reference to a dimension or a value the model lacks, or declared later. */
const BEYOND_A_SCHEMA = [/ is declared more than once$/u, / which is not a dimension declared before it$/u, / mentions unknown dimension /u, / which it can never take$/u, / depends on unknown dimension /u, /, so its candidate could not be chosen from earlier values alone$/u];

/** A way to damage a value at one node, each of which breaks the shape a schema describes in a different manner. */
const MUTATIONS = ["remove", "retype", "add-key", "resize", "wrap"] as const;
type Mutation = (typeof MUTATIONS)[number];

/** Values put in a node's place: every JSON type, an empty container, a non-finite number, and a well-formed condition. */
const REPLACEMENTS: readonly unknown[] = [null, true, 0, "", "x", [], {}, { unknown: 1 }, Number.NaN, Number.POSITIVE_INFINITY, [null], ["a", 1], { is: ["a", 1] }, { set: "a" }];

/** Keys put into an object: a misspelt key, another form's key, and a key the schema never has. */
const EXTRA_ENTRIES: readonly (readonly [string, unknown])[] = [
  ["extra", 1],
  ["set", "a"],
  ["requires", { set: "a" }],
  ["kind", "computed"],
  ["name", 1],
  ["activeWhen", 1],
];

type Path = readonly (string | number)[];

/** Whether a value is an array, typed so that its elements are `unknown` rather than `any`. */
function isList(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The path of every node of a JSON-shaped value, the root included. */
function pathsOf(value: unknown, prefix: Path = []): Path[] {
  const children: Path[] = Array.isArray(value) ? value.flatMap((item: unknown, index) => pathsOf(item, [...prefix, index])) : isRecord(value) ? Object.entries(value).flatMap(([key, item]) => pathsOf(item, [...prefix, key])) : [];

  return [prefix, ...children];
}

/** A copy of the value with the node at the path replaced by what `change` makes of it; `change` returning the `REMOVE` marker deletes the node from its parent. */
const REMOVE = Symbol("remove");

function changeAt(value: unknown, path: Path, change: (node: unknown) => unknown): unknown {
  const [step, ...rest] = path;
  if (step === undefined) return change(value);

  if (Array.isArray(value) && typeof step === "number") {
    const next: unknown = changeAt(value[step], rest, change);

    return next === REMOVE ? value.filter((_item: unknown, index) => index !== step) : value.map((item: unknown, index) => (index === step ? next : item));
  }
  if (isRecord(value) && typeof step === "string") {
    const next: unknown = changeAt(value[step], rest, change);

    return next === REMOVE ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== step)) : { ...value, [step]: next };
  }

  return value;
}

function mutate(value: unknown, mutation: Mutation, at: number, pick: number): unknown {
  const paths = pathsOf(value);
  const path = paths[at % paths.length] ?? [];
  const replacement = REPLACEMENTS[pick % REPLACEMENTS.length];
  const entry = EXTRA_ENTRIES[pick % EXTRA_ENTRIES.length] ?? ["extra", 1];

  return changeAt(value, path, (node) => {
    if (mutation === "remove") return path.length === 0 ? replacement : REMOVE;
    if (mutation === "retype") return replacement;
    if (mutation === "add-key") return isRecord(node) ? { ...node, [entry[0]]: entry[1] } : replacement;
    if (mutation === "resize") {
      if (!isList(node)) return replacement;

      return pick % 2 === 0 ? [...node, node[0] ?? null] : node.slice(0, -1);
    }

    return pick % 2 === 0 ? [node] : { not: node };
  });
}

/** Near misses of a valid value: it with one node mutated. */
function nearMiss<T>(valid: fc.Arbitrary<T>): fc.Arbitrary<{ readonly value: unknown; readonly mutation: Mutation }> {
  return fc.tuple(valid, fc.constantFrom(...MUTATIONS), fc.nat(), fc.nat()).map(([value, mutation, at, pick]) => ({ value: mutate(value, mutation, at, pick), mutation }));
}

/**
 * Requires `guard` and the validator to give the same verdict on every valid draw and every near miss, and, so that the property cannot pass by never discriminating, requires that the near misses were accepted at least once and that each kind of damage was refused at least once. `beyondShape` is for a guard that also checks what a schema cannot state: it must refuse exactly the data the schema accepts that fails `beyondShape`.
 */
function expectAgreement(valid: fc.Arbitrary<unknown>, guard: (value: unknown) => boolean, validates: (value: unknown) => boolean, beyondShape: (value: unknown) => boolean = () => true): void {
  fc.assert(
    fc.property(valid, (value) => {
      expect(guard(value)).toBe(true);
      expect(validates(value)).toBe(true);
    }),
    { seed: SEED, numRuns: RUNS },
  );

  let accepted = 0;
  const refused = new Set<Mutation>();
  fc.assert(
    fc.property(nearMiss(valid), ({ value, mutation }) => {
      const verdict = validates(value);
      expect(guard(value), JSON.stringify(value)).toBe(verdict && beyondShape(value));
      if (verdict) accepted += 1;
      else refused.add(mutation);
    }),
    { seed: SEED, numRuns: RUNS },
  );
  expect(accepted).toBeGreaterThan(0);
  expect([...refused].sort()).toEqual([...MUTATIONS].sort());
}

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
