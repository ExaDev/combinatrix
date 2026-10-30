import type { Value } from "combinatrix";

import type { Opened } from "./address";
import { ADDRESS_DEBOUNCE_MS, addressFor } from "./address";
import type { SpawnWorker } from "./client";
import { CancelledError, EngineClient } from "./client";
import type { EditorState, ItemSwitch } from "./editorState";
import { emptyState, stateAfterEdit, stateAfterSwitch, stateFromModel, stateFromText } from "./editorState";
import { EXAMPLES, exampleText, STARTING_EXAMPLE } from "./examples";
import { unreachable } from "./exhaustive";
import type { SharedState } from "./fragment";
import { shareUrl } from "./fragment";
import type { EditOptions, SwitchOptions } from "./controls";
import { byId } from "./dom";
import { ModelForm } from "./form";
import { fillHelp } from "./help";
import { asCopy, idOf, identify, modelOfText, nameOf } from "./identity";
import type { JsonObject } from "./json";
import { DEFAULT_LIST_LIMIT, DEFAULT_STRENGTH, MAX_LIST_LIMIT } from "./limits";
import type { DimensionSummary, Failure, Request, Response, Result, Row, Verification } from "./protocol";
import { isOp } from "./protocol";
import { describeFailure, describeReason, describeValue } from "./reasons";
import { startPwa } from "./pwa";
import type { Clash } from "./reconcile";
import { meet } from "./reconcile";
import { combinationsPhrase, messageList, rowsTable, textElement } from "./render";
import { toActionsMatrix, toCsv, toJson } from "./resultExport";
import { GIST_PARAMETER, restoreFrom } from "./restore";
import { SavedModels } from "./saved";

/** How long after the last keystroke the editor's text is checked, so typing does not start a check per key. */
const VALIDATE_DEBOUNCE_MS = 250;

/** How many characters of an id tell two saved models of the same name apart. */
const SHORT_ID_LENGTH = 8;

/** The file Export writes. */
const EXPORT_FILE_NAME = "combinatrix-model.json";

const editor = byId("model", HTMLTextAreaElement);
const validation = byId("validation", HTMLDivElement);
const formContainer = byId("form", HTMLDivElement);
const formFieldset = byId("form-fieldset", HTMLFieldSetElement);
const formNotice = byId("form-notice", HTMLDivElement);
const formProblem = byId("form-problem", HTMLParagraphElement);
const formStatus = byId("form-status", HTMLParagraphElement);
const useLastValid = byId("use-last-valid", HTMLButtonElement);
const emptyModelButton = byId("empty-model", HTMLButtonElement);
const advanced = byId("advanced", HTMLDetailsElement);
const exampleSelect = byId("example", HTMLSelectElement);
const copyLink = byId("copy-link", HTMLButtonElement);
const exportButton = byId("export", HTMLButtonElement);
const importInput = byId("import", HTMLInputElement);
const linkStatus = byId("link-status", HTMLParagraphElement);
const addressStatus = byId("address-status", HTMLParagraphElement);
const linkField = byId("link", HTMLInputElement);
const saveName = byId("save-name", HTMLInputElement);
const saveButton = byId("save", HTMLButtonElement);
const savedStatus = byId("saved-status", HTMLParagraphElement);
const savedList = byId("saved-list", HTMLUListElement);
const notice = byId("notice", HTMLParagraphElement);
const clashPanel = byId("clash", HTMLElement);
const clashSummary = byId("clash-summary", HTMLParagraphElement);
const clashChanges = byId("clash-changes", HTMLUListElement);
const clashKeep = byId("clash-keep", HTMLButtonElement);
const clashReplace = byId("clash-replace", HTMLButtonElement);
const clashCopy = byId("clash-copy", HTMLButtonElement);
const cancelButton = byId("cancel", HTMLButtonElement);
const busy = byId("busy", HTMLParagraphElement);
const listLimit = byId("list-limit", HTMLInputElement);
const strength = byId("strength", HTMLInputElement);
const indexInput = byId("index", HTMLInputElement);
const pickers = byId("pickers", HTMLFieldSetElement);
const operationButtons = [...document.querySelectorAll<HTMLButtonElement>("button.op")];

/** The controls that change the editor's text, which are off while an operation runs so its result stays about the text it ran on. The saved models' buttons are made when they are listed, so they are looked up each time. */
function editingControls(): (HTMLSelectElement | HTMLInputElement | HTMLButtonElement)[] {
  return [exampleSelect, importInput, saveButton, ...savedList.querySelectorAll("button")];
}

/** Starts the engine worker. The page and the worker share nothing but the messages of `protocol.ts`. */
const spawnWorker: SpawnWorker = (handlers) => {
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  worker.addEventListener("message", (event: MessageEvent<Response>) => {
    handlers.respond(event.data);
  });
  worker.addEventListener("error", (event) => {
    handlers.fail(event.message);
  });

  return {
    post: (request) => {
      worker.postMessage(request);
    },
    terminate: () => {
      worker.terminate();
    },
  };
};

const client = new EngineClient(spawnWorker);
/** A new durable id for a model. */
const mint = (): string => crypto.randomUUID();

const saved = new SavedModels(() => window.localStorage, mint);

/** The model the form shows and the JSON text in the Advanced view: edits to either change both. */
let state: EditorState = emptyState();

/** The dimensions of the model in the editor, once the engine has validated exactly its current text; `undefined` while it is being checked or is invalid. */
let dimensions: readonly DimensionSummary[] | undefined;
let validating = false;
let operating = false;
let debounce: ReturnType<typeof setTimeout> | undefined;

/** The state and address the page opened with, once it has opened: the address bar shows this address whenever the page is in this state, and a link holding the state otherwise. */
let opened: Opened | undefined;
let addressTimer: ReturnType<typeof setTimeout> | undefined;
/** Whether the address bar holds the model and index the page shows, so that reloading the page from its address restores them. It is false from every change until the address has been written, and while the address cannot hold the model or would fetch it. */
let addressHoldsPage = false;
/** Counts writes of the address, so that one superseded while its link was being made is dropped. */
let addressRevision = 0;

// Sending

/** Runs a request on the engine. `undefined` means the user cancelled it. A worker that dies is reported as a failure like any other. */
async function send(request: Request): Promise<Response | undefined> {
  try {
    const running = client.run(request);
    // The client is busy from here, which is what enables Cancel.
    refresh();

    return await running;
  } catch (error) {
    if (error instanceof CancelledError) return undefined;
    if (error instanceof Error) return { ok: false, failure: { kind: "error", message: `The engine stopped: ${error.message}` } };

    throw error;
  }
}

function refresh(): void {
  const ready = dimensions !== undefined && !validating && !operating;
  for (const button of operationButtons) button.disabled = !ready;
  for (const control of editingControls()) control.disabled = operating;
  editor.readOnly = operating;
  formFieldset.disabled = operating || state.problem !== undefined;
  cancelButton.disabled = !client.busy;
}

function showFailure(target: HTMLElement, failure: Failure): void {
  target.replaceChildren(messageList(describeFailure(failure), "problem"));
}

/** One operation: the request to send, and how to show what comes back. */
interface Operation<Op extends Result["op"]> {
  readonly op: Op;
  /** What the busy line says while it runs, without the ellipsis. */
  readonly label: string;
  readonly request: Request;
  /** Where its result, or why it failed, is written. */
  readonly output: HTMLElement;
  readonly show: (result: Extract<Result, { op: Op }>) => void;
}

/** Runs one operation, writing what it produces or why it failed into its output. */
async function operate<Op extends Result["op"]>({ op, label, request, output, show }: Readonly<Operation<Op>>): Promise<void> {
  setOperating(true, `${label}…`);
  output.replaceChildren();
  try {
    const response = await send(request);
    if (response === undefined) output.replaceChildren("Cancelled.");
    else if (!response.ok) showFailure(output, response.failure);
    else if (isOp(response.result, op)) show(response.result);
    else throw new Error(`unreachable: ${op} was answered with ${response.result.op}`);
  } finally {
    setOperating(false, "");
  }
}

function setOperating(value: boolean, label: string): void {
  operating = value;
  busy.replaceChildren(label);
  refresh();
}

// Validating

function setValidating(value: boolean): void {
  validating = value;
  refresh();
}

/** Checks the editor's text. If the text changes while the engine checks it, the answer is about text no longer there, so it is dropped and the new text is checked. */
async function validateEditor(): Promise<void> {
  if (validating) return;

  clearTimeout(debounce);
  setValidating(true);
  const text = editor.value;
  let response: Response | undefined;
  try {
    response = await send({ op: "validate", model: text });
  } finally {
    setValidating(false);
  }

  if (editor.value !== text) await validateEditor();
  else showValidation(response);
}

function showValidation(response: Response | undefined): void {
  if (response === undefined) {
    validation.replaceChildren(textElement("p", "Checking was cancelled. Edit the model to check it again."));
  } else if (!response.ok) {
    dimensions = undefined;
    showFailure(validation, response.failure);
  } else if (isOp(response.result, "validate")) {
    dimensions = response.result.dimensions;
    validation.replaceChildren(textElement("p", `Valid model with ${String(dimensions.length)} dimension${dimensions.length === 1 ? "" : "s"}.`, "valid"));
    showPickers(dimensions);
  }
  refresh();
}

function editorChanged(): void {
  dimensions = undefined;
  validation.replaceChildren(textElement("p", "Checking the model…", "muted"));
  refresh();
  clearTimeout(debounce);
  debounce = setTimeout(() => void validateEditor(), VALIDATE_DEBOUNCE_MS);
  addressChanged();
}

// The form and the JSON view

/** How a change of state reaches the page: whether the JSON text is rewritten from the model, and whether the form is drawn again. */
interface Update {
  readonly writeText: boolean;
  readonly draw: boolean;
  readonly focus?: string;
  readonly announce?: string;
}

const form = new ModelForm(formContainer, { edit, editQuietly, switchTo });

/** Makes `next` the state of the form and the JSON view, and has the engine check its text. */
function showState(next: EditorState, update: Update): void {
  state = next;
  if (update.writeText) editor.value = next.text;
  formNotice.hidden = next.problem === undefined;
  if (next.problem !== undefined) {
    formProblem.textContent = next.problem.kind === "shape" ? `The JSON is valid, but the form cannot show it: ${next.problem.message}.` : "The JSON in the Advanced view is not valid, so the form shows the last valid model.";
    advanced.open = true;
  }
  if (update.draw) form.render(next.model, update.focus);
  if (update.announce !== undefined) formStatus.textContent = update.announce;
  editorChanged();
}

/** The form's own edits: a change of the model, which rewrites the JSON text. */
function edit(change: (model: JsonObject) => JsonObject, options: EditOptions = {}): void {
  const { reshapes, ...update } = options;
  showState(stateAfterEdit(state, change, reshapes), { writeText: true, draw: true, ...update });
}

function editQuietly(change: (model: JsonObject) => JsonObject): void {
  showState(stateAfterEdit(state, change, "nothing"), { writeText: true, draw: false });
}

/** The form switching an item to another variant of it: the model changes, and the editor remembers what the item was. */
function switchTo(item: ItemSwitch, options: SwitchOptions = {}): void {
  showState(stateAfterSwitch(state, item), { writeText: true, draw: true, ...options });
}

/** The JSON text changed, by typing in the Advanced view: a model the form can show updates the form, anything else leaves it showing the last valid model and keeps the text exactly as typed. */
function textTyped(): void {
  const next = stateFromText(editor.value, state);
  showState(next, { writeText: false, draw: next.model !== state.model });
}

/** Replaces the model with the one a text holds, as loading an example, a link, a gist, a saved model or a file does: the form shows it, and the text is as given. */
function setModel(text: string): void {
  editor.value = text;
  const next = stateFromText(text, state);
  showState(next, { writeText: false, draw: true });
}

// Combination pickers

/** One select per dimension, offering each of its values and unset. The option value is the position in the dimension's values, or `unset`, so values of different JSON types never compare as text. */
function showPickers(shown: readonly DimensionSummary[]): void {
  const previous = readPicks();
  const fields = shown.map((dimension) => {
    const select = document.createElement("select");
    select.dataset["dimension"] = dimension.name;
    select.id = `pick-${dimension.name}`;
    dimension.values.forEach((value, position) => { select.append(new Option(describeValue(value), String(position))); });
    select.append(new Option("unset", "unset"));
    const label = document.createElement("label");
    label.append(dimension.name, select);

    return { dimension, select, label };
  });
  pickers.replaceChildren(textElement("legend", "Pick a value for each dimension"), ...fields.map(({ label }) => label));
  for (const { dimension, select } of fields) {
    const before = previous.get(dimension.name);
    const position = before === undefined ? -1 : dimension.values.findIndex((value) => Object.is(value, before.value));
    select.value = position >= 0 ? String(position) : "0";
  }
}

/** The values currently picked, by dimension. */
function readPicks(): Map<string, { readonly value: Value }> {
  const picks = new Map<string, { readonly value: Value }>();
  for (const select of pickers.querySelectorAll("select")) {
    const name = select.dataset["dimension"];
    const dimension = dimensions?.find((candidate) => candidate.name === name);
    if (dimension === undefined) continue;

    picks.set(dimension.name, { value: select.value === "unset" ? undefined : dimension.values[Number(select.value)] });
  }

  return picks;
}

function setPicks(values: Readonly<Record<string, Value>>): void {
  for (const select of pickers.querySelectorAll("select")) {
    const dimension = dimensions?.find((candidate) => candidate.name === select.dataset["dimension"]);
    if (dimension === undefined) continue;

    const value = values[dimension.name];
    const position = dimension.values.findIndex((candidate) => Object.is(candidate, value));
    select.value = value === undefined || position < 0 ? "unset" : String(position);
  }
}

// Operations

function integerOf(input: HTMLInputElement): number | undefined {
  const value = input.valueAsNumber;

  return Number.isSafeInteger(value) ? value : undefined;
}

function dimensionNames(): string[] {
  return (dimensions ?? []).map((dimension) => dimension.name);
}

function rowsFor(rows: readonly Row[], caption: string, firstIndex: number | undefined): HTMLElement {
  return rowsTable(caption, dimensionNames(), rows, firstIndex);
}

async function countOperation(): Promise<void> {
  const output = byId("count-result", HTMLDivElement);
  await operate({
    op: "count",
    label: "Counting",
    request: { op: "count", model: editor.value },
    output,
    show: (result) => {
      output.replaceChildren(textElement("p", `${combinationsPhrase(result.count)} satisfy the model.`));
    },
  });
}

async function listOperation(): Promise<void> {
  const output = byId("list-result", HTMLDivElement);
  const limit = integerOf(listLimit);
  if (limit === undefined || limit < 0 || limit > MAX_LIST_LIMIT) {
    showFailure(output, { kind: "error", message: `The number to show must be a whole number from 0 to ${String(MAX_LIST_LIMIT)}.` });

    return;
  }

  await operate({
    op: "list",
    label: "Listing",
    request: { op: "list", model: editor.value, limit },
    output,
    show: (result) => {
      const summary = result.truncated ? `The first ${String(result.rows.length)} combinations. There are more: raise the limit to see them.` : `All ${combinationsPhrase(result.rows.length)}.`;
      output.replaceChildren(textElement("p", summary), rowsFor(result.rows, "Combinations in enumeration order", 0), exportButtons(result.rows, "combinatrix-combinations"));
    },
  });
}

async function diagnoseOperation(): Promise<void> {
  const output = byId("diagnose-result", HTMLDivElement);
  await operate({
    op: "diagnose",
    label: "Looking for dead values",
    request: { op: "diagnose", model: editor.value },
    output,
    show: ({ diagnosis }) => {
      if (diagnosis.status === "empty") {
        output.replaceChildren(textElement("p", "No combination satisfies the model, so every value is dead.", "problem"));

        return;
      }

      const summary = textElement("p", `${combinationsPhrase(diagnosis.count)} satisfy the model.`);
      if (diagnosis.deadValues.length === 0) {
        output.replaceChildren(summary, textElement("p", "No dead values: every value of every dimension appears in some combination.", "valid"));

        return;
      }

      const lines = diagnosis.deadValues.map(({ dimension, value }) => `${dimension} = ${describeValue(value)}`);
      output.replaceChildren(summary, textElement("p", "These values appear in no combination:"), messageList(lines, "mono"));
    },
  });
}

/** What the page says of a covering array's check. */
function verificationNote(verification: Verification): HTMLElement {
  switch (verification.status) {
    case "covering":
      return textElement("p", `Checked with isCoveringArray against all ${combinationsPhrase(verification.solutionSet)}: it covers.`, "valid");
    case "not-covering":
      return textElement("p", `isCoveringArray rejects this array against all ${combinationsPhrase(verification.solutionSet)}.`, "problem");
    case "skipped":
      return textElement("p", `Not checked: the model has more than ${String(verification.limit)} combinations, more than this page enumerates to check an array.`, "muted");
    default:
      return unreachable(verification);
  }
}

async function coveringOperation(): Promise<void> {
  const output = byId("covering-result", HTMLDivElement);
  const chosen = integerOf(strength);
  if (chosen === undefined || chosen < 1) {
    showFailure(output, { kind: "error", message: "The strength must be a whole number of at least 1." });

    return;
  }

  await operate({
    op: "covering",
    label: "Building a covering array",
    request: { op: "covering", model: editor.value, strength: chosen },
    output,
    show: (result) => {
      const summary = textElement("p", `${String(result.rows.length)} row${result.rows.length === 1 ? "" : "s"} cover every combination of ${String(chosen)} dimension values that any valid combination contains.`);
      output.replaceChildren(summary, verificationNote(result.verification), rowsFor(result.rows, `Covering array of strength ${String(chosen)}`, undefined), exportButtons(result.rows, "combinatrix-covering-array"));
    },
  });
}

async function atOperation(): Promise<void> {
  const output = byId("combination-result", HTMLDivElement);
  const index = integerOf(indexInput);
  if (index === undefined || index < 0) {
    showFailure(output, { kind: "error", message: "The index must be a whole number of at least 0." });

    return;
  }

  await operate({
    op: "at",
    label: "Finding the combination",
    request: { op: "at", model: editor.value, index },
    output,
    show: ({ row }) => {
      if (row === undefined) {
        output.replaceChildren(textElement("p", `There is no combination at index ${String(index)}: the model has fewer combinations.`, "problem"));

        return;
      }

      setPicks(row.values);
      output.replaceChildren(textElement("p", `The combination at index ${String(index)}, shown in the pickers above.`), rowsFor([row], "Combination", index));
    },
  });
}

async function explainOperation(): Promise<void> {
  const output = byId("combination-result", HTMLDivElement);
  const values = Object.fromEntries([...readPicks()].map(([name, { value }]) => [name, value]));

  await operate({
    op: "explain",
    label: "Explaining",
    request: { op: "explain", model: editor.value, values },
    output,
    show: ({ explanation }) => {
      if (explanation.valid) {
        indexInput.value = String(explanation.index);
        output.replaceChildren(textElement("p", `This is a combination of the model, at index ${String(explanation.index)}, with id ${explanation.id}.`, "valid"));

        return;
      }

      output.replaceChildren(textElement("p", "This is not a combination of the model:", "problem"), messageList(explanation.reasons.map(describeReason), "problem"));
    },
  });
}

// Sharing, saving and files

function selectedIndex(): number | undefined {
  const index = integerOf(indexInput);

  return index !== undefined && index >= 0 ? index : undefined;
}

/** What a link to a model holds, with the index selected now. */
function stateOf(model: string): SharedState {
  const index = selectedIndex();

  return index === undefined ? { model } : { model, index };
}

/** What a link to the page as it is now holds: the editor's text and the selected index. */
function sharedState(): SharedState {
  return stateOf(editor.value);
}

/** The address bar follows the page: it holds a link to the model and index shown, so copying it from the browser is the same as Copy link. */
function addressChanged(): void {
  addressHoldsPage = false;
  clearTimeout(addressTimer);
  addressTimer = setTimeout(() => void writeAddress(), ADDRESS_DEBOUNCE_MS);
}

async function writeAddress(): Promise<void> {
  if (opened === undefined) return;

  addressRevision += 1;
  const revision = addressRevision;
  const address = await addressFor(opened, window.location.href, sharedState());
  if (revision !== addressRevision) return;

  window.history.replaceState(window.history.state, "", address.href);
  // A gist in the address is fetched again by a reload, so the model survives only while the network does.
  addressHoldsPage = address.kind === "link" || (address.kind === "unchanged" && !new URL(address.href).searchParams.has(GIST_PARAMETER));
  addressStatus.textContent = address.kind === "too-large" ? "This model is too large for the address bar, which has stopped following your edits. Share it as a gist." : "";
}

/** Records the page as opened: its address and the state it shows, which the address bar goes back to when the page is changed back. */
function markOpened(): void {
  opened = { href: window.location.href, state: sharedState() };
}

/** Gives the model in the editor an id if it has none, so what leaves the page (a saved model, a link, a file) names the model. Returns the id, or `undefined` when the editor holds no model the form can show, which has none to give. */
function identifyEditor(): string | undefined {
  if (state.problem !== undefined) return undefined;

  const identified = identify(state.model, mint);
  if (identified.model !== state.model) edit(() => identified.model, { reshapes: "nothing" });

  return identified.id;
}

async function copyLinkToClipboard(): Promise<void> {
  identifyEditor();
  const link = await shareUrl(window.location.href, sharedState());
  linkField.value = link;
  linkField.hidden = false;
  try {
    await navigator.clipboard.writeText(link);
    linkStatus.textContent = "Link copied. It holds the whole model in its fragment, which is never sent to a server.";
  } catch {
    linkField.select();
    linkStatus.textContent = "The browser would not copy it. The link is selected below: copy it from there.";
  }
}

/** Saves text as a file the browser downloads. */
function downloadText(fileName: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function exportModel(): void {
  identifyEditor();
  downloadText(EXPORT_FILE_NAME, editor.value, "application/json");
}

/** The buttons that take the rows of a result away: as a CSV or JSON file, or as the matrix of a GitHub Actions job on the clipboard. `stem` names the downloaded files. */
function exportButtons(rows: readonly Row[], stem: string): HTMLElement {
  const names = dimensionNames();
  const values = rows.map((row) => row.values);
  const status = textElement("p", "");
  status.setAttribute("role", "status");
  const action = (label: string, run: () => Promise<void> | void): HTMLButtonElement => {
    const control = textElement("button", label);
    control.type = "button";
    control.addEventListener("click", () => {
      void Promise.resolve(run()).catch(() => {
        status.textContent = "The browser would not let the page do that.";
      });
    });

    return control;
  };
  const group = document.createElement("div");
  group.className = "row";
  group.append(
    action("Download CSV", () => {
      downloadText(`${stem}.csv`, toCsv(names, values), "text/csv");
    }),
    action("Download JSON", () => {
      downloadText(`${stem}.json`, toJson(names, values), "application/json");
    }),
    action("Copy as a GitHub Actions matrix", async () => {
      await navigator.clipboard.writeText(toActionsMatrix(names, values));
      status.textContent = "Copied: use it as the `matrix` of a job, one run for each combination.";
    }),
  );
  const wrapper = document.createElement("div");
  wrapper.className = "export";
  wrapper.append(group, status);

  return wrapper;
}

async function importModel(): Promise<void> {
  const file = importInput.files?.[0];
  // Cleared before the file is read, so choosing the same file again still fires `change`.
  importInput.value = "";
  if (file === undefined) return;

  receive(await file.text());
}

/** What the saved list shows for a model: its name, and the start of its id when another saved model has the same name. */
function savedLabel(entry: { readonly id: string; readonly name: string }, all: readonly { readonly name: string }[]): string {
  return all.filter((other) => other.name === entry.name).length > 1 ? `${entry.name} (${entry.id.slice(0, SHORT_ID_LENGTH)})` : entry.name;
}

function renderSaved(): void {
  const all = saved.list();
  const items = all.map((entry) => {
    const label = savedLabel(entry, all);
    const open = textElement("button", "Open");
    open.type = "button";
    open.setAttribute("aria-label", `Open ${label}`);
    open.addEventListener("click", () => { receive(entry.model); });
    const remove = textElement("button", "Delete");
    remove.type = "button";
    remove.setAttribute("aria-label", `Delete ${label}`);
    remove.addEventListener("click", () => {
      savedStatus.textContent = saved.remove(entry.id) ? `Deleted ${label}.` : "The browser would not let the page change its storage.";
      renderSaved();
    });
    const item = document.createElement("li");
    item.append(textElement("span", label, "name"), open, remove);

    return item;
  });
  savedList.replaceChildren(...items);
  refresh();
}

function saveModel(): void {
  const id = identifyEditor();
  if (id === undefined) {
    savedStatus.textContent = "Fix the JSON before saving: only a model the form can show is saved.";

    return;
  }

  const name = [saveName.value.trim(), nameOf(state.model, ""), saved.find(id)?.name ?? ""].find((candidate) => candidate !== "") ?? "";
  if (name === "") {
    savedStatus.textContent = "Give the model a name, or a title, to save it under.";

    return;
  }

  savedStatus.textContent = saved.save({ id, name, model: editor.value }) ? `Saved ${name}.` : "The browser is not letting this page save: its storage is unavailable.";
  renderSaved();
}

// A model arriving with the id of one already here

/** The model that has arrived and is held until the person chooses what becomes of it, with the copy it clashes with and the link it came from, if it came from the address. */
interface Held {
  readonly theirs: string;
  readonly clash: Clash;
  readonly link: SharedState | undefined;
}

let held: Held | undefined;

/** Offers a model that has arrived (from a file or the saved list) to the editor: it replaces the model there unless it clashes with a copy that has its id. */
function receive(text: string): void {
  const clash = meet(text, editor.value, (id) => saved.find(id)?.model);
  if (clash === undefined) setModel(text);
  else hold({ theirs: text, clash, link: undefined });
}

/** Shows what differs between the copy here and the one that arrived, and the three things that can become of them. Nothing changes until one is chosen. */
function hold(next: Held): void {
  held = next;
  const id = idOf(modelOfText(next.theirs)) ?? "";
  clashSummary.textContent = `A model with the id ${id} is already ${next.clash.source === "editor" ? "open in the editor" : "saved"}, and the one arriving differs from it. An id says they are the same model, not which is newer, so choose what becomes of them.`;
  clashChanges.replaceChildren(...next.clash.changes.map((change) => textElement("li", change)));
  clashPanel.hidden = false;
  clashKeep.focus();
}

function release(): Held | undefined {
  const current = held;
  held = undefined;
  clashPanel.hidden = true;

  return current;
}

/** Keep mine: the arriving model is dropped. A link it came in is taken off the address bar, and a saved copy that was the one compared is opened. */
function keepMine(): void {
  const current = release();
  if (current === undefined) return;

  if (current.clash.source === "saved") setModel(current.clash.mine);
  if (current.link === undefined) return;

  // The clean address was opened with no model, so the model shown is a change and the address follows it with a link to it.
  const clean = new URL(window.location.href);
  clean.search = "";
  clean.hash = "";
  window.history.replaceState(window.history.state, "", clean.href);
  opened = { href: clean.href, state: { model: "" } };
  addressChanged();
}

/** Replace with theirs: mine is saved first as a copy under an id of its own, so that it is never lost, then the arriving model is opened. */
async function replaceWithTheirs(): Promise<void> {
  const current = held;
  if (current === undefined) return;

  const mine = modelOfText(current.clash.mine);
  if (mine === undefined) throw new Error("unreachable: the copy that was compared is a model");

  const copy = asCopy(mine, mint);
  const name = `${nameOf(mine, "Untitled model")} (replaced)`;
  if (!saved.save({ id: copy.id, name, model: JSON.stringify(copy.model, null, 2) })) {
    savedStatus.textContent = "The browser is not letting this page save, so the model here cannot be kept and has not been replaced.";

    return;
  }

  renderSaved();
  savedStatus.textContent = `Kept the model that was here as ${name}.`;
  release();
  if (current.link === undefined) setModel(current.theirs);
  else await openLink(current.link);
}

/** Save theirs as a copy: the arriving model is opened under an id of its own, and the copy here is left as it is. */
async function saveTheirsAsCopy(): Promise<void> {
  const current = release();
  if (current === undefined) return;

  const theirs = modelOfText(current.theirs);
  if (theirs === undefined) throw new Error("unreachable: the arriving model was compared as a model");

  const copy = JSON.stringify(asCopy(theirs, mint).model, null, 2);
  if (current.link === undefined) setModel(copy);
  else await openLink(current.link, copy);
}

// Starting

/** Opens the model a link holds, or `text` in its place, as the page the link opened. The address bar keeps the link while the page shows its model, and follows the page as soon as it shows anything else. */
async function openLink(restored: SharedState, text: string = restored.model): Promise<void> {
  setModel(text);
  if (restored.index !== undefined) indexInput.value = String(restored.index);
  opened = { href: window.location.href, state: stateOf(restored.model) };
  await validateEditor();
  if (restored.index !== undefined) await atOperation();
}

/** What loading the address did: it `loaded` a model, `held` one for the person to choose about, or found `none` to load. */
type Loaded = "loaded" | "held" | "none";

async function loadFromLocation(): Promise<Loaded> {
  try {
    const restored = await restoreFrom(window.location, async (url, init) => fetch(url, init));
    if (restored === undefined) return "none";

    notice.hidden = true;
    const clash = meet(restored.model, editor.value, (id) => saved.find(id)?.model);
    if (clash !== undefined) {
      hold({ theirs: restored.model, clash, link: restored });

      return "held";
    }

    await openLink(restored);

    return "loaded";
  } catch (error) {
    if (!(error instanceof Error)) throw error;

    notice.textContent = `This link could not be loaded: ${error.message}.`;
    notice.hidden = false;

    return "none";
  }
}

function start(): void {
  fillHelp(document);
  for (const [position, example] of EXAMPLES.entries()) exampleSelect.append(new Option(example.name, String(position)));
  listLimit.value = String(DEFAULT_LIST_LIMIT);
  listLimit.max = String(MAX_LIST_LIMIT);
  strength.value = String(DEFAULT_STRENGTH);
  indexInput.value = "0";

  editor.addEventListener("input", textTyped);
  useLastValid.addEventListener("click", () => {
    showState(stateFromModel(state.model, state.memory), { writeText: true, draw: true, announce: "The JSON was replaced by the last valid model." });
  });
  emptyModelButton.addEventListener("click", () => {
    showState(emptyState(), { writeText: true, draw: true, announce: "Started an empty model." });
  });
  exampleSelect.addEventListener("change", () => {
    const example = EXAMPLES[Number(exampleSelect.value)];
    if (example !== undefined) setModel(exampleText(example));
    exampleSelect.value = "";
  });
  copyLink.addEventListener("click", () => void copyLinkToClipboard());
  exportButton.addEventListener("click", exportModel);
  importInput.addEventListener("change", () => void importModel());
  saveButton.addEventListener("click", saveModel);
  cancelButton.addEventListener("click", () => {
    client.cancel();
  });
  byId("count", HTMLButtonElement).addEventListener("click", () => void countOperation());
  byId("list", HTMLButtonElement).addEventListener("click", () => void listOperation());
  byId("diagnose", HTMLButtonElement).addEventListener("click", () => void diagnoseOperation());
  byId("covering", HTMLButtonElement).addEventListener("click", () => void coveringOperation());
  byId("at", HTMLButtonElement).addEventListener("click", () => void atOperation());
  byId("explain", HTMLButtonElement).addEventListener("click", () => void explainOperation());
  indexInput.addEventListener("input", addressChanged);
  window.addEventListener("hashchange", () => void loadFromLocation());

  if (!saved.migrate()) savedStatus.textContent = "The browser would not let the page move the models you saved earlier. They are still stored.";
  renderSaved();
  clashKeep.addEventListener("click", keepMine);
  clashReplace.addEventListener("click", () => void replaceWithTheirs());
  clashCopy.addEventListener("click", () => void saveTheirsAsCopy());
  void loadFromLocation().then((loaded) => {
    if (loaded === "loaded") return;

    setModel(exampleText(STARTING_EXAMPLE));
    if (loaded === "none") markOpened();
  });
}

start();
startPwa(() => addressHoldsPage && !operating && held === undefined);
