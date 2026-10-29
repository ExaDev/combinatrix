import type { Condition } from "./condition";
import type { Rule } from "./rule";
import { treeShapeIssues } from "./trilean";

/** Whether a value is a plain object, as JSON parses one. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether an object has exactly the given keys, so no form is mistaken for another and no misspelt key is ignored. */
function hasExactKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const own = Object.keys(value);

  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/** Whether a value read from JSON (or anywhere else) is a well-formed condition: a trilean predicate tree, as trilean's schema states it, with no key the schema does not define. Dimension names and values, and the node kinds an assignment of dimensions cannot resolve, are checked against a model only by `defineModel`. */
export function isCondition(value: unknown): value is Condition {
  return treeShapeIssues(value).length === 0;
}

const RULE_FORMS = ["requires", "excludes", "implies"] as const;
const OPTIONAL_RULE_KEYS = ["when", "unless", "name"] as const;

/** Whether a value read from JSON (or anywhere else) is a well-formed rule: exactly one of `requires`, `excludes` and `implies`, with optional `when`, `unless` and `name` and nothing else. */
export function isRule(value: unknown): value is Rule {
  if (!isRecord(value)) return false;

  const forms = RULE_FORMS.filter((form) => Object.hasOwn(value, form));
  const [form] = forms;
  if (form === undefined || forms.length > 1) return false;

  const optional = OPTIONAL_RULE_KEYS.filter((key) => Object.hasOwn(value, key));
  if (!hasExactKeys(value, [form, ...optional])) return false;
  if (Object.hasOwn(value, "when") && !isCondition(value["when"])) return false;
  if (Object.hasOwn(value, "unless") && !isCondition(value["unless"])) return false;
  if (Object.hasOwn(value, "name") && typeof value["name"] !== "string") return false;

  const body = value[form];
  if (form !== "implies") return isCondition(body);

  return Array.isArray(body) && body.length === 2 && body.every(isCondition);
}

/** The keys of a rule that hold one condition each, and the one that holds a pair. */
const CONDITION_KEYS = ["when", "unless", "requires", "excludes"] as const;

/** Where the trees under the given keys of an object fail trilean's schema, each issue naming the key and the path in the tree: the detail behind a refusal of a rule or an `activeWhen` that is not a well-formed condition. A key holding a list (`implies`) is searched element by element. */
function treeDetails(value: Readonly<Record<string, unknown>>, keys: readonly string[], label: string): string[] {
  return keys.flatMap((key) => {
    if (!Object.hasOwn(value, key)) return [];

    const held = value[key];
    if (key === "implies" && Array.isArray(held)) return held.flatMap((tree: unknown, index) => treeShapeIssues(tree).map((issue) => `${label} implies[${String(index)}] at ${issue}`));

    return treeShapeIssues(held).map((issue) => `${label} ${key} at ${issue}`);
  });
}

/** Why a value is not a well-formed rule, labelled: the refusal itself, then where each of its conditions fails trilean's schema. Empty for a well-formed rule. `defineModel` and `parseRules` report a malformed rule with it. */
export function ruleShapeIssues(value: unknown, label: string): string[] {
  if (isRule(value)) return [];

  return [`${label} is not a well-formed rule`, ...(isRecord(value) ? treeDetails(value, [...CONDITION_KEYS, "implies"], label) : [])];
}

/** The key each kind of dimension holds its domain or inputs in, besides the `kind`, `name` and optional `activeWhen` every dimension has. */
const DIMENSION_KEYS = { choice: ["values"], "first-valid": ["candidates"], computed: ["reads", "compute"] } as const;

/** Why a value is not a well-formed dimension, or `undefined` when it is. Names and values are checked against the model by `defineModel`; this is the shape alone, which is what the published JSON Schema states for a dimension with literal values. */
function dimensionShapeIssue(value: unknown): string | undefined {
  if (!isRecord(value)) return "is not an object";

  const { kind } = value;
  if (kind !== "choice" && kind !== "first-valid" && kind !== "computed") return 'has a kind that is not "choice", "first-valid" or "computed"';

  const allowed: readonly string[] = ["kind", "name", "activeWhen", ...DIMENSION_KEYS[kind]];
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown !== undefined) return `has the unknown key "${unknown}"`;
  if (typeof value["name"] !== "string") return "has a name that is not a string";
  if (value["activeWhen"] !== undefined && !isCondition(value["activeWhen"])) return "has an activeWhen that is not a well-formed condition";
  if (kind === "computed") {
    const { reads } = value;
    if (!Array.isArray(reads) || !reads.every((read: unknown) => typeof read === "string")) return "has reads that are not a list of names";

    return typeof value["compute"] === "function" ? undefined : "has a compute that is not a function";
  }

  return Array.isArray(value[DIMENSION_KEYS[kind][0]]) ? undefined : `has ${DIMENSION_KEYS[kind][0]} that are not a list`;
}

/** The keys a model definition may have: the dimensions, the rules, and the constraints given through the contract, which are functions and so never data. */
const DEFINITION_KEYS: readonly string[] = ["dimensions", "rules", "constraints"];

/**
 * Every way a model definition fails to have the shape `defineModel` takes: an unknown key (so a misspelt `rules` is not ignored), dimensions or rules that are not lists, a dimension that is not well formed, a rule that is not well formed. It says nothing about names, values or references, which depend on the whole model.
 */
export function modelShapeIssues(definition: unknown): string[] {
  if (!isRecord(definition)) return ["the model definition is not an object"];

  const issues = Object.keys(definition)
    .filter((key) => !DEFINITION_KEYS.includes(key))
    .map((key) => `the model definition has the unknown key "${key}"`);
  const { dimensions, rules } = definition;
  if (Array.isArray(dimensions)) {
    dimensions.forEach((dimension: unknown, index) => {
      const issue = dimensionShapeIssue(dimension);
      if (issue !== undefined) issues.push(`dimension ${String(index)} ${issue}`, ...(isRecord(dimension) ? treeDetails(dimension, ["activeWhen"], `dimension ${String(index)}`) : []));
    });
  } else issues.push("the dimensions are not a list");
  if (Array.isArray(rules)) {
    rules.forEach((rule: unknown, index) => {
      if (!isRule(rule)) issues.push(...ruleShapeIssues(rule, `rule ${String(index)}`));
    });
  } else if (rules !== undefined) issues.push("the rules are not a list");

  return issues;
}
