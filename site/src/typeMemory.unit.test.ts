import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import type { Json, JsonObject } from "./json";
import { isJsonArray, isJsonObject } from "./json";
import type { Memory, Place, Slots, Switch } from "./typeMemory";
import { forgetInside, forgetWithin, noSlots, NO_MEMORY, switchVariant } from "./typeMemory";

const PLACE: Place = ["rules", 0, "excludes", "right"];
const TEXT: Json = { kind: "textLiteral", value: " windows " };
const NUMBER: Json = { kind: "numberLiteral", value: 7, unit: { m: 1 } };
const DEFAULT_NUMBER: Json = { kind: "numberLiteral", value: 0 };
const DEFAULT_TEXT: Json = { kind: "textLiteral", value: "" };
const DEFAULT_BOOLEAN: Json = { kind: "booleanLiteral", value: true };
/** The index of the tenth rule, whose digits start with those of the index of the second. */
const TENTH_RULE = 10;
const SECOND_RULE = 1;

/** The switch of the item at a place from one variant to another, given the part now and the part a conversion makes. Without slots, as the types of a value have none. */
function moving(place: Place, from: string, to: string): (current: Json, converted: Json, inside?: Switch["inside"]) => Switch {
  return (current, converted, inside = "kept") => ({ place, vocabulary: "v", from, to, current, convert: () => converted, slots: noSlots, inside });
}

describe("switchVariant", () => {
  it("converts the part for a variant the item has not been in", () => {
    const switched = switchVariant(NO_MEMORY, moving(PLACE, "text", "number")(TEXT, DEFAULT_NUMBER));

    expect(switched.part).toBe(DEFAULT_NUMBER);
  });

  it("gives back exactly the part the item left when it is switched back, with no edit between", () => {
    const there = switchVariant(NO_MEMORY, moving(PLACE, "text", "number")(TEXT, DEFAULT_NUMBER));
    const back = switchVariant(there.memory, moving(PLACE, "number", "text")(there.part, DEFAULT_TEXT));

    expect(back.part).toBe(TEXT);
    expect(back.part).toEqual({ kind: "textLiteral", value: " windows " });
  });

  it("does not convert when it gives back what was remembered", () => {
    const there = switchVariant(NO_MEMORY, moving(PLACE, "text", "number")(TEXT, DEFAULT_NUMBER));
    const convert = vi.fn(() => DEFAULT_TEXT);
    switchVariant(there.memory, { ...moving(PLACE, "number", "text")(there.part, DEFAULT_TEXT), convert });

    expect(convert).not.toHaveBeenCalled();
  });

  it("gives back each variant the item left along a longer round trip", () => {
    const toNumber = switchVariant(NO_MEMORY, moving(PLACE, "text", "number")(TEXT, NUMBER));
    const toBoolean = switchVariant(toNumber.memory, moving(PLACE, "number", "boolean")(toNumber.part, DEFAULT_BOOLEAN));
    const toText = switchVariant(toBoolean.memory, moving(PLACE, "boolean", "text")(toBoolean.part, DEFAULT_TEXT));
    const toNumberAgain = switchVariant(toText.memory, moving(PLACE, "text", "number")(toText.part, DEFAULT_NUMBER));

    expect(toText.part).toBe(TEXT);
    expect(toNumberAgain.part).toBe(NUMBER);
  });

  it("gives back what was last held in a variant, not what it was first", () => {
    const toNumber = switchVariant(NO_MEMORY, moving(PLACE, "text", "number")(TEXT, DEFAULT_NUMBER));
    const typed: Json = { kind: "numberLiteral", value: 42 };
    const toText = switchVariant(toNumber.memory, moving(PLACE, "number", "text")(typed, DEFAULT_TEXT));
    const editedText: Json = { kind: "textLiteral", value: "macos" };
    const toNumberAgain = switchVariant(toText.memory, moving(PLACE, "text", "number")(editedText, DEFAULT_NUMBER));
    const toTextAgain = switchVariant(toNumberAgain.memory, moving(PLACE, "number", "text")(toNumberAgain.part, DEFAULT_TEXT));

    expect(toText.part).toBe(TEXT);
    expect(toNumberAgain.part).toBe(typed);
    expect(toTextAgain.part).toBe(editedText);
  });

  it("restores a part after an edit made in the variant switched to: the edit stays in that variant", () => {
    const toNumber = switchVariant(NO_MEMORY, moving(PLACE, "text", "number")(TEXT, DEFAULT_NUMBER));
    const edited: Json = { kind: "numberLiteral", value: 5 };
    const back = switchVariant(toNumber.memory, moving(PLACE, "number", "text")(edited, DEFAULT_TEXT));
    const forward = switchVariant(back.memory, moving(PLACE, "text", "number")(back.part, DEFAULT_NUMBER));

    expect(back.part).toBe(TEXT);
    expect(forward.part).toBe(edited);
  });

  it("keeps the places apart", () => {
    const other: Place = ["rules", 0, "excludes", "left"];
    const first = switchVariant(NO_MEMORY, moving(PLACE, "text", "number")(TEXT, DEFAULT_NUMBER));
    const second = switchVariant(first.memory, moving(other, "text", "number")(DEFAULT_TEXT, NUMBER));
    const backAtOther = switchVariant(second.memory, moving(other, "number", "text")(second.part, DEFAULT_BOOLEAN));
    const backAtFirst = switchVariant(second.memory, moving(PLACE, "number", "text")(first.part, DEFAULT_BOOLEAN));

    expect(backAtOther.part).toBe(DEFAULT_TEXT);
    expect(backAtFirst.part).toBe(TEXT);
  });

  it("keeps the vocabularies of one place apart", () => {
    const asKind = switchVariant(NO_MEMORY, { ...moving(PLACE, "text", "number")(TEXT, DEFAULT_NUMBER), vocabulary: "kind" });
    const asForm = switchVariant(asKind.memory, { ...moving(PLACE, "text", "number")(DEFAULT_TEXT, DEFAULT_BOOLEAN), vocabulary: "form" });
    const backAsKind = switchVariant(asForm.memory, { ...moving(PLACE, "number", "text")(asForm.part, DEFAULT_BOOLEAN), vocabulary: "kind" });

    expect(backAsKind.part).toBe(TEXT);
  });

  it("tells a step that is a number from one that is text of the same digits", () => {
    const asNumber = switchVariant(NO_MEMORY, moving(["a", 0], "text", "number")(TEXT, DEFAULT_NUMBER));
    const asText = switchVariant(asNumber.memory, moving(["a", "0"], "number", "text")(NUMBER, DEFAULT_BOOLEAN));

    expect(asText.part).toBe(DEFAULT_BOOLEAN);
  });

  it("changes nothing when the variant is the same", () => {
    const same = switchVariant(NO_MEMORY, moving(PLACE, "text", "text")(TEXT, DEFAULT_NUMBER));

    expect(same.part).toBe(TEXT);
    expect(same.memory).toBe(NO_MEMORY);
  });

  it("leaves the memory it was given as it was", () => {
    const first = switchVariant(NO_MEMORY, moving(PLACE, "text", "number")(TEXT, DEFAULT_NUMBER));
    const snapshot = structuredClone([...first.memory]);
    switchVariant(first.memory, moving(PLACE, "number", "text")(first.part, DEFAULT_TEXT));

    expect([...first.memory]).toEqual(snapshot);
    expect(NO_MEMORY.size).toBe(0);
  });
});

describe("what is remembered of the items inside", () => {
  const INSIDE: Place = [...PLACE, "left"];
  const OPERAND: Json = { kind: "textLiteral", value: "kept" };

  /** The item at PLACE is switched while the item inside it is remembered to have been text. */
  function withInsideRemembered(): Memory {
    return switchVariant(NO_MEMORY, moving(INSIDE, "text", "number")(OPERAND, DEFAULT_NUMBER)).memory;
  }

  it("goes with the part, and comes back when the part does", () => {
    const away = switchVariant(withInsideRemembered(), moving(PLACE, "arithmetic", "negate")(TEXT, NUMBER));
    const afterAway = switchVariant(away.memory, moving(INSIDE, "text", "number")(DEFAULT_TEXT, DEFAULT_BOOLEAN));
    const back = switchVariant(away.memory, moving(PLACE, "negate", "arithmetic")(away.part, NUMBER));
    const insideAgain = switchVariant(back.memory, moving(INSIDE, "number", "text")(DEFAULT_NUMBER, DEFAULT_BOOLEAN));

    expect(afterAway.part).toBe(DEFAULT_BOOLEAN);
    expect(back.part).toBe(TEXT);
    expect(insideAgain.part).toBe(OPERAND);
  });

  it("is not there for the new variant, whose items are not the ones that were remembered", () => {
    const away = switchVariant(withInsideRemembered(), moving(PLACE, "arithmetic", "negate")(TEXT, NUMBER));
    const insideNew = switchVariant(away.memory, moving(INSIDE, "number", "text")(DEFAULT_NUMBER, DEFAULT_BOOLEAN));

    expect(insideNew.part).toBe(DEFAULT_BOOLEAN);
  });

  it("is dropped when the switch changes the paths of the items inside", () => {
    const away = switchVariant(withInsideRemembered(), moving(PLACE, "arithmetic", "negate")(TEXT, NUMBER, "dropped"));
    const back = switchVariant(away.memory, moving(PLACE, "negate", "arithmetic")(away.part, NUMBER, "dropped"));
    const insideAgain = switchVariant(back.memory, moving(INSIDE, "number", "text")(DEFAULT_NUMBER, DEFAULT_BOOLEAN));

    expect(back.part).toBe(TEXT);
    expect(insideAgain.part).toBe(DEFAULT_BOOLEAN);
  });
});

/** Parts that hold their children in a list, `kids` or `items`, as the variants of a vocabulary whose kinds keep their operands in different keys do, with a name of the variant and a field of their own. */
function holder(variant: string, key: "kids" | "items", children: readonly Json[]): JsonObject {
  return { variant, own: `own of ${variant}`, [key]: children };
}

function childSlots(part: Json): Slots {
  if (!isJsonObject(part)) return [];
  const kids = part["kids"];
  const items = part["items"];
  if (kids !== undefined && isJsonArray(kids)) return [kids.map((_, position): Place => ["kids", position])];

  return [items !== undefined && isJsonArray(items) ? items.map((_, position): Place => ["items", position]) : []];
}

/** The switch of the item at ["n"] between variants that keep their children in lists. */
function between(from: string, to: string): (current: Json, converted: Json) => Switch {
  return (current, converted) => ({ place: ["n"], vocabulary: "children", from, to, current, convert: () => converted, slots: childSlots, inside: "kept" });
}

const X: Json = { kind: "textLiteral", value: "x" };
const Y: Json = { kind: "textLiteral", value: "y" };
const Z: Json = { kind: "textLiteral", value: "z" };
const EDITED: Json = { kind: "textLiteral", value: "edited" };
const FILLER: Json = { kind: "textLiteral", value: "" };

describe("the children of a part", () => {
  it("keep an edit made in another variant, and the rest of the remembered part comes from memory", () => {
    const away = switchVariant(NO_MEMORY, between("three", "two")(holder("three", "kids", [X, Y, Z]), holder("two", "kids", [X, Y])));
    const back = switchVariant(away.memory, between("two", "three")(holder("two", "kids", [EDITED, Y]), holder("three", "kids", [])));

    expect(back.part).toEqual(holder("three", "kids", [EDITED, Y, Z]));
  });

  it("do not displace what is remembered when they are only as the switch produced them", () => {
    const toOne = switchVariant(NO_MEMORY, between("three", "one")(holder("three", "kids", [X, Y, Z]), holder("one", "kids", [X])));
    const toTwo = switchVariant(toOne.memory, between("one", "two")(toOne.part, holder("two", "kids", [X, FILLER])));
    const back = switchVariant(toTwo.memory, between("two", "three")(toTwo.part, holder("three", "kids", [])));

    expect(back.part).toEqual(holder("three", "kids", [X, Y, Z]));
  });

  it("keep an edit made in a variant that was passed through, in a variant that has room for it", () => {
    const toOne = switchVariant(NO_MEMORY, between("three", "one")(holder("three", "kids", [X, Y, Z]), holder("one", "kids", [X])));
    const toTwo = switchVariant(toOne.memory, between("one", "two")(holder("one", "kids", [EDITED]), holder("two", "kids", [EDITED, FILLER])));
    const back = switchVariant(toTwo.memory, between("two", "three")(toTwo.part, holder("three", "kids", [])));

    expect(back.part).toEqual(holder("three", "kids", [EDITED, Y, Z]));
  });

  it("take an edit made in the variant a part was left for into every variant that was left behind", () => {
    const toTwo = switchVariant(NO_MEMORY, between("three", "two")(holder("three", "kids", [X, Y, Z]), holder("two", "kids", [X, Y])));
    const toOne = switchVariant(toTwo.memory, between("two", "one")(toTwo.part, holder("one", "kids", [X])));
    const editedOne = holder("one", "kids", [EDITED]);
    const toThree = switchVariant(toOne.memory, between("one", "three")(editedOne, holder("three", "kids", [])));
    const toTwoAgain = switchVariant(toThree.memory, between("three", "two")(toThree.part, holder("two", "kids", [])));

    expect(toThree.part).toEqual(holder("three", "kids", [EDITED, Y, Z]));
    expect(toTwoAgain.part).toEqual(holder("two", "kids", [EDITED, Y]));
  });

  it("keep the fields of the variant that are not children as it left them", () => {
    const away = switchVariant(NO_MEMORY, between("three", "two")({ ...holder("three", "kids", [X, Y, Z]), own: "typed" }, holder("two", "kids", [X, Y])));
    const back = switchVariant(away.memory, between("two", "three")(holder("two", "kids", [EDITED, Y]), holder("three", "kids", [])));

    expect(back.part).toEqual({ ...holder("three", "kids", [EDITED, Y, Z]), own: "typed" });
  });

  it("are the same child in variants that keep them under different keys", () => {
    const away = switchVariant(NO_MEMORY, between("kids", "items")(holder("kids", "kids", [X, Y]), holder("items", "items", [X])));
    const back = switchVariant(away.memory, between("items", "kids")(holder("items", "items", [EDITED]), holder("kids", "kids", [])));

    expect(back.part).toEqual(holder("kids", "kids", [EDITED, Y]));
  });

  it("can be absent: an optional child added in one variant is added to the others, and removed from them when removed", () => {
    const optional = (variant: string, unit?: Json): Json => (unit === undefined ? { variant } : { variant, unit });
    const unitSlots = (): Slots => [[["unit"]]];
    const switching = (from: string, to: string, current: Json, converted: Json): Switch => ({ place: ["n"], vocabulary: "form", from, to, current, convert: () => converted, slots: unitSlots, inside: "kept" });
    const away = switchVariant(NO_MEMORY, switching("a", "b", optional("a"), optional("b")));
    const withUnit = switchVariant(away.memory, switching("b", "a", optional("b", { m: 1 }), optional("a")));
    const again = switchVariant(withUnit.memory, switching("a", "b", withUnit.part, optional("b")));
    const without = switchVariant(again.memory, switching("b", "a", optional("b"), optional("a")));

    expect(withUnit.part).toEqual({ variant: "a", unit: { m: 1 } });
    expect(again.part).toEqual({ variant: "b", unit: { m: 1 } });
    expect(without.part).toEqual({ variant: "a" });
  });

  it("bring what was remembered of the items inside an edited child, to its new place", () => {
    const child = (key: "kids" | "items"): Place => ["n", key, 0];
    const typed = (value: number | string): Json => ({ kind: "x", value });
    const inner = (place: Place, from: string, to: string): ((current: Json, converted: Json) => Switch) => (current, converted) => ({ place, vocabulary: "json", from, to, current, convert: () => converted, slots: noSlots, inside: "kept" });
    const away = switchVariant(NO_MEMORY, between("kids", "items")(holder("kids", "kids", [typed(1), Y]), holder("items", "items", [typed(1)])));
    const innerAway = switchVariant(away.memory, inner(child("items"), "number", "text")(typed(1), typed("1")));
    const back = switchVariant(innerAway.memory, between("items", "kids")(holder("items", "items", [typed("1")]), holder("kids", "kids", [])));
    const innerBack = switchVariant(back.memory, inner(child("kids"), "text", "number")(typed("1"), typed(0)));

    expect(back.part).toEqual(holder("kids", "kids", [typed("1"), Y]));
    expect(innerBack.part).toEqual(typed(1));
  });

  it("do not bring the memory of an unedited child over what was remembered of the child it stands in for", () => {
    const child = (key: "kids" | "items"): Place => ["n", key, 0];
    const typed = (value: number | string): Json => ({ kind: "x", value });
    const inner = (place: Place, from: string, to: string): ((current: Json, converted: Json) => Switch) => (current, converted) => ({ place, vocabulary: "json", from, to, current, convert: () => converted, slots: noSlots, inside: "kept" });
    const withInner = switchVariant(NO_MEMORY, inner(child("kids"), "text", "number")(typed("keep"), typed(0)));
    const away = switchVariant(withInner.memory, between("kids", "items")(holder("kids", "kids", [typed(0), Y]), holder("items", "items", [typed(0)])));
    const back = switchVariant(away.memory, between("items", "kids")(away.part, holder("kids", "kids", [])));
    const innerBack = switchVariant(back.memory, inner(child("kids"), "number", "text")(typed(0), typed("default")));

    expect(innerBack.part).toEqual(typed("keep"));
  });

  it("are not consulted for a variant the item has not been in", () => {
    const away = switchVariant(NO_MEMORY, between("three", "two")(holder("three", "kids", [X, Y, Z]), holder("two", "kids", [X, Y])));

    expect(away.part).toEqual(holder("two", "kids", [X, Y]));
  });
});

describe("forgetWithin and forgetInside", () => {
  const SIBLING: Place = ["rules", SECOND_RULE, "excludes", "right"];
  /** A rule whose index starts with the digits of the index of another, which is not inside it. */
  const LONG_INDEX: Place = ["rules", TENTH_RULE, "x"];
  const LIST: Place = ["rules", 0, "candidates"];
  const ITEM: Place = [...LIST, 1];

  function remembered(...places: readonly Place[]): Memory {
    return places.reduce<Memory>((memory, place) => switchVariant(memory, moving(place, "text", "number")(TEXT, NUMBER)).memory, NO_MEMORY);
  }

  /** Whether the item at a place still gives back what it left. */
  function gives(memory: Memory, place: Place): boolean {
    return switchVariant(memory, moving(place, "number", "text")(NUMBER, DEFAULT_BOOLEAN)).part === TEXT;
  }

  it("forgetWithin drops the place and what is inside it, and keeps the rest", () => {
    const memory = forgetWithin(remembered(LIST, ITEM, [...ITEM, "left"], SIBLING), LIST);

    expect(gives(memory, LIST)).toBe(false);
    expect(gives(memory, ITEM)).toBe(false);
    expect(gives(memory, [...ITEM, "left"])).toBe(false);
    expect(gives(memory, SIBLING)).toBe(true);
  });

  it("forgetInside drops what is inside the place, and keeps the place itself and the rest", () => {
    const memory = forgetInside(remembered(LIST, ITEM, [...ITEM, "left"], SIBLING), LIST);

    expect(gives(memory, LIST)).toBe(true);
    expect(gives(memory, ITEM)).toBe(false);
    expect(gives(memory, [...ITEM, "left"])).toBe(false);
    expect(gives(memory, SIBLING)).toBe(true);
  });

  it("keeps an item that only shares the start of a path", () => {
    expect(gives(forgetWithin(remembered(LONG_INDEX), ["rules", SECOND_RULE]), LONG_INDEX)).toBe(true);
    expect(gives(forgetInside(remembered(LONG_INDEX), ["rules", SECOND_RULE]), LONG_INDEX)).toBe(true);
  });

  it("keeps the places above it", () => {
    expect(gives(forgetWithin(remembered(["rules", 0]), ITEM), ["rules", 0])).toBe(true);
    expect(gives(forgetInside(remembered(["rules", 0]), ITEM), ["rules", 0])).toBe(true);
  });

  it("forgets everything from the root", () => {
    expect(forgetWithin(remembered(LIST, SIBLING), []).size).toBe(0);
    expect(forgetInside(remembered(LIST, SIBLING), []).size).toBe(0);
  });

  it("leaves the memory it was given as it was", () => {
    const memory = remembered(LIST);
    forgetWithin(memory, LIST);
    forgetInside(memory, []);

    expect(gives(memory, LIST)).toBe(true);
  });
});

describe("any sequence of switches and edits of an item without children", () => {
  const VARIANTS = ["a", "b", "c", "d"] as const;
  type Variant = (typeof VARIANTS)[number];
  const step = fc.record({ to: fc.constantFrom(...VARIANTS), edit: fc.option(fc.jsonValue(), { nil: undefined }) });

  it("gives each variant the item is switched to the part it last held in it, and the conversion where it never held one", () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.array(step, { maxLength: 24 }), (start, steps) => {
        let memory = NO_MEMORY;
        let variant: Variant = "a";
        let part: Json = JSON.parse(JSON.stringify(start)) as Json;
        const lastHeld = new Map<Variant, Json>();
        for (const { to, edit } of steps) {
          if (edit !== undefined) part = JSON.parse(JSON.stringify(edit)) as Json;
          if (to === variant) continue;
          const converted: Json = { converted: to };
          const expected = lastHeld.has(to) ? lastHeld.get(to) : converted;
          lastHeld.set(variant, part);
          lastHeld.delete(to);
          const switched = switchVariant(memory, moving(PLACE, variant, to)(part, converted));
          expect(switched.part).toBe(expected);
          memory = switched.memory;
          part = switched.part;
          variant = to;
        }
      }),
    );
  });

  it("restores the original after any chain of switches that returns to the first variant with no edit", () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.array(fc.constantFrom(...VARIANTS), { minLength: 1, maxLength: 12 }), (start, chain) => {
        const original: Json = JSON.parse(JSON.stringify(start)) as Json;
        let memory = NO_MEMORY;
        let variant: Variant = "a";
        let part = original;
        for (const to of [...chain, "a" as const]) {
          const switched = switchVariant(memory, moving(PLACE, variant, to)(part, { converted: to }));
          memory = switched.memory;
          part = switched.part;
          variant = to;
        }

        expect(part).toEqual(original);
      }),
    );
  });
});

describe("any sequence of switches and edits of an item with children", () => {
  /** How many children each variant has places for. A switch carries the first ones across and gives the rest a default. */
  const ARITY = { a: 3, b: 2, c: 1, d: 4 } as const;
  type Variant = keyof typeof ARITY;
  const VARIANTS = Object.keys(ARITY).filter((name): name is Variant => name in ARITY);
  const MAX_STEPS = 30;

  type Step = { readonly kind: "switch"; readonly to: Variant } | { readonly kind: "edit"; readonly position: number };
  const steps: fc.Arbitrary<Step[]> = fc.array(
    fc.oneof(
      fc.constantFrom(...VARIANTS).map((to): Step => ({ kind: "switch", to })),
      fc.nat().map((position): Step => ({ kind: "edit", position })),
    ),
    { maxLength: MAX_STEPS },
  );

  function part(variant: Variant, children: readonly string[]): Json {
    return holder(variant, "kids", children.map((value): Json => ({ kind: "textLiteral", value })));
  }

  function childrenOf(held: Json): string[] {
    const list = isJsonObject(held) ? held["kids"] : undefined;
    if (list === undefined || !isJsonArray(list)) throw new Error("not a part with children");

    return list.map((child) => (isJsonObject(child) && typeof child["value"] === "string" ? child["value"] : "?"));
  }

  function run(chain: readonly Step[]): { readonly children: string[]; readonly expected: string[] } {
    const original = ["o0", "o1", "o2"];
    const latest = new Map<number, string>(original.map((value, position) => [position, value]));
    let memory = NO_MEMORY;
    let variant: Variant = "a";
    let children = [...original];
    let edits = 0;
    const switchTo = (to: Variant): void => {
      if (to === variant) return;
      const converted = Array.from({ length: ARITY[to] }, (_, position) => children[position] ?? `default ${to} ${String(position)}`);
      const switched = switchVariant(memory, between(variant, to)(part(variant, children), part(to, converted)));
      memory = switched.memory;
      children = childrenOf(switched.part);
      variant = to;
    };
    for (const next of chain) {
      if (next.kind === "switch") {
        switchTo(next.to);
        continue;
      }
      const position = next.position % ARITY[variant];
      const value = `edit ${String(edits)}`;
      edits += 1;
      children = children.with(position, value);
      latest.set(position, value);
    }
    switchTo("a");

    return { children, expected: original.map((_, position) => latest.get(position) ?? "?") };
  }

  it("ends in the first variant with each child as it was last edited in any variant that had a place for it", () => {
    fc.assert(
      fc.property(steps, (chain) => {
        const { children, expected } = run(chain);

        expect(children).toEqual(expected);
      }),
      { numRuns: 500 },
    );
  });

  it("restores the original after any chain of switches, however short the variants it passes through", () => {
    fc.assert(
      fc.property(steps, (chain) => {
        const { children, expected } = run(chain.filter((entry) => entry.kind === "switch"));

        expect(children).toEqual(expected);
      }),
      { numRuns: 500 },
    );
  });
});
