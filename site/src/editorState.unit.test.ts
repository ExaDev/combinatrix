import { describe, expect, it } from "vitest";

import { emptyState, stateFromModel, stateFromText } from "./editorState";
import type { JsonObject } from "./json";

const PREVIOUS: JsonObject = { dimensions: [{ kind: "choice", name: "kept", values: ["a"] }] };

describe("stateFromModel", () => {
  it("writes the model out as indented JSON that reads back as the same model", () => {
    const state = stateFromModel(PREVIOUS);

    expect(state.text).toContain('\n  "dimensions"');
    expect(JSON.parse(state.text)).toEqual(PREVIOUS);
    expect(state.problem).toBeUndefined();
  });

  it("starts empty with a model that has no dimensions", () => {
    expect(emptyState().model).toEqual({ dimensions: [] });
  });
});

describe("stateFromText", () => {
  it("shows the model the text holds", () => {
    const state = stateFromText('{"dimensions":[],"rules":[]}', PREVIOUS);

    expect(state).toEqual({ text: '{"dimensions":[],"rules":[]}', model: { dimensions: [], rules: [] }, problem: undefined });
  });

  it("keeps the last model and exactly the typed text when the text is not JSON", () => {
    const state = stateFromText('{"dimensions": [', PREVIOUS);

    expect(state.text).toBe('{"dimensions": [');
    expect(state.model).toBe(PREVIOUS);
    expect(state.problem?.kind).toBe("syntax");
    expect(state.problem?.message.length).toBeGreaterThan(0);
  });

  it("keeps the last model when the JSON is not a model the form can show, and says why", () => {
    for (const text of ["[]", "3", "null", "{}", '{"dimensions": 5}', '{"dimensions": [], "rules": {}}']) {
      const state = stateFromText(text, PREVIOUS);

      expect(state.model).toBe(PREVIOUS);
      expect(state.text).toBe(text);
      expect(state.problem?.kind).toBe("shape");
    }
  });

  it("shows JSON that is a displayable model even if the library would refuse it", () => {
    const text = '{"dimensions":[{"kind":"computed","name":"x"}],"extra":1}';

    expect(stateFromText(text, PREVIOUS).problem).toBeUndefined();
    expect(stateFromText(text, PREVIOUS).model).toEqual({ dimensions: [{ kind: "computed", name: "x" }], extra: 1 });
  });

  it("recovers: text that becomes valid shows the new model and clears the problem", () => {
    const broken = stateFromText("{", PREVIOUS);
    const fixed = stateFromText('{"dimensions":[]}', broken.model);

    expect(fixed.problem).toBeUndefined();
    expect(fixed.model).toEqual({ dimensions: [] });
  });
});
