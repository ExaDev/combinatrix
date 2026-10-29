/** Any JSON value. The editor's model is held as one, so a part the form cannot show is kept exactly as it was read. */
export type Json = null | boolean | number | string | readonly Json[] | JsonObject;

/** A JSON object. */
export interface JsonObject {
  readonly [key: string]: Json;
}

/** A step into a JSON value: a key of an object or a position in an array. */
export type JsonStep = string | number;

export function isJsonArray(value: Json): value is readonly Json[] {
  return Array.isArray(value);
}

export function isJsonObject(value: Json): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a value read from anywhere is JSON: what `JSON.parse` returns, which TypeScript types as `any`. */
export function isJson(value: unknown): value is Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (Array.isArray(value)) return value.every((item: unknown) => isJson(item));

  return Object.keys(value).every((key) => isJson(Reflect.get(value, key)));
}

/** The JSON a text holds. Throws `SyntaxError` for text that is not JSON. */
export function parseJson(text: string): Json {
  const value: unknown = JSON.parse(text);
  if (!isJson(value)) throw new SyntaxError("the text parsed to something that is not JSON");

  return value;
}

/** The value at a path, or `undefined` when the path leaves the value. */
export function getIn(root: Json, path: readonly JsonStep[]): Json | undefined {
  let current: Json | undefined = root;
  for (const step of path) {
    if (current === undefined) return undefined;
    if (typeof step === "number") current = isJsonArray(current) ? current[step] : undefined;
    else current = isJsonObject(current) && Object.hasOwn(current, step) ? current[step] : undefined;
  }

  return current;
}

/** The object without a key. */
export function omit(object: JsonObject, key: string): JsonObject {
  return Object.fromEntries(Object.entries(object).filter(([existing]) => existing !== key));
}

/**
 * The value with the one at `path` replaced by `change` of it, everything else shared. Throws when the path leaves the value, since every caller derives its path from the value it edits, so a path that does not lead anywhere is a defect in the caller.
 */
export function updateIn(root: Json, path: readonly JsonStep[], change: (current: Json) => Json): Json {
  const [step, ...rest] = path;
  if (step === undefined) return change(root);

  if (typeof step === "number") {
    if (!isJsonArray(root) || step < 0 || step >= root.length) throw new Error(`the path leaves the value: no position ${String(step)}`);
    const item = root[step];
    if (item === undefined) throw new Error(`unreachable: position ${String(step)} is within the array`);

    return root.with(step, updateIn(item, rest, change));
  }

  if (!isJsonObject(root) || !Object.hasOwn(root, step)) throw new Error(`the path leaves the value: no key ${step}`);
  const child = root[step];
  if (child === undefined) throw new Error(`unreachable: key ${step} is an own key of the object`);

  return { ...root, [step]: updateIn(child, rest, change) };
}

/** The value with the one at `path` replaced. */
export function setIn(root: Json, path: readonly JsonStep[], replacement: Json): Json {
  return updateIn(root, path, () => replacement);
}

/** The object at a path, which the caller knows to be one. Throws otherwise. */
export function objectAt(root: Json, path: readonly JsonStep[]): JsonObject {
  const found = getIn(root, path);
  if (found === undefined || !isJsonObject(found)) throw new Error(`expected an object at ${path.join(".")}`);

  return found;
}

/** The array at a path, which the caller knows to be one. Throws otherwise. */
export function arrayAt(root: Json, path: readonly JsonStep[]): readonly Json[] {
  const found = getIn(root, path);
  if (found === undefined || !isJsonArray(found)) throw new Error(`expected an array at ${path.join(".")}`);

  return found;
}

/** The array at `path` with an item inserted at `index`, which may be the length. */
export function insertAt(root: Json, path: readonly JsonStep[], index: number, item: Json): Json {
  return updateIn(root, path, (current) => {
    if (!isJsonArray(current)) throw new Error(`expected an array at ${path.join(".")}`);

    return current.toSpliced(index, 0, item);
  });
}

/** The array at `path` without the item at `index`. */
export function removeAt(root: Json, path: readonly JsonStep[], index: number): Json {
  return updateIn(root, path, (current) => {
    if (!isJsonArray(current)) throw new Error(`expected an array at ${path.join(".")}`);
    if (index < 0 || index >= current.length) throw new Error(`no position ${String(index)} to remove`);

    return current.toSpliced(index, 1);
  });
}

/** Which way to move an item. */
export type Direction = "earlier" | "later";

/** The array at `path` with the item at `index` swapped with its neighbour; unchanged at the end it is moving towards. */
export function moveAt(root: Json, path: readonly JsonStep[], index: number, direction: Direction): Json {
  return updateIn(root, path, (current) => {
    if (!isJsonArray(current)) throw new Error(`expected an array at ${path.join(".")}`);
    const target = direction === "earlier" ? index - 1 : index + 1;
    if (index < 0 || index >= current.length) throw new Error(`no position ${String(index)} to move`);
    if (target < 0 || target >= current.length) return current;

    const item = current[index];
    const neighbour = current[target];
    if (item === undefined || neighbour === undefined) throw new Error("unreachable: both positions are within the array");

    return current.with(index, neighbour).with(target, item);
  });
}

/** The keys of the object at `path`, in order. */
export function keysAt(root: Json, path: readonly JsonStep[]): string[] {
  return Object.keys(objectAt(root, path));
}

/** The object at `path` with an entry added at the end. Throws when the key is already there, which the caller checks first so it can say so. */
export function addEntry(root: Json, path: readonly JsonStep[], key: string, value: Json): Json {
  return updateIn(root, path, (current) => {
    if (!isJsonObject(current)) throw new Error(`expected an object at ${path.join(".")}`);
    if (Object.hasOwn(current, key)) throw new Error(`the object already has the key ${key}`);

    return { ...current, [key]: value };
  });
}

/** The object at `path` without an entry. */
export function removeEntry(root: Json, path: readonly JsonStep[], key: string): Json {
  return updateIn(root, path, (current) => {
    if (!isJsonObject(current)) throw new Error(`expected an object at ${path.join(".")}`);
    if (!Object.hasOwn(current, key)) throw new Error(`the object has no key ${key}`);

    return omit(current, key);
  });
}

/** The object at `path` with one key renamed in place, so the order of its entries is kept. Throws when the new key is another entry's. */
export function renameEntry(root: Json, path: readonly JsonStep[], from: string, to: string): Json {
  return updateIn(root, path, (current) => {
    if (!isJsonObject(current)) throw new Error(`expected an object at ${path.join(".")}`);
    if (!Object.hasOwn(current, from)) throw new Error(`the object has no key ${from}`);
    if (from !== to && Object.hasOwn(current, to)) throw new Error(`the object already has the key ${to}`);

    return Object.fromEntries(Object.entries(current).map(([key, value]) => [key === from ? to : key, value]));
  });
}

/** The object at `path` with an entry swapped with its neighbour; unchanged at the end it is moving towards. Keys that read as array indices are ordered by the language, whatever is done here. */
export function moveEntry(root: Json, path: readonly JsonStep[], key: string, direction: Direction): Json {
  return updateIn(root, path, (current) => {
    if (!isJsonObject(current)) throw new Error(`expected an object at ${path.join(".")}`);
    const entries = Object.entries(current);
    const index = entries.findIndex(([existing]) => existing === key);
    if (index < 0) throw new Error(`the object has no key ${key}`);
    const target = direction === "earlier" ? index - 1 : index + 1;
    if (target < 0 || target >= entries.length) return current;

    const moved = entries[index];
    const neighbour = entries[target];
    if (moved === undefined || neighbour === undefined) throw new Error("unreachable: both positions are within the entries");

    return Object.fromEntries(entries.with(index, neighbour).with(target, moved));
  });
}

/** The kinds of JSON value, as a form offers them. */
export type JsonType = "text" | "number" | "boolean" | "null" | "list" | "object";

export function jsonTypeOf(value: Json): JsonType {
  if (value === null) return "null";
  if (typeof value === "string") return "text";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";

  return isJsonArray(value) ? "list" : "object";
}
