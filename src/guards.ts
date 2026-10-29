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
