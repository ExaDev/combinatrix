import fc from "fast-check";

import type { Json, JsonObject } from "./json";
import { parseJson } from "./json";

/** Limits of the generated trees, named for what they bound. */
export const MAX_DOMAIN = 3;
export const MAX_NAME = 4;
export const MAX_TEXT = 6;
export const NUMBER_RANGE = 5;

/** A JSON value with no negative zero, which JSON writes as zero. */
export const jsonArb: fc.Arbitrary<Json> = fc.jsonValue().map((value) => parseJson(JSON.stringify(value)));

/** A unit: symbols with number exponents. */
export const unitArb: fc.Arbitrary<JsonObject> = fc.dictionary(fc.string({ minLength: 1, maxLength: MAX_NAME }), fc.integer({ min: -NUMBER_RANGE, max: NUMBER_RANGE }), { maxKeys: 2 });

const optionalUnit = (): fc.Arbitrary<{ unit?: JsonObject }> => fc.option(unitArb, { nil: undefined }).map((unit) => (unit === undefined ? {} : { unit }));

/** An expression of any kind trilean's schema defines, nested to a depth. */
export function anyExpressionArb(depth: number): fc.Arbitrary<Json> {
  const leaf = fc.oneof(
    fc.tuple(fc.constantFrom("a", "c"), optionalUnit()).map(([key, extra]): Json => ({ kind: "reference", key, ...extra })),
    jsonArb.map((key): Json => ({ kind: "reference", key })),
    fc.string({ maxLength: MAX_TEXT }).map((value): Json => ({ kind: "textLiteral", value })),
    fc.string({ maxLength: MAX_TEXT }).map((value): Json => ({ kind: "instantLiteral", value })),
    fc.tuple(fc.integer(), optionalUnit()).map(([value, extra]): Json => ({ kind: "numberLiteral", value, ...extra })),
    fc.boolean().map((value): Json => ({ kind: "booleanLiteral", value })),
    fc.tuple(fc.integer(), fc.constantFrom("ms", "s", "min", "h", "d")).map(([value, unit]): Json => ({ kind: "durationLiteral", value, unit })),
    fc.tuple(fc.integer(), fc.integer(), optionalUnit()).map(([re, im, extra]): Json => ({ kind: "complexLiteral", re, im, ...extra })),
    fc.tuple(fc.integer(), fc.integer(), optionalUnit()).map(([magnitude, phase, extra]): Json => ({ kind: "complexLiteral", magnitude, phase, ...extra })),
    jsonArb.map((key): Json => ({ kind: "treeReference", key })),
    fc.constant<Json>({ kind: "accumulator" }),
    fc.tuple(fc.string({ maxLength: MAX_TEXT }), jsonArb).map(([system, payload]): Json => ({ kind: "delegate", system, payload })),
  );
  if (depth === 0) return leaf;
  const child = anyExpressionArb(depth - 1);
  const predicate = anyPredicateArb(depth - 1);

  return fc.oneof(
    leaf,
    fc.tuple(fc.constantFrom("add", "subtract", "multiply", "divide", "power", "modulo"), child, child).map(([op, left, right]): Json => ({ kind: "arithmetic", op, left, right })),
    child.map((operand): Json => ({ kind: "negate", operand })),
    fc.tuple(fc.string({ maxLength: MAX_TEXT }), fc.array(child, { maxLength: MAX_DOMAIN })).map(([fn, args]): Json => ({ kind: "call", fn, args })),
    fc.tuple(jsonArb, fc.array(child, { maxLength: MAX_DOMAIN })).map(([table, keys]): Json => ({ kind: "lookup", table, keys })),
    fc.tuple(fc.option(fc.constantFrom("first", "unique"), { nil: undefined }), fc.array(fc.record({ when: predicate, then: child }), { maxLength: MAX_DOMAIN }), child).map(([hitPolicy, cases, fallback]): Json => (hitPolicy === undefined ? { kind: "conditional", cases, fallback } : { kind: "conditional", hitPolicy, cases, fallback })),
    fc.tuple(jsonArb, fc.option(predicate, { nil: undefined }), fc.oneof(child.map((item): Json => ({ mode: "max", item })), child.map((item): Json => ({ mode: "min", item })), fc.tuple(child, child).map(([initial, combine]): Json => ({ mode: "reduce", initial, combine })))).map(([collection, filter, combiner]): Json => (filter === undefined ? { kind: "fold", collection, combiner } : { kind: "fold", collection, filter, combiner })),
  );
}

/** A predicate of any kind trilean's schema defines, nested to a depth. */
export function anyPredicateArb(depth: number): fc.Arbitrary<Json> {
  const leaf = jsonArb.map((key): Json => ({ kind: "treeReference", key }));
  if (depth === 0) return leaf;
  const child = anyPredicateArb(depth - 1);
  const expression = anyExpressionArb(depth - 1);

  return fc.oneof(
    leaf,
    child.map((operand): Json => ({ kind: "not", operand })),
    fc.tuple(fc.constantFrom("and", "or"), child, child).map(([kind, left, right]): Json => ({ kind, left, right })),
    fc.tuple(fc.constantFrom("allOf", "anyOf"), fc.array(child, { maxLength: MAX_DOMAIN })).map(([kind, operands]): Json => ({ kind, operands })),
    fc.tuple(fc.constantFrom("gt", "gte", "lt", "lte", "eq", "neq"), expression, expression).map(([op, left, right]): Json => ({ kind: "compare", op, left, right })),
    fc.tuple(fc.constantFrom("equals", "notEquals", "matches", "notMatches", "portableMatches", "portableNotMatches"), expression, expression).map(([op, left, right]): Json => ({ kind: "textCompare", op, left, right })),
    fc.tuple(fc.constantFrom("in", "notIn"), expression, fc.array(expression, { maxLength: MAX_DOMAIN })).map(([op, operand, candidates]): Json => ({ kind: "memberOf", op, operand, candidates })),
    expression.map((operand): Json => ({ kind: "exists", operand })),
    fc.tuple(fc.constantFrom("some", "every"), jsonArb, child, fc.option(child, { nil: undefined })).map(([kind, collection, item, filter]): Json => (filter === undefined ? { kind, collection, item } : { kind, collection, item, filter })),
  );
}

