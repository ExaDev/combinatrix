import type { Json, JsonStep } from "./json";
import { getIn, putIn, sameJson } from "./json";

/**
 * What the editor remembers of the items whose type, kind or form the user has switched, so that switching back gives the item back as it was. It is state of the page, held for as long as the loaded model is, and never written into the model or its JSON.
 *
 * An item is the part of the model at a place (its path), and a vocabulary names the variants it can be switched between (the types of a value, the kinds of a predicate). When an item is switched from one variant to another, the part it held is remembered under the variant it leaves. The part it takes up is the one remembered under the variant it enters, if it was ever in that one, and otherwise a conversion of the part it leaves.
 *
 * The rule for what a switch gives has two halves. The first is for the item's own value: a scalar, a key, a kind's other fields (an operator, a function name). Switching to a variant gives the item what it last held in that variant, so a switch and its switch back restore it exactly, and what the user typed while it was in another variant stays in that variant. The second is for the children a variant has places for (the operands of `both`, the left side of arithmetic, a rule's condition). Children are shared by position between the variants that hold them, since that is how a switch carries them across: the first operand of `all of` is the left side of `both` and the operand of `not`. A child that the user edited while the item was in some variant is the child of every variant that has a place for it, so switching back gives the remembered part with those children replaced by the edited ones: an edit is never lost to a switch. A child that was only carried across or created as a default (it is as the switch produced it) is not an edit, and does not displace what is remembered, so the third operand of `all of` survives a trip through `not`, which has room for one.
 *
 * What is remembered of the items inside a child moves with the child: when an edited child replaces one in a remembered part, what was remembered of its items comes with it, at its new place.
 *
 * A memory is a value: every function returns a new one and leaves the one it was given as it was.
 */

/** Where in the model an item is: the path from the model to it. */
export type Place = readonly JsonStep[];

/** The places of the children a part of a variant holds, relative to the part: for each role the part has (a predicate has predicates and expressions), the places of its children in order. A role lists the same position for the same child in every variant of the vocabulary. A place may lead to nothing when the child is optional and absent. */
export type Slots = readonly (readonly Place[])[];

/** The slots of a vocabulary whose variants have no children that a switch carries across, such as the types of a value: what the item was is what comes back. */
export function noSlots(): Slots {
  return [];
}

/** What an item held in one variant, and what was remembered of the items inside it then. */
interface Held {
  readonly part: Json;
  readonly inside: Memory;
}

/** The variants an item has been switched out of, by name, and the part it was given when it was last switched into the variant it is in. */
interface Remembered {
  readonly place: Place;
  readonly vocabulary: string;
  readonly held: ReadonlyMap<string, Held>;
  readonly produced: Json;
}

/** The remembered parts of a model, by vocabulary and place. */
export type Memory = ReadonlyMap<string, Remembered>;

export const NO_MEMORY: Memory = new Map();

/** A vocabulary and a place as a key: a step that is a number and one that is text of the same digits are different steps. */
function keyOf(vocabulary: string, place: Place): string {
  return JSON.stringify([vocabulary, place]);
}

/** Whether `place` is `ancestor` or something inside it. */
function isWithin(place: Place, ancestor: Place): boolean {
  return place.length >= ancestor.length && ancestor.every((step, position) => place[position] === step);
}

/** Whether `place` is something inside `ancestor`, and not `ancestor` itself. */
function isInside(place: Place, ancestor: Place): boolean {
  return place.length > ancestor.length && isWithin(place, ancestor);
}

/** A remembered item moved from within `from` to the same position within `to`, with everything it remembers. */
function relocated(entry: Remembered, from: Place, to: Place): Remembered {
  const held = new Map([...entry.held].map(([variant, item]): [string, Held] => [variant, { part: item.part, inside: relocate(item.inside, from, to) }]));

  return { ...entry, place: [...to, ...entry.place.slice(from.length)], held };
}

/** The memory of what is within `from`, moved to be within `to`. */
function relocate(memory: Memory, from: Place, to: Place): Memory {
  const moved = [...memory.values()].filter((entry) => isWithin(entry.place, from)).map((entry) => relocated(entry, from, to));

  return new Map(moved.map((entry): [string, Remembered] => [keyOf(entry.vocabulary, entry.place), entry]));
}

/** The memory without what it holds within `place`. */
function without(memory: Memory, place: Place): Memory {
  return new Map([...memory].filter(([, entry]) => !isWithin(entry.place, place)));
}

/** An item switched from one variant to another. */
export interface Switch {
  readonly place: Place;
  /** The names the item's variants are from: a kind of predicate and a kind of expression of the same name are not the same variant. */
  readonly vocabulary: string;
  /** The variant the item is in, and the one it is switched to. */
  readonly from: string;
  readonly to: string;
  /** The part of the model that varies with the variant, as it is now. */
  readonly current: Json;
  /** The part in the variant switched to, for an item that has not been in it: the conversion of the current part, or the variant's default. Called only then. */
  readonly convert: () => Json;
  /** Where the children of a part of the vocabulary are. */
  readonly slots: (part: Json) => Slots;
  /** Whether what is remembered of the items inside the part goes with it, to come back when it does. It does not when a switch changes the paths of the items inside, as a change of the key a rule states itself under does. */
  readonly inside: "kept" | "dropped";
}

/** The part the item takes up, and the memory after the switch. */
export interface Switched {
  readonly part: Json;
  readonly memory: Memory;
}

/** A remembered part with the children the user edited in the part now (those that are not as the switch into it produced them) put in their places, and what was remembered of the items inside each brought along. `live` is what is remembered of the items inside the part now, or `undefined` when none of it is kept. */
function withEditsOf(held: Held, spec: Switch, produced: Json, live: Memory | undefined): Held {
  const mine = spec.slots(spec.current);
  const before = spec.slots(produced);
  const theirs = spec.slots(held.part);
  let { part, inside } = held;
  for (const [role, places] of mine.entries()) {
    for (const [position, place] of places.entries()) {
      const target = theirs[role]?.[position];
      if (target === undefined) continue;
      const child = getIn(spec.current, place);
      const was = before[role]?.[position];
      if (was !== undefined && sameJson(child, getIn(produced, was))) continue;

      part = putIn(part, target, child);
      if (live === undefined) continue;
      const to = [...spec.place, ...target];
      inside = new Map([...without(inside, to), ...relocate(live, [...spec.place, ...place], to)]);
    }
  }

  return { part, inside };
}

/** Switches an item from one variant to another, remembering the part it leaves and taking up the one it enters. */
export function switchVariant(memory: Memory, spec: Switch): Switched {
  const { place, vocabulary, from, to } = spec;
  if (from === to) return { part: spec.current, memory };

  const outside = new Map<string, Remembered>();
  const inside = new Map<string, Remembered>();
  for (const [key, entry] of memory) (isInside(entry.place, place) ? inside : outside).set(key, entry);

  const key = keyOf(vocabulary, place);
  const here = outside.get(key);
  const live = spec.inside === "kept" ? inside : undefined;
  const held = new Map<string, Held>();
  if (here !== undefined) for (const [variant, item] of here.held) held.set(variant, withEditsOf(item, spec, here.produced, live));

  const target = held.get(to);
  held.delete(to);
  held.set(from, { part: spec.current, inside: live ?? NO_MEMORY });
  const part = target === undefined ? spec.convert() : target.part;
  outside.set(key, { place, vocabulary, held, produced: part });
  if (target !== undefined) for (const [entryKey, entry] of target.inside) outside.set(entryKey, entry);

  return { part, memory: outside };
}

/** The memory without what it holds for the item at `place` and everything inside it: for an edit that removed the item. */
export function forgetWithin(memory: Memory, place: Place): Memory {
  return without(memory, place);
}

/** The memory without what it holds for the items inside the item at `place`, but with what it holds for the item itself: for an edit that moved, removed or renamed the items inside, so the paths they were remembered at no longer name the same items. */
export function forgetInside(memory: Memory, place: Place): Memory {
  return new Map([...memory].filter(([, entry]) => !isInside(entry.place, place)));
}
