import type { NodeSpec, TreeContext } from "./controls";
import { addButton, arrayRow, childLabel, choices, fieldId, numberInput, rowButtons, textField, rawJson } from "./controls";
import type { Choice } from "./dom";
import { button, h, select } from "./dom";
import { unreachable } from "./exhaustive";
import type { Json, JsonObject, JsonStep } from "./json";
import { isJsonObject, omit } from "./json";
import { addKey, newPredicate, removeKey, setNode, updateNode } from "./modelEdit";
import type { ExpressionKind, FoldCombiner, PredicateKind } from "./nodes";
import {
  ARITHMETIC_LABELS,
  ARITHMETIC_OPERATORS,
  changeExpressionKind,
  changeFoldModeOf,
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
  FOLD_MODE_LABELS,
  FOLD_MODES,
  HIT_POLICIES,
  HIT_POLICY_LABELS,
  MEMBERSHIP_LABELS,
  MEMBERSHIP_OPERATORS,
  PREDICATE_KIND_LABELS,
  PREDICATE_KINDS,
  REFUSED_EXPRESSION_KINDS,
  REFUSED_PREDICATE_KINDS,
  TEXT_COMPARISON_LABELS,
  TEXT_COMPARISON_OPERATORS,
} from "./nodes";
import { jsonValueEditor, unitEditor } from "./valueForm";

const PREDICATE_CHOICES = choices(PREDICATE_KINDS, PREDICATE_KIND_LABELS);
const EXPRESSION_CHOICES = choices(EXPRESSION_KINDS, EXPRESSION_KIND_LABELS);
const COMPARISON_CHOICES = choices(COMPARISON_OPERATORS, COMPARISON_LABELS);
const TEXT_COMPARISON_CHOICES = choices(TEXT_COMPARISON_OPERATORS, TEXT_COMPARISON_LABELS);
const MEMBERSHIP_CHOICES = choices(MEMBERSHIP_OPERATORS, MEMBERSHIP_LABELS);
const ARITHMETIC_CHOICES = choices(ARITHMETIC_OPERATORS, ARITHMETIC_LABELS);
const FOLD_MODE_CHOICES = choices(FOLD_MODES, FOLD_MODE_LABELS);
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

const NO_DIMENSION_LABEL = "(choose a dimension)";

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

/** The condition that makes a part of the model apply, which may be absent: a button that adds one, or the condition with a button that removes it. */
export function optionalCondition(ctx: TreeContext, spec: { readonly path: readonly JsonStep[]; readonly node: Json | undefined; readonly label: string; readonly heading: string; readonly addLabel: string; readonly removeLabel: string; readonly set: (model: JsonObject, node: Json | undefined) => JsonObject }): HTMLElement {
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
    h(
      "div",
      { class: "optional-head" },
      h("strong", {}, spec.heading),
      button({
        field: fieldId(path, "remove-condition"),
        ariaLabel: `${label}: ${spec.removeLabel}`,
        label: spec.removeLabel,
        small: true,
        onClick: () => {
          ctx.host.edit((model) => spec.set(model, undefined), { focus: fieldId(path, "add"), announce: `Removed the condition: ${label}.` });
        },
      }),
    ),
    predicateNode(ctx, { path, node, label }),
  );
}

/** The optional `filter` of a node that quantifies or folds over a collection. */
function filterCondition(ctx: TreeContext, spec: NodeSpec, filter: Json | undefined): HTMLElement {
  return optionalCondition(ctx, {
    path: [...spec.path, "filter"],
    node: filter,
    label: childLabel(spec.label, "filter"),
    heading: "Only the items that satisfy",
    addLabel: "Add a filter",
    removeLabel: "Remove the filter",
    set: (model, node) => (node === undefined ? removeKey(model, spec.path, "filter") : addKey(model, spec.path, "filter", node)),
  });
}

/** A caption above a part of a node that is not itself a node. */
function captioned(caption: string, ...content: readonly HTMLElement[]): HTMLElement {
  return h("div", { class: "node-part" }, h("strong", {}, caption), ...content);
}

/** A node's frame: a head holding what names and shapes it, and its children beneath. */
function frame(ctx: TreeContext, spec: NodeSpec, head: readonly (HTMLElement | undefined)[], children: readonly (HTMLElement | undefined)[]): HTMLElement {
  const present = children.filter((child): child is HTMLElement => child !== undefined);
  const buttons = spec.item === undefined ? undefined : rowButtons(ctx.host, arrayRow(spec.item));

  return h("div", { class: "node", role: "group", "aria-label": spec.label }, h("div", { class: "node-head" }, ...head, buttons), present.length === 0 ? undefined : h("div", { class: "node-children" }, ...present));
}

/** What a kind menu is given, besides the node: the choices, which is chosen, and how to change kind. */
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

/** A note beside a node of a kind that the schema defines and the library refuses in a model. */
function refusedNote(refused: boolean): HTMLElement | undefined {
  return refused ? h("p", { class: "hint" }, "The library refuses this kind in a model, and the check above says why. It is here so the data stays editable.") : undefined;
}

/** A JSON value held by a field of a node, with its caption. */
function valueField(ctx: TreeContext, spec: NodeSpec, part: { readonly field: string; readonly caption: string; readonly value: Json }): HTMLElement {
  return captioned(part.caption, jsonValueEditor(ctx.host, { path: [...spec.path, part.field], value: part.value, label: childLabel(spec.label, part.caption.toLowerCase()) }));
}

/** A predicate: a node that is true, false or unknown, with a kind menu and what its kind needs, nested to any depth. */
export function predicateNode(ctx: TreeContext, spec: NodeSpec): HTMLElement {
  const view = classifyPredicate(spec.node);
  const kind = kindSelect(ctx, { ...spec, kinds: PREDICATE_CHOICES, selected: view.kind === "raw" ? undefined : view.kind, heldLabel: `Not a node the schema accepts: ${view.kind === "raw" ? (view.nodeKind ?? "no kind") : ""}`, change: (current, next: PredicateKind) => changePredicateKind(current, next, ctx.names) });
  const predicate = (step: JsonStep, name: string, node: Json): HTMLElement => predicateNode(ctx, childSpec(spec, step, name, node));
  const expression = (step: JsonStep, name: string, node: Json): HTMLElement => expressionNode(ctx, childSpec(spec, step, name, node));
  const operator = <T extends string>(operators: readonly Choice<T>[], selected: T): HTMLElement => h("div", { class: "node-op" }, opSelect(ctx, { ...spec, operators, selected }));
  const note = refusedNote(view.kind !== "raw" && REFUSED_PREDICATE_KINDS.includes(view.kind));
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
      const add = addButton(ctx.host, { listPath, label: "Add a condition", ariaLabel: childLabel(spec.label, "add an operand"), item: () => createPredicate("exists", ctx.names) });

      return frame(ctx, spec, [kind], [...items, add]);
    }
    case "compare":
      return frame(ctx, spec, [kind], [expression("left", "left side", view.left), operator(COMPARISON_CHOICES, view.op), expression("right", "right side", view.right)]);
    case "textCompare":
      return frame(ctx, spec, [kind], [expression("left", "left side", view.left), operator(TEXT_COMPARISON_CHOICES, view.op), expression("right", "right side", view.right)]);
    case "memberOf": {
      const listPath = [...spec.path, "candidates"];
      const items = listSpecs(spec, "candidates", { singular: "candidate", items: view.candidates }).map((item) => expressionNode(ctx, item));
      const add = addButton(ctx.host, { listPath, label: "Add a candidate", ariaLabel: childLabel(spec.label, "add a candidate"), item: () => createExpression("textLiteral", ctx.names) });

      return frame(ctx, spec, [kind], [expression("operand", "value", view.operand), operator(MEMBERSHIP_CHOICES, view.op), ...items, add]);
    }
    case "exists":
      return frame(ctx, spec, [kind], [expression("operand", "value", view.operand)]);
    case "some":
    case "every":
      return frame(ctx, spec, [kind], [note, valueField(ctx, spec, { field: "collection", caption: "Collection", value: view.collection }), predicate("item", "item", view.item), filterCondition(ctx, spec, view.filter)]);
    case "treeReference":
      return frame(ctx, spec, [kind], [note, valueField(ctx, spec, { field: "key", caption: "Key", value: view.key })]);
    case "raw":
      return frame(ctx, spec, [kind], [rawJson(ctx.host, { path: spec.path, value: view.json, ariaLabel: childLabel(spec.label, "JSON") })]);
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

/** The key a reference holds. Trilean allows any JSON there and names a dimension only when it is text, so text is picked from the dimensions and anything else is edited as the JSON value it is. */
function referenceKey(ctx: TreeContext, spec: NodeSpec, key: Json): HTMLElement {
  if (typeof key === "string") {
    return h(
      "span",
      { class: "node-head" },
      referencePicker(ctx, { ...spec, key }),
      button({
        field: fieldId(spec.path, "not-text"),
        ariaLabel: childLabel(spec.label, "use a key that is not text"),
        label: "Not a dimension",
        small: true,
        onClick: () => {
          ctx.host.edit((model) => setNode(model, [...spec.path, "key"], null), { focus: fieldId([...spec.path, "key"], "type"), announce: "The key is no longer a dimension." });
        },
      }),
    );
  }

  return captioned("Key that is not text, so names no dimension", jsonValueEditor(ctx.host, { path: [...spec.path, "key"], value: key, label: childLabel(spec.label, "key") }));
}

function conditionalCases(ctx: TreeContext, spec: NodeSpec, cases: readonly { readonly when: Json; readonly then: Json }[]): HTMLElement[] {
  const listPath = [...spec.path, "cases"];
  const items = cases.map((item, position): HTMLElement => {
    const name = `case ${String(position + 1)}`;
    const caseSpec: NodeSpec = { path: [...listPath, position], node: { when: item.when, then: item.then }, label: childLabel(spec.label, name), item: { position, count: cases.length, noun: childLabel(spec.label, name), listPath } };

    return frame(ctx, caseSpec, [h("span", { class: "node-title" }, `Case ${String(position + 1)}`)], [predicateNode(ctx, childSpec(caseSpec, "when", "when", item.when)), expressionNode(ctx, childSpec(caseSpec, "then", "then", item.then))]);
  });
  const add = addButton(ctx.host, { listPath, label: "Add a case", ariaLabel: childLabel(spec.label, "add a case"), item: () => ({ when: createPredicate("exists", ctx.names), then: createExpression("numberLiteral", ctx.names) }) });

  return [...items, add];
}

/** The combiner of a fold: its mode, and the expressions its mode needs. */
function foldCombiner(ctx: TreeContext, spec: NodeSpec, combiner: FoldCombiner): HTMLElement[] {
  const path = [...spec.path, "combiner"];
  const mode = select({
    field: fieldId(path, "mode"),
    ariaLabel: childLabel(spec.label, "how the items combine"),
    choices: FOLD_MODE_CHOICES,
    selected: combiner.mode,
    onChange: (next) => {
      ctx.host.edit((model) => updateNode(model, path, (current) => changeFoldModeOf(current, next, ctx.names)));
    },
  });
  const part = (step: string, name: string, node: Json): HTMLElement => expressionNode(ctx, { path: [...path, step], node, label: childLabel(spec.label, name) });
  const parts = combiner.mode === "reduce" ? [part("initial", "starting value", combiner.initial), part("combine", "combining expression", combiner.combine)] : [part("item", "item", combiner.item)];

  return [h("div", { class: "node-op" }, mode), ...parts];
}

/** An expression: a node that has a value, with a kind menu and what its kind needs, nested to any depth. */
export function expressionNode(ctx: TreeContext, spec: NodeSpec): HTMLElement {
  const view = classifyExpression(spec.node);
  const kind = kindSelect(ctx, { ...spec, kinds: EXPRESSION_CHOICES, selected: view.kind === "raw" ? undefined : view.kind, heldLabel: `Not a node the schema accepts: ${view.kind === "raw" ? (view.nodeKind ?? "no kind") : ""}`, change: (current, next: ExpressionKind) => changeExpressionKind(current, next, ctx.names) });
  const expression = (step: JsonStep, name: string, node: Json): HTMLElement => expressionNode(ctx, childSpec(spec, step, name, node));
  const at = (step: string): readonly JsonStep[] => [...spec.path, step];
  const note = refusedNote(view.kind !== "raw" && REFUSED_EXPRESSION_KINDS.includes(view.kind));
  const unit = (value: JsonObject | undefined): HTMLElement => unitEditor(ctx.host, { path: spec.path, unit: value, label: spec.label });
  switch (view.kind) {
    case "reference":
      return frame(ctx, spec, [kind], [referenceKey(ctx, spec, view.key), unit(view.unit)]);
    case "textLiteral":
      return frame(ctx, spec, [kind, textField(ctx.host, { path: at("value"), ariaLabel: childLabel(spec.label, "text"), value: view.value, control: "value" })], []);
    case "instantLiteral":
      return frame(ctx, spec, [kind, textField(ctx.host, { path: at("value"), ariaLabel: childLabel(spec.label, "ISO 8601 instant"), value: view.value, control: "value" })], []);
    case "numberLiteral":
      return frame(ctx, spec, [kind, numberInput(ctx.host, { path: at("value"), control: "value", ariaLabel: childLabel(spec.label, "number"), value: view.value })], [unit(view.unit)]);
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
          numberInput(ctx.host, { path: at("value"), control: "value", ariaLabel: childLabel(spec.label, "duration"), value: view.value }),
          select({
            field: fieldId(spec.path, "unit"),
            ariaLabel: childLabel(spec.label, "unit"),
            choices: DURATION_UNIT_CHOICES,
            selected: view.unit,
            onChange: (next) => {
              ctx.host.editQuietly((model) => setNode(model, at("unit"), next));
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
          const replacement: JsonObject = next === "rectangular" ? { kind: "complexLiteral", re: 0, im: 0 } : { kind: "complexLiteral", magnitude: 0, phase: 0 };
          ctx.host.edit((model) => setNode(model, spec.path, view.unit === undefined ? replacement : { ...replacement, unit: view.unit }));
        },
      });
      const parts: readonly (readonly [string, number])[] = view.form === "rectangular" ? [["re", view.re], ["im", view.im]] : [["magnitude", view.magnitude], ["phase", view.phase]];

      return frame(ctx, spec, [kind, form, ...parts.map(([part, value]) => numberInput(ctx.host, { path: at(part), control: part, ariaLabel: childLabel(spec.label, part), value }))], [unit(view.unit)]);
    }
    case "arithmetic":
      return frame(ctx, spec, [kind], [expression("left", "left side", view.left), h("div", { class: "node-op" }, opSelect(ctx, { ...spec, operators: ARITHMETIC_CHOICES, selected: view.op })), expression("right", "right side", view.right)]);
    case "negate":
      return frame(ctx, spec, [kind], [expression("operand", "operand", view.operand)]);
    case "call": {
      const listPath = at("args");
      const args = listSpecs(spec, "args", { singular: "argument", items: view.args }).map((item) => expressionNode(ctx, item));
      const add = addButton(ctx.host, { listPath, label: "Add an argument", ariaLabel: childLabel(spec.label, "add an argument"), item: () => createExpression("numberLiteral", ctx.names) });

      return frame(ctx, spec, [kind, textField(ctx.host, { path: at("fn"), ariaLabel: childLabel(spec.label, "function name"), value: view.fn, control: "value" })], [note, ...args, add]);
    }
    case "lookup": {
      const listPath = at("keys");
      const keys = listSpecs(spec, "keys", { singular: "key", items: view.keys }).map((item) => expressionNode(ctx, item));
      const add = addButton(ctx.host, { listPath, label: "Add a key", ariaLabel: childLabel(spec.label, "add a key"), item: () => createExpression("textLiteral", ctx.names) });

      return frame(ctx, spec, [kind], [note, valueField(ctx, spec, { field: "table", caption: "Table", value: view.table }), ...keys, add]);
    }
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
    case "fold":
      return frame(ctx, spec, [kind], [note, valueField(ctx, spec, { field: "collection", caption: "Collection", value: view.collection }), filterCondition(ctx, spec, view.filter), ...foldCombiner(ctx, spec, view.combiner)]);
    case "accumulator":
      return frame(ctx, spec, [kind], [note, h("p", { class: "hint" }, "The running result of the fold it is inside. It has no fields.")]);
    case "delegate":
      return frame(ctx, spec, [kind, textField(ctx.host, { path: at("system"), ariaLabel: childLabel(spec.label, "system"), value: view.system, control: "value" })], [note, valueField(ctx, spec, { field: "payload", caption: "Payload", value: view.payload })]);
    case "treeReference":
      return frame(ctx, spec, [kind], [note, valueField(ctx, spec, { field: "key", caption: "Key", value: view.key })]);
    case "raw":
      return frame(ctx, spec, [kind], [rawJson(ctx.host, { path: spec.path, value: view.json, ariaLabel: childLabel(spec.label, "JSON") })]);
    default:
      return unreachable(view);
  }
}
