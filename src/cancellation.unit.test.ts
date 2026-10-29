import { describe, expect, it } from "vitest";

import { STEPS_PER_ABORT_CHECK } from "./cancellation";
import type { Strategy } from "./index";
import { choice, collect, combinations, count, defineModel, diagnose, full, isNonEmpty, predicate } from "./index";

const REASON = new Error("stopped by the caller");
const SIDE = 10;
const DIMENSION_COUNT = 4;
const SPACE = SIDE ** DIMENSION_COUNT;
/** Predicate evaluations before the signal aborts: well inside the first leaf of the search, so the rest of the space is still to do. */
const ABORT_AT = 5;

/**
 * A cube read whole by a predicate that counts its evaluations and aborts the signal on the given one. The predicate runs at most once per search step, so the evaluations after the abort are bounded by the steps after it. It reads every dimension so that the frontier at each depth is every dimension before it: no two assignments share a frontier state, the memoised count visits every node as the plain search does, and the search is still running when the signal aborts.
 */
function abortingModel(abortAt: number) {
  const controller = new AbortController();
  const evaluations = { total: 0, afterAbort: 0 };
  const names = Array.from({ length: DIMENSION_COUNT }, (_, index) => `d${String(index)}`);
  const counting = predicate({
    reads: names,
    test: () => {
      evaluations.total += 1;
      if (controller.signal.aborted) evaluations.afterAbort += 1;
      if (evaluations.total === abortAt) controller.abort(REASON);

      return true;
    },
  });
  const domain = Array.from({ length: SIDE }, (_, value) => value);
  if (!isNonEmpty(domain)) throw new Error("a side has at least one value");
  const model = defineModel({ dimensions: names.map((name) => choice(name, domain)), constraints: [counting] });

  return { model, signal: controller.signal, evaluations };
}

/** A signal that is already aborted with the reason, and a model whose predicate records that it ran. */
function abortedBeforeStart() {
  const controller = new AbortController();
  controller.abort(REASON);
  let evaluated = false;
  const model = defineModel({
    dimensions: [choice("a", [1, 2])],
    constraints: [
      predicate({
        reads: ["a"],
        test: () => {
          evaluated = true;

          return true;
        },
      }),
    ],
  });

  return { model, signal: controller.signal, evaluated: () => evaluated };
}

describe("a signal that is already aborted", () => {
  it("makes count, collect, diagnose and combinations throw its reason before any work", () => {
    const { model, signal, evaluated } = abortedBeforeStart();
    expect(() => count(model, { signal })).toThrow(REASON);
    expect(() => collect(model, { signal })).toThrow(REASON);
    expect(() => diagnose(model, { signal })).toThrow(REASON);
    expect(() => [...combinations(model, { signal })]).toThrow(REASON);
    expect(evaluated()).toBe(false);
  });

  it("throws before the shortcuts that need no search, a model emptied by an unconditional constraint and a suffix counted as a product", () => {
    const controller = new AbortController();
    controller.abort(REASON);
    const empty = defineModel({ dimensions: [choice("a", [1])], constraints: [{ dependencies: [], evaluate: () => "invalid" }] });
    expect(() => count(empty, { signal: controller.signal })).toThrow(REASON);
    expect(() => [...combinations(empty, { signal: controller.signal })]).toThrow(REASON);
    expect(() => count(defineModel({ dimensions: [choice("a", [1, 2])] }), { signal: controller.signal })).toThrow(REASON);
  });

  it("throws the reason of a signal aborted without one, a DOMException named AbortError", () => {
    const controller = new AbortController();
    controller.abort();
    const { model } = abortedBeforeStart();
    expect(() => count(model, { signal: controller.signal })).toThrow(expect.objectContaining({ name: "AbortError" }));
  });

  it("still validates a given limit first", () => {
    const { model, signal } = abortedBeforeStart();
    expect(() => count(model, { limit: -1, signal })).toThrow(RangeError);
  });
});

describe("a signal that aborts mid-search", () => {
  it("stops count within the check interval and throws the reason", () => {
    const { model, signal, evaluations } = abortingModel(ABORT_AT);
    expect(() => count(model, { signal })).toThrow(REASON);
    expect(evaluations.total).toBeGreaterThanOrEqual(ABORT_AT);
    expect(evaluations.afterAbort).toBeLessThan(STEPS_PER_ABORT_CHECK);
    expect(evaluations.total).toBeLessThan(SPACE);
  });

  it("stops collect within the check interval and returns no partial result", () => {
    const { model, signal, evaluations } = abortingModel(ABORT_AT);
    let result: unknown;
    expect(() => {
      result = collect(model, { signal });
    }).toThrow(REASON);
    expect(result).toBeUndefined();
    expect(evaluations.afterAbort).toBeLessThan(STEPS_PER_ABORT_CHECK);
    expect(evaluations.total).toBeLessThan(SPACE);
  });

  it("stops diagnose within the check interval and throws the reason", () => {
    const { model, signal, evaluations } = abortingModel(ABORT_AT);
    expect(() => diagnose(model, { signal })).toThrow(REASON);
    expect(evaluations.afterAbort).toBeLessThan(STEPS_PER_ABORT_CHECK);
    expect(evaluations.total).toBeLessThan(SPACE);
  });

  it("stops combinations within the check interval, after yielding what was found before the abort", () => {
    const { model, signal, evaluations } = abortingModel(ABORT_AT);
    const found: unknown[] = [];
    expect(() => {
      for (const combination of combinations(model, { signal })) found.push(combination);
    }).toThrow(REASON);
    expect(found.length).toBeLessThan(ABORT_AT + STEPS_PER_ABORT_CHECK);
    expect(evaluations.afterAbort).toBeLessThan(STEPS_PER_ABORT_CHECK);
    expect(evaluations.total).toBeLessThan(SPACE);
  });

  it("stops combinations at the next advance when the caller aborts between combinations, after less than one interval of further search", () => {
    const { model, evaluations } = abortingModel(SPACE + 1);
    const controller = new AbortController();
    const iterator = combinations(model, { signal: controller.signal });
    iterator.next();
    iterator.next();
    const before = evaluations.total;
    controller.abort(REASON);
    expect(() => iterator.next()).toThrow(REASON);
    expect(evaluations.total - before).toBeLessThan(STEPS_PER_ABORT_CHECK);
  });

  it("completes with the same result as an unsignalled run when the signal never aborts", () => {
    const { model } = abortingModel(SPACE + 1);
    const signal = new AbortController().signal;
    expect(count(model, { signal })).toBe(SPACE);
    expect(collect(model, { signal })).toEqual(collect(model));
    expect(diagnose(model, { signal })).toEqual(diagnose(model));
  });

  it("lets a limit refuse first when the signal has not aborted, and the abort win when it has", () => {
    const { model, signal } = abortingModel(SPACE + 1);
    expect(() => count(model, { limit: 1, signal })).toThrow("more than 1");
    const aborted = abortingModel(ABORT_AT);
    expect(() => count(aborted.model, { limit: SPACE, signal: aborted.signal })).toThrow(REASON);
  });
});

describe("a signal given to a strategy", () => {
  const model = defineModel({ dimensions: [choice("a", ["x", "y", "z"])] });

  it("reaches the strategy through its context, and is absent when none was given", () => {
    const seen: (AbortSignal | undefined)[] = [];
    const spy: Strategy = {
      name: "spy",
      select: (context) => {
        seen.push(context.signal);
        expect("signal" in context).toBe(context.signal !== undefined);

        return [];
      },
    };
    const { signal } = new AbortController();
    collect(model, { strategy: spy, signal });
    collect(model, { strategy: spy });
    expect(seen).toEqual([signal, undefined]);
  });

  it("lets a strategy that honours it stop its own search with the reason", () => {
    const controller = new AbortController();
    const polite: Strategy = {
      name: "polite",
      select: function* (context) {
        for (const a of ["x", "y", "z"]) {
          context.signal?.throwIfAborted();
          if (a === "y") controller.abort(REASON);

          yield { a };
        }
      },
    };
    expect(() => collect(model, { strategy: polite, signal: controller.signal })).toThrow(REASON);
  });

  it("stops a strategy that ignores it before it produces another combination", () => {
    const controller = new AbortController();
    const produced: string[] = [];
    const oblivious: Strategy = {
      name: "oblivious",
      select: function* () {
        for (const a of ["x", "y", "z"]) {
          produced.push(a);
          if (a === "x") controller.abort(REASON);

          yield { a };
        }
      },
    };
    expect(() => collect(model, { strategy: oblivious, signal: controller.signal })).toThrow(REASON);
    expect(produced).toEqual(["x"]);
  });

  it("makes completions honour it, so full and any strategy built on completions are cancellable", () => {
    const { model: big, signal, evaluations } = abortingModel(ABORT_AT);
    const viaCompletions: Strategy = { name: "via completions", select: (context) => context.completions() };
    expect(() => collect(big, { strategy: viaCompletions, signal })).toThrow(REASON);
    expect(evaluations.afterAbort).toBeLessThan(STEPS_PER_ABORT_CHECK);
    const again = abortingModel(ABORT_AT);
    expect(() => collect(again.model, { strategy: full, signal: again.signal })).toThrow(REASON);
  });
});
