import { describe, expect, expectTypeOf, it } from "vitest";

import { choice, collect, count, defineModel, diagnose, explain, firstValid } from "./index";

/**
 * A fixture shaped like a proxy's measurement matrix: an optimisation mode, a keep-ratio, a retrieval mode and two experimental features, each feature unlocked only by some release channels, with the channel derived as the least one that unlocks what is enabled. Everything here goes through the public API; the expected solution set is computed independently by plain loops.
 */
const MODES = [undefined, "token"] as const;
/** A moderate and an aggressive keep-ratio besides leaving it unset. */
const MODERATE_RATIO = 0.5;
const AGGRESSIVE_RATIO = 0.3;
const RATIOS = [undefined, MODERATE_RATIO, AGGRESSIVE_RATIO] as const;
const RETRIEVALS = [undefined, "lossless", "none"] as const;
const SWITCH = [undefined, true] as const;
const CHANNELS = [undefined, "beta", "canary", "dev"] as const;
const INTERCEPT_CHANNELS: readonly (string | undefined)[] = ["canary", "dev"];
const MATURATION_CHANNELS: readonly (string | undefined)[] = ["beta", "dev"];

const model = defineModel({
  dimensions: [
    choice("mode", MODES),
    choice("targetRatio", RATIOS),
    choice("ccr", RETRIEVALS),
    choice("interceptToolResults", SWITCH),
    choice("readMaturation", SWITCH),
    // The channel only gates the two features, so it takes part only when one is enabled; otherwise it is unset and never a second copy of the same settings.
    firstValid("rolloutChannel", CHANNELS, { activeWhen: { any: [{ set: "interceptToolResults" }, { set: "readMaturation" }] } }),
  ],
  rules: [
    { name: "interceptors need canary or dev", requires: { in: ["rolloutChannel", ["canary", "dev"]] }, when: { is: ["interceptToolResults", true] } },
    { name: "read maturation needs beta or dev", requires: { in: ["rolloutChannel", ["beta", "dev"]] }, when: { is: ["readMaturation", true] } },
  ],
});

interface Settings {
  readonly mode: (typeof MODES)[number];
  readonly targetRatio: (typeof RATIOS)[number];
  readonly ccr: (typeof RETRIEVALS)[number];
  readonly interceptToolResults: (typeof SWITCH)[number];
  readonly readMaturation: (typeof SWITCH)[number];
  readonly rolloutChannel: (typeof CHANNELS)[number];
}

/** The expected settings, by brute force: every product of the free choices, with the least channel the two requirements accept, the channel left unset when no feature needs it. */
function bruteForce(): Settings[] {
  return MODES.flatMap((mode) =>
    RATIOS.flatMap((targetRatio) =>
      RETRIEVALS.flatMap((ccr) =>
        SWITCH.flatMap((interceptToolResults) =>
          SWITCH.flatMap((readMaturation) => {
            const accepts = (channel: (typeof CHANNELS)[number]) => (interceptToolResults !== true || INTERCEPT_CHANNELS.includes(channel)) && (readMaturation !== true || MATURATION_CHANNELS.includes(channel));
            const needsChannel = interceptToolResults !== undefined || readMaturation !== undefined;
            const rolloutChannel = needsChannel ? CHANNELS.find(accepts) : undefined;
            if (needsChannel && rolloutChannel === undefined) return [];

            return [{ mode, targetRatio, ccr, interceptToolResults, readMaturation, rolloutChannel }];
          }),
        ),
      ),
    ),
  );
}

/** A readable name, as a consumer would build one from the settings alone. */
function name(settings: Settings): string {
  return Object.entries(settings)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(", ");
}

describe("the measurement matrix fixture", () => {
  const expected = bruteForce();

  it("infers the type of a combination from the dimensions", () => {
    const [first] = collect(model, { limit: expected.length });
    expectTypeOf(first?.values).toEqualTypeOf<Settings | undefined>();
  });

  it("enumerates exactly the brute-force settings, in the same order", () => {
    expect(collect(model, { limit: expected.length }).map((combination) => combination.values)).toEqual(expected);
    expect(count(model, { limit: expected.length })).toBe(expected.length);
  });

  it("produces only valid combinations, each with its own id and its own name", () => {
    const combinations = collect(model, { limit: expected.length });
    for (const combination of combinations) expect(explain(model, combination.values)).toEqual({ valid: true, id: combination.id });
    expect(new Set(combinations.map((combination) => combination.id)).size).toBe(combinations.length);
    expect(new Set(combinations.map((combination) => name(combination.values))).size).toBe(combinations.length);
  });

  it("never lists the same settings twice with the channel set where nothing needs it", () => {
    const combinations = collect(model, { limit: expected.length });
    const free = combinations.map(({ values }) => JSON.stringify([values.mode, values.targetRatio, values.ccr, values.interceptToolResults, values.readMaturation]));
    expect(new Set(free).size).toBe(combinations.length);
    const withoutFeatures = combinations.filter(({ values }) => values.interceptToolResults === undefined && values.readMaturation === undefined);
    expect(withoutFeatures.every(({ values }) => values.rolloutChannel === undefined)).toBe(true);
    const [plain] = withoutFeatures;
    if (plain === undefined) throw new Error("no combination leaves both features off");
    expect(explain(model, { ...plain.values, rolloutChannel: "dev" })).toMatchObject({ valid: false, reasons: [{ kind: "inactive", dimension: "rolloutChannel", value: "dev" }] });
  });

  it("names the rule that excludes a channel too weak for a feature", () => {
    const explanation = explain(model, { mode: "token", targetRatio: undefined, ccr: undefined, interceptToolResults: true, readMaturation: undefined, rolloutChannel: "beta" });
    expect(explanation).toMatchObject({ valid: false, reasons: [{ kind: "derived", dimension: "rolloutChannel", value: "beta", expected: "canary" }, { kind: "constraint", rule: { name: "interceptors need canary or dev" } }] });
  });

  it("reports every channel as reachable and nothing dead", () => {
    expect(diagnose(model, { limit: expected.length })).toEqual({ status: "satisfiable", count: expected.length, deadValues: [] });
  });
});
