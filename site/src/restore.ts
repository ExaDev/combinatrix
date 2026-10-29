import type { SharedState } from "./fragment";
import { decodeState, encodedStateOf } from "./fragment";
import type { GistFetch } from "./gist";
import { fetchGistModel } from "./gist";

/** The parts of a location that name a state to restore. */
export interface LocationParts {
  readonly hash: string;
  readonly search: string;
}

/** The query parameter that names a public gist to load. */
const GIST_PARAMETER = "gist";

/**
 * The state a location asks for, or `undefined` when it asks for none. A fragment wins over a gist, because the fragment is what the page's own Copy link writes after the model has been edited. Throws `SharedStateError` or `GistError` when the one it uses is unusable.
 */
export async function restoreFrom(location: LocationParts, fetchGist: GistFetch): Promise<SharedState | undefined> {
  const encoded = encodedStateOf(location.hash);
  if (encoded !== undefined) return decodeState(encoded);

  const gist = new URLSearchParams(location.search).get(GIST_PARAMETER);
  if (gist !== null) return { model: await fetchGistModel(gist, fetchGist) };

  return undefined;
}
