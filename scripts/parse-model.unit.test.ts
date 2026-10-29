import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { Dimension, ModelData } from "../src/index";
import { modelShapeIssues } from "../src/shape";
import { choice, collect, count, defineModel, firstValid, isModelData, isNonEmpty, ModelError, parseModel } from "../src/index";
import { accepts, definesModel, expectAgreement, model, nearMiss, ONE_PROPERTY, RUNS, SEED, TWO_PROPERTIES } from "./json-schema.fixtures";

/**
 * `isModelData` and `parseModel` against the published JSON Schema and against `defineModel`, over the seeded models and near misses the schema suite draws. The guard must agree with the schema exactly, and the parser must accept exactly what the schema accepts and `defineModel` accepts, building the model `defineModel` builds from the same definition written in code.
 */

/** Whether `parseModel` accepts the data, a refusal being a `ModelError` and nothing else. */
function parses(data: unknown): boolean {
  try {
    parseModel(data);

    return true;
  } catch (error) {
    if (error instanceof ModelError) return false;
    throw error;
  }
}

/** One dimension of model data written as a call to the constructor for its kind. */
function inCode(data: ModelData["dimensions"][number]): Dimension {
  const domain = data.kind === "choice" ? data.values : data.candidates;
  if (!isNonEmpty(domain)) throw new Error("a generated domain is not empty");

  const options = data.activeWhen === undefined ? undefined : { activeWhen: data.activeWhen };

  return data.kind === "choice" ? choice(data.name, domain, options) : firstValid(data.name, domain, options);
}

describe("isModelData", () => {
  it("agrees with the JSON Schema on every model and near miss", TWO_PROPERTIES, () => {
    expectAgreement(model, isModelData, accepts("Model"));
  });

  it("accepts every value the schema's Model accepts, and every value it accepts the schema's root accepts", ONE_PROPERTY, () => {
    const validModel = accepts("Model");
    const validRoot = accepts(undefined);
    const anything = fc.oneof(model, nearMiss(model).map(({ value }) => value), fc.jsonValue());
    fc.assert(
      fc.property(anything, (value) => {
        if (validModel(value)) expect(isModelData(value), JSON.stringify(value)).toBe(true);
        if (isModelData(value)) expect(validRoot(value), JSON.stringify(value)).toBe(true);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it("refuses what the schema refuses beyond a near miss: constraints, a computed dimension and an unset value", () => {
    const refused: readonly unknown[] = [
      { dimensions: [], constraints: [] },
      { dimensions: [{ kind: "computed", name: "a", reads: [], compute: () => 1 }] },
      { dimensions: [{ kind: "choice", name: "a", values: [undefined, "x"] }] },
    ];
    const validModel = accepts("Model");
    // A function is not JSON, so the schema refuses the computed dimension for it or for its kind, whichever it meets first; what matters is that both refuse.
    expect(refused.map((value) => [isModelData(value), validModel(value)])).toEqual(refused.map(() => [false, false]));
  });

  it("fails the agreement for a guard with a rule weakened, so that agreement is not by construction", TWO_PROPERTIES, () => {
    // `modelShapeIssues` is the shape check `defineModel` runs first: the same guard without the empty-domain, duplicate-value, unset-value, computed and constraints rules.
    const weakened = (value: unknown): boolean => modelShapeIssues(value).length === 0;
    expect(() => {
      expectAgreement(model, weakened, accepts("Model"));
    }).toThrow();
  });
});

describe("parseModel", () => {
  it("accepts exactly what the schema accepts and `defineModel` accepts, and refuses the rest with a `ModelError`", TWO_PROPERTIES, () => {
    expectAgreement(model, parses, accepts("Model"), definesModel);
  });

  it("enumerates the same combinations, in the same order, as the model written in code", ONE_PROPERTY, () => {
    fc.assert(
      fc.property(model, (data) => {
        if (!isModelData(data)) throw new Error("a generated model is model data");

        const written = defineModel(data.rules === undefined ? { dimensions: data.dimensions.map(inCode) } : { dimensions: data.dimensions.map(inCode), rules: data.rules });
        const parsed = parseModel(data);
        expect(count(parsed), JSON.stringify(data)).toBe(count(written));
        expect(collect(parsed), JSON.stringify(data)).toEqual(collect(written));
        expect(parsed.dimensions).toEqual(written.dimensions);
        expect(parsed.rules).toEqual(written.rules);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it("is refused with every issue for data of the wrong shape, as the guard refuses it", ONE_PROPERTY, () => {
    fc.assert(
      fc.property(nearMiss(model), ({ value }) => {
        if (isModelData(value)) return;

        expect(() => parseModel(value), JSON.stringify(value)).toThrow(ModelError);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });
});
