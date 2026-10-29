import { describe, expect, it } from "vitest";

import { encodeState, SharedStateError } from "./fragment";
import type { GistFetch } from "./gist";
import { GistError } from "./gist";
import { restoreFrom } from "./restore";

const GIST_MODEL = '{"dimensions":["from the gist"]}';

/** A fetch that serves one gist and records the ids it was asked for. */
function gistServer(): { readonly fetchGist: GistFetch; readonly requested: string[] } {
  const requested: string[] = [];
  const fetchGist: GistFetch = async (url) => {
    requested.push(url);

    return Promise.resolve({ ok: true, status: 200, json: async () => Promise.resolve({ files: { "model.json": { content: GIST_MODEL } } }) });
  };

  return { fetchGist, requested };
}

describe("restoreFrom", () => {
  it("restores the model and index in the fragment", async () => {
    const { fetchGist } = gistServer();
    const hash = `#s=${await encodeState({ model: '{"from":"link"}', index: 3 })}`;

    expect(await restoreFrom({ hash, search: "" }, fetchGist)).toEqual({ model: '{"from":"link"}', index: 3 });
  });

  it("loads the gist named by the query", async () => {
    const { fetchGist, requested } = gistServer();

    expect(await restoreFrom({ hash: "", search: "?gist=abc123" }, fetchGist)).toEqual({ model: GIST_MODEL });
    expect(requested).toEqual(["https://api.github.com/gists/abc123"]);
  });

  it("prefers the fragment to the gist, without fetching it", async () => {
    const { fetchGist, requested } = gistServer();
    const hash = `#s=${await encodeState({ model: "{}" })}`;

    expect(await restoreFrom({ hash, search: "?gist=abc123" }, fetchGist)).toEqual({ model: "{}" });
    expect(requested).toEqual([]);
  });

  it("restores nothing from a location that asks for nothing", async () => {
    const { fetchGist, requested } = gistServer();

    expect(await restoreFrom({ hash: "#section", search: "?other=1" }, fetchGist)).toBeUndefined();
    expect(requested).toEqual([]);
  });

  it("passes on the refusal of a fragment that holds no state", async () => {
    const { fetchGist } = gistServer();

    await expect(restoreFrom({ hash: "#s=AAAA", search: "" }, fetchGist)).rejects.toThrow(SharedStateError);
  });

  it("passes on the refusal of a gist it cannot load", async () => {
    const { fetchGist } = gistServer();

    await expect(restoreFrom({ hash: "", search: "?gist=not/hex" }, fetchGist)).rejects.toThrow(GistError);
  });
});
