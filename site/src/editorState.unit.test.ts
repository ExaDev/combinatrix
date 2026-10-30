import { describe, expect, it } from "vitest";

import { emptyState, nodeSwitch, stateAfterEdit, stateAfterSwitch, stateFromModel, stateFromText } from "./editorState";
import type { JsonObject } from "./json";
import { NO_MEMORY, noSlots } from "./typeMemory";
import { convertJson } from "./modelEdit";
import { SCHEMA_URL } from "./schema";

const PREVIOUS: JsonObject = { dimensions: [{ kind: "choice", name: "kept", values: ["a"] }] };
const BEFORE = stateFromModel(PREVIOUS);

describe("stateFromModel", () => {
  it("writes the model out as indented JSON that reads back as the same model", () => {
    const state = stateFromModel(PREVIOUS);

    expect(state.text).toContain('\n  "dimensions"');
    expect(JSON.parse(state.text)).toEqual(PREVIOUS);
    expect(state.problem).toBeUndefined();
  });

  it("starts empty with a model that has no dimensions and names the schema it is written against", () => {
    expect(emptyState().model).toEqual({ $schema: SCHEMA_URL, dimensions: [] });
  });

  it("writes the schema first, where an editor looks for it", () => {
    expect(emptyState().text).toBe(`{\n  "$schema": ${JSON.stringify(SCHEMA_URL)},\n  "dimensions": []\n}`);
  });
});

describe("stateFromText", () => {
  it("shows the model the text holds", () => {
    const state = stateFromText('{"dimensions":[],"rules":[]}', BEFORE);

    expect(state).toEqual({ text: '{"dimensions":[],"rules":[]}', model: { dimensions: [], rules: [] }, problem: undefined, memory: NO_MEMORY });
  });

  it("keeps the last model and exactly the typed text when the text is not JSON", () => {
    const state = stateFromText('{"dimensions": [', BEFORE);

    expect(state.text).toBe('{"dimensions": [');
    expect(state.model).toBe(PREVIOUS);
    expect(state.problem?.kind).toBe("syntax");
    expect(state.problem?.message.length).toBeGreaterThan(0);
  });

  it("keeps the last model when the JSON is not a model the form can show, and says why", () => {
    for (const text of ["[]", "3", "null", "{}", '{"dimensions": 5}', '{"dimensions": [], "rules": {}}']) {
      const state = stateFromText(text, BEFORE);

      expect(state.model).toBe(PREVIOUS);
      expect(state.text).toBe(text);
      expect(state.problem?.kind).toBe("shape");
    }
  });

  it("shows JSON that is a displayable model even if the library would refuse it", () => {
    const text = '{"dimensions":[{"kind":"computed","name":"x"}],"extra":1}';

    expect(stateFromText(text, BEFORE).problem).toBeUndefined();
    expect(stateFromText(text, BEFORE).model).toEqual({ dimensions: [{ kind: "computed", name: "x" }], extra: 1 });
  });

  it("recovers: text that becomes valid shows the new model and clears the problem", () => {
    const broken = stateFromText("{", BEFORE);
    const fixed = stateFromText('{"dimensions":[]}', broken);

    expect(fixed.problem).toBeUndefined();
    expect(fixed.model).toEqual({ dimensions: [] });
  });
});

const SWITCH_MODEL: JsonObject = { dimensions: [{ kind: "choice", name: "d", values: ["linux", "macos"] }] };
const FIRST = ["dimensions", 0, "values", 0] as const;
const SECOND = ["dimensions", 0, "values", 1] as const;
const PAST_THE_END = 2;
const OUTSIDE = ["dimensions", 0, "values", PAST_THE_END] as const;

/** The state after the value at a path is switched to another type. */
function switched(state: ReturnType<typeof stateFromModel>, path: readonly (string | number)[], from: string, to: "text" | "number"): ReturnType<typeof stateFromModel> {
  return stateAfterSwitch(state, nodeSwitch({ path, vocabulary: "json", from, to, convert: (current) => convertJson(current, to), slots: noSlots }));
}

describe("stateAfterSwitch", () => {
  it("changes the model and its text, and remembers what the item was", () => {
    const away = switched(stateFromModel(SWITCH_MODEL), FIRST, "text", "number");

    expect(away.model).toEqual({ dimensions: [{ kind: "choice", name: "d", values: [0, "macos"] }] });
    expect(JSON.parse(away.text)).toEqual(away.model);
    expect(away.text).not.toContain("linux");
    expect(away.memory.size).toBe(1);
  });

  it("gives the item back on the switch back", () => {
    const back = switched(switched(stateFromModel(SWITCH_MODEL), FIRST, "text", "number"), FIRST, "number", "text");

    expect(back.model).toEqual(SWITCH_MODEL);
    expect(back.text).toBe(stateFromModel(SWITCH_MODEL).text);
  });

  it("throws for a path that leads nowhere in the model", () => {
    expect(() => switched(stateFromModel(SWITCH_MODEL), OUTSIDE, "text", "number")).toThrow("no node at");
  });
});

describe("stateAfterEdit", () => {
  const away = switched(stateFromModel(SWITCH_MODEL), FIRST, "text", "number");
  const ruleOut = (model: JsonObject): JsonObject => ({ ...model, extra: 1 });

  it("forgets everything unless it says which paths it left alone", () => {
    expect(stateAfterEdit(away, ruleOut).memory.size).toBe(0);
    expect(stateAfterEdit(away, ruleOut, "everything").memory.size).toBe(0);
  });

  it("keeps the memory for an edit that moves nothing", () => {
    expect(stateAfterEdit(away, ruleOut, "nothing").memory).toBe(away.memory);
  });

  it("forgets what is inside a reshaped list and keeps the rest", () => {
    const both = switched(away, SECOND, "text", "number");

    expect(stateAfterEdit(both, ruleOut, { inside: ["dimensions", 0, "values"] }).memory.size).toBe(0);
    expect(stateAfterEdit(both, ruleOut, { inside: ["dimensions", 1] }).memory.size).toBe(2);
    expect(stateAfterEdit(both, ruleOut, { within: SECOND }).memory.size).toBe(1);
  });
});

describe("a model replaced by text", () => {
  const away = switched(stateFromModel(SWITCH_MODEL), FIRST, "text", "number");

  it("starts with nothing remembered", () => {
    expect(stateFromText(JSON.stringify(SWITCH_MODEL), away).memory.size).toBe(0);
  });

  it("keeps what is remembered while the text cannot be shown, because the model is not replaced", () => {
    expect(stateFromText("{", away).memory).toBe(away.memory);
    expect(stateFromText("[]", away).memory).toBe(away.memory);
  });
});

describe("stateFromModel", () => {
  it("takes the memory it is given, and has none otherwise", () => {
    const away = switched(stateFromModel(SWITCH_MODEL), FIRST, "text", "number");

    expect(stateFromModel(away.model, away.memory).memory).toBe(away.memory);
    expect(stateFromModel(away.model).memory).toBe(NO_MEMORY);
    expect(emptyState().memory).toBe(NO_MEMORY);
  });
});
