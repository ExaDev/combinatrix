import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import type { Json } from "./json";
import type { Memory, Place, Switch } from "./typeMemory";
import { forgetInside, forgetWithin, NO_MEMORY, switchVariant } from "./typeMemory";

const PLACE: Place = ["rules", 0, "excludes", "right"];
const TEXT: Json = { kind: "textLiteral", value: " windows " };
const NUMBER: Json = { kind: "numberLiteral", value: 7, unit: { m: 1 } };
const DEFAULT_NUMBER: Json = { kind: "numberLiteral", value: 0 };
const DEFAULT_TEXT: Json = { kind: "textLiteral", value: "" };
/** The index of the tenth rule, whose digits start with those of the index of the second. */
const TENTH_RULE = 10;
const DEFAULT_BOOLEAN: Json = { kind: "booleanLiteral", value: true };

/** The switch of the item at a place from one variant to another, given the part now and the part a conversion makes. */
function moving(place: Place, from: string, to: string): (current: Json, converted: Json, inside?: Switch["inside"]) => Switch {
  return (current, converted, inside = "kept") => ({ place, from, to, current, convert: () => converted, inside });
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

describe("forgetWithin and forgetInside", () => {
  const SIBLING: Place = ["rules", 1, "excludes", "right"];
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
    expect(gives(forgetWithin(remembered(LONG_INDEX), ["rules", 1]), LONG_INDEX)).toBe(true);
    expect(gives(forgetInside(remembered(LONG_INDEX), ["rules", 1]), LONG_INDEX)).toBe(true);
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

describe("any sequence of switches and edits", () => {
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
