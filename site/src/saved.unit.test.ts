import { describe, expect, it } from "vitest";

import type { SavedModel, StorageLike } from "./saved";
import { SavedModels } from "./saved";

/** Storage held in a map, as a browser's is held in the profile. */
function memoryStorage(initial: Readonly<Record<string, string>> = {}): StorageLike & { contents: Map<string, string> } {
  const contents = new Map<string, string>(Object.entries(initial));

  return { contents, getItem: (key) => contents.get(key) ?? null, setItem: (key, value) => void contents.set(key, value), removeItem: (key) => void contents.delete(key) };
}

/** Ids `id-1`, `id-2` and so on, in the order they are asked for. */
function counter(): () => string {
  let next = 0;

  return () => {
    next += 1;

    return `id-${String(next)}`;
  };
}

/** Saved models over one storage that lasts as long as they do, as the browser's does. */
function savedModels(initial?: Readonly<Record<string, string>>): SavedModels {
  const storage = memoryStorage(initial);

  return new SavedModels(() => storage, counter());
}

const first: SavedModel = { id: "a", name: "zeta", model: "{1}" };
const second: SavedModel = { id: "b", name: "alpha", model: "{2}" };

const refusing = (): never => {
  throw new DOMException("storage is blocked", "SecurityError");
};

describe("SavedModels with working storage", () => {
  it("lists nothing before anything is saved", () => {
    expect(savedModels().list()).toEqual([]);
  });

  it("saves models and lists them by name", () => {
    const saved = savedModels();

    expect(saved.save(first)).toBe(true);
    expect(saved.save(second)).toBe(true);

    expect(saved.list()).toEqual([second, first]);
  });

  it("finds a model by its id", () => {
    const saved = savedModels();
    saved.save(first);

    expect(saved.find("a")).toEqual(first);
    expect(saved.find("missing")).toBeUndefined();
  });

  it("replaces the model saved with an id, whatever its name, and keeps models of the same name that have other ids", () => {
    const saved = savedModels();
    saved.save(first);
    saved.save({ id: "c", name: "zeta", model: "{3}" });

    saved.save({ id: "a", name: "renamed", model: "{4}" });

    expect(saved.list()).toEqual([
      { id: "c", name: "zeta", model: "{3}" },
      { id: "a", name: "renamed", model: "{4}" },
    ].sort((left, right) => left.name.localeCompare(right.name)));
  });

  it("removes a model by its id", () => {
    const saved = savedModels();
    saved.save(first);
    saved.save(second);

    expect(saved.remove("a")).toBe(true);

    expect(saved.list()).toEqual([second]);
  });

  it("keeps models across instances over the same storage", () => {
    const storage = memoryStorage();
    new SavedModels(() => storage, counter()).save(first);

    expect(new SavedModels(() => storage, counter()).list()).toEqual([first]);
  });

  it("keeps an id that looks like a prototype key as an ordinary id", () => {
    const saved = savedModels();

    saved.save({ id: "__proto__", name: "proto", model: "text" });

    expect(saved.list()).toEqual([{ id: "__proto__", name: "proto", model: "text" }]);
  });

  it("reads contents it did not write as no models, and writes over them", () => {
    for (const contents of ["not json", "[1,2]", "null", '"text"']) {
      const saved = savedModels({ "combinatrix.saved": contents });

      expect(saved.list()).toEqual([]);
      expect(saved.save(first)).toBe(true);
      expect(saved.list()).toEqual([first]);
    }
  });

  it("ignores entries that have no name and model in text", () => {
    const saved = savedModels({ "combinatrix.saved": JSON.stringify({ good: { name: "n", model: "m" }, bad: 3, noName: { model: "m" }, wrong: { name: 1, model: "m" } }) });

    expect(saved.list()).toEqual([{ id: "good", name: "n", model: "m" }]);
  });
});

describe("SavedModels.migrate", () => {
  const legacy = JSON.stringify({ builds: JSON.stringify({ dimensions: [] }), notes: "not a model", numbered: 3, owned: JSON.stringify({ id: "kept", dimensions: [] }) });

  it("gives each model saved by name an id, written into its text, and keeps its name", () => {
    const storage = memoryStorage({ "combinatrix.models": legacy });
    const saved = new SavedModels(() => storage, counter());

    expect(saved.migrate()).toBe(true);

    const byName = Object.fromEntries(saved.list().map((entry) => [entry.name, entry]));
    expect(Object.keys(byName).sort()).toEqual(["builds", "notes", "owned"]);
    expect(JSON.parse(byName["builds"]?.model ?? "")).toEqual({ id: expect.stringMatching(/^id-\d+$/) as unknown, dimensions: [] });
    expect(byName["notes"]?.model).toBe("not a model");
    expect(JSON.parse(byName["owned"]?.model ?? "")).toEqual({ id: "kept", dimensions: [] });
  });

  it("removes the old entry once the new ones are stored, so a second run changes nothing", () => {
    const storage = memoryStorage({ "combinatrix.models": legacy });
    const saved = new SavedModels(() => storage, counter());
    saved.migrate();
    const migrated = saved.list();

    expect(storage.contents.has("combinatrix.models")).toBe(false);
    expect(saved.migrate()).toBe(true);
    expect(saved.list()).toEqual(migrated);
  });

  it("keeps the models already saved with ids beside the migrated ones", () => {
    const storage = memoryStorage({ "combinatrix.models": JSON.stringify({ old: "text" }), "combinatrix.saved": JSON.stringify({ a: { name: "new", model: "m" } }) });
    const saved = new SavedModels(() => storage, counter());

    saved.migrate();

    expect(saved.list().map((entry) => entry.name)).toEqual(["new", "old"]);
  });

  it("does nothing when nothing was saved by name", () => {
    expect(savedModels().migrate()).toBe(true);
  });

  it("keeps the old entry when the new ones cannot be stored", () => {
    const storage = memoryStorage({ "combinatrix.models": legacy });
    const full = new SavedModels(() => ({ getItem: storage.getItem, removeItem: storage.removeItem, setItem: refusing }), counter());

    expect(full.migrate()).toBe(false);
    expect(storage.contents.get("combinatrix.models")).toBe(legacy);
  });
});

describe("SavedModels with unavailable storage", () => {
  it("lists nothing and refuses to save or remove when the storage accessor throws", () => {
    const saved = new SavedModels(refusing, counter());

    expect(saved.list()).toEqual([]);
    expect(saved.save(first)).toBe(false);
    expect(saved.remove("a")).toBe(false);
    expect(saved.migrate()).toBe(false);
  });

  it("lists nothing when reading throws", () => {
    const saved = new SavedModels(() => ({ getItem: refusing, setItem: refusing, removeItem: refusing }), counter());

    expect(saved.list()).toEqual([]);
  });

  it("refuses to save when writing throws, as a full quota does, and still lists what was saved", () => {
    const storage = memoryStorage();
    new SavedModels(() => storage, counter()).save(first);
    const full = new SavedModels(() => ({ getItem: storage.getItem, setItem: refusing, removeItem: storage.removeItem }), counter());

    expect(full.save(second)).toBe(false);
    expect(full.list()).toEqual([first]);
  });
});
