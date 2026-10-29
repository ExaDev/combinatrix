import type { Scalar } from "combinatrix";

import type { Choice } from "./dom";
import { button, h, labelled, select, textInput } from "./dom";
import type { Json, JsonObject, JsonStep } from "./json";
import type { DimensionKind, DimensionView, RuleForm, RuleScope, RuleView, ScalarType } from "./modelEdit";
import {
  addDimension,
  addRule,
  addValue,
  convertScalar,
  DIMENSION_KIND_LABELS,
  DIMENSION_KINDS,
  dimensionNames,
  moveDimension,
  moveRule,
  moveValue,
  newPredicate,
  parseNumber,
  removeDimension,
  removeRule,
  removeValue,
  renameDimension,
  RULE_FORM_LABELS,
  RULE_FORMS,
  scalarType,
  SCALAR_TYPE_LABELS,
  SCALAR_TYPES,
  setActiveWhen,
  setDimensionKind,
  setRuleForm,
  setRuleName,
  setRuleScope,
  setValue,
  viewOfModel,
} from "./modelEdit";
import type { ItemControls, TreeContext, TreeHost } from "./treeForm";
import { choices, fieldId, predicateNode, rawJson } from "./treeForm";

/** What the page offers the form for editing the model. */
export type FormHost = TreeHost;

const DIMENSION_CHOICES = choices(DIMENSION_KINDS, DIMENSION_KIND_LABELS);
const RULE_FORM_CHOICES = choices(RULE_FORMS, RULE_FORM_LABELS);
const SCALAR_TYPE_CHOICES = choices(SCALAR_TYPES, SCALAR_TYPE_LABELS);
const BOOLEAN_CHOICES: readonly Choice<"true" | "false">[] = [
  { value: "true", label: "true" },
  { value: "false", label: "false" },
];

const DIMENSIONS = "dimensions";
const RULES = "rules";

/** The buttons that move a card in its list and remove it. */
function cardButtons(host: FormHost, spec: ItemControls & { readonly move: (model: JsonObject, direction: "earlier" | "later") => JsonObject; readonly remove: (model: JsonObject) => JsonObject }): HTMLElement {
  const { position, count, noun, listPath } = spec;
  const last = count - 1;
  const field = (control: string): string => fieldId([...listPath, position], control);
  const move = (direction: "earlier" | "later"): void => {
    const target = direction === "earlier" ? position - 1 : position + 1;
    const keepsMoving = direction === "earlier" ? target > 0 : target < last;
    // The moved card is at `target` now. Focus stays on the button that moved it, unless that button is disabled at the end the card has reached, and then goes to the other one.
    const control = (direction === "earlier") === keepsMoving ? "up" : "down";
    host.edit((model) => spec.move(model, direction), { focus: fieldId([...listPath, target], control), announce: `Moved ${noun} ${direction === "earlier" ? "up" : "down"}.` });
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
        host.edit(spec.remove, { focus: fieldId(listPath, "add"), announce: `Removed ${noun}.` });
      },
    }),
  );
}

/** A value of a dimension's domain: a type menu, the value, and its buttons. */
function valueRow(host: FormHost, spec: { readonly index: number; readonly name: string; readonly position: number; readonly values: readonly Scalar[]; readonly domainKey: string }): HTMLElement {
  const { index, name, position, values, domainKey } = spec;
  const value = values[position];
  if (value === undefined) throw new Error(`unreachable: position ${String(position)} is within the domain`);
  const label = `${name}, value ${String(position + 1)}`;
  const path = [DIMENSIONS, index, domainKey, position];
  const type = scalarType(value);
  const typeSelect = select({
    field: fieldId(path, "type"),
    ariaLabel: `${label}, type`,
    choices: SCALAR_TYPE_CHOICES,
    selected: type,
    onChange: (next: ScalarType) => {
      host.edit((model) => setValue(model, index, position, convertScalar(value, next)));
    },
  });

  return h("li", { class: "value-row" }, typeSelect, valueControl(host, { index, position, value, label, field: fieldId(path, "value") }));
}

function valueControl(host: FormHost, spec: { readonly index: number; readonly position: number; readonly value: Scalar; readonly label: string; readonly field: string }): HTMLElement {
  const { index, position, value, label, field } = spec;
  const set = (next: Scalar): void => {
    host.editQuietly((model) => setValue(model, index, position, next));
  };
  if (value === null) return h("span", { class: "muted" }, "null");
  if (typeof value === "boolean") return select({ field, ariaLabel: label, choices: BOOLEAN_CHOICES, selected: value ? "true" : "false", onChange: (next) => { set(next === "true"); } });

  const isNumber = typeof value === "number";
  const problem = h("span", { class: "field-problem", role: "status" });
  let committed = value;
  const input = textInput({
    field,
    ariaLabel: label,
    value: String(value),
    numeric: isNumber,
    onInput: (text, element) => {
      if (!isNumber) {
        set(text);

        return;
      }
      const parsed = parseNumber(text);
      element.setAttribute("aria-invalid", parsed === undefined ? "true" : "false");
      problem.textContent = parsed === undefined ? "Not a finite number; the model keeps the last number." : "";
      if (parsed === undefined) return;

      committed = parsed;
      set(parsed);
    },
    onCommit: (element) => {
      element.setAttribute("aria-invalid", "false");
      problem.textContent = "";

      return String(committed);
    },
  });

  return h("span", { class: "field-with-problem" }, input, problem);
}

/** The condition that makes a part of the model apply, which may be absent: a button that adds one, or the condition with a button that removes it. */
function optionalCondition(ctx: TreeContext, spec: { readonly path: readonly JsonStep[]; readonly node: Json | undefined; readonly label: string; readonly heading: string; readonly addLabel: string; readonly removeLabel: string; readonly set: (model: JsonObject, node: Json | undefined) => JsonObject }): HTMLElement {
  const { path, node, label } = spec;
  if (node === undefined) {
    return h(
      "div",
      { class: "optional" },
      button({
        field: fieldId(path, "add"),
        ariaLabel: `${label}: ${spec.addLabel}`,
        label: spec.addLabel,
        small: true,
        onClick: () => {
          ctx.host.edit((model) => spec.set(model, newPredicate(model, "exists")), { focus: fieldId(path, "kind"), announce: `Added the condition: ${label}.` });
        },
      }),
    );
  }

  return h(
    "div",
    { class: "optional" },
    h("div", { class: "optional-head" }, h("strong", {}, spec.heading), button({ field: fieldId(path, "remove-condition"), ariaLabel: `${label}: ${spec.removeLabel}`, label: spec.removeLabel, small: true, onClick: () => { ctx.host.edit((model) => spec.set(model, undefined), { focus: fieldId(path, "add"), announce: `Removed the condition: ${label}.` }); } })),
    predicateNode(ctx, { path, node, label }),
  );
}

function dimensionCard(ctx: TreeContext, spec: { readonly index: number; readonly count: number; readonly view: DimensionView }): HTMLElement {
  const { host } = ctx;
  const { index, count, view } = spec;
  const noun = `dimension ${String(index + 1)}, ${view.name}`;
  const path = [DIMENSIONS, index];
  const domainKey = view.dimensionKind === "choice" ? "values" : "candidates";
  const valuesPath = [...path, domainKey];
  const name = textInput({
    field: fieldId(path, "name"),
    ariaLabel: `${noun}, name`,
    value: view.name,
    onInput: () => undefined,
    onCommit: (element) => {
      if (element.value === view.name) return undefined;
      host.edit((model) => renameDimension(model, index, element.value), { focus: fieldId(path, "name"), announce: `Renamed ${view.name} to ${element.value}.` });

      return undefined;
    },
  });
  const kind = select({
    field: fieldId(path, "kind"),
    ariaLabel: `${noun}, kind`,
    choices: DIMENSION_CHOICES,
    selected: view.dimensionKind,
    onChange: (next: DimensionKind) => {
      host.edit((model) => setDimensionKind(model, index, next), { announce: `${view.name} is now a ${DIMENSION_KIND_LABELS[next]} dimension.` });
    },
  });
  const rows = view.values.map((_, position) => {
    const row = valueRow(host, { index, name: view.name, position, values: view.values, domainKey });
    row.append(
      cardButtons(host, {
        position,
        count: view.values.length,
        noun: `${noun}, value ${String(position + 1)}`,
        listPath: valuesPath,
        move: (model, direction) => moveValue(model, index, position, direction),
        remove: (model) => removeValue(model, index, position),
      }),
    );

    return row;
  });
  const addValueButton = button({
    field: fieldId(valuesPath, "add"),
    ariaLabel: `${noun}, add a value`,
    label: "Add a value",
    small: true,
    onClick: () => {
      host.edit((model) => addValue(model, index), { focus: fieldId(valuesPath, "add"), announce: `Added a value to ${view.name}.` });
    },
  });
  const heading = h("h4", {}, `Dimension ${String(index + 1)}: `, h("span", { class: "mono" }, view.name));

  return h(
    "li",
    { class: "card" },
    h("div", { class: "card-head" }, heading, cardButtons(host, { position: index, count, noun, listPath: [DIMENSIONS], move: (model, direction) => moveDimension(model, index, direction), remove: (model) => removeDimension(model, index) })),
    h("div", { class: "grid" }, labelled("Name", name), labelled("Kind", kind)),
    h("fieldset", {}, h("legend", {}, view.dimensionKind === "choice" ? "Values, in the order they are enumerated" : "Candidates, in the order they are tried"), h("ol", { class: "values" }, ...rows), addValueButton),
    optionalCondition(ctx, {
      path: [...path, "activeWhen"],
      node: view.activeWhen,
      label: `${noun}, active only when`,
      heading: "Active only when",
      addLabel: "Only active when a condition holds",
      removeLabel: "Always active",
      set: (model, node) => setActiveWhen(model, index, node),
    }),
    view.activeWhen === undefined ? undefined : h("p", { class: "hint" }, "Where the condition does not hold, this dimension is unset."),
  );
}

function rawCard(ctx: TreeContext, spec: { readonly part: typeof DIMENSIONS | typeof RULES; readonly index: number; readonly count: number; readonly json: Json }): HTMLElement {
  const { part, index, count, json } = spec;
  const noun = `${part === DIMENSIONS ? "dimension" : "rule"} ${String(index + 1)}`;
  const move = part === DIMENSIONS ? moveDimension : moveRule;
  const remove = part === DIMENSIONS ? removeDimension : removeRule;

  return h(
    "li",
    { class: "card" },
    h("div", { class: "card-head" }, h("h4", {}, `${part === DIMENSIONS ? "Dimension" : "Rule"} ${String(index + 1)} (kept as JSON)`), cardButtons(ctx.host, { position: index, count, noun, listPath: [part], move: (model, direction) => move(model, index, direction), remove: (model) => remove(model, index) })),
    h("p", { class: "hint" }, "The form has no controls for this. It is kept exactly as written; edit it here or in the JSON view."),
    rawJson(ctx, { path: [part, index], value: json, ariaLabel: `${noun}, JSON` }),
  );
}

function ruleCard(ctx: TreeContext, spec: { readonly index: number; readonly count: number; readonly view: RuleView }): HTMLElement {
  const { host } = ctx;
  const { index, count, view } = spec;
  const noun = `rule ${String(index + 1)}${view.name === undefined || view.name === "" ? "" : `, ${view.name}`}`;
  const path = [RULES, index];
  const { body } = view;
  const form = select({
    field: fieldId(path, "form"),
    ariaLabel: `${noun}, what it states`,
    choices: RULE_FORM_CHOICES,
    selected: body.form,
    onChange: (next: RuleForm) => {
      host.edit((model) => setRuleForm(model, index, next), { announce: `Rule ${String(index + 1)} now ${next}.` });
    },
  });
  const name = textInput({
    field: fieldId(path, "name"),
    ariaLabel: `${noun}, label`,
    value: view.name ?? "",
    onInput: (text) => {
      host.editQuietly((model) => setRuleName(model, index, text === "" ? undefined : text));
    },
  });
  const condition = (step: string | number, label: string, node: Json): HTMLElement => h("div", { class: "optional" }, h("div", { class: "optional-head" }, h("strong", {}, label)), predicateNode(ctx, { path: [...path, body.form, ...(step === "" ? [] : [step])], node, label: `${noun}, ${label}` }));
  const stated = body.form === "implies" ? [condition(0, "if this holds", body.antecedent), condition(1, "then this must hold", body.consequent)] : [condition("", body.form === "requires" ? "every combination must satisfy" : "no combination may satisfy", body.condition)];
  const scope = (key: RuleScope, node: Json | undefined, labels: { readonly heading: string; readonly add: string; readonly remove: string }): HTMLElement =>
    optionalCondition(ctx, { path: [...path, key], node, label: `${noun}, ${labels.heading.toLowerCase()}`, heading: labels.heading, addLabel: labels.add, removeLabel: labels.remove, set: (model, next) => setRuleScope(model, index, key, next) });

  return h(
    "li",
    { class: "card" },
    h("div", { class: "card-head" }, h("h4", {}, `Rule ${String(index + 1)}`), cardButtons(host, { position: index, count, noun, listPath: [RULES], move: (model, direction) => moveRule(model, index, direction), remove: (model) => removeRule(model, index) })),
    h("div", { class: "grid" }, labelled("Label (optional)", name), labelled("States", form)),
    ...stated,
    scope("when", view.when, { heading: "Applies only when", add: "Apply only when a condition holds", remove: "Always apply" }),
    scope("unless", view.unless, { heading: "Does not apply when", add: "Do not apply when a condition holds", remove: "No exception" }),
  );
}

/** Draws the model as a form: a card for each dimension and each rule, and the controls to add more. */
export class ModelForm {
  readonly #container: HTMLElement;

  readonly #host: FormHost;

  constructor(container: HTMLElement, host: FormHost) {
    this.#container = container;
    this.#host = host;
  }

  /** Draws the model, replacing what was drawn. Focus goes to the field named by `focus`; without one it returns to the field that had it, if that field is still drawn and focus was inside the form. */
  render(model: JsonObject, focus?: string): void {
    const active = document.activeElement;
    const inside = active instanceof HTMLElement && this.#container.contains(active);
    const previous = inside ? active.dataset["field"] : undefined;
    const selection = inside && active instanceof HTMLInputElement ? { start: active.selectionStart, end: active.selectionEnd } : undefined;

    this.#container.replaceChildren(...this.#draw(model));

    const wanted = focus ?? previous;
    if (wanted === undefined || (focus === undefined && !inside)) return;
    const target = [...this.#container.querySelectorAll<HTMLElement>("[data-field]")].find((candidate) => candidate.dataset["field"] === wanted);
    if (target === undefined) return;

    target.focus();
    if (selection !== undefined && target instanceof HTMLInputElement && wanted === previous) target.setSelectionRange(selection.start, selection.end);
  }

  #draw(model: JsonObject): HTMLElement[] {
    const view = viewOfModel(model);
    const ctx: TreeContext = { names: dimensionNames(model), host: this.#host };
    const dimensions = view.dimensions.map((dimension, index) => (dimension.kind === "raw" ? rawCard(ctx, { part: DIMENSIONS, index, count: view.dimensions.length, json: dimension.json }) : dimensionCard(ctx, { index, count: view.dimensions.length, view: dimension })));
    const rules = (view.rules ?? []).map((rule, index) => (rule.kind === "raw" ? rawCard(ctx, { part: RULES, index, count: view.rules?.length ?? 0, json: rule.json }) : ruleCard(ctx, { index, count: view.rules?.length ?? 0, view: rule })));
    const add = (part: typeof DIMENSIONS | typeof RULES, label: string, change: (current: JsonObject) => JsonObject, announce: string): HTMLButtonElement =>
      button({
        field: fieldId([part], "add"),
        ariaLabel: label,
        label,
        onClick: () => {
          this.#host.edit(change, { focus: fieldId([part], "add"), announce });
        },
      });

    return [
      h("section", { class: "form-section", "aria-labelledby": "dimensions-heading" }, h("h3", { id: "dimensions-heading" }, "Dimensions"), h("p", { class: "hint" }, "A dimension is one option and the values it can take. Their order is the order of enumeration: the first varies slowest."), dimensions.length === 0 ? h("p", { class: "muted" }, "No dimensions yet.") : h("ol", { class: "cards" }, ...dimensions), add(DIMENSIONS, "Add a dimension", (current) => addDimension(current), "Added a dimension.")),
      h("section", { class: "form-section", "aria-labelledby": "rules-heading" }, h("h3", { id: "rules-heading" }, "Rules"), h("p", { class: "hint" }, "A rule restricts which combinations are valid, as a condition over the dimensions."), rules.length === 0 ? h("p", { class: "muted" }, "No rules.") : h("ol", { class: "cards" }, ...rules), add(RULES, "Add a rule", (current) => addRule(current), "Added a rule.")),
      view.otherKeys.length === 0 ? undefined : h("p", { class: "hint" }, `The model also has ${view.otherKeys.map((key) => `"${key}"`).join(", ")}, which the form does not show and keeps.`),
    ].filter((element): element is HTMLElement => element !== undefined);
  }
}

