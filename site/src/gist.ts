/** Thrown when a gist cannot supply a model. */
export class GistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GistError";
  }
}

/** The part of a `fetch` response the page reads. */
export interface GistResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly json: () => Promise<unknown>;
}

/** The part of `fetch` the page calls, so a test can stand in for the network. */
export type GistFetch = (url: string, init: { readonly headers: Readonly<Record<string, string>> }) => Promise<GistResponse>;

/** Gist ids are hexadecimal; anything else is refused before it can become part of a request path. */
const GIST_ID = /^[0-9a-f]+$/i;

/** The model text in the first `.json` file of a public gist, fetched from GitHub's API. Throws `GistError` when the id is malformed, the request fails or the gist holds no usable file. */
export async function fetchGistModel(id: string, fetchGist: GistFetch): Promise<string> {
  if (!GIST_ID.test(id)) throw new GistError(`"${id}" is not a gist id`);

  const response = await fetchGist(`https://api.github.com/gists/${id}`, { headers: { Accept: "application/vnd.github+json" } });
  if (!response.ok) throw new GistError(`GitHub answered ${String(response.status)} for gist ${id}`);

  return selectGistModel(await response.json());
}

/** Whether a value is a plain object, whose properties are read by name. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The content of the first `.json` file, in the order the API lists files, of a gist payload. Throws `GistError` when there is none or the API truncated its content (it does so for large files), since a half model must not be loaded as if it were whole. */
export function selectGistModel(payload: unknown): string {
  if (!isRecord(payload) || !isRecord(payload["files"])) throw new GistError("the gist response has no files");

  for (const [name, file] of Object.entries(payload["files"])) {
    if (!name.toLowerCase().endsWith(".json")) continue;
    if (!isRecord(file)) throw new GistError(`gist file ${name} is not an object`);
    if (file["truncated"] === true) throw new GistError(`gist file ${name} is too large for GitHub's API to return whole`);

    const content = file["content"];
    if (typeof content !== "string") throw new GistError(`gist file ${name} has no content`);

    return content;
  }

  throw new GistError("the gist has no .json file");
}
