/** A child of an element built by `h`: a node, text, or nothing. */
export type Child = Node | string | undefined;

/** An element with attributes (those given as `undefined` are left off) and children. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Readonly<Record<string, string | undefined>>, ...children: readonly Child[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== undefined) element.setAttribute(name, value);
  }
  element.append(...children.filter((child): child is Node | string => child !== undefined));

  return element;
}

/** One option of a select: what it stands for and what the user reads. */
export interface Choice<T extends string> {
  readonly value: T;
  readonly label: string;
}

/** What a control needs to be found again after the form is drawn anew, and to be named for a screen reader. */
export interface ControlName {
  /** Stable across draws: the same control gets the same field id, so focus can return to it. */
  readonly field: string;
  readonly ariaLabel: string;
}

export interface ButtonSpec extends ControlName {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  /** Whether the button is a quiet, secondary one beside a larger control. */
  readonly small?: boolean;
}

export function button(spec: ButtonSpec): HTMLButtonElement {
  const element = h("button", { type: "button", "data-field": spec.field, "aria-label": spec.ariaLabel, class: spec.small === true ? "small" : undefined }, spec.label);
  element.disabled = spec.disabled === true;
  element.addEventListener("click", spec.onClick);

  return element;
}

export interface SelectSpec<T extends string> extends ControlName {
  readonly choices: readonly Choice<T>[];
  /** The value shown as chosen, which may be none of the choices (a kind the form only keeps), in which case `heldLabel` names it. */
  readonly selected: T | undefined;
  readonly heldLabel?: string;
  readonly onChange: (value: T) => void;
}

export function select<T extends string>(spec: SelectSpec<T>): HTMLSelectElement {
  const element = h("select", { "data-field": spec.field, "aria-label": spec.ariaLabel });
  if (spec.selected === undefined) {
    const held = new Option(spec.heldLabel ?? "", "");
    held.selected = true;
    held.disabled = true;
    element.append(held);
  }
  for (const choice of spec.choices) element.append(new Option(choice.label, choice.value, false, choice.value === spec.selected));
  element.addEventListener("change", () => {
    const chosen = spec.choices.find((choice) => choice.value === element.value);
    if (chosen !== undefined) spec.onChange(chosen.value);
  });

  return element;
}

export interface TextSpec extends ControlName {
  readonly value: string;
  readonly onInput: (value: string, element: HTMLInputElement) => void;
  /** Called when the field is left, for a field that holds off committing what is not yet valid. It may return the text the field should show from then on. */
  readonly onCommit?: (element: HTMLInputElement) => string | undefined;
  readonly numeric?: boolean;
}

export function textInput(spec: TextSpec): HTMLInputElement {
  const element = h("input", { type: "text", "data-field": spec.field, "aria-label": spec.ariaLabel, autocomplete: "off", spellcheck: "false", inputmode: spec.numeric === true ? "decimal" : undefined });
  element.value = spec.value;
  element.addEventListener("input", () => {
    spec.onInput(element.value, element);
  });
  if (spec.onCommit !== undefined) {
    const commit = spec.onCommit;
    element.addEventListener("change", () => {
      const text = commit(element);
      if (text !== undefined) element.value = text;
    });
  }

  return element;
}

/** A labelled field: its text above the control, which also carries the name for a screen reader. */
export function labelled(text: string, control: HTMLElement): HTMLLabelElement {
  return h("label", {}, h("span", {}, text), control);
}
