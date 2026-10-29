import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { canonicalNumber, carryScalar, convertScalar, defaultScalar, isScalar, parseNumber, SCALAR_TYPES, scalarType } from "./scalars";

const TWELVE = 12;
const FRACTION = -2.5;
const THOUSAND = 1000;
const HUGE = 1e21;
const TINY = 1e-7;

describe("scalarType", () => {
  it("names the type of a value", () => {
    expect([scalarType("a"), scalarType(1), scalarType(false), scalarType(null)]).toEqual(["text", "number", "boolean", "null"]);
  });
});

describe("isScalar", () => {
  it("accepts text, numbers, booleans and null, and nothing structured", () => {
    expect([isScalar("a"), isScalar(1), isScalar(true), isScalar(null)]).toEqual([true, true, true, true]);
    expect([isScalar([]), isScalar({})]).toEqual([false, false]);
  });
});

describe("parseNumber", () => {
  it("reads the number a text states, writing negative zero as zero", () => {
    expect(parseNumber("1e3")).toBe(THOUSAND);
    expect(parseNumber(" -2.5 ")).toBe(FRACTION);
    expect(Object.is(parseNumber("-0"), 0)).toBe(true);
    expect(parseNumber("1.")).toBe(1);
  });

  it("states no number for empty, blank, non-numeric or infinite text", () => {
    for (const text of ["", " ", "abc", "Infinity"]) expect(parseNumber(text)).toBeUndefined();
  });
});

describe("canonicalNumber", () => {
  it("reads only the text a number is written as", () => {
    expect(canonicalNumber("12")).toBe(TWELVE);
    expect(canonicalNumber("-2.5")).toBe(FRACTION);
    expect(canonicalNumber("0")).toBe(0);
    expect(canonicalNumber(String(HUGE))).toBe(HUGE);
    expect(canonicalNumber(String(TINY))).toBe(TINY);
  });

  it("refuses text that writes a number another way, or none", () => {
    for (const text of ["", " 12", "12 ", "012", "1e3", "1.0", "+1", "-0", "0x10", "Infinity", "NaN", "twelve"]) expect(canonicalNumber(text), JSON.stringify(text)).toBeUndefined();
  });

  it("reads back every finite number written as text", () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true, noDefaultInfinity: true }).filter((value) => !Object.is(value, -0)),
        (value) => canonicalNumber(String(value)) === value,
      ),
    );
  });
});

describe("carryScalar", () => {
  it("keeps a value of the type asked for", () => {
    expect(carryScalar("a", "text")).toBe("a");
    expect(carryScalar(TWELVE, "number")).toBe(TWELVE);
    expect(carryScalar(false, "boolean")).toBe(false);
    expect(carryScalar(null, "null")).toBeNull();
  });

  it("carries a number as its decimal text, and a boolean as true or false", () => {
    expect(carryScalar(TWELVE, "text")).toBe("12");
    expect(carryScalar(FRACTION, "text")).toBe("-2.5");
    expect(carryScalar(true, "text")).toBe("true");
    expect(carryScalar(false, "text")).toBe("false");
  });

  it("carries text that is a canonical decimal number as that number", () => {
    expect(carryScalar("12", "number")).toBe(TWELVE);
    expect(carryScalar("-2.5", "number")).toBe(FRACTION);
  });

  it("carries exactly the texts true and false as booleans", () => {
    expect(carryScalar("true", "boolean")).toBe(true);
    expect(carryScalar("false", "boolean")).toBe(false);
  });

  it("carries nothing else", () => {
    expect(carryScalar("linux", "number")).toBeUndefined();
    expect(carryScalar(" 12 ", "number")).toBeUndefined();
    expect(carryScalar("1e3", "number")).toBeUndefined();
    expect(carryScalar("TRUE", "boolean")).toBeUndefined();
    expect(carryScalar("yes", "boolean")).toBeUndefined();
    expect(carryScalar(1, "boolean")).toBeUndefined();
    expect(carryScalar(true, "number")).toBeUndefined();
    expect(carryScalar(null, "text")).toBeUndefined();
    expect(carryScalar(null, "number")).toBeUndefined();
    expect(carryScalar(null, "boolean")).toBeUndefined();
    expect(carryScalar("a", "null")).toBeUndefined();
    expect(carryScalar(TWELVE, "null")).toBeUndefined();
  });

  it("returns to the start through text for every number and boolean", () => {
    fc.assert(
      fc.property(fc.oneof(fc.double({ noNaN: true, noDefaultInfinity: true }).filter((value) => !Object.is(value, -0)), fc.boolean()), (value) => {
        const text = carryScalar(value, "text");
        expect(text).toBeDefined();
        expect(text === undefined ? undefined : carryScalar(text, scalarType(value))).toBe(value);
      }),
    );
  });
});

describe("defaultScalar", () => {
  it("is the value a new item of each type starts with", () => {
    expect(SCALAR_TYPES.map((type) => defaultScalar(type))).toEqual(["", 0, false, null]);
  });
});

describe("convertScalar", () => {
  it("carries where the conversion is lossless, and starts the default of the type where it is not", () => {
    expect(convertScalar(String(TWELVE), "number")).toBe(TWELVE);
    expect(convertScalar("twelve", "number")).toBe(0);
    expect(convertScalar(true, "number")).toBe(0);
    expect(convertScalar(null, "number")).toBe(0);
    expect(convertScalar(TWELVE, "text")).toBe(String(TWELVE));
    expect(convertScalar(null, "text")).toBe("");
    expect(convertScalar("true", "boolean")).toBe(true);
    expect(convertScalar("yes", "boolean")).toBe(false);
    expect(convertScalar(0, "boolean")).toBe(false);
    expect(convertScalar(2, "boolean")).toBe(false);
    expect(convertScalar("x", "null")).toBeNull();
  });
});
