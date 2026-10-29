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
