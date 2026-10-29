import type { Condition } from "./condition";
import type { Rule } from "./rule";
import { isScalar } from "./value";

/** Whether a value is a plain object, as JSON parses one. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether an object has exactly the given keys, so no form is mistaken for another and no misspelt key is ignored. */
function hasExactKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const own = Object.keys(value);

  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/** Whether a value read from JSON (or anywhere else) is a well-formed condition. Dimension names and values are checked against a model only by `defineModel`. */
export function isCondition(value: unknown): value is Condition {
  if (!isRecord(value)) return false;

  const [form, ...rest] = Object.keys(value);
  if (form === undefined || rest.length > 0) return false;

  const operand = value[form];
  switch (form) {
    case "is":
      return Array.isArray(operand) && operand.length === 2 && typeof operand[0] === "string" && isScalar(operand[1]);
    case "in": {
      if (!Array.isArray(operand) || operand.length !== 2) return false;

      const dimension: unknown = operand[0];
      const values: unknown = operand[1];

      return typeof dimension === "string" && Array.isArray(values) && values.every(isScalar);
    }
    case "unset":
    case "set":
      return typeof operand === "string";
    case "all":
    case "any":
      return Array.isArray(operand) && operand.every(isCondition);
    case "not":
      return isCondition(operand);
    default:
      return false;
  }
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
      if (issue !== undefined) issues.push(`dimension ${String(index)} ${issue}`);
    });
  } else issues.push("the dimensions are not a list");
  if (Array.isArray(rules)) {
    rules.forEach((rule: unknown, index) => {
      if (!isRule(rule)) issues.push(`rule ${String(index)} is not a well-formed rule`);
    });
  } else if (rules !== undefined) issues.push("the rules are not a list");

  return issues;
}
