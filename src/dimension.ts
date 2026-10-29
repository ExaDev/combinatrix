import type { Condition } from "./condition";
import type { NonEmpty, Value, ValueRecord } from "./value";
import { valueKey } from "./value";

/** What every dimension carries, whatever its kind. `C` is the type of its activity condition: the literal type of one written in code, which `defineModel` checks against the dimensions declared before it, or `Condition` when it is not known at compile time. */
interface DimensionCommon<N extends string, C extends Condition> {
  /** The dimension's name: its key in every combination. */
  readonly name: N;
  /** The dimension takes part only where this condition holds; elsewhere it is collapsed to unset. It may mention only dimensions declared before this one. */
  readonly activeWhen?: C;
}

/** A dimension enumerated as a free choice among a finite list of values, in the order given. */
export interface ChoiceDimension<N extends string, V extends Value, C extends Condition = Condition> extends DimensionCommon<N, C> {
  readonly kind: "choice";
  readonly values: readonly V[];
}

/**
 * A derived dimension resolved to the first candidate, in the order given, that no constraint rejects. Every constraint that mentions it may otherwise mention only dimensions declared before it, so each candidate is decided by values already chosen. A combination with no acceptable candidate is not in the solution set.
 */
export interface FirstValidDimension<N extends string, V extends Value, C extends Condition = Condition> extends DimensionCommon<N, C> {
  readonly kind: "first-valid";
  readonly candidates: readonly V[];
}

/**
 * The function type `F` with its parameters compared bivariantly, as a method's are, rather than contravariantly as a function property's are under `strictFunctionTypes`. A computed dimension's `compute` has this type so that one reading a few named dimensions of known value types is still a `Dimension`, whose `compute` takes any record: the engine only ever passes the values of the dimensions it declared it reads, each one its dimension can hold, which is what makes the wider comparison sound. It is declared through a class because a class's method is the one method form the lint rules admit.
 */
declare class BivariantMethod<F extends (...args: never) => unknown> {
  call(...args: Parameters<F>): ReturnType<F>;
}

/** `F` with bivariant parameters: see `BivariantMethod`. */
export type Bivariant<F extends (...args: never) => unknown> = BivariantMethod<F>["call"];

/**
 * A derived dimension computed by a function of dimensions declared before it. `R` is the names it reads, checked by `defineModel` against the dimensions declared before it when they are known at compile time, and `P` is the type `compute` takes, checked by `defineModel` to accept every value those dimensions can take.
 */
export interface ComputedDimension<N extends string, V extends Value, C extends Condition = Condition, R extends string = string, P = Readonly<Record<R, Value>>> extends DimensionCommon<N, C> {
  readonly kind: "computed";
  /** The names of the dimensions `compute` reads, each declared before this one. */
  readonly reads: readonly R[];
  /** The value from the values of `reads`, keyed by dimension name. It must be pure, since the engine may call it more than once for the same inputs. */
  readonly compute: Bivariant<(values: P) => V>;
}

/** One dimension of a model: a free choice, or a value derived from the others. */
export type Dimension<N extends string = string, V extends Value = Value> = ChoiceDimension<N, V> | FirstValidDimension<N, V> | ComputedDimension<N, V>;

/** Options every dimension builder takes. */
export interface DimensionOptions {
  /** See `activeWhen` on the dimension. */
  readonly activeWhen?: Condition;
}

/** Options for a dimension that is conditionally active, whose value may then be unset whatever its domain is. `C` is the condition's type, kept so `defineModel` can check it. */
export interface ConditionalOptions<C extends Condition = Condition> {
  readonly activeWhen: C;
}

/** Produces the finite points at which a continuous dimension is measured. Called once, when the model is defined. */
export type Sampler<V extends Value> = () => readonly V[];

/** A free dimension over the given values, in order. Include `undefined` to make unset one of the choices. The list is typed non-empty, so an empty domain is a compile error; a list built at runtime is narrowed with `isNonEmpty` first. */
export function choice<const N extends string, const V extends Value, const C extends Condition>(name: N, values: NonEmpty<V>, options: ConditionalOptions<C>): ChoiceDimension<N, V | undefined, C>;
export function choice<const N extends string, const V extends Value>(name: N, values: NonEmpty<V>, options?: DimensionOptions): ChoiceDimension<N, V>;
export function choice<const N extends string, const V extends Value>(name: N, values: NonEmpty<V>, options: DimensionOptions = {}): ChoiceDimension<N, V> {
  return withActivity({ kind: "choice", name, values }, options);
}

/** A free dimension whose values are the finite points an injected sampler returns: the only way a continuous range enters a model. */
export function sampled<const N extends string, V extends Value, const C extends Condition>(name: N, sampler: Sampler<V>, options: ConditionalOptions<C>): ChoiceDimension<N, V | undefined, C>;
export function sampled<const N extends string, V extends Value>(name: N, sampler: Sampler<V>, options?: DimensionOptions): ChoiceDimension<N, V>;
export function sampled<const N extends string, V extends Value>(name: N, sampler: Sampler<V>, options: DimensionOptions = {}): ChoiceDimension<N, V> {
  return withActivity({ kind: "choice", name, values: sampler() }, options);
}

/** A derived dimension resolved to the first of the candidates that the constraints accept. See `FirstValidDimension`. The list is typed non-empty, as for `choice`. */
export function firstValid<const N extends string, const V extends Value, const C extends Condition>(name: N, candidates: NonEmpty<V>, options: ConditionalOptions<C>): FirstValidDimension<N, V | undefined, C>;
export function firstValid<const N extends string, const V extends Value>(name: N, candidates: NonEmpty<V>, options?: DimensionOptions): FirstValidDimension<N, V>;
export function firstValid<const N extends string, const V extends Value>(name: N, candidates: NonEmpty<V>, options: DimensionOptions = {}): FirstValidDimension<N, V> {
  return withActivity({ kind: "first-valid", name, candidates }, options);
}

/** One entry of a `reads` list: a dimension's name, or the dimension itself, which gives the value type it is read with too. */
export type Read = string | Dimension;

/** The name a `reads` entry names. */
export type ReadName<X extends Read> = X extends Dimension ? X["name"] : X;

/** The values a `reads` list reads, keyed by name: each dimension given as itself with its own value type, and each given by name alone as any `Value`, since a name carries no value type. */
export type ReadValues<Rs extends readonly Read[]> = { readonly [X in Rs[number] as ReadName<X>]: X extends Dimension ? ValueOf<X> : Value };

/** The names a `reads` list names, in order: the runtime form of the list, which is what a model stores. */
export function readNames<const Rs extends readonly Read[]>(reads: Rs): ReadName<Rs[number]>[] {
  const names = reads.map(nameOfRead);
  if (!namesEach(names, reads)) throw new Error("unreachable: each name was taken from the read at its position");

  return names;
}

function nameOfRead(read: Readonly<Read>): string {
  return typeof read === "string" ? read : read.name;
}

/** Whether each name is the one the read at its position names. */
function namesEach<Rs extends readonly Read[]>(names: readonly string[], reads: Rs): names is ReadName<Rs[number]>[] {
  return names.length === reads.length && names.every((name, index) => {
    const read = reads[index];

    return read !== undefined && name === nameOfRead(read);
  });
}

/** The definition of a computed dimension. `Rs` is its `reads` list, which types the values `compute` receives. */
export interface ComputedDefinition<V extends Value, Rs extends readonly Read[] = readonly string[]> {
  /** The dimensions `compute` reads, each declared before this one, by name or as the dimension itself. A dimension given as itself is read with its own value type; one given by name is read as any `Value`. */
  readonly reads: Rs;
  /** The value from the values of `reads`, keyed by dimension name. It must be pure, since the engine may call it more than once for the same inputs. */
  readonly compute: (values: Readonly<ReadValues<Rs>>) => V;
  readonly activeWhen?: Condition;
}

/** A derived dimension computed from dimensions declared before it. See `ComputedDimension` and `ComputedDefinition`. */
export function computed<const N extends string, V extends Value, const Rs extends readonly Read[], const C extends Condition>(name: N, definition: ComputedDefinition<V, Rs> & ConditionalOptions<C>): ComputedDimension<N, V | undefined, C, ReadName<Rs[number]>, ReadValues<Rs>>;
export function computed<const N extends string, V extends Value, const Rs extends readonly Read[]>(name: N, definition: ComputedDefinition<V, Rs>): ComputedDimension<N, V, Condition, ReadName<Rs[number]>, ReadValues<Rs>>;
export function computed<const N extends string, V extends Value, const Rs extends readonly Read[]>(name: N, definition: ComputedDefinition<V, Rs>): ComputedDimension<N, V, Condition, ReadName<Rs[number]>, ReadValues<Rs>> {
  return withActivity({ kind: "computed", name, reads: readNames(definition.reads), compute: definition.compute }, definition);
}

function withActivity<D extends Dimension>(dimension: D, options: DimensionOptions): D {
  return options.activeWhen === undefined ? dimension : { ...dimension, activeWhen: options.activeWhen };
}

/** The value type of a dimension. */
export type ValueOf<D> = D extends Dimension<string, infer V> ? V : never;

/** The type of one combination of the given dimensions: every dimension's name mapped to its value, unset included. */
export type TupleOf<Ds extends readonly Dimension[]> = { readonly [D in Ds[number] as D["name"]]: ValueOf<D> };

/** The keys of every value a dimension can hold in a combination, or `undefined` when a function computes it and the set is not known ahead. */
export function possibleKeys(dimension: Dimension): Set<string> | undefined {
  if (dimension.kind === "computed") return undefined;

  const values = domainOf(dimension);
  const keys = new Set(values.map(valueKey));
  if (dimension.activeWhen !== undefined) keys.add(valueKey(undefined));

  return keys;
}

/** A free dimension's values or a first-valid dimension's candidates; empty for a computed one. */
export function domainOf(dimension: Dimension): readonly Value[] {
  if (dimension.kind === "choice") return dimension.values;
  if (dimension.kind === "first-valid") return dimension.candidates;

  return [];
}

/** Whether a value is one the dimension can hold in a combination: one of its possible values, or for a computed dimension, whose values are not known ahead, any value. */
export function canHold(dimension: Dimension, value: Value): boolean {
  const keys = possibleKeys(dimension);

  return keys === undefined || keys.has(valueKey(value));
}

/** Whether every dimension a `reads` list gives as itself can hold the value given for its name. A name given alone reads any value. */
export function readsHold(reads: readonly Read[], values: ValueRecord): boolean {
  return reads.every((read) => typeof read === "string" || canHold(read, values[read.name]));
}

/** The names of the given dimensions. */
export type NameOf<Ds extends readonly Dimension[]> = Ds[number]["name"];
