import type { Json, JsonStep } from "./json";

/**
 * What the editor remembers of the items whose type, kind or form the user has switched, so that switching back gives the item back as it was. It is state of the page, held for as long as the loaded model is, and never written into the model or its JSON.
 *
 * A part of the model is remembered at its place, the path of the item it belongs to, under the name of the variant it was in: `text`, `expression:numberLiteral`, `form:implies`. When the item is switched from one variant to another, the part it held is remembered under the variant it leaves, together with what was remembered of the items inside it. The part it takes up is then the one remembered under the variant it enters, if it was ever in that one, and otherwise a conversion of the part it leaves.
 *
 * The rule, in one line: switching an item to a variant gives it what it last held in that variant. So a switch and its switch back restore the item exactly, and so does any longer round trip with no edit in between. An edit made while the item is in the other variant is an edit of that variant: it is kept there, and is what a later switch to that variant gives, but switching back to the first variant still gives what was last held in it. Nothing the user had in a variant is lost by a switch.
 *
 * A memory is a value: every function returns a new one and leaves the one it was given as it was.
 */

/** Where in the model an item is: the path from the model to it. */
export type Place = readonly JsonStep[];

/** What an item held in one variant, and what was remembered of the items inside it then. */
interface Held {
  readonly part: Json;
  readonly inside: Memory;
}

/** The variants an item has been switched out of, by name. */
interface Remembered {
  readonly place: Place;
  readonly held: ReadonlyMap<string, Held>;
}

/** The remembered parts of a model, by place. */
export type Memory = ReadonlyMap<string, Remembered>;

export const NO_MEMORY: Memory = new Map();

/** A place as a key: a step that is a number and one that is text of the same digits are different steps. */
function keyOf(place: Place): string {
  return JSON.stringify(place);
}

/** Whether `place` is `ancestor` or something inside it. */
function isWithin(place: Place, ancestor: Place): boolean {
  return place.length >= ancestor.length && ancestor.every((step, position) => place[position] === step);
}

/** Whether `place` is something inside `ancestor`, and not `ancestor` itself. */
function isInside(place: Place, ancestor: Place): boolean {
  return place.length > ancestor.length && isWithin(place, ancestor);
}

/** An item switched from one variant to another. */
export interface Switch {
  readonly place: Place;
  /** The variant the item is in, and the one it is switched to. Both are names from one vocabulary of variants of the item, so the same name never means two things at one place. */
  readonly from: string;
  readonly to: string;
  /** The part of the model that varies with the variant, as it is now. */
  readonly current: Json;
  /** The part in the variant switched to, for an item that has not been in it: the conversion of the current part, or the variant's default. Called only then. */
  readonly convert: () => Json;
  /** Whether the memory of the items inside the part goes with it, to come back when it does. It does not when a switch changes the paths of the items inside, as a change of the key a rule states itself under does. */
  readonly inside: "kept" | "dropped";
}

/** The part the item takes up, and the memory after the switch. */
export interface Switched {
  readonly part: Json;
  readonly memory: Memory;
}

/** Switches an item from one variant to another, remembering the part it leaves and taking up the one it enters. */
export function switchVariant(memory: Memory, spec: Switch): Switched {
  const { place, from, to } = spec;
  if (from === to) return { part: spec.current, memory };

  const outside = new Map<string, Remembered>();
  const inside = new Map<string, Remembered>();
  for (const [key, entry] of memory) (isInside(entry.place, place) ? inside : outside).set(key, entry);

  const here = outside.get(keyOf(place));
  const target = here?.held.get(to);
  const held = new Map(here?.held);
  held.delete(to);
  held.set(from, { part: spec.current, inside: spec.inside === "kept" ? inside : NO_MEMORY });
  outside.set(keyOf(place), { place, held });
  if (target === undefined) return { part: spec.convert(), memory: outside };

  for (const [key, entry] of target.inside) outside.set(key, entry);

  return { part: target.part, memory: outside };
}

/** The memory without what it holds for the item at `place` and everything inside it: for an edit that removed the item. */
export function forgetWithin(memory: Memory, place: Place): Memory {
  return new Map([...memory].filter(([, entry]) => !isWithin(entry.place, place)));
}

/** The memory without what it holds for the items inside the item at `place`, but with what it holds for the item itself: for an edit that moved, removed or renamed the items inside, so the paths they were remembered at no longer name the same items. */
export function forgetInside(memory: Memory, place: Place): Memory {
  return new Map([...memory].filter(([, entry]) => !isInside(entry.place, place)));
}
