/** A model the page offers to load. */
export interface Example {
  readonly name: string;
  /** The model as JSON data, the form `parseModel` accepts. */
  readonly model: unknown;
}

/** The comparison a rule's tree makes of a dimension with a text: trilean's `textCompare`. */
function textIs(op: "equals" | "notEquals", key: string, value: string): unknown {
  return { kind: "textCompare", op, left: { kind: "reference", key }, right: { kind: "textLiteral", value } };
}

/** The dimension is set and `textIs`: an absent value compares as undecided, not false, so a dimension that can be unset is guarded by `exists`. */
function setAndIs(key: string, value: string): unknown {
  return { kind: "and", left: { kind: "exists", operand: { kind: "reference", key } }, right: textIs("equals", key, value) };
}

/** The models of the library's README, written as data. */
export const EXAMPLES: readonly Example[] = [
  {
    name: "Operating systems and architectures",
    model: {
      dimensions: [
        { kind: "choice", name: "os", values: ["linux", "macos", "windows"] },
        { kind: "choice", name: "arch", values: ["x64", "arm64"] },
      ],
    },
  },
  {
    name: "A rule: bun is not offered on Windows",
    model: {
      dimensions: [
        { kind: "choice", name: "os", values: ["linux", "macos", "windows"] },
        { kind: "choice", name: "arch", values: ["x64", "arm64"] },
        { kind: "choice", name: "runtime", values: ["node", "bun", "deno"] },
      ],
      rules: [{ name: "bun is not offered on windows", excludes: textIs("equals", "os", "windows"), when: textIs("equals", "runtime", "bun") }],
    },
  },
  {
    name: "A conditional, derived dimension",
    model: {
      dimensions: [
        { kind: "choice", name: "os", values: ["linux", "windows"] },
        { kind: "choice", name: "compress", values: [true, false] },
        {
          kind: "first-valid",
          name: "codec",
          candidates: ["zstd", "brotli"],
          activeWhen: { kind: "memberOf", op: "in", operand: { kind: "reference", key: "compress" }, candidates: [{ kind: "booleanLiteral", value: true }] },
        },
      ],
      rules: [{ name: "windows has no zstd", excludes: setAndIs("codec", "zstd"), when: textIs("equals", "os", "windows") }],
    },
  },
];

/** The model of an example as the text the editor holds. */
export function exampleText(example: Example): string {
  return JSON.stringify(example.model, null, 2);
}
