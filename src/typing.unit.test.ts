import { describe, expect, expectTypeOf, it } from "vitest";

import type { CombinationOf, Condition, Constraint, TupleOf, TypedCondition, TypedRule } from "./index";
import { choice, collect, computed, defineModel, firstValid, isNonEmpty, ModelError, predicate, sampled } from "./index";

/**
 * Compile-time guarantees. Each `@ts-expect-error` line is load-bearing: `pnpm typecheck` type-checks this file, and a directive whose line compiles is itself an error (TS2578), so a guarantee that stopped holding fails the typecheck. Each refused definition is also run, to show `defineModel` still refuses it at runtime, where data that bypassed the types arrives.
 */
const dimensions = [
  choice("os", ["linux", "macos"]),
  choice("arch", ["x64", "arm64"]),
  // Unset only where it is inactive.
  choice("libc", ["glibc", "musl"], { activeWhen: { is: ["os", "linux"] } }),
  // Unset only where it is inactive, and derived.
  computed("triple", { reads: ["os", "arch"], compute: ({ os, arch }) => `${String(os)}-${String(arch)}`, activeWhen: { set: "arch" } }),
  // Unset as a derived value. Last, since a rule on a first-valid dimension may mention only dimensions declared before it.
  firstValid("channel", [undefined, "stable", "beta"]),
] as const;
type Combination = TupleOf<typeof dimensions>;

describe("the inferred combination type", () => {
  it("is each dimension's value union, with undefined exactly where it can be unset", () => {
    const model = defineModel({ dimensions });
    expectTypeOf<CombinationOf<typeof model>>().toEqualTypeOf<Combination>();
    expectTypeOf<Combination>().toEqualTypeOf<{
      readonly os: "linux" | "macos";
      readonly arch: "x64" | "arm64";
      readonly libc: "glibc" | "musl" | undefined;
      readonly triple: `${string}-${string}` | undefined;
      readonly channel: "stable" | "beta" | undefined;
    }>();
    const [first] = collect(model, { limit: 16 });
    expectTypeOf(first?.values.os).toEqualTypeOf<"linux" | "macos" | undefined>();
  });
});

describe("typed rules", () => {
  it("accept every form and combinator written against the dimensions", () => {
    const rules = [
        { requires: { in: ["arch", ["x64"]] }, when: { is: ["os", "macos"] }, unless: { unset: "libc" }, name: "macos on x64" },
        { excludes: { all: [{ is: ["libc", "musl"] }, { not: { any: [{ set: "channel" }, { unset: "triple" }] } }] } },
      { implies: [{ is: ["channel", "beta"] }, { in: ["os", ["linux"]] }] },
    ] satisfies TypedRule<Combination>[];
    expect(defineModel({ dimensions, rules }).rules).toEqual(rules);
  });

  it("refuse an unknown dimension name, at compile time and at runtime", () => {
    // @ts-expect-error "kernel" is not a dimension
    expect(() => defineModel({ dimensions, rules: [{ requires: { set: "kernel" } }] })).toThrow(ModelError);
  });

  it("refuse a value outside a dimension's domain, in every condition form and position", () => {
    // @ts-expect-error "windows" is not a value of os
    expect(() => defineModel({ dimensions, rules: [{ requires: { in: ["os", ["windows"]] } }] })).toThrow(ModelError);
    // @ts-expect-error "riscv" is not a value of arch
    expect(() => defineModel({ dimensions, rules: [{ requires: { set: "os" }, when: { is: ["arch", "riscv"] } }] })).toThrow(ModelError);
    // @ts-expect-error a value nested in all, any and not is checked too
    expect(() => defineModel({ dimensions, rules: [{ excludes: { all: [{ any: [{ not: { is: ["libc", "uclibc"] } }] }] } }] })).toThrow(ModelError);
    // @ts-expect-error unless and implies are checked too
    expect(() => defineModel({ dimensions, rules: [{ implies: [{ set: "os" }, { is: ["channel", "nightly"] }], unless: { set: "arch" } }] })).toThrow(ModelError);
  });

  it("correlate the values with the dimension named before them", () => {
    // @ts-expect-error "x64" is a value of arch, not of os
    expect(() => defineModel({ dimensions, rules: [{ requires: { is: ["os", "x64"] } }] })).toThrow(ModelError);
    // @ts-expect-error one value of the list belongs to another dimension
    expect(() => defineModel({ dimensions, rules: [{ requires: { in: ["arch", ["x64", "linux"]] } }] })).toThrow(ModelError);
  });

  it("allow a test for unset exactly where the dimension can be unset", () => {
    const unsettable: TypedCondition<Combination>[] = [{ unset: "libc" }, { unset: "channel" }, { unset: "triple" }];
    expect(defineModel({ dimensions, rules: unsettable.map((condition) => ({ excludes: condition })) }).rules).toEqual(unsettable.map((condition) => ({ excludes: condition })));
    // @ts-expect-error os is never unset
    expect(() => defineModel({ dimensions, rules: [{ excludes: { unset: "os" } }] })).toThrow(ModelError);
  });

  it("type a rule written apart from the model", () => {
    const rule: TypedRule<Combination> = { requires: { is: ["os", "linux"] }, when: { is: ["libc", "musl"] } };
    // @ts-expect-error "bsd" is not a value of os
    const wrong: TypedRule<Combination> = { requires: { is: ["os", "bsd"] } };
    expect(defineModel({ dimensions, rules: [rule] }).rules).toEqual([rule]);
    expect(() => defineModel({ dimensions, rules: [wrong] })).toThrow(ModelError);
  });
});

describe("domains", () => {
  it("are non-empty at compile time, with isNonEmpty as the route for a list built at runtime", () => {
    // @ts-expect-error a choice needs at least one value
    expect(() => defineModel({ dimensions: [choice("a", [])] })).toThrow(ModelError);
    // @ts-expect-error a first-valid dimension needs at least one candidate
    expect(() => defineModel({ dimensions: [firstValid("a", [])] })).toThrow(ModelError);
    const fromData: unknown = JSON.parse('["x", "y"]');
    const values = Array.isArray(fromData) ? fromData.filter((value): value is string => typeof value === "string") : [];
    if (!isNonEmpty(values)) throw new Error("the data has no values");
    expect(defineModel({ dimensions: [choice("a", values)] }).dimensions).toEqual([{ kind: "choice", name: "a", values: ["x", "y"] }]);
    expect(isNonEmpty([])).toBe(false);
    expect(() => defineModel({ dimensions: [sampled("a", () => [])] })).toThrow(ModelError);
  });
});

describe("the dimensions' names and order", () => {
  it("refuse a name declared twice", () => {
    // @ts-expect-error os is declared twice
    expect(() => defineModel({ dimensions: [choice("os", ["linux"]), choice("os", ["macos"])] })).toThrow(ModelError);
  });

  it("refuse an activity condition on a later or unknown dimension, or comparing with a value it can never take", () => {
    // @ts-expect-error os is declared after libc
    expect(() => defineModel({ dimensions: [choice("libc", ["glibc"], { activeWhen: { is: ["os", "linux"] } }), choice("os", ["linux"])] })).toThrow(ModelError);
    // @ts-expect-error kernel is not a dimension
    expect(() => defineModel({ dimensions: [choice("os", ["linux"]), choice("libc", ["glibc"], { activeWhen: { not: { set: "kernel" } } })] })).toThrow(ModelError);
    // @ts-expect-error "bsd" is not a value of os
    expect(() => defineModel({ dimensions: [choice("os", ["linux"]), firstValid("libc", ["glibc"], { activeWhen: { any: [{ is: ["os", "bsd"] }] } })] })).toThrow(ModelError);
    // @ts-expect-error os is never unset
    expect(() => defineModel({ dimensions: [choice("os", ["linux"]), choice("libc", ["glibc"], { activeWhen: { unset: "os" } })] })).toThrow(ModelError);
  });

  it("refuse a computed dimension reading a later or unknown dimension", () => {
    // @ts-expect-error arch is declared after triple
    expect(() => defineModel({ dimensions: [computed("triple", { reads: ["arch"], compute: () => "x" }), choice("arch", ["x64"])] })).toThrow(ModelError);
    // @ts-expect-error kernel is not a dimension
    expect(() => defineModel({ dimensions: [choice("arch", ["x64"]), computed("triple", { reads: ["arch", "kernel"], compute: () => "x" })] })).toThrow(ModelError);
  });

  it("refuse a rule or predicate on a first-valid dimension that mentions a dimension declared after it", () => {
    const ordered = [choice("os", ["linux", "macos"]), firstValid("channel", ["stable", "beta"]), choice("arch", ["x64", "arm64"])] as const;
    expect(defineModel({ dimensions: ordered, rules: [{ requires: { is: ["channel", "beta"] }, when: { is: ["os", "macos"] } }] }).rules).toHaveLength(1);
    // @ts-expect-error arch is declared after the first-valid channel
    expect(() => defineModel({ dimensions: ordered, rules: [{ requires: { is: ["channel", "beta"] }, when: { is: ["arch", "arm64"] } }] })).toThrow(ModelError);
    // @ts-expect-error the same for a predicate's reads
    expect(() => defineModel({ dimensions: ordered, constraints: [predicate({ reads: ["channel", "arch"], test: () => true })] })).toThrow(ModelError);
  });

  it("refuse a predicate reading an unknown dimension, and leave a constraint with string dependencies to the runtime", () => {
    // @ts-expect-error kernel is not a dimension
    expect(() => defineModel({ dimensions, constraints: [predicate({ reads: ["os", "kernel"], test: () => true })] })).toThrow(ModelError);
    const untyped: Constraint = { dependencies: ["kernel"], evaluate: () => "valid" };
    expect(() => defineModel({ dimensions, constraints: [untyped] })).toThrow(ModelError);
  });

  it("leave a dimension whose name or condition is not known at compile time to the runtime", () => {
    // A name assembled at runtime is typed string, so the compiler cannot see the duplicate.
    const name = ["o", "s"].join("");
    const activity: Condition = { is: ["os", "bsd"] };
    expect(() => defineModel({ dimensions: [choice("os", ["linux"]), choice(name, ["macos"])] })).toThrow(ModelError);
    expect(() => defineModel({ dimensions: [choice("os", ["linux"]), choice("libc", ["glibc"], { activeWhen: activity })] })).toThrow(ModelError);
  });
});
