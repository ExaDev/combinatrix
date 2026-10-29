import { describe, expect, it } from "vitest";

import { decodeState, encodedStateOf, encodeState, SharedStateError, shareUrl } from "./fragment";
import { MAX_DECODED_STATE_BYTES } from "./limits";

/** The multiplier and increment of a linear congruential generator, so the large model is the same on every run. */
const LCG_MULTIPLIER = 1_103_515_245;
const LCG_INCREMENT = 12_345;

/** The radix that writes a number in the fewest characters. */
const BASE_36 = 36;

/** Dimensions in the large model, and the size in characters it must exceed to count as large (a megabyte of text). */
const LARGE_DIMENSIONS = 20_000;
const LARGE_MODEL_CHARACTERS = 1_000_000;

/** Dimensions in a model that is large enough to need many base64url characters but is quick to build. */
const MODERATE_DIMENSIONS = 500;

/** Copies of one dimension in the repetitive model, and the factor by which deflate must shrink it. */
const REPEATED_DIMENSIONS = 200;
const MINIMUM_SHRINK_FACTOR = 4;

/** An index that is a number but not an integer. */
const FRACTION = 1.5;

/** The factor by which a bomb's encoding must be smaller than what it inflates to. */
const MINIMUM_BOMB_RATIO = 100;

/** A model text of about `dimensions` dimensions, deterministic and not very compressible, so a large link is a real test of the codec. */
function bigModel(dimensions: number): string {
  let seed = 1;
  const next = (): number => {
    seed = (Math.imul(seed, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;

    return seed;
  };

  return JSON.stringify({
    dimensions: Array.from({ length: dimensions }, (_, index) => ({ kind: "choice", name: `dimension-${String(index)}`, values: [next().toString(BASE_36), next().toString(BASE_36), next().toString(BASE_36)] })),
  });
}

describe("encodeState and decodeState", () => {
  it("round-trips a model", async () => {
    const state = { model: '{"dimensions":[{"kind":"choice","name":"os","values":["linux"]}]}' };

    expect(await decodeState(await encodeState(state))).toEqual(state);
  });

  it("round-trips a selected index, including zero", async () => {
    expect(await decodeState(await encodeState({ model: "{}", index: 0 }))).toEqual({ model: "{}", index: 0 });
    expect(await decodeState(await encodeState({ model: "{}", index: 41 }))).toEqual({ model: "{}", index: 41 });
  });

  it("round-trips unicode, including characters outside the basic plane and lone-looking combining marks", async () => {
    const model = '{"name":"ünïcödé 日本語 \u{1F680} é ‍ العربية \\u0000"}';

    expect((await decodeState(await encodeState({ model }))).model).toBe(model);
  });

  it("round-trips a large model", async () => {
    const model = bigModel(LARGE_DIMENSIONS);
    expect(model.length).toBeGreaterThan(LARGE_MODEL_CHARACTERS);

    expect((await decodeState(await encodeState({ model }))).model).toBe(model);
  });

  it("writes only base64url characters, with no padding", async () => {
    const encoded = await encodeState({ model: bigModel(MODERATE_DIMENSIONS) });

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("compresses a repetitive model", async () => {
    const model = JSON.stringify({ dimensions: Array.from({ length: REPEATED_DIMENSIONS }, () => ({ kind: "choice", name: "same", values: ["same", "same"] })) });

    expect((await encodeState({ model })).length).toBeLessThan(model.length / MINIMUM_SHRINK_FACTOR);
  });
});

describe("decodeState refusals", () => {
  it("refuses text that is not base64url", async () => {
    await expect(decodeState("not base64+/=")).rejects.toThrow(SharedStateError);
  });

  it("refuses base64url that is not deflate data", async () => {
    await expect(decodeState("AAAAAAAAAAAAAAAA")).rejects.toThrow("not a compressed state");
  });

  it("refuses a length that cannot be base64", async () => {
    await expect(decodeState("A")).rejects.toThrow(SharedStateError);
  });

  it("refuses compressed data that is not JSON", async () => {
    const compressed = await compressText("not json at all");

    await expect(decodeState(compressed)).rejects.toThrow("not JSON");
  });

  it("refuses JSON that holds no model", async () => {
    await expect(decodeState(await compressText(JSON.stringify({ index: 1 })))).rejects.toThrow("no model");
    await expect(decodeState(await compressText(JSON.stringify({ model: 5 })))).rejects.toThrow("no model");
    await expect(decodeState(await compressText("null"))).rejects.toThrow("no model");
  });

  it("refuses an index that is not a non-negative integer", async () => {
    const indexes: readonly unknown[] = [-1, FRACTION, "3", null];

    await Promise.all(indexes.map(async (index) => {
      await expect(decodeState(await compressText(JSON.stringify({ model: "{}", index })))).rejects.toThrow("index");
    }));
  });

  it("refuses data that inflates past the limit", async () => {
    const bomb = await encodeState({ model: " ".repeat(MAX_DECODED_STATE_BYTES) });
    expect(bomb.length).toBeLessThan(MAX_DECODED_STATE_BYTES / MINIMUM_BOMB_RATIO);

    expect(await outcomeOf(decodeState(bomb))).toContain("larger than");
  });

  it("accepts data that inflates to exactly the limit", async () => {
    const overhead = new TextEncoder().encode(JSON.stringify({ model: "" })).length;
    const model = " ".repeat(MAX_DECODED_STATE_BYTES - overhead);

    expect(await outcomeOf(decodeState(await encodeState({ model })))).toBe("decoded");
  });
});

describe("shareUrl and encodedStateOf", () => {
  it("writes the state into the fragment of the page's address, replacing its query and fragment", async () => {
    const link = await shareUrl("https://example.com/combinatrix/?gist=abc123#old", { model: "{}", index: 2 });
    const url = new URL(link);

    expect(url.origin + url.pathname).toBe("https://example.com/combinatrix/");
    expect(url.search).toBe("");
    expect(await decodeState(encodedStateOf(url.hash) ?? "")).toEqual({ model: "{}", index: 2 });
  });

  it("reads the encoded state from a fragment with or without its hash sign and beside other parameters", () => {
    expect(encodedStateOf("#s=abc")).toBe("abc");
    expect(encodedStateOf("s=abc")).toBe("abc");
    expect(encodedStateOf("#other=1&s=abc")).toBe("abc");
  });

  it("finds no state in a fragment without one", () => {
    expect(encodedStateOf("")).toBeUndefined();
    expect(encodedStateOf("#")).toBeUndefined();
    expect(encodedStateOf("#section")).toBeUndefined();
  });
});

/** How a decode ended, as short text: a failed assertion about a decoded value as large as the limit would otherwise print all of it. */
async function outcomeOf(decoded: Readonly<Promise<unknown>>): Promise<string> {
  try {
    await decoded;

    return "decoded";
  } catch (error) {
    return error instanceof Error ? error.message : "failed";
  }
}

/** Compresses text the way the codec does, so a test can make a payload that is well-formed deflate but not a state. */
async function compressText(text: string): Promise<string> {
  return encodeRaw(new TextEncoder().encode(text));
}

async function encodeRaw(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());

  return btoa(String.fromCharCode(...compressed)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
