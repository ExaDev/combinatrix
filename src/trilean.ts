import type { ComputedValue, ExpressionNode, FunctionRegistry, JsonValue, PredicateNode, ReferenceNode, Resolution, SyncResolvers } from "trilean";
import { createSyncEvaluator, emptyFunctionRegistry, PredicateNodeSchema } from "trilean";
// The released trilean exports its default budgets from this module only; its package entry point re-exports them from the next release on.
import { DEFAULT_MAX_EVALUATION_NODES, DEFAULT_MAX_NESTING_DEPTH } from "trilean/evaluator-budget";

import type { Condition } from "./condition";
import type { Constraint, Verdict } from "./constraint";
import type { Dimension } from "./dimension";
import { domainOf, possibleKeys } from "./dimension";
import { UndecidedConstraintError, UnmappableValueError } from "./errors";
import type { PartialAssignment, Scalar, Value } from "./value";
import { describeValue, isScalar, valueKey } from "./value";

/** One node still to visit in the walk over a tree, with where it is and how deep. */
interface PendingNode {
  readonly node: PredicateNode | ExpressionNode;
  readonly path: string;
  readonly depth: number;
}

/** What a walk over a tree finds: its defects, the dimensions its references name in the order first met, its node count and its deepest node's depth. */
export interface TreeSurvey {
  readonly issues: string[];
  readonly references: string[];
  nodes: number;
  deepest: number;
}

/** A check the walk runs on every node besides its own, returning the node's defects. */
type NodeCheck = (node: PredicateNode | ExpressionNode, path: string) => readonly string[];

/** The node kinds the engine refuses: each needs a resolver an assignment of dimensions cannot back. */
type RefusedKind =
  | "some"
  | "every"
  | "fold"
  | "accumulator"
  | "lookup"
  | "delegate"
  | "treeReference";

/** Why each refused node kind cannot be evaluated over an assignment of dimensions. */
const REFUSED_KINDS: Readonly<Record<RefusedKind, string>> = {
  some: "it quantifies over a collection, and an assignment of dimensions resolves no collections",
  every:
    "it quantifies over a collection, and an assignment of dimensions resolves no collections",
  fold: "it folds over a collection, and an assignment of dimensions resolves no collections",
  accumulator: "it is meaningful only inside a fold, which is refused",
  lookup:
    "it reads a table, and an assignment of dimensions resolves no tables",
  delegate:
    "it defers to an external system, and the engine supplies no delegate resolver",
  treeReference:
    "it resolves another tree by key, and the engine supplies no tree resolver",
};

/**
 * Every way a value fails to be a trilean predicate tree: what trilean's `PredicateNodeSchema` refuses, and a key the schema does not define, which the schema's own parse would drop rather than refuse. Each names where in the tree it is (`$` is the root). Empty exactly when the value is a tree, so it is the runtime check behind `isCondition`, and it agrees with the published JSON Schema, which refuses an undefined key too.
 */
export function treeShapeIssues(value: unknown): string[] {
  const parsed = PredicateNodeSchema.safeParse(value);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${pathText(issue.path)}: ${issue.message} (not a trilean predicate tree)`);

  return strayKeys(value, parsed.data, "$");
}

/** The keys of `given` that the parse of it dropped, as `parsed` is what the schema kept of it, each with its path. */
function strayKeys(given: unknown, parsed: unknown, path: string): string[] {
  if (Array.isArray(given) && Array.isArray(parsed)) return given.flatMap((item: unknown, index) => strayKeys(item, parsed[index], `${path}[${String(index)}]`));
  if (!isPlainObject(given) || !isPlainObject(parsed)) return [];

  return Object.keys(given).flatMap((key) => (Object.hasOwn(parsed, key) ? strayKeys(given[key], parsed[key], `${path}.${key}`) : [`${path}: the key "${key}" is not one trilean defines there (not a trilean predicate tree)`]));
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Every defect in a well-formed tree that would keep it from being a constraint over the dimensions, found by walking it: a node kind the engine cannot resolve (`some`, `every`, `fold`, `accumulator`, `lookup`, `delegate`, `treeReference`), a `reference` whose key is not a string or names no dimension, a `reference` carrying a `unit` (dimension values carry none), a `call` (no function is registered, as under trilean's own default), and a referenced choice or first-valid dimension that can take `null`, which has no trilean value. The kinds accepted are listed explicitly, so a node kind trilean adds later is refused until the engine is taught it. `check` adds its own defects for each node. The walk is depth first without recursion, so a tree too deep to evaluate is reported by `budgetIssues` rather than overflowing the walk's own stack. The survey also lists the dimensions the tree references, in the order it first mentions them, which are a constraint's `dependencies`.
 */
export function surveyTree(root: Condition, byName: ReadonlyMap<string, Dimension>, check: NodeCheck = () => []): TreeSurvey {
  const survey: TreeSurvey = {
    issues: [],
    references: [],
    nodes: 0,
    deepest: 0,
  };
  const pending: PendingNode[] = [{ node: root, path: "$", depth: 0 }];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    survey.nodes += 1;
    survey.deepest = Math.max(survey.deepest, next.depth);
    survey.issues.push(...check(next.node, next.path));
    // The functions a `call` node may name are trilean's own default, the empty registry, so a tree means the same here as under trilean's bare evaluator and a `call` node is refused.
    const children = visit(next, survey, byName, emptyFunctionRegistry);
    // Pushed in reverse, so they are popped, and their references first met, in the order the tree lists them.
    for (const [suffix, child] of children.toReversed()) {
      pending.push({
        node: child,
        path: `${next.path}${suffix}`,
        depth: next.depth + 1,
      });
    }
  }

  return survey;
}

/** The defects of a tree whose evaluation could exhaust trilean's default evaluation budget. A tree the survey accepts visits each of its nodes at most once per evaluation, so its node count and depth are exactly what an evaluation can spend, and checking them when the model is defined means the budget is never met partway through an evaluation. */
export function budgetIssues(survey: Readonly<TreeSurvey>): string[] {
  return [
    ...(survey.nodes > DEFAULT_MAX_EVALUATION_NODES ? [`has ${String(survey.nodes)} nodes, more than the ${String(DEFAULT_MAX_EVALUATION_NODES)} one trilean evaluation may visit`] : []),
    ...(survey.deepest >= DEFAULT_MAX_NESTING_DEPTH ? [`nests to depth ${String(survey.deepest)}, and trilean evaluation refuses depth ${String(DEFAULT_MAX_NESTING_DEPTH)} and deeper`] : []),
  ];
}

/** How a constraint from a tree is named: `label` in the message of an error it throws, and `name`, when there is one, as its `Constraint.name`. */
export interface TreeNaming {
  readonly label: string;
  readonly name: string | undefined;
}

/**
 * The constraint a tree states over the dimensions, from a tree whose survey found no defects and whose `references` are its dependencies. Everything that does not depend on the assignment is made once, here, when the model is defined: the tree compiled by trilean's synchronous evaluator, its resolvers, and the set of values each dependency can take. Each evaluation only points the resolvers at its assignment and runs the compiled tree.
 *
 * `evaluate` answers `invalid` for an assignment giving a referenced choice or first-valid dimension a value it can never take, which no combination has (only a strategy's own test assignment can supply one), and otherwise runs the compiled tree with each reference resolved from the assignment: a dimension assigned a string, number or boolean resolves to that text, number or boolean; one assigned unset resolves as known absent (`{ found: false }`, so `exists` is definitely false); one not yet assigned resolves as not yet known (`{ found: false, notYetKnown: true }`, so `exists` and everything reading it stays indeterminate until it is assigned, which is what keeps a definite answer the answer on every completion). A definite true is `valid` and a definite false `invalid`. An indeterminate result is `unknown` while some dependency is unassigned, and throws `UndecidedConstraintError`, carrying trilean's reason and the `label`, once every dependency is assigned, since the contract forbids `unknown` there. A computed dimension that produces `null` throws `UnmappableValueError` when it is read.
 */
export function treeConstraint(tree: Condition, dependencies: readonly string[], byName: ReadonlyMap<string, Dimension>, naming: TreeNaming): Constraint {
  const { label, name } = naming;
  const evaluateTree = createSyncEvaluator({ functions: emptyFunctionRegistry }).compilePredicate(tree);
  const reader = assignmentResolvers();
  const possible = dependencies.map((dependency) => {
    const dimension = byName.get(dependency);

    return dimension === undefined ? undefined : possibleValues(dimension);
  });
  const evaluate = (assignment: PartialAssignment): Verdict => {
    const impossible = dependencies.some((dependency, index) => {
      const values = possible[index];

      return values !== undefined && assignment.has(dependency) && !values.has(assignment.get(dependency));
    });
    if (impossible) return "invalid";

    reader.assignment = assignment;
    const result = evaluateTree(undefined, reader.resolvers);
    if (result.status === "definite") return result.value ? "valid" : "invalid";
    if (dependencies.every((dependency) => assignment.has(dependency))) {
      throw new UndecidedConstraintError(label, result.reason);
    }

    return "unknown";
  };

  return name === undefined ? { dependencies, evaluate } : { dependencies, evaluate, name };
}

/** Records the node's own defects and references in the survey, and returns its children with the path suffix that reaches each. */
function visit(
  { node, path }: PendingNode,
  survey: TreeSurvey,
  byName: ReadonlyMap<string, Dimension>,
  functions: Readonly<FunctionRegistry>,
): (readonly [string, PredicateNode | ExpressionNode])[] {
  switch (node.kind) {
    case "not":
    case "exists":
    case "negate":
      return [[".operand", node.operand]];
    case "and":
    case "or":
    case "compare":
    case "textCompare":
    case "arithmetic":
      return [
        [".left", node.left],
        [".right", node.right],
      ];
    case "allOf":
    case "anyOf":
      return node.operands.map(
        (operand, index) => [`.operands[${String(index)}]`, operand] as const,
      );
    case "memberOf":
      return [
        [".operand", node.operand],
        ...node.candidates.map(
          (candidate, index) =>
            [`.candidates[${String(index)}]`, candidate] as const,
        ),
      ];
    case "call":
      if (!Object.hasOwn(functions, node.fn)) {
        survey.issues.push(
          `${path}: calls "${node.fn}", which the function registry does not hold`,
        );
      }

      return node.args.map(
        (argument, index) => [`.args[${String(index)}]`, argument] as const,
      );
    case "conditional":
      return [
        ...node.cases.flatMap(
          ({ when, then }, index) =>
            [
              [`.cases[${String(index)}].when`, when],
              [`.cases[${String(index)}].then`, then],
            ] as const,
        ),
        [".fallback", node.fallback],
      ];
    case "reference":
      checkReference(node, path, survey, byName);

      return [];
    case "numberLiteral":
    case "textLiteral":
    case "booleanLiteral":
    case "instantLiteral":
    case "durationLiteral":
    case "complexLiteral":
      return [];
    case "some":
    case "every":
    case "fold":
    case "accumulator":
    case "lookup":
    case "delegate":
    case "treeReference":
      survey.issues.push(
        `${path}: "${node.kind}" is not supported, because ${REFUSED_KINDS[node.kind]}`,
      );

      return [];
    default:
      return unreachableKind(node);
  }
}

/** Records a reference's defects, or the dimension it names when it has none. */
function checkReference(
  { key, unit }: ReferenceNode,
  path: string,
  survey: TreeSurvey,
  byName: ReadonlyMap<string, Dimension>,
): void {
  if (typeof key !== "string") {
    survey.issues.push(
      `${path}: the reference key ${JSON.stringify(key)} is not a string naming a dimension`,
    );

    return;
  }
  const dimension = byName.get(key);
  if (dimension === undefined) {
    survey.issues.push(
      `${path}: mentions unknown dimension "${key}"`,
    );

    return;
  }
  if (unit !== undefined) {
    survey.issues.push(
      `${path}: the reference to "${key}" carries a unit, and dimension values carry none, so it could never match`,
    );
  }
  if (survey.references.includes(key)) return;

  survey.references.push(key);
  if (declaredValues(dimension).includes(null)) {
    survey.issues.push(
      `${path}: dimension "${key}" can take null, which has no trilean value`,
    );
  }
}

/** The values a dimension declares: a choice's domain or a first-valid dimension's candidates. A computed dimension declares none, so its values are checked as they are read. */
function declaredValues(dimension: Dimension): readonly unknown[] {
  if (dimension.kind === "choice") return dimension.values;
  if (dimension.kind === "first-valid") return dimension.candidates;

  return [];
}

/** Resolvers made once for a constraint, reading each reference from whichever assignment was last set on the holder: the evaluation is synchronous and never re-enters the constraint, so the one being evaluated is the one set just before it. */
interface AssignmentResolvers {
  assignment: PartialAssignment;
  readonly resolvers: SyncResolvers;
}

/** Resolvers reading each reference from the holder's assignment. Only `resolveValue` is reachable: the tree was checked to hold no node kind that calls the others. */
function assignmentResolvers(): AssignmentResolvers {
  const reader: AssignmentResolvers = { assignment: new Map(), resolvers: { resolveValue, resolveLookup, resolveCollection } };

  function resolveValue(key: JsonValue): Resolution {
    const { assignment } = reader;
    if (typeof key !== "string") {
      throw new Error(`unreachable: every reference key was checked to be a string, not ${JSON.stringify(key)}`);
    }
    if (!assignment.has(key)) return { found: false, notYetKnown: true };

    const value = assignment.get(key);
    if (value === undefined) return { found: false };

    return { found: true, value: computedValueOf(key, value) };
  }

  return reader;
}

function resolveLookup(): never {
  throw new Error("unreachable: a tree with a lookup node is refused when the constraint is defined");
}

function resolveCollection(): never {
  throw new Error("unreachable: a tree with a collection node is refused when the constraint is defined");
}

/** Every value a choice or first-valid dimension can hold, unset included for a conditional one, or `undefined` for a computed one, whose values are not known ahead. The set's own equality, under which `0` and `-0` are one value, is the one `valueKey` gives a scalar, so a lookup needs no key. */
function possibleValues(dimension: Dimension): ReadonlySet<Value> | undefined {
  if (dimension.kind === "computed") return undefined;

  const values = new Set<Value>(domainOf(dimension));
  if (dimension.activeWhen !== undefined) values.add(undefined);

  return values;
}

/** A dimension's set value as trilean's value of the same kind: a string is text, a finite number is a number with no unit, a boolean is a boolean. `null` has no counterpart and throws. */
function computedValueOf(dimension: string, value: Scalar): ComputedValue {
  if (typeof value === "string") return { kind: "text", value };
  if (typeof value === "number") return { kind: "number", value };
  if (typeof value === "boolean") return { kind: "boolean", value };

  throw new UnmappableValueError(dimension, value);
}

/** A Zod issue path as the walk's path notation: `$`, then `.name` per key and `[n]` per index. */
function pathText(path: readonly PropertyKey[]): string {
  return path.reduce<string>(
    (text, segment) =>
      typeof segment === "number"
        ? `${text}[${String(segment)}]`
        : `${text}.${String(segment)}`,
    "$",
  );
}

/** Fails the build when trilean adds a node kind the walk does not list, and the walk at run time if a tree reaches it some other way. */
function unreachableKind(node: never): never {
  throw new Error(
    `unreachable: node kind ${JSON.stringify(node)} is not one the walk knows`,
  );
}

/** The kind of trilean value a dimension value maps to, or `null` for the one scalar that maps to none. */
type ValueKind = "text" | "number" | "boolean" | "null";

function kindOf(value: Scalar): ValueKind {
  if (typeof value === "string") return "text";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";

  return "null";
}

/** The scalar a literal node states, or `undefined` for any other node: the values a comparison is made against. */
function literalValue(node: ExpressionNode): Scalar | undefined {
  if (node.kind === "textLiteral" || node.kind === "numberLiteral" || node.kind === "booleanLiteral") return node.value;

  return undefined;
}

/** A comparison of one dimension, by a direct reference, with literal values: what the checks of `comparisonCheck` can judge from the model alone. `kinds` are the kinds of value the comparison accepts on the dimension's side; `values` are the literals it tests the dimension for equality with. */
interface Comparison {
  readonly dimension: string;
  readonly kinds: ReadonlySet<ValueKind> | undefined;
  readonly values: readonly Scalar[];
}

/** The comparison a node makes of a dimension, if it is one the model can judge: a `memberOf` of a reference among literals, or a `textCompare` or `compare` of a reference with a literal. */
function comparisonOf(node: PredicateNode | ExpressionNode): Comparison | undefined {
  if (node.kind === "memberOf") {
    if (node.operand.kind !== "reference" || typeof node.operand.key !== "string") return undefined;

    const values = node.candidates.map(literalValue).filter((value) => value !== undefined);

    return { dimension: node.operand.key, kinds: undefined, values };
  }
  if (node.kind !== "textCompare" && node.kind !== "compare") return undefined;

  const [operand, other] = node.left.kind === "reference" ? [node.left, node.right] : [node.right, node.left];
  if (operand.kind !== "reference" || typeof operand.key !== "string") return undefined;

  const value = literalValue(other);
  const equality = node.op === "equals" || node.op === "notEquals" || node.op === "eq" || node.op === "neq";

  return { dimension: operand.key, kinds: new Set([node.kind === "textCompare" ? "text" : "number"]), values: equality && value !== undefined ? [value] : [] };
}

/**
 * A node check refusing a comparison that could never be decided or never hold for the model's dimensions: comparing a dimension with a value it can never take, and comparing values of different kinds, which trilean leaves indeterminate (`wrong-type`) rather than unequal. A dimension compared by `memberOf` must have its values and the candidates all of one kind; one compared by `textCompare` must have only text values and by `compare` only numbers. A computed dimension's values are not known ahead, so it is left to the evaluation, which throws `UndecidedConstraintError` if a comparison of one stays indeterminate; an unknown dimension and one that can take `null` are reported by the survey itself. A test for unset is not refused here: `isUnset(d)` is the tree `not(exists(d))`, which is also `not(isSet(d))`, simply false for a dimension that is never unset, so only the builder's type refuses it, at compile time.
 */
export function comparisonCheck(byName: ReadonlyMap<string, Dimension>): NodeCheck {
  return (node, path) => {
    const comparison = comparisonOf(node);
    if (comparison === undefined) return [];

    const dimension = byName.get(comparison.dimension);
    const keys = dimension === undefined ? undefined : possibleKeys(dimension);
    if (dimension === undefined || keys === undefined) return [];

    const issues = comparison.values.filter((value) => !keys.has(valueKey(value))).map((value) => `${path}: compares "${dimension.name}" with ${describeValue(value)}, which it can never take`);
    const taken = domainKinds(dimension);
    const compared = comparison.kinds ?? new Set(comparison.values.map(kindOf));
    const kinds = new Set([...taken, ...compared]);
    kinds.delete("null");
    if (kinds.size > 1) issues.push(`${path}: compares "${dimension.name}" across value kinds (${[...kinds].join(", ")}), and trilean compares values of one kind only`);

    return issues;
  };
}

/** The kinds of the scalar values a choice or first-valid dimension can take. */
function domainKinds(dimension: Dimension): Set<ValueKind> {
  const values: readonly Value[] = dimension.kind === "choice" ? dimension.values : dimension.kind === "first-valid" ? dimension.candidates : [];

  return new Set(values.filter(isScalar).map(kindOf));
}
