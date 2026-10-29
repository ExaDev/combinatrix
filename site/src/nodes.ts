import type { ExpressionNode, PredicateNode } from "trilean";
import { ArithmeticOperatorSchema, ComparisonOperatorSchema, DurationUnitSchema, ExpressionNodeSchema, HitPolicySchema, MembershipOperatorSchema, PredicateNodeSchema, TextComparisonOperatorSchema } from "trilean";

import { unreachable } from "./exhaustive";
import type { Json, JsonObject } from "./json";
import { isJsonArray, isJsonObject } from "./json";

/**
 * The trilean tree nodes a model's conditions are made of, as JSON, and how the form reads them. Every kind that trilean's schemas define has a widget: the kinds are read from the schemas below, so a kind trilean adds is a compile error where a kind is listed and a failing test where a widget is drawn.
 *
 * A node is *structured* when its keys and their types are exactly those its kind's schema defines. Only data that is not a node the schema accepts (a kind the schema does not define, a key it does not define, a field of the wrong type) is *raw*: it is shown as JSON text and never rewritten, so nothing the form is not asked to change is lost.
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

export type PredicateKind = PredicateNode["kind"];
export type ExpressionKind = ExpressionNode["kind"];

/** Every predicate kind of trilean's schema, in the schema's order. */
export const PREDICATE_KINDS: readonly PredicateKind[] = PredicateNodeSchema.options.map((option) => option.shape.kind.value);

/** Every expression kind of trilean's schema: its core union's, then the complex literal's two forms, which share one kind. */
export const EXPRESSION_KINDS: readonly ExpressionKind[] = ((): ExpressionKind[] => {
  const [core, complex] = ExpressionNodeSchema.options;

  return [...new Set<ExpressionKind>([...core.options.map((option) => option.shape.kind.value), ...complex.options.map((option) => option.shape.kind.value)])];
})();

/**
 * The kinds that trilean's schemas define and that combinatrix's `defineModel` nevertheless refuses in a model, each because it needs a resolver that an assignment of dimensions cannot back (a collection, a table, another tree or an external system) or a function registry, which is empty. The form builds and edits them like any other, and the page says so beside them. A test holds this list to what the library does.
 */
export const REFUSED_PREDICATE_KINDS: readonly PredicateKind[] = ["some", "every", "treeReference"];
export const REFUSED_EXPRESSION_KINDS: readonly ExpressionKind[] = ["call", "lookup", "fold", "accumulator", "delegate", "treeReference"];

/** A unit: a symbol for each dimension of measure with its exponent, such as `{ m: 1, s: -1 }`. */
export type Unit = JsonObject;

/** A node the schema does not accept, kept as it was read. `nodeKind` is its `kind` when it has a text one. */
export interface RawView {
  readonly kind: "raw";
  readonly json: Json;
  readonly nodeKind: string | undefined;
}

/** A predicate node as the form edits it. The children are JSON again, classified when the form reaches them. */
export type PredicateView =
  | { readonly kind: "not"; readonly operand: Json }
  | { readonly kind: "and" | "or"; readonly left: Json; readonly right: Json }
  | { readonly kind: "allOf" | "anyOf"; readonly operands: readonly Json[] }
  | { readonly kind: "compare"; readonly op: ComparisonOperator; readonly left: Json; readonly right: Json }
  | { readonly kind: "textCompare"; readonly op: TextComparisonOperator; readonly left: Json; readonly right: Json }
  | { readonly kind: "memberOf"; readonly op: MembershipOperator; readonly operand: Json; readonly candidates: readonly Json[] }
  | { readonly kind: "exists"; readonly operand: Json }
  | { readonly kind: "some" | "every"; readonly collection: Json; readonly item: Json; readonly filter: Json | undefined }
  | { readonly kind: "treeReference"; readonly key: Json }
  | RawView;

/** One case of a conditional expression. */
export interface ConditionalCase {
  readonly when: Json;
  readonly then: Json;
}

/** How a fold combines the items of a collection. */
export type FoldCombiner = { readonly mode: "max" | "min"; readonly item: Json } | { readonly mode: "reduce"; readonly initial: Json; readonly combine: Json };

export type FoldMode = FoldCombiner["mode"];

export const FOLD_MODES: readonly FoldMode[] = ["max", "min", "reduce"];

/** An expression node as the form edits it. */
export type ExpressionView =
  | { readonly kind: "textLiteral" | "instantLiteral"; readonly value: string }
  | { readonly kind: "numberLiteral"; readonly value: number; readonly unit: Unit | undefined }
  | { readonly kind: "booleanLiteral"; readonly value: boolean }
  | { readonly kind: "durationLiteral"; readonly value: number; readonly unit: DurationUnit }
  | { readonly kind: "complexLiteral"; readonly form: "rectangular"; readonly re: number; readonly im: number; readonly unit: Unit | undefined }
  | { readonly kind: "complexLiteral"; readonly form: "polar"; readonly magnitude: number; readonly phase: number; readonly unit: Unit | undefined }
  | { readonly kind: "reference"; readonly key: Json; readonly unit: Unit | undefined }
  | { readonly kind: "arithmetic"; readonly op: ArithmeticOperator; readonly left: Json; readonly right: Json }
  | { readonly kind: "negate"; readonly operand: Json }
  | { readonly kind: "call"; readonly fn: string; readonly args: readonly Json[] }
  | { readonly kind: "lookup"; readonly table: Json; readonly keys: readonly Json[] }
  | { readonly kind: "conditional"; readonly hitPolicy: HitPolicy | undefined; readonly cases: readonly ConditionalCase[]; readonly fallback: Json }
  | { readonly kind: "fold"; readonly collection: Json; readonly filter: Json | undefined; readonly combiner: FoldCombiner }
  | { readonly kind: "accumulator" }
  | { readonly kind: "delegate"; readonly system: string; readonly payload: Json }
  | { readonly kind: "treeReference"; readonly key: Json }
  | RawView;

export const PREDICATE_KIND_LABELS: Readonly<Record<PredicateKind, string>> = {
  not: "not",
  and: "both",
  or: "either",
  allOf: "all of",
  anyOf: "any of",
  compare: "compares numbers",
  textCompare: "compares text",
  memberOf: "is one of",
  exists: "is set",
  some: "some item of a collection satisfies",
  every: "every item of a collection satisfies",
  treeReference: "another tree, by key",
};

export const EXPRESSION_KIND_LABELS: Readonly<Record<ExpressionKind, string>> = {
  numberLiteral: "number",
  textLiteral: "text",
  booleanLiteral: "true or false",
  instantLiteral: "instant",
  durationLiteral: "duration",
  complexLiteral: "complex number",
  reference: "value of a dimension",
  arithmetic: "arithmetic",
  negate: "negative of",
  call: "function call",
  lookup: "table lookup",
  conditional: "conditional",
  fold: "fold over a collection",
  accumulator: "accumulator (inside a fold)",
  delegate: "delegate to another system",
  treeReference: "another tree, by key",
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

export const FOLD_MODE_LABELS: Readonly<Record<FoldMode, string>> = {
  max: "the largest item",
  min: "the smallest item",
  reduce: "reduce with a starting value",
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

/** Whether a value is a unit: an object whose every value is a number. */
export function isUnit(value: Json | undefined): value is Unit {
  return value !== undefined && isJsonObject(value) && Object.values(value).every((exponent) => typeof exponent === "number");
}

/** The unit of a node and whether it is well-formed: a node with a unit that is not one is not a node the schema accepts. */
function unitOf(object: JsonObject): { readonly unit: Unit | undefined; readonly valid: boolean } {
  const unit = object["unit"];
  if (unit === undefined) return { unit: undefined, valid: true };

  return isUnit(unit) ? { unit, valid: true } : { unit: undefined, valid: false };
}

/** The predicate a JSON value is, as far as the schema accepts it. */
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
    case "some":
    case "every":
      return hasKeys(json, ["kind", "collection", "item"], ["filter"]) ? { kind, collection: need(json, "collection"), item: need(json, "item"), filter: json["filter"] } : raw(json);
    case "treeReference":
      return hasKeys(json, ["kind", "key"]) ? { kind, key: need(json, "key") } : raw(json);
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

function foldCombiner(value: Json | undefined): FoldCombiner | undefined {
  if (value === undefined || !isJsonObject(value)) return undefined;
  const mode = value["mode"];
  if ((mode === "max" || mode === "min") && hasKeys(value, ["mode", "item"])) return { mode, item: need(value, "item") };

  return mode === "reduce" && hasKeys(value, ["mode", "initial", "combine"]) ? { mode, initial: need(value, "initial"), combine: need(value, "combine") } : undefined;
}

/** The expression a JSON value is, as far as the schema accepts it. */
export function classifyExpression(json: Json): ExpressionView {
  if (!isJsonObject(json)) return raw(json);
  const kind = nodeKindOf(json);
  const value = json["value"];
  const { unit, valid } = unitOf(json);
  switch (kind) {
    case "textLiteral":
    case "instantLiteral":
      return hasKeys(json, ["kind", "value"]) && typeof value === "string" ? { kind, value } : raw(json);
    case "numberLiteral":
      return hasKeys(json, ["kind", "value"], ["unit"]) && valid && typeof value === "number" ? { kind, value, unit } : raw(json);
    case "booleanLiteral":
      return hasKeys(json, ["kind", "value"]) && typeof value === "boolean" ? { kind, value } : raw(json);
    case "durationLiteral": {
      const durationUnit = json["unit"];

      return hasKeys(json, ["kind", "value", "unit"]) && typeof value === "number" && isMember(DURATION_UNITS, durationUnit) ? { kind, value, unit: durationUnit } : raw(json);
    }
    case "complexLiteral": {
      const { re, im, magnitude, phase } = json;
      if (hasKeys(json, ["kind", "re", "im"], ["unit"]) && valid && typeof re === "number" && typeof im === "number") return { kind, form: "rectangular", re, im, unit };

      return hasKeys(json, ["kind", "magnitude", "phase"], ["unit"]) && valid && typeof magnitude === "number" && typeof phase === "number" ? { kind, form: "polar", magnitude, phase, unit } : raw(json);
    }
    case "reference":
      return hasKeys(json, ["kind", "key"], ["unit"]) && valid ? { kind, key: need(json, "key"), unit } : raw(json);
    case "arithmetic": {
      const op = json["op"];

      return hasKeys(json, ["kind", "op", "left", "right"]) && isMember(ARITHMETIC_OPERATORS, op) ? { kind, op, left: need(json, "left"), right: need(json, "right") } : raw(json);
    }
    case "negate":
      return hasKeys(json, ["kind", "operand"]) ? { kind, operand: need(json, "operand") } : raw(json);
    case "call": {
      const fn = json["fn"];
      const args = json["args"];

      return hasKeys(json, ["kind", "fn", "args"]) && typeof fn === "string" && args !== undefined && isJsonArray(args) ? { kind, fn, args } : raw(json);
    }
    case "lookup": {
      const keys = json["keys"];

      return hasKeys(json, ["kind", "table", "keys"]) && keys !== undefined && isJsonArray(keys) ? { kind, table: need(json, "table"), keys } : raw(json);
    }
    case "conditional": {
      const hitPolicy = json["hitPolicy"];
      const cases = conditionalCases(json["cases"]);
      if (!hasKeys(json, ["kind", "cases", "fallback"], ["hitPolicy"]) || cases === undefined) return raw(json);
      if (hitPolicy === undefined) return { kind, hitPolicy: undefined, cases, fallback: need(json, "fallback") };

      return isMember(HIT_POLICIES, hitPolicy) ? { kind, hitPolicy, cases, fallback: need(json, "fallback") } : raw(json);
    }
    case "fold": {
      const combiner = foldCombiner(json["combiner"]);

      return hasKeys(json, ["kind", "collection", "combiner"], ["filter"]) && combiner !== undefined ? { kind, collection: need(json, "collection"), filter: json["filter"], combiner } : raw(json);
    }
    case "accumulator":
      return hasKeys(json, ["kind"]) ? { kind } : raw(json);
    case "delegate": {
      const system = json["system"];

      return hasKeys(json, ["kind", "system", "payload"]) && typeof system === "string" ? { kind, system, payload: need(json, "payload") } : raw(json);
    }
    case "treeReference":
      return hasKeys(json, ["kind", "key"]) ? { kind, key: need(json, "key") } : raw(json);
    case undefined:
    default:
      return raw(json);
  }
}

/** What new nodes hold until the user edits them. A key or collection starts empty, which names nothing until one is chosen. */
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
    case "some":
    case "every": {
      const filter = carried.predicates[1];

      return filter === undefined ? { kind, collection: EMPTY_TEXT, item: predicate(0) } : { kind, collection: EMPTY_TEXT, item: predicate(0), filter };
    }
    case "treeReference":
      return { kind, key: EMPTY_TEXT };
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
    case "call":
      return { kind, fn: EMPTY_TEXT, args: carried };
    case "lookup":
      return { kind, table: EMPTY_TEXT, keys: carried };
    case "conditional":
      return { kind, cases: [{ when: createPredicate("exists", names), then: operand(0) }], fallback: operand(1) };
    case "fold":
      return { kind, collection: EMPTY_TEXT, combiner: { mode: "max", item: operand(0) } };
    case "accumulator":
      return { kind };
    case "delegate":
      return { kind, system: EMPTY_TEXT, payload: null };
    case "treeReference":
      return { kind, key: EMPTY_TEXT };
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
    case "some":
    case "every":
      return { predicates: view.filter === undefined ? [view.item] : [view.item, view.filter], expressions: [] };
    case "compare":
    case "textCompare":
      return { predicates: [], expressions: [view.left, view.right] };
    case "memberOf":
      return { predicates: [], expressions: [view.operand, ...view.candidates] };
    case "exists":
      return { predicates: [], expressions: [view.operand] };
    case "treeReference":
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
    case "call":
      return view.args;
    case "lookup":
      return view.keys;
    case "conditional":
      return [view.fallback];
    case "fold":
      return view.combiner.mode === "reduce" ? [view.combiner.initial, view.combiner.combine] : [view.combiner.item];
    case "textLiteral":
    case "instantLiteral":
    case "numberLiteral":
    case "booleanLiteral":
    case "durationLiteral":
    case "complexLiteral":
    case "reference":
    case "accumulator":
    case "delegate":
    case "treeReference":
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

/** A fold's combiner with its mode changed, keeping the expression it can: `reduce` starts from the item a largest-or-smallest fold took, and the item of one starts from the starting value of a reduce. */
export function changeFoldMode(combiner: FoldCombiner, mode: FoldMode, names: readonly string[]): Json {
  if (combiner.mode === mode) return combiner.mode === "reduce" ? { mode, initial: combiner.initial, combine: combiner.combine } : { mode, item: combiner.item };
  const kept = combiner.mode === "reduce" ? combiner.initial : combiner.item;

  return mode === "reduce" ? { mode, initial: kept, combine: createExpression("numberLiteral", names) } : { mode, item: kept };
}

/** The combiner at a node of a fold with its mode changed, from the combiner the model holds now. Data that is not a combiner is returned as it is. */
export function changeFoldModeOf(current: Json, mode: FoldMode, names: readonly string[]): Json {
  const combiner = foldCombiner(current);

  return combiner === undefined ? current : changeFoldMode(combiner, mode, names);
}
