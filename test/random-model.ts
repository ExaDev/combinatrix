import type { Comparable, Condition, Constraint, Dimension, Model, NonEmpty, Rule, Scalar, Value } from "../src/index";
import { allOf, anyOf, choice, computed, defineModel, firstValid, is, isNonEmpty, isSet, isUnset, not, oneOf, predicate } from "../src/index";

/** How many generated models each property is checked against. */
const MODELS = 400;
const SEED = 20_261_029;
/** Every value a generated domain draws from, unset included: of every kind, `null` among them. */
export const VALUE_POOL: readonly Value[] = [undefined, null, "x", "y", 0, 1, true, false];
/** The pools of one kind each that a dimension a condition may compare draws its domain from, unset included: trilean compares values of one kind only, and has no `null`. */
const KIND_POOLS: readonly (readonly Value[])[] = [
  [undefined, "x", "y", "z"],
  [undefined, 0, 1, 2],
  [undefined, true, false],
];
/** The most free dimensions a generated model has. */
export const MAX_FREE_DIMENSIONS = 4;
const MAX_DOMAIN = 3;
const MAX_RULES = 4;
const MAX_DEPTH = 2;
/** 2 to the power 32: maps an unsigned 32-bit integer into `[0, 1)`. */
const UINT32 = 4_294_967_296;
/** The number of leaf condition forms `randomCondition` chooses between: is, oneOf, isSet and isUnset. */
const LEAF_FORMS = 4;
/** A predicate built by `hashTest` rejects about one combination in this many. */
const REJECT_ONE_IN = 3;
const HASH_MULTIPLIER = 31;
const MULBERRY_INCREMENT = 0x6d2b79f5;
const MULBERRY_SHIFT_A = 15;
const MULBERRY_SHIFT_B = 7;
const MULBERRY_SHIFT_C = 14;
const MULBERRY_OR_A = 1;
const MULBERRY_OR_B = 61;

/** Mulberry32: a small seeded generator, so every run checks the same models and a failure reproduces. */
function generator(seed: number): () => number {
  let state = seed;

  return () => {
    state = (state + MULBERRY_INCREMENT) | 0;
    let t = Math.imul(state ^ (state >>> MULBERRY_SHIFT_A), state | MULBERRY_OR_A);
    t ^= t + Math.imul(t ^ (t >>> MULBERRY_SHIFT_B), t | MULBERRY_OR_B);

    return ((t ^ (t >>> MULBERRY_SHIFT_C)) >>> 0) / UINT32;
  };
}

/** A seeded source of random choices. */
export class Random {
  readonly #next: () => number;

  constructor(seed: number) {
    this.#next = generator(seed);
  }

  /** An integer in `[low, high]`. */
  int(low: number, high: number): number {
    return low + Math.floor(this.#next() * (high - low + 1));
  }

  chance(): boolean {
    return this.#next() < 1 / 2;
  }

  /** One of the items, which exclude `undefined` so that an empty list is told apart from a picked item. */
  pick<T extends object | Scalar>(items: readonly T[]): T {
    const item = items[this.int(0, items.length - 1)];
    if (item === undefined) throw new Error("pick from an empty list");

    return item;
  }

  /** A non-empty selection of distinct items, in their original order, from a non-empty list and a positive size. */
  subset<T>(items: readonly T[], size: number): NonEmpty<T> {
    const chosen = new Set<number>();
    while (chosen.size < Math.min(size, items.length)) chosen.add(this.int(0, items.length - 1));

    const selection = items.filter((_, index) => chosen.has(index));
    if (!isNonEmpty(selection)) throw new Error("a subset of a non-empty list with a positive size is non-empty");

    return selection;
  }
}

/** A dimension as the generator built it: its name, the values it can take, unset included where it can be unset, and whether a condition may read it, which needs every value of it to be of one kind and none to be `null`. */
interface Generated {
  readonly name: string;
  readonly values: readonly Value[];
  readonly readable: boolean;
}

function comparables(values: readonly Value[]): Comparable[] {
  return values.filter((value): value is Comparable => value !== undefined && value !== null);
}

/** A random condition over the readable dimensions among those given, comparing only against values each can take, and testing for unset only a dimension that can be unset. With none readable it is a constant: `allOf()` holds and `anyOf()` does not. */
function randomCondition(random: Random, generated: readonly Generated[], depth: number): Condition {
  const readable = generated.filter((dimension) => dimension.readable);
  if (readable.length === 0) return random.chance() ? allOf() : anyOf();

  const dimension = random.pick(readable);
  const options = comparables(dimension.values);
  const leaf = random.int(0, LEAF_FORMS - 1);
  if (depth >= MAX_DEPTH || random.chance()) {
    if (leaf === 0 && options.length > 0) return is(dimension.name, random.pick(options));
    if (leaf === 1 && options.length > 0) return oneOf(dimension.name, random.subset(options, random.int(1, options.length)));

    return leaf === 2 || !dimension.values.includes(undefined) ? isSet(dimension.name) : isUnset(dimension.name);
  }
  const operands = Array.from({ length: random.int(1, 2) }, () => randomCondition(random, generated, depth + 1));
  const [first] = operands;
  if (leaf === 0 && first !== undefined) return not(first);

  return leaf === 1 ? anyOf(...operands) : allOf(...operands);
}

function randomRule(random: Random, generated: readonly Generated[]): Rule {
  const body = randomCondition(random, generated, 0);
  const scope = random.chance() ? { when: randomCondition(random, generated, 1) } : {};
  const form = random.int(0, 2);
  if (form === 0) return { requires: body, ...scope };
  if (form === 1) return { excludes: body, ...scope };

  return { implies: [randomCondition(random, generated, 1), body], ...scope };
}

/** A deterministic pseudo-random boolean of the values a predicate reads, so the predicate is a pure function of them. */
export function hashTest(salt: number) {
  return (values: Readonly<Record<string, Value>>): boolean => {
    const text = JSON.stringify(Object.entries(values).map(([key, value]) => [key, value === undefined ? "unset" : value])) + String(salt);
    let hash = 0;
    for (const character of text) hash = (Math.imul(hash, HASH_MULTIPLIER) + (character.codePointAt(0) ?? 0)) | 0;

    return hash % REJECT_ONE_IN !== 0;
  };
}

/**
 * A random model using every feature: free dimensions with optional activity conditions on earlier ones, a computed dimension, a first-valid dimension whose rules mention only dimensions before it, random rules and a predicate. Most free dimensions draw their domain from a pool of one kind, so that conditions can compare them; the rest draw from every kind, `null` included, and only the predicate reads them.
 */
export function randomModel(seed: number): Model<Readonly<Record<string, Value>>> {
  const random = new Random(seed);
  const free: Generated[] = [];
  const dimensions: Dimension[] = [];
  const freeCount = random.int(1, MAX_FREE_DIMENSIONS);
  for (let index = 0; index < freeCount; index += 1) {
    const name = `d${String(index)}`;
    const readable = random.int(0, KIND_POOLS.length) < KIND_POOLS.length;
    const values = random.subset(readable ? random.pick(KIND_POOLS) : VALUE_POOL, random.int(1, MAX_DOMAIN));
    const earlier = [...free];
    const conditional = earlier.some((dimension) => dimension.readable) && random.chance();
    dimensions.push(conditional ? choice(name, values, { activeWhen: randomCondition(random, earlier, 1) }) : choice(name, values));
    free.push({ name, values: conditional ? [...values, undefined] : values, readable });
  }
  const readable = [...free];
  if (random.chance()) {
    const reads = random.subset(free.map((dimension) => dimension.name), random.int(1, free.length));
    dimensions.push(computed("sum", { reads, compute: (values) => Object.values(values).filter((value) => value !== undefined).length }));
  }
  const rules: Rule[] = Array.from({ length: random.int(0, MAX_RULES) }, () => randomRule(random, readable));
  if (random.chance()) {
    const candidates = random.subset(random.pick(KIND_POOLS), random.int(1, MAX_DOMAIN));
    dimensions.push(firstValid("derived", candidates));
    const withDerived = [...readable, { name: "derived", values: candidates, readable: true }];
    for (let index = random.int(1, 2); index > 0; index -= 1) rules.push(randomRule(random, withDerived));
  }
  const constraints: Constraint[] = [];
  if (random.chance()) {
    const reads = random.subset(free.map((dimension) => dimension.name), random.int(1, free.length));
    constraints.push(predicate({ reads, test: hashTest(seed) }));
  }

  return defineModel({ dimensions, rules, constraints });
}

/** The seed of each generated model a property is checked against. */
export const seeds = Array.from({ length: MODELS }, (_, index) => SEED + index);
