import { describe, expect, it } from "vitest";

import type { Failure, WireReason } from "./protocol";
import { describeFailure, describeReason, describeValue } from "./reasons";

describe("describeValue", () => {
  it("writes scalars as JSON, and tells unset from null and from the text unset", () => {
    expect(describeValue("linux")).toBe('"linux"');
    expect(describeValue(0)).toBe("0");
    expect(describeValue(false)).toBe("false");
    expect(describeValue(null)).toBe("null");
    expect(describeValue(undefined)).toBe("unset");
    expect(describeValue("unset")).toBe('"unset"');
  });
});

describe("describeReason", () => {
  const cases: readonly (readonly [WireReason, string])[] = [
    [{ kind: "inactive", dimension: "codec", value: "zstd" }, 'codec is set to "zstd", but it is inactive here, so it can only be unset'],
    [{ kind: "outside-domain", dimension: "os", value: "plan9" }, '"plan9" is not a value os can take here'],
    [{ kind: "derived", dimension: "codec", value: "zstd", expected: "brotli" }, 'codec is derived from the others as "brotli", not "zstd"'],
    [{ kind: "no-candidate", dimension: "codec" }, "no candidate of codec is acceptable alongside the others"],
    [{ kind: "constraint", index: 0, name: "no bun" }, 'rule 1, "no bun", rejects it'],
    [{ kind: "constraint", index: 2, name: undefined }, "rule 3 rejects it"],
    [{ kind: "unknown-dimension", dimension: "x" }, "x is not a dimension of the model"],
    [{ kind: "missing", dimension: "x" }, "x has no value"],
    [{ kind: "not-a-value", dimension: "x" }, "x is not a value a model can hold"],
    [{ kind: "not-a-record" }, "the combination is not a record of values"],
  ];

  it.each(cases)("describes %j", (reason, sentence) => {
    expect(describeReason(reason)).toBe(sentence);
  });
});

describe("describeFailure", () => {
  it("quotes a syntax error", () => {
    expect(describeFailure({ kind: "syntax", message: "Unexpected token" })).toEqual(["The text is not valid JSON: Unexpected token"]);
  });

  it("lists every issue of an invalid model, trimmed", () => {
    const failure: Failure = { kind: "model", issues: ["  dimension 0 is empty", "rule 0 at $.operand:\n  mentions unknown dimension"] };

    expect(describeFailure(failure)).toEqual(["dimension 0 is empty", "rule 0 at $.operand:\n  mentions unknown dimension"]);
  });

  it("gives the message of a limit or other error", () => {
    expect(describeFailure({ kind: "limit", limit: 5, bound: "solution-set", message: "too many" })).toEqual(["too many"]);
    expect(describeFailure({ kind: "error", message: "bad strength" })).toEqual(["bad strength"]);
  });
});
