/** The part of `Storage` the page uses. */
export interface StorageLike {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
}

/** A model the user saved under a name. */
export interface SavedModel {
  readonly name: string;
  readonly model: string;
}

/** The one storage key; its value is a JSON object from name to model text. */
const KEY = "combinatrix.models";

/**
 * The models saved in the browser, by name. Browsers can refuse storage altogether (a private window, blocked site data) by throwing from the accessor itself or from any call, so storage is reached through `getStorage` on every operation and a refusal is reported by the return value rather than thrown: the page works without saving. Contents that are not what this class wrote read as no saved models.
 */
export class SavedModels {
  readonly #getStorage: () => StorageLike;

  constructor(getStorage: () => StorageLike) {
    this.#getStorage = getStorage;
  }

  /** The saved models in name order; empty when storage is unavailable or holds nothing readable. */
  list(): SavedModel[] {
    const models = this.#read();

    return models === undefined ? [] : Object.entries(models).map(([name, model]) => ({ name, model })).sort((left, right) => left.name.localeCompare(right.name));
  }

  /** Saves a model under a name, replacing any saved under it. Returns whether storage accepted it. */
  save(name: string, model: string): boolean {
    return this.#update((models) => ({ ...models, [name]: model }));
  }

  /** Removes the model saved under a name. Returns whether storage accepted the change. */
  remove(name: string): boolean {
    return this.#update((models) => Object.fromEntries(Object.entries(models).filter(([saved]) => saved !== name)));
  }

  /** The saved models by name, or `undefined` when storage is unavailable. Unreadable contents are no saved models. */
  #read(): Readonly<Record<string, string>> | undefined {
    let text: string | null;
    try {
      text = this.#getStorage().getItem(KEY);
    } catch {
      return undefined;
    }
    if (text === null) return {};

    return parseModels(text);
  }

  #update(change: (models: Readonly<Record<string, string>>) => Readonly<Record<string, string>>): boolean {
    const models = this.#read();
    if (models === undefined) return false;

    try {
      this.#getStorage().setItem(KEY, JSON.stringify(change(models)));
    } catch {
      return false;
    }

    return true;
  }
}

/** The name-to-model object a stored string holds, or none if it is anything else. */
function parseModels(text: string): Readonly<Record<string, string>> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};

  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}
