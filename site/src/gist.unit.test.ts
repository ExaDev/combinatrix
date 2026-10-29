import { describe, expect, it } from "vitest";

import type { GistFetch, GistResponse } from "./gist";
import { fetchGistModel, GistError, selectGistModel } from "./gist";

const MODEL = '{"dimensions":[]}';
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;

function answer(body: unknown, status = HTTP_OK): GistResponse {
  return { ok: status === HTTP_OK, status, json: async () => Promise.resolve(body) };
}

describe("selectGistModel", () => {
  it("takes the first .json file in the order the API lists them, skipping other files", () => {
    const payload = { files: { "a-notes.md": { content: "notes" }, "b-model.json": { content: MODEL }, "c-other.json": { content: "other" } } };

    expect(selectGistModel(payload)).toBe(MODEL);
  });

  it("matches the extension whatever its case", () => {
    expect(selectGistModel({ files: { "MODEL.JSON": { content: MODEL } } })).toBe(MODEL);
  });

  it("refuses a gist with no .json file", () => {
    expect(() => selectGistModel({ files: { "notes.md": { content: "notes" } } })).toThrow("no .json file");
    expect(() => selectGistModel({ files: {} })).toThrow("no .json file");
  });

  it("refuses a file the API truncated, rather than load half a model", () => {
    expect(() => selectGistModel({ files: { "model.json": { content: MODEL, truncated: true } } })).toThrow("too large");
  });

  it("refuses a file with no text content", () => {
    expect(() => selectGistModel({ files: { "model.json": {} } })).toThrow("no content");
    expect(() => selectGistModel({ files: { "model.json": { content: ["not text"] } } })).toThrow("no content");
    expect(() => selectGistModel({ files: { "model.json": null } })).toThrow("not an object");
  });

  it("refuses a payload that is not a gist", () => {
    for (const payload of [null, undefined, "text", true, {}, { files: null }, { files: "x" }]) {
      expect(() => selectGistModel(payload)).toThrow(GistError);
    }
  });
});

describe("fetchGistModel", () => {
  it("requests the gist from GitHub's API and returns its model", async () => {
    const requests: { url: string; headers: Readonly<Record<string, string>> }[] = [];
    const fetchGist: GistFetch = async (url, init) => {
      requests.push({ url, headers: init.headers });

      return Promise.resolve(answer({ files: { "model.json": { content: MODEL } } }));
    };

    expect(await fetchGistModel("0a1B2c3d4e5f", fetchGist)).toBe(MODEL);
    expect(requests).toEqual([{ url: "https://api.github.com/gists/0a1B2c3d4e5f", headers: { Accept: "application/vnd.github+json" } }]);
  });

  it("reports the status of a failed request", async () => {
    await expect(fetchGistModel("abc", async () => Promise.resolve(answer({}, HTTP_NOT_FOUND)))).rejects.toThrow(String(HTTP_NOT_FOUND));
  });

  it("refuses an id that is not hexadecimal without making a request", async () => {
    let called = false;
    const fetchGist: GistFetch = async () => {
      called = true;

      return Promise.resolve(answer({}));
    };
    const ids = ["", "../users/x", "abc/def", "abc?x=1", "g123", " abc"];

    await Promise.all(
      ids.map(async (id) => {
        await expect(fetchGistModel(id, fetchGist)).rejects.toThrow("is not a gist id");
      }),
    );

    expect(called).toBe(false);
  });
});
