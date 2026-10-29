import { describe, expect, it } from "vitest";

import type { Json } from "./json";
import { arrayAt, getIn, insertAt, isJson, isJsonArray, isJsonObject, moveAt, objectAt, omit, parseJson, removeAt, setIn, updateIn } from "./json";

/** A fraction, the length of the three-item list below, which is also the first position past its end, and a position far past it. */
const FRACTION = 1.5;
const LIST_LENGTH = 3;
const FAR_LIST_LENGTH = 9;

const DOCUMENT: Json = { list: [{ name: "a" }, { name: "b" }, { name: "c" }], other: { untouched: [1, 2] } };

describe("isJson and parseJson", () => {
  it("accepts every kind of JSON value, nested", () => {
    expect(isJson({ a: [null, true, "x", FRACTION, { b: [] }] })).toBe(true);
  });

  it("refuses what JSON cannot hold", () => {
    expect(isJson(undefined)).toBe(false);
    expect(isJson(Number.NaN)).toBe(false);
    expect(isJson(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isJson(() => 1)).toBe(false);
    expect(isJson({ a: undefined })).toBe(false);
    expect(isJson([1, undefined])).toBe(false);
    expect(isJson(BigInt(LIST_LENGTH))).toBe(false);
  });

  it("parses text, and throws SyntaxError for what is not JSON", () => {
    expect(parseJson('{"a":[1]}')).toEqual({ a: [1] });
    expect(() => parseJson("{ nope")).toThrow(SyntaxError);
  });

  it("keeps a key that would set a prototype as an own key", () => {
    const parsed = parseJson('{"__proto__": 1}');

    expect(isJsonObject(parsed) && Object.hasOwn(parsed, "__proto__")).toBe(true);
  });
});

describe("getIn", () => {
  it("reads through objects and arrays", () => {
    expect(getIn(DOCUMENT, ["list", 1, "name"])).toBe("b");
    expect(getIn(DOCUMENT, [])).toBe(DOCUMENT);
  });

  it("is undefined where the path leaves the value, including inherited keys", () => {
    expect(getIn(DOCUMENT, ["list", FAR_LIST_LENGTH])).toBeUndefined();
    expect(getIn(DOCUMENT, ["missing", "deeper"])).toBeUndefined();
    expect(getIn(DOCUMENT, ["list", "name"])).toBeUndefined();
    expect(getIn(DOCUMENT, ["constructor"])).toBeUndefined();
  });
});

describe("updateIn and setIn", () => {
  it("replaces one value and shares everything else", () => {
    const updated = setIn(DOCUMENT, ["list", 1, "name"], "B");

    expect(getIn(updated, ["list", 1, "name"])).toBe("B");
    expect(getIn(updated, ["list", 0])).toBe(getIn(DOCUMENT, ["list", 0]));
    expect(getIn(updated, ["other"])).toBe(getIn(DOCUMENT, ["other"]));
  });

  it("does not change the value it was given", () => {
    const before = structuredClone(DOCUMENT);

    setIn(DOCUMENT, ["list", 0, "name"], "z");

    expect(DOCUMENT).toEqual(before);
  });

  it("applies a function to the current value", () => {
    expect(updateIn({ n: 1 }, ["n"], (current) => (typeof current === "number" ? current + 1 : current))).toEqual({ n: 2 });
  });

  it("throws where the path leaves the value", () => {
    expect(() => setIn(DOCUMENT, ["list", LIST_LENGTH], "x")).toThrow(`no position ${String(LIST_LENGTH)}`);
    expect(() => setIn(DOCUMENT, ["list", -1], "x")).toThrow("no position -1");
    expect(() => setIn(DOCUMENT, ["nothing"], "x")).toThrow("no key nothing");
    expect(() => setIn(DOCUMENT, ["list", "name"], "x")).toThrow("no key name");
  });
});

describe("omit", () => {
  it("drops a key and keeps the others in order", () => {
    expect(Object.keys(omit({ a: 1, b: 2, c: LIST_LENGTH }, "b"))).toEqual(["a", "c"]);
  });
});

describe("list edits", () => {
  const list = ["list"];

  it("inserts at a position, including the end", () => {
    expect(arrayAt(insertAt(DOCUMENT, list, 1, "x"), list).map((item) => (isJsonObject(item) ? item["name"] : item))).toEqual(["a", "x", "b", "c"]);
    expect(arrayAt(insertAt(DOCUMENT, list, LIST_LENGTH, "end"), list)).toHaveLength(LIST_LENGTH + 1);
  });

  it("removes a position, and refuses one that is not there", () => {
    expect(arrayAt(removeAt(DOCUMENT, list, 0), list)).toHaveLength(LIST_LENGTH - 1);
    expect(() => removeAt(DOCUMENT, list, LIST_LENGTH)).toThrow(`no position ${String(LIST_LENGTH)}`);
  });

  it("swaps an item with its neighbour", () => {
    const names = (document: Json): Json[] => arrayAt(document, list).map((item) => (isJsonObject(item) ? (item["name"] ?? null) : null));

    expect(names(moveAt(DOCUMENT, list, 1, "earlier"))).toEqual(["b", "a", "c"]);
    expect(names(moveAt(DOCUMENT, list, 1, "later"))).toEqual(["a", "c", "b"]);
  });

  it("leaves the list as it is at the end it is moving towards", () => {
    expect(moveAt(DOCUMENT, list, 0, "earlier")).toEqual(DOCUMENT);
    expect(moveAt(DOCUMENT, list, 2, "later")).toEqual(DOCUMENT);
  });

  it("refuses to move a position that is not there", () => {
    expect(() => moveAt(DOCUMENT, list, FAR_LIST_LENGTH, "later")).toThrow(`no position ${String(FAR_LIST_LENGTH)}`);
  });

  it("reads an object and an array at a path, and refuses anything else", () => {
    expect(objectAt(DOCUMENT, ["other"])).toEqual({ untouched: [1, 2] });
    expect(isJsonArray(arrayAt(DOCUMENT, ["list"]))).toBe(true);
    expect(() => objectAt(DOCUMENT, ["list"])).toThrow("expected an object");
    expect(() => arrayAt(DOCUMENT, ["other"])).toThrow("expected an array");
  });
});
