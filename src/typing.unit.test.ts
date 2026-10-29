import { describe, expect, expectTypeOf, it } from "vitest";

import type { AbortSignalLike, CombinationOf, Condition, Constraint, DataReason, DeadValue, Dimension, LimitBound, PartialAssignment, Reason, Strategy, StrategyContext, TupleOf, TypedCondition, TypedRule, Value } from "./index";
import { choice, collect, computed, count, defineModel, diagnose, explain, explainData, firstValid, isNonEmpty, LimitExceededError, ModelError, predicate, sampled, StrategyError } from "./index";

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

describe("a predicate bound to the model", () => {
  it("types test with each read dimension's values", () => {
    const model = defineModel({
      dimensions,
      constraints: ({ predicate: typed }) => [
        typed({
          name: "musl only on x64",
          reads: ["libc", "arch"],
          test: (values) => {
            expectTypeOf(values).toEqualTypeOf<Readonly<Pick<Combination, "libc" | "arch">>>();

            return values.libc !== "musl" || values.arch === "x64";
          },
        }),
      ],
    });
    expect(collect(model, { limit: 32 }).every(({ values }) => values.libc !== "musl" || values.arch === "x64")).toBe(true);
  });

  it("refuses a read of an unknown dimension and a comparison with a value the dimension never takes", () => {
    // @ts-expect-error kernel is not a dimension
    expect(() => defineModel({ dimensions, constraints: ({ predicate: typed }) => [typed({ reads: ["kernel"], test: () => true })] })).toThrow(ModelError);
    // @ts-expect-error os is never "windows", so the comparison has no overlap
    defineModel({ dimensions, constraints: ({ predicate: typed }) => [typed({ reads: ["os"], test: ({ os }) => os !== "windows" })] });
  });

  it("refuses a first-valid dimension with a later one, as the standalone predicate does", () => {
    const ordered = [choice("os", ["linux", "macos"]), firstValid("channel", ["stable", "beta"]), choice("arch", ["x64", "arm64"])] as const;
    // @ts-expect-error arch is declared after the first-valid channel
    expect(() => defineModel({ dimensions: ordered, constraints: ({ predicate: typed }) => [typed({ reads: ["channel", "arch"], test: () => true })] })).toThrow(ModelError);
  });

  it("answers invalid without calling test for a value outside a domain, which only a strategy's own assignment can supply", () => {
    const seen: unknown[] = [];
    const model = defineModel({ dimensions: [choice("os", ["linux", "macos"])], constraints: ({ predicate: typed }) => [typed({ reads: ["os"], test: ({ os }) => seen.push(os) > 0 })] });
    const [constraint] = model.constraints;
    expect(constraint?.evaluate(new Map([["os", "bsd"]]))).toBe("invalid");
    expect(seen).toEqual([]);
    expect(constraint?.evaluate(new Map([["os", "linux"]]))).toBe("valid");
    expect(seen).toEqual(["linux"]);
  });
});

describe("the reasons explain gives", () => {
  const model = defineModel({
    dimensions: [choice("os", ["linux", "macos"]), choice("libc", ["glibc", "musl"], { activeWhen: { is: ["os", "linux"] } }), firstValid("channel", ["stable", "beta"])],
    rules: [{ requires: { is: ["channel", "beta"] }, when: { is: ["libc", "musl"] } }],
  });
  type Of = CombinationOf<typeof model>;

  it("are keyed by dimension, so testing the dimension narrows the value", () => {
    const explanation = explain(model, { os: "macos", libc: "musl", channel: "stable" });
    if (explanation.valid) throw new Error("the record sets an inactive dimension");
    expectTypeOf(explanation.reasons).toEqualTypeOf<readonly Reason<Of>[]>();
    const narrowed: string[] = [];
    for (const reason of explanation.reasons) {
      if (reason.kind !== "inactive") continue;
      // @ts-expect-error kernel is not a dimension, so no reason names it
      expect(reason.dimension === "kernel").toBe(false);
      if (reason.dimension === "libc") {
        expectTypeOf(reason.value).toEqualTypeOf<"glibc" | "musl" | undefined>();
        // @ts-expect-error libc is never "uclibc"
        expect(reason.value === "uclibc").toBe(false);
        narrowed.push(reason.value ?? "unset");
      }
    }
    expect(narrowed).toEqual(["musl"]);
  });

  it("pair a derived value with the expected one of the same dimension", () => {
    const explanation = explain(model, { os: "linux", libc: "musl", channel: "stable" });
    if (explanation.valid) throw new Error("musl derives beta");
    const derived = explanation.reasons.find((reason) => reason.kind === "derived");
    if (derived?.dimension !== "channel") throw new Error("the channel is not the one derived");
    expectTypeOf(derived.expected).toEqualTypeOf<"stable" | "beta">();
    expect(derived.expected).toBe("beta");
  });

  it("stay untyped for untyped data, with unknown where the data is not even a value", () => {
    const explanation = explainData(model, { os: "bsd", libc: Symbol("not a value") });
    if (explanation.valid) throw new Error("the data is not a combination");
    expectTypeOf(explanation.reasons).toEqualTypeOf<readonly DataReason[]>();
    const kinds = explanation.reasons.map((reason) => {
      if (reason.kind === "outside-domain") expectTypeOf(reason).toEqualTypeOf<{ readonly kind: "outside-domain"; readonly dimension: string; readonly value: Value }>();
      if (reason.kind === "not-a-value") expectTypeOf(reason.value).toBeUnknown();

      return reason.kind;
    });
    expect(kinds).toEqual(["outside-domain", "not-a-value"]);
  });
});

describe("the dead values diagnose lists", () => {
  it("are keyed by dimension, so testing the dimension narrows the value", () => {
    const model = defineModel({ dimensions: [choice("os", ["linux", "macos"]), choice("arch", ["x64", "arm64", "riscv64"])], rules: [{ excludes: { is: ["arch", "riscv64"] } }] });
    const diagnosis = diagnose(model);
    if (diagnosis.status === "empty") throw new Error("the model is satisfiable");
    expectTypeOf(diagnosis.deadValues).toEqualTypeOf<readonly DeadValue<CombinationOf<typeof model>>[]>();
    const [dead] = diagnosis.deadValues;
    // @ts-expect-error kernel is not a dimension, so no dead value names it
    expect(dead?.dimension === "kernel").toBe(false);
    if (dead?.dimension !== "arch") throw new Error("riscv64 is the dead value");
    expectTypeOf(dead.value).toEqualTypeOf<"x64" | "arm64" | "riscv64">();
    expect(dead.value).toBe("riscv64");
  });
});

describe("a computed dimension's reads", () => {
  const os = choice("os", ["linux", "macos"]);
  const arch = choice("arch", ["x64", "arm64"]);

  it("are typed by name when given by name, as any value of each", () => {
    computed("triple", {
      reads: ["os", "arch"],
      compute: (values) => {
        expectTypeOf(values).toEqualTypeOf<Readonly<{ readonly os: Value; readonly arch: Value }>>();
        // @ts-expect-error kernel is not read
        expect(values.kernel).toBeUndefined();

        return `${String(values.os)}-${String(values.arch)}`;
      },
    });
  });

  it("are typed by each dimension's values when given as the dimensions themselves", () => {
    const model = defineModel({
      dimensions: [
        os,
        arch,
        computed("triple", {
          reads: [os, arch],
          compute: ({ os: system, arch: machine }) => {
            expectTypeOf(system).toEqualTypeOf<"linux" | "macos">();
            // @ts-expect-error os is never "windows", so the comparison has no overlap
            expect(system === "windows").toBe(false);

            return `${machine}-${system}` as const;
          },
        }),
      ],
    });
    expectTypeOf<CombinationOf<typeof model>["triple"]>().toEqualTypeOf<"x64-linux" | "x64-macos" | "arm64-linux" | "arm64-macos">();
    expect(collect(model).map(({ values }) => values.triple)).toEqual(["x64-linux", "arm64-linux", "x64-macos", "arm64-macos"]);
  });

  it("keep a computed dimension a Dimension, whatever its reads", () => {
    expectTypeOf(computed("triple", { reads: [os, "arch"], compute: ({ os: system }) => system })).toExtend<Dimension>();
  });

  it("refuse a compute whose parameter does not accept every value its reads can hold", () => {
    const narrow = choice("os", ["linux"]);
    // @ts-expect-error the os given in reads cannot be macos, but the model's os can
    defineModel({ dimensions: [os, computed("kernel", { reads: [narrow], compute: ({ os: system }) => system })] });
    // @ts-expect-error the annotated parameter accepts only linux
    defineModel({ dimensions: [os, computed("kernel", { reads: ["os"], compute: (values: Readonly<{ os: "linux" }>) => values.os })] });
  });
});

describe("a standalone predicate's reads", () => {
  it("are typed by each dimension's values when given as the dimensions themselves", () => {
    const os = choice("os", ["linux", "macos"]);
    const test = ({ os: system }: Readonly<{ os: "linux" | "macos" }>): boolean => system === "linux";
    const linuxOnly = predicate({
      reads: [os],
      test: (values) => {
        expectTypeOf(values).toEqualTypeOf<Readonly<{ readonly os: "linux" | "macos" }>>();
        // @ts-expect-error os is never "windows", so the comparison has no overlap
        expect(values.os === "windows").toBe(false);

        return test(values);
      },
    });
    expect(count(defineModel({ dimensions: [os], constraints: [linuxOnly] }))).toBe(1);
  });

  it("answer invalid without calling test for a value a dimension given as itself cannot hold, and pass any value of one given by name", () => {
    const seen: unknown[] = [];
    const record = ({ os: system }: Readonly<{ os: unknown }>): boolean => seen.push(system) > 0;
    const typed = predicate({ reads: [choice("os", ["linux", "macos"])], test: record });
    expect(typed.dependencies).toEqual(["os"]);
    expect(typed.evaluate(new Map([["os", "bsd"]]))).toBe("invalid");
    expect(typed.evaluate(new Map([["os", "linux"]]))).toBe("valid");
    const named = predicate({ reads: ["os"], test: record });
    expect(named.evaluate(new Map([["os", "bsd"]]))).toBe("valid");
    expect(seen).toEqual(["linux", "bsd"]);
  });
});

describe("a strategy", () => {
  const model = defineModel({ dimensions: [choice("os", ["linux", "macos"]), choice("arch", ["x64", "arm64"])] });
  type Of = CombinationOf<typeof model>;
  const other = defineModel({ dimensions: [choice("colour", ["red", "blue"])] });

  it("written for the model gets typed assignments and completions, and yields typed rows", () => {
    const firstLinux: Strategy<Of> = {
      name: "first linux",
      select: function* (context) {
        expectTypeOf(context).toEqualTypeOf<StrategyContext<Of>>();
        expectTypeOf(context.completions).parameter(0).toEqualTypeOf<PartialAssignment<Of> | undefined>();
        // @ts-expect-error kernel is not a dimension of the model
        context.completions(new Map([["kernel", "linux"]]));
        // @ts-expect-error bsd is no value of any dimension of the model
        context.completions(new Map([["os", "bsd"]]));
        const [first] = context.completions(new Map([["os", "linux"]]));
        if (first === undefined) return;
        expectTypeOf(first).toEqualTypeOf<Of>();
        yield first;
      },
    };
    expect(collect(model, { strategy: firstLinux }).map(({ values }) => values)).toEqual([{ os: "linux", arch: "x64" }]);
    // @ts-expect-error a row of the model has no colour
    const wrongRows: Strategy<Of> = { name: "wrong rows", select: () => [{ colour: "red" }] };
    expect(() => collect(model, { strategy: wrongRows })).toThrow();
  });

  it("written for another model is refused, and one written for any model is accepted", () => {
    const forOther: Strategy<CombinationOf<typeof other>> = { name: "for other", select: () => [{ colour: "red" }] };
    expect(collect(other, { strategy: forOther })).toHaveLength(1);
    // @ts-expect-error the strategy is for a model with other dimensions
    expect(() => collect(model, { strategy: forOther })).toThrow(StrategyError);
    const forAny: Strategy = { name: "for any", select: (context) => context.completions() };
    expect(collect(model, { strategy: forAny })).toEqual(collect(model));
    expect(collect(other, { strategy: forAny })).toEqual(collect(other));
  });
});

describe("the abort signal", () => {
  it("is satisfied by a real AbortSignal and by a hand-written object keeping the same contract", () => {
    expectTypeOf<AbortSignal>().toExtend<AbortSignalLike>();
    const reason = new Error("stopped");
    const signal: AbortSignalLike = {
      aborted: true,
      reason,
      throwIfAborted: () => {
        throw reason;
      },
    };
    expect(() => count(defineModel({ dimensions: [choice("a", [1, 2])] }), { signal })).toThrow(reason);
  });
});

describe("LimitExceededError", () => {
  it("names what its limit bounded, from a closed set", () => {
    const limit = 1;
    const error = new LimitExceededError(limit, "rows");
    expectTypeOf(error.bound).toEqualTypeOf<LimitBound>();
    expect(error.bound).toBe("rows");
    // @ts-expect-error bytes is not something a limit bounds
    expect(() => new LimitExceededError(limit, "bytes")).toThrow(TypeError);
  });
});
