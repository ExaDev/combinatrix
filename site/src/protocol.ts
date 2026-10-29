import type { Diagnosis, LimitBound, Scalar, Value, ValueRecord } from "combinatrix";

/**
 * The messages between the page and the engine worker. Every message is a plain structured-clone value (strings, numbers, booleans, `null`, `undefined`, arrays and plain objects), so it crosses the worker boundary unchanged and `undefined` stays distinct from `null`: unset is a value the engine reports, and a JSON text could not carry it.
 *
 * The worker is stateless: each request names the whole model, as the JSON text in the editor, so cancelling an operation by terminating the worker loses nothing.
 */

/** A request to the engine. `model` is the JSON text of a model, parsed by the engine. */
export type Request =
  | { readonly op: "validate"; readonly model: string }
  | { readonly op: "count"; readonly model: string }
  /** The first `limit` combinations in enumeration order, and whether more exist. */
  | { readonly op: "list"; readonly model: string; readonly limit: number }
  | { readonly op: "diagnose"; readonly model: string }
  /** Whether `values`, one value per dimension, is a combination of the model, and its index if it is. */
  | { readonly op: "explain"; readonly model: string; readonly values: ValueRecord }
  | { readonly op: "covering"; readonly model: string; readonly strength: number }
  /** The combination at `index` in enumeration order. */
  | { readonly op: "at"; readonly model: string; readonly index: number };

/** What a page needs to know about one dimension to offer its values. */
export interface DimensionSummary {
  readonly name: string;
  /** The domain of a choice dimension, or the candidates of a first-valid one, in the order the model gives them. */
  readonly values: readonly Scalar[];
  /** Whether the dimension is first-valid: derived from the others, not a free choice. */
  readonly derived: boolean;
  /** Whether the dimension has an `activeWhen` condition, so it may be unset. */
  readonly conditional: boolean;
}

/** One combination with its stable id. */
export interface Row {
  readonly id: string;
  readonly values: ValueRecord;
}

/** How a covering array was checked against the model's solution set. */
export type Verification =
  /** `isCoveringArray` accepted the rows; `solutionSet` is the number of combinations it enumerated. */
  | { readonly status: "covering"; readonly solutionSet: number }
  | { readonly status: "not-covering"; readonly solutionSet: number }
  /** The solution set has more than `limit` combinations, more than the page enumerates to check an array. */
  | { readonly status: "skipped"; readonly limit: number };

/** One reason a record is not a combination of the model, without the engine's functions that a message cannot carry. */
export type WireReason =
  | { readonly kind: "inactive" | "outside-domain"; readonly dimension: string; readonly value: Value }
  | { readonly kind: "derived"; readonly dimension: string; readonly value: Value; readonly expected: Value }
  | { readonly kind: "no-candidate" | "unknown-dimension" | "missing" | "not-a-value"; readonly dimension: string }
  | { readonly kind: "constraint"; readonly index: number; readonly name: string | undefined }
  | { readonly kind: "not-a-record" };

/** Whether a record is a combination: its id and index when it is, every reason when it is not. */
export type WireExplanation = { readonly valid: true; readonly id: string; readonly index: number } | { readonly valid: false; readonly reasons: readonly WireReason[] };

/** The result of a request that succeeded, tagged with the operation that produced it. */
export type Result =
  | { readonly op: "validate"; readonly dimensions: readonly DimensionSummary[] }
  | { readonly op: "count"; readonly count: number }
  | { readonly op: "list"; readonly rows: readonly Row[]; readonly truncated: boolean }
  | { readonly op: "diagnose"; readonly diagnosis: Diagnosis }
  | { readonly op: "explain"; readonly explanation: WireExplanation }
  | { readonly op: "covering"; readonly rows: readonly Row[]; readonly verification: Verification }
  /** `row` is `undefined` when the solution set has `index` combinations or fewer. */
  | { readonly op: "at"; readonly row: Row | undefined };

/** Why a request failed, by what the page can say about it. */
export type Failure =
  /** The model text is not JSON. */
  | { readonly kind: "syntax"; readonly message: string }
  /** The model is not valid; `issues` lists every defect. */
  | { readonly kind: "model"; readonly issues: readonly string[] }
  /** A limit was exceeded: what it bounded and the library's message. */
  | { readonly kind: "limit"; readonly limit: number; readonly bound: LimitBound; readonly message: string }
  /** Any other failure the library reports for the request, such as an out-of-range argument. */
  | { readonly kind: "error"; readonly message: string };

/** The engine's answer to one request. */
export type Response = { readonly ok: true; readonly result: Result } | { readonly ok: false; readonly failure: Failure };

/** Whether a result is the one the operation `op` produces, which narrows it to that operation's shape. */
export function isOp<Op extends Result["op"]>(result: Result, op: Op): result is Extract<Result, { op: Op }> {
  return result.op === op;
}
