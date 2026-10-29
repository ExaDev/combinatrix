import type { Choice } from "./dom";
import { button, h, textInput } from "./dom";
import type { ItemSwitch, Reshaped } from "./editorState";
import { nodeSwitch } from "./editorState";
import type { Direction, Json, JsonObject, JsonStep } from "./json";
import { parseJson } from "./json";
import { addListItem, moveListItem, removeListItem, setNode } from "./modelEdit";
import { parseNumber } from "./scalars";

/** What the page offers a drawn part of the form for editing the model. */
export interface TreeHost {
  /** Applies an edit and draws the form again, returning focus to the field named by `focus` when there is one, and telling a screen reader what happened. */
  readonly edit: (change: (model: JsonObject) => JsonObject, options?: EditOptions) => void;
  /** Applies an edit that changes no structure, so the form is not drawn again and a field being typed in keeps its caret. */
  readonly editQuietly: (change: (model: JsonObject) => JsonObject) => void;
  /** Switches an item to another variant of it, as an edit that draws the form again does, and remembers what the item was so a switch back gives it back. */
  readonly switchTo: (item: ItemSwitch, options?: SwitchOptions) => void;
}

export interface SwitchOptions {
  readonly focus?: string;
  readonly announce?: string;
}

export interface EditOptions extends SwitchOptions {
  /** Which paths the edit may have changed the meaning of. Left out, it is all of them, and nothing the editor remembers of the items whose type was switched survives the edit. */
  readonly reshapes?: Reshaped;
}

/** The dimension names a reference may pick, and where edits go. */
export interface TreeContext {
  readonly names: readonly string[];
  readonly host: TreeHost;
}

/** The controls of one item of a list in the model: where it is in it, and what it is called in the words of a screen reader. */
export interface ItemControls {
  readonly position: number;
  readonly count: number;
  readonly noun: string;
  readonly listPath: readonly JsonStep[];
}

/** Where a node is: its path in the model, a name for it in the form's own words, and what it can do as an item of a list. */
export interface NodeSpec {
  readonly path: readonly JsonStep[];
  readonly node: Json;
  readonly label: string;
  readonly item?: ItemControls;
}

/** A step of a path as it is written in a field id: the dot and the backslash are escaped, so no two paths make one id. */
function stepText(step: JsonStep): string {
  return typeof step === "number" ? String(step) : step.replaceAll("\\", "\\\\").replaceAll(".", "\\.");
}

/** The field id of a control of the thing at a path. It is the same on every draw, which is how focus finds its control again. */
export function fieldId(path: readonly JsonStep[], control: string): string {
  return `${path.map(stepText).join(".")}:${control}`;
}

export function choices<T extends string>(values: readonly T[], labels: Readonly<Record<T, string>>): Choice<T>[] {
  return values.map((value) => ({ value, label: labels[value] }));
}

export function childLabel(parent: string, child: string): string {
  return `${parent}, ${child}`;
}

/** One row of a list the user can reorder and remove from: where it is, how to move and remove it in the model, and where its controls are. */
export interface RowSpec {
  readonly noun: string;
  readonly position: number;
  readonly count: number;
  /** The path its field ids are made from, for the row at a position of the list, so focus can follow a row that moved. */
  readonly pathAt: (position: number) => readonly JsonStep[];
  /** The path of the list's own controls: its add button is where focus goes when a row is removed. */
  readonly listPath: readonly JsonStep[];
  readonly move: (model: JsonObject, direction: Direction) => JsonObject;
  readonly remove: (model: JsonObject) => JsonObject;
}

/** The row of an item of an array in the model. */
export function arrayRow(item: ItemControls): RowSpec {
  const { position, count, noun, listPath } = item;

  return { noun, position, count, listPath, pathAt: (at) => [...listPath, at], move: (model, direction) => moveListItem(model, listPath, position, direction), remove: (model) => removeListItem(model, listPath, position) };
}

/** Up, Down and Remove buttons for a row. Up is off at the first row and Down at the last, and after a move focus stays on the button that moved the row, unless the row has reached the end it was moving towards, and then goes to the other button. */
export function rowButtons(host: TreeHost, row: RowSpec): HTMLElement {
  const { noun, position, count, pathAt, listPath } = row;
  const last = count - 1;
  const field = (control: string): string => fieldId(pathAt(position), control);
  const move = (direction: Direction): void => {
    const target = direction === "earlier" ? position - 1 : position + 1;
    const keepsMoving = direction === "earlier" ? target > 0 : target < last;
    const control = (direction === "earlier") === keepsMoving ? "up" : "down";
    host.edit((model) => row.move(model, direction), { focus: fieldId(pathAt(target), control), announce: `Moved ${noun} ${direction === "earlier" ? "up" : "down"}.`, reshapes: { inside: listPath } });
  };

  return h(
    "span",
    { class: "item-buttons" },
    button({ field: field("up"), ariaLabel: `Move ${noun} up`, label: "Up", small: true, disabled: position === 0, onClick: () => { move("earlier"); } }),
    button({ field: field("down"), ariaLabel: `Move ${noun} down`, label: "Down", small: true, disabled: position === last, onClick: () => { move("later"); } }),
    button({
      field: field("remove"),
      ariaLabel: `Remove ${noun}`,
      label: "Remove",
      small: true,
      onClick: () => {
        host.edit(row.remove, { focus: fieldId(listPath, "add"), announce: `Removed ${noun}.`, reshapes: { inside: listPath } });
      },
    }),
  );
}

/**
 * Switches the node at a path from one variant to another, naming both as items of `vocabulary` (see `typeMemory`): the node becomes what it last was in the variant, if it was ever in it, and otherwise `convert` of what it is now.
 */
export function switchNode(host: TreeHost, spec: { readonly path: readonly JsonStep[]; readonly vocabulary: string; readonly from: string; readonly to: string; readonly convert: (current: Json) => Json; readonly announce: string }): void {
  const variant = (name: string): string => `${spec.vocabulary}:${name}`;
  host.switchTo(nodeSwitch({ path: spec.path, from: variant(spec.from), to: variant(spec.to), convert: spec.convert }), { announce: spec.announce });
}

/** A button that adds an item to the list at a path. */
export function addButton(host: TreeHost, spec: { readonly listPath: readonly JsonStep[]; readonly label: string; readonly ariaLabel: string; readonly item: () => Json }): HTMLButtonElement {
  return button({
    field: fieldId(spec.listPath, "add"),
    ariaLabel: spec.ariaLabel,
    label: spec.label,
    small: true,
    onClick: () => {
      host.edit((model) => addListItem(model, spec.listPath, spec.item()), { focus: fieldId(spec.listPath, "add"), announce: `${spec.ariaLabel}: added.`, reshapes: "nothing" });
    },
  });
}

/** A text box for a number. It commits only what states a finite number and says so when what is typed does not; on leaving the field it returns to the last number committed. */
export function numberInput(host: TreeHost, spec: { readonly path: readonly JsonStep[]; readonly control: string; readonly ariaLabel: string; readonly value: number }): HTMLElement {
  const problem = h("span", { class: "field-problem", role: "status" });
  let committed = spec.value;
  const input = textInput({
    field: fieldId(spec.path, spec.control),
    ariaLabel: spec.ariaLabel,
    value: String(spec.value),
    numeric: true,
    onInput: (text, element) => {
      const parsed = parseNumber(text);
      element.setAttribute("aria-invalid", parsed === undefined ? "true" : "false");
      problem.textContent = parsed === undefined ? "Not a finite number; the model keeps the last number." : "";
      if (parsed === undefined) return;

      committed = parsed;
      host.editQuietly((model) => setNode(model, spec.path, parsed));
    },
    onCommit: (element) => {
      element.setAttribute("aria-invalid", "false");
      problem.textContent = "";

      return String(committed);
    },
  });

  return h("span", { class: "field-with-problem" }, input, problem);
}

/** A text box whose text is the model's at a path as it is typed. */
export function textField(host: TreeHost, spec: { readonly path: readonly JsonStep[]; readonly ariaLabel: string; readonly value: string; readonly control: string }): HTMLInputElement {
  return textInput({
    field: fieldId(spec.path, spec.control),
    ariaLabel: spec.ariaLabel,
    value: spec.value,
    onInput: (text) => {
      host.editQuietly((model) => setNode(model, spec.path, text));
    },
  });
}

/** How many rows a raw JSON box shows before it scrolls. */
const RAW_ROWS = 4;

/** Raw JSON for data that is not what the schema accepts: editable as text, and kept by the model whenever the text is JSON. */
export function rawJson(host: TreeHost, spec: { readonly path: readonly JsonStep[]; readonly value: Json; readonly ariaLabel: string }): HTMLElement {
  const problem = h("span", { class: "field-problem", role: "status" });
  const area = h("textarea", { rows: String(RAW_ROWS), spellcheck: "false", "data-field": fieldId(spec.path, "raw"), "aria-label": spec.ariaLabel, class: "raw-json" });
  area.value = JSON.stringify(spec.value, null, 2);
  area.addEventListener("input", () => {
    try {
      const parsed = parseJson(area.value);
      problem.textContent = "";
      area.setAttribute("aria-invalid", "false");
      host.editQuietly((model) => setNode(model, spec.path, parsed));
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      area.setAttribute("aria-invalid", "true");
      problem.textContent = `Not JSON (${error.message}); the model keeps the last JSON.`;
    }
  });

  return h("div", { class: "raw" }, area, problem);
}
