import type { JsonObject } from "./json";
import { isJsonObject, omit, parseJson } from "./json";

/** The details a model may carry beside its definition: what names it across copies, what it is called and what it is for. They have no effect on the model. */
export const DETAIL_KEYS = ["id", "title", "description"] as const;

export type DetailKey = (typeof DETAIL_KEYS)[number];

/** The keys written before the definition, in order: the schema the file is written against, then the details. */
const LEADING_KEYS: readonly string[] = ["$schema", ...DETAIL_KEYS];

/** The model with its leading keys first, in `LEADING_KEYS` order, and every other key after them as it was. */
function leadingFirst(model: JsonObject): JsonObject {
  const entries = Object.entries(model);
  const leading = LEADING_KEYS.flatMap((key) => entries.filter(([existing]) => existing === key));
  const rest = entries.filter(([existing]) => !LEADING_KEYS.includes(existing));

  return Object.fromEntries([...leading, ...rest]);
}

/** The model a text holds, or `undefined` when the text is not JSON or not an object. */
export function modelOfText(text: string): JsonObject | undefined {
  try {
    const parsed = parseJson(text);

    return isJsonObject(parsed) ? parsed : undefined;
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;

    throw error;
  }
}

/** A detail of the model, or `undefined` when it has none (a detail that is not text is none). */
export function detailOf(model: JsonObject | undefined, key: DetailKey): string | undefined {
  const value = model?.[key];

  return typeof value === "string" && value !== "" ? value : undefined;
}

/** The durable id of the model, or `undefined` when it has none. */
export function idOf(model: JsonObject | undefined): string | undefined {
  return detailOf(model, "id");
}

/** The model with a detail set, or removed when the value is empty. Leading keys stay in front of the definition, whatever order the model had them in. */
export function withDetail(model: JsonObject, key: DetailKey, value: string): JsonObject {
  return leadingFirst(value === "" ? omit(model, key) : { ...model, [key]: value });
}

/** The model with an id, and that id: its own when it has one, otherwise one `mint` makes. */
export function identify(model: JsonObject, mint: () => string): { readonly id: string; readonly model: JsonObject } {
  const own = idOf(model);
  if (own !== undefined) return { id: own, model };

  const id = mint();

  return { id, model: withDetail(model, "id", id) };
}

/** The model as a new model of its own, and its id: the same definition and details under an id `mint` makes, so it is no longer the one it was copied from. */
export function asCopy(model: JsonObject, mint: () => string): { readonly id: string; readonly model: JsonObject } {
  const id = mint();

  return { id, model: withDetail(model, "id", id) };
}

/** What a model is called: its title, otherwise `fallback`. */
export function nameOf(model: JsonObject | undefined, fallback: string): string {
  return detailOf(model, "title") ?? fallback;
}
