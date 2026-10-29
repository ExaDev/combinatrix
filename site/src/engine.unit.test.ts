import { describe, expect, it } from "vitest";

import { execute } from "./engine";
import { EXAMPLES, exampleText } from "./examples";
import { VERIFICATION_SOLUTION_SET_LIMIT } from "./limits";
import type { Request, Response, Result } from "./protocol";
import { isOp } from "./protocol";

const [PRODUCT, RULE, CONDITIONAL] = EXAMPLES.map(exampleText);
if (PRODUCT === undefined || RULE === undefined || CONDITIONAL === undefined) throw new Error("the examples are a product, a rule and a conditional model");

/** The solution sets the README states for the first two examples, and the rows it prints for the pairwise covering array of the second. */
const PRODUCT_SIZE = 6;
const RULE_SIZE = 16;
const PAIRWISE_ROWS = 8;

/** The result of a request that is expected to succeed. */
function succeed(request: Request): Result {
  const response = execute(request);
  if (!response.ok) throw new Error(`expected success, got ${JSON.stringify(response.failure)}`);

  return response.result;
}

/** The result of a request, narrowed to one operation. */
function resultOf<Op extends Result["op"]>(op: Op, request: Request): Extract<Result, { op: Op }> {
  const result = succeed(request);
  if (!isOp(result, op)) throw new Error(`expected a ${op} result, got ${result.op}`);

  return result;
}

function failureOf(request: Request): Extract<Response, { ok: false }>["failure"] {
  const response = execute(request);
  if (response.ok) throw new Error("expected a failure");

  return response.failure;
}

/** A model of `dimensions` dimensions with `side` values each, so its solution set is `side ** dimensions`. */
function cube(dimensions: number, side: number): string {
  return JSON.stringify({
    dimensions: Array.from({ length: dimensions }, (_, index) => ({ kind: "choice", name: `d${String(index)}`, values: Array.from({ length: side }, (_unused, value) => value) })),
  });
}

describe("validate", () => {
  it("summarises each dimension with its values, whether it is derived and whether it is conditional", () => {
    expect(resultOf("validate", { op: "validate", model: CONDITIONAL })).toEqual({
      op: "validate",
      dimensions: [
        { name: "os", values: ["linux", "windows"], derived: false, conditional: false },
        { name: "compress", values: [true, false], derived: false, conditional: false },
        { name: "codec", values: ["zstd", "brotli"], derived: true, conditional: true },
      ],
    });
  });

  it("reports text that is not JSON", () => {
    expect(failureOf({ op: "validate", model: "{ not json" })).toMatchObject({ kind: "syntax" });
  });

  it("reports every defect of an invalid model", () => {
    const model = JSON.stringify({
      dimensions: [{ kind: "choice", name: "os", values: ["linux"] }],
      rules: [{ requires: { kind: "exists", operand: { kind: "reference", key: "arch" } } }],
    });
    const failure = failureOf({ op: "validate", model });

    expect(failure.kind).toBe("model");
    expect(failure.kind === "model" && failure.issues.join("\n")).toContain('unknown dimension "arch"');
  });

  it("refuses an operation on an invalid model the same way", () => {
    expect(failureOf({ op: "count", model: "[]" }).kind).toBe("model");
  });
});

describe("count", () => {
  it("counts the solution set", () => {
    expect(resultOf("count", { op: "count", model: PRODUCT }).count).toBe(PRODUCT_SIZE);
    expect(resultOf("count", { op: "count", model: RULE }).count).toBe(RULE_SIZE);
  });
});

describe("list", () => {
  it("lists the first combinations in enumeration order and says more exist", () => {
    const { rows, truncated } = resultOf("list", { op: "list", model: PRODUCT, limit: 4 });

    expect(rows.map((row) => row.values)).toEqual([
      { os: "linux", arch: "x64" },
      { os: "linux", arch: "arm64" },
      { os: "macos", arch: "x64" },
      { os: "macos", arch: "arm64" },
    ]);
    expect(truncated).toBe(true);
  });

  it("lists everything, without saying more exist, when the limit is the size of the solution set", () => {
    const { rows, truncated } = resultOf("list", { op: "list", model: PRODUCT, limit: PRODUCT_SIZE });

    expect(rows).toHaveLength(PRODUCT_SIZE);
    expect(truncated).toBe(false);
  });

  it("lists nothing, and says more exist, at a limit of zero", () => {
    expect(resultOf("list", { op: "list", model: PRODUCT, limit: 0 })).toEqual({ op: "list", rows: [], truncated: true });
  });

  it("returns only the limit of a larger solution set", () => {
    const side = 4;
    const dimensions = 8;
    const limit = 3;
    expect(side ** dimensions).toBeGreaterThan(limit);

    const { rows, truncated } = resultOf("list", { op: "list", model: cube(dimensions, side), limit });

    expect(rows.map((row) => row.values)).toEqual([0, 1, 2].map((last) => ({ ...Object.fromEntries(Array.from({ length: dimensions - 1 }, (_, index) => [`d${String(index)}`, 0])), [`d${String(dimensions - 1)}`]: last })));
    expect(truncated).toBe(true);
  });

  it("refuses a negative limit", () => {
    expect(failureOf({ op: "list", model: PRODUCT, limit: -1 })).toMatchObject({ kind: "error" });
  });
});

describe("diagnose", () => {
  it("reports a value no combination takes", () => {
    const model = JSON.stringify({
      dimensions: [
        { kind: "choice", name: "a", values: ["x", "y"] },
        { kind: "choice", name: "b", values: ["p"] },
      ],
      rules: [{ excludes: { kind: "textCompare", op: "equals", left: { kind: "reference", key: "a" }, right: { kind: "textLiteral", value: "y" } } }],
    });

    expect(resultOf("diagnose", { op: "diagnose", model }).diagnosis).toEqual({ status: "satisfiable", count: 1, deadValues: [{ dimension: "a", value: "y" }] });
  });

  it("reports an empty solution set", () => {
    const model = JSON.stringify({
      dimensions: [{ kind: "choice", name: "a", values: ["x"] }],
      rules: [{ excludes: { kind: "textCompare", op: "equals", left: { kind: "reference", key: "a" }, right: { kind: "textLiteral", value: "x" } } }],
    });

    expect(resultOf("diagnose", { op: "diagnose", model }).diagnosis).toEqual({ status: "empty" });
  });
});

describe("explain", () => {
  it("gives the id and index of a combination, which are those of the list", () => {
    const rows = resultOf("list", { op: "list", model: RULE, limit: RULE_SIZE }).rows;

    rows.forEach((row, position) => {
      const { explanation } = resultOf("explain", { op: "explain", model: RULE, values: row.values });

      expect(explanation).toEqual({ valid: true, id: row.id, index: position });
    });
  });

  it("names the rule that excludes a combination", () => {
    const { explanation } = resultOf("explain", { op: "explain", model: RULE, values: { os: "windows", arch: "x64", runtime: "bun" } });

    expect(explanation).toEqual({ valid: false, reasons: [{ kind: "constraint", index: 0, name: "bun is not offered on windows" }] });
  });

  it("reports a value outside a dimension's domain", () => {
    const { explanation } = resultOf("explain", { op: "explain", model: RULE, values: { os: "plan9", arch: "x64", runtime: "node" } });

    expect(explanation).toEqual({ valid: false, reasons: [{ kind: "outside-domain", dimension: "os", value: "plan9" }] });
  });

  it("keeps unset distinct from null in what it reports", () => {
    const { explanation } = resultOf("explain", { op: "explain", model: RULE, values: { os: undefined, arch: "x64", runtime: "node" } });

    expect(explanation).toEqual({ valid: false, reasons: [{ kind: "outside-domain", dimension: "os", value: undefined }] });
  });

  it("reports a derived dimension's value that differs from the derived one", () => {
    const { explanation } = resultOf("explain", { op: "explain", model: CONDITIONAL, values: { os: "windows", compress: true, codec: "zstd" } });

    expect(explanation.valid).toBe(false);
    expect(!explanation.valid && explanation.reasons.map((reason) => reason.kind)).toContain("derived");
  });
});

describe("covering", () => {
  it("builds a pairwise covering array and verifies it against the solution set", () => {
    const { rows, verification } = resultOf("covering", { op: "covering", model: RULE, strength: 2 });

    expect(rows).toHaveLength(PAIRWISE_ROWS);
    expect(verification).toEqual({ status: "covering", solutionSet: RULE_SIZE });
  });

  it("covers a strength above the dimension count with the whole solution set", () => {
    const { rows } = resultOf("covering", { op: "covering", model: PRODUCT, strength: 5 });

    expect(rows).toHaveLength(PRODUCT_SIZE);
  });

  it("builds the array but skips checking it when the solution set is past what the page enumerates", () => {
    const side = 10;
    const dimensions = 5;
    expect(side ** dimensions).toBeGreaterThan(VERIFICATION_SOLUTION_SET_LIMIT);

    const { rows, verification } = resultOf("covering", { op: "covering", model: cube(dimensions, side), strength: 2 });

    expect(rows.length).toBeGreaterThanOrEqual(side ** 2);
    expect(verification).toEqual({ status: "skipped", limit: VERIFICATION_SOLUTION_SET_LIMIT });
  });

  it("refuses a strength that is not a positive integer", () => {
    expect(failureOf({ op: "covering", model: PRODUCT, strength: 0 })).toMatchObject({ kind: "error" });
  });
});

describe("at", () => {
  it("unranks the combination at each index of the list", () => {
    const rows = resultOf("list", { op: "list", model: RULE, limit: RULE_SIZE }).rows;

    rows.forEach((row, position) => {
      expect(resultOf("at", { op: "at", model: RULE, index: position }).row).toEqual(row);
    });
  });

  it("finds no combination past the end of the solution set", () => {
    expect(resultOf("at", { op: "at", model: PRODUCT, index: PRODUCT_SIZE }).row).toBeUndefined();
  });

  it("refuses an index that is not a non-negative integer", () => {
    expect(failureOf({ op: "at", model: PRODUCT, index: -1 })).toMatchObject({ kind: "error" });
    expect(failureOf({ op: "at", model: PRODUCT, index: 0.5 })).toMatchObject({ kind: "error" });
  });
});
