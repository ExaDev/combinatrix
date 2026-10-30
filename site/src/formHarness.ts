import type { EditOptions, SwitchOptions } from "./controls";
import type { EditorState, ItemSwitch } from "./editorState";
import { stateAfterEdit, stateAfterSwitch, stateFromModel } from "./editorState";
import { ModelForm } from "./form";
import type { Json, JsonObject } from "./json";
import { getIn } from "./json";

/** The form drawn in a page, with the editor's state behind it: each edit goes through the same transitions of `EditorState` as the page's, and the form is drawn again after the ones that draw it. */
export class Harness {
  state: EditorState;

  readonly container = document.createElement("div");

  readonly form: ModelForm;

  /** What a screen reader was told, in order. */
  readonly announced: string[] = [];

  constructor(model: JsonObject) {
    this.state = stateFromModel(model);
    document.body.append(this.container);
    this.form = new ModelForm(this.container, {
      edit: (change: (current: JsonObject) => JsonObject, options?: EditOptions) => {
        this.state = stateAfterEdit(this.state, change, options?.reshapes);
        this.form.render(this.state.model, options?.focus);
        this.announce(options?.announce);
      },
      editQuietly: (change) => {
        this.state = stateAfterEdit(this.state, change, "nothing");
        this.form.refreshSummaries(this.state.model);
      },
      switchTo: (item: ItemSwitch, options?: SwitchOptions) => {
        this.state = stateAfterSwitch(this.state, item);
        this.form.render(this.state.model, options?.focus);
        this.announce(options?.announce);
      },
    });
    this.form.render(this.model);
  }

  private announce(message: string | undefined): void {
    if (message !== undefined) this.announced.push(message);
  }

  get model(): JsonObject {
    return this.state.model;
  }

  /** The control with a field id. */
  field(id: string): HTMLElement {
    const found = [...this.container.querySelectorAll<HTMLElement>("[data-field]")].find((element) => element.dataset["field"] === id);
    if (found === undefined) throw new Error(`no control ${id}; the controls are ${this.fields().join(", ")}`);

    return found;
  }

  fields(): string[] {
    return [...this.container.querySelectorAll<HTMLElement>("[data-field]")].map((element) => element.dataset["field"] ?? "");
  }

  click(id: string): void {
    this.field(id).click();
  }

  choose(id: string, value: string): void {
    const element = this.field(id);
    if (!(element instanceof HTMLSelectElement)) throw new Error(`${id} is not a menu`);
    element.value = value;
    element.dispatchEvent(new Event("change"));
  }

  type(id: string, text: string): void {
    const element = this.field(id);
    if (!(element instanceof HTMLInputElement)) throw new Error(`${id} is not a text box`);
    element.value = text;
    element.dispatchEvent(new Event("input"));
    element.dispatchEvent(new Event("change"));
  }

  at(path: readonly (string | number)[]): Json | undefined {
    return getIn(this.model, path);
  }

  destroy(): void {
    this.container.remove();
  }
}
