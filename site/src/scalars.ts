import type { Scalar } from "combinatrix";

import { unreachable } from "./exhaustive";
import type { Json } from "./json";

/** The types of scalar a value of a dimension's domain can be. */
export type ScalarType = "text" | "number" | "boolean" | "null";

export const SCALAR_TYPES: readonly ScalarType[] = ["text", "number", "boolean", "null"];

export const SCALAR_TYPE_LABELS: Readonly<Record<ScalarType, string>> = { text: "text", number: "number", boolean: "true or false", null: "null" };

export function isScalar(value: Json): value is Scalar {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

export function scalarType(value: Scalar): ScalarType {
  if (value === null) return "null";
  if (typeof value === "string") return "text";
  if (typeof value === "number") return "number";

  return "boolean";
}

/** The number a text states, or `undefined` when it states none: finite, and not empty. Negative zero is written as zero, which is what JSON keeps of it. */
export function parseNumber(text: string): number | undefined {
  if (text.trim() === "") return undefined;
  const value = Number(text);
  if (!Number.isFinite(value)) return undefined;

  return value === 0 ? 0 : value;
}

/** The number a text is the decimal text of, or `undefined`: the text must be exactly what `String` writes for a finite number, so reading it and writing it back gives the same text, and no spacing, sign, leading zero or exponent form is lost. Negative zero has no such text, because `String` writes it as zero. */
export function canonicalNumber(text: string): number | undefined {
  const value = Number(text);

  return Number.isFinite(value) && String(value) === text ? value : undefined;
}

/**
 * The value of another type that stands for the same thing, or `undefined` when no value of that type does. A number is carried as its decimal text and a boolean as `true` or `false`; the text of a number (see `canonicalNumber`) is carried as that number and exactly the texts `true` and `false` as booleans. Anything else is not carried: the caller starts the type's default, and the value it replaces is still in the editor's memory of the item.
 */
export function carryScalar(value: Scalar, type: ScalarType): Scalar | undefined {
  if (scalarType(value) === type) return value;
  switch (type) {
    case "text":
      return typeof value === "number" || typeof value === "boolean" ? String(value) : undefined;
    case "number":
      return typeof value === "string" ? canonicalNumber(value) : undefined;
    case "boolean":
      if (value === "true") return true;

      return value === "false" ? false : undefined;
    case "null":
      return undefined;
    default:
      return unreachable(type);
  }
}

/** The value a new item of a type starts with. */
export function defaultScalar(type: ScalarType): Scalar {
  switch (type) {
    case "text":
      return "";
    case "number":
      return 0;
    case "boolean":
      return false;
    case "null":
      return null;
    default:
      return unreachable(type);
  }
}

/** The value of another type that stands for this one where one does (`carryScalar`), and the type's default where none does. */
export function convertScalar(value: Scalar, type: ScalarType): Scalar {
  return carryScalar(value, type) ?? defaultScalar(type);
}
