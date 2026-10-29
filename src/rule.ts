import type { Condition, Truth, TypedCondition } from "./condition";
import { conditionDependencies, conjunction, evaluateCondition, implication, negation } from "./condition";
import type { Constraint } from "./constraint";
import { verdictOf } from "./constraint";
import type { PartialAssignment, Value } from "./value";

/** The guards and label every rule form shares, over conditions of type `C`. */
interface RuleScope<C> {
  /** The rule applies only where this condition holds. */
  readonly when?: C;
  /** The rule does not apply where this condition holds. */
  readonly unless?: C;
  /** A label for diagnostics. */
  readonly name?: string;
}

/** The three rule forms over conditions of type `C`. */
type RuleOver<C> = (RuleScope<C> & { readonly requires: C }) | (RuleScope<C> & { readonly excludes: C }) | (RuleScope<C> & { readonly implies: readonly [C, C] });

/**
 * A declarative constraint, as plain JSON-shaped data with any string as a dimension name: the form a rule read from JSON has. Exactly one of the three forms, each optionally scoped by `when` and `unless`:
 *
 * - `{ requires: condition }`: every combination in scope satisfies the condition.
 * - `{ excludes: condition }`: no combination in scope satisfies the condition.
 * - `{ implies: [antecedent, consequent] }`: every combination in scope that satisfies the antecedent satisfies the consequent.
 *
 * `isRule` checks data against this shape and `parseRules` checks it against a model's dimensions too. A rule written in code is checked at compile time as a `TypedRule` instead.
 */
export type Rule = RuleOver<Condition>;

/** A rule whose every condition is a `TypedCondition<T>`, so its dimension names and the values it compares are checked against the dimensions at compile time. `T` is the type of one combination. A typed rule is a `Rule`. */
export type TypedRule<T extends Readonly<Record<string, Value>>> = RuleOver<TypedCondition<T>>;

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
