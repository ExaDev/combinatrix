import type { Json, JsonObject } from "./json";
import { getIn, isJsonObject, parseJson } from "./json";
import { displayProblem, EMPTY_MODEL, setNode } from "./modelEdit";
import type { Memory, Place } from "./typeMemory";
import { forgetInside, forgetWithin, NO_MEMORY, switchVariant } from "./typeMemory";

/** The spaces a model is indented by when the form writes it. */
const INDENT = 2;

/** Why the JSON text is not what the form shows: it is not JSON, or it is JSON the form cannot show as a model. */
export interface TextProblem {
  readonly kind: "syntax" | "shape";
  readonly message: string;
}

/**
 * The model and the JSON text it is shown as. `model` is always one the form can show: while the text has a problem it is the last model that was fine, so the form never goes blank, and `text` is exactly what the user typed, so no text is lost.
 *
 * `memory` is what the editor remembers of the items whose type the user has switched (see `typeMemory`). It belongs to the loaded model: every way of replacing the model wholesale starts it empty, and it is never part of the model or its text.
 */
export interface EditorState {
  readonly text: string;
  readonly model: JsonObject;
  readonly problem: TextProblem | undefined;
  readonly memory: Memory;
}

/** The state after the form edits a model: its text is the model written out. The memory is the one given, which is empty for a model nobody has switched anything in. */
export function stateFromModel(model: JsonObject, memory: Memory = NO_MEMORY): EditorState {
  return { text: JSON.stringify(model, null, INDENT), model, problem: undefined, memory };
}

/** The state for a model nobody has edited yet. */
export function emptyState(): EditorState {
  return stateFromModel(EMPTY_MODEL);
}

/** The state after the text is replaced, whether by typing or by loading a model. `previous` is the state to keep showing when the text cannot be shown. A text that is a model the form can show replaces the model, so nothing is remembered of the one before it. */
export function stateFromText(text: string, previous: EditorState): EditorState {
  let parsed;
  try {
    parsed = parseJson(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;

    return { text, model: previous.model, problem: { kind: "syntax", message: error.message }, memory: previous.memory };
  }

  const problem = displayProblem(parsed);
  if (problem !== undefined || !isJsonObject(parsed)) return { text, model: previous.model, problem: { kind: "shape", message: problem ?? "the top level is not an object" }, memory: previous.memory };

  return { text, model: parsed, problem: undefined, memory: NO_MEMORY };
}

/**
 * Which paths of the model an edit may have changed the meaning of, and so which remembered parts it makes out of date. Leaving it out says "everything", which is always safe.
 * - `nothing`: no path that was there names a different item, as when an item is added at the end or a value is typed.
 * - `inside`: the items inside the one at the path were moved, removed or renamed; the item itself is where it was.
 * - `within`: the item at the path was removed, with everything inside it.
 */
export type Reshaped = "everything" | "nothing" | { readonly inside: Place } | { readonly within: Place };

function memoryAfter(memory: Memory, reshaped: Reshaped): Memory {
  if (reshaped === "everything") return NO_MEMORY;
  if (reshaped === "nothing") return memory;

  return "inside" in reshaped ? forgetInside(memory, reshaped.inside) : forgetWithin(memory, reshaped.within);
}

/** The state after an edit of the model. */
export function stateAfterEdit(state: EditorState, change: (model: JsonObject) => JsonObject, reshaped: Reshaped = "everything"): EditorState {
  return stateFromModel(change(state.model), memoryAfter(state.memory, reshaped));
}

/**
 * An item switched from one variant to another, as the form asks for it: where the item is, the part of the model that varies with the variant and how to read and write it, and how to convert it for a variant the item has not been in. `from` and `to` are names from one vocabulary of variants (see `Switch`).
 */
export interface ItemSwitch {
  readonly place: Place;
  readonly from: string;
  readonly to: string;
  readonly read: (model: JsonObject) => Json;
  readonly write: (model: JsonObject, part: Json) => JsonObject;
  readonly convert: (current: Json) => Json;
  readonly inside: "kept" | "dropped";
}

/** The switch of the node at a path: the part that varies is the node. */
export function nodeSwitch(spec: { readonly path: Place; readonly from: string; readonly to: string; readonly convert: (current: Json) => Json }): ItemSwitch {
  const { path } = spec;

  return {
    place: path,
    from: spec.from,
    to: spec.to,
    read: (model) => {
      const node = getIn(model, path);
      if (node === undefined) throw new Error(`no node at ${path.join(".")}`);

      return node;
    },
    write: (model, part) => setNode(model, path, part),
    convert: spec.convert,
    inside: "kept",
  };
}

/** The state after an item is switched: the model has the part the item takes up, and the memory has the part it left. */
export function stateAfterSwitch(state: EditorState, spec: ItemSwitch): EditorState {
  const current = spec.read(state.model);
  const switched = switchVariant(state.memory, { place: spec.place, from: spec.from, to: spec.to, current, convert: () => spec.convert(current), inside: spec.inside });

  return stateFromModel(spec.write(state.model, switched.part), switched.memory);
}
