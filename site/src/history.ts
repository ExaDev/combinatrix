/**
 * What can be undone and redone of a sequence of states. `past` holds the states before the present one, oldest first, and `future` the ones undone since, nearest first. A run of changes that share a `key` (the keystrokes in one field) is one step: the state before the first of them is what undoing goes back to.
 */
export interface History<T> {
  readonly past: readonly T[];
  /** The key of the change that made the state last in `past`, or `undefined` when it has none. */
  readonly lastKey: string | undefined;
  readonly future: readonly T[];
}

/**
 * The most states the history keeps, oldest dropped first. Each holds the text of a model, so the count bounds the memory it uses: a model of a few hundred kilobytes, the most the page keeps in its address, takes tens of megabytes at this depth.
 */
export const MAX_HISTORY = 100;

export function emptyHistory<T>(): History<T> {
  return { past: [], lastKey: undefined, future: [] };
}

/** The history after a change that left `previous` behind. The changes undone are forgotten, as a new change starts a new line of them. A change with the key of the one before it adds no step. */
export function record<T>(history: History<T>, previous: T, key: string | undefined): History<T> {
  if (key !== undefined && key === history.lastKey && history.past.length > 0) return { ...history, future: [] };

  return { past: [...history.past, previous].slice(-MAX_HISTORY), lastKey: key, future: [] };
}

/** The state before the present one and the history that leads back to it, or `undefined` when there is nothing to undo. `present` goes to the future so that it can be redone. */
export function undo<T>(history: History<T>, present: T): { readonly state: T; readonly history: History<T> } | undefined {
  const state = history.past.at(-1);
  if (state === undefined) return undefined;

  return { state, history: { past: history.past.slice(0, -1), lastKey: undefined, future: [present, ...history.future] } };
}

/** The state undone last and the history that leads on from it, or `undefined` when there is nothing to redo. */
export function redo<T>(history: History<T>, present: T): { readonly state: T; readonly history: History<T> } | undefined {
  const [state, ...rest] = history.future;
  if (state === undefined) return undefined;

  return { state, history: { past: [...history.past, present].slice(-MAX_HISTORY), lastKey: undefined, future: rest } };
}
