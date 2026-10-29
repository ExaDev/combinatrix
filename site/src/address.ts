import type { SharedState } from "./fragment";
import { shareUrl } from "./fragment";

/**
 * The longest address the page writes into the address bar, in characters. Firefox parses a standard URL up to one mebibyte (Chromium accepts two across its process boundary), so a longer link may be refused by a browser the page cannot ask; a model that large travels as a gist.
 */
export const MAX_ADDRESS_LENGTH = 1_048_576;

/** WebKit throws a `SecurityError` from `history.replaceState` past this many calls in one window of time. */
const WEBKIT_REPLACE_STATE_CALLS = 100;

/** The window of time, in milliseconds, in which WebKit counts `history.replaceState` calls. */
const WEBKIT_REPLACE_STATE_WINDOW_MS = 30_000;

/**
 * How long after the last change the address is written. Writes are at least this far apart, because a write is made this long after the last change that came before it, so at most `WEBKIT_REPLACE_STATE_CALLS` happen in WebKit's window.
 */
export const ADDRESS_DEBOUNCE_MS = WEBKIT_REPLACE_STATE_WINDOW_MS / WEBKIT_REPLACE_STATE_CALLS;

/** What the address bar should hold for the page's current state. */
export type Address =
  | { readonly kind: "unchanged"; readonly href: string }
  | { readonly kind: "link"; readonly href: string }
  | { readonly kind: "too-large"; readonly href: string };

/** The state a page opened with, and the address it was opened at. */
export interface Opened {
  readonly href: string;
  readonly state: SharedState;
}

/**
 * The address for `state`. A state equal to the one the page opened with keeps the address it opened at, so a page that has not been changed (or has been changed back) shows the address it was given: a clean one, or a gist's. Any other state is a link holding it, as Copy link would make, unless that link is longer than `maxLength`, in which case the address is the page's own, without its query or fragment, because a stale fragment would restore a model the page no longer shows.
 */
export async function addressFor(opened: Opened, current: string, state: SharedState, maxLength = MAX_ADDRESS_LENGTH): Promise<Address> {
  if (state.model === opened.state.model && state.index === opened.state.index) return { kind: "unchanged", href: opened.href };

  const link = await shareUrl(current, state);
  if (link.length <= maxLength) return { kind: "link", href: link };

  const bare = new URL(current);
  bare.search = "";
  bare.hash = "";

  return { kind: "too-large", href: bare.href };
}
