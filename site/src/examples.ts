import { SCHEMA_URL } from "./schema";

/** A model the page offers to load. */
export interface Example {
  readonly name: string;
  /** The model as JSON data, the form `parseModel` accepts, naming the schema it is written against. */
  readonly model: unknown;
}

/** An example whose model declares the schema it is written against, so an editor that opens an exported copy checks it. */
function exampleOf(name: string, model: Readonly<Record<string, unknown>>): Example {
  return { name, model: { $schema: SCHEMA_URL, ...model } };
}

/** The Node.js majors the examples that have a version dimension take, oldest to newest. */
const OLDEST_NODE = 20;
const MIDDLE_NODE = 22;
const NEWEST_NODE = 24;

/** A dimension's value, as a tree reads it. */
function ref(key: string): unknown {
  return { kind: "reference", key };
}

/** A text, a number and a boolean written into a tree. */
function text(value: string): unknown {
  return { kind: "textLiteral", value };
}

function num(value: number): unknown {
  return { kind: "numberLiteral", value };
}

function bool(value: boolean): unknown {
  return { kind: "booleanLiteral", value };
}

/** The comparison a rule's tree makes of a dimension with a text: trilean's `textCompare`. */
function textIs(op: "equals" | "notEquals", key: string, value: string): unknown {
  return { kind: "textCompare", op, left: ref(key), right: text(value) };
}

/** The comparison of a numeric dimension with a number: trilean's `compare`. */
function numIs(op: "gt" | "gte" | "lt" | "lte" | "eq" | "neq", key: string, value: number): unknown {
  return { kind: "compare", op, left: ref(key), right: num(value) };
}

/** The boolean dimension is true, or (with `false`) false: membership of its value in the one boolean, which is how the model states a flag. */
function flagIs(key: string, value: boolean): unknown {
  return { kind: "memberOf", op: "in", operand: ref(key), candidates: [bool(value)] };
}

/** The dimension's value is, or (`notIn`) is not, one of the given texts. */
function textIn(op: "in" | "notIn", key: string, values: readonly string[]): unknown {
  return { kind: "memberOf", op, operand: ref(key), candidates: values.map(text) };
}

/** Every condition holds, some condition holds, and the condition does not hold. */
function allOf(...operands: readonly unknown[]): unknown {
  return { kind: "allOf", operands };
}

function anyOf(...operands: readonly unknown[]): unknown {
  return { kind: "anyOf", operands };
}

function not(operand: unknown): unknown {
  return { kind: "not", operand };
}

/** The dimension is set: it is not left unset by its `activeWhen`. */
function exists(key: string): unknown {
  return { kind: "exists", operand: ref(key) };
}

/** The dimension is set and `textIs`: an absent value compares as undecided, not false, so a dimension that can be unset is guarded by `exists`. */
function setAndIs(key: string, value: string): unknown {
  return { kind: "and", left: exists(key), right: textIs("equals", key, value) };
}

/**
 * The models the page offers, each showing a different part of what a model can state. The first three are the library README's, in the README's order, and the rest are ordered from the nearest to the furthest from them: rules that imply, numbers, values no rule leaves possible, membership and negation, an exception, a fallback, settings that exist only in a chain, and a space large enough for a covering array.
 */
export const EXAMPLES: readonly Example[] = [
  exampleOf("Operating systems and architectures", {
    dimensions: [
      { kind: "choice", name: "os", values: ["linux", "macos", "windows"] },
      { kind: "choice", name: "arch", values: ["x64", "arm64"] },
    ],
  }),
  exampleOf("A rule: bun is not offered on Windows", {
    dimensions: [
      { kind: "choice", name: "os", values: ["linux", "macos", "windows"] },
      { kind: "choice", name: "arch", values: ["x64", "arm64"] },
      { kind: "choice", name: "runtime", values: ["node", "bun", "deno"] },
    ],
    rules: [{ name: "bun is not offered on windows", excludes: textIs("equals", "os", "windows"), when: textIs("equals", "runtime", "bun") }],
  }),
  exampleOf("A conditional, derived dimension", {
    dimensions: [
      { kind: "choice", name: "os", values: ["linux", "windows"] },
      { kind: "choice", name: "compress", values: [true, false] },
      { kind: "first-valid", name: "codec", candidates: ["zstd", "brotli"], activeWhen: flagIs("compress", true) },
    ],
    rules: [{ name: "windows has no zstd", excludes: setAndIs("codec", "zstd"), when: textIs("equals", "os", "windows") }],
  }),
  exampleOf("Features that need other features", {
    dimensions: [
      { kind: "choice", name: "tls", values: [true, false] },
      { kind: "choice", name: "http2", values: [true, false] },
      { kind: "choice", name: "http3", values: [true, false] },
      { kind: "choice", name: "compression", values: ["none", "gzip", "brotli"] },
    ],
    rules: [
      { name: "http2 needs tls", implies: [flagIs("http2", true), flagIs("tls", true)] },
      { name: "http3 needs http2", implies: [flagIs("http3", true), flagIs("http2", true)] },
      { name: "brotli is only offered over tls", requires: flagIs("tls", true), when: textIs("equals", "compression", "brotli") },
    ],
  }),
  exampleOf("Numbers: a version floor", {
    dimensions: [
      { kind: "choice", name: "os", values: ["linux", "macos", "windows"] },
      { kind: "choice", name: "arch", values: ["x64", "arm64"] },
      { kind: "choice", name: "node", values: [OLDEST_NODE, MIDDLE_NODE, NEWEST_NODE] },
    ],
    rules: [{ name: "windows on arm64 needs node 22 or later", requires: numIs("gte", "node", MIDDLE_NODE), when: allOf(textIs("equals", "os", "windows"), textIs("equals", "arch", "arm64")) }],
  }),
  exampleOf("Values no rule leaves possible", {
    dimensions: [
      { kind: "choice", name: "plan", values: ["free", "pro", "enterprise"] },
      { kind: "choice", name: "sso", values: [false, true] },
      { kind: "choice", name: "audit", values: [false, true] },
    ],
    rules: [
      { name: "enterprise needs sso", requires: flagIs("sso", true), when: textIs("equals", "plan", "enterprise") },
      { name: "sso is not shipped yet", excludes: flagIs("sso", true) },
    ],
  }),
  exampleOf("A CI matrix: membership, any-of and not", {
    dimensions: [
      { kind: "choice", name: "os", values: ["ubuntu", "macos", "windows"] },
      { kind: "choice", name: "node", values: [OLDEST_NODE, MIDDLE_NODE, NEWEST_NODE] },
      { kind: "choice", name: "browser", values: ["chromium", "firefox", "webkit"] },
    ],
    rules: [
      { name: "webkit only runs where apple ships it", requires: textIn("in", "os", ["macos", "ubuntu"]), when: textIs("equals", "browser", "webkit") },
      { name: "windows runs only the newest node", excludes: anyOf(numIs("eq", "node", OLDEST_NODE), numIs("eq", "node", MIDDLE_NODE)), when: not(textIn("notIn", "os", ["windows"])) },
    ],
  }),
  exampleOf("A rule with an exception", {
    dimensions: [
      { kind: "choice", name: "deploy", values: ["dev", "staging", "prod"] },
      { kind: "choice", name: "debug", values: [true, false] },
      { kind: "choice", name: "logLevel", values: ["debug", "info", "warn"] },
    ],
    rules: [
      { name: "no debug flag in production", excludes: flagIs("debug", true), when: textIs("equals", "deploy", "prod") },
      { name: "debug logging is for development only", excludes: textIs("equals", "logLevel", "debug"), unless: textIs("equals", "deploy", "dev") },
    ],
  }),
  exampleOf("A derived dimension that falls back", {
    dimensions: [
      { kind: "choice", name: "region", values: ["eu", "us"] },
      { kind: "choice", name: "tier", values: ["standard", "premium"] },
      { kind: "first-valid", name: "provider", candidates: ["aws", "gcp", "azure"] },
    ],
    rules: [
      { name: "aws has no capacity in the us", excludes: textIs("equals", "provider", "aws"), when: textIs("equals", "region", "us") },
      { name: "aws is not offered at the premium tier", excludes: textIs("equals", "provider", "aws"), when: textIs("equals", "tier", "premium") },
      { name: "gcp has no eu region", excludes: textIs("equals", "provider", "gcp"), when: textIs("equals", "region", "eu") },
    ],
  }),
  exampleOf("Settings that exist only in a chain", {
    dimensions: [
      { kind: "choice", name: "tls", values: [true, false] },
      { kind: "choice", name: "certificate", values: ["self-signed", "acme"], activeWhen: flagIs("tls", true) },
      { kind: "choice", name: "challenge", values: ["http-01", "dns-01"], activeWhen: setAndIs("certificate", "acme") },
    ],
  }),
  exampleOf("A larger space for covering arrays", {
    dimensions: [
      { kind: "choice", name: "os", values: ["linux", "macos", "windows"] },
      { kind: "choice", name: "node", values: [OLDEST_NODE, MIDDLE_NODE, NEWEST_NODE] },
      { kind: "choice", name: "database", values: ["postgres", "mysql", "sqlite"] },
      { kind: "choice", name: "cache", values: ["none", "redis", "memcached"] },
      { kind: "choice", name: "browser", values: ["chromium", "firefox", "webkit"] },
    ],
    rules: [{ name: "webkit is tested only on macos", requires: textIs("equals", "os", "macos"), when: textIs("equals", "browser", "webkit") }],
  }),
];

/** The example the page opens with when a link does not give a model: the first that has a rule. */
export const STARTING_EXAMPLE: Example = (() => {
  const [, started] = EXAMPLES;
  if (started === undefined) throw new Error("unreachable: there are several examples");

  return started;
})();

/** The model of an example as the text the editor holds. */
export function exampleText(example: Example): string {
  return JSON.stringify(example.model, null, 2);
}
