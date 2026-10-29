import { describe, expect, it } from "vitest";

import { execute } from "./engine";
import { EXAMPLES, exampleText } from "./examples";

/** How many combinations each example's README section prints or states. */
const PRODUCT_SIZE = 6;
const RULE_SIZE = 16;
const CONDITIONAL_SIZE = 4;
const README_COUNTS: readonly number[] = [PRODUCT_SIZE, RULE_SIZE, CONDITIONAL_SIZE];

describe("EXAMPLES", () => {
  it("has one expected count per example", () => {
    expect(EXAMPLES).toHaveLength(README_COUNTS.length);
  });

  it.each(EXAMPLES.map((example, index) => ({ example, expected: README_COUNTS[index] })))("loads $example.name as a valid model with the size the README gives", ({ example, expected }) => {
    const response = execute({ op: "count", model: exampleText(example) });

    expect(response).toEqual({ ok: true, result: { op: "count", count: expected } });
  });

  it("writes each example as JSON that parses back to its model", () => {
    for (const example of EXAMPLES) expect(JSON.parse(exampleText(example))).toEqual(example.model);
  });
});
