import { idOf, modelOfText } from "./identity";
import type { Json, JsonObject } from "./json";
import { isJsonArray, isJsonObject, omit, sameJson } from "./json";

/**
 * A model arriving (from a link, a gist, a file or the saved list) that has the id of a model already here and different content. An id says two copies are the same model, never which is newer or what they both started from, so nothing here decides between them: it describes how they differ and leaves the choice to the person.
 */
export interface Clash {
  /** The copy already here: the one in the editor when it has the id, otherwise the saved one. */
  readonly mine: string;
  readonly source: "editor" | "saved";
  /** How the copies differ, one line for each difference, in terms of "mine" and "theirs". */
  readonly changes: readonly string[];
}

/** Whether two models have the same content. The `$schema` a file names is not content: two copies written against different versions of the schema are the same model. */
function sameContent(left: JsonObject, right: JsonObject): boolean {
  return sameJson(omit(left, "$schema"), omit(right, "$schema"));
}

/** The copy already here of the model with an id: the editor's when it has the id, otherwise the saved one. */
function copyHere(id: string, editor: string, findSaved: (id: string) => string | undefined): { readonly source: Clash["source"]; readonly text: string; readonly model: JsonObject } | undefined {
  const inEditor = modelOfText(editor);
  if (inEditor !== undefined && idOf(inEditor) === id) return { source: "editor", text: editor, model: inEditor };

  const text = findSaved(id);
  const model = text === undefined ? undefined : modelOfText(text);

  return text === undefined || model === undefined ? undefined : { source: "saved", text, model };
}

/**
 * The clash between an incoming model and the copy already here with its id, or `undefined` when there is none: the incoming model has no id, no copy has it, or the copy has the same content. The editor's copy is the one compared when it has the id, since it is what loading the incoming model would replace; otherwise the saved copy is.
 */
export function meet(incoming: string, editor: string, findSaved: (id: string) => string | undefined): Clash | undefined {
  const theirs = modelOfText(incoming);
  const id = idOf(theirs);
  if (theirs === undefined || id === undefined) return undefined;

  const here = copyHere(id, editor, findSaved);
  if (here === undefined || sameContent(here.model, theirs)) return undefined;

  return { mine: here.text, source: here.source, changes: changesBetween(here.model, theirs) };
}

/** `1 rule`, `2 rules`. */
function counted(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/** The entries of a list that carry a string `key`, by that key's value; the others are returned apart, in order. */
function byName(items: readonly Json[]): { readonly named: ReadonlyMap<string, JsonObject>; readonly unnamed: readonly Json[] } {
  const named = new Map<string, JsonObject>();
  const unnamed: Json[] = [];
  for (const item of items) {
    const name = isJsonObject(item) ? item["name"] : undefined;
    if (isJsonObject(item) && typeof name === "string" && !named.has(name)) named.set(name, item);
    else unnamed.push(item);
  }

  return { named, unnamed };
}

/** The keys under which two objects differ, in the order they first appear. */
function differingKeys(left: JsonObject, right: JsonObject): string[] {
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].filter((key) => !sameJson(left[key], right[key]));
}

/** Describes a value for a line about it: text as itself in quotes, anything else not at all. */
function quoted(value: Json | undefined): string | undefined {
  return typeof value === "string" ? JSON.stringify(value) : undefined;
}

/** The lines for a top-level key other than the lists, which differs between the copies. */
function detailChange(key: string, mine: JsonObject, theirs: JsonObject): string {
  if (!Object.hasOwn(mine, key)) return `${key} is only in theirs`;
  if (!Object.hasOwn(theirs, key)) return `${key} is only in mine`;
  const [left, right] = [quoted(mine[key]), quoted(theirs[key])];

  return left === undefined || right === undefined ? `${key} differs` : `${key} is ${left} in mine and ${right} in theirs`;
}

/** Lines for the items of one list that are named, then for the ones that are not. `noun` is `dimension` or `rule`. */
function listChanges(noun: string, mine: readonly Json[], theirs: readonly Json[]): string[] {
  const [left, right] = [byName(mine), byName(theirs)];
  const lines: string[] = [];
  for (const [name, item] of left.named) {
    const other = right.named.get(name);
    if (other === undefined) lines.push(`${noun} ${JSON.stringify(name)} is only in mine`);
    else if (!sameJson(item, other)) lines.push(`${noun} ${JSON.stringify(name)} differs in ${differingKeys(item, other).join(", ")}`);
  }
  for (const name of right.named.keys()) if (!left.named.has(name)) lines.push(`${noun} ${JSON.stringify(name)} is only in theirs`);

  const remaining = [...right.unnamed];
  const onlyMine = left.unnamed.filter((item) => {
    const match = remaining.findIndex((other) => sameJson(item, other));
    if (match < 0) return true;
    remaining.splice(match, 1);

    return false;
  });
  if (onlyMine.length > 0) lines.push(`${counted(onlyMine.length, `unnamed ${noun}`)} only in mine`);
  if (remaining.length > 0) lines.push(`${counted(remaining.length, `unnamed ${noun}`)} only in theirs`);

  return lines;
}

/** The names of the named items of a list, in order. */
function namesOf(items: readonly Json[]): string[] {
  return [...byName(items).named.keys()];
}

/** The list a model holds under a key, empty when it holds none. */
function listOf(model: JsonObject, key: string): readonly Json[] {
  const value = model[key];

  return value !== undefined && isJsonArray(value) ? value : [];
}

/** A line when the named items two lists share are in another order in one than in the other. */
function orderChange(noun: string, mine: readonly Json[], theirs: readonly Json[]): string[] {
  const [left, right] = [namesOf(mine), namesOf(theirs)];
  const [leftShared, rightShared] = [left.filter((name) => right.includes(name)), right.filter((name) => left.includes(name))];

  return leftShared.join("\u0000") === rightShared.join("\u0000") ? [] : [`the ${noun}s are in a different order`];
}

/**
 * How two copies of a model differ, one line for each difference: the details and any other key, then the dimensions and the rules, matched by name. A dimension is matched by its name and a rule by its label, so a change to one reads as that dimension or rule differing and not as one removed and another added; items without a name are matched by content. Always at least one line for copies whose content differs.
 */
export function changesBetween(mine: JsonObject, theirs: JsonObject): string[] {
  const keys = [...new Set([...Object.keys(mine), ...Object.keys(theirs)])].filter((key) => key !== "$schema" && key !== "dimensions" && key !== "rules");
  const details = keys.filter((key) => !sameJson(mine[key], theirs[key])).map((key) => detailChange(key, mine, theirs));
  const [leftDimensions, rightDimensions] = [listOf(mine, "dimensions"), listOf(theirs, "dimensions")];
  const [leftRules, rightRules] = [listOf(mine, "rules"), listOf(theirs, "rules")];
  const lines = [...details, ...listChanges("dimension", leftDimensions, rightDimensions), ...orderChange("dimension", leftDimensions, rightDimensions), ...listChanges("rule", leftRules, rightRules), ...orderChange("rule", leftRules, rightRules)];

  return !sameContent(mine, theirs) && lines.length === 0 ? ["the items are in a different order"] : lines;
}
