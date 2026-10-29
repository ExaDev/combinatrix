/**
 * The part of an abort signal this library reads, declared structurally so that its types depend on neither the DOM library nor a runtime's own type package: a real `AbortSignal` satisfies it in every runtime, and so does any object that keeps the same contract. `aborted` turns true once and stays true, `reason` is then what the abort was given, and `throwIfAborted` throws `reason` when `aborted` is true and otherwise returns. The library calls only `throwIfAborted`, so a signal is honoured exactly as faithfully as that method keeps the contract.
 */
export interface AbortSignalLike {
  /** Whether the signal has aborted. */
  readonly aborted: boolean;
  /** Why it aborted, once `aborted` is true. */
  readonly reason: unknown;
  /** Throws `reason` when the signal has aborted, and otherwise does nothing. */
  readonly throwIfAborted: () => void;
}

/**
 * The number of search steps between looks at an abort signal. A step is one visit to a node of the search tree. Looking costs a property read, which is cheap beside a step but not free on the hot path, so the signal is read once per interval; the interval is also the bound on cancellation latency, since at most this many steps, fewer by one, run after the signal aborts. A power of two keeps the counter arithmetic exact.
 */
export const STEPS_PER_ABORT_CHECK = 64;

/**
 * A function to call once per search step, which throws the signal's own reason (as `signal.throwIfAborted()` does) at the first step on or after an interval boundary at which the signal has aborted. A signal that is already aborted throws here, before the first step. With no signal the function does nothing.
 */
export function stepCheck(signal: AbortSignalLike | undefined): () => void {
  if (signal === undefined) return () => undefined;

  signal.throwIfAborted();
  let sinceCheck = 0;

  return () => {
    sinceCheck += 1;
    if (sinceCheck < STEPS_PER_ABORT_CHECK) return;

    sinceCheck = 0;
    signal.throwIfAborted();
  };
}
