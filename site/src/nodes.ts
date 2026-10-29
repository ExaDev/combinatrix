import { ArithmeticOperatorSchema, ComparisonOperatorSchema, DurationUnitSchema, HitPolicySchema, MembershipOperatorSchema, TextComparisonOperatorSchema } from "trilean";

import { unreachable } from "./exhaustive";
import type { Json, JsonObject } from "./json";
import { isJsonArray, isJsonObject } from "./json";

/**
 * The trilean tree nodes a model's conditions are made of, as JSON, and what the form can edit of them. A node is *structured* when its keys and their types are exactly those the form edits; any other node (a kind the form has no controls for, or one carrying a key it does not know) is *raw*, shown as JSON text and never rewritten, so every tree survives the form unchanged.
 */

export const COMPARISON_OPERATORS = ComparisonOperatorSchema.options;
export const TEXT_COMPARISON_OPERATORS = TextComparisonOperatorSchema.options;
export const MEMBERSHIP_OPERATORS = MembershipOperatorSchema.options;
export const ARITHMETIC_OPERATORS = ArithmeticOperatorSchema.options;
export const HIT_POLICIES = HitPolicySchema.options;
export const DURATION_UNITS = DurationUnitSchema.options;

export type ComparisonOperator = (typeof COMPARISON_OPERATORS)[number];
export type TextComparisonOperator = (typeof TEXT_COMPARISON_OPERATORS)[number];
export type MembershipOperator = (typeof MEMBERSHIP_OPERATORS)[number];
export type ArithmeticOperator = (typeof ARITHMETIC_OPERATORS)[number];
export type HitPolicy = (typeof HIT_POLICIES)[number];
export type DurationUnit = (typeof DURATION_UNITS)[number];

/** A node the form has no controls for, kept as it was read. `nodeKind` is its `kind` when it has a text one. */
export interface RawView {
  readonly kind: "raw";
  readonly json: Json;
  readonly nodeKind: string | undefined;
}

/** A predicate node (one that is true, false or unknown) as the form edits it. The children are JSON again, classified when the form reaches them. */
export type PredicateView =
  | { readonly kind: "not"; readonly operand: Json }
  | { readonly kind: "and" | "or"; readonly left: Json; readonly right: Json }
  | { readonly kind: "allOf" | "anyOf"; readonly operands: readonly Json[] }
  | { readonly kind: "compare"; readonly op: ComparisonOperator; readonly left: Json; readonly right: Json }
  | { readonly kind: "textCompare"; readonly op: TextComparisonOperator; readonly left: Json; readonly right: Json }
  | { readonly kind: "memberOf"; readonly op: MembershipOperator; readonly operand: Json; readonly candidates: readonly Json[] }
  | { readonly kind: "exists"; readonly operand: Json }
  | RawView;

/** One case of a conditional expression. */
export interface ConditionalCase {
  readonly when: Json;
  readonly then: Json;
}

/** An expression node (one that has a value) as the form edits it. */
export type ExpressionView =
  | { readonly kind: "textLiteral" | "instantLiteral"; readonly value: string }
  | { readonly kind: "numberLiteral"; readonly value: number }
  | { readonly kind: "booleanLiteral"; readonly value: boolean }
  | { readonly kind: "durationLiteral"; readonly value: number; readonly unit: DurationUnit }
  | { readonly kind: "complexLiteral"; readonly form: "rectangular"; readonly re: number; readonly im: number }
  | { readonly kind: "complexLiteral"; readonly form: "polar"; readonly magnitude: number; readonly phase: number }
  | { readonly kind: "reference"; readonly key: string }
  | { readonly kind: "arithmetic"; readonly op: ArithmeticOperator; readonly left: Json; readonly right: Json }
  | { readonly kind: "negate"; readonly operand: Json }
  | { readonly kind: "conditional"; readonly hitPolicy: HitPolicy | undefined; readonly cases: readonly ConditionalCase[]; readonly fallback: Json }
  | RawView;

export type PredicateKind = Exclude<PredicateView["kind"], "raw">;
export type ExpressionKind = Exclude<ExpressionView["kind"], "raw">;

/** The kinds the form builds, in the order its kind menus list them. */
export const PREDICATE_KINDS: readonly PredicateKind[] = ["exists", "textCompare", "compare", "memberOf", "not", "and", "or", "allOf", "anyOf"];
export const EXPRESSION_KINDS: readonly ExpressionKind[] = ["reference", "textLiteral", "numberLiteral", "booleanLiteral", "instantLiteral", "durationLiteral", "complexLiteral", "arithmetic", "negate", "conditional"];

/**
 * The kinds trilean's schemas accept that the form shows as raw JSON: combinatrix refuses each in a model (`defineModel` reports which and why), because it needs a resolver that an assignment of dimensions cannot back, or a function registry that is empty. They are listed so that a test can prove every kind of trilean's schemas is either built by the form or listed here.
 */
export const RAW_PREDICATE_KINDS: readonly string[] = ["some", "every", "treeReference"];
export const RAW_EXPRESSION_KINDS: readonly string[] = ["call", "lookup", "fold", "accumulator", "delegate", "treeReference"];

export const PREDICATE_KIND_LABELS: Readonly<Record<PredicateKind, string>> = {
  exists: "is set",
  textCompare: "compares text",
  compare: "compares numbers",
  memberOf: "is one of",
  not: "not",
  and: "both",
  or: "either",
  allOf: "all of",
  anyOf: "any of",
};

export const EXPRESSION_KIND_LABELS: Readonly<Record<ExpressionKind, string>> = {
  reference: "value of a dimension",
  textLiteral: "text",
  numberLiteral: "number",
  booleanLiteral: "true or false",
  instantLiteral: "instant",
  durationLiteral: "duration",
  complexLiteral: "complex number",
  arithmetic: "arithmetic",
  negate: "negative of",
  conditional: "conditional",
};

export const COMPARISON_LABELS: Readonly<Record<ComparisonOperator, string>> = {
  gt: "is greater than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  eq: "equals",
  neq: "does not equal",
};

export const TEXT_COMPARISON_LABELS: Readonly<Record<TextComparisonOperator, string>> = {
  equals: "equals",
  notEquals: "does not equal",
  matches: "matches the pattern",
  notMatches: "does not match the pattern",
  portableMatches: "matches the portable pattern",
  portableNotMatches: "does not match the portable pattern",
};

export const MEMBERSHIP_LABELS: Readonly<Record<MembershipOperator, string>> = {
  in: "is one of",
  notIn: "is none of",
};

export const ARITHMETIC_LABELS: Readonly<Record<ArithmeticOperator, string>> = {
  add: "plus",
  subtract: "minus",
  multiply: "times",
  divide: "divided by",
  power: "to the power of",
  modulo: "modulo",
};

export const HIT_POLICY_LABELS: Readonly<Record<HitPolicy, string>> = {
  first: "the first case that holds",
  unique: "the one case that holds",
};

/** The `kind` of a node, when it is an object with a text one. */
function nodeKindOf(json: Json): string | undefined {
  if (!isJsonObject(json)) return undefined;
  const kind = json["kind"];

  return typeof kind === "string" ? kind : undefined;
}

function raw(json: Json): RawView {
  return { kind: "raw", json, nodeKind: nodeKindOf(json) };
}

/** Whether an object has every required key and no key that is neither required nor optional. */
function hasKeys(object: JsonObject, required: readonly string[], optional: readonly string[] = []): boolean {
  return required.every((key) => Object.hasOwn(object, key)) && Object.keys(object).every((key) => required.includes(key) || optional.includes(key));
}

/** The value of a key the caller has checked is present. */
function need(object: JsonObject, key: string): Json {
  const value = object[key];
  if (value === undefined) throw new Error(`unreachable: key ${key} was checked to be present`);

  return value;
}

function isMember<const Options extends readonly string[]>(options: Options, value: Json | undefined): value is Options[number] {
  return typeof value === "string" && options.some((option) => option === value);
}

/** The predicate a JSON value is, as far as the form can edit it. */
export function classifyPredicate(json: Json): PredicateView {
  if (!isJsonObject(json)) return raw(json);
  const kind = nodeKindOf(json);
  switch (kind) {
    case "not":
      return hasKeys(json, ["kind", "operand"]) ? { kind, operand: need(json, "operand") } : raw(json);
    case "and":
    case "or":
      return hasKeys(json, ["kind", "left", "right"]) ? { kind, left: need(json, "left"), right: need(json, "right") } : raw(json);
    case "allOf":
    case "anyOf": {
      const operands = json["operands"];

      return hasKeys(json, ["kind", "operands"]) && operands !== undefined && isJsonArray(operands) ? { kind, operands } : raw(json);
    }
    case "compare": {
      const op = json["op"];

      return hasKeys(json, ["kind", "op", "left", "right"]) && isMember(COMPARISON_OPERATORS, op) ? { kind, op, left: need(json, "left"), right: need(json, "right") } : raw(json);
    }
    case "textCompare": {
      const op = json["op"];

      return hasKeys(json, ["kind", "op", "left", "right"]) && isMember(TEXT_COMPARISON_OPERATORS, op) ? { kind, op, left: need(json, "left"), right: need(json, "right") } : raw(json);
    }
    case "memberOf": {
      const op = json["op"];
      const candidates = json["candidates"];

      return hasKeys(json, ["kind", "op", "operand", "candidates"]) && isMember(MEMBERSHIP_OPERATORS, op) && candidates !== undefined && isJsonArray(candidates) ? { kind, op, operand: need(json, "operand"), candidates } : raw(json);
    }
    case "exists":
      return hasKeys(json, ["kind", "operand"]) ? { kind, operand: need(json, "operand") } : raw(json);
    case undefined:
    default:
      return raw(json);
  }
}

function conditionalCases(value: Json | undefined): readonly ConditionalCase[] | undefined {
  if (value === undefined || !isJsonArray(value)) return undefined;
  const cases: ConditionalCase[] = [];
  for (const item of value) {
    if (!isJsonObject(item) || !hasKeys(item, ["when", "then"])) return undefined;
    cases.push({ when: need(item, "when"), then: need(item, "then") });
  }

  return cases;
}

/** The expression a JSON value is, as far as the form can edit it. A literal or reference carrying a `unit` is raw: dimension values carry none, so the form has no control for it. */
export function classifyExpression(json: Json): ExpressionView {
  if (!isJsonObject(json)) return raw(json);
  const kind = nodeKindOf(json);
  const value = json["value"];
  switch (kind) {
    case "textLiteral":
    case "instantLiteral":
      return hasKeys(json, ["kind", "value"]) && typeof value === "string" ? { kind, value } : raw(json);
    case "numberLiteral":
      return hasKeys(json, ["kind", "value"]) && typeof value === "number" ? { kind, value } : raw(json);
    case "booleanLiteral":
      return hasKeys(json, ["kind", "value"]) && typeof value === "boolean" ? { kind, value } : raw(json);
    case "durationLiteral": {
      const unit = json["unit"];

      return hasKeys(json, ["kind", "value", "unit"]) && typeof value === "number" && isMember(DURATION_UNITS, unit) ? { kind, value, unit } : raw(json);
    }
    case "complexLiteral": {
      const { re, im, magnitude, phase } = json;
      if (hasKeys(json, ["kind", "re", "im"]) && typeof re === "number" && typeof im === "number") return { kind, form: "rectangular", re, im };

      return hasKeys(json, ["kind", "magnitude", "phase"]) && typeof magnitude === "number" && typeof phase === "number" ? { kind, form: "polar", magnitude, phase } : raw(json);
    }
    case "reference": {
      const key = json["key"];

      return hasKeys(json, ["kind", "key"]) && typeof key === "string" ? { kind, key } : raw(json);
    }
    case "arithmetic": {
      const op = json["op"];

      return hasKeys(json, ["kind", "op", "left", "right"]) && isMember(ARITHMETIC_OPERATORS, op) ? { kind, op, left: need(json, "left"), right: need(json, "right") } : raw(json);
    }
    case "negate":
      return hasKeys(json, ["kind", "operand"]) ? { kind, operand: need(json, "operand") } : raw(json);
    case "conditional": {
      const hitPolicy = json["hitPolicy"];
      const cases = conditionalCases(json["cases"]);
      if (!hasKeys(json, ["kind", "cases", "fallback"], ["hitPolicy"]) || cases === undefined) return raw(json);
      if (hitPolicy === undefined) return { kind, hitPolicy: undefined, cases, fallback: need(json, "fallback") };

      return isMember(HIT_POLICIES, hitPolicy) ? { kind, hitPolicy, cases, fallback: need(json, "fallback") } : raw(json);
    }
    case undefined:
    default:
      return raw(json);
  }
}

/** What new nodes hold until the user edits them. A reference starts on the first dimension; with none yet it is empty, which the library reports as an unknown dimension until one is chosen. */
const EMPTY_TEXT = "";
const ZERO = 0;
const DEFAULT_INSTANT = "2000-01-01T00:00:00Z";
const DEFAULT_DURATION: DurationUnit = "s";
const ONE = 1;

/** Nodes carried over from one kind to another, in the order the old kind listed them. */
export interface Carried {
  readonly predicates: readonly Json[];
  readonly expressions: readonly Json[];
}

const NOTHING_CARRIED: Carried = { predicates: [], expressions: [] };

export function createReference(names: readonly string[]): Json {
  return { kind: "reference", key: names[0] ?? EMPTY_TEXT };
}

export function createPredicate(kind: PredicateKind, names: readonly string[], carried: Carried = NOTHING_CARRIED): Json {
  const predicate = (position: number): Json => carried.predicates[position] ?? createPredicate("exists", names);
  const expression = (position: number, otherwise: () => Json): Json => carried.expressions[position] ?? otherwise();
  const reference = (position: number): Json => expression(position, () => createReference(names));
  switch (kind) {
    case "exists":
      return { kind, operand: reference(0) };
    case "textCompare":
      return { kind, op: "equals", left: reference(0), right: expression(1, () => createExpression("textLiteral", names)) };
    case "compare":
      return { kind, op: "eq", left: reference(0), right: expression(1, () => createExpression("numberLiteral", names)) };
    case "memberOf":
      return { kind, op: "in", operand: reference(0), candidates: carried.expressions.length > 1 ? carried.expressions.slice(1) : [createExpression("textLiteral", names)] };
    case "not":
      return { kind, operand: predicate(0) };
    case "and":
    case "or":
      return { kind, left: predicate(0), right: predicate(1) };
    case "allOf":
    case "anyOf":
      return { kind, operands: carried.predicates.length > 0 ? carried.predicates : [predicate(0)] };
    default:
      return unreachable(kind);
  }
}

export function createExpression(kind: ExpressionKind, names: readonly string[], carried: readonly Json[] = []): Json {
  const operand = (position: number): Json => carried[position] ?? createExpression("numberLiteral", names);
  switch (kind) {
    case "reference":
      return createReference(names);
    case "textLiteral":
      return { kind, value: EMPTY_TEXT };
    case "numberLiteral":
      return { kind, value: ZERO };
    case "booleanLiteral":
      return { kind, value: true };
    case "instantLiteral":
      return { kind, value: DEFAULT_INSTANT };
    case "durationLiteral":
      return { kind, value: ONE, unit: DEFAULT_DURATION };
    case "complexLiteral":
      return { kind, re: ZERO, im: ZERO };
    case "arithmetic":
      return { kind, op: "add", left: operand(0), right: operand(1) };
    case "negate":
      return { kind, operand: operand(0) };
    case "conditional":
      return { kind, cases: [{ when: createPredicate("exists", names), then: operand(0) }], fallback: operand(1) };
    default:
      return unreachable(kind);
  }
}

function carriedFromPredicate(view: PredicateView): Carried {
  switch (view.kind) {
    case "not":
      return { predicates: [view.operand], expressions: [] };
    case "and":
    case "or":
      return { predicates: [view.left, view.right], expressions: [] };
    case "allOf":
    case "anyOf":
      return { predicates: view.operands, expressions: [] };
    case "compare":
    case "textCompare":
      return { predicates: [], expressions: [view.left, view.right] };
    case "memberOf":
      return { predicates: [], expressions: [view.operand, ...view.candidates] };
    case "exists":
      return { predicates: [], expressions: [view.operand] };
    case "raw":
      return NOTHING_CARRIED;
    default:
      return unreachable(view);
  }
}

/** The predicate with its kind changed, keeping the children the new kind has places for, in order: `both` to `all of` keeps both operands, `is set` to `compares text` keeps the dimension it reads. */
export function changePredicateKind(current: Json, kind: PredicateKind, names: readonly string[]): Json {
  const view = classifyPredicate(current);
  if (view.kind === kind) return current;

  return createPredicate(kind, names, carriedFromPredicate(view));
}

function carriedFromExpression(view: ExpressionView): readonly Json[] {
  switch (view.kind) {
    case "arithmetic":
      return [view.left, view.right];
    case "negate":
      return [view.operand];
    case "conditional":
      return [view.fallback];
    case "textLiteral":
    case "instantLiteral":
    case "numberLiteral":
    case "booleanLiteral":
    case "durationLiteral":
    case "complexLiteral":
    case "reference":
    case "raw":
      return [];
    default:
      return unreachable(view);
  }
}

/** The expression with its kind changed, keeping its operands where the new kind has them. */
export function changeExpressionKind(current: Json, kind: ExpressionKind, names: readonly string[]): Json {
  const view = classifyExpression(current);
  if (view.kind === kind) return current;

  return createExpression(kind, names, carriedFromExpression(view));
}
