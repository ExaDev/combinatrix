import { and, implies, not } from "trilean";

import type { Condition, TypedCondition } from "./condition";
import type { ValueRecord } from "./value";

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
 * A declarative constraint, as plain JSON-shaped data whose conditions are trilean predicate trees with any string as a dimension name: the form a rule read from JSON has. Exactly one of the three forms, each optionally scoped by `when` and `unless`:
 *
 * - `{ requires: condition }`: every combination in scope satisfies the condition.
 * - `{ excludes: condition }`: no combination in scope satisfies the condition.
 * - `{ implies: [antecedent, consequent] }`: every combination in scope that satisfies the antecedent satisfies the consequent.
 *
 * The rule states the single tree `ruleTree` builds from it. `isRule` checks data against this shape and `parseRules` checks it against a model's dimensions too. A rule whose conditions come from the builders is checked at compile time as a `TypedRule` instead.
 */
export type Rule = RuleOver<Condition>;

/** A rule whose every condition is a `TypedCondition<T>`, so the dimension names and the values its builders compare are checked against the dimensions at compile time. `T` is the type of one combination. A typed rule is a `Rule`. */
export type TypedRule<T extends ValueRecord> = RuleOver<TypedCondition<T>>;

/** Every condition a rule contains, scope first. */
export function ruleConditions(rule: Rule): Condition[] {
  const scope = [rule.when, rule.unless].filter((condition) => condition !== undefined);
  if ("requires" in rule) return [...scope, rule.requires];
  if ("excludes" in rule) return [...scope, rule.excludes];

  return [...scope, ...rule.implies];
}

/**
 * The one trilean predicate tree a rule states: `scope implies body`, where the scope is `when and not unless` and the body is the condition `requires` names, the negation of the one `excludes` names, or `antecedent implies consequent`. A rule with no scope is its body alone. Every part is a trilean connective, so the tree is evaluated, three-valued, wherever trilean is, and mentions the dimensions in the order `ruleConditions` lists them.
 */
export function ruleTree(rule: Rule): Condition {
  const scopes = [...(rule.when === undefined ? [] : [rule.when]), ...(rule.unless === undefined ? [] : [not(rule.unless)])];
  const [first, second] = scopes;
  const body = bodyTree(rule);
  if (first === undefined) return body;

  return implies(second === undefined ? first : and(first, second), body);
}

/** The tree of a rule's body, before its scope. */
function bodyTree(rule: Rule): Condition {
  if ("requires" in rule) return rule.requires;
  if ("excludes" in rule) return not(rule.excludes);

  return implies(...rule.implies);
}
