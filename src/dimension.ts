import type { Condition } from "./condition";
import type { Value } from "./value";

/** What every dimension carries, whatever its kind. */
interface DimensionCommon<N extends string> {
  /** The dimension's name: its key in every combination. */
  readonly name: N;
  /** The dimension takes part only where this condition holds; elsewhere it is collapsed to unset. It may mention only dimensions declared before this one. */
  readonly activeWhen?: Condition;
}

/** A dimension enumerated as a free choice among a finite list of values, in the order given. */
export interface ChoiceDimension<N extends string, V extends Value> extends DimensionCommon<N> {
  readonly kind: "choice";
  readonly values: readonly V[];
}

/**
 * A derived dimension resolved to the first candidate, in the order given, that no constraint rejects. Every constraint that mentions it may otherwise mention only dimensions declared before it, so each candidate is decided by values already chosen. A combination with no acceptable candidate is not in the solution set.
 */
export interface FirstValidDimension<N extends string, V extends Value> extends DimensionCommon<N> {
  readonly kind: "first-valid";
  readonly candidates: readonly V[];
}

/** A derived dimension computed by a function of dimensions declared before it. */
export interface ComputedDimension<N extends string, V extends Value> extends DimensionCommon<N> {
  readonly kind: "computed";
  /** The dimensions `compute` reads, each declared before this one. */
  readonly reads: readonly string[];
  /** The value from the values of `reads`, keyed by dimension name. It must be pure, since the engine may call it more than once for the same inputs. */
  readonly compute: (values: Readonly<Record<string, Value>>) => V;
}

/** One dimension of a model: a free choice, or a value derived from the others. */
export type Dimension<N extends string = string, V extends Value = Value> = ChoiceDimension<N, V> | FirstValidDimension<N, V> | ComputedDimension<N, V>;

/** Options every dimension builder takes. */
export interface DimensionOptions {
  /** See `activeWhen` on the dimension. */
  readonly activeWhen?: Condition;
}

/** Options for a dimension that is conditionally active, whose value may then be unset whatever its domain is. */
export interface ConditionalOptions {
  readonly activeWhen: Condition;
}

/** Produces the finite points at which a continuous dimension is measured. Called once, when the model is defined. */
export type Sampler<V extends Value> = () => readonly V[];

/** A free dimension over the given values, in order. Include `undefined` to make unset one of the choices. */
export function choice<const N extends string, const V extends Value>(name: N, values: readonly V[], options: ConditionalOptions): ChoiceDimension<N, V | undefined>;
export function choice<const N extends string, const V extends Value>(name: N, values: readonly V[], options?: DimensionOptions): ChoiceDimension<N, V>;
export function choice<const N extends string, const V extends Value>(name: N, values: readonly V[], options: DimensionOptions = {}): ChoiceDimension<N, V> {
  return withActivity({ kind: "choice", name, values }, options);
}

/** A free dimension whose values are the finite points an injected sampler returns: the only way a continuous range enters a model. */
export function sampled<const N extends string, V extends Value>(name: N, sampler: Sampler<V>, options: ConditionalOptions): ChoiceDimension<N, V | undefined>;
export function sampled<const N extends string, V extends Value>(name: N, sampler: Sampler<V>, options?: DimensionOptions): ChoiceDimension<N, V>;
export function sampled<const N extends string, V extends Value>(name: N, sampler: Sampler<V>, options: DimensionOptions = {}): ChoiceDimension<N, V> {
  return withActivity({ kind: "choice", name, values: sampler() }, options);
}

/** A derived dimension resolved to the first of the candidates that the constraints accept. See `FirstValidDimension`. */
export function firstValid<const N extends string, const V extends Value>(name: N, candidates: readonly V[], options: ConditionalOptions): FirstValidDimension<N, V | undefined>;
export function firstValid<const N extends string, const V extends Value>(name: N, candidates: readonly V[], options?: DimensionOptions): FirstValidDimension<N, V>;
export function firstValid<const N extends string, const V extends Value>(name: N, candidates: readonly V[], options: DimensionOptions = {}): FirstValidDimension<N, V> {
  return withActivity({ kind: "first-valid", name, candidates }, options);
}

/** The definition of a computed dimension. */
export interface ComputedDefinition<V extends Value> {
  readonly reads: readonly string[];
  readonly compute: (values: Readonly<Record<string, Value>>) => V;
  readonly activeWhen?: Condition;
}

/** A derived dimension computed from dimensions declared before it. See `ComputedDimension`. */
export function computed<const N extends string, V extends Value>(name: N, definition: ComputedDefinition<V> & ConditionalOptions): ComputedDimension<N, V | undefined>;
export function computed<const N extends string, V extends Value>(name: N, definition: ComputedDefinition<V>): ComputedDimension<N, V>;
export function computed<const N extends string, V extends Value>(name: N, definition: ComputedDefinition<V>): ComputedDimension<N, V> {
  return withActivity({ kind: "computed", name, reads: definition.reads, compute: definition.compute }, definition);
}

function withActivity<D extends Dimension>(dimension: D, options: DimensionOptions): D {
  return options.activeWhen === undefined ? dimension : { ...dimension, activeWhen: options.activeWhen };
}

/** The value type of a dimension. */
export type ValueOf<D> = D extends Dimension<string, infer V> ? V : never;

/** The type of one combination of the given dimensions: every dimension's name mapped to its value, unset included. */
export type TupleOf<Ds extends readonly Dimension[]> = { readonly [D in Ds[number] as D["name"]]: ValueOf<D> };

/** The names of the given dimensions. */
export type NameOf<Ds extends readonly Dimension[]> = Ds[number]["name"];
