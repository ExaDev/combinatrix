import { describe, expect, it } from "vitest";

import type { StorageLike } from "./saved";
import { SavedModels } from "./saved";

/** Storage held in a map, as a browser's is held in the profile. */
function memoryStorage(initial?: string): StorageLike & { contents: Map<string, string> } {
  const contents = new Map<string, string>(initial === undefined ? [] : [["combinatrix.models", initial]]);

  return { contents, getItem: (key) => contents.get(key) ?? null, setItem: (key, value) => void contents.set(key, value) };
}

/** Saved models over one storage that lasts as long as they do, as the browser's does. */
function savedModels(initial?: string): SavedModels {
  const storage = memoryStorage(initial);

  return new SavedModels(() => storage);
}

const refusing = (): never => {
  throw new DOMException("storage is blocked", "SecurityError");
};

describe("SavedModels with working storage", () => {
  it("lists nothing before anything is saved", () => {
    expect(savedModels().list()).toEqual([]);
  });

  it("saves models and lists them by name", () => {
    const storage = memoryStorage();
    const saved = new SavedModels(() => storage);

    expect(saved.save("zeta", "{1}")).toBe(true);
    expect(saved.save("alpha", "{2}")).toBe(true);

    expect(saved.list()).toEqual([
      { name: "alpha", model: "{2}" },
      { name: "zeta", model: "{1}" },
    ]);
  });

  it("replaces the model saved under a name", () => {
    const saved = savedModels();
    saved.save("model", "first");

    saved.save("model", "second");

    expect(saved.list()).toEqual([{ name: "model", model: "second" }]);
  });

  it("removes a model", () => {
    const saved = savedModels();
    saved.save("keep", "a");
    saved.save("drop", "b");

    expect(saved.remove("drop")).toBe(true);

    expect(saved.list()).toEqual([{ name: "keep", model: "a" }]);
  });

  it("keeps models across instances over the same storage", () => {
    const storage = memoryStorage();
    new SavedModels(() => storage).save("model", "text");

    expect(new SavedModels(() => storage).list()).toEqual([{ name: "model", model: "text" }]);
  });

  it("keeps a name that looks like a prototype key as an ordinary name", () => {
    const saved = savedModels();

    saved.save("__proto__", "text");

    expect(saved.list()).toEqual([{ name: "__proto__", model: "text" }]);
  });

  it("reads contents it did not write as no models, and writes over them", () => {
    for (const contents of ["not json", "[1,2]", "null", '"text"']) {
      const saved = savedModels(contents);

      expect(saved.list()).toEqual([]);
      expect(saved.save("model", "text")).toBe(true);
      expect(saved.list()).toEqual([{ name: "model", model: "text" }]);
    }
  });

  it("ignores entries that are not text", () => {
    const saved = savedModels(JSON.stringify({ good: "text", bad: 3 }));

    expect(saved.list()).toEqual([{ name: "good", model: "text" }]);
  });
});

describe("SavedModels with unavailable storage", () => {
  it("lists nothing and refuses to save or remove when the storage accessor throws", () => {
    const saved = new SavedModels(refusing);

    expect(saved.list()).toEqual([]);
    expect(saved.save("model", "text")).toBe(false);
    expect(saved.remove("model")).toBe(false);
  });

  it("lists nothing when reading throws", () => {
    const saved = new SavedModels(() => ({ getItem: refusing, setItem: refusing }));

    expect(saved.list()).toEqual([]);
  });

  it("refuses to save when writing throws, as a full quota does, and still lists what was saved", () => {
    const storage = memoryStorage();
    new SavedModels(() => storage).save("kept", "text");
    const full = new SavedModels(() => ({ getItem: storage.getItem, setItem: refusing }));

    expect(full.save("new", "text")).toBe(false);
    expect(full.list()).toEqual([{ name: "kept", model: "text" }]);
  });
});
