import { ExpressionNodeSchema, JsonValueSchema, PredicateNodeSchema } from "trilean";
import { z } from "zod";

import pkg from "../package.json";

/**
 * The Zod definitions of the library's serialisable data, from which `buildJsonSchema` derives the published JSON Schema. A condition is trilean's `PredicateNodeSchema` itself, so the schema states trilean trees exactly as trilean does. Zod is otherwise a development dependency used only for that derivation (trilean depends on it at runtime): the package validates at runtime with the guards in `src/guards.ts` and `src/shape.ts`, and `scripts/json-schema.unit.test.ts` proves the two accept and refuse the same data. `scripts/json-schema.types.unit.test.ts` proves at compile time that what each schema infers and the library type it describes accept the same data.
 *
 * Uniqueness of a domain's values (`uniqueItems`) is stated as schema metadata because Zod has no uniqueness constraint; the JSON Schema is the artefact validated against, never a Zod parse.
 */

/** A JSON value a dimension can take: a string, a finite number, a boolean or null. JSON cannot carry a non-finite number, so `number` here is `Scalar`'s number exactly. */
export const ScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]).meta({
  id: "Scalar",
  description: "A value a dimension can take that survives a JSON round trip unchanged: a string, a number, a boolean or null.",
});

/**
 * trilean's own schemas, given the names its published schema gives them so that the document's `$defs` reads as trilean's does. They are registered in Zod's global registry, which `z.toJSONSchema` reads, because trilean declares them without an id; registering is a side effect of loading this module, which only the build and the tests do.
 */
z.globalRegistry.add(PredicateNodeSchema, { id: "PredicateNode", description: "A trilean predicate tree: a condition over dimension values, whose `reference` nodes name dimensions, evaluated by trilean with Kleene's strong three-valued logic: a dimension not yet assigned is not yet known, and an unset one is absent. Dimension names and values, and node kinds an assignment of dimensions cannot back, are checked against a model's dimensions by the model, not by this schema." });
z.globalRegistry.add(ExpressionNodeSchema, { id: "ExpressionNode", description: "A trilean expression tree: a value a predicate compares, such as a `reference` to a dimension or a literal." });
z.globalRegistry.add(JsonValueSchema, { id: "JsonValue", description: "Any JSON value: what trilean takes as a reference key, which names a dimension when it is a string." });

/** A condition: trilean's predicate tree, under the name trilean gives it. */
export const ConditionSchema = PredicateNodeSchema;

/** The guards and label every rule form shares. */
const ruleScope = {
  when: ConditionSchema.optional().describe("The rule applies only where this condition holds."),
  unless: ConditionSchema.optional().describe("The rule does not apply where this condition holds."),
  name: z.string().optional().describe("A label for diagnostics."),
};

/** A declarative constraint: exactly one of three forms, each optionally scoped by `when` and `unless`. */
export const RuleSchema = z
  .union([
    z.strictObject({ requires: ConditionSchema.describe("Every combination in scope satisfies this condition."), ...ruleScope }),
    z.strictObject({ excludes: ConditionSchema.describe("No combination in scope satisfies this condition."), ...ruleScope }),
    z.strictObject({
      implies: z.tuple([ConditionSchema, ConditionSchema]).describe("Every combination in scope that satisfies the antecedent, given first, satisfies the consequent, given second."),
      ...ruleScope,
    }),
  ])
  .meta({
    id: "Rule",
    description: "A declarative constraint over dimension values: exactly one of `requires`, `excludes` and `implies`, with optional `when`, `unless` and `name` and no other key. Each condition is a trilean predicate tree, and the rule states the one tree `scope implies body`.",
  });

/** A list of rules: the form a rules file has. */
export const RulesSchema = z.array(RuleSchema).meta({ id: "Rules", description: "A list of rules, as read from a rules file." });

/** What a choice or first-valid dimension's domain must be: a non-empty list with no value twice. */
function domain(description: string) {
  return z.array(ScalarSchema).min(1).meta({ uniqueItems: true, description });
}

const dimensionName = z.string().min(1).describe("The dimension's name: its key in every combination. Unique within a model.");
const activeWhen = ConditionSchema.optional().describe("The dimension takes part only where this condition holds, and is unset elsewhere. It may mention only dimensions declared before this one.");

/** A dimension enumerated as a free choice among literal values. */
export const ChoiceDimensionSchema = z
  .strictObject({
    kind: z.literal("choice"),
    name: dimensionName,
    values: domain("The values the dimension takes, in the order enumerated. At least one, none repeated."),
    activeWhen,
  })
  .meta({ id: "ChoiceDimension", description: "A free dimension over a finite list of literal values, in order." });

/** A derived dimension resolved to the first candidate no constraint rejects. */
export const FirstValidDimensionSchema = z
  .strictObject({
    kind: z.literal("first-valid"),
    name: dimensionName,
    candidates: domain("The candidates, in the order tried: the dimension takes the first that no constraint rejects. At least one, none repeated."),
    activeWhen,
  })
  .meta({ id: "FirstValidDimension", description: "A derived dimension resolved to the first of its candidates that the constraints accept." });

/** The data form of a model: dimensions with literal domains, and rules. */
export const ModelSchema = z
  .strictObject({
    dimensions: z.array(z.union([ChoiceDimensionSchema, FirstValidDimensionSchema])).describe("The dimensions, in enumeration order: the first varies slowest."),
    rules: RulesSchema.optional().describe("Declarative constraints over the dimensions."),
  })
  .meta({
    id: "Model",
    description: "The serialisable data of a model: what `parseModel` takes, the input of `defineModel` where every part is JSON. Dimension names must be unique, and every dimension or value a condition or rule mentions must exist in the model; those are checked by `defineModel`, which `parseModel` calls and which this schema cannot express.",
  });

/** The dialect Zod emits for the `draft-2020-12` target. */
const DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema";

const ROOT_DESCRIPTION =
  "The serialisable data of combinatrix: a model (choice and first-valid dimensions with literal values, activity conditions and rules), a list of rules, a single rule, or a single condition, which is a trilean predicate tree. Computed dimensions, sampled domains, predicates and other constraints given through the constraint contract are functions, not data, and are out of scope. A value that is unset is not a JSON value: a dimension is unset only through `activeWhen`.";

/** The published JSON Schema document, a draft 2020-12 schema whose `$id` names the package version it ships in. The `$id` is version-pinned, never `latest`, so a reference to it keeps meaning the schema it was written against. */
export function buildJsonSchema(version: string): z.core.JSONSchema.JSONSchema {
  const root = z.union([ModelSchema, RulesSchema, RuleSchema, ConditionSchema]).meta({ title: "combinatrix", description: ROOT_DESCRIPTION });

  return { $schema: DRAFT_2020_12, $id: `https://cdn.jsdelivr.net/npm/combinatrix@${version}/schemas/combinatrix.schema.json`, ...z.toJSONSchema(root, { target: "draft-2020-12" }) };
}

/** The version of the package this schema ships in. */
export const PACKAGE_VERSION: string = pkg.version;
