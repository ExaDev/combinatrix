import { describe, expect, it } from "vitest";

import { ADDRESS_DEBOUNCE_MS, addressFor } from "./address";
import { decodeState, encodedStateOf } from "./fragment";

const PAGE = "https://example.com/combinatrix/";
const OPENED = { href: `${PAGE}?gist=0123abcd`, state: { model: '{"dimensions":[]}', index: 0 } };

/** A model long enough that its link is clearly longer than the small limit the test sets. */
const OVERSIZE_CHARACTERS = 1000;

/** A maximum length that no link in these tests reaches, so the limit is not what they are about. */
const NO_LIMIT = Number.MAX_SAFE_INTEGER;

describe("addressFor", () => {
  it("keeps the address the page opened at while the state is the one it opened with", async () => {
    expect(await addressFor(OPENED, `${PAGE}#s=anything`, { ...OPENED.state })).toEqual({ kind: "unchanged", href: OPENED.href });
  });

  it("keeps the opened address for a page that opened without an index until an index is chosen", async () => {
    const opened = { href: PAGE, state: { model: "{}" } };

    expect(await addressFor(opened, PAGE, { model: "{}" })).toEqual({ kind: "unchanged", href: PAGE });
    expect((await addressFor(opened, PAGE, { model: "{}", index: 0 })).kind).toBe("link");
  });

  it("makes a link holding the changed model, with the query of the current address dropped", async () => {
    const changed = { model: '{"dimensions":[{"kind":"choice","name":"os","values":["linux"]}]}', index: 3 };
    const address = await addressFor(OPENED, `${PAGE}?gist=0123abcd`, changed, NO_LIMIT);

    expect(address.kind).toBe("link");
    const url = new URL(address.href);
    expect(url.search).toBe("");
    const encoded = encodedStateOf(url.hash);
    expect(encoded).toBeDefined();
    expect(await decodeState(String(encoded))).toEqual(changed);
  });

  it("makes the same link Copy link would make for the same state", async () => {
    const changed = { model: '{"dimensions":[]} ', index: 1 };
    const first = await addressFor(OPENED, PAGE, changed, NO_LIMIT);
    const second = await addressFor(OPENED, first.href, changed, NO_LIMIT);

    expect(second.href).toBe(first.href);
  });

  it("falls back to the opened address once a changed state is changed back", async () => {
    const changed = { model: "{}", index: 0 };
    const link = await addressFor(OPENED, PAGE, changed, NO_LIMIT);
    const back = await addressFor(OPENED, link.href, { ...OPENED.state }, NO_LIMIT);

    expect(back).toEqual({ kind: "unchanged", href: OPENED.href });
  });

  it("drops the query and fragment, and says so, for a link longer than the limit", async () => {
    const changed = { model: "x".repeat(OVERSIZE_CHARACTERS), index: 0 };
    const link = await addressFor(OPENED, PAGE, changed, NO_LIMIT);
    const address = await addressFor(OPENED, `${PAGE}?gist=0123abcd#s=stale`, changed, link.href.length - 1);

    expect(address).toEqual({ kind: "too-large", href: PAGE });
  });

  it("accepts a link exactly as long as the limit", async () => {
    const changed = { model: "{}", index: 0 };
    const link = await addressFor(OPENED, PAGE, changed, NO_LIMIT);

    expect((await addressFor(OPENED, PAGE, changed, link.href.length)).kind).toBe("link");
  });
});

describe("ADDRESS_DEBOUNCE_MS", () => {
  it("spaces writes so that WebKit's window never holds more than its limit", () => {
    const WINDOW_MS = 30_000;
    const CALLS = 100;

    expect(Math.floor(WINDOW_MS / ADDRESS_DEBOUNCE_MS)).toBeLessThanOrEqual(CALLS);
  });
});
