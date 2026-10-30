import type { Json, JsonObject } from "./json";
import { isJsonArray, isJsonObject } from "./json";
import type { RuleView } from "./modelEdit";

/** How each operator of a comparison reads in a sentence whose subject is the left side. */
const COMPARISONS: Readonly<Record<string, string>> = {
  eq: "is",
  neq: "is not",
  gt: "is greater than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  equals: "is",
  notEquals: "is not",
  matches: "matches",
  notMatches: "does not match",
  portableMatches: "matches",
  portableNotMatches: "does not match",
};

/** How each operator of arithmetic reads between its two sides. */
const ARITHMETIC: Readonly<Record<string, string>> = { add: "plus", subtract: "minus", multiply: "times", divide: "divided by", power: "to the power of", modulo: "modulo" };

/** The kinds that join several conditions, which are put in brackets when they sit inside another. */
const COMPOUND_KINDS: readonly string[] = ["and", "or", "allOf", "anyOf"];

function kindOf(node: Json): string | undefined {
  return isJsonObject(node) && typeof node["kind"] === "string" ? node["kind"] : undefined;
}

function field(node: JsonObject, key: string): Json {
  return node[key] ?? null;
}

/** An expression as words: a dimension by its name, a literal as it is written, arithmetic between its sides. A kind that has no reading here is named, never guessed at. */
function describeExpression(node: Json): string {
  const kind = kindOf(node);
  if (!isJsonObject(node) || kind === undefined) return "a value";
  const plain = !Object.hasOwn(node, "unit");

  if (kind === "reference" && typeof node["key"] === "string" && plain) return node["key"];
  if (kind === "textLiteral") return JSON.stringify(node["value"]);
  if (kind === "booleanLiteral" && typeof node["value"] === "boolean") return String(node["value"]);
  if (kind === "numberLiteral" && typeof node["value"] === "number" && plain) return String(node["value"]);
  if (kind === "negate") return `minus ${describeExpression(field(node, "operand"))}`;
  const operator = typeof node["op"] === "string" ? ARITHMETIC[node["op"]] : undefined;
  if (kind === "arithmetic" && operator !== undefined) return `(${describeExpression(field(node, "left"))} ${operator} ${describeExpression(field(node, "right"))})`;

  return `a ${kind} expression`;
}

/** The conditions of a list as one phrase: "a", "a and b", "a, b and c". */
function joined(parts: readonly string[], word: string): string {
  const last = parts.at(-1);
  if (last === undefined) return word === "and" ? "nothing is required" : "nothing holds";
  if (parts.length === 1) return last;

  return `${parts.slice(0, -1).join(", ")} ${word} ${last}`;
}

/** A condition inside another, in brackets when it joins several. */
function nested(node: Json): string {
  const text = describeCondition(node);

  return COMPOUND_KINDS.includes(kindOf(node) ?? "") ? `(${text})` : text;
}

/** A condition as a clause of a sentence, in the words of the dimensions and values it names. A kind that has no reading here is named, never guessed at. */
export function describeCondition(node: Json): string {
  const kind = kindOf(node);
  if (!isJsonObject(node) || kind === undefined) return "a condition";

  const operator = typeof node["op"] === "string" ? COMPARISONS[node["op"]] : undefined;
  if ((kind === "compare" || kind === "textCompare") && operator !== undefined) return `${describeExpression(field(node, "left"))} ${operator} ${describeExpression(field(node, "right"))}`;
  if (kind === "memberOf" && (node["op"] === "in" || node["op"] === "notIn")) {
    const candidates = field(node, "candidates");

    return `${describeExpression(field(node, "operand"))} ${node["op"] === "in" ? "is one of" : "is not one of"} ${isJsonArray(candidates) ? candidates.map(describeExpression).join(", ") : "a list"}`;
  }
  if (kind === "exists") return `${describeExpression(field(node, "operand"))} is set`;
  if (kind === "not") return `not ${nested(field(node, "operand"))}`;
  if (kind === "and" || kind === "or") return `${nested(field(node, "left"))} ${kind} ${nested(field(node, "right"))}`;
  if (kind === "allOf" || kind === "anyOf") {
    const operands = field(node, "operands");

    return isJsonArray(operands) ? joined(operands.map(nested), kind === "allOf" ? "and" : "or") : "a list of conditions";
  }

  return `a ${kind} condition`;
}

/** What a rule says, as one sentence: the condition it states, then the condition it applies when and the one it does not apply unless. */
export function describeRule(rule: RuleView): string {
  const { body } = rule;
  const stated =
    body.form === "implies"
      ? `If ${describeCondition(body.antecedent)}, then ${describeCondition(body.consequent)}`
      : body.form === "requires"
        ? `Every combination must satisfy: ${describeCondition(body.condition)}`
        : `No combination may satisfy: ${describeCondition(body.condition)}`;
  const when = rule.when === undefined ? "" : `, when ${describeCondition(rule.when)}`;
  const unless = rule.unless === undefined ? "" : `, unless ${describeCondition(rule.unless)}`;

  return `${stated}${when}${unless}.`;
}
