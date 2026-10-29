import type { Choice } from "./dom";
import { button, h, select, textInput } from "./dom";
import { unreachable } from "./exhaustive";
import type { Json, JsonObject, JsonStep } from "./json";
import { isJsonObject, omit, parseJson } from "./json";
import { addListItem, moveListItem, parseNumber, removeListItem, setNode, updateNode } from "./modelEdit";
import type { ConditionalCase, ExpressionKind, PredicateKind } from "./nodes";
import {
  ARITHMETIC_LABELS,
  ARITHMETIC_OPERATORS,
  changeExpressionKind,
  changePredicateKind,
  classifyExpression,
  classifyPredicate,
  COMPARISON_LABELS,
  COMPARISON_OPERATORS,
  createExpression,
  createPredicate,
  DURATION_UNITS,
  EXPRESSION_KIND_LABELS,
  EXPRESSION_KINDS,
  HIT_POLICIES,
  HIT_POLICY_LABELS,
  MEMBERSHIP_LABELS,
  MEMBERSHIP_OPERATORS,
  PREDICATE_KIND_LABELS,
  PREDICATE_KINDS,
  TEXT_COMPARISON_LABELS,
  TEXT_COMPARISON_OPERATORS,
} from "./nodes";

/** What the page offers a drawn tree for editing the model. */
export interface TreeHost {
  /** Applies an edit and draws the form again, returning focus to the field named by `focus` when there is one, and telling a screen reader what happened. */
  readonly edit: (change: (model: JsonObject) => JsonObject, options?: EditOptions) => void;
  /** Applies an edit that changes no structure, so the form is not drawn again and a field being typed in keeps its caret. */
  readonly editQuietly: (change: (model: JsonObject) => JsonObject) => void;
}

export interface EditOptions {
  readonly focus?: string;
  readonly announce?: string;
}

/** The dimension names a reference may pick, and where edits go. */
export interface TreeContext {
  readonly names: readonly string[];
  readonly host: TreeHost;
}

/** The controls of one item of a list: where it is in it, and what it is called in the words of a screen reader. */
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

/** The field id of a control of the thing at a path. It is the same on every draw, which is how focus finds its control again. */
export function fieldId(path: readonly JsonStep[], control: string): string {
  return `${path.join(".")}:${control}`;
}

export function choices<T extends string>(values: readonly T[], labels: Readonly<Record<T, string>>): Choice<T>[] {
  return values.map((value) => ({ value, label: labels[value] }));
}

const PREDICATE_CHOICES = choices(PREDICATE_KINDS, PREDICATE_KIND_LABELS);
const EXPRESSION_CHOICES = choices(EXPRESSION_KINDS, EXPRESSION_KIND_LABELS);
const COMPARISON_CHOICES = choices(COMPARISON_OPERATORS, COMPARISON_LABELS);
const TEXT_COMPARISON_CHOICES = choices(TEXT_COMPARISON_OPERATORS, TEXT_COMPARISON_LABELS);
const MEMBERSHIP_CHOICES = choices(MEMBERSHIP_OPERATORS, MEMBERSHIP_LABELS);
const ARITHMETIC_CHOICES = choices(ARITHMETIC_OPERATORS, ARITHMETIC_LABELS);
const DURATION_UNIT_CHOICES: readonly Choice<(typeof DURATION_UNITS)[number]>[] = DURATION_UNITS.map((unit) => ({ value: unit, label: unit }));

const BOOLEAN_CHOICES: readonly Choice<"true" | "false">[] = [
  { value: "true", label: "true" },
  { value: "false", label: "false" },
];

const COMPLEX_FORM_CHOICES: readonly Choice<"rectangular" | "polar">[] = [
  { value: "rectangular", label: "real and imaginary parts" },
  { value: "polar", label: "magnitude and phase" },
];

/** The hit policy of a conditional that states none, which trilean reads as the first case that holds. */
const UNSTATED_POLICY = "unstated";

const HIT_POLICY_CHOICES: readonly Choice<"unstated" | (typeof HIT_POLICIES)[number]>[] = [{ value: UNSTATED_POLICY, label: "the first case that holds (unstated)" }, ...choices(HIT_POLICIES, HIT_POLICY_LABELS)];

/** How many rows a raw JSON box shows before it scrolls. */
const RAW_ROWS = 4;

const NO_DIMENSION_LABEL = "(choose a dimension)";

function childLabel(parent: string, child: string): string {
  return `${parent}, ${child}`;
}

function childSpec(parent: NodeSpec, step: JsonStep, name: string, node: Json): NodeSpec {
  return { path: [...parent.path, step], node, label: childLabel(parent.label, name) };
}

/** The spec of each item of a list at a step of a node, with the controls that move and remove it. */
function listSpecs(parent: NodeSpec, step: string, list: { readonly singular: string; readonly items: readonly Json[] }): NodeSpec[] {
  const listPath = [...parent.path, step];

  return list.items.map((node, position) => {
    const label = childLabel(parent.label, `${list.singular} ${String(position + 1)}`);

    return { path: [...listPath, position], node, label, item: { position, count: list.items.length, noun: label, listPath } };
  });
}

/** The buttons that move an item of a list and remove it. */
function itemButtons(ctx: TreeContext, spec: NodeSpec): HTMLElement | undefined {
  const { item } = spec;
  if (item === undefined) return undefined;
  const { position, count, noun, listPath } = item;
  const last = count - 1;
  const move = (direction: "earlier" | "later"): void => {
    const target = direction === "earlier" ? position - 1 : position + 1;
    const keepsMoving = direction === "earlier" ? target > 0 : target < last;
    // The moved item is at `target` now. Focus stays on the button that moved it, unless that button is disabled at the end the item has reached, and then goes to the other one.
    const control = (direction === "earlier") === keepsMoving ? "up" : "down";
    ctx.host.edit((model) => moveListItem(model, listPath, position, direction), { focus: fieldId([...listPath, target], control), announce: `Moved ${noun} ${direction === "earlier" ? "up" : "down"}.` });
  };
  const remove = (): void => {
    ctx.host.edit((model) => removeListItem(model, listPath, position), { focus: fieldId(listPath, "add"), announce: `Removed ${noun}.` });
  };

  return h(
    "span",
    { class: "item-buttons" },
    button({ field: fieldId(spec.path, "up"), ariaLabel: `Move ${noun} up`, label: "Up", small: true, disabled: position === 0, onClick: () => { move("earlier"); } }),
    button({ field: fieldId(spec.path, "down"), ariaLabel: `Move ${noun} down`, label: "Down", small: true, disabled: position === last, onClick: () => { move("later"); } }),
    button({ field: fieldId(spec.path, "remove"), ariaLabel: `Remove ${noun}`, label: "Remove", small: true, onClick: remove }),
  );
}

/** A button that adds an item to the list at a path. */
function addButton(ctx: TreeContext, spec: { readonly listPath: readonly JsonStep[]; readonly label: string; readonly ariaLabel: string; readonly item: () => Json }): HTMLButtonElement {
  return button({
    field: fieldId(spec.listPath, "add"),
    ariaLabel: spec.ariaLabel,
    label: spec.label,
    small: true,
    onClick: () => {
      ctx.host.edit((model) => addListItem(model, spec.listPath, spec.item()), { focus: fieldId(spec.listPath, "add"), announce: `${spec.ariaLabel}: added.` });
    },
  });
}

/** A text box for a number. It commits only what states a finite number and says so when what is typed does not; on leaving the field it returns to the last number committed. */
export function numberInput(ctx: TreeContext, spec: { readonly path: readonly JsonStep[]; readonly control: string; readonly ariaLabel: string; readonly value: number }): HTMLElement {
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
      ctx.host.editQuietly((model) => setNode(model, spec.path, parsed));
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
function textField(ctx: TreeContext, spec: { readonly path: readonly JsonStep[]; readonly ariaLabel: string; readonly value: string; readonly control: string }): HTMLInputElement {
  return textInput({
    field: fieldId(spec.path, spec.control),
    ariaLabel: spec.ariaLabel,
    value: spec.value,
    onInput: (text) => {
      ctx.host.editQuietly((model) => setNode(model, spec.path, text));
    },
  });
}

/** Raw JSON for something the form has no controls for: editable as text, and kept by the model whenever the text is JSON. */
export function rawJson(ctx: TreeContext, spec: { readonly path: readonly JsonStep[]; readonly value: Json; readonly ariaLabel: string }): HTMLElement {
  const problem = h("span", { class: "field-problem", role: "status" });
  const area = h("textarea", { rows: String(RAW_ROWS), spellcheck: "false", "data-field": fieldId(spec.path, "raw"), "aria-label": spec.ariaLabel, class: "raw-json" });
  area.value = JSON.stringify(spec.value, null, 2);
  area.addEventListener("input", () => {
    try {
      const parsed = parseJson(area.value);
      problem.textContent = "";
      area.setAttribute("aria-invalid", "false");
      ctx.host.editQuietly((model) => setNode(model, spec.path, parsed));
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      area.setAttribute("aria-invalid", "true");
      problem.textContent = `Not JSON (${error.message}); the model keeps the last JSON.`;
    }
  });

  return h("div", { class: "raw" }, area, problem);
}

function kindSelect<T extends string>(ctx: TreeContext, spec: NodeSpec & { readonly kinds: readonly Choice<T>[]; readonly selected: T | undefined; readonly heldLabel: string; readonly change: (current: Json, kind: T) => Json }): HTMLSelectElement {
  return select({
    field: fieldId(spec.path, "kind"),
    ariaLabel: childLabel(spec.label, "kind"),
    choices: spec.kinds,
    selected: spec.selected,
    heldLabel: spec.heldLabel,
    onChange: (kind) => {
      ctx.host.edit((model) => updateNode(model, spec.path, (current) => spec.change(current, kind)));
    },
  });
}

function opSelect<T extends string>(ctx: TreeContext, spec: NodeSpec & { readonly operators: readonly Choice<T>[]; readonly selected: T }): HTMLSelectElement {
  return select({
    field: fieldId(spec.path, "op"),
    ariaLabel: childLabel(spec.label, "operator"),
    choices: spec.operators,
    selected: spec.selected,
    onChange: (op) => {
      ctx.host.editQuietly((model) => setNode(model, [...spec.path, "op"], op));
    },
  });
}

/** A node's frame: a head holding what names and shapes it, and its children beneath. */
function frame(ctx: TreeContext, spec: NodeSpec, head: readonly (HTMLElement | undefined)[], children: readonly (HTMLElement | undefined)[]): HTMLElement {
  const present = children.filter((child): child is HTMLElement => child !== undefined);

  return h("div", { class: "node", role: "group", "aria-label": spec.label }, h("div", { class: "node-head" }, ...head, itemButtons(ctx, spec)), present.length === 0 ? undefined : h("div", { class: "node-children" }, ...present));
}

/** A predicate: a node that is true, false or unknown, with a kind menu and what its kind needs, nested to any depth. */
export function predicateNode(ctx: TreeContext, spec: NodeSpec): HTMLElement {
  const view = classifyPredicate(spec.node);
  const kind = kindSelect(ctx, { ...spec, kinds: PREDICATE_CHOICES, selected: view.kind === "raw" ? undefined : view.kind, heldLabel: `Raw JSON: ${view.kind === "raw" ? (view.nodeKind ?? "not a node") : ""}`, change: (current, next: PredicateKind) => changePredicateKind(current, next, ctx.names) });
  const predicate = (step: JsonStep, name: string, node: Json): HTMLElement => predicateNode(ctx, childSpec(spec, step, name, node));
  const expression = (step: JsonStep, name: string, node: Json): HTMLElement => expressionNode(ctx, childSpec(spec, step, name, node));
  switch (view.kind) {
    case "not":
      return frame(ctx, spec, [kind], [predicate("operand", "operand", view.operand)]);
    case "and":
    case "or":
      return frame(ctx, spec, [kind], [predicate("left", "first", view.left), predicate("right", "second", view.right)]);
    case "allOf":
    case "anyOf": {
      const listPath = [...spec.path, "operands"];
      const items = listSpecs(spec, "operands", { singular: "operand", items: view.operands }).map((item) => predicateNode(ctx, item));
      const add = addButton(ctx, { listPath, label: "Add a condition", ariaLabel: childLabel(spec.label, "add an operand"), item: () => createPredicate("exists", ctx.names) });

      return frame(ctx, spec, [kind], [...items, add]);
    }
    case "compare":
      return frame(ctx, spec, [kind], [expression("left", "left side", view.left), h("div", { class: "node-op" }, opSelect(ctx, { ...spec, operators: COMPARISON_CHOICES, selected: view.op })), expression("right", "right side", view.right)]);
    case "textCompare":
      return frame(ctx, spec, [kind], [expression("left", "left side", view.left), h("div", { class: "node-op" }, opSelect(ctx, { ...spec, operators: TEXT_COMPARISON_CHOICES, selected: view.op })), expression("right", "right side", view.right)]);
    case "memberOf": {
      const listPath = [...spec.path, "candidates"];
      const items = listSpecs(spec, "candidates", { singular: "candidate", items: view.candidates }).map((item) => expressionNode(ctx, item));
      const add = addButton(ctx, { listPath, label: "Add a candidate", ariaLabel: childLabel(spec.label, "add a candidate"), item: () => createExpression("textLiteral", ctx.names) });

      return frame(ctx, spec, [kind], [expression("operand", "value", view.operand), h("div", { class: "node-op" }, opSelect(ctx, { ...spec, operators: MEMBERSHIP_CHOICES, selected: view.op })), ...items, add]);
    }
    case "exists":
      return frame(ctx, spec, [kind], [expression("operand", "value", view.operand)]);
    case "raw":
      return frame(ctx, spec, [kind], [rawJson(ctx, { path: spec.path, value: view.json, ariaLabel: childLabel(spec.label, "JSON") })]);
    default:
      return unreachable(view);
  }
}

/** The dimension a reference reads, picked from the model's own dimensions. A key that is none of them stays pickable, marked, so the model is not changed by drawing it. */
function referencePicker(ctx: TreeContext, spec: NodeSpec & { readonly key: string }): HTMLSelectElement {
  const known = ctx.names.includes(spec.key);
  const options: Choice<string>[] = ctx.names.map((name) => ({ value: name, label: name === "" ? NO_DIMENSION_LABEL : name }));
  if (!known) options.push({ value: spec.key, label: spec.key === "" ? NO_DIMENSION_LABEL : `${spec.key} (not a dimension)` });

  return select({
    field: fieldId(spec.path, "key"),
    ariaLabel: childLabel(spec.label, "dimension"),
    choices: options,
    selected: spec.key,
    onChange: (key) => {
      ctx.host.editQuietly((model) => setNode(model, [...spec.path, "key"], key));
    },
  });
}

function conditionalCases(ctx: TreeContext, spec: NodeSpec, cases: readonly ConditionalCase[]): HTMLElement[] {
  const listPath = [...spec.path, "cases"];
  const items = cases.map((item, position): HTMLElement => {
    const name = `case ${String(position + 1)}`;
    const caseSpec: NodeSpec = { path: [...listPath, position], node: { when: item.when, then: item.then }, label: childLabel(spec.label, name), item: { position, count: cases.length, noun: childLabel(spec.label, name), listPath } };

    return frame(ctx, caseSpec, [h("span", { class: "node-title" }, `Case ${String(position + 1)}`)], [predicateNode(ctx, childSpec(caseSpec, "when", "when", item.when)), expressionNode(ctx, childSpec(caseSpec, "then", "then", item.then))]);
  });
  const add = addButton(ctx, { listPath, label: "Add a case", ariaLabel: childLabel(spec.label, "add a case"), item: () => ({ when: createPredicate("exists", ctx.names), then: createExpression("numberLiteral", ctx.names) }) });

  return [...items, add];
}

/** An expression: a node that has a value, with a kind menu and what its kind needs, nested to any depth. */
export function expressionNode(ctx: TreeContext, spec: NodeSpec): HTMLElement {
  const view = classifyExpression(spec.node);
  const kind = kindSelect(ctx, { ...spec, kinds: EXPRESSION_CHOICES, selected: view.kind === "raw" ? undefined : view.kind, heldLabel: `Raw JSON: ${view.kind === "raw" ? (view.nodeKind ?? "not a node") : ""}`, change: (current, next: ExpressionKind) => changeExpressionKind(current, next, ctx.names) });
  const expression = (step: JsonStep, name: string, node: Json): HTMLElement => expressionNode(ctx, childSpec(spec, step, name, node));
  const at = (step: string): readonly JsonStep[] => [...spec.path, step];
  switch (view.kind) {
    case "reference":
      return frame(ctx, spec, [kind, referencePicker(ctx, { ...spec, key: view.key })], []);
    case "textLiteral":
      return frame(ctx, spec, [kind, textField(ctx, { path: at("value"), ariaLabel: childLabel(spec.label, "text"), value: view.value, control: "value" })], []);
    case "instantLiteral":
      return frame(ctx, spec, [kind, textField(ctx, { path: at("value"), ariaLabel: childLabel(spec.label, "ISO 8601 instant"), value: view.value, control: "value" })], []);
    case "numberLiteral":
      return frame(ctx, spec, [kind, numberInput(ctx, { path: at("value"), control: "value", ariaLabel: childLabel(spec.label, "number"), value: view.value })], []);
    case "booleanLiteral":
      return frame(
        ctx,
        spec,
        [
          kind,
          select({
            field: fieldId(spec.path, "value"),
            ariaLabel: childLabel(spec.label, "value"),
            choices: BOOLEAN_CHOICES,
            selected: view.value ? "true" : "false",
            onChange: (value) => {
              ctx.host.editQuietly((model) => setNode(model, at("value"), value === "true"));
            },
          }),
        ],
        [],
      );
    case "durationLiteral":
      return frame(
        ctx,
        spec,
        [
          kind,
          numberInput(ctx, { path: at("value"), control: "value", ariaLabel: childLabel(spec.label, "duration"), value: view.value }),
          select({
            field: fieldId(spec.path, "unit"),
            ariaLabel: childLabel(spec.label, "unit"),
            choices: DURATION_UNIT_CHOICES,
            selected: view.unit,
            onChange: (unit) => {
              ctx.host.editQuietly((model) => setNode(model, at("unit"), unit));
            },
          }),
        ],
        [],
      );
    case "complexLiteral": {
      const form = select({
        field: fieldId(spec.path, "form"),
        ariaLabel: childLabel(spec.label, "form"),
        choices: COMPLEX_FORM_CHOICES,
        selected: view.form,
        onChange: (next) => {
          const replacement: Json = next === "rectangular" ? { kind: "complexLiteral", re: 0, im: 0 } : { kind: "complexLiteral", magnitude: 0, phase: 0 };
          ctx.host.edit((model) => setNode(model, spec.path, replacement));
        },
      });
      const parts: readonly (readonly [string, number])[] = view.form === "rectangular" ? [["re", view.re], ["im", view.im]] : [["magnitude", view.magnitude], ["phase", view.phase]];

      return frame(ctx, spec, [kind, form, ...parts.map(([part, value]) => numberInput(ctx, { path: at(part), control: part, ariaLabel: childLabel(spec.label, part), value }))], []);
    }
    case "arithmetic":
      return frame(ctx, spec, [kind], [expression("left", "left side", view.left), h("div", { class: "node-op" }, opSelect(ctx, { ...spec, operators: ARITHMETIC_CHOICES, selected: view.op })), expression("right", "right side", view.right)]);
    case "negate":
      return frame(ctx, spec, [kind], [expression("operand", "operand", view.operand)]);
    case "conditional": {
      const policy = select({
        field: fieldId(spec.path, "hitPolicy"),
        ariaLabel: childLabel(spec.label, "which case is used"),
        choices: HIT_POLICY_CHOICES,
        selected: view.hitPolicy ?? UNSTATED_POLICY,
        onChange: (next) => {
          ctx.host.editQuietly((model) =>
            updateNode(model, spec.path, (current) => {
              if (!isJsonObject(current)) throw new Error("unreachable: a conditional is an object");

              return next === UNSTATED_POLICY ? omit(current, "hitPolicy") : { ...current, hitPolicy: next };
            }),
          );
        },
      });

      return frame(ctx, spec, [kind, policy], [...conditionalCases(ctx, spec, view.cases), expression("fallback", "otherwise", view.fallback)]);
    }
    case "raw":
      return frame(ctx, spec, [kind], [rawJson(ctx, { path: spec.path, value: view.json, ariaLabel: childLabel(spec.label, "JSON") })]);
    default:
      return unreachable(view);
  }
}
