import type { Condition, Truth } from "./condition";
import { conditionDependencies, conjunction, evaluateCondition, implication, negation } from "./condition";
import type { Constraint } from "./constraint";
import { verdictOf } from "./constraint";
import type { PartialAssignment } from "./value";

/** The guards and label every rule form shares. */
interface RuleScope<N extends string> {
  /** The rule applies only where this condition holds. */
  readonly when?: Condition<N>;
  /** The rule does not apply where this condition holds. */
  readonly unless?: Condition<N>;
  /** A label for diagnostics. */
  readonly name?: string;
}

/**
 * A declarative constraint, as plain JSON-shaped data. Exactly one of the three forms, each optionally scoped by `when` and `unless`:
 *
 * - `{ requires: condition }`: every combination in scope satisfies the condition.
 * - `{ excludes: condition }`: no combination in scope satisfies the condition.
 * - `{ implies: [antecedent, consequent] }`: every combination in scope that satisfies the antecedent satisfies the consequent.
 */
export type Rule<N extends string = string> =
  | (RuleScope<N> & { readonly requires: Condition<N> })
  | (RuleScope<N> & { readonly excludes: Condition<N> })
  | (RuleScope<N> & { readonly implies: readonly [Condition<N>, Condition<N>] });

/** Whether a rule holds, with Kleene logic: `in scope implies body`, where the scope is `when and not unless`. */
export function evaluateRule(rule: Rule, assignment: PartialAssignment): Truth {
  const scope = conjunction([rule.when === undefined ? true : evaluateCondition(rule.when, assignment), rule.unless === undefined ? true : negation(evaluateCondition(rule.unless, assignment))]);

  return implication(scope, evaluateBody(rule, assignment));
}

function evaluateBody(rule: Rule, assignment: PartialAssignment): Truth {
  if ("requires" in rule) return evaluateCondition(rule.requires, assignment);
  if ("excludes" in rule) return negation(evaluateCondition(rule.excludes, assignment));

  const [antecedent, consequent] = rule.implies;

  return implication(evaluateCondition(antecedent, assignment), evaluateCondition(consequent, assignment));
}

/** Every condition a rule contains, scope first. */
export function ruleConditions(rule: Rule): Condition[] {
  const scope = [rule.when, rule.unless].filter((condition) => condition !== undefined);
  if ("requires" in rule) return [...scope, rule.requires];
  if ("excludes" in rule) return [...scope, rule.excludes];

  return [...scope, ...rule.implies];
}

/** The constraint a rule states, through the public contract. Its dependencies are every dimension the rule mentions. */
export function ruleConstraint(rule: Rule): Constraint {
  const dependencies = [...new Set(ruleConditions(rule).flatMap(conditionDependencies))];
  const evaluate = (assignment: PartialAssignment) => verdictOf(evaluateRule(rule, assignment));

  return rule.name === undefined ? { dependencies, evaluate } : { dependencies, evaluate, name: rule.name };
}
