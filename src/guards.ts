import type { Dimension, TupleOf } from "./dimension";
import { ModelError } from "./errors";
import { ruleIssues } from "./model";
import type { Rule, TypedRule } from "./rule";
import { isRule } from "./shape";
import type { Value } from "./value";

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
