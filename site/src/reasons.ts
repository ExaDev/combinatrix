import type { Value } from "combinatrix";

import { unreachable } from "./exhaustive";
import type { Failure, WireReason } from "./protocol";

/** A value as the page writes it: JSON for a scalar, and `unset` for the absence of one. */
export function describeValue(value: Value): string {
  return value === undefined ? "unset" : JSON.stringify(value);
}

/** One sentence for why a record is not a combination of the model. */
export function describeReason(reason: WireReason): string {
  switch (reason.kind) {
    case "inactive":
      return `${reason.dimension} is set to ${describeValue(reason.value)}, but it is inactive here, so it can only be unset`;
    case "outside-domain":
      return `${describeValue(reason.value)} is not a value ${reason.dimension} can take here`;
    case "derived":
      return `${reason.dimension} is derived from the others as ${describeValue(reason.expected)}, not ${describeValue(reason.value)}`;
    case "no-candidate":
      return `no candidate of ${reason.dimension} is acceptable alongside the others`;
    case "constraint":
      return reason.name === undefined ? `rule ${String(reason.index + 1)} rejects it` : `rule ${String(reason.index + 1)}, "${reason.name}", rejects it`;
    case "unknown-dimension":
      return `${reason.dimension} is not a dimension of the model`;
    case "missing":
      return `${reason.dimension} has no value`;
    case "not-a-value":
      return `${reason.dimension} is not a value a model can hold`;
    case "not-a-record":
      return "the combination is not a record of values";
    default:
      return unreachable(reason);
  }
}

/** The lines that tell the user why a request failed. */
export function describeFailure(failure: Failure): string[] {
  switch (failure.kind) {
    case "syntax":
      return [`The text is not valid JSON: ${failure.message}`];
    case "model":
      return failure.issues.map((issue) => issue.trim());
    case "limit":
    case "error":
      return [failure.message];
    default:
      return unreachable(failure);
  }
}
