import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import type { Condition } from "../src/condition";
import type { ChoiceDimension, FirstValidDimension } from "../src/dimension";
import type { ModelData } from "../src/guards";
import type { Rule } from "../src/rule";
import type { Scalar } from "../src/value";
import type { ChoiceDimensionSchema, FirstValidDimensionSchema, ModelSchema, RuleSchema, RulesSchema } from "./json-schema";
import { ConditionSchema, ScalarSchema } from "./json-schema";

/**
 * The hand-written data types and the Zod schemas the JSON Schema is generated from must describe the same data, so that neither can drift from the other without `pnpm typecheck` failing. They cannot be compared with `toEqualTypeOf` directly, for two reasons that say nothing about the data: Zod infers mutable arrays and tuples where the library's types are `readonly`, and it infers an optional key as `T | undefined` where the library, under `exactOptionalPropertyTypes`, forbids the explicit `undefined`. `Plain` removes both differences, and `Agree` then requires assignability in both directions, which is exact equality of what each type accepts. Assignability, not identity, is also what a recursive type such as `Condition` supports: TypeScript compares two recursive types by assuming the comparison holds on a cycle, where its identity check on the unfolded types does not terminate usefully.
 */

/** A type with every `readonly` modifier removed and every optional key's explicit `undefined` removed, at every depth. */
type Plain<T> = T extends readonly unknown[] ? { -readonly [K in keyof T]: Plain<T[K]> } : T extends object ? { -readonly [K in keyof T]: Plain<Exclude<T[K], undefined>> } : T;

/** `true` when each type is assignable to the other once plain, `false` when either accepts something the other does not. */
type Agree<A, B> = [Plain<A>] extends [Plain<B>] ? ([Plain<B>] extends [Plain<A>] ? true : false) : false;

describe("the Zod schemas and the library's data types", () => {
  it("describe the same scalars, conditions, rules and dimensions", () => {
    expectTypeOf<Agree<z.infer<typeof ScalarSchema>, Scalar>>().toEqualTypeOf<true>();
    expectTypeOf<Agree<z.infer<typeof ConditionSchema>, Condition>>().toEqualTypeOf<true>();
    expectTypeOf<Agree<z.infer<typeof RuleSchema>, Rule>>().toEqualTypeOf<true>();
    expectTypeOf<Agree<z.infer<typeof RulesSchema>, readonly Rule[]>>().toEqualTypeOf<true>();
    expectTypeOf<Agree<z.infer<typeof ChoiceDimensionSchema>, ChoiceDimension<string, Scalar>>>().toEqualTypeOf<true>();
    expectTypeOf<Agree<z.infer<typeof FirstValidDimensionSchema>, FirstValidDimension<string, Scalar>>>().toEqualTypeOf<true>();
    expectTypeOf<Agree<z.infer<typeof ModelSchema>, ModelData>>().toEqualTypeOf<true>();
  });

  it("report a schema that has drifted from the type, in either direction", () => {
    /** The condition schema with a form the library's `Condition` lacks. */
    const Wider = z.union([ConditionSchema, z.strictObject({ xor: z.tuple([z.string(), z.string()]) })]);
    /** The condition schema without the `not` form, which `Condition` has. */
    const Narrower = z.union([z.strictObject({ is: z.tuple([z.string(), ScalarSchema]) }), z.strictObject({ set: z.string() })]);

    expect(Wider.safeParse({ xor: ["a", "b"] }).success).toBe(true);
    expect(Narrower.safeParse({ not: { set: "a" } }).success).toBe(false);
    expectTypeOf<Agree<z.infer<typeof Wider>, Condition>>().toEqualTypeOf<false>();
    expectTypeOf<Agree<z.infer<typeof Narrower>, Condition>>().toEqualTypeOf<false>();
    // @ts-expect-error `Agree` is `false` for a drifted schema, so asserting it is `true` must not compile: this line is what shows the check above can fail.
    expectTypeOf<Agree<z.infer<typeof Narrower>, Condition>>().toEqualTypeOf<true>();
  });
});
