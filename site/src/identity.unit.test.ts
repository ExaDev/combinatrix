import { describe, expect, it } from "vitest";

import { asCopy, detailOf, identify, idOf, modelOfText, nameOf, withDetail } from "./identity";
import type { JsonObject } from "./json";

/** Ids `new-1`, `new-2` and so on, in the order they are asked for. */
function counter(): () => string {
  let next = 0;

  return () => {
    next += 1;

    return `new-${String(next)}`;
  };
}

const MODEL: JsonObject = { $schema: "https://example.com/schema.json", dimensions: [], rules: [] };

describe("modelOfText", () => {
  it("reads a model, and nothing that is not an object or not JSON", () => {
    expect(modelOfText('{"dimensions":[]}')).toEqual({ dimensions: [] });
    expect(modelOfText("[1]")).toBeUndefined();
    expect(modelOfText("null")).toBeUndefined();
    expect(modelOfText("{")).toBeUndefined();
  });
});

describe("detailOf", () => {
  it("reads text, and takes empty text or another type for no detail", () => {
    expect(detailOf({ title: "Builds" }, "title")).toBe("Builds");
    expect(detailOf({ title: "" }, "title")).toBeUndefined();
    expect(detailOf({ title: 3 }, "title")).toBeUndefined();
    expect(detailOf({}, "title")).toBeUndefined();
    expect(detailOf(undefined, "title")).toBeUndefined();
  });
});

describe("withDetail", () => {
  it("writes the leading keys first, in the order schema, id, title, description, whatever order the model had", () => {
    let model: JsonObject = { dimensions: [], $schema: "s", rules: [] };
    model = withDetail(model, "description", "d");
    model = withDetail(model, "title", "t");
    model = withDetail(model, "id", "i");

    expect(Object.keys(model)).toEqual(["$schema", "id", "title", "description", "dimensions", "rules"]);
  });

  it("removes a detail set to empty text, and keeps every other key as it was", () => {
    const model = withDetail({ id: "i", title: "t", note: "kept", dimensions: [] }, "title", "");

    expect(model).toEqual({ id: "i", note: "kept", dimensions: [] });
    expect(Object.keys(model)).toEqual(["id", "note", "dimensions"]);
  });
});

describe("identify", () => {
  it("keeps the id a model has and mints none", () => {
    const mint = counter();
    const model = { ...MODEL, id: "own" };

    expect(identify(model, mint)).toEqual({ id: "own", model });
    expect(mint()).toBe("new-1");
  });

  it("gives a model with no id the one that is minted, after its schema", () => {
    const { id, model } = identify(MODEL, counter());

    expect(id).toBe("new-1");
    expect(idOf(model)).toBe("new-1");
    expect(Object.keys(model)).toEqual(["$schema", "id", "dimensions", "rules"]);
  });

  it("treats an empty id as none", () => {
    expect(identify({ id: "", dimensions: [] }, counter()).id).toBe("new-1");
  });
});

describe("asCopy", () => {
  it("is the same model under an id of its own, so it is not the one it was copied from", () => {
    const original: JsonObject = { ...MODEL, id: "own", title: "Builds" };

    const copy = asCopy(original, counter());

    expect(copy.id).toBe("new-1");
    expect(copy.model).toEqual({ ...original, id: "new-1" });
    expect(idOf(original)).toBe("own");
  });
});

describe("nameOf", () => {
  it("is the title, otherwise the fallback", () => {
    expect(nameOf({ title: "Builds" }, "Untitled")).toBe("Builds");
    expect(nameOf({}, "Untitled")).toBe("Untitled");
    expect(nameOf(undefined, "Untitled")).toBe("Untitled");
  });
});
