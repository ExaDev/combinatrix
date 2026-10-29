import Ajv2020 from "ajv/dist/2020";
import type { ValidateFunction } from "ajv/dist/2020";
import * as fc from "fast-check";
import { expect } from "vitest";

import { and, or } from "trilean";

import type { Comparable, Condition } from "../src/condition";
import { allOf, anyOf, defineModel, is, isSet, isUnset, ModelError, not, oneOf } from "../src/index";
import type { Rule } from "../src/rule";
import type { Scalar } from "../src/value";
import { valueKey } from "../src/value";
import { buildJsonSchema, PACKAGE_VERSION } from "./json-schema";

/**
 * The seeded generators, the mutations and the agreement check the JSON Schema suites share: valid data of every shape the schema describes, near misses of it, and a comparison of a guard with a JSON Schema validator over both.
 */

/** Fixed, so a failure reproduces. */
export const SEED = 20_261_029;
/** Runs per property: enough for every mutation to meet every node kind of a condition and every form of a rule many times over. */
export const RUNS = 600;

export const schema = buildJsonSchema(PACKAGE_VERSION);
const ajv = new Ajv2020({ strict: true, allowUnionTypes: true });
ajv.addSchema(schema);

/** The validator for one definition of the schema, or for the whole document when no name is given. */
export function validatorFor(definition?: "PredicateNode" | "Rule" | "Rules" | "Model" | "ChoiceDimension" | "FirstValidDimension"): ValidateFunction {
  const id = typeof schema.$id === "string" ? schema.$id : "";
  const validate = ajv.getSchema(definition === undefined ? id : `${id}#/$defs/${definition}`);
  if (validate === undefined) throw new Error(`the schema has no ${definition ?? "root"} to validate against`);

  return validate;
}

export const accepts = (definition: Parameters<typeof validatorFor>[0]): ((value: unknown) => boolean) => {
  const validate = validatorFor(definition);

  return (value) => validate(value);
};

/** Draws of JSON-shaped data: the valid shapes, with the names and values a rule or condition mentions kept to a small pool so that they collide as they do in practice. */
export const NAMES = ["a", "b", "c"] as const;
export const name = fc.oneof(fc.constantFrom(...NAMES), fc.string());
export const scalar: fc.Arbitrary<Scalar> = fc.oneof(fc.string(), fc.double({ noNaN: true, noDefaultInfinity: true }), fc.integer(), fc.boolean(), fc.constant(null));
export const MAX_OPERANDS = 3;
export const MAX_DEPTH = 3;

/** A value a condition can compare with: a scalar trilean has a literal for. */
export const comparable: fc.Arbitrary<Comparable> = fc.oneof(fc.string(), fc.double({ noNaN: true, noDefaultInfinity: true }), fc.integer(), fc.boolean());

/** A reference to a dimension by name. */
const reference = (key: string) => ({ kind: "reference", key }) as const;

/** The trilean literal of a comparable value. */
function literal(value: Comparable) {
  if (typeof value === "string") return { kind: "textLiteral", value } as const;
  if (typeof value === "number") return { kind: "numberLiteral", value } as const;

  return { kind: "booleanLiteral", value } as const;
}

/** Trilean predicate trees of the node kinds a condition over dimensions uses, nested to a bounded depth, with leaves first so the depth bound has one to fall back on: the builders' forms, the binary connectives, and the text and number comparisons a tree written by hand uses. Any name and any value, since the shape is all a schema states. */
export const condition = fc.letrec<{ condition: Condition }>((tie) => ({
  condition: fc.oneof(
    { maxDepth: MAX_DEPTH, depthSize: "small" },
    name.map((key): Condition => ({ kind: "exists", operand: reference(key) })),
    fc.tuple(name, fc.array(comparable, { maxLength: MAX_OPERANDS }), fc.constantFrom("in", "notIn")).map(([key, values, op]): Condition => ({ kind: "memberOf", op, operand: reference(key), candidates: values.map(literal) })),
    fc.tuple(name, fc.string(), fc.constantFrom("equals", "notEquals")).map(([key, value, op]): Condition => ({ kind: "textCompare", op, left: reference(key), right: literal(value) })),
    fc.tuple(name, fc.integer(), fc.constantFrom("eq", "neq", "lt", "lte", "gt", "gte")).map(([key, value, op]): Condition => ({ kind: "compare", op, left: reference(key), right: literal(value) })),
    fc.array(tie("condition"), { maxLength: MAX_OPERANDS }).map((operands): Condition => ({ kind: "allOf", operands })),
    fc.array(tie("condition"), { maxLength: MAX_OPERANDS }).map((operands): Condition => ({ kind: "anyOf", operands })),
    fc.tuple(tie("condition"), tie("condition")).map(([left, right]): Condition => and(left, right)),
    fc.tuple(tie("condition"), tie("condition")).map(([left, right]): Condition => or(left, right)),
    tie("condition").map((operand): Condition => ({ kind: "not", operand })),
  ),
})).condition;

/** The optional keys every rule form shares, each present or absent. */
export const scope = fc.record({ when: condition, unless: condition, name: fc.string() }, { requiredKeys: [] });

export const rule: fc.Arbitrary<Rule> = fc.oneof(
  fc.tuple(condition, scope).map(([body, rest]): Rule => ({ requires: body, ...rest })),
  fc.tuple(condition, scope).map(([body, rest]): Rule => ({ excludes: body, ...rest })),
  fc.tuple(condition, condition, scope).map(([antecedent, consequent, rest]): Rule => ({ implies: [antecedent, consequent], ...rest })),
);

export const rules = fc.array(rule, { maxLength: MAX_OPERANDS });

/** A dimension a condition may mention, with the values it can take and whether it can be unset. */
export interface Mentionable {
  readonly name: string;
  readonly domain: readonly Scalar[];
  readonly unsettable: boolean;
}

/** The kind of trilean value a scalar maps to, `null` having none. */
function kindOf(value: Scalar): string {
  return value === null ? "null" : typeof value;
}

/** Whether a dimension can be read by a condition at all: trilean has no value for `null`. */
export const readable = (dimension: Mentionable): boolean => !dimension.domain.includes(null);

/** Whether a dimension's values can be compared: they are all of one kind, and none is `null`. */
export const comparableDomain = (dimension: Mentionable): boolean => readable(dimension) && new Set(dimension.domain.map(kindOf)).size <= 1;

/** A condition, built with the library's builders, that `defineModel` accepts over the given dimensions: it reads only dimensions with no `null`, compares only those of one kind with values each can take, and tests for unset only one that can be unset. */
export function conditionOver(known: readonly Mentionable[]): fc.Arbitrary<Condition> {
  const [first, ...others] = known.filter(readable);
  if (first === undefined) return fc.constantFrom<Condition>(allOf(), anyOf());

  const dimension = fc.constantFrom(first, ...others);
  const [firstComparable, ...otherComparable] = [first, ...others].filter(comparableDomain);
  const comparisons =
    firstComparable === undefined
      ? []
      : [
          fc.constantFrom(firstComparable, ...otherComparable).chain((d) => fc.constantFrom(...d.domain.filter((value) => value !== null)).map((value): Condition => is(d.name, value))),
          fc.constantFrom(firstComparable, ...otherComparable).chain((d) => fc.subarray(d.domain.filter((value) => value !== null)).map((values): Condition => oneOf(d.name, values))),
        ];
  const [firstUnsettable, ...otherUnsettable] = [first, ...others].filter((candidate) => candidate.unsettable);
  const unsetLeaves = firstUnsettable === undefined ? [] : [fc.constantFrom(firstUnsettable, ...otherUnsettable).map((d): Condition => isUnset(d.name))];

  return fc.letrec<{ condition: Condition }>((tie) => ({
    condition: fc.oneof(
      { maxDepth: MAX_DEPTH, depthSize: "small" },
      ...comparisons,
      dimension.map((d): Condition => isSet(d.name)),
      ...unsetLeaves,
      fc.array(tie("condition"), { maxLength: MAX_OPERANDS }).map((operands): Condition => allOf(...operands)),
      fc.array(tie("condition"), { maxLength: MAX_OPERANDS }).map((operands): Condition => anyOf(...operands)),
      tie("condition").map((operand): Condition => not(operand)),
    ),
  })).condition;
}

export function ruleOver(known: readonly Mentionable[]): fc.Arbitrary<Rule> {
  const over = conditionOver(known);
  const optional = fc.record({ when: over, unless: over, name: fc.string() }, { requiredKeys: [] });

  return fc.oneof(
    fc.tuple(over, optional).map(([body, rest]): Rule => ({ requires: body, ...rest })),
    fc.tuple(over, optional).map(([body, rest]): Rule => ({ excludes: body, ...rest })),
    fc.tuple(over, over, optional).map(([antecedent, consequent, rest]): Rule => ({ implies: [antecedent, consequent], ...rest })),
  );
}

/** The data of a model that `defineModel` accepts: unique names, non-empty duplicate-free domains, activity conditions that mention only earlier dimensions, and rules that mention only dimensions and values the model has. */
export interface ModelData {
  readonly dimensions: readonly Record<string, unknown>[];
  readonly rules?: readonly Rule[];
}

export const MAX_DIMENSIONS = 4;
export const MAX_DOMAIN = 3;

/** What each dimension of a model is before its conditions are drawn: its kind, its domain, and whether it has an activity condition (never the first, which has no earlier dimension to mention). */
export interface Skeleton {
  readonly kind: "choice" | "first-valid";
  readonly domain: readonly Scalar[];
  readonly conditional: boolean;
}

export const skeleton = fc.array(fc.record({ kind: fc.constantFrom("choice", "first-valid"), domain: fc.uniqueArray(scalar, { minLength: 1, maxLength: MAX_DOMAIN, selector: (value) => valueKey(value) }), conditional: fc.boolean() }), { minLength: 1, maxLength: MAX_DIMENSIONS }).map((dimensions): Skeleton[] => dimensions.map((dimension, index) => ({ ...dimension, conditional: index > 0 && dimension.conditional })));

export const model: fc.Arbitrary<ModelData> = skeleton
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
export function defineAs(definition: unknown): unknown {
  return Reflect.apply(defineModel, undefined, [definition]);
}

/** The issues `defineModel` refuses the definition with: empty when it accepts, and a single entry for a failure that is not a `ModelError`, which no data should cause. */
export function refusalsOf(definition: unknown): readonly string[] {
  try {
    defineAs(definition);

    return [];
  } catch (error) {
    return error instanceof ModelError ? error.issues : [`not a ModelError: ${String(error)}`];
  }
}

export function definesModel(definition: unknown): boolean {
  return refusalsOf(definition).length === 0;
}

/** The refusals that depend on the whole model, which a JSON Schema cannot state: a repeated dimension name; a reference to a dimension or a value the model lacks, or declared later; a reference key that is not a dimension's name; and a condition trilean could not decide over the model's values, reading a dimension that can take `null` or comparing values of different kinds. */
export const BEYOND_A_SCHEMA = [
  / is declared more than once$/u,
  / which is not a dimension declared before it$/u,
  / mentions unknown dimension /u,
  / which it can never take$/u,
  / depends on unknown dimension /u,
  /, so its candidate could not be chosen from earlier values alone$/u,
  / is not a string naming a dimension$/u,
  / can take null, which has no trilean value$/u,
  /, and trilean compares values of one kind only$/u,
];

/** A way to damage a value at one node, each of which breaks the shape a schema describes in a different manner. */
export const MUTATIONS = ["remove", "retype", "add-key", "resize", "wrap"] as const;
export type Mutation = (typeof MUTATIONS)[number];

/** Values put in a node's place: every JSON type, an empty container, a non-finite number, a well-formed condition and a node of a kind no condition is. */
const REPLACEMENTS: readonly unknown[] = [null, true, 0, "", "x", [], {}, { unknown: 1 }, Number.NaN, Number.POSITIVE_INFINITY, [null], ["a", 1], { kind: "exists", operand: { kind: "reference", key: "a" } }, { kind: "textLiteral", value: "a" }];

/** Keys put into an object: a misspelt key, another node kind's key, another rule form's key, and a key the schema never has. */
const EXTRA_ENTRIES: readonly (readonly [string, unknown])[] = [
  ["extra", 1],
  ["operand", { kind: "reference", key: "a" }],
  ["requires", { kind: "exists", operand: { kind: "reference", key: "a" } }],
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

    return pick % 2 === 0 ? [node] : { kind: "not", operand: node };
  });
}

/** Near misses of a valid value: it with one node mutated. */
export function nearMiss<T>(valid: fc.Arbitrary<T>): fc.Arbitrary<{ readonly value: unknown; readonly mutation: Mutation }> {
  return fc.tuple(valid, fc.constantFrom(...MUTATIONS), fc.nat(), fc.nat()).map(([value, mutation, at, pick]) => ({ value: mutate(value, mutation, at, pick), mutation }));
}

/**
 * Requires `guard` and the validator to give the same verdict on every valid draw and every near miss, and, so that the property cannot pass by never discriminating, requires that the near misses were accepted at least once and that each kind of damage was refused at least once. `beyondShape` is for a guard that also checks what a schema cannot state: it must refuse exactly the data the schema accepts that fails `beyondShape`.
 */
export function expectAgreement(valid: fc.Arbitrary<unknown>, guard: (value: unknown) => boolean, validates: (value: unknown) => boolean, beyondShape: (value: unknown) => boolean = () => true): void {
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
