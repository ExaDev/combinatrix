import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { EditorState } from "./editorState";
import { nodeSwitch, stateAfterSwitch, stateFromModel } from "./editorState";
import type { Json, JsonObject } from "./json";
import { getIn, isJsonObject, parseJson } from "./json";
import type { ExpressionKind, PredicateKind } from "./nodes";
import { changeExpressionKind, changePredicateKind, EXPRESSION_KINDS, expressionSlots, PREDICATE_KINDS, predicateSlots } from "./nodes";
import type { Slots } from "./typeMemory";
import { anyExpressionArb, anyPredicateArb } from "./treeArbitraries";

/** How deep generated trees go, how long a chain of switches is, how many chains are tried, and the seed that makes a failure reproducible. */
const DEPTH = 2;
const MAX_SWITCHES = 12;
const RUNS = 300;
const SEED = 20_261_030;

const NAMES = ["os", "arch"];
const PATH = ["rules", 0, "excludes"] as const;
const OS: Json = { kind: "reference", key: "os" };

/** The model whose one rule excludes a condition, read from JSON text so it shares nothing with the tree generated. */
function modelWith(condition: Json): JsonObject {
  const model = parseJson(JSON.stringify({ dimensions: [{ kind: "choice", name: "os", values: ["linux"] }], rules: [{ excludes: condition }] }));
  if (!isJsonObject(model)) throw new Error("not a model");

  return model;
}

function kindOf(node: Json | undefined): string {
  const kind = node !== undefined && isJsonObject(node) ? node["kind"] : undefined;
  if (typeof kind !== "string") throw new Error("a node has a kind");

  return kind;
}

/** What the form does when a kind menu is used, without the page: the same switch, naming the variants the same way. */
function switchKind(state: EditorState, where: { readonly path: readonly (string | number)[]; readonly vocabulary: string; readonly slots: (part: Json) => Slots }, to: string, change: (current: Json) => Json): EditorState {
  const { path, vocabulary, slots } = where;
  const from = kindOf(getIn(state.model, path));

  return stateAfterSwitch(state, nodeSwitch({ path, vocabulary, from, to, convert: change, slots }));
}

describe("any chain of kinds that returns to the start", () => {
  it("restores any predicate", () => {
    fc.assert(
      fc.property(anyPredicateArb(DEPTH), fc.array(fc.constantFrom(...PREDICATE_KINDS), { minLength: 1, maxLength: MAX_SWITCHES }), (condition, chain) => {
        const start = PREDICATE_KINDS.find((kind) => kind === kindOf(condition));
        if (start === undefined) throw new Error("a predicate has a kind the schema defines");
        const end = [...chain, start].reduce<EditorState>((state, kind: PredicateKind) => switchKind(state, { path: PATH, vocabulary: "predicate", slots: predicateSlots }, kind, (current) => changePredicateKind(current, kind, NAMES)), stateFromModel(modelWith(condition)));

        expect(getIn(end.model, PATH)).toEqual(condition);
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });

  it("restores any expression", () => {
    const right = [...PATH, "right"] as const;
    fc.assert(
      fc.property(anyExpressionArb(DEPTH), fc.array(fc.constantFrom(...EXPRESSION_KINDS), { minLength: 1, maxLength: MAX_SWITCHES }), (expression, chain) => {
        const start = EXPRESSION_KINDS.find((kind) => kind === kindOf(expression));
        if (start === undefined) throw new Error("an expression has a kind the schema defines");
        const model = modelWith({ kind: "compare", op: "eq", left: OS, right: expression });
        const end = [...chain, start].reduce<EditorState>((state, kind: ExpressionKind) => switchKind(state, { path: right, vocabulary: "expression", slots: expressionSlots }, kind, (current) => changeExpressionKind(current, kind, NAMES)), stateFromModel(model));

        expect(getIn(end.model, right)).toEqual(expression);
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });
});
