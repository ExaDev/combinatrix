import type { Condition } from "./condition";
import type { Dimension, TupleOf } from "./dimension";
import { ModelError } from "./errors";
import { ruleIssues } from "./model";
import type { Rule, TypedRule } from "./rule";
import type { Value } from "./value";
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

/**
 * Parses rules that arrive as data (parsed JSON, a configuration file) against the dimensions they are for, returning them typed so they can be passed to `defineModel` with no cast. Throws `ModelError` listing every defect: data that is not an array, an element that is not a well-formed rule, a mention of an unknown dimension, and a comparison with a value a dimension can never take. The dimensions' order and the first-valid restriction are checked by `defineModel`, which sees the whole model.
 */
export function parseRules<const Ds extends readonly Dimension[]>(dimensions: Ds, data: unknown): TypedRule<TupleOf<Ds>>[] {
  if (!Array.isArray(data)) throw new ModelError(["the rules are not an array"]);

  const byName = new Map(dimensions.map((dimension) => [dimension.name, dimension]));
  const issues: string[] = [];
  const rules: TypedRule<TupleOf<Ds>>[] = [];
  data.forEach((element: unknown, index) => {
    const label = `rule ${String(index)}`;
    if (!isRule(element)) issues.push(`${label} is not a well-formed rule`);
    else if (fitsDimensions<TupleOf<Ds>>(element, byName)) rules.push(element);
    else issues.push(...ruleIssues(element, byName, label));
  });
  if (issues.length > 0) throw new ModelError(issues);

  return rules;
}

/**
 * Whether a rule mentions only the given dimensions and compares each with values it can take, which is what `TypedRule<T>` states for the combination type `T` of those dimensions. A computed dimension's values are not known ahead, so any scalar compared with one is accepted, as `Model.isTuple` accepts any value for one.
 */
function fitsDimensions<T extends Readonly<Record<string, Value>>>(rule: Rule, byName: ReadonlyMap<string, Dimension>): rule is Rule & TypedRule<T> {
  return ruleIssues(rule, byName, "").length === 0;
}
