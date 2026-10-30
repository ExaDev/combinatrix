import { describe, expect, it } from "vitest";

import { execute } from "./engine";
import { EXAMPLES, exampleText, STARTING_EXAMPLE } from "./examples";
import type { Request, Result } from "./protocol";
import { isOp } from "./protocol";
import { SCHEMA_URL } from "./schema";

/** How many values the dimensions the examples share have. */
const OPERATING_SYSTEMS = 3;
const ARCHITECTURES = 2;
const RUNTIMES = 3;
const NODE_VERSIONS = 3;
const COMPRESSIONS = 3;
const BROWSERS = 3;
const DATABASES = 3;
const CACHES = 3;
const REGIONS = 2;
const TIERS = 2;

/** How many combinations the rules of an example remove, or leave. Bun on windows removes one for each architecture, and webkit on windows one for each node version. */
const WINDOWS_ARM64_NODE_20 = 1;
const FEATURE_CHAIN = 4;
const BROTLI_WITHOUT_TLS = 1;
const WINDOWS_WITH_OLD_NODE = (NODE_VERSIONS - 1) * BROWSERS;
const WEBKIT_ON_WINDOWS_WITH_OLD_NODE = NODE_VERSIONS - 1;
const FREE_AND_PRO = 2;
const AUDIT_SETTINGS = 2;

/** The example whose dead values tidying removes: the regions and plans that survive, the support levels on a paid plan, and the one on the free plan. */
/** The most combinations the comparison lists, more than any example has. */
const LIST_LIMIT = 1000;
const LIVE_REGIONS = 2;
const SUPPORT_LEVELS = 2;
const SUPPORT_ON_FREE = 1;
const CONDITIONAL_COMBINATIONS = 4;
const CHAIN_COMBINATIONS = 4;
const DEBUG_FLAGS = 2;
const LOG_LEVELS = 3;
const QUIET_LOG_LEVELS = LOG_LEVELS - 1;
const DEV_COMBINATIONS = DEBUG_FLAGS * LOG_LEVELS;
const STAGING_COMBINATIONS = DEBUG_FLAGS * QUIET_LOG_LEVELS;
const LARGE_SPACE = OPERATING_SYSTEMS * NODE_VERSIONS * DATABASES * CACHES * BROWSERS;
const WEBKIT_ELSEWHERE = (OPERATING_SYSTEMS - 1) * NODE_VERSIONS * DATABASES * CACHES;

/**
 * The number of combinations each example has, with the arithmetic that gives it from the dimensions and the rules, so it is checked against the engine and not copied from it. The first three are the sizes the library's README states.
 */
const EXPECTED: ReadonlyMap<string, number> = new Map([
  ["Operating systems and architectures", OPERATING_SYSTEMS * ARCHITECTURES],
  ["A rule: bun is not offered on Windows", OPERATING_SYSTEMS * ARCHITECTURES * RUNTIMES - ARCHITECTURES],
  // linux and windows, each compressed or not; the codec is unset where it is not compressed, and windows has only brotli.
  ["A conditional, derived dimension", CONDITIONAL_COMBINATIONS],
  // tls, http2 and http3 form a chain (http3 needs http2 needs tls), which leaves FEATURE_CHAIN of the eight: all three, the first two, tls alone, none. Each has every compression, less brotli without tls, which only the combination with all three off has.
  ["Features that need other features", FEATURE_CHAIN * COMPRESSIONS - BROTLI_WITHOUT_TLS],
  ["Numbers: a version floor", OPERATING_SYSTEMS * ARCHITECTURES * NODE_VERSIONS - WINDOWS_ARM64_NODE_20],
  // sso is never on, so enterprise has no combination; free and pro have either audit setting.
  ["Values no rule leaves possible", FREE_AND_PRO * AUDIT_SETTINGS],
  // free has one support level and pro has both, in each of the two regions that have capacity; legacy and apac are dead.
  ["Dead values that tidying the model removes", (SUPPORT_ON_FREE + SUPPORT_LEVELS) * LIVE_REGIONS],
  // Webkit on windows, and windows with the two older nodes, share webkit on windows with those nodes.
  ["A CI matrix: membership, any-of and not", OPERATING_SYSTEMS * NODE_VERSIONS * BROWSERS - (NODE_VERSIONS + WINDOWS_WITH_OLD_NODE - WEBKIT_ON_WINDOWS_WITH_OLD_NODE)],
  // dev has every debug flag and log level; staging every flag and the quiet levels; prod no debug flag and the quiet levels.
  ["A rule with an exception", DEV_COMBINATIONS + STAGING_COMBINATIONS + QUIET_LOG_LEVELS],
  // region and tier choose the provider, which is derived: one combination for each.
  ["A derived dimension that falls back", REGIONS * TIERS],
  // tls off: one. tls on: a self-signed certificate: one; an acme certificate: both challenges.
  ["Settings that exist only in a chain", CHAIN_COMBINATIONS],
  // Every combination of the five dimensions, less webkit on the other operating systems with the other three dimensions free.
  ["A larger space for covering arrays", LARGE_SPACE - WEBKIT_ELSEWHERE],
]);

function succeed(request: Request): Result {
  const response = execute(request);
  if (!response.ok) throw new Error(`expected success, got ${JSON.stringify(response.failure)}`);

  return response.result;
}

function textOf(name: string): string {
  const example = EXAMPLES.find((candidate) => candidate.name === name);
  if (example === undefined) throw new Error(`there is no example named ${name}`);

  return exampleText(example);
}

/** The keys every example starts with: the schema it is written against, then its title and description. */
const LEADING_KEYS = ["$schema", "title", "description"];

describe("EXAMPLES", () => {
  it("has one expected count for each, under a name no other has", () => {
    expect(new Set(EXAMPLES.map((example) => example.name)).size).toBe(EXAMPLES.length);
    expect(EXAMPLES.map((example) => example.name)).toEqual([...EXPECTED.keys()]);
  });

  it("starts with an example that has a rule", () => {
    expect(EXAMPLES).toContain(STARTING_EXAMPLE);
    expect(JSON.stringify(STARTING_EXAMPLE.model)).toContain('"rules"');
  });

  it.each(EXAMPLES.map((example) => ({ example, expected: EXPECTED.get(example.name) })))("loads $example.name as a valid model with the size its arithmetic gives", ({ example, expected }) => {
    const response = execute({ op: "count", model: exampleText(example) });

    expect(response).toEqual({ ok: true, result: { op: "count", count: expected } });
  });

  it("writes each example as JSON that parses back to its model", () => {
    for (const example of EXAMPLES) expect(JSON.parse(exampleText(example))).toEqual(example.model);
  });

  it("names the JSON Schema each example is written against, first, as an editor expects", () => {
    for (const example of EXAMPLES) expect(exampleText(example).startsWith(`{\n  "$schema": ${JSON.stringify(SCHEMA_URL)},\n`), example.name).toBe(true);
  });

  it("titles each model with its name and describes it, with a description no other example has, and gives it no id", () => {
    for (const example of EXAMPLES) {
      const model = JSON.parse(exampleText(example)) as Record<string, unknown>;

      expect(model["title"], example.name).toBe(example.name);
      expect(model["description"], example.name).toBe(example.description);
      expect(example.description.trim(), example.name).not.toBe("");
      expect(model, example.name).not.toHaveProperty("id");
      expect(Object.keys(model).slice(0, LEADING_KEYS.length), example.name).toEqual(LEADING_KEYS);
    }
    expect(new Set(EXAMPLES.map((example) => example.description)).size).toBe(EXAMPLES.length);
  });

  it("covers every kind of dimension, every rule form and both rule scopes between them", () => {
    const all = EXAMPLES.map(exampleText).join("\n");

    for (const fragment of ['"kind": "choice"', '"kind": "first-valid"', '"activeWhen"', '"requires"', '"excludes"', '"implies"', '"when"', '"unless"', '"kind": "numberLiteral"', '"kind": "memberOf"', '"kind": "anyOf"', '"kind": "allOf"', '"kind": "not"']) {
      expect(all, fragment).toContain(fragment);
    }
  });

  it("leaves a plan and a flag in no combination in the example about values no rule leaves possible", () => {
    const result = succeed({ op: "diagnose", model: textOf("Values no rule leaves possible") });
    if (!isOp(result, "diagnose")) throw new Error("expected a diagnosis");

    expect(result.diagnosis).toEqual({
      status: "satisfiable",
      count: 4,
      deadValues: [
        { dimension: "plan", value: "enterprise" },
        { dimension: "sso", value: true },
      ],
    });
  });

  it("has dead values that deleting them and the rules that only excluded them leaves the valid combinations unchanged by", () => {
    const text = textOf("Dead values that tidying the model removes");
    const result = succeed({ op: "diagnose", model: text });
    if (!isOp(result, "diagnose")) throw new Error("expected a diagnosis");

    expect(result.diagnosis).toMatchObject({ status: "satisfiable", deadValues: [{ dimension: "plan", value: "legacy" }, { dimension: "region", value: "apac" }] });

    const model = JSON.parse(text) as { dimensions: { name: string; values: string[] }[]; rules: { name: string }[] };
    const tidied = {
      ...model,
      dimensions: model.dimensions.map((dimension) => ({ ...dimension, values: dimension.values.filter((value) => value !== "legacy" && value !== "apac") })),
      rules: model.rules.filter((rule) => rule.name === "priority support needs a paid plan"),
    };
    const rowsOf = (source: string): unknown => {
      const listed = succeed({ op: "list", model: source, limit: LIST_LIMIT });
      if (!isOp(listed, "list")) throw new Error("expected a list");

      return listed.rows.map((row) => row.values);
    };

    expect(rowsOf(JSON.stringify(tidied))).toEqual(rowsOf(text));
    const afterwards = succeed({ op: "diagnose", model: JSON.stringify(tidied) });
    if (!isOp(afterwards, "diagnose")) throw new Error("expected a diagnosis");
    expect(afterwards.diagnosis).toMatchObject({ status: "satisfiable", deadValues: [] });
  });

  it("derives the first provider no rule rejects for each region and tier", () => {
    const result = succeed({ op: "list", model: textOf("A derived dimension that falls back"), limit: 10 });
    if (!isOp(result, "list")) throw new Error("expected a list");

    expect(result.rows.map((row) => row.values)).toEqual([
      { region: "eu", tier: "standard", provider: "aws" },
      { region: "eu", tier: "premium", provider: "azure" },
      { region: "us", tier: "standard", provider: "gcp" },
      { region: "us", tier: "premium", provider: "gcp" },
    ]);
  });

  it("leaves a setting unset where the setting it depends on does not hold", () => {
    const result = succeed({ op: "list", model: textOf("Settings that exist only in a chain"), limit: 10 });
    if (!isOp(result, "list")) throw new Error("expected a list");

    expect(result.rows.map((row) => row.values)).toEqual([
      { tls: true, certificate: "self-signed", challenge: undefined },
      { tls: true, certificate: "acme", challenge: "http-01" },
      { tls: true, certificate: "acme", challenge: "dns-01" },
      { tls: false, certificate: undefined, challenge: undefined },
    ]);
  });

  it("needs far fewer rows than combinations to cover every pair in the larger space", () => {
    const model = textOf("A larger space for covering arrays");
    const result = succeed({ op: "covering", model, strength: 2 });
    if (!isOp(result, "covering")) throw new Error("expected a covering array");

    expect(result.verification.status).toBe("covering");
    expect(result.rows.length).toBeLessThan(EXPECTED.get("A larger space for covering arrays") ?? 0);
  });
});
