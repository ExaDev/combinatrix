import type { ModelData, Scalar } from "combinatrix";

import { keysOf, unreachable } from "./exhaustive";
import type { Direction, Json, JsonObject, JsonStep, JsonType } from "./json";
import { addEntry, arrayAt, getIn, insertAt, isJsonArray, isJsonObject, moveAt, moveEntry, omit, removeAt, removeEntry, renameEntry, setIn, updateIn } from "./json";
import type { FoldCombiner, PredicateKind, RawView } from "./nodes";
import { classifyExpression, classifyPredicate, createPredicate } from "./nodes";

/**
 * The editor's model: the JSON a model is, edited by pure functions that each return a new model. Anything the form has no control for is never touched, so it survives every edit. What the form shows of the model is `viewOfModel`; the library, not these functions, decides whether the result is a valid model.
 */

/** The kinds of dimension the model's data form has: read from the library's `ModelData`, so a kind it gains is a compile error wherever a kind is listed below. */
export type DimensionKind = ModelData["dimensions"][number]["kind"];

export const DIMENSION_KIND_LABELS: Readonly<Record<DimensionKind, string>> = {
  choice: "free choice",
  "first-valid": "first valid candidate",
};

/** The key that holds each kind's domain. */
export const DOMAIN_KEYS: Readonly<Record<DimensionKind, string>> = { choice: "values", "first-valid": "candidates" };

/** Every dimension kind, from the record that has to say something about each. */
export const DIMENSION_KINDS: readonly DimensionKind[] = keysOf(DIMENSION_KIND_LABELS);

export type RuleForm = "requires" | "excludes" | "implies";

export const RULE_FORMS: readonly RuleForm[] = ["excludes", "requires", "implies"];

export const RULE_FORM_LABELS: Readonly<Record<RuleForm, string>> = {
  excludes: "excludes: no combination may satisfy",
  requires: "requires: every combination must satisfy",
  implies: "implies: if the first holds, the second must",
};

/** The condition keys a rule may carry beside its form. */
export type RuleScope = "when" | "unless";

export type ScalarType = "text" | "number" | "boolean" | "null";

export const SCALAR_TYPES: readonly ScalarType[] = ["text", "number", "boolean", "null"];

export const SCALAR_TYPE_LABELS: Readonly<Record<ScalarType, string>> = { text: "text", number: "number", boolean: "true or false", null: "null" };

/** A dimension the form can edit: a choice or first-valid dimension with exactly the keys the schema defines. */
export interface DimensionView {
  readonly kind: "dimension";
  readonly dimensionKind: DimensionKind;
  readonly name: string;
  readonly values: readonly Scalar[];
  readonly activeWhen: Json | undefined;
}

/** What a rule states: one condition, or an antecedent and a consequent. */
export type RuleBodyView = { readonly form: "requires" | "excludes"; readonly condition: Json } | { readonly form: "implies"; readonly antecedent: Json; readonly consequent: Json };

/** A rule the form can edit. */
export interface RuleView {
  readonly kind: "rule";
  readonly body: RuleBodyView;
  readonly name: string | undefined;
  readonly when: Json | undefined;
  readonly unless: Json | undefined;
}

export interface ModelView {
  readonly dimensions: readonly (DimensionView | RawView)[];
  /** `undefined` when the model has no `rules` key. */
  readonly rules: readonly (RuleView | RawView)[] | undefined;
  /** The top-level keys the form does not show, kept as they are. */
  readonly otherKeys: readonly string[];
}

export function isScalar(value: Json): value is Scalar {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function rawOf(json: Json): RawView {
  return { kind: "raw", json, nodeKind: isJsonObject(json) && typeof json["kind"] === "string" ? json["kind"] : undefined };
}

function hasOnlyKeys(object: JsonObject, required: readonly string[], optional: readonly string[]): boolean {
  return required.every((key) => Object.hasOwn(object, key)) && Object.keys(object).every((key) => required.includes(key) || optional.includes(key));
}

function dimensionKindOf(value: Json | undefined): DimensionKind | undefined {
  return DIMENSION_KINDS.find((kind) => kind === value);
}

/** A dimension the form edits, or the JSON of one it does not. */
export function classifyDimension(json: Json): DimensionView | RawView {
  if (!isJsonObject(json)) return rawOf(json);
  const dimensionKind = dimensionKindOf(json["kind"]);
  if (dimensionKind === undefined) return rawOf(json);

  const name = json["name"];
  const values = json[DOMAIN_KEYS[dimensionKind]];
  if (!hasOnlyKeys(json, ["kind", "name", DOMAIN_KEYS[dimensionKind]], ["activeWhen"])) return rawOf(json);
  if (typeof name !== "string" || values === undefined || !isJsonArray(values) || !values.every(isScalar)) return rawOf(json);

  return { kind: "dimension", dimensionKind, name, values, activeWhen: json["activeWhen"] };
}

const RULE_SCOPE_KEYS: readonly string[] = ["when", "unless", "name"];

/** A rule the form edits, or the JSON of one it does not. */
export function classifyRule(json: Json): RuleView | RawView {
  if (!isJsonObject(json)) return rawOf(json);
  const forms = RULE_FORMS.filter((form) => Object.hasOwn(json, form));
  const [form] = forms;
  if (form === undefined || forms.length !== 1) return rawOf(json);
  if (!hasOnlyKeys(json, [form], RULE_SCOPE_KEYS)) return rawOf(json);

  const name = json["name"];
  if (name !== undefined && typeof name !== "string") return rawOf(json);
  const when = json["when"];
  const unless = json["unless"];
  const stated = json[form];
  if (stated === undefined) throw new Error(`unreachable: key ${form} was checked to be present`);
  const scope = { name, when, unless };
  if (form !== "implies") return { kind: "rule", body: { form, condition: stated }, ...scope };

  const [antecedent, consequent] = isJsonArray(stated) ? stated : [];
  if (!isJsonArray(stated) || stated.length !== 2 || antecedent === undefined || consequent === undefined) return rawOf(json);

  return { kind: "rule", body: { form, antecedent, consequent }, ...scope };
}

/** Why the form cannot show a JSON value as a model, or `undefined` when it can. */
export function displayProblem(json: Json): string | undefined {
  if (!isJsonObject(json)) return "the top level is not an object, and a model is one";
  const { dimensions, rules } = json;
  if (dimensions === undefined || !isJsonArray(dimensions)) return 'there is no "dimensions" list';
  if (rules !== undefined && !isJsonArray(rules)) return 'the "rules" are not a list';

  return undefined;
}

/** What the form shows of a model that `displayProblem` accepts. */
export function viewOfModel(model: JsonObject): ModelView {
  const { dimensions, rules } = model;
  if (dimensions === undefined || !isJsonArray(dimensions) || (rules !== undefined && !isJsonArray(rules))) throw new Error("unreachable: the model was accepted by displayProblem");

  return {
    dimensions: dimensions.map(classifyDimension),
    rules: rules?.map(classifyRule),
    otherKeys: Object.keys(model).filter((key) => key !== "dimensions" && key !== "rules"),
  };
}

/** The names of the dimensions the form edits, in order. */
export function dimensionNames(model: JsonObject): string[] {
  return viewOfModel(model).dimensions.flatMap((dimension) => (dimension.kind === "raw" ? [] : [dimension.name]));
}

/** The model as an object again after an edit, which cannot have changed its type. */
function asModel(json: Json): JsonObject {
  if (!isJsonObject(json)) throw new Error("unreachable: an edit of a model's parts leaves it an object");

  return json;
}

// Dimensions

/** A name that is none of `taken`: the base, or the base followed by the smallest number that makes it new. */
export function uniqueName(taken: readonly string[], base: string): string {
  if (!taken.includes(base)) return base;
  let suffix = 2;
  while (taken.includes(`${base}${String(suffix)}`)) suffix += 1;

  return `${base}${String(suffix)}`;
}

const NEW_DIMENSION_NAME = "dimension";
const NEW_VALUE_TEXT = "value";

export function addDimension(model: JsonObject, kind: DimensionKind = "choice"): JsonObject {
  const name = uniqueName(dimensionNames(model), NEW_DIMENSION_NAME);
  const dimension: Json = { kind, name, [DOMAIN_KEYS[kind]]: [uniqueValueText([])] };

  return asModel(insertAt(model, ["dimensions"], arrayAt(model, ["dimensions"]).length, dimension));
}

export function removeDimension(model: JsonObject, index: number): JsonObject {
  return asModel(removeAt(model, ["dimensions"], index));
}

export function moveDimension(model: JsonObject, index: number, direction: Direction): JsonObject {
  return asModel(moveAt(model, ["dimensions"], index, direction));
}

/** A node with the children it has replaced by `change` of each, and every other key kept. */
function withChildren(node: Json, changes: Readonly<Record<string, Json | undefined>>): Json {
  return { ...objectOf(node), ...Object.fromEntries(Object.entries(changes).filter((entry): entry is [string, Json] => entry[1] !== undefined)) };
}

/** Every reference to a dimension in a predicate, renamed. Data that is not a node the schema accepts is returned as it is: its references are not the form's to rewrite. */
function renameInPredicate(node: Json, from: string, to: string): Json {
  const view = classifyPredicate(node);
  const predicate = (child: Json): Json => renameInPredicate(child, from, to);
  const expression = (child: Json): Json => renameInExpression(child, from, to);
  switch (view.kind) {
    case "not":
      return withChildren(node, { operand: predicate(view.operand) });
    case "and":
    case "or":
      return withChildren(node, { left: predicate(view.left), right: predicate(view.right) });
    case "allOf":
    case "anyOf":
      return withChildren(node, { operands: view.operands.map(predicate) });
    case "compare":
    case "textCompare":
      return withChildren(node, { left: expression(view.left), right: expression(view.right) });
    case "memberOf":
      return withChildren(node, { operand: expression(view.operand), candidates: view.candidates.map(expression) });
    case "exists":
      return withChildren(node, { operand: expression(view.operand) });
    case "some":
    case "every":
      return withChildren(node, { item: predicate(view.item), filter: view.filter === undefined ? undefined : predicate(view.filter) });
    case "treeReference":
    case "raw":
      return node;
    default:
      return unreachable(view);
  }
}

function renameInExpression(node: Json, from: string, to: string): Json {
  const view = classifyExpression(node);
  const predicate = (child: Json): Json => renameInPredicate(child, from, to);
  const expression = (child: Json): Json => renameInExpression(child, from, to);
  switch (view.kind) {
    case "reference":
      return view.key === from ? withChildren(node, { key: to }) : node;
    case "arithmetic":
      return withChildren(node, { left: expression(view.left), right: expression(view.right) });
    case "negate":
      return withChildren(node, { operand: expression(view.operand) });
    case "call":
      return withChildren(node, { args: view.args.map(expression) });
    case "lookup":
      return withChildren(node, { keys: view.keys.map(expression) });
    case "conditional":
      return withChildren(node, { cases: view.cases.map((item) => ({ when: predicate(item.when), then: expression(item.then) })), fallback: expression(view.fallback) });
    case "fold":
      return withChildren(node, { filter: view.filter === undefined ? undefined : predicate(view.filter), combiner: renameInCombiner(view.combiner, expression) });
    case "textLiteral":
    case "instantLiteral":
    case "numberLiteral":
    case "booleanLiteral":
    case "durationLiteral":
    case "complexLiteral":
    case "accumulator":
    case "delegate":
    case "treeReference":
    case "raw":
      return node;
    default:
      return unreachable(view);
  }
}

function renameInCombiner(combiner: FoldCombiner, expression: (child: Json) => Json): Json {
  return combiner.mode === "reduce" ? { mode: combiner.mode, initial: expression(combiner.initial), combine: expression(combiner.combine) } : { mode: combiner.mode, item: expression(combiner.item) };
}

function objectOf(json: Json): JsonObject {
  if (!isJsonObject(json)) throw new Error("unreachable: a classified node is an object");

  return json;
}

/** Renames a dimension, and every reference to it in the rules and in the activity conditions of the form's own dimensions, so the model keeps meaning what it meant. */
export function renameDimension(model: JsonObject, index: number, name: string): JsonObject {
  const view = viewOfModel(model);
  const dimension = view.dimensions[index];
  if (dimension === undefined) throw new Error(`no dimension at ${String(index)}`);
  if (dimension.kind === "raw") throw new Error("a dimension the form cannot edit has no name to change");
  const from = dimension.name;

  let renamed: Json = setIn(model, ["dimensions", index, "name"], name);
  renamed = updateIn(renamed, ["dimensions"], (current) => {
    if (!isJsonArray(current)) throw new Error("unreachable: dimensions is a list");

    return current.map((item) => {
      const shown = classifyDimension(item);
      if (shown.kind === "raw" || shown.activeWhen === undefined) return item;

      return { ...objectOf(item), activeWhen: renameInPredicate(shown.activeWhen, from, name) };
    });
  });
  const rules = getIn(renamed, ["rules"]);
  if (rules === undefined || !isJsonArray(rules)) return asModel(renamed);

  return asModel(setIn(renamed, ["rules"], rules.map((rule) => renameInRule(rule, from, name))));
}

function renameInRule(rule: Json, from: string, to: string): Json {
  const view = classifyRule(rule);
  if (view.kind !== "rule") return rule;

  const rename = (node: Json): Json => renameInPredicate(node, from, to);
  const edited: Record<string, Json> = { ...objectOf(rule) };
  if (view.body.form === "implies") edited["implies"] = [rename(view.body.antecedent), rename(view.body.consequent)];
  else edited[view.body.form] = rename(view.body.condition);
  if (view.when !== undefined) edited["when"] = rename(view.when);
  if (view.unless !== undefined) edited["unless"] = rename(view.unless);

  return edited;
}

/** The object with one key renamed in place, so the order of its keys is kept. */
function renameKey(object: JsonObject, from: string, to: string): JsonObject {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key === from ? to : key, value]));
}

/** Changes a dimension's kind; its domain moves to the key the new kind uses. */
export function setDimensionKind(model: JsonObject, index: number, kind: DimensionKind): JsonObject {
  return asModel(
    updateIn(model, ["dimensions", index], (current) => {
      const shown = classifyDimension(current);
      if (shown.kind === "raw") throw new Error("a dimension the form cannot edit has no kind to change");
      if (shown.dimensionKind === kind) return current;

      return { ...renameKey(objectOf(current), DOMAIN_KEYS[shown.dimensionKind], DOMAIN_KEYS[kind]), kind };
    }),
  );
}

function domainPath(model: JsonObject, index: number): readonly JsonStep[] {
  const shown = classifyDimension(arrayAt(model, ["dimensions"])[index] ?? null);
  if (shown.kind === "raw") throw new Error("a dimension the form cannot edit has no domain to change");

  return ["dimensions", index, DOMAIN_KEYS[shown.dimensionKind]];
}

/** A text no value of the domain already is, for a value added without one. */
function uniqueValueText(domain: readonly Json[]): string {
  const taken = domain.flatMap((value) => (typeof value === "string" ? [value] : []));

  return uniqueName(taken, NEW_VALUE_TEXT);
}

export function addValue(model: JsonObject, index: number): JsonObject {
  const path = domainPath(model, index);

  return asModel(insertAt(model, path, arrayAt(model, path).length, uniqueValueText(arrayAt(model, path))));
}

export function removeValue(model: JsonObject, index: number, position: number): JsonObject {
  return asModel(removeAt(model, domainPath(model, index), position));
}

export function moveValue(model: JsonObject, index: number, position: number, direction: Direction): JsonObject {
  return asModel(moveAt(model, domainPath(model, index), position, direction));
}

export function setValue(model: JsonObject, index: number, position: number, value: Scalar): JsonObject {
  return asModel(setIn(model, [...domainPath(model, index), position], value));
}

/** The model with the value at a position of a dimension's domain converted to the nearest value of another type, from the value the model holds now. */
export function convertValueAt(model: JsonObject, index: number, position: number, type: ScalarType): JsonObject {
  const value = getIn(model, [...domainPath(model, index), position]);
  if (value === undefined || !isScalar(value)) throw new Error(`no value at position ${String(position)} of dimension ${String(index)}`);

  return setValue(model, index, position, convertScalar(value, type));
}

export function scalarType(value: Scalar): ScalarType {
  if (value === null) return "null";
  if (typeof value === "string") return "text";
  if (typeof value === "number") return "number";

  return "boolean";
}

/** The number a text states, or `undefined` when it states none: finite, and not empty. Negative zero is written as zero, which is what JSON keeps of it. */
export function parseNumber(text: string): number | undefined {
  if (text.trim() === "") return undefined;
  const value = Number(text);
  if (!Number.isFinite(value)) return undefined;

  return value === 0 ? 0 : value;
}

/** A value of another type that is the nearest to this one: the text of a number, the number a text states, `true` for text "true" and for any number but zero. */
export function convertScalar(value: Scalar, type: ScalarType): Scalar {
  switch (type) {
    case "text":
      return value === null ? "" : String(value);
    case "number":
      if (typeof value === "number") return value;
      if (typeof value === "string") return parseNumber(value) ?? 0;

      return value === true ? 1 : 0;
    case "boolean":
      if (typeof value === "string") return value === "true";

      return typeof value === "number" ? value !== 0 : value === true;
    case "null":
      return null;
    default:
      return unreachable(type);
  }
}

/** A JSON value of another type that is the nearest to this one: scalars convert as `convertScalar` does, a list or object is kept when it is the type asked for, and a value of any other type becomes an empty one. */
export function convertJson(value: Json, type: JsonType): Json {
  switch (type) {
    case "text":
    case "number":
    case "boolean":
    case "null":
      return convertScalar(isScalar(value) ? value : null, type);
    case "list":
      return isJsonArray(value) ? value : [];
    case "object":
      return isJsonObject(value) && !isJsonArray(value) ? value : {};
    default:
      return unreachable(type);
  }
}

/** Sets or removes a dimension's activity condition. */
export function setActiveWhen(model: JsonObject, index: number, condition: Json | undefined): JsonObject {
  return asModel(
    updateIn(model, ["dimensions", index], (current) => {
      const object = objectOf(current);

      return condition === undefined ? omit(object, "activeWhen") : { ...object, activeWhen: condition };
    }),
  );
}

// Rules

export function addRule(model: JsonObject, names: readonly string[] = dimensionNames(model)): JsonObject {
  const rule: Json = { excludes: createPredicate("exists", names) };
  const rules = getIn(model, ["rules"]);
  if (rules === undefined) return { ...model, rules: [rule] };

  return asModel(insertAt(model, ["rules"], arrayAt(model, ["rules"]).length, rule));
}

export function removeRule(model: JsonObject, index: number): JsonObject {
  return asModel(removeAt(model, ["rules"], index));
}

export function moveRule(model: JsonObject, index: number, direction: Direction): JsonObject {
  return asModel(moveAt(model, ["rules"], index, direction));
}

/** Changes which of `requires`, `excludes` and `implies` a rule states. Between the first two the condition stays; to `implies` it becomes the antecedent beside a new consequent, and from it the antecedent becomes the condition. */
export function setRuleForm(model: JsonObject, index: number, form: RuleForm): JsonObject {
  return asModel(
    updateIn(model, ["rules", index], (current) => {
      const shown = classifyRule(current);
      if (shown.kind === "raw") throw new Error("a rule the form cannot edit has no form to change");
      if (shown.body.form === form) return current;

      const names = dimensionNames(model);
      const kept = shown.body.form === "implies" ? shown.body.antecedent : shown.body.condition;
      const stated: Json = form === "implies" ? [kept, createPredicate("exists", names)] : kept;

      return { ...renameKey(objectOf(current), shown.body.form, form), [form]: stated };
    }),
  );
}

/** Sets or removes a rule's label. */
export function setRuleName(model: JsonObject, index: number, name: string | undefined): JsonObject {
  return asModel(updateIn(model, ["rules", index], (current) => (name === undefined ? omit(objectOf(current), "name") : { ...objectOf(current), name })));
}

/** Sets or removes a rule's `when` or `unless` condition. */
export function setRuleScope(model: JsonObject, index: number, scope: RuleScope, condition: Json | undefined): JsonObject {
  return asModel(updateIn(model, ["rules", index], (current) => (condition === undefined ? omit(objectOf(current), scope) : { ...objectOf(current), [scope]: condition })));
}

// Conditions

/** The model with the node at `path` replaced. Paths run from the model: `["rules", 0, "excludes", "left"]`. */
export function setNode(model: JsonObject, path: readonly JsonStep[], node: Json): JsonObject {
  return asModel(setIn(model, path, node));
}

/** The model with the node at `path` replaced by a function of it. */
export function updateNode(model: JsonObject, path: readonly JsonStep[], change: (current: Json) => Json): JsonObject {
  return asModel(updateIn(model, path, change));
}

/** The model with a key added, at the end, to the object at `path`: how an optional field of a node is added. Throws when the key is already there. */
export function addKey(model: JsonObject, path: readonly JsonStep[], key: string, value: Json): JsonObject {
  return asModel(addEntry(model, path, key, value));
}

/** The model without a key of the object at `path`: how an optional field of a node is removed. */
export function removeKey(model: JsonObject, path: readonly JsonStep[], key: string): JsonObject {
  return asModel(removeEntry(model, path, key));
}

/** The model with a key of the object at `path` renamed in place. Throws when the new key is another entry's. */
export function renameKeyAt(model: JsonObject, path: readonly JsonStep[], from: string, to: string): JsonObject {
  return asModel(renameEntry(model, path, from, to));
}

/** The model with an entry of the object at `path` swapped with its neighbour. */
export function moveKey(model: JsonObject, path: readonly JsonStep[], key: string, direction: Direction): JsonObject {
  return asModel(moveEntry(model, path, key, direction));
}

export function addListItem(model: JsonObject, listPath: readonly JsonStep[], item: Json): JsonObject {
  return asModel(insertAt(model, listPath, arrayAt(model, listPath).length, item));
}

export function removeListItem(model: JsonObject, listPath: readonly JsonStep[], index: number): JsonObject {
  return asModel(removeAt(model, listPath, index));
}

export function moveListItem(model: JsonObject, listPath: readonly JsonStep[], index: number, direction: Direction): JsonObject {
  return asModel(moveAt(model, listPath, index, direction));
}

/** A new predicate of a kind, reading the model's first dimension. */
export function newPredicate(model: JsonObject, kind: PredicateKind): Json {
  return createPredicate(kind, dimensionNames(model));
}

/** The model that a new editor starts from. */
export const EMPTY_MODEL: JsonObject = { dimensions: [] };
