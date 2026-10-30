import { asCopy, identify, modelOfText } from "./identity";

/** The part of `Storage` the page uses. */
export interface StorageLike {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
  readonly removeItem: (key: string) => void;
}

/** A model the user saved: the durable id of the model names it, and the name is what the list shows. */
export interface SavedModel {
  readonly id: string;
  readonly name: string;
  readonly model: string;
}

/** The storage key of the saved models; its value is a JSON object from id to `{ name, model }`. */
const KEY = "combinatrix.saved";

/** The storage key of the models saved before they had ids; its value is a JSON object from name to model text. */
const NAMED_KEY = "combinatrix.models";

type Entries = Readonly<Record<string, Omit<SavedModel, "id">>>;

/**
 * The models saved in the browser, by the id of each. Browsers can refuse storage altogether (a private window, blocked site data) by throwing from the accessor itself or from any call, so storage is reached through `getStorage` on every operation and a refusal is reported by the return value rather than thrown: the page works without saving. Contents that are not what this class wrote read as no saved models.
 */
export class SavedModels {
  readonly #getStorage: () => StorageLike;

  readonly #mint: () => string;

  /** `mint` makes the id of a model that was saved before models had ids. */
  constructor(getStorage: () => StorageLike, mint: () => string) {
    this.#getStorage = getStorage;
    this.#mint = mint;
  }

  /** The saved models in name order, then id order; empty when storage is unavailable or holds nothing readable. */
  list(): SavedModel[] {
    const entries = this.#read();

    return entries === undefined ? [] : Object.entries(entries).map(([id, entry]) => ({ id, ...entry })).sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  }

  /** The text of the model saved with this id. */
  find(id: string): SavedModel | undefined {
    return this.list().find((saved) => saved.id === id);
  }

  /** Saves a model, replacing any saved with its id. Returns whether storage accepted it. */
  save({ id, ...entry }: SavedModel): boolean {
    return this.#update((entries) => ({ ...entries, [id]: entry }));
  }

  /** Removes the model saved with an id. Returns whether storage accepted the change. */
  remove(id: string): boolean {
    return this.#update((entries) => Object.fromEntries(Object.entries(entries).filter(([saved]) => saved !== id)));
  }

  /**
   * Moves the models saved by name, before they had ids, to saved models: each is given an id (written into its text) and keeps its name. The old entry is removed only once the new ones are stored, so a refusal loses nothing. Returns whether storage is in the new form.
   */
  migrate(): boolean {
    let named: string | null;
    try {
      named = this.#getStorage().getItem(NAMED_KEY);
    } catch {
      return false;
    }
    if (named === null) return true;

    const added = new Map<string, Omit<SavedModel, "id">>();
    for (const [name, text] of Object.entries(parseNamed(named))) {
      const { id, model } = this.#identified(text, (taken) => added.has(taken));
      added.set(id, { name, model });
    }
    if (!this.#update((entries) => ({ ...entries, ...Object.fromEntries(added) }))) return false;

    try {
      this.#getStorage().removeItem(NAMED_KEY);
    } catch {
      return false;
    }

    return true;
  }

  /** A model saved by name, given an id and written with it. A model that has an id another already holds is a copy of it and gets one of its own; text that is not a model is kept as it is. */
  #identified(text: string, isTaken: (id: string) => boolean): { readonly id: string; readonly model: string } {
    const parsed = modelOfText(text);
    if (parsed === undefined) return { id: this.#mint(), model: text };

    const identified = identify(parsed, this.#mint);
    const unique = isTaken(identified.id) ? asCopy(identified.model, this.#mint) : identified;

    return { id: unique.id, model: JSON.stringify(unique.model, null, 2) };
  }

  /** The saved models by id, or `undefined` when storage is unavailable. Unreadable contents are no saved models. */
  #read(): Entries | undefined {
    let text: string | null;
    try {
      text = this.#getStorage().getItem(KEY);
    } catch {
      return undefined;
    }
    if (text === null) return {};

    return parseEntries(text);
  }

  #update(change: (entries: Entries) => Entries): boolean {
    const entries = this.#read();
    if (entries === undefined) return false;

    try {
      this.#getStorage().setItem(KEY, JSON.stringify(change(entries)));
    } catch {
      return false;
    }

    return true;
  }
}

/** The object a stored string holds, or none if it is anything else. */
function parseObject(text: string): Readonly<Record<string, unknown>> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};

  return Object.fromEntries(Object.entries(value));
}

/** The id-to-entry object a stored string holds: the entries that have a name and a model, both text. */
function parseEntries(text: string): Entries {
  return Object.fromEntries(
    Object.entries(parseObject(text)).flatMap(([id, entry]) => {
      if (typeof entry !== "object" || entry === null || !("name" in entry) || !("model" in entry)) return [];

      return typeof entry.name === "string" && typeof entry.model === "string" ? [[id, { name: entry.name, model: entry.model }]] : [];
    }),
  );
}

/** The name-to-model object a stored string holds: the entries whose model is text. */
function parseNamed(text: string): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(parseObject(text)).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}
