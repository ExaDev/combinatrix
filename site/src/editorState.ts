import type { JsonObject } from "./json";
import { isJsonObject, parseJson } from "./json";
import { displayProblem, EMPTY_MODEL } from "./modelEdit";

/** The spaces a model is indented by when the form writes it. */
const INDENT = 2;

/** Why the JSON text is not what the form shows: it is not JSON, or it is JSON the form cannot show as a model. */
export interface TextProblem {
  readonly kind: "syntax" | "shape";
  readonly message: string;
}

/**
 * The model and the JSON text it is shown as. `model` is always one the form can show: while the text has a problem it is the last model that was fine, so the form never goes blank, and `text` is exactly what the user typed, so no text is lost.
 */
export interface EditorState {
  readonly text: string;
  readonly model: JsonObject;
  readonly problem: TextProblem | undefined;
}

/** The state after the form edits a model: its text is the model written out. */
export function stateFromModel(model: JsonObject): EditorState {
  return { text: JSON.stringify(model, null, INDENT), model, problem: undefined };
}

/** The state for a model nobody has edited yet. */
export function emptyState(): EditorState {
  return stateFromModel(EMPTY_MODEL);
}

/** The state after the text is replaced, whether by typing or by loading a model. `previous` is the model to keep showing when the text cannot be shown. */
export function stateFromText(text: string, previous: JsonObject): EditorState {
  let parsed;
  try {
    parsed = parseJson(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;

    return { text, model: previous, problem: { kind: "syntax", message: error.message } };
  }

  const problem = displayProblem(parsed);
  if (problem !== undefined || !isJsonObject(parsed)) return { text, model: previous, problem: { kind: "shape", message: problem ?? "the top level is not an object" } };

  return { text, model: parsed, problem: undefined };
}
