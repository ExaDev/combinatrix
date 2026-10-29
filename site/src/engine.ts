import type { DataReason, Model, ModelData, ValueRecord } from "combinatrix";
import { at, collect, combinations, CombinatrixError, count, coveringArray, diagnose, explainData, indexOfData, isCoveringArray, isModelData, LimitExceededError, ModelError, parseModel } from "combinatrix";

import { unreachable } from "./exhaustive";
import { VERIFICATION_SOLUTION_SET_LIMIT } from "./limits";
import type { DimensionSummary, Failure, Request, Response, Result, Row, Verification, WireExplanation, WireReason } from "./protocol";

/**
 * Runs one request against the library and answers it. Failures that are about the user's input (text that is not JSON, an invalid model, a limit, an argument the library refuses) come back as a `Response`; anything else is a defect in the page and propagates.
 */
export function execute(request: Request): Response {
  try {
    return { ok: true, result: run(request) };
  } catch (error) {
    return { ok: false, failure: failureOf(error) };
  }
}

function failureOf(error: unknown): Failure {
  if (error instanceof SyntaxError) return { kind: "syntax", message: error.message };
  if (error instanceof ModelError) return { kind: "model", issues: error.issues };
  if (error instanceof LimitExceededError) return { kind: "limit", limit: error.limit, bound: error.bound, message: error.message };
  if (error instanceof CombinatrixError || error instanceof RangeError) return { kind: "error", message: error.message };

  throw error;
}

function run(request: Request): Result {
  const data: unknown = JSON.parse(request.model);
  const model = parseModel(data);

  switch (request.op) {
    case "validate":
      if (!isModelData(data)) throw new Error("unreachable: parseModel accepted data that isModelData refuses");

      return { op: "validate", dimensions: summarise(data) };
    case "count":
      return { op: "count", count: count(model) };
    case "list":
      return { op: "list", ...list(model, request.limit) };
    case "diagnose":
      return { op: "diagnose", diagnosis: diagnose(model) };
    case "explain":
      return { op: "explain", explanation: explain(model, request.values) };
    case "covering":
      return { op: "covering", ...cover(model, request.strength) };
    case "at": {
      const combination = at(model, request.index);

      return { op: "at", row: combination === undefined ? undefined : rowOf(combination) };
    }
    default:
      return unreachable(request);
  }
}

function rowOf(combination: { readonly id: string; readonly values: ValueRecord }): Row {
  return { id: combination.id, values: combination.values };
}

/** What the page offers for each dimension. */
function summarise(data: ModelData): DimensionSummary[] {
  return data.dimensions.map((dimension) => ({
    name: dimension.name,
    values: dimension.kind === "choice" ? dimension.values : dimension.candidates,
    derived: dimension.kind === "first-valid",
    conditional: dimension.activeWhen !== undefined,
  }));
}

/**
 * The first `limit` combinations. The library's own `limit` throws instead of yielding the combination past it, which is how the engine learns that more exist without enumerating them.
 */
function list(model: Model<ValueRecord>, limit: number): { readonly rows: readonly Row[]; readonly truncated: boolean } {
  const rows: Row[] = [];
  try {
    for (const combination of combinations(model, { limit })) rows.push(rowOf(combination));
  } catch (error) {
    if (!(error instanceof LimitExceededError)) throw error;

    return { rows, truncated: true };
  }

  return { rows, truncated: false };
}

function explain(model: Model<ValueRecord>, values: ValueRecord): WireExplanation {
  const explanation = explainData(model, values);
  if (!explanation.valid) return { valid: false, reasons: explanation.reasons.map(wireReason) };

  const index = indexOfData(model, values);
  if (index < 0) throw new Error("unreachable: explainData accepted a record that indexOfData does not find");

  return { valid: true, id: explanation.id, index };
}

/** A reason without the constraint's evaluation function, which a message cannot carry. */
function wireReason(reason: DataReason): WireReason {
  switch (reason.kind) {
    case "inactive":
    case "outside-domain":
      return { kind: reason.kind, dimension: reason.dimension, value: reason.value };
    case "derived":
      return { kind: "derived", dimension: reason.dimension, value: reason.value, expected: reason.expected };
    case "no-candidate":
    case "unknown-dimension":
    case "missing":
    case "not-a-value":
      return { kind: reason.kind, dimension: reason.dimension };
    case "constraint":
      return { kind: "constraint", index: reason.index, name: reason.constraint.name };
    case "not-a-record":
      return { kind: "not-a-record" };
    default:
      return unreachable(reason);
  }
}

/**
 * A covering array of the given strength and whether it covers. The check enumerates the whole solution set, so it runs only when the solution set is within `VERIFICATION_SOLUTION_SET_LIMIT`, counted by the library's own `limit`.
 */
function cover(model: Model<ValueRecord>, strength: number): { readonly rows: readonly Row[]; readonly verification: Verification } {
  const rows = collect(model, { strategy: coveringArray({ strength }) }).map(rowOf);

  return { rows, verification: verify(model, rows, strength) };
}

function verify(model: Model<ValueRecord>, rows: readonly Row[], strength: number): Verification {
  let solutionSet: number;
  try {
    solutionSet = count(model, { limit: VERIFICATION_SOLUTION_SET_LIMIT });
  } catch (error) {
    if (!(error instanceof LimitExceededError)) throw error;

    return { status: "skipped", limit: VERIFICATION_SOLUTION_SET_LIMIT };
  }

  const covering = isCoveringArray(
    rows.map((row) => row.values),
    model,
    { strength, limit: solutionSet },
  );

  return { status: covering ? "covering" : "not-covering", solutionSet };
}
