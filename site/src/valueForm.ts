import type { Choice } from "./dom";
import { button, h, select, textInput } from "./dom";
import { keysOf, unreachable } from "./exhaustive";
import type { Json, JsonObject, JsonStep, JsonType } from "./json";
import { isJsonArray, isJsonObject, jsonTypeOf } from "./json";
import { addKey, convertJson, moveKey, removeKey, renameKeyAt, setNode, uniqueName } from "./modelEdit";
import type { RowSpec, TreeHost } from "./controls";
import { addButton, arrayRow, childLabel, choices, fieldId, numberInput, rowButtons, switchNode, textField } from "./controls";
import { noSlots } from "./typeMemory";

/** How each type of JSON value is named in the menu that chooses it. */
const JSON_TYPE_LABELS: Readonly<Record<JsonType, string>> = {
  text: "text",
  number: "number",
  boolean: "true or false",
  null: "null",
  list: "list",
  object: "object",
};

const JSON_TYPE_CHOICES = choices(keysOf(JSON_TYPE_LABELS), JSON_TYPE_LABELS);

/** The vocabulary of variants a JSON value switches between: its types. A value of a dimension's domain switches between the same ones. */
export const JSON_VOCABULARY = "json";

const BOOLEAN_CHOICES: readonly Choice<"true" | "false">[] = [
  { value: "true", label: "true" },
  { value: "false", label: "false" },
];

/** What a new entry of an object, or a new symbol of a unit, is called until it is renamed. */
const NEW_KEY = "key";
const NEW_SYMBOL = "symbol";

/** The exponent a new symbol of a unit starts with. */
const DEFAULT_EXPONENT = 1;

/** Where a value is and what it is called; a value that is an item of a list or an entry of an object also has its row's buttons. */
export interface ValueSpec {
  readonly path: readonly JsonStep[];
  readonly value: Json;
  readonly label: string;
  readonly row?: RowSpec;
}

/** What draws the value of one entry of an object. */
type EntryEditor = (host: TreeHost, spec: ValueSpec) => HTMLElement;

/** The editor of an object's entries: a row for each, with its key, its value, and buttons to move and remove it, and a button that adds one. */
function entriesEditor(host: TreeHost, spec: { readonly path: readonly JsonStep[]; readonly object: JsonObject; readonly label: string; readonly newKey: string; readonly newValue: Json; readonly addLabel: string; readonly entry: EntryEditor }): HTMLElement {
  const { path, object, label } = spec;
  const keys = Object.keys(object);
  const rows = keys.map((key, position) => {
    const entryPath = [...path, key];
    const noun = childLabel(label, `entry ${String(position + 1)}`);
    const row: RowSpec = {
      noun,
      position,
      count: keys.length,
      listPath: path,
      // An entry's field ids are made from its key, which a move does not change.
      pathAt: () => entryPath,
      move: (model, direction) => moveKey(model, path, key, direction),
      remove: (model) => removeKey(model, path, key),
    };
    const problem = h("span", { class: "field-problem", role: "status" });
    const name = textInput({
      field: fieldId(entryPath, "key"),
      ariaLabel: childLabel(noun, "key"),
      value: key,
      onInput: () => undefined,
      onCommit: (element) => {
        const next = element.value;
        if (next === key) return undefined;
        if (Object.hasOwn(object, next)) {
          element.setAttribute("aria-invalid", "true");
          problem.textContent = `The key ${JSON.stringify(next)} is already used by another entry.`;

          return key;
        }
        host.edit((model) => renameKeyAt(model, path, key, next), { focus: fieldId([...path, next], "key"), announce: `Renamed the key ${key} to ${next}.`, reshapes: { inside: path } });

        return undefined;
      },
    });
    const value = object[key];
    if (value === undefined) throw new Error(`unreachable: ${key} is a key of the object`);

    return h("li", { class: "entry" }, h("span", { class: "field-with-problem" }, name, problem), spec.entry(host, { path: entryPath, value, label: noun }), rowButtons(host, row));
  });
  const add = button({
    field: fieldId(path, "add"),
    ariaLabel: childLabel(label, spec.addLabel),
    label: spec.addLabel,
    small: true,
    onClick: () => {
      host.edit((model) => addKey(model, path, uniqueName(keys, spec.newKey), spec.newValue), { focus: fieldId(path, "add"), announce: `${childLabel(label, spec.addLabel)}: added.`, reshapes: "nothing" });
    },
  });

  return h("div", { class: "entries" }, rows.length === 0 ? h("p", { class: "muted" }, "No entries.") : h("ul", { class: "entry-list" }, ...rows), add);
}

/** A number the model holds at a path, as a labelled field of one entry. */
function exponentEntry(host: TreeHost, spec: ValueSpec): HTMLElement {
  if (typeof spec.value !== "number") throw new Error("unreachable: a unit's exponents were checked to be numbers");

  return numberInput(host, { path: spec.path, control: "exponent", ariaLabel: childLabel(spec.label, "exponent"), value: spec.value });
}

/** The unit of a number, complex number or reference: absent, or a symbol for each dimension of measure with its exponent. `path` is the node's, whose `unit` key this adds and removes. */
export function unitEditor(host: TreeHost, spec: { readonly path: readonly JsonStep[]; readonly unit: JsonObject | undefined; readonly label: string }): HTMLElement {
  const unitPath = [...spec.path, "unit"];
  const label = childLabel(spec.label, "unit");
  if (spec.unit === undefined) {
    return h(
      "div",
      { class: "optional" },
      button({
        field: fieldId(unitPath, "add"),
        ariaLabel: `${label}: add a unit`,
        label: "Add a unit",
        small: true,
        onClick: () => {
          host.edit((model) => addKey(model, spec.path, "unit", {}), { focus: fieldId(unitPath, "add"), announce: `Added a unit to ${spec.label}.`, reshapes: "nothing" });
        },
      }),
    );
  }

  return h(
    "div",
    { class: "optional" },
    h(
      "div",
      { class: "optional-head" },
      h("strong", {}, "Unit"),
      button({
        field: fieldId(unitPath, "remove-unit"),
        ariaLabel: `${label}: remove the unit`,
        label: "Remove the unit",
        small: true,
        onClick: () => {
          host.edit((model) => removeKey(model, spec.path, "unit"), { focus: fieldId(unitPath, "add"), announce: `Removed the unit of ${spec.label}.`, reshapes: { within: unitPath } });
        },
      }),
    ),
    entriesEditor(host, { path: unitPath, object: spec.unit, label, newKey: NEW_SYMBOL, newValue: DEFAULT_EXPONENT, addLabel: "Add a symbol", entry: exponentEntry }),
  );
}

/** The editor of any JSON value, as one trilean fields hold for a collection, a key, a table or a payload: a menu of its type and what that type needs, nested to any depth. */
export function jsonValueEditor(host: TreeHost, spec: ValueSpec): HTMLElement {
  const { path, value, label } = spec;
  const type = jsonTypeOf(value);
  const typeMenu = select({
    field: fieldId(path, "type"),
    ariaLabel: childLabel(label, "type"),
    choices: JSON_TYPE_CHOICES,
    selected: type,
    onChange: (next) => {
      switchNode(host, { path, vocabulary: JSON_VOCABULARY, from: type, to: next, convert: (current) => convertJson(current, next), slots: noSlots, announce: `${label} is now ${JSON_TYPE_LABELS[next]}.` });
    },
  });
  const buttons = spec.row === undefined ? undefined : rowButtons(host, spec.row);
  const head = (...controls: readonly (HTMLElement | undefined)[]): HTMLElement => h("div", { class: "node-head" }, typeMenu, ...controls, buttons);
  switch (type) {
    case "text":
      return h("div", { class: "json-value" }, head(typeof value === "string" ? textField(host, { path, ariaLabel: childLabel(label, "text"), value, control: "value" }) : undefined));
    case "number":
      return h("div", { class: "json-value" }, head(typeof value === "number" ? numberInput(host, { path, control: "value", ariaLabel: childLabel(label, "number"), value }) : undefined));
    case "boolean":
      return h(
        "div",
        { class: "json-value" },
        head(
          select({
            field: fieldId(path, "value"),
            ariaLabel: childLabel(label, "value"),
            choices: BOOLEAN_CHOICES,
            selected: value === true ? "true" : "false",
            onChange: (next) => {
              host.editQuietly((model) => setNode(model, path, next === "true"));
            },
          }),
        ),
      );
    case "null":
      return h("div", { class: "json-value" }, head(h("span", { class: "muted" }, "null")));
    case "list": {
      if (!isJsonArray(value)) throw new Error("unreachable: a list is an array");
      const items = value.map((item, position) => h("li", {}, jsonValueEditor(host, { path: [...path, position], value: item, label: childLabel(label, `item ${String(position + 1)}`), row: arrayRow({ position, count: value.length, noun: childLabel(label, `item ${String(position + 1)}`), listPath: path }) })));
      const add = addButton(host, { listPath: path, label: "Add an item", ariaLabel: childLabel(label, "add an item"), item: () => "" });

      return h("div", { class: "json-value" }, head(), h("div", { class: "node-children" }, items.length === 0 ? h("p", { class: "muted" }, "An empty list.") : h("ol", { class: "entry-list" }, ...items), add));
    }
    case "object": {
      if (!isJsonObject(value) || isJsonArray(value)) throw new Error("unreachable: an object is a plain object");

      return h("div", { class: "json-value" }, head(), h("div", { class: "node-children" }, entriesEditor(host, { path, object: value, label, newKey: NEW_KEY, newValue: "", addLabel: "Add an entry", entry: jsonValueEditor })));
    }
    default:
      return unreachable(type);
  }
}
